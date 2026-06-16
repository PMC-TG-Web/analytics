import { prisma } from '@/lib/prisma';
import { logAuditEvent } from '@/lib/auditLog';
import { getCanonicalProjectCustomFields, getCanonicalProjectIdentity } from '@/lib/projectCanonical';
import { getErrorMessage, shouldFallbackToEmptyRead } from '@/lib/dbResilience';
import { buildSearchParamsCacheKey, getCachedValue, invalidateCacheByPrefix, setCachedValue } from '@/lib/serverReadCache';
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

const PROJECTS_CACHE_PREFIX = 'projects:';
const PROJECTS_CACHE_TTL_MS = 30 * 1000;

function normalizeForPmc(value: unknown) {
  return (value ?? '').toString().trim().replace(/^"+|"+$/g, '').trim().toLowerCase();
}

function choosePrimaryGroup(groupTotals: Record<string, number>) {
  const entries = Object.entries(groupTotals);
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

function keyFromProjectIdentity(projectNumber: unknown, projectName: unknown) {
  const num = (projectNumber ?? '').toString().trim().toLowerCase();
  const name = (projectName ?? '').toString().trim().toLowerCase();
  return `${num}__${name}`;
}

function mapPmcProjectToLegacyShape(project: {
  companyId: string;
  procoreProjectId: string;
  bidBoardId: string | null;
  projectNumber: string | null;
  projectName: string;
  customer: string | null;
  status: string | null;
  bidBoardStatus: string | null;
  projectManager: string | null;
  estimator: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  syncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: project.procoreProjectId,
    companyId: project.companyId,
    procoreId: project.procoreProjectId,
    procoreProjectId: project.procoreProjectId,
    bidBoardId: project.bidBoardId,
    projectNumber: project.projectNumber,
    projectName: project.projectName,
    customer: project.customer,
    status: project.status,
    bidBoardStatus: project.bidBoardStatus,
    projectManager: project.projectManager,
    estimator: project.estimator,
    address: project.address,
    city: project.city,
    state: project.state,
    zip: project.zip,
    projectArchived: false,
    customerSource: 'pmc_projects',
    statusSource: 'pmc_projects',
    customFields: {
      source: 'pmc_projects',
      procoreId: project.procoreProjectId,
      bidBoardId: project.bidBoardId,
    },
    syncedAt: project.syncedAt,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const cacheKey = buildSearchParamsCacheKey(`${PROJECTS_CACHE_PREFIX}get`, searchParams);
    const cached = getCachedValue<Record<string, unknown>>(cacheKey);
    if (cached) {
      const response = NextResponse.json(cached);
      response.headers.set('Cache-Control', 'private, max-age=30, must-revalidate');
      response.headers.set('X-Cache', 'HIT');
      return response;
    }

    const summaryOnly = (searchParams.get('summary') || '').trim().toLowerCase() === 'true';
    
    // Support both OFFSET-based (for backwards compat) and cursor-based pagination
    const cursor = (searchParams.get('cursor') || '').trim() || null;
    const useCursorPagination = cursor !== null;
    
    // Legacy OFFSET pagination support (for backwards compatibility)
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const requestedPageSize = Number.parseInt(searchParams.get('pageSize') || '100', 10) || 100;
    const pageSize = Math.min(500, Math.max(1, requestedPageSize));
    const skip = useCursorPagination ? undefined : (page - 1) * pageSize;
    const includeTotal = (searchParams.get('includeTotal') || '').trim().toLowerCase() === 'true';
    const customer = (searchParams.get('customer') || '').trim();
    const projectNumber = (searchParams.get('projectNumber') || '').trim();
    const projectName = (searchParams.get('projectName') || '').trim();
    const statusesParam = (searchParams.get('statuses') || searchParams.get('filters[by_status]') || '').trim();
    const includeArchived = (searchParams.get('includeArchived') || '').trim().toLowerCase() === 'true';
    const endpointOnly = (searchParams.get('endpointOnly') || '').trim().toLowerCase() === 'true';
    const readSource = (searchParams.get('source') || searchParams.get('readSource') || '').trim().toLowerCase();
    const usePmcProjects = readSource === 'pmc' || readSource === 'pmc_projects';

    const statusList = statusesParam && statusesParam.toLowerCase() !== 'all'
      ? statusesParam.split(',').map((value) => value.trim()).filter((value) => value.length > 0)
      : [];

    if (usePmcProjects) {
      const pmcWhere: Prisma.PmcProjectWhereInput = {};

      if (statusList.length > 0) {
        pmcWhere.status = { in: statusList };
      }

      if (customer) {
        pmcWhere.customer = customer;
      }

      if (projectNumber) {
        pmcWhere.projectNumber = projectNumber;
      }

      if (projectName) {
        pmcWhere.projectName = projectName;
      }

      if (endpointOnly) {
        pmcWhere.procoreProjectId = { not: '' };
      }

      if (useCursorPagination && cursor) {
        pmcWhere.procoreProjectId = {
          ...(typeof pmcWhere.procoreProjectId === 'object' && pmcWhere.procoreProjectId ? pmcWhere.procoreProjectId : {}),
          gt: cursor,
        };
      }

      const queryWhere = Object.keys(pmcWhere).length > 0 ? pmcWhere : undefined;
      const orderBy = useCursorPagination
        ? ({ procoreProjectId: 'asc' } as const)
        : ({ projectName: 'asc' } as const);

      let total: number | undefined;
      const rows = includeTotal
        ? await (async () => {
            const [countValue, pageRows] = await Promise.all([
              queryWhere ? prisma.pmcProject.count({ where: queryWhere }) : prisma.pmcProject.count(),
              queryWhere
                ? prisma.pmcProject.findMany({ where: queryWhere, orderBy, skip, take: pageSize })
                : prisma.pmcProject.findMany({ orderBy, skip, take: pageSize }),
            ]);
            total = countValue;
            return pageRows;
          })()
        : await (queryWhere
            ? prisma.pmcProject.findMany({ where: queryWhere, orderBy, skip, take: pageSize + 1 })
            : prisma.pmcProject.findMany({ orderBy, skip, take: pageSize + 1 }));

      const hasNextPage = includeTotal && typeof total === 'number'
        ? (useCursorPagination ? rows.length === pageSize : skip! + rows.length < total)
        : rows.length > pageSize;

      const pageRows = includeTotal ? rows : rows.slice(0, pageSize);
      const data = pageRows.map(mapPmcProjectToLegacyShape);
      const totalPages = includeTotal && typeof total === 'number'
        ? Math.max(1, Math.ceil(total / pageSize))
        : (hasNextPage ? page + 1 : page);
      const nextCursor = useCursorPagination && data.length > 0
        ? data[data.length - 1]?.procoreProjectId
        : undefined;

      const response: Record<string, any> = {
        success: true,
        source: 'pmc_projects',
        count: data.length,
        ...(typeof total === 'number' ? { total } : {}),
        ...(useCursorPagination ? {} : { page, pageSize, totalPages, hasPreviousPage: page > 1 }),
        hasNextPage,
        ...(useCursorPagination && nextCursor ? { nextCursor } : {}),
        data,
      };

      setCachedValue(cacheKey, response, PROJECTS_CACHE_TTL_MS);
      const jsonResponse = NextResponse.json(response);
      jsonResponse.headers.set('Cache-Control', 'private, max-age=30, must-revalidate');
      jsonResponse.headers.set('X-Cache', 'MISS');
      return jsonResponse;
    }

    const where: Prisma.ProjectWhereInput = {};

    if (!includeArchived) {
      where.projectArchived = {
        not: true,
      };
    }

    // Remove status filters to ensure Procore items appear
    /*
    if (mode !== 'dashboard' && statusList.length === 0) {
      where.status = {
        notIn: ['Bid Submitted', 'Lost'],
      };
    }
    */

    if (statusList.length > 0) {
      where.status = {
        in: statusList,
      };
    }

    if (customer) {
      where.customer = customer;
    }

    if (projectNumber) {
      where.projectNumber = projectNumber;
    }

    if (projectName) {
      where.projectName = projectName;
    }

    // Restrict to records that were synced from live endpoints.
    // Current canonical signal is a non-empty Procore project id.
    if (endpointOnly) {
      where.procoreId = {
        not: null,
      };
    }

    // Cursor-based pagination: filter WHERE id > cursor
    if (useCursorPagination && cursor) {
      where.id = {
        gt: cursor,
      };
    }

    const queryWhere = Object.keys(where).length > 0 ? where : undefined;
    const legacyWhere: Prisma.ProjectWhereInput = {};
    if (statusList.length > 0) legacyWhere.status = { in: statusList };
    if (customer) legacyWhere.customer = customer;
    if (projectNumber) legacyWhere.projectNumber = projectNumber;
    if (projectName) legacyWhere.projectName = projectName;
    if (endpointOnly) legacyWhere.procoreId = { not: null };
    // Cursor for legacy as well
    if (useCursorPagination && cursor) {
      legacyWhere.id = { gt: cursor };
    }
    const legacyQueryWhere = Object.keys(legacyWhere).length > 0 ? legacyWhere : undefined;

    let total: number | undefined;
    let hasNextPage = false;
    let projects: Record<string, unknown>[];
    const summarySelect = {
      id: true,
      customer: true,
      projectNumber: true,
      projectName: true,
      procoreId: true,
      projectManager: true,
    } as const;

    const fetchProjectsSummaryPage = async (whereArg: Prisma.ProjectWhereInput | undefined) => {
      if (includeTotal) {
        const [countValue, rows] = await Promise.all([
          whereArg ? prisma.project.count({ where: whereArg }) : prisma.project.count(),
          useCursorPagination
            ? whereArg
              ? prisma.project.findMany({
                  where: whereArg,
                  orderBy: { id: 'asc' },
                  take: pageSize,
                  select: summarySelect,
                })
              : prisma.project.findMany({
                  orderBy: { id: 'asc' },
                  take: pageSize,
                  select: summarySelect,
                })
            : whereArg
            ? prisma.project.findMany({
                where: whereArg,
                orderBy: { projectName: 'asc' },
                skip,
                take: pageSize,
                select: summarySelect,
              })
            : prisma.project.findMany({
                orderBy: { projectName: 'asc' },
                skip,
                take: pageSize,
                select: summarySelect,
              }),
        ]);

        const hasNext = useCursorPagination
          ? rows.length === pageSize
          : skip! + rows.length < countValue;

        return {
          total: countValue,
          rows,
          hasNextPage: hasNext,
        };
      }

      const pagePlusOne = useCursorPagination
        ? whereArg
          ? await prisma.project.findMany({
              where: whereArg,
              orderBy: { id: 'asc' },
              take: pageSize + 1,
              select: summarySelect,
            })
          : await prisma.project.findMany({
              orderBy: { id: 'asc' },
              take: pageSize + 1,
              select: summarySelect,
            })
        : whereArg
        ? await prisma.project.findMany({
            where: whereArg,
            orderBy: { projectName: 'asc' },
            skip,
            take: pageSize + 1,
            select: summarySelect,
          })
        : await prisma.project.findMany({
            orderBy: { projectName: 'asc' },
            skip,
            take: pageSize + 1,
            select: summarySelect,
          });

      const next = pagePlusOne.length > pageSize;
      return {
        total: undefined,
        rows: next ? pagePlusOne.slice(0, pageSize) : pagePlusOne,
        hasNextPage: next,
      };
    };

    if (summaryOnly) {
      try {
        const result = await fetchProjectsSummaryPage(queryWhere);
        total = result.total;
        projects = result.rows;
        hasNextPage = result.hasNextPage;
      } catch (queryError) {
        console.warn('Retrying summary projects query without archived filter:', queryError);
        const result = await fetchProjectsSummaryPage(legacyQueryWhere);
        total = result.total;
        projects = result.rows;
        hasNextPage = result.hasNextPage;
      }

      const totalPages = includeTotal && typeof total === 'number'
        ? Math.max(1, Math.ceil(total / pageSize))
        : (hasNextPage ? page + 1 : page);

      // For cursor pagination, return the cursor for fetching the next page
      const nextCursor = useCursorPagination && projects.length > 0
        ? (projects[projects.length - 1] as any)?.id
        : undefined;

      const response: Record<string, any> = {
        success: true,
        count: projects.length,
        ...(typeof total === 'number' ? { total } : {}),
        ...(useCursorPagination ? {} : { page, pageSize, totalPages, hasPreviousPage: page > 1 }),
        hasNextPage,
        ...(useCursorPagination && nextCursor ? { nextCursor } : {}),
        data: projects,
      };

      setCachedValue(cacheKey, response, PROJECTS_CACHE_TTL_MS);
      const jsonResponse = NextResponse.json(response);
      jsonResponse.headers.set('Cache-Control', 'private, max-age=30, must-revalidate');
      jsonResponse.headers.set('X-Cache', 'MISS');
      return jsonResponse;
    }

    const fetchProjectsPage = async (whereArg: Prisma.ProjectWhereInput | undefined) => {
      if (includeTotal) {
        const [countValue, rows] = await Promise.all([
          whereArg ? prisma.project.count({ where: whereArg }) : prisma.project.count(),
          useCursorPagination
            ? whereArg
              ? prisma.project.findMany({
                  where: whereArg,
                  orderBy: { id: 'asc' },
                  take: pageSize,
                })
              : prisma.project.findMany({
                  orderBy: { id: 'asc' },
                  take: pageSize,
                })
            : whereArg
            ? prisma.project.findMany({
                where: whereArg,
                orderBy: { projectName: 'asc' },
                skip,
                take: pageSize,
              })
            : prisma.project.findMany({
                orderBy: { projectName: 'asc' },
                skip,
                take: pageSize,
              }),
        ]);
        
        const hasNext = useCursorPagination
          ? rows.length === pageSize
          : skip! + rows.length < countValue;

        return {
          total: countValue,
          rows,
          hasNextPage: hasNext,
        };
      }

      const pagePlusOne = useCursorPagination
        ? whereArg
          ? await prisma.project.findMany({
              where: whereArg,
              orderBy: { id: 'asc' },
              take: pageSize + 1,
            })
          : await prisma.project.findMany({
              orderBy: { id: 'asc' },
              take: pageSize + 1,
            })
        : whereArg
        ? await prisma.project.findMany({
            where: whereArg,
            orderBy: { projectName: 'asc' },
            skip,
            take: pageSize + 1,
          })
        : await prisma.project.findMany({
            orderBy: { projectName: 'asc' },
            skip,
            take: pageSize + 1,
          });

      const next = pagePlusOne.length > pageSize;
      return {
        total: undefined,
        rows: next ? pagePlusOne.slice(0, pageSize) : pagePlusOne,
        hasNextPage: next,
      };
    };

    try {
      const result = await fetchProjectsPage(queryWhere);
      total = result.total;
      projects = result.rows;
      hasNextPage = result.hasNextPage;
    } catch (queryError) {
      console.warn('Retrying projects query without archived filter:', queryError);
      const result = await fetchProjectsPage(legacyQueryWhere);
      total = result.total;
      projects = result.rows;
      hasNextPage = result.hasNextPage;
    }

    const projectsMissingPmc = projects.filter((project) => {
      const customFields =
        project.customFields && typeof project.customFields === 'object' && !Array.isArray(project.customFields)
          ? (project.customFields as Record<string, unknown>)
          : {};
      return !customFields.pmcGroup;
    });

    const pmcFromDetailsByProjectId = new Map<
      string,
      { pmcGroup: string; pmcBreakdown: Record<string, number>; pmcMappingSource: string }
    >();

    if (projectsMissingPmc.length > 0) {
      const missingProjectIds: string[] = projectsMissingPmc
        .map((p) => (typeof p.id === 'string' ? p.id : String(p.id || '')))
        .filter((id) => id.length > 0);

      try {
        const [mappings, details] = await Promise.all([
          prisma.pmcGroupMapping.findMany({
            select: {
              costItemNorm: true,
              costTypeNorm: true,
              pmcGroup: true,
            },
          }),
          prisma.purchaseOrderLineItemContractDetail.findMany({
            where: {
              projectId: { in: missingProjectIds },
              description: { not: null },
            },
            select: {
              projectId: true,
              description: true,
              costType: true,
              quantity: true,
            },
          }),
        ]);

        const detailsByProjectId = new Map<string, Array<{ descriptionNorm: string; costTypeNorm: string; quantity: number }>>();
        for (const d of details) {
          const projectId = (d.projectId || '').toString().trim();
          const descriptionNorm = normalizeForPmc(d.description);
          if (!projectId || !descriptionNorm) continue;
          const row = {
            descriptionNorm,
            costTypeNorm: normalizeForPmc(d.costType),
            quantity: Number(d.quantity) || 1,
          };
          if (!detailsByProjectId.has(projectId)) detailsByProjectId.set(projectId, []);
          detailsByProjectId.get(projectId)!.push(row);
        }

        for (const projectId of missingProjectIds) {
          const groupTotals: Record<string, number> = {};
          const projectDetails = detailsByProjectId.get(projectId) || [];

          for (const detail of projectDetails) {
            const exact = mappings.filter((m) => m.costItemNorm === detail.descriptionNorm);
            const fuzzy = exact.length
              ? []
              : mappings.filter(
                  (m) =>
                    m.costItemNorm.split(/\s+/).length >= 2 &&
                    (detail.descriptionNorm.includes(m.costItemNorm) || m.costItemNorm.includes(detail.descriptionNorm))
                );
            const candidates = exact.length ? exact : fuzzy;
            if (!candidates.length) continue;

            const withType = candidates.filter((c) => c.costTypeNorm && c.costTypeNorm === detail.costTypeNorm);
            const withoutType = candidates.filter((c) => !c.costTypeNorm);
            const chosenPool = withType.length ? withType : withoutType.length ? withoutType : candidates;
            const chosen = chosenPool.sort((a, b) => b.costItemNorm.length - a.costItemNorm.length)[0];

            const weight = detail.quantity > 0 ? detail.quantity : 1;
            groupTotals[chosen.pmcGroup] = (groupTotals[chosen.pmcGroup] || 0) + weight;
          }

          if (Object.keys(groupTotals).length > 0) {
            pmcFromDetailsByProjectId.set(projectId, {
              pmcGroup: choosePrimaryGroup(groupTotals) || 'No Match',
              pmcBreakdown: groupTotals,
              pmcMappingSource: 'api:projects:costitem:description',
            });
          } else {
            pmcFromDetailsByProjectId.set(projectId, {
              pmcGroup: 'No Match',
              pmcBreakdown: {},
              pmcMappingSource: 'api:projects:costitem:no-match',
            });
          }
        }
      } catch (pmcEnrichmentError) {
        console.warn('Skipping PMC enrichment due to missing mapping/detail tables:', pmcEnrichmentError);
      }
    }

    const procoreProjectIds = Array.from(
      new Set(
        projects
          .map((project) => {
            const value = (project.procoreId || '').toString().trim();
            return value.length > 0 ? value : null;
          })
          .filter((value): value is string => Boolean(value))
      )
    );

    const bidBoardStatusByProcoreId = new Map<string, string>();

    if (procoreProjectIds.length > 0) {
      const stagingRows = await prisma.$queryRaw<
        Array<{
          procoreProjectId: string | null;
          externalId: string | null;
          bidBoardStatus: string | null;
          syncedAt: Date;
        }>
      >(Prisma.sql`
        SELECT
          procore_project_id AS "procoreProjectId",
          external_id AS "externalId",
          bid_board_status AS "bidBoardStatus",
          synced_at AS "syncedAt"
        FROM procore_project_staging
        WHERE source = 'procore_v1_projects'
          AND (
            procore_project_id IN (${Prisma.join(procoreProjectIds)})
            OR external_id IN (${Prisma.join(procoreProjectIds)})
          )
        ORDER BY synced_at DESC
      `);

      for (const row of stagingRows) {
        const bidBoardStatus = (row.bidBoardStatus || '').toString().trim();
        if (!bidBoardStatus) continue;

        const identifiers = [row.procoreProjectId, row.externalId]
          .map((value) => (value || '').toString().trim())
          .filter((value) => value.length > 0);

        for (const identifier of identifiers) {
          if (!bidBoardStatusByProcoreId.has(identifier)) {
            bidBoardStatusByProcoreId.set(identifier, bidBoardStatus);
          }
        }
      }
    }

    let projectsWithPMC: Array<Record<string, unknown>> = projects.map((project) => {
      const customFields = getCanonicalProjectCustomFields(project.customFields);

      const projectId = typeof project.id === 'string' ? project.id : String(project.id || '');
      const fallback = pmcFromDetailsByProjectId.get(projectId);
      const identity = getCanonicalProjectIdentity(project);
      const bidBoardStatusValue =
        project['bidBoardStatus'] ??
        customFields.bidBoardStatus ??
        (identity.procoreId ? bidBoardStatusByProcoreId.get(identity.procoreId) : null) ??
        null;

      return {
        ...project,
        ...identity,
        bidBoardStatus: typeof bidBoardStatusValue === 'string' ? bidBoardStatusValue : null,
        pmcGroup: customFields.pmcGroup ?? fallback?.pmcGroup ?? null,
        pmcBreakdown: customFields.pmcBreakdown ?? fallback?.pmcBreakdown ?? null,
        pmcMappingSource: customFields.pmcMappingSource ?? fallback?.pmcMappingSource ?? null,
      };
    });

    // Endpoint-only mode: keep endpoint records, but backfill missing customer
    // from matching legacy rows so project cards are usable.
    if (endpointOnly && projectsWithPMC.length > 0) {
      const identityPairs = projectsWithPMC
        .map((project) => ({
          projectNumber: (project['projectNumber'] ?? '').toString().trim(),
          projectName: (project['projectName'] ?? '').toString().trim(),
        }))
        .filter((project) => project.projectNumber.length > 0 || project.projectName.length > 0);

      if (identityPairs.length > 0) {
        const identityWhere: Prisma.ProjectWhereInput[] = identityPairs.map((project) => {
          const where: Prisma.ProjectWhereInput = {
            AND: [
              { procoreId: null },
              { customer: { not: null } },
            ],
          };

          const number = project.projectNumber;
          const name = project.projectName;

          if (number && name) {
            where.projectNumber = number;
            where.projectName = name;
          } else if (number) {
            where.projectNumber = number;
          } else if (name) {
            where.projectName = name;
          }

          return where;
        });

        const legacyCustomerRows = await prisma.project.findMany({
          where: {
            OR: identityWhere,
          },
          select: {
            projectNumber: true,
            projectName: true,
            customer: true,
            customerSource: true,
            updatedAt: true,
          },
          orderBy: {
            updatedAt: 'desc',
          },
        });

        const fallbackByIdentity = new Map<string, { customer: string; customerSource: string | null }>();
        for (const row of legacyCustomerRows) {
          const customer = (row.customer || '').toString().trim();
          if (!customer) continue;
          const key = keyFromProjectIdentity(row.projectNumber, row.projectName);
          if (!fallbackByIdentity.has(key)) {
            fallbackByIdentity.set(key, {
              customer,
              customerSource: row.customerSource,
            });
          }
        }

        projectsWithPMC = projectsWithPMC.map((project) => {
          const customer = (project['customer'] || '').toString().trim();
          if (customer.length > 0) return project;

          const key = keyFromProjectIdentity(project['projectNumber'], project['projectName']);
          const fallback = fallbackByIdentity.get(key);
          if (!fallback) return project;

          return {
            ...project,
            customer: fallback.customer,
            customerSource: fallback.customerSource ?? 'legacy_customer_fallback',
          };
        });
      }
    }

    const totalPages = includeTotal && typeof total === 'number'
      ? Math.max(1, Math.ceil(total / pageSize))
      : (hasNextPage ? page + 1 : page);

    // For cursor pagination, return the cursor for fetching the next page
    const nextCursor = useCursorPagination && projectsWithPMC.length > 0
      ? (projectsWithPMC[projectsWithPMC.length - 1] as any)?.id
      : undefined;

    const response: Record<string, any> = {
      success: true,
      count: projectsWithPMC.length,
      ...(typeof total === 'number' ? { total } : {}),
      ...(useCursorPagination ? {} : { page, pageSize, totalPages, hasPreviousPage: page > 1 }),
      hasNextPage,
      ...(useCursorPagination && nextCursor ? { nextCursor } : {}),
      data: projectsWithPMC,
    };

    setCachedValue(cacheKey, response, PROJECTS_CACHE_TTL_MS);
    const jsonResponse = NextResponse.json(response);
    jsonResponse.headers.set('Cache-Control', 'private, max-age=30, must-revalidate');
    jsonResponse.headers.set('X-Cache', 'MISS');
    return jsonResponse;
  } catch (error) {
    console.error('Failed to fetch projects:', error);
    if (shouldFallbackToEmptyRead(error)) {
      const searchParams = request.nextUrl.searchParams;
      const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
      const requestedPageSize = Number.parseInt(searchParams.get('pageSize') || '100', 10) || 100;
      const pageSize = Math.min(500, Math.max(1, requestedPageSize));
      const cursor = (searchParams.get('cursor') || '').trim() || null;
      const useCursor = cursor !== null;

      const fallbackResponse: Record<string, any> = {
        success: true,
        count: 0,
        total: 0,
        hasNextPage: false,
        ...(useCursor ? {} : { page, pageSize, totalPages: 1, hasPreviousPage: page > 1 }),
        data: [],
      };

      const fallbackJson = NextResponse.json(fallbackResponse);
      fallbackJson.headers.set('Cache-Control', 'private, max-age=30, must-revalidate');
      fallbackJson.headers.set('X-Cache', 'MISS');
      return fallbackJson;
    }

    return NextResponse.json(
      { success: false, error: `Failed to fetch projects: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { status, id, customer, projectNumber, projectName } = body;

    if (!status) {
      return NextResponse.json(
        { success: false, error: 'Status is required' },
        { status: 400 }
      );
    }

    // Prefer unique id updates to avoid collisions when project numbers are reused.
    let updatedCount = 0;
    if (id) {
      const updated = await prisma.project.update({
        where: { id },
        data: { status },
      });
      updatedCount = updated ? 1 : 0;
    } else {
      if (!customer && !projectNumber && !projectName) {
        return NextResponse.json(
          { success: false, error: 'Provide at least one selector: customer, projectNumber, or projectName' },
          { status: 400 }
        );
      }

      const where: Prisma.ProjectWhereInput = {};
      if (customer) where.customer = customer;

      // Project name is the most reliable business identifier in this dataset.
      if (projectName) {
        where.projectName = projectName;
      } else if (projectNumber) {
        where.projectNumber = projectNumber;
      }

      const updated = await prisma.project.updateMany({
        where,
        data: { status },
      });
      updatedCount = updated.count;
    }

    await logAuditEvent(request, {
      action: 'update',
      resource: 'project-status',
      target: id ?? `${customer ?? 'unknown-customer'}|${projectNumber ?? 'unknown-project'}|${projectName ?? 'unknown-name'}`,
      details: {
        status,
        id,
        customer,
        projectNumber,
        projectName,
        updatedCount,
      },
    });

    invalidateCacheByPrefix(PROJECTS_CACHE_PREFIX);

    return NextResponse.json({
      success: true,
      message: `Updated ${updatedCount} project(s)`,
      data: { count: updatedCount },
    });
  } catch (error) {
    console.error('Failed to update project status:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update status' },
      { status: 500 }
    );
  }
}

