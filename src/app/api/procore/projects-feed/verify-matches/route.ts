import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureProcoreProjectFeedTable } from '@/lib/procoreProjectFeed';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    await ensureProcoreProjectFeedTable();

    const body = await request.json().catch(() => ({}));
    const companyId = String(body?.companyId || '').trim();
    const rematchAll = body?.rematchAll === true;
    const requestedLimit = Number(body?.limit || 500);
    const limit = Math.min(5000, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 500));

    const conditions: string[] = [];
    const params: unknown[] = [];
    let p = 1;

    if (companyId) {
      conditions.push(`company_id = $${p++}`);
      params.push(companyId);
    }

    if (!rematchAll) {
      conditions.push('linked_project_id IS NULL');
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const candidates = await prisma.$queryRawUnsafe<Array<{
      id: number;
      external_id: string;
      procore_id: string | null;
      project_number: string | null;
      project_name: string;
      customer: string | null;
    }>>(
      `
        SELECT id, external_id, procore_id, project_number, project_name, customer
        FROM procore_project_feed
        ${whereClause}
        ORDER BY synced_at DESC
        LIMIT $${p++}
      `,
      ...params,
      limit
    );

    let matched = 0;
    let unmatched = 0;
    const errors: string[] = [];

    for (const row of candidates) {
      try {
        const procoreIdToMatch = row.procore_id || row.external_id;

        const byProcore = await prisma.project.findFirst({
          where: {
            OR: [
              { customFields: { path: ['procoreId'], equals: procoreIdToMatch } },
              { customFields: { path: ['bidBoardId'], equals: row.external_id } },
            ],
          },
          select: { id: true },
        });

        let matchedProjectId = byProcore?.id || null;
        let confidence: 'high' | 'medium' | null = byProcore?.id ? 'high' : null;

        if (!matchedProjectId) {
          const whereByNameNumber: {
            projectName: string;
            projectNumber?: string;
            customer?: string;
          } = {
            projectName: row.project_name,
            ...(row.project_number ? { projectNumber: row.project_number } : {}),
          };

          if (row.customer) {
            whereByNameNumber.customer = row.customer;
          }

          const byNameNumber = await prisma.project.findFirst({
            where: whereByNameNumber,
            select: { id: true },
          });

          if (byNameNumber?.id) {
            matchedProjectId = byNameNumber.id;
            confidence = 'medium';
          }
        }

        if (matchedProjectId) {
          await prisma.$executeRawUnsafe(
            `
              UPDATE procore_project_feed
              SET linked_project_id = $1,
                  match_confidence = $2,
                  matched_at = NOW(),
                  updated_at = NOW()
              WHERE id = $3
            `,
            matchedProjectId,
            confidence,
            row.id
          );
          matched += 1;
        } else {
          unmatched += 1;
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`row:${row.id} => ${message}`);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        checked: candidates.length,
        matched,
        unmatched,
        errors,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: `Failed to verify Procore feed matches: ${message}` },
      { status: 500 }
    );
  }
}
