import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { makeRequest, procoreConfig } from '@/lib/procore';
import { getCanonicalProjectIdsForCompany } from '@/lib/procoreCanonicalProjectIds';
import {
  ensureProcoreProjectVendorsTable,
  softDeleteProjectVendorsNotInSet,
  toProjectVendorRow,
  upsertProcoreProjectVendor,
} from '@/lib/procoreProjectVendors';

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' ? (value as JsonObject) : null;
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

async function fetchProjectVendorsPage(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  page: number;
  perPage: number;
  isActiveOnly: boolean;
}) {
  const { accessToken, companyId, projectId, page, perPage, isActiveOnly } = params;
  const encodedProjectId = encodeURIComponent(projectId);
  const query = new URLSearchParams({
    page: String(page),
    per_page: String(perPage),
    view: 'extended',
  });
  if (isActiveOnly) query.set('filters[is_active]', 'true');

  const endpoints = [
    { endpoint: `/rest/v1.1/projects/${encodedProjectId}/vendors?${query.toString()}`, version: 'v1.1' },
    { endpoint: `/rest/v1.0/projects/${encodedProjectId}/vendors?${query.toString()}`, version: 'v1.0' },
  ];

  const failures: string[] = [];
  for (const candidate of endpoints) {
    try {
      const data = await makeRequest(candidate.endpoint, accessToken, undefined, companyId);
      return { data, version: candidate.version, failures };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${candidate.endpoint} => ${message}`);
    }
  }

  throw new Error(failures.join(' | '));
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const companyIdFromBody = String(body?.companyId || '').trim();
    const limitProjects = Math.max(1, Math.min(10000, Number.parseInt(String(body?.limitProjects || '100'), 10) || 100));
    const perPage = Math.min(200, Math.max(1, Number.parseInt(String(body?.perPage || '100'), 10) || 100));
    const fetchAll = body?.fetchAll === true;
    const isActiveOnly = body?.isActiveOnly !== false;

    const cookieStore = await cookies();
    const accessToken = cookieStore.get('procore_access_token')?.value;
    const companyId = String(
      companyIdFromBody || cookieStore.get('procore_company_id')?.value || procoreConfig.companyId || ''
    ).trim();

    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: 'Missing access token. Please login via OAuth.' },
        { status: 401 }
      );
    }

    await ensureProcoreProjectVendorsTable();

    const projectIds = await getCanonicalProjectIdsForCompany(companyId, limitProjects);
    if (projectIds.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'No project IDs found in canonical Procore project staging for this company. Run All Projects Sync first.',
        },
        { status: 400 }
      );
    }

    let projectsScanned = 0;
    let projectsSynced = 0;
    let projectsSkippedAccess = 0;
    let fetched = 0;
    let upserted = 0;
    let feedCustomersUpdated = 0;
    const apiVersionsUsed = new Set<string>();
    const sampleVendors: Array<{ projectId: string; vendorId: string; name: string | null }> = [];
    const warnings: string[] = [];
    const errors: string[] = [];

    for (const projectId of projectIds) {
      projectsScanned += 1;
      let page = 1;
      const seenVendorIds = new Set<string>();
      let projectHadAccessError = false;

      while (true) {
        let result: { data: unknown; version: string; failures: string[] } | null = null;
        try {
          result = await fetchProjectVendorsPage({
            accessToken,
            companyId,
            projectId,
            page,
            perPage,
            isActiveOnly,
          });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          if (isAccessSkippedError(message)) {
            projectHadAccessError = true;
            projectsSkippedAccess += 1;
            if (warnings.length < 25) {
              warnings.push(`project:${projectId} vendors skipped (access): ${message}`);
            }
          } else {
            errors.push(`project:${projectId} vendors => ${message}`);
          }
        }

        if (!result) break;

        apiVersionsUsed.add(result.version);
        const items = unwrapArray(result.data);
        if (items.length === 0) break;
        fetched += items.length;

        for (const item of items) {
          try {
            const row = toProjectVendorRow(companyId, projectId, item);
            if (!row) continue;

            await upsertProcoreProjectVendor(row);
            seenVendorIds.add(row.procoreVendorId);
            upserted += 1;

            if (sampleVendors.length < 50) {
              sampleVendors.push({
                projectId,
                vendorId: row.procoreVendorId,
                name: row.name ?? null,
              });
            }
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`project:${projectId} vendor upsert => ${message}`);
          }
        }

        if (!fetchAll || items.length < perPage) break;
        page += 1;
        if (page > 100) break;
      }

      if (!projectHadAccessError) {
        await softDeleteProjectVendorsNotInSet(companyId, projectId, [...seenVendorIds]);

        projectsSynced += 1;
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Company project vendors sync complete',
      data: {
        companyId,
        projectsLimit: limitProjects,
        projectsScanned,
        projectsSynced,
        projectsSkippedAccess,
        fetched,
        upserted,
        feedCustomersUpdated,
        apiVersionsUsed: [...apiVersionsUsed],
        sampleVendors,
        warnings,
        errors,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: `Failed to sync company project vendors: ${message}` },
      { status: 500 }
    );
  }
}
