// Adds one immutable, company-scoped WIP report snapshot. Never creates Procore identities or overwrites plans.
import fs from 'node:fs/promises';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import XLSX from 'xlsx';
import { parseWipRevenueReport, wipReportKey } from '../src/lib/wipReportImport.ts';

const { values } = parseArgs({ options: { workbook: { type: 'string' }, mapping: { type: 'string' }, inventory: { type: 'string' }, company: { type: 'string' }, actor: { type: 'string' }, report: { type: 'string' }, apply: { type: 'boolean', default: false } } });
for (const key of ['workbook','mapping','inventory','company','actor','report']) if (!values[key]) throw new Error(`--${key} is required.`);
const buffer = await fs.readFile(values.workbook), workbook = XLSX.read(buffer, { type: 'buffer' });
if (workbook.SheetNames.length !== 1 || workbook.Workbook?.WBProps?.date1904) throw new Error('Expected a single worksheet using the 1900 date system.');
const mapping = JSON.parse(await fs.readFile(values.mapping, 'utf8'));
const inventory = JSON.parse(await fs.readFile(values.inventory, 'utf8'));
for (const link of Object.values(mapping)) if (!['procore','history'].includes(link.mode) || !inventory.some(p => p.companyId === link.companyId && p.procoreProjectId === link.projectId)) throw new Error('Reviewed project link not found in the inventory.');
const projects = parseWipRevenueReport(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: null }), values.company, mapping);
const snapshot = { version: 1, companyId: values.company, sourceFile: basename(values.workbook), sourceHash: createHash('sha256').update(buffer).digest('hex'), importedAt: new Date().toISOString(), importedBy: values.actor, projects };
await fs.writeFile(values.report, JSON.stringify(snapshot, null, 2));
if (values.apply) {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const name = wipReportKey(values.company);
    const existing = await prisma.estimatingConstant.findUnique({ where: { name } });
    if (existing) {
      const previous = JSON.parse(existing.value);
      if (previous.sourceHash !== snapshot.sourceHash || JSON.stringify(previous.projects) !== JSON.stringify(projects)) throw new Error('A different WIP snapshot exists. Review explicitly before replacing it.');
    }
    // Unique name plus empty update makes identical re-runs idempotent.
    await prisma.estimatingConstant.upsert({ where: { name }, create: { name, category: 'WIP_REPORTING', value: JSON.stringify(snapshot) }, update: {} });
  } finally { await prisma.$disconnect(); }
}
console.log(JSON.stringify({ mode: values.apply ? 'database snapshot saved' : 'dry run', projects: projects.length, legacyProjects: projects.filter(p => !p.link).length, historicalProcore: projects.filter(p => p.link?.mode === 'history').length, existingWip: projects.filter(p => p.link?.mode === 'procore').length, sourceRows: projects.reduce((n,p) => n+p.lines.length,0) }));
