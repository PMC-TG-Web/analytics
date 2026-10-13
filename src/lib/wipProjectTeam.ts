type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const normalized = (value: unknown) => text(value).toLowerCase().replace(/[^a-z0-9]/g, '');
export type WipProjectManager = { id: string; name: string };
export type WipTeamSnapshot = { version: 1; companyId: string; projectId: string; syncedAt: string; managers: WipProjectManager[] };

/** Project-role membership establishes PM responsibility; directory vendor establishes employer. */
export function selectParadiseProjectManagers(roles: Row[], users: Row[]): WipProjectManager[] {
  const ids = new Set(roles.filter(role => normalized(role.role ?? role.title) === 'projectmanager'
    && role.is_active !== false).map(role => text(role.user_id ?? role.contact_id ?? object(role.user).id)).filter(Boolean));
  const managers = new Map<string, WipProjectManager>();
  for (const user of users) {
    const id = text(user.id ?? user.user_id);
    if (!ids.has(id) || user.is_active === false) continue;
    const vendor = object(user.vendor);
    if (vendor.is_active === false || !['paradisemasonryllc', 'paradisemasonry'].includes(normalized(vendor.name))) continue;
    const name = text(user.name) || `${text(user.first_name)} ${text(user.last_name)}`.trim();
    if (name) managers.set(id, { id, name });
  }
  return [...managers.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchWipProjectTeam(companyId: string, projectId: string,
  request: (path: string) => Promise<unknown>): Promise<WipTeamSnapshot> {
  async function all(path: string): Promise<Row[]> {
    const rows: Row[] = [];
    for (let page = 1; page <= 20; page++) {
      const value = await request(`${path}${path.includes('?') ? '&' : '?'}page=${page}&per_page=100`);
      if (!Array.isArray(value) || value.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('Unexpected Project Team response.');
      rows.push(...value);
      if (value.length < 100) return rows;
    }
    throw new Error('Project Team pagination is incomplete.');
  }
  const roles = await all(`/rest/v1.0/project_roles?project_id=${encodeURIComponent(projectId)}`);
  const users = await all(`/rest/v1.0/projects/${encodeURIComponent(projectId)}/users?company_id=${encodeURIComponent(companyId)}`);
  return { version: 1, companyId, projectId, syncedAt: new Date().toISOString(), managers: selectParadiseProjectManagers(roles, users) };
}
