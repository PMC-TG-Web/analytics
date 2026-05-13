import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { makeRequest, procoreConfig, getClientCredentialsToken, withProcoreLiveApiBypassForSyncSecret } from '@/lib/procore';
import { ensureProcoreProjectFeedTable } from '@/lib/procoreProjectFeed';
import { ensureBudgetLineItemsTable, batchUpsertBudgetLineItems, type BatchBudgetLineItem } from '@/lib/procoreBudgetLineItems';

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' ? (value as JsonObject) : null;
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

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
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

function parseCsvIds(value: unknown): string[] {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function unwrapArray(response: unknown): JsonObject[] {
  if (Array.isArray(response)) {
    return response.map(asObject).filter((v): v is JsonObject => Boolean(v));
  }
  if (response && typeof response === 'object') {
    const r = response as Record<string, unknown>;
    if (Array.isArray(r.data)) {
      return r.data.map(asObject).filter((v): v is JsonObject => Boolean(v));
    }
    if (Array.isArray(r.results)) {
      return r.results.map(asObject).filter((v): v is JsonObject => Boolean(v));
    }
  }
  return [];
}

function isAccessSkippedError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('error 403') ||
    lower.includes('forbidden') ||
    lower.includes('error 404') ||
    lower.includes('not found')
  );
}

async function getProjectIdsFromFeed(companyId: string, limitProjects: number) {
  await ensureProcoreProjectFeedTable();
  const { prisma } = await import('@/lib/prisma');

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

async function fetchProjectBudgetLineItemsPage(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  page: number;
  perPage: number;
}) {
  const { accessToken, companyId, projectId, page, perPage } = params;
  const encodedProjectId = encodeURIComponent(projectId);
  const query = new URLSearchParams({
    project_id: projectId,
    page: String(page),
    per_page: String(perPage),
  });

  const endpoints = [
    `/rest/v1.1/budget_line_items?${query.toString()}`,
    `/rest/v1.0/budget_line_items?${query.toString()}`,
    `/rest/v1.1/projects/${encodedProjectId}/budget_line_items?page=${page}&per_page=${perPage}`,
    `/rest/v1.0/projects/${encodedProjectId}/budget_line_items?page=${page}&per_page=${perPage}`,
  ];

  const failures: string[] = [];
  for (const endpoint of endpoints) {
    try {
      const data = await makeRequest(endpoint, accessToken, undefined, companyId);
      return { data, endpoint, failures };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${endpoint} => ${message}`);
    }
  }

  throw new Error(failures.join(' | '));
}

export async function POST(request: Request) {
  return withProcoreLiveApiBypassForSyncSecret(request, async () => {
    try {
    const body = await request.json().catch(() => ({}));
    const companyIdFromBody = String(body?.companyId || '').trim();
    const limitProjects = Math.max(1, Math.min(10000, Number.parseInt(String(body?.limitProjects || '100'), 10) || 100));
    const perPage = Math.min(200, Math.max(1, Number.parseInt(String(body?.perPage || '100'), 10) || 100));
    const fetchAll = body?.fetchAll === true;

    const cookieStore = await cookies();
    const userAccessToken = String(
      cookieStore.get('procore_access_token')?.value || body?.accessToken || ''
    ).trim();
    const companyId = String(
      companyIdFromBody || cookieStore.get('procore_company_id')?.value || procoreConfig.companyId || ''
    ).trim();

    let accessToken: string;
    if (userAccessToken) {
      accessToken = userAccessToken;
    } else {
      try {
        accessToken = await getClientCredentialsToken();
      } catch {
        return NextResponse.json(
          { success: false, error: 'Missing access token. Please login via OAuth.' },
          { status: 401 }
        );
      }
    }


    await ensureBudgetLineItemsTable();

    const explicitProjectIds = Array.isArray(body?.projectIds)
      ? body.projectIds.map((v: unknown) => String(v || '').trim()).filter(Boolean)
      : parseCsvIds(body?.projectIds);

    const projectIds = explicitProjectIds.length > 0
      ? explicitProjectIds
      : await getProjectIdsFromFeed(companyId, limitProjects);
    if (projectIds.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'No project IDs found in procore_project_feed for this company. Run Projects Feed Sync first.',
        },
        { status: 400 }
      );
    }

    let projectsScanned = 0;
    let projectsSkippedAccess = 0;
    let fetched = 0;
    let upserted = 0;
    const maxWarningMessages = 100;
    const maxErrorMessages = 200;
    let warningsTruncated = 0;
    let errorsTruncated = 0;
    const warnings: string[] = [];
    const errors: string[] = [];

    function pushWarning(message: string) {
      if (warnings.length < maxWarningMessages) {
        warnings.push(message);
      } else {
        warningsTruncated += 1;
      }
    }

    function pushError(message: string) {
      if (errors.length < maxErrorMessages) {
        errors.push(message);
      } else {
        errorsTruncated += 1;
      }
    }

    for (const projectId of projectIds) {
      projectsScanned += 1;
      let page = 1;
      const projectItems: BatchBudgetLineItem[] = [];

      while (true) {
        let result: { data: unknown; endpoint: string; failures: string[] } | null = null;
        try {
          result = await fetchProjectBudgetLineItemsPage({
            accessToken,
            companyId,
            projectId,
            page,
            perPage,
          });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          if (isAccessSkippedError(message)) {
            projectsSkippedAccess += 1;
            pushWarning(`project:${projectId} budget_line_items skipped (access): ${message}`);
          } else {
            pushError(`project:${projectId} budget_line_items => ${message}`);
          }
        }

        if (!result) break;

        const items = unwrapArray(result.data);
        if (items.length === 0) break;
        fetched += items.length;

        for (const item of items) {
          const budgetLineItemId = firstText(item.id, item.budget_line_item_id);
          if (!budgetLineItemId) continue;

          const costCodeObject = asObject(item.cost_code);
          const lineItemTypeObject = asObject(item.line_item_type);
          const wbsCodeObject = asObject(item.wbs_code);
          const currencyObject = asObject(item.currency_configuration);

          projectItems.push({
            projectId,
            budgetLineItemId,
            name: firstText(item.name, item.title),
            costCode: firstText(
              item.cost_code_string,
              wbsCodeObject?.flat_code,
              costCodeObject?.code,
              costCodeObject?.name,
              item.cost_code
            ),
            costCodeDescription: firstText(
              wbsCodeObject?.description,
              costCodeObject?.description
            ),
            wbsCodeId: firstText(wbsCodeObject?.id, item.wbs_code_id),
            lineItemType: firstText(
              lineItemTypeObject?.name,
              lineItemTypeObject?.id,
              item.line_item_type
            ),
            uom: firstText(item.uom),
            quantity: readNumber(item.quantity),
            unitCost: readNumber(item.unit_cost),
            originalBudgetAmount: readNumber(item.original_budget_amount),
            amount: readNumber(item.amount) ?? readNumber(item.budget_amount) ?? readNumber(item.original_budget_amount),
            calculationStrategy: firstText(item.calculation_strategy),
            currencyIsoCode: firstText(currencyObject?.currency_iso_code, item.currency_iso_code),
            sourceCreatedAt: firstText(item.created_at),
            sourceUpdatedAt: firstText(item.updated_at),
            payload: item,
          });
        }

        if (!fetchAll || items.length < perPage) break;
        page += 1;
        if (page > 100) break;
      }

      // Bulk-upsert all collected items for this project in one statement
      if (projectItems.length > 0) {
        try {
          await batchUpsertBudgetLineItems(companyId, projectItems);
          upserted += projectItems.length;
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          pushError(`project:${projectId} batch upsert => ${message}`);
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Company budget line items sync complete',
      data: {
        companyId,
        projectsLimit: limitProjects,
        projectsScanned,
        projectsSkippedAccess,
        fetched,
        upserted,
        warningsTruncated,
        errorsTruncated,
        warnings,
        errors,
      },
    });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json(
        { success: false, error: `Failed to sync company budget line items: ${message}` },
        { status: 500 }
      );
    }
  });
}

export async function GET() {
  return NextResponse.json(
    { success: false, error: 'Budget line items sync requires POST.' },
    { status: 405, headers: { Allow: 'POST' } }
  );
}
