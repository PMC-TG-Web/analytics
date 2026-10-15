// Public municipal records. Document discovery never establishes project approval or a permit.
export const municipalSources = [
  { id: 'lancaster-city-records', name: 'Lancaster City', kind: 'city', url: 'https://www.cityoflancasterpa.gov/boards-commissions-and-authorities/planning-commission/' },
  { id: 'west-hempfield-plans', name: 'West Hempfield Township', kind: 'plans', url: 'https://www.westhempfield.org/subpage.php?link=plans' },
  { id: 'east-hempfield-records', name: 'East Hempfield Township', kind: 'meetings', url: 'https://www.easthempfield.org/government/agendas___minutes/planning_commission.php' },
  { id: 'lancaster-township-records', name: 'Lancaster Township', kind: 'meetings', url: 'https://www.twp.lancaster.pa.us/government/boards___commissions/planning_commission/agendas___minutes.php' },
  { id: 'east-lampeter-records', name: 'East Lampeter Township', kind: 'meetings', url: 'https://eastlampetertownship.org/government/planning-commission/' },
  { id: 'west-lampeter-records', name: 'West Lampeter Township', kind: 'meetings', url: 'https://www.westlampeter.com/AgendaCenter' },
  { id: 'manor-records', name: 'Manor Township', kind: 'meetings', url: 'https://manortownship.net/administration/' },
] as const;
export type MunicipalId = typeof municipalSources[number]['id'];
export type MunicipalSource = typeof municipalSources[number];
export type MunicipalDocument = { kind: 'Agenda' | 'Minutes'; meetingDate: string; url: string; cancelled: boolean };
export type MunicipalData = { documents: MunicipalDocument[]; plans: { name: string; url: string }[]; latestRecordAt: string | null; sourceUpdatedAt: string | null };
export type MunicipalResult = { id: MunicipalId; status: 'ok' | 'error'; checkedAt: string; message: string | null; data: MunicipalData | null };
export type SavedMunicipal = MunicipalResult & { lastSuccessAt: string | null };
export const cityDevelopmentLayer = 'https://services1.arcgis.com/jdavPUqnBVRDsKgB/arcgis/rest/services/SALDO_Approvals_RO/FeatureServer/0';
const day = 86_400_000;
const emptyData = (): MunicipalData => ({ documents: [], plans: [], latestRecordAt: null, sourceUpdatedAt: null });
function decode(s: string) {
  return s.replace(/&#(x[\da-f]+|\d+);/gi, (_, n: string) => {
    const code = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  }).replace(/&amp;/gi, '&').replace(/&nbsp;/gi, ' ').replace(/&quot;/gi, '"').replace(/&apos;/gi, "'");
}
const plain = (s: string) => decode(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
function clean(html: string) {
  if (!html || html.length > 1_000_000) throw new Error('Invalid municipal document');
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
}
function section(html: string, start: string, end: string) {
  const from = html.indexOf(start), to = html.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error('Municipal section changed');
  return html.slice(from, to);
}
function links(html: string) {
  return [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(m => ({ href: decode(m[1]), label: plain(m[2]) }));
}
function documentUrl(href: string, source: MunicipalSource) {
  // Revize pages declare their origin as <base>; do not resolve against the nested page path.
  const url = new URL(href, new URL(source.url).origin + '/');
  const host = (s: string) => s.replace(/^www\./, '');
  if (url.protocol !== 'https:' || host(url.hostname) !== host(new URL(source.url).hostname) || url.username || url.password || url.port || !(/\.pdf$/i.test(url.pathname) || /^\/AgendaCenter\/ViewFile\/(Agenda|Minutes)\/_\d{8}-\d+$/.test(url.pathname))) throw new Error('Invalid municipal document link');
  return url.href;
}
function dateParts(year: number, month: number, date: number, now: Date) {
  const time = Date.UTC(year, month - 1, date), value = new Date(time);
  if (year < 2000 || value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== date || time > now.getTime() + 45 * day) throw new Error('Invalid municipal meeting date');
  return value.toISOString().slice(0, 10);
}
function meetingDate(s: string, now: Date) {
  const numeric = /\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/.exec(s);
  if (numeric) return dateParts(Number(numeric[3]) + (numeric[3].length === 2 ? 2000 : 0), Number(numeric[1]), Number(numeric[2]), now);
  const named = /\b(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (20\d{2})\b/i.exec(s);
  if (!named) throw new Error('Missing municipal meeting date');
  return dateParts(Number(named[3]), ['january','february','march','april','may','june','july','august','september','october','november','december'].indexOf(named[1].toLowerCase()) + 1, Number(named[2]), now);
}
export function parseMunicipalHtml(source: MunicipalSource, input: string, now = new Date()): MunicipalData {
  const html = clean(input), data = emptyData();
  if (source.kind === 'plans') {
    const body = section(html, 'The following plans/projects are currently under review', '<aside');
    const found = links(body).filter(link => /\.pdf(?:\?|$)/i.test(link.href));
    if (!found.length || found.length > 100) throw new Error('Plan list missing or changed');
    data.plans = found.map(link => {
      if (!link.label || link.label.length > 500) throw new Error('Invalid plan name');
      return { name: link.label, url: documentUrl(link.href, source) };
    });
    if (new Set(data.plans.map(p => p.url)).size !== data.plans.length) throw new Error('Duplicate plan identity');
    return data;
  }
  let rows: string[];
  if (source.id === 'east-lampeter-records') {
    rows = section(html, 'id="planning-commission"', '<h2').split(/<hr\s*\/?\s*>/i);
  } else if (source.id === 'manor-records') {
    rows = section(html, 'Planning Commission Meetings', '<div class="box">').match(/<li\b[^>]*>[\s\S]*?<\/li>/gi) ?? [];
  } else if (source.id === 'west-lampeter-records') {
    rows = section(html, 'id="cat3"', '</tbody>').match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  } else if (source.id === 'east-hempfield-records' || source.id === 'lancaster-township-records') {
    const heading = plain(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? '');
    if (source.id === 'east-hempfield-records' ? heading !== 'Planning Commission' : heading !== 'Agendas & Minutes' || !html.includes('Planning Commission')) throw new Error('Wrong municipal page');
    rows = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  } else throw new Error('Unsupported municipal page');
  const found: MunicipalDocument[] = [];
  for (const row of rows) {
    for (const link of links(row)) {
      const kind = /^(?:View )?(Agenda|Minutes)$/i.exec(link.label)?.[1] ?? (source.id === 'west-lampeter-records' && !link.label ? /\/ViewFile\/(Minutes)\//.exec(link.href)?.[1] : undefined);
      if (!kind) continue;
      const url = documentUrl(link.href, source);
      let date: string;
      if (source.id === 'west-lampeter-records') {
        const parts = /\/_([01]\d)([0-3]\d)(20\d{2})-/.exec(url);
        if (!parts) throw new Error('Invalid agenda identity');
        date = dateParts(Number(parts[3]), Number(parts[1]), Number(parts[2]), now);
      } else date = meetingDate(plain(row), now);
      const documentKind = kind.toLowerCase() === 'agenda' ? 'Agenda' : 'Minutes';
      if (documentKind === 'Minutes' && Date.parse(date) > now.getTime()) throw new Error('Future minutes');
      found.push({ kind: documentKind, meetingDate: date, url, cancelled: /cancelled|canceled|no (?:planning commission )?meeting/i.test(plain(row)) });
    }
  }
  if (!found.length || found.length > 2000) throw new Error('Municipal records missing');
  // Only the latest agenda and latest minutes, never an archive of earlier snapshots.
  data.documents = (['Agenda', 'Minutes'] as const).flatMap(kind => {
    const sorted = found.filter(doc => doc.kind === kind).sort((a, b) => b.meetingDate.localeCompare(a.meetingDate));
    const latest = sorted[0];
    if (latest && sorted.some(doc => doc.meetingDate === latest.meetingDate && doc.url !== latest.url)) throw new Error('Ambiguous latest municipal document');
    return latest ? [latest] : [];
  });
  data.latestRecordAt = data.documents.map(doc => doc.meetingDate).sort().at(-1) ?? null;
  return data;
}
type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
export function parseCityCoverage(metadata: unknown, payload: unknown, now = new Date()): MunicipalData {
  const meta = object(metadata), body = object(payload);
  const fields = Array.isArray(meta.fields) ? meta.fields.map(object) : [];
  if (meta.error || meta.id !== 0 || meta.name !== 'SALDO_Approvals' || !['OBJECTID', 'MeetingDate'].every(name => fields.some(f => f.name === name)) || body.error || !Array.isArray(body.features) || body.features.length !== 1) throw new Error('City source changed');
  const row = object(object(body.features[0]).attributes);
  const stamp = (value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < Date.UTC(2000, 0, 1) || value > now.getTime() + 300_000) throw new Error('Invalid city source date');
    return new Date(value).toISOString();
  };
  return { ...emptyData(), latestRecordAt: stamp(row.MeetingDate), sourceUpdatedAt: stamp(object(meta.editingInfo).lastEditDate) };
}
export function municipalFetchUrl(source: MunicipalSource, now = new Date()) {
  if (source.id === 'east-lampeter-records') return `https://eastlampetertownship.org/${now.getUTCFullYear()}-meeting-archives/`;
  if (source.id === 'manor-records') return `https://manortownship.net/${now.getUTCFullYear()}-meeting-minutes-and-agenda/`;
  return source.url;
}
export async function fetchMunicipalFeeds(json: (url: string) => Promise<unknown>, text: (url: string) => Promise<string>, now = new Date()): Promise<MunicipalResult[]> {
  return Promise.all(municipalSources.map(async source => {
    try {
      let data: MunicipalData;
      if (source.kind === 'city') {
        const [meta, latest] = await Promise.all([json(cityDevelopmentLayer + '?f=json'), json(cityDevelopmentLayer + '/query?' + new URLSearchParams({ f: 'json', where: 'MeetingDate IS NOT NULL', outFields: 'OBJECTID,MeetingDate', returnGeometry: 'false', orderByFields: 'MeetingDate DESC,OBJECTID DESC', resultRecordCount: '1' }))]);
        data = parseCityCoverage(meta, latest, now);
      } else data = parseMunicipalHtml(source, await text(municipalFetchUrl(source, now)), now);
      return { id: source.id, status: 'ok' as const, checkedAt: now.toISOString(), message: null, data };
    } catch {
      return { id: source.id, status: 'error' as const, checkedAt: now.toISOString(), message: 'Municipal source unavailable or changed; last saved records retained.', data: null };
    }
  }));
}
export function municipalFreshness(source: MunicipalSource, saved: SavedMunicipal | undefined, now = new Date()) {
  if (!saved?.data) return 'Awaiting source check';
  if (saved.status !== 'ok') return 'Source check failed';
  if (!saved.lastSuccessAt || now.getTime() - Date.parse(saved.lastSuccessAt) > 2 * day) return 'Source check overdue';
  if (source.kind === 'plans') return 'Posting dates unavailable';
  if (!saved.data.latestRecordAt) return 'Record dates unavailable';
  if (now.getTime() - Date.parse(saved.data.latestRecordAt) > 90 * day) return source.kind === 'city' ? 'City project feed out of date' : 'Meeting records overdue';
  return source.kind === 'city' ? 'City records need review' : 'Recent meeting records';
}
