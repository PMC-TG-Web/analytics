import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { makeRequest, procoreConfig } from '@/lib/procore';
import {
  ensureProcoreProjectFeedTable,
  extractCustomerFromCustomFields,
  isMeaningfulCustomer,
  upsertProcoreProjectFeed,
} from '@/lib/procoreProjectFeed';

export const dynamic = 'force-dynamic';

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' ? (value as JsonObject) : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNumber(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const str = readString(value);
    if (str && str.trim()) return str;
  }
  return null;
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

async function fetchVendorMap(accessToken: string, companyId: string) {
  const vendorMap: Record<string, string> = {};
  let vendorPage = 1;

  while (true) {
    const endpoint = `/rest/v1.0/vendors?company_id=${companyId}&page=${vendorPage}&per_page=100`;
    const vendorData = await makeRequest(endpoint, accessToken);
    if (!Array.isArray(vendorData) || vendorData.length === 0) break;

    for (const vendor of vendorData) {
      if (vendor?.id && vendor?.name) vendorMap[String(vendor.id)] = String(vendor.name);
    }

    if (vendorData.length < 100) break;
    vendorPage += 1;
    if (vendorPage > 10) break;
  }

  return vendorMap;
}

async function fetchV1ProjectDetail(accessToken: string, companyId: string, projectId: string) {
  try {
    const endpoint = `/rest/v1.0/projects/${projectId}?company_id=${companyId}`;
    const detail = await makeRequest(endpoint, accessToken);
    return asObject(detail);
  } catch {
    return null;
  }
}

async function fetchBidBoardProjectDetail(accessToken: string, companyId: string, bidBoardId: string) {
  try {
    const url = `https://api.procore.com/rest/v2.0/companies/${companyId}/estimating/bid_board_projects/${bidBoardId}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Procore-Company-Id': companyId,
      },
    });
    if (!res.ok) return null;
    const detail = await res.json();
    const detailObj = asObject(detail);
    const nestedData = asObject(detailObj?.data);
    return nestedData || detailObj;
  } catch {
    return null;
  }
}

function resolveV1Customer(project: JsonObject, vendorMap: Record<string, string>) {
  const company = asObject(project.company);
  const customFieldCustomer = extractCustomerFromCustomFields(project.custom_fields);
  if (isMeaningfulCustomer(customFieldCustomer)) {
    return { customer: customFieldCustomer, source: 'custom_field' };
  }

  const directCustomer = readString(project.customer_name) || readString(company?.name) || '';
  if (isMeaningfulCustomer(directCustomer)) {
    return { customer: directCustomer, source: 'project_field' };
  }

  const companyId = readString(company?.id) || (company?.id ? String(company.id) : null);
  const vendorFallback = companyId ? vendorMap[String(companyId)] : '';
  if (isMeaningfulCustomer(vendorFallback)) {
    return { customer: vendorFallback, source: 'vendor_map' };
  }

  return { customer: null, source: null };
}

function resolveBidBoardCustomer(item: JsonObject, vendorMap: Record<string, string>) {
  const client = asObject(item.client);
  const company = asObject(item.company);
  const raw = asObject(item.raw);
  const rawClient = asObject(raw?.client);
  const rawCompany = asObject(raw?.company);

  const customFieldCustomer =
    extractCustomerFromCustomFields(item.custom_fields) ||
    extractCustomerFromCustomFields(raw?.custom_fields);

  if (isMeaningfulCustomer(customFieldCustomer)) {
    return { customer: customFieldCustomer, source: 'custom_field' };
  }

  const directCustomer =
    readString(item.customer_name) ||
    readString(client?.name) ||
    readString(company?.name) ||
    readString(rawClient?.name) ||
    readString(rawCompany?.name) ||
    readString(raw?.customer_name) ||
    '';

  if (isMeaningfulCustomer(directCustomer)) {
    return { customer: directCustomer, source: 'project_field' };
  }

  const companyId = readString(company?.id) || readString(rawCompany?.id);
  if (companyId && isMeaningfulCustomer(vendorMap[String(companyId)])) {
    return { customer: vendorMap[String(companyId)], source: 'vendor_map' };
  }

  const clientId = readString(client?.id) || readString(rawClient?.id);
  if (clientId && isMeaningfulCustomer(vendorMap[String(clientId)])) {
    return { customer: vendorMap[String(clientId)], source: 'vendor_map' };
  }

  return { customer: null, source: null };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { fetchAll = true, companyId: bodyCompanyId } = body;

    const cookieStore = await cookies();
    const accessToken = cookieStore.get('procore_access_token')?.value;
    const companyId = String(bodyCompanyId || cookieStore.get('procore_company_id')?.value || procoreConfig.companyId).trim();

    if (!accessToken) {
      return NextResponse.json({ success: false, error: 'Missing access token. Please login via OAuth.' }, { status: 401 });
    }

    await ensureProcoreProjectFeedTable();

    const results = {
      v1Fetched: 0,
      bidBoardFetched: 0,
      v1DetailFetched: 0,
      bidBoardDetailFetched: 0,
      upserted: 0,
      errors: [] as string[],
    };

    const allV1Projects: JsonObject[] = [];
    let page = 1;
    while (true) {
      const endpoint = `/rest/v1.0/projects?company_id=${companyId}&page=${page}&per_page=100`;
      const data = await makeRequest(endpoint, accessToken);
      if (!Array.isArray(data) || data.length === 0) break;
      allV1Projects.push(...data.map(asObject).filter((value): value is JsonObject => Boolean(value)));
      if (data.length < 100 || !fetchAll) break;
      page += 1;
      if (page > 20) break;
    }

    const allBidBoardProjects: JsonObject[] = [];
    page = 1;
    while (true) {
      const url = `https://api.procore.com/rest/v2.0/companies/${companyId}/estimating/bid_board_projects?page=${page}&per_page=100`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Procore-Company-Id': companyId,
        },
      });
      if (!res.ok) break;
      const json = await res.json();
      const nestedData = asObject(json)?.data;
      const items = Array.isArray(json)
        ? json
        : Array.isArray(nestedData)
          ? nestedData
          : [];
      if (items.length === 0) break;
      allBidBoardProjects.push(...items.map(asObject).filter((value): value is JsonObject => Boolean(value)));
      if (items.length < 100 || !fetchAll) break;
      page += 1;
      if (page > 20) break;
    }

    results.v1Fetched = allV1Projects.length;
    results.bidBoardFetched = allBidBoardProjects.length;

    let vendorMap: Record<string, string> = {};
    try {
      vendorMap = await fetchVendorMap(accessToken, companyId);
    } catch {
      console.warn('[PROJECTS-FEED] Vendor map unavailable for this run.');
    }

    for (const project of allV1Projects) {
      try {
        const procoreId = readString(project.id) || (project.id ? String(project.id) : '');
        if (!procoreId) continue;

        const v1Detail = await fetchV1ProjectDetail(accessToken, companyId, procoreId);
        if (v1Detail) {
          results.v1DetailFetched += 1;
        }
        const payloadRecord = v1Detail || project;

        const { customer, source } = resolveV1Customer(payloadRecord, vendorMap);

        await upsertProcoreProjectFeed({
          // Curated promoted fields for fast querying/sorting while keeping full payload in JSON.
          companyId,
          syncSource: 'procore_v1_projects',
          externalId: procoreId,
          procoreId,
          projectNumber:
            readString(payloadRecord.project_number) ||
            (payloadRecord.project_number ? String(payloadRecord.project_number) : null),
          projectName:
            readString(payloadRecord.name) ||
            readString(payloadRecord.display_name) ||
            'Untitled Procore Project',
          status:
            readString(payloadRecord.status) ||
            readString(asObject(payloadRecord.project_status)?.name) ||
            readString(asObject(payloadRecord.project_stage)?.name) ||
            null,
          customer,
          customerSource: source,
          officeName: firstString(asObject(payloadRecord.office)?.name, payloadRecord.office_name),
          city: firstString(payloadRecord.city, asObject(payloadRecord.address)?.city),
          stateCode: firstString(
            payloadRecord.state_code,
            payloadRecord.state,
            asObject(payloadRecord.address)?.state_code,
            asObject(payloadRecord.address)?.state
          ),
          countryCode: firstString(
            payloadRecord.country_code,
            payloadRecord.country,
            asObject(payloadRecord.address)?.country_code,
            asObject(payloadRecord.address)?.country
          ),
          stageName: firstString(asObject(payloadRecord.project_stage)?.name),
          dueDate: firstString(payloadRecord.due_date),
          createdOn: firstString(payloadRecord.created_at, payloadRecord.created_on),
          sourceId: firstText(payloadRecord.id, payloadRecord.project_id),
          sourceName: firstString(payloadRecord.name, payloadRecord.display_name),
          sourceCreatedBy: firstText(
            asObject(payloadRecord.created_by)?.name,
            asObject(payloadRecord.created_by)?.email,
            asObject(payloadRecord.created_by)?.id,
            payloadRecord.created_by
          ),
          sourceCreatedAt: firstString(payloadRecord.created_at, payloadRecord.created_on),
          lastModifiedAt:
            readString(payloadRecord.updated_at) ||
            readString(payloadRecord.last_modified_at) ||
            null,
          estimatedValue: readNumber(payloadRecord.value) ?? readNumber(payloadRecord.estimated_value),
          softDeleted: Boolean(payloadRecord.deleted_at),
          payload: payloadRecord,
        });

        results.upserted += 1;
      } catch (error: unknown) {
        const id = readString(project.id) || (project.id ? String(project.id) : 'unknown');
        const message = error instanceof Error ? error.message : String(error);
        results.errors.push(`v1:${id} => ${message}`);
      }
    }

    for (const item of allBidBoardProjects) {
      try {
        const externalId = readString(item.id) || (item.id ? String(item.id) : '');
        if (!externalId) continue;

        const bidBoardDetail = await fetchBidBoardProjectDetail(accessToken, companyId, externalId);
        if (bidBoardDetail) {
          results.bidBoardDetailFetched += 1;
        }
        const payloadRecord = bidBoardDetail || item;

        const procoreProjectId =
          readString(payloadRecord.project_id) ||
          (payloadRecord.project_id ? String(payloadRecord.project_id) : null);
        const { customer, source } = resolveBidBoardCustomer(payloadRecord, vendorMap);

        await upsertProcoreProjectFeed({
          companyId,
          syncSource: 'procore_v2_bid_board',
          externalId,
          procoreId: procoreProjectId,
          projectNumber:
            readString(payloadRecord.project_number) ||
            (payloadRecord.project_number ? String(payloadRecord.project_number) : null),
          projectName: readString(payloadRecord.name) || 'Untitled Bid Board Project',
          status:
            readString(payloadRecord.status) ||
            readString(asObject(payloadRecord.project_status)?.name) ||
            null,
          customer,
          customerSource: source,
          officeName: firstString(asObject(payloadRecord.office)?.name, payloadRecord.office_name),
          city: firstString(payloadRecord.city, asObject(payloadRecord.address)?.city),
          stateCode: firstString(
            payloadRecord.state_code,
            payloadRecord.state,
            asObject(payloadRecord.address)?.state_code,
            asObject(payloadRecord.address)?.state
          ),
          countryCode: firstString(
            payloadRecord.country_code,
            payloadRecord.country,
            asObject(payloadRecord.address)?.country_code,
            asObject(payloadRecord.address)?.country
          ),
          stageName: firstString(asObject(payloadRecord.project_stage)?.name),
          dueDate: firstString(payloadRecord.due_date),
          createdOn: firstString(payloadRecord.created_at, payloadRecord.created_on),
          sourceId: firstText(payloadRecord.id, payloadRecord.project_id),
          sourceName: firstString(payloadRecord.name, payloadRecord.display_name),
          sourceCreatedBy: firstText(
            asObject(payloadRecord.created_by)?.name,
            asObject(payloadRecord.created_by)?.email,
            asObject(payloadRecord.created_by)?.id,
            payloadRecord.created_by
          ),
          sourceCreatedAt: firstString(payloadRecord.created_at, payloadRecord.created_on),
          lastModifiedAt:
            readString(payloadRecord.updated_at) ||
            readString(payloadRecord.last_modified_at) ||
            null,
          estimatedValue: readNumber(payloadRecord.value) ?? readNumber(payloadRecord.estimated_value),
          softDeleted: Boolean(payloadRecord.deleted_at || payloadRecord.archived_at),
          payload: payloadRecord,
        });

        results.upserted += 1;
      } catch (error: unknown) {
        const id = readString(item.id) || (item.id ? String(item.id) : 'unknown');
        const message = error instanceof Error ? error.message : String(error);
        results.errors.push(`bid:${id} => ${message}`);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Procore project feed sync complete',
      data: results,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: `Failed to sync Procore projects feed: ${message}` },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const fetchAllParam = (url.searchParams.get('fetchAll') || 'true').toLowerCase();
  const fetchAll = !(fetchAllParam === 'false' || fetchAllParam === '0');
  const companyId = url.searchParams.get('companyId');

  const body = JSON.stringify({
    fetchAll,
    ...(companyId ? { companyId } : {}),
  });

  return POST(
    new Request(request.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
  );
}
