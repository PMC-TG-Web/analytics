import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { CommitmentMakerRateLimitError } from '@/lib/procoreCommitmentMakerClient';
import { PrimaryEstimateError } from '@/lib/procore/commitmentMakerEstimate';

type ReadState = { responses: Record<string, unknown>; snapshot?: unknown; completedAt?: number };

/** This continuation is emitted only during read-only preparation, before any PO mutation. */
export class EstimateReadPending extends Error {
  constructor(readonly preparationId: string, readonly resumeAt = Date.now() + 250) {
    super('Preparing the primary estimate.');
  }
}

export async function openCommitmentEstimateRead(options: {
  companyId: string; projectId: string; boardId: string; mode: 'preview' | 'create';
  preparationId?: string; now?: () => number;
}) {
  const now = options.now || Date.now;
  const startedAt = now();
  const { companyId, projectId, boardId, mode } = options;
  const id = options.preparationId || randomUUID();
  let state: ReadState = { responses: {} };
  if (options.preparationId) {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new PrimaryEstimateError('Invalid estimate preparation. Preview again.');
    const [row] = await prisma.$queryRaw<Array<{ state: ReadState }>>`
      SELECT state FROM commitment_maker_estimate_reads
      WHERE id = ${id} AND company_id = ${companyId} AND project_id = ${projectId}
        AND board_id = ${boardId} AND mode = ${mode} AND expires_at > NOW()`;
    if (!row) throw new PrimaryEstimateError('This estimate preparation expired or belongs to another request. Preview again.');
    state = row.state;
    if (state.completedAt && now() - state.completedAt > 5 * 60_000) {
      throw new PrimaryEstimateError('The prepared estimate expired. Preview again to read the latest estimate.');
    }
  } else {
    await prisma.$executeRaw`INSERT INTO commitment_maker_estimate_reads
      (id, company_id, project_id, board_id, mode, state, expires_at)
      VALUES (${id}, ${companyId}, ${projectId}, ${boardId}, ${mode}, ${JSON.stringify(state)}::jsonb, NOW() + INTERVAL '65 minutes')`;
  }
  let liveReads = 0;
  return {
    id,
    snapshot: state.snapshot,
    async read(key: string, load: () => Promise<unknown>) {
      if (Object.hasOwn(state.responses, key)) return state.responses[key];
      // Leave room for the client's eight-second network timeout and bounded quota wait.
      if (liveReads >= 4 || now() - startedAt >= 5_000) throw new EstimateReadPending(id);
      liveReads += 1;
      let payload: unknown;
      try { payload = await load(); }
      catch (error) {
        if (error instanceof CommitmentMakerRateLimitError) {
          throw new EstimateReadPending(id, Date.parse(error.rateLimitUntil));
        }
        throw error;
      }
      // Persist every successful read before doing more work; a later timeout or
      // cooldown never discards already-read catalog items or estimate pages.
      await prisma.$executeRaw`UPDATE commitment_maker_estimate_reads
        SET state = jsonb_set(state, '{responses}', (state->'responses') || ${JSON.stringify({ [key]: payload })}::jsonb)
        WHERE id = ${id} AND company_id = ${companyId} AND project_id = ${projectId} AND mode = ${mode}`;
      state.responses[key] = payload;
      return payload;
    },
    async complete(snapshot: unknown): Promise<never> {
      await prisma.$executeRaw`UPDATE commitment_maker_estimate_reads
        SET state = state || ${JSON.stringify({ snapshot, completedAt: now() })}::jsonb
        WHERE id = ${id} AND company_id = ${companyId} AND project_id = ${projectId} AND mode = ${mode}`;
      // WBS validation and planning get their own fresh HTTP time budget.
      throw new EstimateReadPending(id);
    },
  };
}
