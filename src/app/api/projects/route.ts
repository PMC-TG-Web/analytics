import { prisma } from '@/lib/prisma';
import { logAuditEvent } from '@/lib/auditLog';
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

function normalizeForPmc(value: unknown) {
  return (value ?? '').toString().trim().replace(/^"+|"+$/g, '').trim().toLowerCase();
}

function choosePrimaryGroup(groupTotals: Record<string, number>) {
  const entries = Object.entries(groupTotals);
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const requestedPageSize = Number.parseInt(searchParams.get('pageSize') || '100', 10) || 100;
    const pageSize = Math.min(500, Math.max(1, requestedPageSize));
    const skip = (page - 1) * pageSize;
    const includeTotal = (searchParams.get('includeTotal') || '').trim().toLowerCase() === 'true';
    const customer = (searchParams.get('customer') || '').trim();
    const projectNumber = (searchParams.get('projectNumber') || '').trim();
    const projectName = (searchParams.get('projectName') || '').trim();
    const statusesParam = (searchParams.get('statuses') || '').trim();
    const includeArchived = (searchParams.get('includeArchived') || '').trim().toLowerCase() === 'true';

    const statusList = statusesParam
      ? statusesParam.split(',').map((value) => value.trim()).filter((value) => value.length > 0)
      : [];

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

    const queryWhere = Object.keys(where).length > 0 ? where : undefined;
    const baseFindManyArgs = {
      orderBy: {
        projectName: 'asc' as const, // Reverted from procoreLastSync to ensure it works without a new migration
      },
      skip,
    };

    let total: number | undefined;
    let hasNextPage = false;
    let projects;

    if (includeTotal) {
      [total, projects] = await Promise.all([
        queryWhere ? prisma.project.count({ where: queryWhere }) : prisma.project.count(),
        queryWhere
          ? prisma.project.findMany({
              where: queryWhere,
              ...baseFindManyArgs,
              take: pageSize,
            })
          : prisma.project.findMany({
              ...baseFindManyArgs,
              take: pageSize,
            }),
      ]);
      hasNextPage = skip + projects.length < total;
    } else {
      const pagePlusOne = queryWhere
        ? await prisma.project.findMany({
            where: queryWhere,
            ...baseFindManyArgs,
            take: pageSize + 1,
          })
        : await prisma.project.findMany({
            ...baseFindManyArgs,
            take: pageSize + 1,
          });

      hasNextPage = pagePlusOne.length > pageSize;
      projects = hasNextPage ? pagePlusOne.slice(0, pageSize) : pagePlusOne;
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
      const missingProjectIds = projectsMissingPmc.map((p) => p.id);
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
    }

    const projectsWithPMC = projects.map((project) => {
      const customFields =
        project.customFields && typeof project.customFields === 'object' && !Array.isArray(project.customFields)
          ? (project.customFields as Record<string, unknown>)
          : {};

      const fallback = pmcFromDetailsByProjectId.get(project.id);

      return {
        ...project,
        pmcGroup: customFields.pmcGroup ?? fallback?.pmcGroup ?? null,
        pmcBreakdown: customFields.pmcBreakdown ?? fallback?.pmcBreakdown ?? null,
        pmcMappingSource: customFields.pmcMappingSource ?? fallback?.pmcMappingSource ?? null,
      };
    });

    const totalPages = includeTotal && typeof total === 'number'
      ? Math.max(1, Math.ceil(total / pageSize))
      : (hasNextPage ? page + 1 : page);

    return NextResponse.json({
      success: true,
      count: projectsWithPMC.length,
      ...(typeof total === 'number' ? { total } : {}),
      page,
      pageSize,
      totalPages,
      hasNextPage,
      hasPreviousPage: page > 1,
      data: projectsWithPMC,
    });
  } catch (error) {
    console.error('Failed to fetch projects:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch projects' },
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

