import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { makeRequest, procoreConfig } from '@/lib/procore';
import { ensureBidFormsTable, upsertBidForm } from '@/lib/procoreBidForms';

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

async function fetchBidFormsPage(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  bidPackageId: string;
  query: URLSearchParams;
}) {
  const { accessToken, companyId, projectId, bidPackageId, query } = params;

  const queryWithCompany = new URLSearchParams(query);
  queryWithCompany.set('company_id', companyId);

  const queryWithoutCompany = new URLSearchParams(query);
  queryWithoutCompany.delete('company_id');

  const endpoints = [
    `/rest/v1.0/projects/${encodeURIComponent(projectId)}/bid_packages/${encodeURIComponent(bidPackageId)}/bid_forms?${queryWithCompany.toString()}`,
    `/rest/v1.0/projects/${encodeURIComponent(projectId)}/bid_packages/${encodeURIComponent(bidPackageId)}/bid_forms?${queryWithoutCompany.toString()}`,
    `/rest/v1.0/bid_packages/${encodeURIComponent(bidPackageId)}/bid_forms?${queryWithCompany.toString()}`,
    `/rest/v1.0/bid_packages/${encodeURIComponent(bidPackageId)}/bid_forms?${queryWithoutCompany.toString()}`,
    `/rest/v1.1/projects/${encodeURIComponent(projectId)}/bid_packages/${encodeURIComponent(bidPackageId)}/bid_forms?${queryWithCompany.toString()}`,
    `/rest/v1.1/projects/${encodeURIComponent(projectId)}/bid_packages/${encodeURIComponent(bidPackageId)}/bid_forms?${queryWithoutCompany.toString()}`,
    `/rest/v1.0/projects/${encodeURIComponent(projectId)}/bid_forms?bid_package_id=${encodeURIComponent(bidPackageId)}&${queryWithCompany.toString()}`,
    `/rest/v1.0/projects/${encodeURIComponent(projectId)}/bid_forms?bid_package_id=${encodeURIComponent(bidPackageId)}&${queryWithoutCompany.toString()}`,
  ];

  const failures: string[] = [];

  for (const endpoint of endpoints) {
    try {
      const data = await makeRequest(endpoint, accessToken);
      return { data, endpoint, failures };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${endpoint} => ${message}`);
    }
  }

  throw new Error(failures.join(' | '));
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const projectId = String(body?.projectId || '').trim();
    const bidPackageId = String(body?.bidPackageId || '').trim();
    const companyIdFromBody = String(body?.companyId || '').trim();
    const fetchAll = body?.fetchAll !== false;
    const page = Math.max(1, Number.parseInt(String(body?.page || '1'), 10) || 1);
    const perPage = Math.min(100, Math.max(1, Number.parseInt(String(body?.perPage || '100'), 10) || 100));
    const search = String(body?.search || '').trim();
    const view = String(body?.view || '').trim();
    const sort = String(body?.sort || '').trim();
    const excludedBidFormId = String(body?.excludedBidFormId || '').trim();

    if (!projectId || !bidPackageId) {
      return NextResponse.json(
        { success: false, error: 'Missing projectId or bidPackageId.' },
        { status: 400 }
      );
    }

    const cookieStore = await cookies();
    const accessToken = cookieStore.get('procore_access_token')?.value;
    const companyId = String(
      companyIdFromBody || cookieStore.get('procore_company_id')?.value || procoreConfig.companyId
    ).trim();

    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: 'Missing access token. Please login via OAuth.' },
        { status: 401 }
      );
    }

    await ensureBidFormsTable();

    const allBidForms: JsonObject[] = [];
    let currentPage = page;

    while (true) {
      const params = new URLSearchParams({
        page: String(currentPage),
        per_page: String(perPage),
      });

      if (search) params.set('search', search);
      if (view) params.set('view', view);
      if (sort) params.set('sort', sort);
      if (excludedBidFormId) params.set('excluded_bid_form_id', excludedBidFormId);

      const { data } = await fetchBidFormsPage({
        accessToken,
        companyId,
        projectId,
        bidPackageId,
        query: params,
      });
      const items = Array.isArray(data)
        ? data.map(asObject).filter((v): v is JsonObject => Boolean(v))
        : [];

      if (items.length === 0) break;
      allBidForms.push(...items);
      if (!fetchAll || items.length < perPage) break;
      currentPage += 1;
      if (currentPage - page > 50) break;
    }

    let upserted = 0;
    const errors: string[] = [];

    for (const bidForm of allBidForms) {
      try {
        const bidFormId = firstText(bidForm.id, bidForm.bid_form_id);
        if (!bidFormId) continue;

        const createdByObject = asObject(bidForm.created_by);
        const createdBy = firstText(
          createdByObject?.name,
          createdByObject?.email,
          createdByObject?.id,
          bidForm.created_by
        );

        await upsertBidForm({
          companyId,
          projectId,
          bidPackageId,
          bidFormId,
          name: firstText(bidForm.name, bidForm.title),
          status: firstText(bidForm.status),
          createdBy,
          sourceCreatedAt: readString(bidForm.created_at),
          payload: bidForm,
        });

        upserted += 1;
      } catch (error: unknown) {
        const id = firstText(bidForm.id, bidForm.bid_form_id) || 'unknown';
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`bid_form:${id} => ${message}`);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Bid forms sync complete',
      data: {
        companyId,
        projectId,
        bidPackageId,
        fetched: allBidForms.length,
        upserted,
        errors,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    const help =
      lower.includes('error 403') || lower.includes('sufficient access')
        ? 'Procore denied access. Grant this user/token read access to Bidding/Bid Packages/Bid Forms on the project, then reconnect Procore.'
        : 'Verify that projectId and bidPackageId belong together in Procore and that your token has access to Bidding for that project.';
    return NextResponse.json(
      { success: false, error: `Failed to sync bid forms: ${message}`, help },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const body = JSON.stringify({
    projectId: url.searchParams.get('projectId') || undefined,
    bidPackageId: url.searchParams.get('bidPackageId') || undefined,
    companyId: url.searchParams.get('companyId') || undefined,
    fetchAll: String(url.searchParams.get('fetchAll') || '').toLowerCase() !== 'false',
    page: url.searchParams.get('page') || undefined,
    perPage: url.searchParams.get('perPage') || undefined,
    search: url.searchParams.get('search') || undefined,
    view: url.searchParams.get('view') || undefined,
    sort: url.searchParams.get('sort') || undefined,
    excludedBidFormId: url.searchParams.get('excludedBidFormId') || undefined,
  });

  return POST(
    new Request(request.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
  );
}
