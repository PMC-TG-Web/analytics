export const lancasterId = 'lancaster-county-plan-reviews';
export const lancasterLayer = 'https://services1.arcgis.com/I6XnrlnguPDoEObn/arcgis/rest/services/LCPC_Meeting_Review_Points/FeatureServer/0';
export const lancasterSource = 'https://www.arcgis.com/home/item.html?id=dd39ce8cada34c59adbfc463532c6577';
export const lancasterFields = ['SALDO_Form_ID', 'SALDO_FileNumber', 'SALDO_MeetingDate', 'SALDO_PlanName', 'SALDO_ProjectDescription', 'SALDO_PlanClassification', 'SALDO_MunicipalityMunicipalities', 'SALDO_ProposedLandUses', 'SALDO_ApplicationClassification'] as const;

export type LancasterProject = { id: string; fileNumber: string; name: string; description: string; municipality: string; proposedUse: string; planType: string; applicationType: string; meetingDate: string };
export type LancasterData = { sourceUpdatedAt: string; projects: LancasterProject[] };
export type LancasterFeedResult = { status: 'ok' | 'error'; checkedAt: string; message: string | null; data: LancasterData | null };
export type SavedLancaster = LancasterFeedResult & { lastSuccessAt: string | null };
type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const text = (value: unknown, required = false) => {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > 1000 || (required && !value.trim())) throw new Error('Invalid county field');
  return value.trim().replace(/\s+/g, ' ');
};

export function parseLancaster(metadata: unknown, payload: unknown, countPayload: unknown, now = new Date()): LancasterData {
  const meta = object(metadata), body = object(payload), count = object(countPayload);
  const sourceTime = object(meta.editingInfo).lastEditDate;
  if (meta.error || meta.id !== 0 || meta.name !== 'SALDO_points' || typeof sourceTime !== 'number' || !Number.isFinite(sourceTime) || sourceTime < Date.UTC(2020, 0, 1) || sourceTime > now.getTime() + 300_000) throw new Error('Invalid county layer');
  if (!Array.isArray(meta.fields) || !lancasterFields.every(field => (meta.fields as unknown[]).some(value => object(value).name === field))) throw new Error('County schema changed');
  if (body.error || count.error || body.exceededTransferLimit || !Array.isArray(body.features) || !Number.isInteger(count.count) || count.count !== body.features.length || body.features.length > 2000) throw new Error('Incomplete county response');
  const projects = new Map<string, LancasterProject>();
  for (const feature of body.features) {
    const row = object(object(feature).attributes);
    const id = text(row.SALDO_Form_ID, true);
    const meetingDate = text(row.SALDO_MeetingDate, true);
    if (!/^\d+$/.test(id) || !/^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) throw new Error('Invalid county identity or date');
    const date = new Date(meetingDate + 'T12:00:00Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== meetingDate || date.getTime() > now.getTime() + 90 * 86_400_000) throw new Error('Invalid county meeting date');
    const project: LancasterProject = { id, meetingDate, fileNumber: text(row.SALDO_FileNumber), name: text(row.SALDO_PlanName, true), description: text(row.SALDO_ProjectDescription), municipality: text(row.SALDO_MunicipalityMunicipalities, true).split('|').join(', '), proposedUse: text(row.SALDO_ProposedLandUses).split('|').join(' / '), planType: text(row.SALDO_PlanClassification), applicationType: text(row.SALDO_ApplicationClassification).split('|').join(' / ') };
    const existing = projects.get(id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(project)) throw new Error('Conflicting county submission');
    projects.set(id, project);
  }
  return { sourceUpdatedAt: new Date(sourceTime).toISOString(), projects: [...projects.values()].sort((a, b) => b.meetingDate.localeCompare(a.meetingDate) || a.municipality.localeCompare(b.municipality) || a.name.localeCompare(b.name)) };
}

export async function fetchLancaster(request: (url: string) => Promise<unknown>, now = new Date()): Promise<LancasterFeedResult> {
  const checkedAt = now.toISOString();
  const query = new URLSearchParams({ f: 'json', where: '1=1', outFields: lancasterFields.join(','), returnGeometry: 'false', orderByFields: 'OBJECTID', resultRecordCount: '2000' });
  try {
    const [metadata, payload, count] = await Promise.all([request(lancasterLayer + '?f=json'), request(lancasterLayer + '/query?' + query), request(lancasterLayer + '/query?f=json&where=1%3D1&returnCountOnly=true')]);
    return { status: 'ok', checkedAt, message: null, data: parseLancaster(metadata, payload, count, now) };
  } catch {
    return { status: 'error', checkedAt, message: 'County feed unavailable or incomplete; last saved plans retained.', data: null };
  }
}

export function lancasterFreshness(saved: SavedLancaster | null | undefined, now = new Date()) {
  if (!saved?.data) return 'Awaiting county data';
  if (saved.status !== 'ok') return 'Refresh failed';
  if (!saved.lastSuccessAt || now.getTime() - Date.parse(saved.lastSuccessAt) > 48 * 3_600_000) return 'Refresh overdue';
  const latestMeeting = saved.data.projects.map(project => project.meetingDate).sort().at(-1);
  if (now.getTime() - Date.parse(saved.data.sourceUpdatedAt) > 60 * 86_400_000 || (latestMeeting && now.getTime() - Date.parse(latestMeeting) > 60 * 86_400_000)) return 'County publication overdue';
  return 'Current';
}

export function lancasterProjectUrl(id: string) {
  if (!/^\d+$/.test(id)) throw new Error('Invalid county submission ID');
  return lancasterLayer + '/query?' + new URLSearchParams({ f: 'html', where: "SALDO_Form_ID='" + id + "'", outFields: lancasterFields.join(','), returnGeometry: 'false' });
}
