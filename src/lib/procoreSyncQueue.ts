import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type QueuedProject = {
  companyId: string;
  projectId: string;
  dataset: string;
  projectNumber: string | null;
  projectName: string | null;
  leaseId: string;
};

type DbProjectRow = {
  company_id: string;
  project_id: string;
  dataset: string;
  project_number: string | null;
  project_name: string | null;
};

type ControlRow = {
  worker_locked_by: string | null;
  worker_locked_until: Date | null;
  rate_limit_until: Date | null;
};

export async function seedAllProjectSyncQueue(companyId: string, dataset: string) {
  const seeded = await prisma.$executeRawUnsafe(
    `
      WITH source_projects AS (
        SELECT
          company_id,
          procore_project_id AS project_id,
          project_number,
          project_name
        FROM pmc_projects
        WHERE company_id = $1
          AND NULLIF(BTRIM(procore_project_id), '') IS NOT NULL
          AND LOWER(BTRIM(project_name)) NOT LIKE '%template%'

        UNION ALL

        SELECT
          budget.company_id,
          budget.project_id,
          MAX(project.project_number),
          MAX(project.project_name)
        FROM budgetlineitems budget
        LEFT JOIN pmc_projects project
          ON project.company_id = budget.company_id
         AND project.procore_project_id = budget.project_id
        WHERE budget.company_id = $1
          AND NULLIF(BTRIM(budget.project_id), '') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM pmc_projects current_project
            WHERE current_project.company_id = budget.company_id
              AND current_project.procore_project_id = budget.project_id
          )
        GROUP BY budget.company_id, budget.project_id
      )
      INSERT INTO procore_sync_project_states (
        company_id, project_id, dataset, project_number, project_name,
        next_run_at, created_at, updated_at
      )
      SELECT
        company_id,
        project_id,
        $2,
        project_number,
        project_name,
        NOW(),
        NOW(),
        NOW()
      FROM source_projects
      ON CONFLICT (company_id, project_id, dataset)
      DO UPDATE SET
        project_number = COALESCE(EXCLUDED.project_number, procore_sync_project_states.project_number),
        project_name = COALESCE(EXCLUDED.project_name, procore_sync_project_states.project_name),
        next_run_at = CASE
          WHEN procore_sync_project_states.last_error LIKE 'Excluded because the project is no longer in the master actuals scope.%'
          THEN NOW()
          ELSE procore_sync_project_states.next_run_at
        END,
        last_error = CASE
          WHEN procore_sync_project_states.last_error LIKE 'Excluded because the project is no longer in the master actuals scope.%'
          THEN NULL
          ELSE procore_sync_project_states.last_error
        END,
        updated_at = NOW()
    `,
    companyId,
    dataset
  );
  await prisma.$executeRawUnsafe(
    `
      UPDATE procore_sync_project_states state
      SET next_run_at = NOW() + INTERVAL '100 years',
          locked_by = NULL,
          locked_until = NULL,
          last_error = 'Excluded because the project is no longer in the master actuals scope.',
          updated_at = NOW()
      WHERE state.company_id = $1
        AND state.dataset = $2
        AND NOT EXISTS (
          SELECT 1
          FROM pmc_projects project
          WHERE project.company_id = state.company_id
            AND project.procore_project_id = state.project_id
            AND NULLIF(BTRIM(project.procore_project_id), '') IS NOT NULL
            AND LOWER(BTRIM(project.project_name)) NOT LIKE '%template%'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM budgetlineitems budget
          WHERE budget.company_id = state.company_id
            AND budget.project_id = state.project_id
            AND NULLIF(BTRIM(budget.project_id), '') IS NOT NULL
        )
    `,
    companyId,
    dataset
  );
  return seeded;
}

export async function seedProjectSyncQueue(companyId: string, dataset: string) {
  return prisma.$executeRawUnsafe(
    `
      INSERT INTO procore_sync_project_states (
        company_id, project_id, dataset, project_number, project_name,
        next_run_at, created_at, updated_at
      )
      SELECT
        b.company_id,
        b.project_id,
        $2,
        MAX(p.project_number),
        MAX(p.project_name),
        NOW(),
        NOW(),
        NOW()
      FROM budgetlineitems b
      LEFT JOIN pmc_projects p
        ON p.company_id = b.company_id
       AND p.procore_project_id = b.project_id
      WHERE b.company_id = $1
        AND b.project_id IS NOT NULL
        AND b.project_id <> ''
      GROUP BY b.company_id, b.project_id
      ON CONFLICT (company_id, project_id, dataset)
      DO UPDATE SET
        project_number = COALESCE(EXCLUDED.project_number, procore_sync_project_states.project_number),
        project_name = COALESCE(EXCLUDED.project_name, procore_sync_project_states.project_name),
        updated_at = NOW()
    `,
    companyId,
    dataset
  );
}

export async function getSyncQueueStats(companyId: string, dataset: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{
    project_count: number;
    due_projects: number;
    never_succeeded: number;
    failed_projects: number;
  }>>(
    `
      SELECT
        COUNT(*)::int AS project_count,
        COUNT(*) FILTER (WHERE next_run_at <= NOW())::int AS due_projects,
        COUNT(*) FILTER (WHERE last_success_at IS NULL)::int AS never_succeeded,
        COUNT(*) FILTER (WHERE failure_count > 0)::int AS failed_projects
      FROM procore_sync_project_states
      WHERE company_id = $1
        AND dataset = $2
    `,
    companyId,
    dataset
  );
  return rows[0] || {
    project_count: 0,
    due_projects: 0,
    never_succeeded: 0,
    failed_projects: 0,
  };
}

export async function seedEstimatingSyncQueue(companyId: string, dataset: string) {
  const seeded = await prisma.$executeRawUnsafe(
    `
      INSERT INTO procore_sync_project_states (
        company_id, project_id, dataset, project_number, project_name,
        next_run_at, created_at, updated_at
      )
      SELECT
        company_id,
        bid_board_id,
        $2,
        project_number,
        project_name,
        NOW(),
        NOW(),
        NOW()
      FROM pmc_bid_board_projects
      WHERE company_id = $1
        AND POSITION(':' IN bid_board_id) = 0
        AND NOT (COALESCE(payload, '{}'::jsonb) @> '{"archived":true}'::jsonb)
        AND NOT (COALESCE(payload, '{}'::jsonb) @> '{"deleted":true}'::jsonb)
        AND NOT (COALESCE(payload, '{}'::jsonb) @> '{"is_template":true}'::jsonb)
        AND NOT (COALESCE(payload, '{}'::jsonb) @> '{"sync_missing_from_procore":true}'::jsonb)
      ON CONFLICT (company_id, project_id, dataset)
      DO UPDATE SET
        project_number = COALESCE(EXCLUDED.project_number, procore_sync_project_states.project_number),
        project_name = COALESCE(EXCLUDED.project_name, procore_sync_project_states.project_name),
        next_run_at = CASE
          WHEN procore_sync_project_states.last_error LIKE 'Excluded because the Bid Board row is legacy,%'
          THEN NOW()
          ELSE procore_sync_project_states.next_run_at
        END,
        last_error = CASE
          WHEN procore_sync_project_states.last_error LIKE 'Excluded because the Bid Board row is legacy,%'
          THEN NULL
          ELSE procore_sync_project_states.last_error
        END,
        updated_at = NOW()
    `,
    companyId,
    dataset
  );
  await prisma.$executeRawUnsafe(
    `
      UPDATE procore_sync_project_states state
      SET next_run_at = NOW() + INTERVAL '100 years',
          locked_by = NULL,
          locked_until = NULL,
          last_error = 'Excluded because the Bid Board row is legacy, archived, deleted, a template, or no longer returned by Procore.',
          updated_at = NOW()
      WHERE state.company_id = $1
        AND state.dataset = $2
        AND NOT EXISTS (
          SELECT 1
          FROM pmc_bid_board_projects board
          WHERE board.company_id = state.company_id
            AND board.bid_board_id = state.project_id
            AND POSITION(':' IN board.bid_board_id) = 0
            AND NOT (COALESCE(board.payload, '{}'::jsonb) @> '{"archived":true}'::jsonb)
            AND NOT (COALESCE(board.payload, '{}'::jsonb) @> '{"deleted":true}'::jsonb)
            AND NOT (COALESCE(board.payload, '{}'::jsonb) @> '{"is_template":true}'::jsonb)
            AND NOT (COALESCE(board.payload, '{}'::jsonb) @> '{"sync_missing_from_procore":true}'::jsonb)
        )
    `,
    companyId,
    dataset
  );
  return seeded;
}

export async function queueEstimatingSyncProjects(
  companyId: string,
  dataset: string,
  bidBoardProjectIds: string[]
) {
  const projectIds = Array.from(new Set(bidBoardProjectIds.map((value) => value.trim()).filter(Boolean)));
  if (!projectIds.length) return 0;

  return prisma.$executeRawUnsafe(
    `
      INSERT INTO procore_sync_project_states (
        company_id, project_id, dataset, project_number, project_name,
        next_run_at, created_at, updated_at
      )
      SELECT
        company_id,
        bid_board_id,
        $2,
        project_number,
        project_name,
        NOW(),
        NOW(),
        NOW()
      FROM pmc_bid_board_projects
      WHERE company_id = $1
        AND bid_board_id = ANY($3::text[])
      ON CONFLICT (company_id, project_id, dataset)
      DO UPDATE SET
        project_number = COALESCE(EXCLUDED.project_number, procore_sync_project_states.project_number),
        project_name = COALESCE(EXCLUDED.project_name, procore_sync_project_states.project_name),
        next_run_at = LEAST(procore_sync_project_states.next_run_at, NOW()),
        updated_at = NOW()
    `,
    companyId,
    dataset,
    projectIds
  );
}

export async function seedSingletonSyncQueue(params: {
  companyId: string;
  dataset: string;
  projectId: string;
  projectName: string;
}) {
  return prisma.$executeRawUnsafe(
    `
      INSERT INTO procore_sync_project_states (
        company_id, project_id, dataset, project_name,
        next_run_at, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, NOW(), NOW(), NOW())
      ON CONFLICT (company_id, project_id, dataset)
      DO UPDATE SET
        project_name = EXCLUDED.project_name,
        updated_at = NOW()
    `,
    params.companyId,
    params.projectId,
    params.dataset,
    params.projectName
  );
}

export async function acquireProcoreWorker(companyId: string, leaseMinutes = 8) {
  const leaseId = randomUUID();
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO procore_sync_controls (company_id, created_at, updated_at)
      VALUES ($1, NOW(), NOW())
      ON CONFLICT (company_id) DO NOTHING
    `,
    companyId
  );

  const rows = await prisma.$queryRawUnsafe<ControlRow[]>(
    `
      UPDATE procore_sync_controls
      SET worker_locked_by = $2,
          worker_locked_until = NOW() + ($3 * INTERVAL '1 minute'),
          updated_at = NOW()
      WHERE company_id = $1
        AND (rate_limit_until IS NULL OR rate_limit_until <= NOW())
        AND (worker_locked_until IS NULL OR worker_locked_until <= NOW())
      RETURNING worker_locked_by, worker_locked_until, rate_limit_until
    `,
    companyId,
    leaseId,
    leaseMinutes
  );

  if (rows.length) return { acquired: true as const, leaseId, control: rows[0] };

  const current = await prisma.$queryRawUnsafe<ControlRow[]>(
    `
      SELECT worker_locked_by, worker_locked_until, rate_limit_until
      FROM procore_sync_controls
      WHERE company_id = $1
    `,
    companyId
  );
  const control = current[0] || null;
  return {
    acquired: false as const,
    leaseId,
    reason: control?.rate_limit_until && control.rate_limit_until > new Date()
      ? "rate_limit_cooldown"
      : "worker_busy",
    control,
  };
}

export async function releaseProcoreWorker(companyId: string, leaseId: string) {
  await prisma.$executeRawUnsafe(
    `
      UPDATE procore_sync_controls
      SET worker_locked_by = NULL,
          worker_locked_until = NULL,
          updated_at = NOW()
      WHERE company_id = $1
        AND worker_locked_by = $2
    `,
    companyId,
    leaseId
  );
}

export async function extendProcoreWorker(companyId: string, leaseId: string, leaseMinutes = 8) {
  await prisma.$executeRawUnsafe(
    `
      UPDATE procore_sync_controls
      SET worker_locked_until = NOW() + ($3 * INTERVAL '1 minute'),
          updated_at = NOW()
      WHERE company_id = $1
        AND worker_locked_by = $2
    `,
    companyId,
    leaseId,
    leaseMinutes
  );
}

export async function claimDueProject(params: {
  companyId: string;
  dataset: string;
  leaseId: string;
  leaseMinutes?: number;
  projectId?: string;
}) {
  const rows = await prisma.$queryRawUnsafe<DbProjectRow[]>(
    `
      WITH candidate AS (
        SELECT id
        FROM procore_sync_project_states
        WHERE company_id = $1
          AND dataset = $2
          AND ($5::text IS NULL OR project_id = $5)
          AND ($5::text IS NOT NULL OR next_run_at <= NOW())
          AND (locked_until IS NULL OR locked_until <= NOW())
        ORDER BY
          CASE WHEN last_success_at IS NULL THEN 0 ELSE 1 END,
          next_run_at,
          project_id
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE procore_sync_project_states s
      SET locked_by = $3,
          locked_until = NOW() + ($4 * INTERVAL '1 minute'),
          last_attempt_at = NOW(),
          updated_at = NOW()
      FROM candidate
      WHERE s.id = candidate.id
      RETURNING s.company_id, s.project_id, s.dataset, s.project_number, s.project_name
    `,
    params.companyId,
    params.dataset,
    params.leaseId,
    params.leaseMinutes ?? 8,
    params.projectId || null
  );
  const row = rows[0];
  if (!row) return null;
  return {
    companyId: row.company_id,
    projectId: row.project_id,
    dataset: row.dataset,
    projectNumber: row.project_number,
    projectName: row.project_name,
    leaseId: params.leaseId,
  } satisfies QueuedProject;
}

export async function finishProjectSync(params: {
  project: QueuedProject;
  success: boolean;
  nextRunMinutes: number;
  error?: string | null;
  result?: unknown;
}) {
  const safeResult = params.result === undefined
    ? null
    : JSON.parse(JSON.stringify(params.result)) as Prisma.InputJsonValue;
  await prisma.$executeRawUnsafe(
    `
      UPDATE procore_sync_project_states
      SET last_success_at = CASE WHEN $5 THEN NOW() ELSE last_success_at END,
          next_run_at = NOW() + ($6 * INTERVAL '1 minute'),
          locked_by = NULL,
          locked_until = NULL,
          failure_count = CASE WHEN $5 THEN 0 ELSE failure_count + 1 END,
          last_error = $7,
          last_result = $8::jsonb,
          updated_at = NOW()
      WHERE company_id = $1
        AND project_id = $2
        AND dataset = $3
        AND locked_by = $4
    `,
    params.project.companyId,
    params.project.projectId,
    params.project.dataset,
    params.project.leaseId,
    params.success,
    params.nextRunMinutes,
    params.error || null,
    safeResult === null ? null : JSON.stringify(safeResult)
  );
}

export async function setProcoreRateLimit(params: {
  companyId: string;
  until: Date;
  error?: string | null;
}) {
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO procore_sync_controls (
        company_id, rate_limit_until, last_429_at, last_error, created_at, updated_at
      ) VALUES ($1, $2, NOW(), $3, NOW(), NOW())
      ON CONFLICT (company_id)
      DO UPDATE SET
        rate_limit_until = GREATEST(
          COALESCE(procore_sync_controls.rate_limit_until, EXCLUDED.rate_limit_until),
          EXCLUDED.rate_limit_until
        ),
        last_429_at = NOW(),
        last_error = EXCLUDED.last_error,
        updated_at = NOW()
    `,
    params.companyId,
    params.until,
    params.error || null
  );
}
