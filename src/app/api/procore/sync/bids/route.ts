import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { makeRequest, procoreConfig, getClientCredentialsToken } from '@/lib/procore';
import { ensureBidsTable, upsertBid } from '@/lib/procoreBids';
import { ensureProcoreProjectFeedTable } from '@/lib/procoreProjectFeed';
import { prisma } from '@/lib/prisma';

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' ? (value as JsonObject) : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = readText(value);
    if (text) return text;
  }
  return null;
}

function isAccessSkippedError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('error 403') ||
    lower.includes('sufficient access') ||
    lower.includes('forbidden') ||
    lower.includes('error 404') ||
    lower.includes('not found')
  );
}

async function getProjectIdsFromFeed(companyId: string, limitProjects: number) {
  await ensureProcoreProjectFeedTable();
  const rows = await prisma.$queryRawUnsafe<Array<{ procore_id: string | null }>>(
    `
      SELECT DISTINCT procore_id
      FROM procore_project_feed
      WHERE company_id = $1
        AND soft_deleted = FALSE
        AND procore_id IS NOT NULL
      ORDER BY procore_id ASC
      LIMIT $2
    `,
    companyId,
    Math.max(1, Math.min(10000, limitProjects))
  );

  return rows
    .map((r) => String(r.procore_id || '').trim())
    .filter((v) => v.length > 0);
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const companyWide = Boolean(body?.companyWide);
    const projectId = String(body?.projectId || '').trim();
    const companyIdFromBody = String(body?.companyId || '').trim();
    const limitProjects = Math.max(1, Math.min(10000, Number.parseInt(String(body?.limitProjects || '100'), 10) || 100));
    const fetchAll = body?.fetchAll === true;
    const page = Math.max(1, Number.parseInt(String(body?.page || '1'), 10) || 1);
    const perPage = Math.min(100, Math.max(1, Number.parseInt(String(body?.perPage || '100'), 10) || 100));

    if (!companyWide && !projectId) {
      return NextResponse.json({ success: false, error: 'Missing projectId (or set companyWide=true).' }, { status: 400 });
    }

    const cookieStore = await cookies();
    const userAccessToken = String(cookieStore.get('procore_access_token')?.value || '').trim();
    const companyId = String(companyIdFromBody || cookieStore.get('procore_company_id')?.value || procoreConfig.companyId || '').trim();

    let accessToken: string;
    if (userAccessToken) {
      accessToken = userAccessToken;
    } else {
      try {
        accessToken = await getClientCredentialsToken();
      } catch {
        return NextResponse.json({ success: false, error: 'Missing access token. Please login via OAuth.' }, { status: 401 });
      }
    }


    await ensureBidsTable();

    const allBids: JsonObject[] = [];
    const crawlErrors: string[] = [];
    const warnings: string[] = [];
    let currentPage = page;
    let projectsScanned = 0;
    let skippedProjectsNoBiddingAccess = 0;

    const projectIds = companyWide ? await getProjectIdsFromFeed(companyId, limitProjects) : [projectId];

    if (companyWide && projectIds.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'No project IDs found in procore_project_feed for this company. Run Projects Feed Sync first so company-wide bids has project context.',
        },
        { status: 400 }
      );
    }

    for (const projectIdToScan of projectIds) {
      projectsScanned += 1;
      currentPage = page;

      while (true) {
        const endpoint = `/rest/v1.0/projects/${encodeURIComponent(projectIdToScan)}/bids?company_id=${encodeURIComponent(companyId)}&page=${currentPage}&per_page=${perPage}`;

        let data: unknown;
        try {
          data = await makeRequest(endpoint, accessToken);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          if (isAccessSkippedError(message)) {
            skippedProjectsNoBiddingAccess += 1;
            if (warnings.length < 25) {
              warnings.push(`project:${projectIdToScan} bids skipped (access): ${message}`);
            }
          } else {
            crawlErrors.push(`project:${projectIdToScan} bids => ${message}`);
          }
          break;
        }

        const items = Array.isArray(data)
          ? data.map(asObject).filter((v): v is JsonObject => Boolean(v))
          : [];

        if (items.length === 0) break;
        allBids.push(
          ...items.map((item) => ({
            ...item,
            project_id: firstText(item.project_id, projectIdToScan) || projectIdToScan,
          }))
        );
        if (!fetchAll || items.length < perPage) break;
        currentPage += 1;
        if (currentPage - page > 50) break;
        await new Promise((r) => setTimeout(r, 150));
      }
    }

    let upserted = 0;
    const errors: string[] = [...crawlErrors];

    for (const bid of allBids) {
      try {
        const bidId = firstText(bid.id, bid.bid_id);
        if (!bidId) continue;

        const derivedProjectId = firstText(bid.project_id, projectId) || projectId;
        if (!derivedProjectId) continue;

        const createdByObject = asObject(bid.created_by);
        const createdBy = firstText(createdByObject?.name, createdByObject?.email, createdByObject?.id, bid.created_by);

        await upsertBid({
          companyId,
          projectId: derivedProjectId,
          bidId,
          name: firstText(bid.name, bid.title, bid.bid_name),
          status: firstText(bid.status),
          createdBy,
          sourceCreatedAt: readString(bid.created_at),
          payload: bid,
        });

        upserted += 1;
      } catch (error: unknown) {
        const id = firstText(bid.id, bid.bid_id) || 'unknown';
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`bid:${id} => ${message}`);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Bids sync complete',
      data: {
        companyWide,
        companyId,
        projectId: projectId || null,
        projectsLimit: companyWide ? limitProjects : null,
        projectsScanned: companyWide ? projectsScanned : null,
        skippedProjectsNoBiddingAccess: companyWide ? skippedProjectsNoBiddingAccess : 0,
        fetched: allBids.length,
        upserted,
        warnings,
        errors,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: `Failed to sync bids: ${message}` }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json(
    { success: false, error: 'Bids sync requires POST.' },
    { status: 405, headers: { Allow: 'POST' } }
  );
}
