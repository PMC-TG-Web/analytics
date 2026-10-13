// Publish the reviewed local WIP workspace into the configured shared database.
// Dry run by default; refuses conflicting records and preserves local evidence.
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { isDeepStrictEqual } from 'node:util';
import { validateWipAllocations } from '../src/lib/wipPlanning.ts';

export function validateWorkspace(store, companyId, teams) {
  if (store?.version !== 1 || store.companyId !== companyId || !store.plans || !store.history || !store.drafts) throw Error('Workspace company or format mismatch.');
  const ids = [...new Set([...Object.keys(store.plans), ...Object.keys(store.drafts), ...teams.map(team => team.projectId)])];
  if (ids.some(id => !/^\d+$/.test(id))) throw Error('Invalid external project identity.');
  for (const [id, plan] of Object.entries(store.plans)) {
    validateWipAllocations(plan.allocations);
    const source = plan.source;
    if (!source?.bidBoardId || !source.proposalId || !Number.isFinite(source.allocatableHours) || source.allocatableHours <= 0
      || Math.abs(source.estimatedHours - source.projectManagementHours - source.allocatableHours) > 0.00011) throw Error('Invalid saved estimate basis.');
    const history = store.history[id];
    if (!Array.isArray(history) || history.length !== plan.revision || history.some((row, index) => row.revision !== index + 1)) throw Error('Incomplete plan history.');
    for (const row of history) validateWipAllocations(row.allocations);
    const last = history.at(-1);
    if (!isDeepStrictEqual(last.source, plan.source) || !isDeepStrictEqual(last.allocations, plan.allocations) || last.notes !== plan.notes) throw Error('Latest history does not match the plan.');
    if (!plan.updatedBy || !Number.isFinite(Date.parse(plan.updatedAt))) throw Error('Invalid plan audit fields.');
  }
  for (const [id, draft] of Object.entries(store.drafts)) {
    if (store.plans[id] || !Array.isArray(draft.allocations) || typeof draft.notes !== 'string' || typeof draft.sourceName !== 'string') throw Error('Invalid review draft.');
    const months = new Set();
    for (const row of draft.allocations) {
      if (!/^20\d\d-(0[1-9]|1[0-2])$/.test(row.month) || months.has(row.month) || !Number.isFinite(row.percent) || row.percent <= 0) throw Error('Invalid draft month.');
      months.add(row.month);
    }
  }
  if (new Set(teams.map(team => team.projectId)).size !== teams.length) throw Error('Duplicate team snapshot.');
  for (const team of teams) if (team.version !== 1 || team.companyId !== companyId || !Number.isFinite(Date.parse(team.syncedAt))
    || !Array.isArray(team.managers) || team.managers.some(manager => !manager.id || !manager.name)) throw Error('Invalid team snapshot.');
  return ids;
}

export async function publishWorkspace(db, store, teams, companyId, apply = false) {
  const ids = validateWorkspace(store, companyId, teams);
  return db.$transaction(async tx => {
    const projects = await tx.pmcProject.findMany({ where: { companyId, procoreProjectId: { in: ids } }, select: { procoreProjectId: true } });
    if (projects.length !== ids.length) throw Error('A workspace project is missing from this company.');
    let created = 0, unchanged = 0;
    for (const [projectId, plan] of Object.entries(store.plans)) {
      const key = { companyId, projectId };
      const existing = await tx.wipPlan.findUnique({ where: { companyId_projectId: key } });
      if (existing) {
        if (!isDeepStrictEqual(existing.source, plan.source) || !isDeepStrictEqual(existing.allocations, plan.allocations) || existing.notes !== plan.notes || existing.revision !== plan.revision) throw Error('Shared plan conflicts with local work; no records were changed.');
        unchanged++; continue;
      }
      created++;
      if (apply) {
        await tx.wipPlan.create({ data: { ...key, ...plan, updatedAt: new Date(plan.updatedAt) } });
        await tx.wipPlanRevision.createMany({ data: store.history[projectId].map(row => ({ ...key, ...row, createdAt: new Date(row.createdAt) })) });
      }
    }
    for (const [projectId, draft] of Object.entries(store.drafts)) {
      const key = { companyId, projectId };
      if (await tx.wipPlan.findUnique({ where: { companyId_projectId: key } })) throw Error('Review draft conflicts with a shared saved plan.');
      const existing = await tx.wipImportDraft.findUnique({ where: { companyId_projectId: key } });
      if (existing && (!isDeepStrictEqual(existing.allocations, draft.allocations) || existing.notes !== draft.notes || existing.sourceName !== draft.sourceName)) throw Error('Shared review draft conflicts with local work.');
      if (apply && !existing) await tx.wipImportDraft.upsert({ where: { companyId_projectId: key }, create: { ...key, ...draft }, update: {} });
    }
    let newerTeamsPreserved = 0;
    for (const team of teams) {
      const key = { source: 'procore_project_team', companyId, externalId: team.projectId };
      const existing = await tx.procoreProjectStaging.findUnique({ where: { source_companyId_externalId: key } });
      if (existing && new Date(existing.syncedAt) >= new Date(team.syncedAt)) { newerTeamsPreserved++; continue; }
      if (apply) await tx.procoreProjectStaging.upsert({ where: { source_companyId_externalId: key },
        create: { ...key, procoreProjectId: team.projectId, payload: team, syncedAt: new Date(team.syncedAt) },
        update: { payload: team, syncedAt: new Date(team.syncedAt) } });
    }
    return { mode: apply ? 'published' : 'dry run', created, unchanged, drafts: Object.keys(store.drafts).length, teams: teams.length, newerTeamsPreserved };
  }, { timeout: 120000, isolationLevel: 'Serializable' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { store: { type: 'string' }, company: { type: 'string' }, apply: { type: 'boolean', default: false } } });
  if (!values.store || !values.company || values.company !== process.env.PROCORE_COMPANY_ID) throw Error('Supply --store and the configured --company explicitly.');
  const store = JSON.parse(await readFile(values.store, 'utf8'));
  const directory = `${values.store}.teams`;
  const teams = await Promise.all((await readdir(directory)).filter(name => name.endsWith('.json')).map(async name => JSON.parse(await readFile(resolve(directory, name), 'utf8'))));
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();
  try { console.log(JSON.stringify(await publishWorkspace(db, store, teams, values.company, values.apply))); }
  finally { await db.$disconnect(); }
}
