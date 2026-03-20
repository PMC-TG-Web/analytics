import { prisma } from '@/lib/prisma';
import { logAuditEvent } from '@/lib/auditLog';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function normalize(value: unknown) {
  return (value ?? '').toString().trim().replace(/^"+|"+$/g, '').trim().toLowerCase();
}

function cleanText(value: unknown) {
  const text = (value ?? '').toString().trim();
  return text.length ? text : null;
}

function choosePrimaryGroup(groupTotals: Record<string, number>) {
  const entries = Object.entries(groupTotals);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

export async function POST(request: NextRequest) {
  try {
    const mappings = await prisma.pmcGroupMapping.findMany({
      select: {
        costItemNorm: true,
        costTypeNorm: true,
        pmcGroup: true,
      },
    });

    if (!mappings.length) {
      return NextResponse.json(
        { success: false, error: 'No PMC mappings found in database. Add mappings first.' },
        { status: 400 }
      );
    }

    const details = await prisma.purchaseOrderLineItemContractDetail.findMany({
      where: {
        projectId: { not: null },
        description: { not: null },
      },
      select: {
        projectId: true,
        description: true,
        costType: true,
        quantity: true,
      },
      take: 200000,
    });

    const detailsByProject = new Map<string, Array<{ description: string; costType: string; quantity: number }>>();
    for (const d of details) {
      const projectId = String(d.projectId || '').trim();
      const description = cleanText(d.description) || '';
      if (!projectId || !description) continue;
      const row = {
        description,
        costType: normalize(d.costType),
        quantity: Number(d.quantity) || 1,
      };
      if (!detailsByProject.has(projectId)) detailsByProject.set(projectId, []);
      detailsByProject.get(projectId)!.push(row);
    }

    const projects = await prisma.project.findMany({
      select: {
        id: true,
        customFields: true,
      },
    });

    let updated = 0;
    let mappedByDescription = 0;
    let unmapped = 0;
    let noMatchSet = 0;

    for (const project of projects) {
      const projectDetails = detailsByProject.get(project.id) || [];
      const groupTotals: Record<string, number> = {};

      for (const detail of projectDetails) {
        const descriptionNorm = normalize(detail.description);
        const exact = mappings.filter((m) => m.costItemNorm === descriptionNorm);
        const fuzzy = exact.length
          ? []
          : mappings.filter(
              (m) =>
                m.costItemNorm.split(/\s+/).length >= 2 &&
                (descriptionNorm.includes(m.costItemNorm) || m.costItemNorm.includes(descriptionNorm))
            );
        const candidates = exact.length ? exact : fuzzy;

        if (!candidates.length) continue;

        const withType = candidates.filter((c) => c.costTypeNorm && c.costTypeNorm === detail.costType);
        const withoutType = candidates.filter((c) => !c.costTypeNorm);
        const chosenPool = withType.length ? withType : withoutType.length ? withoutType : candidates;
        const chosen = chosenPool.sort((a, b) => b.costItemNorm.length - a.costItemNorm.length)[0];

        const weight = Number(detail.quantity) > 0 ? Number(detail.quantity) : 1;
        groupTotals[chosen.pmcGroup] = (groupTotals[chosen.pmcGroup] || 0) + weight;
      }

      const existingCustomFields =
        project.customFields && typeof project.customFields === 'object' && !Array.isArray(project.customFields)
          ? (project.customFields as Record<string, unknown>)
          : {};

      if (!Object.keys(groupTotals).length) {
        unmapped += 1;
        await prisma.project.update({
          where: { id: project.id },
          data: {
            customFields: {
              ...existingCustomFields,
              pmcGroup: 'No Match',
              pmcBreakdown: {},
              pmcMappingSource: 'db:costitem:no-match',
            },
          },
        });
        noMatchSet += 1;
        continue;
      }

      const pmcGroup = choosePrimaryGroup(groupTotals);
      await prisma.project.update({
        where: { id: project.id },
        data: {
          customFields: {
            ...existingCustomFields,
            pmcGroup,
            pmcBreakdown: groupTotals,
            pmcMappingSource: 'db:costitem:description',
          },
        },
      });

      mappedByDescription += 1;
      updated += 1;
    }

    await logAuditEvent(request, {
      action: 'admin',
      resource: 'pmc-group-mapping',
      details: {
        mappingRows: mappings.length,
        poDetailRows: details.length,
        projectsScanned: projects.length,
        projectsUpdated: updated,
        mappedByDescription,
        unmapped,
        noMatchSet,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        mappingRows: mappings.length,
        poDetailRows: details.length,
        projectsScanned: projects.length,
        projectsUpdated: updated,
        mappedByDescription,
        unmapped,
        noMatchSet,
      },
    });
  } catch (error) {
    console.error('Failed to map PMC groupings:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to map PMC groupings' },
      { status: 500 }
    );
  }
}
