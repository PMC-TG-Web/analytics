import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { wipLocalStorePath } from '@/lib/wipLocalStore';
import type { WipTeamSnapshot } from '@/lib/wipProjectTeam';

const source = 'procore_project_team';
function parse(value: unknown, companyId: string, projectId: string): WipTeamSnapshot {
  const data = value as WipTeamSnapshot;
  if (data?.version !== 1 || data.companyId !== companyId || data.projectId !== projectId || !Array.isArray(data.managers)
    || data.managers.some(manager => !manager.id || !manager.name)) throw new Error('Invalid saved Project Team.');
  return data;
}
function teamPath(local: string, companyId: string, projectId: string) {
  if (!/^\d+$/.test(companyId) || !/^\d+$/.test(projectId)) throw new Error('Invalid project identity.');
  return join(`${local}.teams`, `${companyId}-${projectId}.json`);
}

export async function loadWipProjectTeams(companyId: string, projectIds: string[]): Promise<Map<string, WipTeamSnapshot>> {
  const local = wipLocalStorePath();
  if (local) {
    const entries = await Promise.all(projectIds.map(async id => {
      try { return [id, parse(JSON.parse(await readFile(teamPath(local, companyId, id), 'utf8')), companyId, id)] as const; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    }));
    return new Map(entries.filter(entry => entry !== null));
  }
  const rows = await prisma.procoreProjectStaging.findMany({ where: { source, companyId, externalId: { in: projectIds } }, select: { externalId: true, payload: true } });
  return new Map(rows.map(row => [row.externalId, parse(row.payload, companyId, row.externalId)]));
}

export async function saveWipProjectTeam(snapshot: WipTeamSnapshot): Promise<void> {
  const local = wipLocalStorePath();
  const { companyId, projectId } = snapshot;
  parse(snapshot, companyId, projectId);
  if (local) {
    const target = teamPath(local, companyId, projectId);
    await mkdir(`${local}.teams`, { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, JSON.stringify(snapshot, null, 2), { flag: 'wx' }); await rename(temporary, target); }
    finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    return;
  }
  // A dedicated staging source keeps team snapshots separate from project-header sync.
  const payload = JSON.parse(JSON.stringify(snapshot));
  await prisma.procoreProjectStaging.upsert({
    where: { source_companyId_externalId: { source, companyId, externalId: projectId } },
    create: { source, companyId, externalId: projectId, procoreProjectId: projectId, payload },
    update: { payload, syncedAt: new Date(snapshot.syncedAt) },
  });
}
