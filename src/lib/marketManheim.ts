export const manheimId = 'manheim-township-development';
export const manheimSource = 'https://www.manheimtownship.org/478/Planning-Zoning';
export const manheimService = 'https://services3.arcgis.com/yy3Y2xxSi397ufGR/arcgis/rest/services/Plan_Development_Map/FeatureServer';
export const manheimFields = ['OBJECTID', 'DatePosted', 'PlanStatus', 'PlanType', 'Address', 'ProjectDescription', 'DevelopmentType', 'PlanDrawings', 'TitleName'] as const;
const layerNames = ['Pending/Projects Under Review', 'Active/Projects Under Construction'];
const statuses = { UR: 'Under review', A: 'Approved', UC: 'Under construction' } as const;
export type ManheimStatus = typeof statuses[keyof typeof statuses];
export type ManheimProject = { id: string; layerId: number; objectId: number; name: string; description: string; address: string; proposedUse: string; planType: string; status: ManheimStatus; postedAt: string | null; drawingsUrl: string | null };
export type ManheimData = { sourceUpdatedAt: string; projects: ManheimProject[] };
export type ManheimFeedResult = { status: 'ok' | 'error'; checkedAt: string; message: string | null; data: ManheimData | null };
export type SavedManheim = ManheimFeedResult & { lastSuccessAt: string | null };
type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
function text(value: unknown, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > 4000 || required && !value.trim()) throw new Error('Invalid township field');
  return value.trim().replace(/\s+/g, ' ');
}
function timestamp(value: unknown, now: Date) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < Date.UTC(2000, 0, 1) || value > now.getTime() + 300_000) throw new Error('Invalid township date');
  return new Date(value).toISOString();
}
export function parseManheimLayer(layer: number, metadata: unknown, payload: unknown, countPayload: unknown, now = new Date()): ManheimData {
  const meta = object(metadata), body = object(payload), count = object(countPayload);
  if (![0, 1].includes(layer) || meta.error || meta.id !== layer || meta.name !== layerNames[layer] || !Array.isArray(meta.fields)) throw new Error('Invalid township layer');
  const fields = meta.fields.map(object);
  if (!manheimFields.every(field => fields.some(value => value.name === field))) throw new Error('Township schema changed');
  const domain = object(fields.find(field => field.name === 'PlanStatus')?.domain);
  const codes = Array.isArray(domain.codedValues) ? domain.codedValues.map(object) : [];
  if (!Object.entries(statuses).every(([code, name]) => codes.some(value => value.code === code && String(value.name).toLowerCase() === name.toLowerCase()))) throw new Error('Township status meanings changed');
  const sourceUpdatedAt = timestamp(object(meta.editingInfo).lastEditDate, now);
  if (body.error || count.error || body.exceededTransferLimit || !Array.isArray(body.features) || !Number.isInteger(count.count) || count.count !== body.features.length || body.features.length > 2000) throw new Error('Incomplete township response');
  const projects = new Map<string, ManheimProject>();
  for (const feature of body.features) {
    const row = object(object(feature).attributes);
    if (!Number.isSafeInteger(row.OBJECTID) || Number(row.OBJECTID) < 1 || !Object.hasOwn(statuses, String(row.PlanStatus))) throw new Error('Invalid township identity or status');
    const id = layer + ':' + row.OBJECTID;
    const drawings = text(row.PlanDrawings);
    let drawingsUrl: string | null = null;
    if (drawings) {
      const url = new URL(drawings);
      if (url.protocol !== 'https:' || !['www.manheimtownship.org', 'manheimtownship.org'].includes(url.hostname) || !url.pathname.startsWith('/DocumentCenter/View/') || url.username || url.password || url.port) throw new Error('Invalid township drawing URL');
      drawingsUrl = url.href;
    }
    const rawUse = text(row.DevelopmentType);
    const project: ManheimProject = { id, layerId: layer, objectId: Number(row.OBJECTID), name: text(row.TitleName, true), description: text(row.ProjectDescription), address: text(row.Address), proposedUse: /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(rawUse) ? '' : rawUse, planType: text(row.PlanType), status: statuses[row.PlanStatus as keyof typeof statuses], postedAt: row.DatePosted == null ? null : timestamp(row.DatePosted, now), drawingsUrl };
    if (projects.has(id)) throw new Error('Duplicate township record');
    projects.set(id, project);
  }
  return { sourceUpdatedAt, projects: [...projects.values()] };
}
export async function fetchManheim(request: (url: string) => Promise<unknown>, now = new Date()): Promise<ManheimFeedResult> {
  const checkedAt = now.toISOString();
  try {
    const layers = await Promise.all([0, 1].map(async layer => {
      const root = manheimService + '/' + layer;
      const query = new URLSearchParams({ f: 'json', where: '1=1', outFields: manheimFields.join(','), returnGeometry: 'false', orderByFields: 'OBJECTID', resultRecordCount: '2000' });
      const [metadata, payload, count] = await Promise.all([request(root + '?f=json'), request(root + '/query?' + query), request(root + '/query?f=json&where=1%3D1&returnCountOnly=true')]);
      return parseManheimLayer(layer, metadata, payload, count, now);
    }));
    // Use the older layer update for freshness: one updated layer cannot mask another's age.
    return { status: 'ok', checkedAt, message: null, data: { sourceUpdatedAt: layers.map(layer => layer.sourceUpdatedAt).sort()[0], projects: layers.flatMap(layer => layer.projects) } };
  } catch {
    return { status: 'error', checkedAt, message: 'Township tracker unavailable or incomplete; last saved projects retained.', data: null };
  }
}
export function manheimFreshness(saved: SavedManheim | null | undefined, now = new Date()) {
  if (!saved?.data) return 'Awaiting township data';
  if (saved.status !== 'ok') return 'Refresh failed';
  if (!saved.lastSuccessAt || now.getTime() - Date.parse(saved.lastSuccessAt) > 48 * 3_600_000) return 'Refresh overdue';
  return now.getTime() - Date.parse(saved.data.sourceUpdatedAt) > 60 * 86_400_000 ? 'Township publication overdue' : 'Current';
}
export function manheimProjectUrl(project: Pick<ManheimProject, 'layerId' | 'objectId'>) {
  if (![0, 1].includes(project.layerId) || !Number.isSafeInteger(project.objectId) || project.objectId < 1) throw new Error('Invalid township record');
  return manheimService + '/' + project.layerId + '/query?' + new URLSearchParams({ f: 'html', where: 'OBJECTID=' + project.objectId, outFields: manheimFields.join(','), returnGeometry: 'false' });
}
