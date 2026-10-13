import { open, readFile, rename, unlink } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { WipAllocation, WipPlan, WipSource } from './wipPlanning';

export type WipImportDraft = { allocations: WipAllocation[]; notes: string; sourceName: string };
type Revision = { revision: number; source: WipSource; allocations: WipAllocation[]; notes: string; createdBy: string; createdAt: string };
export type WipLocalStore = {
  version: 1;
  companyId: string;
  plans: Record<string, WipPlan>;
  drafts: Record<string, WipImportDraft>;
  history: Record<string, Revision[]>;
};

/** Explicit opt-in, development only. Never fall back to shared writes after a file error. */
export function wipLocalStorePath(environment = process.env): string | null {
  const path = environment.WIP_LOCAL_STORE_PATH?.trim();
  if (environment.NODE_ENV !== 'development' || !path) return null;
  if (!isAbsolute(path)) throw new Error('WIP_LOCAL_STORE_PATH must be absolute.');
  return path;
}

export async function readWipLocalStore(path: string, companyId: string): Promise<WipLocalStore> {
  const data = JSON.parse(await readFile(path, 'utf8'));
  if (data.version !== 1 || data.companyId !== companyId || !data.plans || !data.drafts || !data.history) {
    throw new Error('The local WIP file does not match this company.');
  }
  return data;
}

export async function saveWipLocalPlan(path: string, companyId: string, projectId: string, expectedRevision: number,
  data: Pick<WipPlan, 'source' | 'allocations' | 'notes'>, actor: string): Promise<WipPlan | null> {
  // An exclusive file lock also protects separate local server processes.
  const lock = await open(`${path}.lock`, 'wx');
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const store = await readWipLocalStore(path, companyId);
    if ((store.plans[projectId]?.revision || 0) !== expectedRevision) return null;
    const plan = { ...data, revision: expectedRevision + 1, updatedBy: actor, updatedAt: new Date().toISOString() };
    store.plans[projectId] = plan;
    delete store.drafts[projectId];
    (store.history[projectId] ||= []).push({ ...data, revision: plan.revision, createdBy: actor, createdAt: plan.updatedAt });
    const file = await open(temporary, 'wx');
    try { await file.writeFile(JSON.stringify(store, null, 2)); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path);
    return plan;
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await lock.close();
    await unlink(`${path}.lock`);
  }
}
