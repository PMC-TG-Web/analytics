import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { estimateRecord, PrimaryEstimateError } from '@/lib/procore/commitmentMakerEstimate';

export type EstimateImportTarget = { name: string; id: string; number: string };
export type EstimateImportState = { fingerprint: string; status: string; targets: EstimateImportTarget[]; combinations: unknown };
type Identity = { companyId: string; projectId: string };
type Claim = Identity & { owner: string };

export async function readPrimaryEstimateImport({ companyId, projectId }: Identity) {
  const [row] = await prisma.$queryRaw<EstimateImportState[]>`SELECT fingerprint, status, targets, combinations
    FROM commitment_maker_estimate_imports WHERE company_id = ${companyId} AND project_id = ${projectId}`;
  if (row) return row;
  // Older workbook imports predate the source claim. Their successful audit is
  // still evidence of a base estimate already applied to this exact project.
  const audits = await prisma.auditLog.findMany({ where: { entity: 'ProcoreCommitmentMaker',
    action: { in: ['create', 'resume'] }, changes: { path: ['projectId'], equals: projectId } },
    select: { entityId: true, changes: true } });
  const targets = audits.filter(audit => !estimateRecord(audit.changes).sourceChangeOrder).map(audit => {
    const changes = estimateRecord(audit.changes);
    return { name: String(changes.group || ''), id: audit.entityId || '', number: String(changes.number || '') };
  });
  return targets.length ? { fingerprint: 'legacy-workbook', status: 'completed', targets, combinations: [] } : null;
}

export function primaryEstimateImportBlock(state: EstimateImportState | null, fingerprint: string): string | null {
  if (!state) return null;
  const targets = state.targets.map(target => `PO ${target.number || target.id}`).join(', ');
  if (state.status === 'completed') return `The base estimate was already imported${targets ? ` into ${targets}` : ''}. Use approved change orders for additional scope.`;
  if (state.status !== 'retryable') return `An earlier primary estimate import is processing or needs review${targets ? ` (${targets})` : ''}. Another import is blocked to prevent duplicate POs.`;
  if (state.fingerprint !== fingerprint) return 'The primary estimate or its PO grouping changed after a partial import. Review the existing POs before importing again.';
  return null;
}

export async function claimPrimaryEstimateImport(params: Identity & { fingerprint: string; combinations: unknown }): Promise<Claim> {
  const owner = randomUUID();
  const rows = await prisma.$queryRaw<Array<{ owner: string }>>`INSERT INTO commitment_maker_estimate_imports
    (company_id, project_id, fingerprint, owner, status, combinations, targets)
    VALUES (${params.companyId}, ${params.projectId}, ${params.fingerprint}, ${owner}, 'running', ${JSON.stringify(params.combinations || [])}::jsonb, '[]'::jsonb)
    ON CONFLICT (company_id, project_id) DO UPDATE SET owner = EXCLUDED.owner, status = 'running', updated_at = NOW()
    WHERE commitment_maker_estimate_imports.status = 'retryable' AND commitment_maker_estimate_imports.fingerprint = EXCLUDED.fingerprint
    RETURNING owner`;
  if (rows[0]?.owner !== owner) throw new PrimaryEstimateError('This primary estimate is already being imported or has an earlier import. Preview again to check its status.');
  return { companyId: params.companyId, projectId: params.projectId, owner };
}

export async function savePrimaryEstimateImport(claim: Claim, targets: EstimateImportTarget[], status = 'running') {
  const changed = await prisma.$executeRaw`UPDATE commitment_maker_estimate_imports
    SET targets = ${JSON.stringify(targets)}::jsonb, status = ${status}, updated_at = NOW()
    WHERE company_id = ${claim.companyId} AND project_id = ${claim.projectId} AND owner = ${claim.owner} AND status = 'running'`;
  if (changed !== 1) throw new PrimaryEstimateError('The primary estimate import ownership could not be saved. Review the created POs before proceeding.');
}
