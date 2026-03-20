import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { makeRequest, procoreConfig } from '@/lib/procore';
import { ensureBidFormsTable, upsertBidForm } from '@/lib/procoreBidForms';
import { ensureBidPackagesTable, upsertBidPackage } from '@/lib/procoreBidPackages';
import { ensureProcoreProjectFeedTable } from '@/lib/procoreProjectFeed';

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

async function fetchBidFormsForProjectPage(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  query: URLSearchParams;
}) {
  const { accessToken, companyId, projectId, query } = params;

  const queryWithCompany = new URLSearchParams(query);
  queryWithCompany.set('company_id', companyId);

  const queryWithoutCompany = new URLSearchParams(query);
  queryWithoutCompany.delete('company_id');

  const endpoints = [
    `/rest/v1.0/projects/${encodeURIComponent(projectId)}/bid_forms?${queryWithCompany.toString()}`,
    `/rest/v1.0/projects/${encodeURIComponent(projectId)}/bid_forms?${queryWithoutCompany.toString()}`,
    `/rest/v1.1/projects/${encodeURIComponent(projectId)}/bid_forms?${queryWithCompany.toString()}`,
    `/rest/v1.1/projects/${encodeURIComponent(projectId)}/bid_forms?${queryWithoutCompany.toString()}`,
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

async function fetchBidFormById(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  bidPackageId: string;
  bidFormId: string;
}) {
  const { accessToken, companyId, projectId, bidPackageId, bidFormId } = params;

  const queryWithCompany = new URLSearchParams({ company_id: companyId });
  const queryWithoutCompany = new URLSearchParams();

  const endpoints = [
    // Exact endpoint shape from Procore docs/request snippet
    `/rest/v1.0/projects/${encodeURIComponent(projectId)}/bid_packages/${encodeURIComponent(bidPackageId)}/bid_forms/${encodeURIComponent(bidFormId)}?${queryWithCompany.toString()}`,
    `/rest/v1.0/projects/${encodeURIComponent(projectId)}/bid_packages/${encodeURIComponent(bidPackageId)}/bid_forms/${encodeURIComponent(bidFormId)}?${queryWithoutCompany.toString()}`,
    // Fallback variants that can work across companies/environments
    `/rest/v1.1/projects/${encodeURIComponent(projectId)}/bid_packages/${encodeURIComponent(bidPackageId)}/bid_forms/${encodeURIComponent(bidFormId)}?${queryWithCompany.toString()}`,
    `/rest/v1.1/projects/${encodeURIComponent(projectId)}/bid_packages/${encodeURIComponent(bidPackageId)}/bid_forms/${encodeURIComponent(bidFormId)}?${queryWithoutCompany.toString()}`,
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

async function fetchCompanyBidFormById(params: {
  accessToken: string;
  companyId: string;
  bidId: string;
  bidFormId: string;
}) {
  const { accessToken, companyId, bidId, bidFormId } = params;

  const encodedCompanyId = encodeURIComponent(companyId);
  const encodedBidId = encodeURIComponent(bidId);
  const encodedBidFormId = encodeURIComponent(bidFormId);

  const endpoints = [
    `/rest/v1.0/companies/${encodedCompanyId}/bid/${encodedBidId}/bid_forms/${encodedBidFormId}`,
    `/rest/v1.0/companies/${encodedCompanyId}/bids/${encodedBidId}/bid_forms/${encodedBidFormId}`,
    `/rest/v1.1/companies/${encodedCompanyId}/bid/${encodedBidId}/bid_forms/${encodedBidFormId}`,
    `/rest/v1.1/companies/${encodedCompanyId}/bids/${encodedBidId}/bid_forms/${encodedBidFormId}`,
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

async function fetchCompanyWideBidFormsPage(params: {
  accessToken: string;
  companyId: string;
  query: URLSearchParams;
}) {
  const { accessToken, companyId, query } = params;

  const queryWithCompany = new URLSearchParams(query);
  queryWithCompany.set('company_id', companyId);

  const queryWithoutCompany = new URLSearchParams(query);
  queryWithoutCompany.delete('company_id');

  const endpoints = [
    `/rest/v1.0/bid_forms?${queryWithCompany.toString()}`,
    `/rest/v1.0/bid_forms?${queryWithoutCompany.toString()}`,
    `/rest/v1.1/bid_forms?${queryWithCompany.toString()}`,
    `/rest/v1.1/bid_forms?${queryWithoutCompany.toString()}`,
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

async function fetchBidPackagesForProject(params: {
  accessToken: string;
  projectId: string;
  page: number;
  perPage: number;
}) {
  const { accessToken, projectId, page, perPage } = params;

  const endpoints = [
    `/rest/v1.0/projects/${encodeURIComponent(projectId)}/bid_packages?page=${page}&per_page=${perPage}`,
    `/rest/v1.0/bid_packages?project_id=${encodeURIComponent(projectId)}&page=${page}&per_page=${perPage}`,
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

async function getProjectIdsFromFeed(companyId: string, limitProjects: number) {
  await ensureProcoreProjectFeedTable();
  const rows = await (await import('@/lib/prisma')).prisma.$queryRawUnsafe<Array<{ procore_id: string | null }>>(
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
    const bidPackageId = String(body?.bidPackageId || '').trim();
    const bidId = String(body?.bidId || '').trim();
    const companyIdFromBody = String(body?.companyId || '').trim();
    const bidFormIdFromBody = String(body?.bidFormId || '').trim();
    const limitProjects = Math.max(1, Math.min(10000, Number.parseInt(String(body?.limitProjects || '1000'), 10) || 1000));
    const fetchAll = body?.fetchAll !== false;
    const page = Math.max(1, Number.parseInt(String(body?.page || '1'), 10) || 1);
    const perPage = Math.min(100, Math.max(1, Number.parseInt(String(body?.perPage || '100'), 10) || 100));
    const search = String(body?.search || '').trim();
    const view = String(body?.view || '').trim();
    const sort = String(body?.sort || '').trim();
    const excludedBidFormId = String(body?.excludedBidFormId || '').trim();

    if (!companyWide && !bidFormIdFromBody && (!projectId || !bidPackageId)) {
      return NextResponse.json(
        { success: false, error: 'Missing projectId or bidPackageId (or set companyWide=true).' },
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
    await ensureBidPackagesTable();

    const allBidForms: JsonObject[] = [];
    let currentPage = page;
    const crawlErrors: string[] = [];
    const accessWarnings: string[] = [];
    let skippedProjectsNoBiddingAccess = 0;
    let skippedPackagesNoFormAccess = 0;
    let projectsScanned = 0;
    let bidPackagesDiscovered = 0;
    let projectLevelFormsFallbackUsed = 0;

    if (bidFormIdFromBody) {
      let data: unknown;
      if (bidId) {
        const result = await fetchCompanyBidFormById({
          accessToken,
          companyId,
          bidId,
          bidFormId: bidFormIdFromBody,
        });
        data = result.data;
      } else {
        if (!projectId || !bidPackageId) {
          return NextResponse.json(
            { success: false, error: 'bidFormId lookup requires either bidId, or projectId + bidPackageId.' },
            { status: 400 }
          );
        }
        const result = await fetchBidFormById({
          accessToken,
          companyId,
          projectId,
          bidPackageId,
          bidFormId: bidFormIdFromBody,
        });
        data = result.data;
      }
      const single = asObject(data);
      if (single) allBidForms.push(single);
    } else {
      if (companyWide) {
        // Company-wide direct endpoint is often unavailable (404) in Procore.
        // Crawl through known projects -> bid packages -> bid forms.
        const projectIds = await getProjectIdsFromFeed(companyId, limitProjects);
        if (projectIds.length === 0) {
          return NextResponse.json(
            {
              success: false,
              error: 'No project IDs found in procore_project_feed for this company. Run Projects Feed Sync first so company-wide Bid Forms has project/package context.',
            },
            { status: 400 }
          );
        }
        const seenProjectPackage = new Set<string>();

        for (const projectIdFromFeed of projectIds) {
          projectsScanned += 1;
          let bidPackagesPage = 1;
          while (true) {
            let packageResult: { data: unknown; endpoint: string; failures: string[] } | null = null;
            try {
              packageResult = await fetchBidPackagesForProject({
                accessToken,
                projectId: projectIdFromFeed,
                page: bidPackagesPage,
                perPage,
              });
            } catch (error: unknown) {
              const message = error instanceof Error ? error.message : String(error);
              if (isAccessSkippedError(message)) {
                skippedProjectsNoBiddingAccess += 1;
                if (accessWarnings.length < 25) {
                  accessWarnings.push(`project:${projectIdFromFeed} bid_packages skipped (access): ${message}`);
                }

                // Fallback: some tenants allow project-level bid_forms listing even when bid_packages is restricted.
                let fallbackPage = 1;
                let fallbackSucceeded = false;
                while (true) {
                  const formQuery = new URLSearchParams({
                    page: String(fallbackPage),
                    per_page: String(perPage),
                  });

                  let projectFormsResult: { data: unknown; endpoint: string; failures: string[] } | null = null;
                  try {
                    projectFormsResult = await fetchBidFormsForProjectPage({
                      accessToken,
                      companyId,
                      projectId: projectIdFromFeed,
                      query: formQuery,
                    });
                  } catch (fallbackError: unknown) {
                    const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
                    if (isAccessSkippedError(fallbackMessage)) {
                      if (accessWarnings.length < 25) {
                        accessWarnings.push(`project:${projectIdFromFeed} bid_forms(project-level) skipped (access): ${fallbackMessage}`);
                      }
                    } else {
                      crawlErrors.push(`project:${projectIdFromFeed} bid_forms(project-level) => ${fallbackMessage}`);
                    }
                  }

                  if (!projectFormsResult) break;

                  const projectFormItems = Array.isArray(projectFormsResult.data)
                    ? projectFormsResult.data.map(asObject).filter((v): v is JsonObject => Boolean(v))
                    : [];

                  if (projectFormItems.length === 0) break;
                  allBidForms.push(...projectFormItems);
                  fallbackSucceeded = true;

                  if (!fetchAll || projectFormItems.length < perPage) break;
                  fallbackPage += 1;
                  if (fallbackPage > 50) break;
                }

                if (fallbackSucceeded) {
                  projectLevelFormsFallbackUsed += 1;
                }
              } else {
                crawlErrors.push(`project:${projectIdFromFeed} bid_packages => ${message}`);
              }
            }

            if (!packageResult) break;

            const packageItems = Array.isArray(packageResult.data)
              ? packageResult.data.map(asObject).filter((v): v is JsonObject => Boolean(v))
              : [];

            if (packageItems.length === 0) break;

            for (const pkg of packageItems) {
              const packageId = firstText(pkg.id, pkg.bid_package_id);
              if (!packageId) continue;
              bidPackagesDiscovered += 1;

              await upsertBidPackage({
                companyId,
                projectId: projectIdFromFeed,
                bidPackageId: packageId,
                name: firstText(pkg.name, pkg.title),
                status: firstText(pkg.status),
                sourceCreatedAt: readString(pkg.created_at),
                payload: pkg,
              });

              const key = `${projectIdFromFeed}::${packageId}`;
              if (seenProjectPackage.has(key)) continue;
              seenProjectPackage.add(key);

              let formsPage = 1;
              while (true) {
                const formQuery = new URLSearchParams({
                  page: String(formsPage),
                  per_page: String(perPage),
                });

                let formsResult: { data: unknown; endpoint: string; failures: string[] } | null = null;
                try {
                  formsResult = await fetchBidFormsPage({
                    accessToken,
                    companyId,
                    projectId: projectIdFromFeed,
                    bidPackageId: packageId,
                    query: formQuery,
                  });
                } catch (error: unknown) {
                  const message = error instanceof Error ? error.message : String(error);
                  if (isAccessSkippedError(message)) {
                    skippedPackagesNoFormAccess += 1;
                    if (accessWarnings.length < 25) {
                      accessWarnings.push(`project:${projectIdFromFeed} package:${packageId} bid_forms skipped (access): ${message}`);
                    }
                  } else {
                    crawlErrors.push(`project:${projectIdFromFeed} package:${packageId} bid_forms => ${message}`);
                  }
                }

                if (!formsResult) break;

                const formItems = Array.isArray(formsResult.data)
                  ? formsResult.data.map(asObject).filter((v): v is JsonObject => Boolean(v))
                  : [];

                if (formItems.length === 0) break;
                allBidForms.push(...formItems);

                if (!fetchAll || formItems.length < perPage) break;
                formsPage += 1;
                if (formsPage > 50) break;
              }
            }

            if (!fetchAll || packageItems.length < perPage) break;
            bidPackagesPage += 1;
            if (bidPackagesPage > 50) break;
          }
        }
      } else {
      while (true) {
        const params = new URLSearchParams({
          page: String(currentPage),
          per_page: String(perPage),
        });

        if (search) params.set('search', search);
        if (view) params.set('view', view);
        if (sort) params.set('sort', sort);
        if (excludedBidFormId) params.set('excluded_bid_form_id', excludedBidFormId);

        const { data } = companyWide
          ? await fetchCompanyWideBidFormsPage({
              accessToken,
              companyId,
              query: params,
            })
          : await fetchBidFormsPage({
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
      }
    }

    let upserted = 0;
    const errors: string[] = [...crawlErrors];

    for (const bidForm of allBidForms) {
      try {
        const bidFormId = firstText(bidForm.id, bidForm.bid_form_id);
        if (!bidFormId) continue;

        const derivedProjectId = firstText(
          bidForm.project_id,
          asObject(bidForm.project)?.id,
          projectId
        );
        const derivedBidPackageId = firstText(
          bidForm.bid_package_id,
          asObject(bidForm.bid_package)?.id,
          bidPackageId
        );
        const derivedBidId = firstText(bidForm.bid_id, asObject(bidForm.bid)?.id, bidId);

        const projectIdForUpsert = derivedProjectId || '__company_wide__';
        const bidPackageIdForUpsert = derivedBidPackageId || (derivedBidId ? `__bid__:${derivedBidId}` : '__company_wide__');

        const createdByObject = asObject(bidForm.created_by);
        const createdBy = firstText(
          createdByObject?.name,
          createdByObject?.email,
          createdByObject?.id,
          bidForm.created_by
        );

        await upsertBidForm({
          companyId,
          projectId: projectIdForUpsert,
          bidPackageId: bidPackageIdForUpsert,
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
        companyWide,
        companyId,
        projectId: projectId || null,
        bidPackageId: bidPackageId || null,
        bidId: bidId || null,
        bidFormId: bidFormIdFromBody || null,
        fetched: allBidForms.length,
        upserted,
        projectsLimit: companyWide ? limitProjects : null,
        projectsScanned: companyWide ? projectsScanned : null,
        bidPackagesDiscovered: companyWide ? bidPackagesDiscovered : null,
        skippedProjectsNoBiddingAccess: companyWide ? skippedProjectsNoBiddingAccess : 0,
        skippedPackagesNoFormAccess: companyWide ? skippedPackagesNoFormAccess : 0,
        projectLevelFormsFallbackUsed: companyWide ? projectLevelFormsFallbackUsed : 0,
        warnings: accessWarnings,
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
    companyWide: String(url.searchParams.get('companyWide') || '').toLowerCase() === 'true',
    projectId: url.searchParams.get('projectId') || undefined,
    bidPackageId: url.searchParams.get('bidPackageId') || undefined,
    bidFormId: url.searchParams.get('bidFormId') || undefined,
    bidId: url.searchParams.get('bidId') || undefined,
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
