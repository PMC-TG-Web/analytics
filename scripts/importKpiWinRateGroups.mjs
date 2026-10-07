// Imports reporting choices only. Never changes Procore or canonical identities.
// Dry run by default; --apply upserts the single named KPI reporting policy.
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { KPI_WIN_RATE_POLICY_KEY, winRateName, mergeWinRateGroups } from '../src/lib/kpiWinRate.ts';

dotenv.config({ path: ['.env.local', '.env'], quiet: true });
const args = process.argv.slice(2);
const arg = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const file = arg('--workbook');
if (!file) throw new Error('Usage: node scripts/importKpiWinRateGroups.mjs --workbook <xlsx> [--choices <json>] [--apply]');
const choices = arg('--choices') ? JSON.parse(fs.readFileSync(arg('--choices'), 'utf8')) : { aliases: {}, excludedSources: [] };
const p = new PrismaClient();
try {
  const bids = await p.pmcBidBoardProject.findMany();
  const workbook = XLSX.read(fs.readFileSync(file), { cellDates: true });
  if (!workbook.Sheets['Active Projects']) throw new Error('Active Projects worksheet is required.');
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets['Active Projects']);
  const groups = [];
  const unmatched = [];
  const names = new Set();
  for (const row of rows) {
    const name = String(row.Name ?? '').trim();
    const date = row['Created Date'];
    const companyId = row.Instance === 'Old' ? '598134325658789' : row.Instance === 'New' ? '598134325805519' : '';
    if (!name || !(date instanceof Date) || !Number.isFinite(date.getTime()) || !companyId) throw new Error('Invalid project name, Created Date, or Instance.');
    const key = name.trim().toLowerCase();
    if (names.has(key)) throw new Error(`Workbook still has duplicate project: ${name}`);
    names.add(key);
    const candidates = bids.filter(b => b.companyId === companyId && !b.bidBoardId.includes(':') && winRateName(b.projectName) === winRateName(name))
      .map(b => ({ b, distance: Math.abs(Date.parse(b.payload?.created_on ?? '') - date.getTime()) }))
      .filter(c => Number.isFinite(c.distance)).sort((a, b) => a.distance - b.distance);
    // Procore's Excel export shifts its displayed timestamps by the local offset.
    // Require a unique same-name, same-instance record within that offset window.
    if (!candidates[0] || candidates[0].distance > 6 * 60 * 60_000 || candidates[0].distance === candidates[1]?.distance) { unmatched.push(name); continue; }
    const source = `${companyId}:${candidates[0].b.bidBoardId}`;
    groups.push({ key: source, names: [name], preferredSource: source, createdDate: date.toISOString() });
  }
  if (unmatched.length) throw new Error(`Unmatched or ambiguous workbook projects: ${unmatched.join(', ')}`);
  for (const [alias, target] of Object.entries(choices.aliases ?? {})) {
    const group = groups.find(g => winRateName(g.names[0]) === winRateName(target));
    if (!group) throw new Error(`Alias target is not in workbook: ${target}`);
    // A reviewed alias may intentionally merge two retained workbook rows.
    group.names.push(alias);
  }
  for (const group of groups) {
    const aliases = new Set(group.names.map(winRateName));
    group.sourceIds = bids.filter(b => !b.bidBoardId.includes(':') && aliases.has(winRateName(b.projectName)))
      .map(b => `${b.companyId}:${b.bidBoardId}`);
  }
  const policy = { groups: mergeWinRateGroups(groups), excludedSources: choices.excludedSources ?? [] };
  if (args.includes('--apply')) {
    await p.estimatingConstant.upsert({ where: { name: KPI_WIN_RATE_POLICY_KEY }, create: { name: KPI_WIN_RATE_POLICY_KEY, category: 'KPI_REPORTING', value: JSON.stringify(policy) }, update: { value: JSON.stringify(policy) } });
  }
  console.log(JSON.stringify({ mode: args.includes('--apply') ? 'applied' : 'dry-run', workbookRows: groups.length, projects: policy.groups.length, aliases: Object.keys(choices.aliases ?? {}).length, excludedSources: policy.excludedSources.length }));
} finally { await p.$disconnect(); }
