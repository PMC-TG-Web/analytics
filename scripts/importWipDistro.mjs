// Local-only import. No database connection or mutations. Dry run unless --apply.
import fs from 'node:fs/promises';
import { parseArgs } from 'node:util';
import XLSX from 'xlsx';
import { prepareWipDistroImport } from '../src/lib/wipDistroImport.ts';

const { values } = parseArgs({ options: {
  workbook: { type: 'string' }, projects: { type: 'string' }, mapping: { type: 'string' },
  store: { type: 'string' }, report: { type: 'string' }, company: { type: 'string' }, actor: { type: 'string' }, apply: { type: 'boolean', default: false },
  'exclude-rows': { type: 'string', default: '' },
} });
for (const key of ['workbook', 'projects', 'mapping', 'store', 'report', 'company', 'actor']) if (!values[key]) throw new Error(`--${key} is required.`);
const workbook = XLSX.read(await fs.readFile(values.workbook), { type: 'buffer' });
if (workbook.Workbook?.WBProps?.date1904) throw new Error('This import expects the Excel 1900 date system.');
if (workbook.SheetNames.length !== 1) throw new Error('Expected a single-sheet Distro export.');
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: null, raw: true });
const projects = JSON.parse(await fs.readFile(values.projects, 'utf8')).projects;
const mapping = JSON.parse(await fs.readFile(values.mapping, 'utf8'));
const excludedRows = values['exclude-rows'] ? values['exclude-rows'].split(',').map(Number) : [];
const result = prepareWipDistroImport(rows, projects, mapping, values.company, values.actor, new Date().toISOString(), excludedRows);
await fs.writeFile(values.report, JSON.stringify({ sourceFile: values.workbook, importedAt: new Date().toISOString(), excludedRows, report: result.report }, null, 2));
if (values.apply) await fs.writeFile(values.store, JSON.stringify(result.store, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ mode: values.apply ? 'local file created' : 'dry run', loaded: Object.keys(result.store.plans).length, review: Object.keys(result.store.drafts).length, unmatched: result.report.filter(row => !row.projectId).length }));
