import { prisma } from '@/lib/prisma';
import { shouldFallbackToEmptyRead } from '@/lib/dbResilience';
import { getClientCredentialsToken, makeRequest, procoreConfig } from '@/lib/procore';
import { getInternalVendorSet, isInternalCustomerName, isMeaningfulCustomer } from '@/lib/procoreProjectFeed';
import { upsertGanttScopeToProjectScope } from '@/lib/scheduling/ganttScopeToPrismaScope';

export type GanttV2ProjectRow = {
  id: string;
  jobKey?: string | null;
  projectName: string;
  customer: string | null;
  projectNumber: string | null;
  status: string | null;
  source: string | null;
  sourceCompanyId?: string | null;
  sourceExternalId?: string | null;
  sourceProjectId?: string | null;
  sourceStagingProjectId?: string | null;
  sourceDisplayName?: string | null;
  sourceProjectOwnerType?: string | null;
  sourceProjectOwnerTypeId?: string | null;
  sourceProcoreCreatedAt?: string | null;
  sourceProcoreUpdatedAt?: string | null;
  scopeCount: number;
  scopedHours: number;
  startDate: string | null;
  endDate: string | null;
};

export type GanttV2ScopeRow = {
  id: string;
  projectId: string;
  predecessorScopeId: string | null;
  title: string;
  startDate: string | null;
  endDate: string | null;
  totalHours: number;
  crewSize: number | null;
  notes: string | null;
  tasks?: Array<string | { [key: string]: unknown }>;
  schedulingMode?: 'contiguous' | 'specific-days';
  selectedDays?: Array<{ date: string; hours: number; foreman: string | null }>;
  color?: string; // Hex color code for scope
  taskColors?: Record<string, string>; // Map of task names to color codes
  scheduledHours: number;
  remainingHours: number;
};

export type GanttV2LongTermProjectRow = {
  projectId: string;
  projectName: string;
  customer: string | null;
  projectNumber: string | null;
  status: string | null;
  totalScopeHours: number;
  totalScheduledHours: number;
  totalRemainingHours: number;
  unscheduledHours: number;
  byMonth: Record<string, number>;
};

export type GanttV2LongTermSummary = {
  months: string[];
  projects: GanttV2LongTermProjectRow[];
};

export type GanttV2ProjectWithScopes = {
  id: string;
  jobKey?: string | null;
  projectName: string;
  customer: string | null;
  projectNumber: string | null;
  status: string | null;
  source: string | null;
  sourceCompanyId?: string | null;
  sourceExternalId?: string | null;
  sourceProjectId?: string | null;
  sourceStagingProjectId?: string | null;
  sourceDisplayName?: string | null;
  sourceProjectOwnerType?: string | null;
  sourceProjectOwnerTypeId?: string | null;
  sourceProcoreCreatedAt?: string | null;
  sourceProcoreUpdatedAt?: string | null;
  scopeCount: number;
  scopedHours: number;
  startDate: string | null;
  endDate: string | null;
  scopes: GanttV2ScopeRow[];
  scheduleAllocations: Array<{
    period: string; // "2026-03" for months
    hours: number;
  }>;
};

type ProjectRecord = {
  id: string;
  customer: string | null;
  projectNumber: string | null;
  projectName: string;
};

type ContractRecord = {
  id: string;
  title: string | null;
  number: string | null;
  status: string | null;
  projectId: string | null;
  procoreProjectId: string | null;
};

type LegacyProjectLinkRecord = {
  externalId: string;
  procoreId: string | null;
  customer: string | null;
  projectName: string;
  projectNumber: string | null;
  linkedProjectId: string | null;
};

type StagedProcoreProjectShell = {
  companyId: string;
  externalId: string;
  procoreProjectId: string | null;
  stagingProjectId: string | null;
  displayName: string | null;
  projectOwnerType: string | null;
  projectOwnerTypeId: string | null;
  procoreCreatedAt: Date | null;
  procoreUpdatedAt: Date | null;
  customer: string | null;
  projectNumber: string | null;
  projectName: string;
  status: string | null;
};

type CommercialSource = {
  id: string;
  title: string;
  number: string | null;
};

type EstimateLineItemRecord = {
  bid_board_project_id: string;
  proposal_id: string;
  project_name: string | null;
  customer_name: string | null;
  proposal_name: string | null;
  payload: Record<string, unknown> | null;
  synced_at: Date | string | null;
};

type EstimateGroupRecord = {
  id: string;
  title: string;
};

type EstimateGroupHours = {
  groupId: string;
  title: string;
  hours: number;
};

type GanttProjectsOptions = {
  procoreAccessToken?: string | null;
  procoreCompanyId?: string | null;
  includeEstimateHours?: boolean;
  projectId?: string | null;
};

const formatMonthKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
let ensureGanttV2SchemaPromise: Promise<void> | null = null;

const parseDate = (value: Date | string | null): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
};

const normalizeProjectIdentity = (value: unknown) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const hasMeaningfulProjectNumber = (projectNumber: unknown, projectName: unknown) => {
  const normalizedNumber = normalizeProjectIdentity(projectNumber);
  const normalizedName = normalizeProjectIdentity(projectName);
  return Boolean(normalizedNumber) && normalizedNumber !== normalizedName;
};

const isWeekday = (date: Date) => {
  const day = date.getDay();
  return day >= 1 && day <= 5;
};

const getWorkdayCountPerMonth = (start: Date, end: Date): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    if (!isWeekday(cursor)) continue;
    const key = formatMonthKey(cursor);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
};

export async function ensureGanttV2Schema(): Promise<void> {
  if (!ensureGanttV2SchemaPromise) {
    ensureGanttV2SchemaPromise = (async () => {
      const statements = [
        `
          CREATE TABLE IF NOT EXISTS gantt_v2_projects (
            id TEXT PRIMARY KEY,
            job_key TEXT,
            project_name TEXT NOT NULL,
            customer TEXT,
            project_number TEXT,
            status TEXT,
            source TEXT,
            source_company_id TEXT,
            source_external_id TEXT,
            source_project_id TEXT,
            source_staging_project_id TEXT,
            source_display_name TEXT,
            source_project_owner_type TEXT,
            source_project_owner_type_id TEXT,
            source_procore_created_at TIMESTAMPTZ,
            source_procore_updated_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        `,
        `
          CREATE TABLE IF NOT EXISTS gantt_v2_scopes (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES gantt_v2_projects(id) ON DELETE CASCADE,
            predecessor_scope_id TEXT REFERENCES gantt_v2_scopes(id) ON DELETE SET NULL,
            title TEXT NOT NULL,
            start_date DATE,
            end_date DATE,
            total_hours DOUBLE PRECISION NOT NULL DEFAULT 0,
            crew_size DOUBLE PRECISION,
            notes TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        `,
        `
          CREATE TABLE IF NOT EXISTS gantt_v2_schedule_entries (
            id TEXT PRIMARY KEY,
            scope_id TEXT NOT NULL REFERENCES gantt_v2_scopes(id) ON DELETE CASCADE,
            work_date DATE NOT NULL,
            scheduled_hours DOUBLE PRECISION NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(scope_id, work_date)
          );
        `,
        `ALTER TABLE gantt_v2_scopes ADD COLUMN IF NOT EXISTS predecessor_scope_id TEXT REFERENCES gantt_v2_scopes(id) ON DELETE SET NULL;`,
        `ALTER TABLE gantt_v2_projects ADD COLUMN IF NOT EXISTS job_key TEXT;`,
        `ALTER TABLE gantt_v2_projects ADD COLUMN IF NOT EXISTS source TEXT;`,
        `ALTER TABLE gantt_v2_projects ADD COLUMN IF NOT EXISTS source_company_id TEXT;`,
        `ALTER TABLE gantt_v2_projects ADD COLUMN IF NOT EXISTS source_external_id TEXT;`,
        `ALTER TABLE gantt_v2_projects ADD COLUMN IF NOT EXISTS source_project_id TEXT;`,
        `ALTER TABLE gantt_v2_projects ADD COLUMN IF NOT EXISTS source_staging_project_id TEXT;`,
        `ALTER TABLE gantt_v2_projects ADD COLUMN IF NOT EXISTS source_display_name TEXT;`,
        `ALTER TABLE gantt_v2_projects ADD COLUMN IF NOT EXISTS source_project_owner_type TEXT;`,
        `ALTER TABLE gantt_v2_projects ADD COLUMN IF NOT EXISTS source_project_owner_type_id TEXT;`,
        `ALTER TABLE gantt_v2_projects ADD COLUMN IF NOT EXISTS source_procore_created_at TIMESTAMPTZ;`,
        `ALTER TABLE gantt_v2_projects ADD COLUMN IF NOT EXISTS source_procore_updated_at TIMESTAMPTZ;`,
        `UPDATE gantt_v2_projects SET job_key = CONCAT(COALESCE(customer, ''), '~', COALESCE(project_number, ''), '~', COALESCE(project_name, '')) WHERE COALESCE(NULLIF(TRIM(job_key), ''), NULL) IS NULL;`,
        `UPDATE gantt_v2_projects SET source = CASE WHEN COALESCE(NULLIF(TRIM(source_company_id), ''), NULL) IS NOT NULL AND COALESCE(NULLIF(TRIM(source_external_id), ''), NULL) IS NOT NULL THEN 'procore' ELSE 'app' END WHERE COALESCE(NULLIF(TRIM(source), ''), NULL) IS NULL;`,
        `
          UPDATE gantt_v2_projects p
          SET source_staging_project_id = s.project_id,
              source_display_name = COALESCE(NULLIF(TRIM(s.display_name), ''), p.source_display_name),
              source_project_owner_type = COALESCE(NULLIF(TRIM(s.project_owner_type), ''), p.source_project_owner_type),
              source_project_owner_type_id = COALESCE(NULLIF(TRIM(s.project_owner_type_id), ''), p.source_project_owner_type_id),
              source_procore_created_at = COALESCE(s.procore_created_at, p.source_procore_created_at),
              source_procore_updated_at = COALESCE(s.procore_updated_at, p.source_procore_updated_at),
              source_project_id = COALESCE(NULLIF(TRIM(s.procore_project_id), ''), p.source_project_id)
          FROM procore_project_staging s
          WHERE COALESCE(NULLIF(TRIM(p.source), ''), 'app') = 'procore'
            AND s.source = 'procore_v1_projects'
            AND s.company_id = p.source_company_id
            AND s.external_id = p.source_external_id;
        `,
        `CREATE INDEX IF NOT EXISTS idx_gantt_v2_projects_created_at ON gantt_v2_projects(created_at DESC);`,
        `CREATE INDEX IF NOT EXISTS idx_gantt_v2_projects_status ON gantt_v2_projects(status);`,
        `CREATE INDEX IF NOT EXISTS idx_gantt_v2_projects_source ON gantt_v2_projects(source);`,
        `CREATE INDEX IF NOT EXISTS idx_gantt_v2_projects_source_identity ON gantt_v2_projects(source_company_id, source_external_id);`,
        `CREATE INDEX IF NOT EXISTS idx_gantt_v2_scopes_project_id ON gantt_v2_scopes(project_id);`,
        `CREATE INDEX IF NOT EXISTS idx_gantt_v2_scopes_predecessor_scope_id ON gantt_v2_scopes(predecessor_scope_id);`,
        `CREATE INDEX IF NOT EXISTS idx_gantt_v2_scopes_created_at ON gantt_v2_scopes(created_at ASC);`,
        `CREATE INDEX IF NOT EXISTS idx_gantt_v2_schedule_entries_scope_id ON gantt_v2_schedule_entries(scope_id);`,
        `CREATE INDEX IF NOT EXISTS idx_gantt_v2_schedule_entries_work_date ON gantt_v2_schedule_entries(work_date);`,
      ];

      for (const statement of statements) {
        try {
          await prisma.$executeRawUnsafe(statement);
        } catch (error) {
          if (!shouldFallbackToEmptyRead(error)) {
            throw error;
          }
        }
      }
    })();
  }

  try {
    await ensureGanttV2SchemaPromise;
  } catch (error) {
    ensureGanttV2SchemaPromise = null;
    throw error;
  }
}

export async function syncGanttV2ProjectsFromCanonicalProjects(): Promise<void> {
  try {
    const internalVendorSet = getInternalVendorSet();
    const [stagedProjects, liveBidBoardRows, feedProjects, canonicalProjectRows] = await Promise.all([
      prisma.procoreProjectStaging.findMany({
        where: {
          source: 'procore_v1_projects',
          name: { not: null },
        },
        select: {
          companyId: true,
          externalId: true,
          procoreProjectId: true,
          projectId: true,
          displayName: true,
          projectOwnerType: true,
          projectOwnerTypeId: true,
          createdAt: true,
          updatedAt: true,
          name: true,
          customer: true,
          projectNumber: true,
          bidBoardStatus: true,
          status: true,
        },
        orderBy: [{ name: "asc" }],
      }),
      prisma.$queryRawUnsafe<Array<{
        company_id: string | null;
        procore_project_id: string | null;
        status: string | null;
      }>>(
        `
          SELECT company_id, procore_project_id, status
          FROM procore_bid_board_live
          WHERE company_id IS NOT NULL
            AND procore_project_id IS NOT NULL
        `
      ),
      Promise.resolve([]),
      prisma.project.findMany({
        where: {
          projectArchived: false,
        },
        select: {
          id: true,
          customer: true,
          projectNumber: true,
          projectName: true,
          procoreId: true,
        },
      }),
    ]);

    const bidBoardStatusByProjectKey = new Map(
      liveBidBoardRows
        .filter((row) => String(row.company_id || '').trim() && String(row.procore_project_id || '').trim())
        .map((row) => [
          `${String(row.company_id || '').trim()}~${String(row.procore_project_id || '').trim()}`,
          String(row.status || '').trim() || null,
        ] as const)
    );
    const canonicalProjectById = new Map(canonicalProjectRows.map((project) => [project.id, project]));
    const canonicalProjectByProcoreId = new Map(
      canonicalProjectRows
        .filter((project) => String(project.procoreId || '').trim())
        .map((project) => [String(project.procoreId || '').trim(), project])
    );
    const feedByExternalId = new Map(
      feedProjects
        .filter((project) => String(project.externalId || '').trim())
        .map((project) => [String(project.externalId || '').trim(), project])
    );
    const feedByProcoreId = new Map(
      feedProjects
        .filter((project) => String(project.procoreId || '').trim())
        .map((project) => [String(project.procoreId || '').trim(), project])
    );

    const canonicalProjectEntries = stagedProjects
      .map((project) => {
        const companyId = String(project.companyId || '').trim();
        const externalId = String(project.externalId || '').trim();
        const projectName = String(project.name || '').trim();
        if (!companyId || !externalId || !projectName) return null;

        const procoreProjectId = String(project.procoreProjectId || '').trim() || null;
        const stagingProjectId = String(project.projectId || '').trim() || null;
        const displayName = String(project.displayName || '').trim() || null;
        const projectOwnerType = String(project.projectOwnerType || '').trim() || null;
        const projectOwnerTypeId = String(project.projectOwnerTypeId || '').trim() || null;
        const matchedFeed =
          feedByExternalId.get(externalId) ||
          (procoreProjectId ? feedByProcoreId.get(procoreProjectId) : null) ||
          null;
        const linkedProject =
          (matchedFeed?.linkedProjectId ? canonicalProjectById.get(String(matchedFeed.linkedProjectId || '').trim()) : null) ||
          (procoreProjectId ? canonicalProjectByProcoreId.get(procoreProjectId) : null) ||
          null;
        const bidBoardStatus = String(project.bidBoardStatus || '').trim();
        const fallbackStatus = String(project.status || '').trim();
        const customerCandidates = [
          String(project.customer || '').trim(),
          String(matchedFeed?.customer || '').trim(),
          String(linkedProject?.customer || '').trim(),
        ];
        const customer =
          customerCandidates.find(
            (candidate) =>
              isMeaningfulCustomer(candidate) && !isInternalCustomerName(candidate, internalVendorSet)
          ) || null;
        const resolvedProjectNumber =
          String(project.projectNumber || '').trim() ||
          String(matchedFeed?.projectNumber || '').trim() ||
          String(linkedProject?.projectNumber || '').trim() ||
          null;
        const resolvedProjectName =
          projectName ||
          String(matchedFeed?.projectName || '').trim() ||
          String(linkedProject?.projectName || '').trim();

        return [
          `${companyId}~${externalId}`,
          {
            companyId,
            externalId,
            procoreProjectId,
            stagingProjectId,
            displayName,
            projectOwnerType,
            projectOwnerTypeId,
            procoreCreatedAt: project.createdAt || null,
            procoreUpdatedAt: project.updatedAt || null,
            customer,
            projectNumber: resolvedProjectNumber,
            projectName: resolvedProjectName,
            status: fallbackStatus || null,
          },
        ] as const;
      })
      .filter((entry) => Boolean(entry)) as Array<readonly [string, StagedProcoreProjectShell]>;

    const canonicalProjectsBySource = Array.from(new Map(canonicalProjectEntries).values());
    const canonicalProjectsByName = new Map<string, StagedProcoreProjectShell[]>();

    for (const project of canonicalProjectsBySource) {
      const key = normalizeProjectIdentity(project.projectName);
      const bucket = canonicalProjectsByName.get(key) || [];
      bucket.push(project);
      canonicalProjectsByName.set(key, bucket);
    }

    const canonicalProjects: StagedProcoreProjectShell[] = [];
    for (const group of canonicalProjectsByName.values()) {
      if (group.length <= 1) {
        canonicalProjects.push(...group);
        continue;
      }

      const externalCustomers = new Set(
        group
          .map((project) => String(project.customer || '').trim())
          .filter(
            (customer) =>
              isMeaningfulCustomer(customer) && !isInternalCustomerName(customer, internalVendorSet)
          )
          .map((customer) => normalizeProjectIdentity(customer))
      );

      if (externalCustomers.size > 1) {
        canonicalProjects.push(...group);
        continue;
      }

      const preferredProject = [...group].sort((a, b) => {
        const aHasPreferredCustomer =
          isMeaningfulCustomer(a.customer) && !isInternalCustomerName(a.customer, internalVendorSet) ? 1 : 0;
        const bHasPreferredCustomer =
          isMeaningfulCustomer(b.customer) && !isInternalCustomerName(b.customer, internalVendorSet) ? 1 : 0;
        const aHasMeaningfulNumber = hasMeaningfulProjectNumber(a.projectNumber, a.projectName) ? 1 : 0;
        const bHasMeaningfulNumber = hasMeaningfulProjectNumber(b.projectNumber, b.projectName) ? 1 : 0;

        return (
          bHasPreferredCustomer - aHasPreferredCustomer ||
          bHasMeaningfulNumber - aHasMeaningfulNumber ||
          (b.procoreUpdatedAt?.getTime() || 0) - (a.procoreUpdatedAt?.getTime() || 0) ||
          (b.procoreCreatedAt?.getTime() || 0) - (a.procoreCreatedAt?.getTime() || 0)
        );
      })[0];

      canonicalProjects.push(preferredProject);
    }

    const existingProjects = await prisma.$queryRawUnsafe<Array<{
      id: string;
      customer: string | null;
      project_number: string | null;
      project_name: string;
      status: string | null;
      source: string | null;
      source_company_id: string | null;
      source_external_id: string | null;
      source_project_id: string | null;
      source_staging_project_id: string | null;
      source_display_name: string | null;
      source_project_owner_type: string | null;
      source_project_owner_type_id: string | null;
      source_procore_created_at: Date | null;
      source_procore_updated_at: Date | null;
    }>>(
      `
        SELECT id, customer, project_number, project_name, status, source, source_company_id, source_external_id, source_project_id,
               source_staging_project_id, source_display_name, source_project_owner_type, source_project_owner_type_id,
               source_procore_created_at, source_procore_updated_at
        FROM gantt_v2_projects
      `
    );

    const buildKey = (customer: string | null | undefined, projectNumber: string | null | undefined, projectName: string | null | undefined) =>
      `${String(customer || "").trim()}~${String(projectNumber || "").trim()}~${String(projectName || "").trim()}`;
    const buildSourceKey = (companyId: string | null | undefined, externalId: string | null | undefined) =>
      `${String(companyId || "").trim()}~${String(externalId || "").trim()}`;

    const existingBySourceKey = new Map(
      existingProjects
        .filter((project) => String(project.source_company_id || '').trim() && String(project.source_external_id || '').trim())
        .map((project) => [
          buildSourceKey(project.source_company_id, project.source_external_id),
          project,
        ])
    );
    const existingByKey = new Map(existingProjects.map((project) => [
      buildKey(project.customer, project.project_number, project.project_name),
      project,
    ]));

    for (const project of canonicalProjects) {
      const projectName = String(project.projectName || "").trim();
      if (!projectName) continue;

      const customer = String(project.customer || "").trim() || null;
      const projectNumber = String(project.projectNumber || "").trim() || null;
      const status = String(project.status || "").trim() || null;
      const key = buildKey(customer, projectNumber, projectName);
      const sourceKey = buildSourceKey(project.companyId, project.externalId);
      const existing = existingBySourceKey.get(sourceKey) || existingByKey.get(key);

      if (!existing) {
        await prisma.$executeRawUnsafe(
          `
            INSERT INTO gantt_v2_projects (
              id, project_name, customer, project_number, status, source, source_company_id, source_external_id, source_project_id,
              source_staging_project_id, source_display_name, source_project_owner_type, source_project_owner_type_id,
              source_procore_created_at, source_procore_updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          `,
          crypto.randomUUID(),
          projectName,
          customer,
          projectNumber,
          status,
          'procore',
          project.companyId,
          project.externalId,
          project.procoreProjectId,
          project.stagingProjectId,
          project.displayName,
          project.projectOwnerType,
          project.projectOwnerTypeId,
          project.procoreCreatedAt,
          project.procoreUpdatedAt
        );
        continue;
      }

      const needsUpdate =
        String(existing.customer || "").trim() !== String(customer || "").trim() ||
        String(existing.project_number || "").trim() !== String(projectNumber || "").trim() ||
        String(existing.project_name || "").trim() !== projectName ||
        String(existing.status || "").trim() !== String(status || "").trim() ||
        String(existing.source || '').trim() !== 'procore' ||
        String(existing.source_company_id || '').trim() !== String(project.companyId || '').trim() ||
        String(existing.source_external_id || '').trim() !== String(project.externalId || '').trim() ||
        String(existing.source_project_id || '').trim() !== String(project.procoreProjectId || '').trim() ||
        String(existing.source_staging_project_id || '').trim() !== String(project.stagingProjectId || '').trim() ||
        String(existing.source_display_name || '').trim() !== String(project.displayName || '').trim() ||
        String(existing.source_project_owner_type || '').trim() !== String(project.projectOwnerType || '').trim() ||
        String(existing.source_project_owner_type_id || '').trim() !== String(project.projectOwnerTypeId || '').trim() ||
        (existing.source_procore_created_at?.toISOString() || '') !== (project.procoreCreatedAt?.toISOString() || '') ||
        (existing.source_procore_updated_at?.toISOString() || '') !== (project.procoreUpdatedAt?.toISOString() || '');

      if (!needsUpdate) continue;

      await prisma.$executeRawUnsafe(
        `
          UPDATE gantt_v2_projects
          SET project_name = $2,
              customer = $3,
              project_number = $4,
              status = $5,
              source = $6,
              source_company_id = $7,
              source_external_id = $8,
              source_project_id = $9,
              source_staging_project_id = $10,
              source_display_name = $11,
              source_project_owner_type = $12,
              source_project_owner_type_id = $13,
              source_procore_created_at = $14,
              source_procore_updated_at = $15,
              updated_at = NOW()
          WHERE id = $1
        `,
        existing.id,
        projectName,
        customer,
        projectNumber,
        status,
        'procore',
        project.companyId,
        project.externalId,
        project.procoreProjectId,
        project.stagingProjectId,
        project.displayName,
        project.projectOwnerType,
        project.projectOwnerTypeId,
        project.procoreCreatedAt,
        project.procoreUpdatedAt
      );
    }
  } catch (error) {
    if (shouldFallbackToEmptyRead(error)) {
      return;
    }
    throw error;
  }
}

export async function consolidateDuplicateGanttV2Projects(): Promise<void> {
  try {
    const internalVendorSet = getInternalVendorSet();
    const rows = await prisma.$queryRawUnsafe<Array<{
      id: string;
      job_key: string | null;
      project_name: string;
      customer: string | null;
      project_number: string | null;
      status: string | null;
      source: string | null;
      source_company_id: string | null;
      source_external_id: string | null;
      source_project_id: string | null;
      created_at: Date;
      updated_at: Date;
      scope_count: number;
    }>>(`
      SELECT
        p.id,
        p.job_key,
        p.project_name,
        p.customer,
        p.project_number,
        p.status,
        p.source,
        p.source_company_id,
        p.source_external_id,
        p.source_project_id,
        p.created_at,
        p.updated_at,
        COUNT(s.id)::int AS scope_count
      FROM gantt_v2_projects p
      LEFT JOIN gantt_v2_scopes s ON s.project_id = p.id
      GROUP BY
        p.id,
        p.project_name,
        p.customer,
        p.project_number,
        p.status,
        p.source,
        p.source_company_id,
        p.source_external_id,
        p.source_project_id,
        p.created_at,
        p.updated_at
    `);

    const normalizeIdentity = normalizeProjectIdentity;

    const hasPreferredCustomer = (row: (typeof rows)[number]) =>
      isMeaningfulCustomer(row.customer) && !isInternalCustomerName(row.customer, internalVendorSet);

    const isProcoreRow = (row: (typeof rows)[number]) =>
      String(row.source || '').trim() === 'procore';

    const getSourceIdentity = (row: (typeof rows)[number]) => {
      const companyId = normalizeIdentity(row.source_company_id);
      const externalId = normalizeIdentity(row.source_external_id);
      if (!companyId || !externalId) {
        return null;
      }
      return `${companyId}||${externalId}`;
    };

    const getDisplayIdentity = (row: (typeof rows)[number]) =>
      [
        normalizeIdentity(row.customer),
        normalizeIdentity(row.project_number),
        normalizeIdentity(row.project_name),
      ].join('||');

    const getProjectAnchorIdentity = (row: (typeof rows)[number]) =>
      [
        normalizeIdentity(row.project_number),
        normalizeIdentity(row.project_name),
      ].join('||');

    const getProjectNameIdentity = (row: (typeof rows)[number]) =>
      normalizeIdentity(row.project_name);

    const sortCandidates = (candidates: typeof rows) =>
      [...candidates].sort((a, b) => {
        const aSourced = isProcoreRow(a) ? 1 : 0;
        const bSourced = isProcoreRow(b) ? 1 : 0;
        const aHasSourceIdentity = getSourceIdentity(a) ? 1 : 0;
        const bHasSourceIdentity = getSourceIdentity(b) ? 1 : 0;
        const aHasPreferredCustomer = hasPreferredCustomer(a) ? 1 : 0;
        const bHasPreferredCustomer = hasPreferredCustomer(b) ? 1 : 0;
        const aHasMeaningfulNumber = hasMeaningfulProjectNumber(a.project_number, a.project_name) ? 1 : 0;
        const bHasMeaningfulNumber = hasMeaningfulProjectNumber(b.project_number, b.project_name) ? 1 : 0;

        return (
          bSourced - aSourced ||
          bHasSourceIdentity - aHasSourceIdentity ||
          bHasPreferredCustomer - aHasPreferredCustomer ||
          bHasMeaningfulNumber - aHasMeaningfulNumber ||
          Number(b.scope_count || 0) - Number(a.scope_count || 0) ||
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
      });

    const mergeProjectGroup = async (
      group: typeof rows,
      options?: { allowDistinctProcoreSources?: boolean }
    ) => {
      if (group.length <= 1) return;

      const sourcedRows = group.filter(isProcoreRow);
      const unsourcedRows = group.filter((row) => !isProcoreRow(row));
      const sourcedIdentities = new Set(
        sourcedRows
          .map((row) => getSourceIdentity(row))
          .filter((value): value is string => Boolean(value))
      );

      if (!options?.allowDistinctProcoreSources && sourcedIdentities.size > 1) {
        return;
      }

      const candidates = sourcedRows.length > 0 ? [...sourcedRows, ...unsourcedRows] : [...unsourcedRows];
      if (candidates.length <= 1) return;

      const keeper = sortCandidates(candidates)[0];
      const duplicates = candidates.filter((row) => row.id !== keeper.id);
      if (duplicates.length === 0) return;

      for (const duplicate of duplicates) {
        await prisma.$executeRawUnsafe(
          `
            UPDATE gantt_v2_scopes
            SET project_id = $2,
                updated_at = NOW()
            WHERE project_id = $1
          `,
          duplicate.id,
          keeper.id
        );

        await prisma.$executeRawUnsafe(
          `
            DELETE FROM gantt_v2_projects
            WHERE id = $1
          `,
          duplicate.id
        );
      }

      const keeperScopes = await prisma.$queryRawUnsafe<Array<{
        id: string;
        title: string;
        notes: string | null;
      }>>(
        `
          SELECT id, title, notes
          FROM gantt_v2_scopes
          WHERE project_id = $1
        `,
        keeper.id
      );

      if (keeperScopes.length > 1) {
        const placeholderScopeIds = keeperScopes
          .filter(
            (scope) =>
              String(scope.title || '').trim() === 'Primary Scope' &&
              String(scope.notes || '').trim() === 'Auto-created from schedule allocations'
          )
          .map((scope) => scope.id);

        for (const scopeId of placeholderScopeIds) {
          await prisma.$executeRawUnsafe(
            `
              DELETE FROM gantt_v2_scopes
              WHERE id = $1
            `,
            scopeId
          );
        }
      }
    };

    const sourceIdentityGroups = new Map<string, typeof rows>();
    for (const row of rows) {
      const sourceIdentity = getSourceIdentity(row);
      if (!sourceIdentity) {
        continue;
      }
      const bucket = sourceIdentityGroups.get(sourceIdentity) || [];
      bucket.push(row);
      sourceIdentityGroups.set(sourceIdentity, bucket);
    }

    for (const group of sourceIdentityGroups.values()) {
      await mergeProjectGroup(group);
    }

    const refreshedRows = await prisma.$queryRawUnsafe<typeof rows>(`
      SELECT
        p.id,
        p.project_name,
        p.customer,
        p.project_number,
        p.status,
        p.source,
        p.source_company_id,
        p.source_external_id,
        p.source_project_id,
        p.created_at,
        p.updated_at,
        COUNT(s.id)::int AS scope_count
      FROM gantt_v2_projects p
      LEFT JOIN gantt_v2_scopes s ON s.project_id = p.id
      GROUP BY
        p.id,
        p.project_name,
        p.customer,
        p.project_number,
        p.status,
        p.source,
        p.source_company_id,
        p.source_external_id,
        p.source_project_id,
        p.created_at,
        p.updated_at
    `);

    const sourcedRows = refreshedRows.filter(isProcoreRow);
    const sourcedAnchorGroups = new Map<string, typeof refreshedRows>();
    for (const row of sourcedRows) {
      const key = getProjectAnchorIdentity(row);
      const bucket = sourcedAnchorGroups.get(key) || [];
      bucket.push(row);
      sourcedAnchorGroups.set(key, bucket);
    }

    for (const row of refreshedRows.filter((candidate) => !isProcoreRow(candidate))) {
      const anchorKey = getProjectAnchorIdentity(row);
      const anchorMatches = sourcedAnchorGroups.get(anchorKey) || [];
      if (anchorMatches.length === 1) {
        await mergeProjectGroup([anchorMatches[0], row]);
      }
    }

    const secondPassRows = await prisma.$queryRawUnsafe<typeof rows>(`
      SELECT
        p.id,
        p.project_name,
        p.customer,
        p.project_number,
        p.status,
        p.source,
        p.source_company_id,
        p.source_external_id,
        p.source_project_id,
        p.created_at,
        p.updated_at,
        COUNT(s.id)::int AS scope_count
      FROM gantt_v2_projects p
      LEFT JOIN gantt_v2_scopes s ON s.project_id = p.id
      GROUP BY
        p.id,
        p.project_name,
        p.customer,
        p.project_number,
        p.status,
        p.source,
        p.source_company_id,
        p.source_external_id,
        p.source_project_id,
        p.created_at,
        p.updated_at
    `);

    const sourcedNameGroups = new Map<string, typeof secondPassRows>();
    for (const row of secondPassRows.filter(isProcoreRow)) {
      const key = getProjectNameIdentity(row);
      const bucket = sourcedNameGroups.get(key) || [];
      bucket.push(row);
      sourcedNameGroups.set(key, bucket);
    }

    for (const row of secondPassRows.filter((candidate) => !isProcoreRow(candidate))) {
      if (normalizeIdentity(row.project_number)) {
        continue;
      }
      const nameKey = getProjectNameIdentity(row);
      const nameMatches = sourcedNameGroups.get(nameKey) || [];
      if (nameMatches.length === 1) {
        await mergeProjectGroup([nameMatches[0], row]);
      }
    }

    const finalRows = await prisma.$queryRawUnsafe<typeof rows>(`
      SELECT
        p.id,
        p.project_name,
        p.customer,
        p.project_number,
        p.status,
        p.source,
        p.source_company_id,
        p.source_external_id,
        p.source_project_id,
        p.created_at,
        p.updated_at,
        COUNT(s.id)::int AS scope_count
      FROM gantt_v2_projects p
      LEFT JOIN gantt_v2_scopes s ON s.project_id = p.id
      GROUP BY
        p.id,
        p.project_name,
        p.customer,
        p.project_number,
        p.status,
        p.source,
        p.source_company_id,
        p.source_external_id,
        p.source_project_id,
        p.created_at,
        p.updated_at
    `);

    const displayIdentityGroups = new Map<string, typeof finalRows>();
    for (const row of finalRows) {
      const key = getDisplayIdentity(row);
      const bucket = displayIdentityGroups.get(key) || [];
      bucket.push(row);
      displayIdentityGroups.set(key, bucket);
    }

    for (const group of displayIdentityGroups.values()) {
      await mergeProjectGroup(group);
    }

    const postDisplayRows = await prisma.$queryRawUnsafe<typeof rows>(`
      SELECT
        p.id,
        p.project_name,
        p.customer,
        p.project_number,
        p.status,
        p.source,
        p.source_company_id,
        p.source_external_id,
        p.source_project_id,
        p.created_at,
        p.updated_at,
        COUNT(s.id)::int AS scope_count
      FROM gantt_v2_projects p
      LEFT JOIN gantt_v2_scopes s ON s.project_id = p.id
      GROUP BY
        p.id,
        p.project_name,
        p.customer,
        p.project_number,
        p.status,
        p.source,
        p.source_company_id,
        p.source_external_id,
        p.source_project_id,
        p.created_at,
        p.updated_at
    `);

    const nameGroups = new Map<string, typeof postDisplayRows>();
    for (const row of postDisplayRows) {
      const key = normalizeIdentity(row.project_name);
      const bucket = nameGroups.get(key) || [];
      bucket.push(row);
      nameGroups.set(key, bucket);
    }

    for (const group of nameGroups.values()) {
      if (group.length <= 1) {
        continue;
      }

      const externalCustomers = new Set(
        group
          .map((row) => String(row.customer || '').trim())
          .filter(
            (customer) =>
              isMeaningfulCustomer(customer) && !isInternalCustomerName(customer, internalVendorSet)
          )
          .map((customer) => normalizeIdentity(customer))
      );

      if (externalCustomers.size > 1) {
        continue;
      }

      const sortedGroup = sortCandidates(group);
      const keeper = sortedGroup[0];
      const keeperCustomer = normalizeIdentity(keeper.customer);
      const keeperHasMeaningfulNumber = hasMeaningfulProjectNumber(keeper.project_number, keeper.project_name);
      const mergeableRows = group.filter((row) => {
        if (row.id === keeper.id) {
          return false;
        }

        const rowCustomer = normalizeIdentity(row.customer);
        const rowIsInternalOrEmpty = !rowCustomer || isInternalCustomerName(row.customer, internalVendorSet);
        const sameCustomer = keeperCustomer && rowCustomer === keeperCustomer;
        const weakNumber = !hasMeaningfulProjectNumber(row.project_number, row.project_name);

        return rowIsInternalOrEmpty || (sameCustomer && weakNumber) || (!rowCustomer && keeperHasMeaningfulNumber);
      });

      if (mergeableRows.length > 0) {
        await mergeProjectGroup([keeper, ...mergeableRows], { allowDistinctProcoreSources: true });
      }
    }
  } catch (error) {
    if (shouldFallbackToEmptyRead(error)) {
      return;
    }
    throw error;
  }
}

export async function consolidateDuplicateGanttV2Scopes(): Promise<void> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{
      id: string;
      project_id: string;
      predecessor_scope_id: string | null;
      title: string;
      start_date: Date | null;
      end_date: Date | null;
      total_hours: number;
      crew_size: number | null;
      notes: string | null;
      created_at: Date;
      schedule_entry_count: number;
    }>>(`
      SELECT
        s.id,
        s.project_id,
        s.predecessor_scope_id,
        s.title,
        s.start_date,
        s.end_date,
        s.total_hours,
        s.crew_size,
        s.notes,
        s.created_at,
        COUNT(e.id)::int AS schedule_entry_count
      FROM gantt_v2_scopes s
      LEFT JOIN gantt_v2_schedule_entries e ON e.scope_id = s.id
      GROUP BY
        s.id,
        s.project_id,
        s.predecessor_scope_id,
        s.title,
        s.start_date,
        s.end_date,
        s.total_hours,
        s.crew_size,
        s.notes,
        s.created_at
    `);

    const normalizeText = (value: unknown) => String(value || '').trim();
    const toDateKey = (value: Date | string | null) =>
      value ? new Date(value).toISOString().slice(0, 10) : '';

    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = [
        row.project_id,
        normalizeText(row.predecessor_scope_id),
        normalizeText(row.title),
        toDateKey(row.start_date),
        toDateKey(row.end_date),
        Number(row.total_hours || 0).toFixed(4),
        row.crew_size === null || row.crew_size === undefined ? '' : Number(row.crew_size).toFixed(4),
        normalizeText(row.notes),
      ].join('||');
      const bucket = groups.get(key) || [];
      bucket.push(row);
      groups.set(key, bucket);
    }

    for (const group of groups.values()) {
      if (group.length <= 1) continue;

      const keeper = [...group].sort((a, b) =>
        Number(b.schedule_entry_count || 0) - Number(a.schedule_entry_count || 0) ||
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )[0];

      const duplicates = group.filter((row) => row.id !== keeper.id);
      for (const duplicate of duplicates) {
        await prisma.$executeRawUnsafe(
          `
            UPDATE gantt_v2_scopes
            SET predecessor_scope_id = $2,
                updated_at = NOW()
            WHERE predecessor_scope_id = $1
          `,
          duplicate.id,
          keeper.id
        );

        const duplicateEntries = await prisma.$queryRawUnsafe<Array<{
          work_date: Date;
          scheduled_hours: number;
        }>>(
          `
            SELECT work_date, scheduled_hours
            FROM gantt_v2_schedule_entries
            WHERE scope_id = $1
          `,
          duplicate.id
        );

        for (const entry of duplicateEntries) {
          await prisma.$executeRawUnsafe(
            `
              INSERT INTO gantt_v2_schedule_entries (id, scope_id, work_date, scheduled_hours)
              VALUES ($1, $2, $3, $4)
              ON CONFLICT (scope_id, work_date)
              DO UPDATE
              SET scheduled_hours = EXCLUDED.scheduled_hours,
                  updated_at = NOW()
            `,
            crypto.randomUUID(),
            keeper.id,
            toDateKey(entry.work_date),
            Number(entry.scheduled_hours || 0)
          );
        }

        await prisma.$executeRawUnsafe(
          `
            DELETE FROM gantt_v2_schedule_entries
            WHERE scope_id = $1
          `,
          duplicate.id
        );

        await prisma.$executeRawUnsafe(
          `
            DELETE FROM gantt_v2_scopes
            WHERE id = $1
          `,
          duplicate.id
        );
      }
    }
  } catch (error) {
    if (shouldFallbackToEmptyRead(error)) {
      return;
    }
    throw error;
  }
}

export async function getGanttV2Projects(projectId?: string | null): Promise<GanttV2ProjectRow[]> {
  try {
    const normalizedProjectId = String(projectId || '').trim();
    const rows = await prisma.$queryRawUnsafe<Array<{
      id: string;
      job_key: string | null;
      project_name: string;
      customer: string | null;
      project_number: string | null;
      status: string | null;
      source: string | null;
      source_company_id: string | null;
      source_external_id: string | null;
      source_project_id: string | null;
      source_staging_project_id: string | null;
      source_display_name: string | null;
      source_project_owner_type: string | null;
      source_project_owner_type_id: string | null;
      source_procore_created_at: Date | null;
      source_procore_updated_at: Date | null;
      scope_count: number;
      scoped_hours: number;
      start_date: Date | null;
      end_date: Date | null;
    }>>(
      `
      SELECT
        p.id,
        p.job_key,
        p.project_name,
        p.customer,
        p.project_number,
        p.status,
        p.source,
        p.source_company_id,
        p.source_external_id,
        p.source_project_id,
        p.source_staging_project_id,
        p.source_display_name,
        p.source_project_owner_type,
        p.source_project_owner_type_id,
        p.source_procore_created_at,
        p.source_procore_updated_at,
        COUNT(s.id)::int AS scope_count,
        COALESCE(SUM(s.total_hours), 0)::float8 AS scoped_hours,
        MIN(s.start_date) AS start_date,
        MAX(s.end_date) AS end_date
      FROM gantt_v2_projects p
      LEFT JOIN gantt_v2_scopes s ON s.project_id = p.id
      ${normalizedProjectId ? 'WHERE p.id = $1' : ''}
      GROUP BY p.id, p.project_name, p.customer, p.project_number, p.status, p.source,
               p.job_key,
               p.source_company_id, p.source_external_id, p.source_project_id, p.source_staging_project_id,
               p.source_display_name, p.source_project_owner_type, p.source_project_owner_type_id,
               p.source_procore_created_at, p.source_procore_updated_at
      ORDER BY p.created_at DESC;
    `,
      ...(normalizedProjectId ? [normalizedProjectId] : [])
    );

    return rows.map((row) => ({
      id: row.id,
      jobKey: row.job_key,
      projectName: row.project_name,
      customer: row.customer,
      projectNumber: row.project_number,
      status: row.status,
      source: row.source,
      sourceCompanyId: row.source_company_id,
      sourceExternalId: row.source_external_id,
      sourceProjectId: row.source_project_id,
      sourceStagingProjectId: row.source_staging_project_id,
      sourceDisplayName: row.source_display_name,
      sourceProjectOwnerType: row.source_project_owner_type,
      sourceProjectOwnerTypeId: row.source_project_owner_type_id,
      sourceProcoreCreatedAt: row.source_procore_created_at ? row.source_procore_created_at.toISOString() : null,
      sourceProcoreUpdatedAt: row.source_procore_updated_at ? row.source_procore_updated_at.toISOString() : null,
      scopeCount: Number(row.scope_count || 0),
      scopedHours: Number(row.scoped_hours || 0),
      startDate: row.start_date ? row.start_date.toISOString().split('T')[0] : null,
      endDate: row.end_date ? row.end_date.toISOString().split('T')[0] : null,
    }));
  } catch (error) {
    if (shouldFallbackToEmptyRead(error)) {
      return [];
    }
    throw error;
  }
}

export async function getGanttV2ProjectsWithScopes(options: GanttProjectsOptions = {}): Promise<GanttV2ProjectWithScopes[]> {
  const includeEstimateHours = options.includeEstimateHours === true;
  const targetProjectId = String(options.projectId || '').trim() || null;
  const normalizeIdentity = (value: string | null | undefined) =>
    (value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  const makeIdentity = (customer: string | null | undefined, projectName: string | null | undefined) =>
    `${normalizeIdentity(customer)}||${normalizeIdentity(projectName)}`;

  const isGiantProjectName = (projectName: string | null | undefined) =>
    normalizeIdentity(projectName).includes('giant');

  const alphaCore = (value: unknown) =>
    String(value || '')
      .toLowerCase()
      .replace(/\b\d+(?:[.,]\d+)?\b/g, ' ')
      .replace(/\b(?:sq|sf|lf|ln|ft|inch|in|x|co|no|billing|file|budgeted|non|help|and|with)\b/g, ' ')
      .replace(/[^a-z]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const normalizeToken = (value: string) => {
    let token = value.trim().toLowerCase();
    if (!token) return '';

    if (token === 'sog') {
      return 'slab';
    }

    if (token.endsWith('ies') && token.length > 4) {
      token = `${token.slice(0, -3)}y`;
    } else if (token.endsWith('ed') && token.length > 5) {
      token = token.slice(0, -2);
    } else if (token.endsWith('s') && token.length > 4) {
      token = token.slice(0, -1);
    }
    return token;
  };

  const tokenize = (value: unknown) =>
    new Set(
      alphaCore(value)
        .split(' ')
        .map((token) => normalizeToken(token))
        .filter((token) => token.length >= 3)
    );

  const anchorTokens = new Set([
    'sidewalk',
    'footer',
    'footing',
    'foundation',
    'slab',
    'paver',
    'porch',
    'curb',
    'wall',
    'pier',
    'bollard',
    'stair',
    'step',
    'deck',
    'ramp',
    'pit',
    'apron',
  ]);

  const extractNumericTokens = (value: unknown) =>
    new Set(
      Array.from(String(value || '').matchAll(/\d+(?:[.,]\d+)?/g)).map((match) =>
        String(match[0] || '').replace(/[.,]/g, '')
      )
    );

  const compareTitles = (scopeTitle: string, candidateTitle: string): number => {
    const scopeNorm = normalizeIdentity(scopeTitle);
    const candidateNorm = normalizeIdentity(candidateTitle);
    if (!scopeNorm || !candidateNorm) return 0;
    if (scopeNorm === candidateNorm) return 100;

    const scopeCore = alphaCore(scopeTitle);
    const candidateCore = alphaCore(candidateTitle);
    if (scopeCore && candidateCore && scopeCore === candidateCore) return 90;
    if (scopeCore && candidateCore && (scopeCore.includes(candidateCore) || candidateCore.includes(scopeCore))) {
      return 75;
    }

    const scopeTokens = tokenize(scopeTitle);
    const candidateTokens = tokenize(candidateTitle);
    if (scopeTokens.size === 0 || candidateTokens.size === 0) return 0;
    const scopeNumbers = extractNumericTokens(scopeTitle);
    const candidateNumbers = extractNumericTokens(candidateTitle);

    let overlap = 0;
    const sharedTokens: string[] = [];
    for (const token of scopeTokens) {
      if (candidateTokens.has(token)) {
        overlap += 1;
        sharedTokens.push(token);
      }
    }
    if (overlap === 0) return 0;

    const sharedNumberCount = Array.from(scopeNumbers).filter((token) => candidateNumbers.has(token)).length;
    const hasSharedAnchor = sharedTokens.some((token) => anchorTokens.has(token));

    if (scopeNumbers.size > 0 && candidateNumbers.size > 0 && sharedNumberCount === 0 && hasSharedAnchor && overlap <= 1) {
      return 0;
    }

    const jaccard = overlap / new Set([...scopeTokens, ...candidateTokens]).size;
    if (overlap >= 2 || jaccard >= 0.5) {
      const boosted = Math.round(55 + jaccard * 20 + sharedNumberCount * 10);
      return Math.min(boosted, 98);
    }

    if (sharedTokens.some((token) => anchorTokens.has(token))) {
      return Math.min(50 + sharedNumberCount * 10, 70);
    }

    return 0;
  };

  const resolveContractIdentity = (
    row: ContractRecord,
    projectById: Map<string, ProjectRecord>,
    feedByExternalId: Map<string, LegacyProjectLinkRecord>,
    feedByProcoreId: Map<string, LegacyProjectLinkRecord>
  ) => {
    const directProject = row.projectId ? projectById.get(row.projectId) : null;
    const externalFeed = row.procoreProjectId ? feedByExternalId.get(row.procoreProjectId) : null;
    const procoreFeed = row.procoreProjectId ? feedByProcoreId.get(row.procoreProjectId) : null;
    const feed = externalFeed || procoreFeed || null;
    const linkedProject = feed?.linkedProjectId ? projectById.get(feed.linkedProjectId) : null;

    return makeIdentity(
      directProject?.customer || linkedProject?.customer || feed?.customer,
      directProject?.projectName || linkedProject?.projectName || feed?.projectName
    );
  };

  const isIgnorableCommercialTitle = (value: string) => {
    const normalized = normalizeIdentity(value);
    if (!normalized) return true;
    return normalized.includes('billing file');
  };

  const normalizeLegacyTasks = (value: unknown): Array<string | { [key: string]: unknown }> => {
    if (!Array.isArray(value)) return [];

    return value
      .map((entry) => {
        if (typeof entry === 'string') {
          const trimmed = entry.trim();
          return trimmed ? trimmed : null;
        }

        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          return null;
        }

        const row = entry as Record<string, unknown>;
        const name = String(row.name || '').trim();
        if (!name) return null;

        return row;
      })
      .filter((entry): entry is string | { [key: string]: unknown } => Boolean(entry));
  };

  const asObject = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

  const asArray = (value: unknown): unknown[] => {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'object') return [];

    const record = value as Record<string, unknown>;
    const candidates = [record.data, record.line_item_groups, record.groups];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) return candidate;
    }
    return [];
  };

  const toNumber = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const getEstimateUomFromPayload = (payload: Record<string, unknown> | null | undefined) => {
    const record = payload || {};
    const costItem = asObject(record.cost_item);
    return String(costItem?.unit || record.type || '')
      .trim()
      .toUpperCase();
  };

  const getLaborHoursFromPayload = (payload: Record<string, unknown> | null | undefined) => {
    const record = payload || {};
    const count = toNumber(record.count);
    const uom = getEstimateUomFromPayload(record);

    if (count <= 0) return 0;
    if (!['HOUR', 'HOURS', 'HR', 'HRS'].includes(uom)) return 0;

    return count;
  };

  const normalizeGroupRecord = (value: unknown): EstimateGroupRecord | null => {
    const record = asObject(value);
    if (!record) return null;
    const id = String(record.id || record.group_id || '').trim();
    const title = String(record.name || record.title || record.description || '').trim();
    if (!id || !title) return null;
    return { id, title };
  };

  const getEstimateAccessToken = async () => {
    const directToken = String(options.procoreAccessToken || '').trim();
    if (directToken) return directToken;

    if (procoreConfig.clientId && procoreConfig.clientSecret) {
      try {
        return await getClientCredentialsToken();
      } catch (error) {
        console.warn('Unable to get client-credentials token for estimate group fetch:', error);
      }
    }

    return '';
  };

  const fetchEstimateGroups = async (params: {
    accessToken: string;
    companyId: string;
    bidBoardProjectId: string;
    proposalId: string;
  }): Promise<EstimateGroupRecord[]> => {
    const { accessToken, companyId, bidBoardProjectId, proposalId } = params;
    const groups: EstimateGroupRecord[] = [];
    let page = 1;
    const perPage = 200;

    while (true) {
      const payload = await makeRequest(
        `/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/bid_board_projects/${encodeURIComponent(
          bidBoardProjectId
        )}/proposals/${encodeURIComponent(proposalId)}/line_item_groups?page=${page}&per_page=${perPage}`,
        accessToken,
        { method: 'GET' },
        companyId,
        [404]
      );

      const pageItems = asArray(payload).map(normalizeGroupRecord).filter((row): row is EstimateGroupRecord => Boolean(row));
      if (pageItems.length === 0) break;
      groups.push(...pageItems);
      if (pageItems.length < perPage) break;
      page += 1;
    }

    return groups;
  };

  const toSqlDate = (value: unknown): string | null => {
    if (!value) return null;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const parsed = new Date(trimmed);
      if (Number.isNaN(parsed.getTime())) return null;
      return parsed.toISOString().slice(0, 10);
    }
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return null;
      return value.toISOString().slice(0, 10);
    }
    return null;
  };

  // First get all projects with summary info
  const projects = await getGanttV2Projects(targetProjectId);
  const [projectRecords, purchaseOrderContracts, commitmentContracts, legacyProjectLinks] = await Promise.all([
    prisma.project.findMany({
      select: {
        id: true,
        customer: true,
        projectNumber: true,
        projectName: true,
      },
    }) as Promise<ProjectRecord[]>,
    prisma.purchaseOrderContract.findMany({
      select: {
        id: true,
        title: true,
        number: true,
        status: true,
        projectId: true,
        procoreProjectId: true,
      },
    }) as Promise<ContractRecord[]>,
    prisma.commitmentContract.findMany({
      select: {
        id: true,
        title: true,
        number: true,
        status: true,
        projectId: true,
        procoreProjectId: true,
      },
    }) as Promise<ContractRecord[]>,
    Promise.resolve([] as LegacyProjectLinkRecord[]),
  ]);

  const projectById = new Map(projectRecords.map((project) => [project.id, project]));
  const feedByExternalId = new Map(
    legacyProjectLinks.filter((row) => row.externalId).map((row) => [row.externalId, row])
  );
  const feedByProcoreId = new Map(
    legacyProjectLinks.filter((row) => row.procoreId).map((row) => [row.procoreId as string, row])
  );

  const poTitlesByIdentity = new Map<string, CommercialSource[]>();
  for (const row of purchaseOrderContracts) {
    const title = String(row.title || '').trim();
    if (!title || isIgnorableCommercialTitle(title)) continue;
    const identity = resolveContractIdentity(row, projectById, feedByExternalId, feedByProcoreId);
    if (!identity || identity === '||') continue;
    const bucket = poTitlesByIdentity.get(identity) || [];
    bucket.push({
      id: row.id,
      title,
      number: row.number,
    });
    poTitlesByIdentity.set(identity, bucket);
  }
  for (const [identity, rows] of poTitlesByIdentity.entries()) {
    rows.sort((a, b) => String(a.number || '').localeCompare(String(b.number || '')) || a.title.localeCompare(b.title));
    poTitlesByIdentity.set(identity, rows);
  }

  const commitmentTitlesByIdentity = new Map<string, CommercialSource[]>();
  for (const row of commitmentContracts) {
    const title = String(row.title || '').trim();
    if (!title || isIgnorableCommercialTitle(title)) continue;
    const identity = resolveContractIdentity(row, projectById, feedByExternalId, feedByProcoreId);
    if (!identity || identity === '||') continue;
    const bucket = commitmentTitlesByIdentity.get(identity) || [];
    bucket.push({
      id: row.id,
      title,
      number: row.number,
    });
    commitmentTitlesByIdentity.set(identity, bucket);
  }
  for (const [identity, rows] of commitmentTitlesByIdentity.entries()) {
    rows.sort((a, b) => String(a.number || '').localeCompare(String(b.number || '')) || a.title.localeCompare(b.title));
    commitmentTitlesByIdentity.set(identity, rows);
  }

  const giantIdentityKeys = new Set(
    projects
      .filter((project) => isGiantProjectName(project.projectName))
      .map((project) => makeIdentity(project.customer, project.projectName))
      .filter((identity) => identity && identity !== '||')
  );

  // Legacy scope/task fallback is reserved for Giant projects only.
  let legacyScopes: Array<{
    id: string;
    jobKey: string;
    title: string;
    startDate: string | null;
    endDate: string | null;
    manpower: number | null;
    hours: number | null;
    description: string | null;
    tasks?: unknown;
    schedulingMode?: string | null;
    selectedDays?: unknown;
    updatedAt?: Date | null;
  }> = [];
  try {
    legacyScopes = await prisma.projectScope.findMany({
      select: {
        id: true,
        jobKey: true,
        title: true,
        startDate: true,
        endDate: true,
        manpower: true,
        hours: true,
        description: true,
        tasks: true,
        schedulingMode: true,
        selectedDays: true,
        updatedAt: true,
      },
    });
  } catch (projectScopeError) {
    console.warn('Unable to load legacy project scopes with tasks, retrying minimal scope fields:', projectScopeError);
    try {
      legacyScopes = await prisma.projectScope.findMany({
        select: {
          id: true,
          jobKey: true,
          title: true,
          startDate: true,
          endDate: true,
          manpower: true,
          hours: true,
          description: true,
          updatedAt: true,
        },
      });
    } catch (fallbackProjectScopeError) {
      console.warn('Skipping legacy project scope hydration:', fallbackProjectScopeError);
      legacyScopes = [];
    }
  }

  const legacyScopesByIdentity = new Map<string, typeof legacyScopes>();
  const legacyScopesByJobKey = new Map<string, typeof legacyScopes>();
  const projectScopeMetadataByIdentity = new Map<string, typeof legacyScopes>();
  for (const scope of legacyScopes) {
    const exactJobKey = String(scope.jobKey || '').trim();
    if (exactJobKey) {
      const byJobKeyRows = legacyScopesByJobKey.get(exactJobKey) || [];
      byJobKeyRows.push(scope);
      legacyScopesByJobKey.set(exactJobKey, byJobKeyRows);
    }

    const [customer = '', , projectName = ''] = String(scope.jobKey || '').split('~');
    const key = `${normalizeIdentity(customer)}||${normalizeIdentity(projectName)}`;
    if (!key || key === '||') continue;

    const metadataRows = projectScopeMetadataByIdentity.get(key) || [];
    metadataRows.push(scope);
    projectScopeMetadataByIdentity.set(key, metadataRows);

    if (!giantIdentityKeys.has(key)) continue;
    const rows = legacyScopesByIdentity.get(key) || [];
    rows.push(scope);
    legacyScopesByIdentity.set(key, rows);
  }

  for (const [key, rows] of projectScopeMetadataByIdentity.entries()) {
    projectScopeMetadataByIdentity.set(
      key,
      [...rows].sort((a, b) => {
        const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        return bTime - aTime;
      })
    );
  }

  const nonProtectedIdentityKeys = new Set(
    projects
      .map((project) => makeIdentity(project.customer, project.projectName))
      .filter((identity) => identity && identity !== '||' && !giantIdentityKeys.has(identity))
  );

  const estimateHoursByIdentity = new Map<string, EstimateGroupHours[]>();
  if (includeEstimateHours) {
    const estimateRows = await prisma.$queryRawUnsafe<EstimateLineItemRecord[]>(`
      SELECT
        bid_board_project_id,
        proposal_id,
        project_name,
        customer_name,
        proposal_name,
        payload,
        synced_at
      FROM procore_proposal_line_items_live
    `);

    const estimateRowsByIdentity = new Map<string, EstimateLineItemRecord[]>();
    for (const row of estimateRows) {
      const identity = makeIdentity(row.customer_name, row.project_name);
      if (!identity || identity === '||' || !nonProtectedIdentityKeys.has(identity)) continue;
      const bucket = estimateRowsByIdentity.get(identity) || [];
      bucket.push(row);
      estimateRowsByIdentity.set(identity, bucket);
    }

    const estimateAccessToken = await getEstimateAccessToken();
    const estimateCompanyId = String(options.procoreCompanyId || procoreConfig.companyId || '').trim();

    if (estimateAccessToken && estimateCompanyId) {
      const proposalSelections = Array.from(estimateRowsByIdentity.entries())
        .map(([identity, rows]) => {
          const proposalGroups = new Map<
            string,
            {
              bidBoardProjectId: string;
              proposalId: string;
              proposalName: string;
              lineItemCount: number;
              latestSyncedAt: number;
              rows: EstimateLineItemRecord[];
            }
          >();

          for (const row of rows) {
            const key = `${row.bid_board_project_id}||${row.proposal_id}`;
            const existing = proposalGroups.get(key) || {
              bidBoardProjectId: row.bid_board_project_id,
              proposalId: row.proposal_id,
              proposalName: String(row.proposal_name || '').trim(),
              lineItemCount: 0,
              latestSyncedAt: 0,
              rows: [],
            };
            existing.lineItemCount += 1;
            existing.latestSyncedAt = Math.max(
              existing.latestSyncedAt,
              row.synced_at ? new Date(row.synced_at).getTime() : 0
            );
            existing.rows.push(row);
            proposalGroups.set(key, existing);
          }

          const selected = Array.from(proposalGroups.values()).sort((a, b) => {
            const aOriginal = normalizeIdentity(a.proposalName) === 'original estimate' ? 1 : 0;
            const bOriginal = normalizeIdentity(b.proposalName) === 'original estimate' ? 1 : 0;
            return bOriginal - aOriginal || b.lineItemCount - a.lineItemCount || b.latestSyncedAt - a.latestSyncedAt;
          })[0];

          if (!selected) return null;
          return { identity, selected };
        })
        .filter((row): row is { identity: string; selected: { bidBoardProjectId: string; proposalId: string; proposalName: string; lineItemCount: number; latestSyncedAt: number; rows: EstimateLineItemRecord[] } } => Boolean(row));

      await Promise.all(
        proposalSelections.map(async ({ identity, selected }) => {
          try {
            const groups = await fetchEstimateGroups({
              accessToken: estimateAccessToken,
              companyId: estimateCompanyId,
              bidBoardProjectId: selected.bidBoardProjectId,
              proposalId: selected.proposalId,
            });
            const titleByGroupId = new Map(groups.map((group) => [group.id, group.title]));
            const hoursByGroupId = new Map<string, number>();

            for (const row of selected.rows) {
              const payload = asObject(row.payload);
              const groupId = String(payload?.group_id || '').trim();
              if (!groupId) continue;
              const laborHours = getLaborHoursFromPayload(payload);
              if (laborHours <= 0) continue;
              hoursByGroupId.set(groupId, (hoursByGroupId.get(groupId) || 0) + laborHours);
            }

            const normalized = Array.from(hoursByGroupId.entries())
              .map(([groupId, hours]) => ({
                groupId,
                title: String(titleByGroupId.get(groupId) || '').trim(),
                hours,
              }))
              .filter((row) => row.title && row.hours > 0);

            estimateHoursByIdentity.set(identity, normalized);
          } catch (error) {
            console.warn('Unable to fetch estimate group titles for project identity:', identity, error);
          }
        })
      );
    }
  }
  
  // Fetch all scopes in a single query instead of N individual queries (N+1 optimization)
  const projectIds = projects.map((p) => p.id);
  const scopesByProjectId = await getGanttV2ScopesForProjects(projectIds);
  
  // For each project, process its scopes and schedule allocations
  const projectsWithScopes: GanttV2ProjectWithScopes[] = await Promise.all(
    projects.map(async (project) => {
      let scopes = scopesByProjectId.get(project.id) || [];

      const projectIdentityKey = `${normalizeIdentity(project.customer)}||${normalizeIdentity(project.projectName)}`;
      const projectJobKey = String(project.jobKey || `${String(project.customer || '').trim()}~${String(project.projectNumber || '').trim()}~${String(project.projectName || '').trim()}`).trim();
      const legacyForProject = legacyScopesByIdentity.get(projectIdentityKey) || [];
      const legacyForProjectByJobKey = legacyScopesByJobKey.get(projectJobKey) || [];
      const isProtectedLegacyProject = giantIdentityKeys.has(projectIdentityKey);
      const canonicalCommercialTitles = (() => {
        const poTitles = poTitlesByIdentity.get(projectIdentityKey) || [];
        if (poTitles.length > 0) return poTitles;
        return commitmentTitlesByIdentity.get(projectIdentityKey) || [];
      })();
      const estimateGroupHours = estimateHoursByIdentity.get(projectIdentityKey) || [];

      if (isProtectedLegacyProject && legacyForProject.length > 0) {
        const existingTitles = new Set(scopes.map((scope) => normalizeIdentity(scope.title)));
        let insertedLegacyScope = false;

        for (const legacyScope of legacyForProject) {
          const legacyTitle = (legacyScope.title || '').toString().trim();
          if (!legacyTitle) continue;
          if (existingTitles.has(normalizeIdentity(legacyTitle))) continue;

          const legacyScopeId = crypto.randomUUID();
          const legacyScopeStartDate = toSqlDate(legacyScope.startDate);
          const legacyScopeEndDate = toSqlDate(legacyScope.endDate);
          const legacyScopeHours = Number(legacyScope.hours || 0);
          const legacyScopeCrewSize = legacyScope.manpower === null || legacyScope.manpower === undefined ? null : Number(legacyScope.manpower);
          const legacyScopeNotes = (legacyScope.description || '').toString().trim() || 'Migrated from legacy projectScope';

          await prisma.$executeRawUnsafe(
            `
              INSERT INTO gantt_v2_scopes (id, project_id, title, start_date, end_date, total_hours, crew_size, notes)
              VALUES ($1, $2, $3, CAST($4 AS date), CAST($5 AS date), $6, $7, $8)
            `,
            legacyScopeId,
            project.id,
            legacyTitle,
            legacyScopeStartDate,
            legacyScopeEndDate,
            legacyScopeHours,
            legacyScopeCrewSize,
            legacyScopeNotes
          );
          await upsertGanttScopeToProjectScope({
            ganttV2ScopeId: legacyScopeId,
            projectId: project.id,
            title: legacyTitle,
            startDate: legacyScopeStartDate,
            endDate: legacyScopeEndDate,
            totalHours: legacyScopeHours,
            crewSize: legacyScopeCrewSize,
            notes: legacyScopeNotes,
            predecessorScopeId: null,
          });

          existingTitles.add(normalizeIdentity(legacyTitle));
          insertedLegacyScope = true;
        }

        if (insertedLegacyScope) {
          // Refetch this project's scopes after inserting legacy scope
          scopes = await getGanttV2Scopes(project.id);
        }
      }

      const scheduleOrFilters: Array<{
        projectId?: string;
        projectNumber?: string;
        projectName?: string;
      }> = [{ projectId: project.id }];

      if (project.projectNumber) {
        scheduleOrFilters.push({ projectNumber: project.projectNumber });
      }
      if (project.projectName) {
        scheduleOrFilters.push({ projectName: project.projectName });
      }

      type ScheduleWithAllocations = {
        jobKey?: string | null;
        projectId?: string | null;
        customer?: string | null;
        projectNumber?: string | null;
        projectName?: string | null;
        totalHours: number | null;
        allocationsList: Array<{ period: string; hours: number | null }>;
      };

      let schedules: ScheduleWithAllocations[] = [];
      try {
        schedules = await prisma.schedule.findMany({
          where: { OR: scheduleOrFilters },
          include: {
            allocationsList: {
              where: { periodType: 'month' },
              select: { period: true, hours: true },
            },
          },
        });
      } catch (scheduleError) {
        console.warn('Unable to load schedule allocations for Gantt V2 project, retrying without allocations:', {
          projectId: project.id,
          projectName: project.projectName,
          error: scheduleError,
        });

        try {
          const fallbackSchedules = await prisma.schedule.findMany({
            where: { OR: scheduleOrFilters },
            select: {
              totalHours: true,
            },
          });

          schedules = fallbackSchedules.map((schedule) => ({
            totalHours: schedule.totalHours,
            allocationsList: [],
          }));
        } catch (fallbackScheduleError) {
          console.warn('Skipping schedule hydration for Gantt V2 project:', {
            projectId: project.id,
            projectName: project.projectName,
            error: fallbackScheduleError,
          });
          schedules = [];
        }
      }

      const normalizeScheduleField = (value: unknown) =>
        String(value || '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .trim();

      const normalizedProjectId = String(project.id || '').trim();
      const normalizedProjectNumber = normalizeScheduleField(project.projectNumber);
      const normalizedProjectCustomer = normalizeScheduleField(project.customer);
      const normalizedProjectName = normalizeScheduleField(project.projectName);

      const exactProjectIdSchedules = schedules.filter(
        (schedule) => String(schedule.projectId || '').trim() === normalizedProjectId
      );

      const exactProjectNumberSchedules =
        exactProjectIdSchedules.length === 0 && normalizedProjectNumber
          ? schedules.filter((schedule) => {
              const scheduleProjectNumber = normalizeScheduleField(schedule.projectNumber);
              const scheduleProjectName = normalizeScheduleField(schedule.projectName);
              return (
                scheduleProjectNumber === normalizedProjectNumber &&
                (!normalizedProjectName || !scheduleProjectName || scheduleProjectName === normalizedProjectName)
              );
            })
          : [];

      const exactCustomerNameSchedules =
        exactProjectIdSchedules.length === 0 && exactProjectNumberSchedules.length === 0
          ? schedules.filter((schedule) => {
              const scheduleCustomer = normalizeScheduleField(schedule.customer);
              const scheduleProjectName = normalizeScheduleField(schedule.projectName);
              return (
                scheduleCustomer === normalizedProjectCustomer &&
                scheduleProjectName === normalizedProjectName
              );
            })
          : [];

      schedules =
        exactProjectIdSchedules.length > 0
          ? exactProjectIdSchedules
          : exactProjectNumberSchedules.length > 0
            ? exactProjectNumberSchedules
            : exactCustomerNameSchedules.length > 0
              ? exactCustomerNameSchedules
              : schedules;

      const allocationsByPeriod = new Map<string, number>();
      for (const schedule of schedules) {
        for (const allocation of schedule.allocationsList) {
          allocationsByPeriod.set(
            allocation.period,
            (allocationsByPeriod.get(allocation.period) || 0) + Number(allocation.hours || 0)
          );
        }
      }

      const scheduleAllocations = Array.from(allocationsByPeriod.entries())
        .map(([period, hours]) => ({ period, hours }))
        .sort((a, b) => a.period.localeCompare(b.period));

      const scheduleTotalHours = schedules.reduce(
        (sum, schedule) => sum + Number(schedule.totalHours || 0),
        0
      );

      const allocationTotalHours = scheduleAllocations.reduce(
        (sum, allocation) => sum + Number(allocation.hours || 0),
        0
      );

      const effectiveScopedHours =
        project.scopedHours > 0
          ? project.scopedHours
          : scheduleTotalHours > 0
            ? scheduleTotalHours
            : allocationTotalHours;

      // If there is exactly one existing scope with no budgeted hours,
      // hydrate it from schedule totals so cards/modals don't show 0.0h.
      if (
        scopes.length === 1 &&
        Number(scopes[0]?.totalHours || 0) <= 0 &&
        effectiveScopedHours > 0
      ) {
        await prisma.$executeRawUnsafe(
          `
            UPDATE gantt_v2_scopes
            SET total_hours = $1,
                updated_at = NOW()
            WHERE id = $2
          `,
          effectiveScopedHours,
          scopes[0].id
        );
        await upsertGanttScopeToProjectScope({
          ganttV2ScopeId: scopes[0].id,
          projectId: project.id,
          title: scopes[0].title,
          startDate: scopes[0].startDate,
          endDate: scopes[0].endDate,
          totalHours: effectiveScopedHours,
          crewSize: scopes[0].crewSize,
          notes: scopes[0].notes,
          predecessorScopeId: scopes[0].predecessorScopeId,
        });

        scopes = await getGanttV2Scopes(project.id);
      }

      // Enforce invariant: if a project has planned hours, it must have at least one scope.
      if (scopes.length === 0 && effectiveScopedHours > 0) {
        const defaultScopeId = crypto.randomUUID();
        await prisma.$executeRawUnsafe(
          `
            INSERT INTO gantt_v2_scopes (id, project_id, title, start_date, end_date, total_hours, crew_size, notes)
            VALUES ($1, $2, $3, NULL, NULL, $4, NULL, $5)
          `,
          defaultScopeId,
          project.id,
          'Primary Scope',
          effectiveScopedHours,
          'Auto-created from schedule allocations'
        );
        await upsertGanttScopeToProjectScope({
          ganttV2ScopeId: defaultScopeId,
          projectId: project.id,
          title: 'Primary Scope',
          startDate: null,
          endDate: null,
          totalHours: effectiveScopedHours,
          crewSize: null,
          notes: 'Auto-created from schedule allocations',
          predecessorScopeId: null,
        });

        scopes = await getGanttV2Scopes(project.id);
      }

      const normalizeTitle = (value: string | null | undefined) =>
        normalizeIdentity(value || '');

      const projectScopeMetadata = projectScopeMetadataByIdentity.get(projectIdentityKey) || [];
      const normalizeSelectedDays = (value: unknown) => {
        if (!Array.isArray(value)) return [];
        return value
          .map((entry) => {
            const record = asObject(entry);
            if (!record) return null;
            const date = String(record.date || '').trim();
            const hours = Number(record.hours || 0);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(hours) || hours <= 0) {
              return null;
            }
            return {
              date,
              hours,
              foreman: record.foreman ? String(record.foreman) : null,
            };
          })
          .filter((entry): entry is { date: string; hours: number; foreman: string | null } => Boolean(entry));
      };

      const findMetadataOverride = (title: string, members: GanttV2ScopeRow[] = []) => {
        if (projectScopeMetadata.length === 0) return null;
        const titleKey = normalizeTitle(title);
        const memberTitleKeys = new Set(members.map((member) => normalizeTitle(member.title)).filter(Boolean));

        const exactMatches = projectScopeMetadata.filter((scope) => normalizeTitle(scope.title) === titleKey);
        if (exactMatches.length > 0) return exactMatches[0];

        const memberMatches = projectScopeMetadata.filter((scope) => memberTitleKeys.has(normalizeTitle(scope.title)));
        if (memberMatches.length > 0) return memberMatches[0];

        const scoredMatches = projectScopeMetadata
          .map((scope) => ({
            scope,
            score: Math.max(
              compareTitles(String(scope.title || ''), title),
              ...members.map((member) => compareTitles(String(scope.title || ''), member.title))
            ),
          }))
          .filter((entry) => entry.score >= 75)
          .sort((a, b) => b.score - a.score);

        return scoredMatches[0]?.scope || null;
      };

      const applyMetadataOverride = (scope: GanttV2ScopeRow, metadata: (typeof legacyScopes)[number] | null): GanttV2ScopeRow => {
        if (!metadata) return scope;

        const selectedDays = normalizeSelectedDays(metadata.selectedDays);
        const schedulingMode = metadata.schedulingMode === 'specific-days' ? 'specific-days' : 'contiguous';
        // Phase 4: scope.totalHours/startDate/endDate/crewSize are authoritative (from gantt-linked
        // ProjectScope). Only fall back to metadata values when the scope fields are unset.
        const totalHours = Number(scope.totalHours || 0) > 0 ? Number(scope.totalHours || 0) : Number(metadata.hours || 0);
        const startDate = scope.startDate || toSqlDate(metadata.startDate);
        const endDate = scope.endDate || toSqlDate(metadata.endDate);
        const hasSchedule = schedulingMode === 'specific-days'
          ? selectedDays.length > 0
          : Boolean(startDate && endDate);
        const scheduledHours = hasSchedule ? Number(scope.scheduledHours || 0) : 0;

        return {
          ...scope,
          title: String(metadata.title || scope.title || '').trim() || scope.title,
          startDate,
          endDate,
          totalHours,
          crewSize:
            scope.crewSize !== null && scope.crewSize !== undefined
              ? scope.crewSize
              : (metadata.manpower === null || metadata.manpower === undefined ? null : Number(metadata.manpower)),
          notes: metadata.description || scope.notes,
          tasks: normalizeLegacyTasks(metadata.tasks),
          schedulingMode,
          selectedDays,
          scheduledHours,
          remainingHours: hasSchedule ? Math.max(totalHours - scheduledHours, 0) : totalHours,
        };
      };

      const scopesWithTasks = scopes.map((scope) => {
        const candidateLegacyScopes =
          legacyForProjectByJobKey.length > 0
            ? legacyForProjectByJobKey
            : (isProtectedLegacyProject ? legacyForProject : []);

        if (candidateLegacyScopes.length === 0) {
          const baseScope = {
            ...scope,
            tasks: [],
          };
          return applyMetadataOverride(baseScope, findMetadataOverride(scope.title));
        }

        const scopeStart = toSqlDate(scope.startDate);
        const scopeEnd = toSqlDate(scope.endDate);

        const exactMatch = candidateLegacyScopes.find((legacyScope) =>
          normalizeTitle(legacyScope.title) === normalizeTitle(scope.title) &&
          toSqlDate(legacyScope.startDate) === scopeStart &&
          toSqlDate(legacyScope.endDate) === scopeEnd
        );

        const titleOnlyMatch = !exactMatch
          ? candidateLegacyScopes.find(
              (legacyScope) => normalizeTitle(legacyScope.title) === normalizeTitle(scope.title)
            )
          : null;

        const matchedLegacy = exactMatch || titleOnlyMatch;
        const tasks = matchedLegacy ? normalizeLegacyTasks(matchedLegacy.tasks) : [];

        const baseScope = {
          ...scope,
          tasks,
        };
        return applyMetadataOverride(baseScope, findMetadataOverride(scope.title));
      });

      const canonicalScopes =
        !isProtectedLegacyProject && canonicalCommercialTitles.length > 0
          ? (() => {
              const groups = new Map<
                string,
                {
                  source: CommercialSource;
                  members: typeof scopesWithTasks;
                }
              >();
              const unmatchedScopes: typeof scopesWithTasks = [];
              const isGeneratedMappedRollupScope = (scope: (typeof scopesWithTasks)[number]) =>
                String(scope.notes || '').trim().toLowerCase().startsWith('mapped from:');

              for (const scope of scopesWithTasks) {
                if (isGeneratedMappedRollupScope(scope)) {
                  continue;
                }

                let bestSource: CommercialSource | null = null;
                let bestScore = 0;

                for (const source of canonicalCommercialTitles) {
                  const score = compareTitles(scope.title, source.title);
                  if (score > bestScore) {
                    bestScore = score;
                    bestSource = source;
                  }
                }

                if (!bestSource || bestScore <= 0) {
                  unmatchedScopes.push(scope);
                  continue;
                }

                const bucket = groups.get(bestSource.id) || { source: bestSource, members: [] };
                bucket.members.push(scope);
                groups.set(bestSource.id, bucket);
              }

              const merged = canonicalCommercialTitles
                .map((source) => {
                  const group = groups.get(source.id);
                  const members = group?.members || [];
                  const datedMembers = members.filter((scope) => scope.startDate || scope.endDate);
                  const startDates = datedMembers
                    .map((scope) => scope.startDate)
                    .filter((value): value is string => Boolean(value))
                    .sort();
                  const endDates = datedMembers
                    .map((scope) => scope.endDate)
                    .filter((value): value is string => Boolean(value))
                    .sort();

                  const totalHours = members.reduce((sum, scope) => sum + Number(scope.totalHours || 0), 0);
                  const scheduledHours = members.reduce((sum, scope) => sum + Number(scope.scheduledHours || 0), 0);
                  const remainingHours = members.reduce((sum, scope) => sum + Number(scope.remainingHours || 0), 0);
                  const crewSizes = members
                    .map((scope) => scope.crewSize)
                    .filter((value): value is number => value !== null && value !== undefined);
                  const sourceNotes = members
                    .map((scope) => String(scope.title || '').trim())
                    .filter(Boolean);
                  const metadataOverride = findMetadataOverride(source.title, members);

                  const mergedScope = {
                    id: source.id,
                    projectId: project.id,
                    predecessorScopeId: null,
                    title: source.title,
                    startDate: startDates[0] || null,
                    endDate: endDates[endDates.length - 1] || null,
                    totalHours,
                    crewSize: crewSizes.length > 0 ? Math.max(...crewSizes) : null,
                    notes:
                      sourceNotes.length > 0
                        ? sourceNotes.some((title) => normalizeIdentity(title) !== normalizeIdentity(source.title))
                          ? `Mapped from: ${sourceNotes.join(' | ')}`
                          : null
                        : 'No matched scope hours yet',
                    scheduledHours,
                    remainingHours,
                    tasks: [],
                  } satisfies GanttV2ScopeRow;

                  return applyMetadataOverride(mergedScope, metadataOverride);
                })
                .filter(Boolean) as GanttV2ScopeRow[];

              if (merged.length === 0) {
                return unmatchedScopes;
              }

              // Keep raw scopes that do not map cleanly to a canonical commercial title.
              // Canonical scopes should clarify grouping, not hide real project scopes.
              return [...merged, ...unmatchedScopes];
            })()
          : scopesWithTasks;

      const displayScopes = isProtectedLegacyProject || !includeEstimateHours
        ? canonicalScopes
        : canonicalScopes.map((scope) => {
            const bestEstimate = estimateGroupHours
              .map((group) => ({
                ...group,
                score: compareTitles(scope.title, group.title),
              }))
              .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))[0];

            const estimateHours = bestEstimate && bestEstimate.score > 0 ? Number(bestEstimate.hours || 0) : 0;

            return {
              ...scope,
              totalHours: estimateHours,
              scheduledHours: 0,
              remainingHours: estimateHours,
              notes:
                estimateHours > 0
                  ? `Estimate hours from: ${bestEstimate.title}`
                  : scope.notes,
            };
          });
      
      return {
        ...project,
        jobKey: String(project.jobKey || '').trim() || `${String(project.customer || '').trim()}~${String(project.projectNumber || '').trim()}~${String(project.projectName || '').trim()}`,
        scopeCount: displayScopes.length,
        scopedHours: isProtectedLegacyProject ? effectiveScopedHours : displayScopes.reduce((sum, scope) => sum + Number(scope.totalHours || 0), 0),
        scopes: displayScopes,
        scheduleAllocations,
      };
    })
  );

  return projectsWithScopes;
}

/**
 * Fetch scopes for a single project (used for individual project scope loads)
 */
export async function getGanttV2Scopes(projectId: string): Promise<GanttV2ScopeRow[]> {
  // Phase 4: prefer canonical scope data from ProjectScope, but anchor on gantt_v2_scopes
  // so every existing Gantt scope remains visible even when link backfill is incomplete.
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    project_id: string;
    predecessor_scope_id: string | null;
    title: string;
    start_date: Date | null;
    end_date: Date | null;
    total_hours: number;
    crew_size: number | null;
    notes: string | null;
    scheduled_hours: number;
  }>>(
    `
      SELECT
        gs.id,
        gs.project_id,
        COALESCE(ps.predecessor_scope_id, gs.predecessor_scope_id) AS predecessor_scope_id,
        COALESCE(ps.title, gs.title) AS title,
        COALESCE(ps.start_date, gs.start_date) AS start_date,
        COALESCE(ps.end_date, gs.end_date) AS end_date,
        COALESCE(ps.total_hours, gs.total_hours, 0) AS total_hours,
        COALESCE(ps.crew_size, gs.crew_size) AS crew_size,
        COALESCE(ps.notes, gs.notes) AS notes,
        CASE
          WHEN COALESCE(ps.start_date, gs.start_date) IS NULL
            OR COALESCE(ps.end_date, gs.end_date) IS NULL
            OR COALESCE(ps.total_hours, gs.total_hours, 0) <= 0
            THEN 0
          ELSE COALESCE((
            SELECT SUM(e.scheduled_hours)
            FROM gantt_v2_schedule_entries e
            WHERE e.scope_id = gs.id
          ), 0)
        END::float8 AS scheduled_hours
      FROM gantt_v2_scopes gs
      JOIN gantt_v2_projects gp ON gp.id = gs.project_id
      LEFT JOIN LATERAL (
        SELECT
          ps."predecessorScopeId" AS predecessor_scope_id,
          ps.title,
          NULLIF(ps."startDate", '')::date AS start_date,
          NULLIF(ps."endDate", '')::date AS end_date,
          ps.hours AS total_hours,
          ps.manpower AS crew_size,
          ps.notes
        FROM "ProjectScope" ps
        WHERE
          ps."ganttV2ScopeId" = gs.id
          OR (
            ps."ganttV2ScopeId" IS NULL
            AND ps."jobKey" = (COALESCE(gp.customer, '') || '~' || COALESCE(gp.project_number, '') || '~' || COALESCE(gp.project_name, ''))
            AND LOWER(ps.title) = LOWER(gs.title)
          )
        ORDER BY
          CASE WHEN ps."ganttV2ScopeId" = gs.id THEN 0 ELSE 1 END,
          ps."updatedAt" DESC
        LIMIT 1
      ) ps ON TRUE
      WHERE gs.project_id = $1
      ORDER BY gs.created_at ASC;
    `,
    projectId
  );

  return rows.map((row) => {
    const totalHours = Number(row.total_hours || 0);
    const scheduledHours = Number(row.scheduled_hours || 0);
    return {
      id: row.id,
      projectId: row.project_id,
      predecessorScopeId: row.predecessor_scope_id,
      title: row.title,
      startDate: row.start_date ? row.start_date.toISOString().split('T')[0] : null,
      endDate: row.end_date ? row.end_date.toISOString().split('T')[0] : null,
      totalHours,
      crewSize: row.crew_size === null ? null : Number(row.crew_size),
      notes: row.notes,
      scheduledHours,
      remainingHours: Math.max(totalHours - scheduledHours, 0),
    };
  });
}

/**
 * Fetch scopes for multiple projects in a single query (replaces N+1 loop pattern)
 */
export async function getGanttV2ScopesForProjects(
  projectIds: string[]
): Promise<Map<string, GanttV2ScopeRow[]>> {
  if (projectIds.length === 0) {
    return new Map();
  }

  // Phase 4: prefer ProjectScope metadata while preserving visibility of all gantt_v2_scopes.
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    project_id: string;
    predecessor_scope_id: string | null;
    title: string;
    start_date: Date | null;
    end_date: Date | null;
    total_hours: number;
    crew_size: number | null;
    notes: string | null;
    scheduled_hours: number;
  }>>(
    `
      SELECT
        gs.id,
        gs.project_id,
        COALESCE(ps.predecessor_scope_id, gs.predecessor_scope_id) AS predecessor_scope_id,
        COALESCE(ps.title, gs.title) AS title,
        COALESCE(ps.start_date, gs.start_date) AS start_date,
        COALESCE(ps.end_date, gs.end_date) AS end_date,
        COALESCE(ps.total_hours, gs.total_hours, 0) AS total_hours,
        COALESCE(ps.crew_size, gs.crew_size) AS crew_size,
        COALESCE(ps.notes, gs.notes) AS notes,
        CASE
          WHEN COALESCE(ps.start_date, gs.start_date) IS NULL
            OR COALESCE(ps.end_date, gs.end_date) IS NULL
            OR COALESCE(ps.total_hours, gs.total_hours, 0) <= 0
            THEN 0
          ELSE COALESCE((
            SELECT SUM(e.scheduled_hours)
            FROM gantt_v2_schedule_entries e
            WHERE e.scope_id = gs.id
          ), 0)
        END::float8 AS scheduled_hours
      FROM gantt_v2_scopes gs
      JOIN gantt_v2_projects gp ON gp.id = gs.project_id
      LEFT JOIN LATERAL (
        SELECT
          ps."predecessorScopeId" AS predecessor_scope_id,
          ps.title,
          NULLIF(ps."startDate", '')::date AS start_date,
          NULLIF(ps."endDate", '')::date AS end_date,
          ps.hours AS total_hours,
          ps.manpower AS crew_size,
          ps.notes
        FROM "ProjectScope" ps
        WHERE
          ps."ganttV2ScopeId" = gs.id
          OR (
            ps."ganttV2ScopeId" IS NULL
            AND ps."jobKey" = (COALESCE(gp.customer, '') || '~' || COALESCE(gp.project_number, '') || '~' || COALESCE(gp.project_name, ''))
            AND LOWER(ps.title) = LOWER(gs.title)
          )
        ORDER BY
          CASE WHEN ps."ganttV2ScopeId" = gs.id THEN 0 ELSE 1 END,
          ps."updatedAt" DESC
        LIMIT 1
      ) ps ON TRUE
      WHERE gs.project_id = ANY($1::text[])
      ORDER BY gs.created_at ASC;
    `,
    projectIds
  );

  const scopesByProjectId = new Map<string, GanttV2ScopeRow[]>();
  for (const row of rows) {
    const totalHours = Number(row.total_hours || 0);
    const scheduledHours = Number(row.scheduled_hours || 0);
    const scope: GanttV2ScopeRow = {
      id: row.id,
      projectId: row.project_id,
      predecessorScopeId: row.predecessor_scope_id,
      title: row.title,
      startDate: row.start_date ? row.start_date.toISOString().split('T')[0] : null,
      endDate: row.end_date ? row.end_date.toISOString().split('T')[0] : null,
      totalHours,
      crewSize: row.crew_size === null ? null : Number(row.crew_size),
      notes: row.notes,
      scheduledHours,
      remainingHours: Math.max(totalHours - scheduledHours, 0),
    };
    if (!scopesByProjectId.has(row.project_id)) {
      scopesByProjectId.set(row.project_id, []);
    }
    scopesByProjectId.get(row.project_id)!.push(scope);
  }

  return scopesByProjectId;
}

export async function getGanttV2LongTermSummary(startMonth?: string, months = 15): Promise<GanttV2LongTermSummary> {
  const base = startMonth && /^\d{4}-\d{2}$/.test(startMonth)
    ? new Date(`${startMonth}-01T00:00:00`)
    : new Date();
  base.setDate(1);
  base.setHours(0, 0, 0, 0);

  const monthKeys: string[] = [];
  for (let i = 0; i < months; i++) {
    monthKeys.push(formatMonthKey(new Date(base.getFullYear(), base.getMonth() + i, 1)));
  }

  const rows = await prisma.$queryRawUnsafe<Array<{
    project_id: string;
    project_name: string;
    customer: string | null;
    project_number: string | null;
    status: string | null;
    scope_id: string;
    total_hours: number;
    start_date: Date | null;
    end_date: Date | null;
    scheduled_hours: number;
  }>>(`
    SELECT
      p.id AS project_id,
      p.project_name,
      p.customer,
      p.project_number,
      p.status,
      gs.id AS scope_id,
      COALESCE(ps.hours, gs.total_hours, 0) AS total_hours,
      COALESCE(NULLIF(ps."startDate", ''), gs.start_date::text)::date AS start_date,
      COALESCE(NULLIF(ps."endDate",   ''), gs.end_date::text)::date   AS end_date,
      COALESCE(SUM(e.scheduled_hours), 0)::float8 AS scheduled_hours
    FROM gantt_v2_projects p
    JOIN gantt_v2_scopes gs ON gs.project_id = p.id
    LEFT JOIN "ProjectScope" ps ON ps."ganttV2ScopeId" = gs.id
    LEFT JOIN gantt_v2_schedule_entries e ON e.scope_id = gs.id
    WHERE p.status = 'In Progress'
    GROUP BY p.id, p.project_name, p.customer, p.project_number, p.status, gs.id, ps.id
    ORDER BY p.project_name ASC;
  `);

  const projectMap = new Map<string, GanttV2LongTermProjectRow>();

  for (const row of rows) {
    if (!projectMap.has(row.project_id)) {
      projectMap.set(row.project_id, {
        projectId: row.project_id,
        projectName: row.project_name,
        customer: row.customer,
        projectNumber: row.project_number,
        status: row.status,
        totalScopeHours: 0,
        totalScheduledHours: 0,
        totalRemainingHours: 0,
        unscheduledHours: 0,
        byMonth: Object.fromEntries(monthKeys.map((key) => [key, 0])),
      });
    }

    const project = projectMap.get(row.project_id)!;
    const totalHours = Number(row.total_hours || 0);
    const scheduledHours = Number(row.scheduled_hours || 0);
    const remainingHours = Math.max(totalHours - scheduledHours, 0);

    project.totalScopeHours += totalHours;
    project.totalScheduledHours += scheduledHours;
    project.totalRemainingHours += remainingHours;

    const start = parseDate(row.start_date);
    const end = parseDate(row.end_date);

    if (!start || !end || end < start || totalHours <= 0) {
      project.unscheduledHours += totalHours;
      continue;
    }

    const workdaysByMonth = getWorkdayCountPerMonth(start, end);
    const totalWorkdays = Array.from(workdaysByMonth.values()).reduce((sum, count) => sum + count, 0);
    if (totalWorkdays <= 0) {
      project.unscheduledHours += totalHours;
      continue;
    }

    let distributed = 0;
    const keysInRange = Array.from(workdaysByMonth.keys()).filter((key) => monthKeys.includes(key));
    keysInRange.forEach((key, index) => {
      const share = (totalHours * (workdaysByMonth.get(key) || 0)) / totalWorkdays;
      const value = index === keysInRange.length - 1 ? totalHours - distributed : share;
      distributed += value;
      project.byMonth[key] = (project.byMonth[key] || 0) + value;
    });
  }

  return {
    months: monthKeys,
    projects: Array.from(projectMap.values()),
  };
}

/**
 * Sync activeSchedule hours to gantt_v2_schedule_entries for a given scope
 * This aggregates daily hours from activeSchedule and populates gantt_v2_schedule_entries
 */
export async function syncActiveScheduleToScope(
  scopeId: string,
  jobKey: string,
  scopeTitle?: string
): Promise<number> {
  // Find activeSchedule entries for this jobKey and aggregate by date
  // Only sync entries from Gantt (source: 'gantt'), exclude custom scopes (source: 'wip-page')
  const activeScheduleHours = await prisma.activeSchedule.findMany({
    where: {
      jobKey,
      ...(scopeTitle ? { scopeOfWork: scopeTitle.trim() } : {}),
      source: 'gantt',
    },
  });

  if (!activeScheduleHours || activeScheduleHours.length === 0) {
    // No active schedule entries, clear any existing entries for this scope
    await prisma.$executeRawUnsafe(`
      DELETE FROM gantt_v2_schedule_entries
      WHERE scope_id = $1
    `, scopeId);
    return 0;
  }

  // Aggregate by date
  const hoursByDate = new Map<string, number>();
  for (const entry of activeScheduleHours) {
    const date = entry.date; // Already in YYYY-MM-DD format
    const hours = Number(entry.hours || 0);
    hoursByDate.set(date, (hoursByDate.get(date) || 0) + hours);
  }

  // Clear existing entries for this scope
  await prisma.$executeRawUnsafe(`
    DELETE FROM gantt_v2_schedule_entries
    WHERE scope_id = $1
  `, scopeId);

  // Insert new entries from activeSchedule data
  let totalHours = 0;
  for (const [workDate, hours] of hoursByDate.entries()) {
    totalHours += hours;
    const id = crypto.randomUUID();
    
    await prisma.$executeRawUnsafe(`
      INSERT INTO gantt_v2_schedule_entries (id, scope_id, work_date, scheduled_hours)
      VALUES ($1, $2, $3::date, $4)
    `, id, scopeId, workDate, hours);
  }

  return totalHours;
}
