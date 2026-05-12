import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { procoreConfig } from "@/lib/procore";
import { buildAllowedProcoreHostCandidates } from "@/lib/procoreHosts";

const DEFAULT_ESTIMATING_BASE_URL =
  "https://estimating-esticom-ccbd079470ce2b6.na-east-01-tugboat.procoretech-qa.com";
const FALLBACK_ESTIMATING_BASE_URL =
  "https://estimating-esticom-829a58c093c92de.na-east-01-tugboat.procoretech-qa.com";

const RESERVED_COLUMNS = new Set([
  "id",
  "company_id",
  "item_id",
  "base_url",
  "name",
  "code",
  "cost_code_id",
  "payload",
  "synced_at",
]);

async function ensureEstimatingCatalogItemStagingTable() {
  return;
}

async function upsertEstimatingCatalogItem(params: {
  companyId: string;
  itemId: string;
  baseUrl: string;
  name?: string | null;
  code?: string | null;
  costCodeId?: string | null;
  catalogId?: string | null;
  payload: unknown;
  dynamicFields?: Record<string, unknown>;
}) {
  const { companyId, itemId, baseUrl, name, code, costCodeId, catalogId, payload, dynamicFields = {} } = params;

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO procore_estimating_catalog_item_staging
        (company_id, item_id, base_url, name, code, cost_code_id, catalog_id, payload, dynamic_fields, synced_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, NOW())
      ON CONFLICT (company_id, item_id, base_url)
      DO UPDATE SET
        name = EXCLUDED.name,
        code = EXCLUDED.code,
        cost_code_id = EXCLUDED.cost_code_id,
        catalog_id = EXCLUDED.catalog_id,
        payload = EXCLUDED.payload,
        dynamic_fields = EXCLUDED.dynamic_fields,
        synced_at = NOW()
    `,
    companyId,
    itemId,
    baseUrl,
    name ?? null,
    code ?? null,
    costCodeId ?? null,
    catalogId ?? null,
    JSON.stringify(payload),
    JSON.stringify(dynamicFields)
  );
}

function sanitizeColumnName(key: string): string {
  const snake = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();

  const base = snake || "field";
  const prefixed = /^[0-9]/.test(base) ? `field_${base}` : base;
  const nonReserved = RESERVED_COLUMNS.has(prefixed) ? `payload_${prefixed}` : prefixed;
  return nonReserved.slice(0, 63);
}

function buildDynamicFieldsFromPayload(item: Record<string, unknown>): Record<string, unknown> {
  const dynamic: Record<string, unknown> = {};
  for (const [rawKey, value] of Object.entries(item)) {
    const key = sanitizeColumnName(rawKey);
    if (!key || RESERVED_COLUMNS.has(key)) continue;
    dynamic[key] = value;
  }
  return dynamic;
}

function resolveCostCodeValue(item: Record<string, unknown>): string | null {
  const directCandidates = [item.cost_code, item.costCode, item.cost_code_code, item.costCodeCode];

  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }

  const nestedCandidates = [item.cost_code_object, item.costCodeObject, item.cost_code_details, item.costCodeDetails, item.cost_code_data, item.costCodeData, item.cost_code];

  for (const nested of nestedCandidates) {
    if (!nested || typeof nested !== "object") continue;
    const value = nested as Record<string, unknown>;
    const nestedCodeCandidates = [value.code, value.cost_code, value.number, value.value, value.display];
    for (const candidate of nestedCodeCandidates) {
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
  }

  return null;
}

export async function POST(request: Request) {
  try {
    const toHttpStatus = (status: number) => (status >= 200 && status <= 599 ? status : 502);

    const body = await request.json().catch(() => ({}));
    const cookieStore = await cookies();

    const accessToken = body.accessToken || cookieStore.get("procore_access_token")?.value;
    const companyId = String(body.companyId || cookieStore.get("procore_company_id")?.value || procoreConfig.companyId || '').trim();
    const itemId = String(body.itemId || "").trim();
    const hostCandidates = buildAllowedProcoreHostCandidates({
      requestedOrigin: body.baseUrl,
      extraOrigins: [
        process.env.PROCORE_ESTIMATING_API_URL,
        DEFAULT_ESTIMATING_BASE_URL,
        FALLBACK_ESTIMATING_BASE_URL,
        "https://qa-estimating.procore.com",
        procoreConfig.apiUrl,
        "https://api.procore.com",
      ],
    });
    const storageBaseUrl = hostCandidates.candidates[0] || DEFAULT_ESTIMATING_BASE_URL;
    const startPage = Math.max(Number(body.page) || 1, 1);
    const perPage = Math.min(Math.max(Number(body.perPage) || 100, 1), 200);
    const maxPages = Math.min(Math.max(Number(body.maxPages) || 50, 1), 200);
    const onlyWithCostCode = body.onlyWithCostCode !== false;
    const exactCostCode = String(body.costCode || "").trim();
    const catalogIdFilter = String(body.catalogId || body.catelogId || "").trim();
    const catalogIdMin = Number.isFinite(Number(body.catalogIdMin)) ? Number(body.catalogIdMin) : null;
    const catalogIdMax = Number.isFinite(Number(body.catalogIdMax)) ? Number(body.catalogIdMax) : null;
    const stopOnFirstMatch = body.stopOnFirstMatch !== false && Boolean(exactCostCode);

    if (!accessToken) {
      return NextResponse.json(
        { error: "Missing access token. Please authenticate via OAuth first or provide an access token." },
        { status: 401 }
      );
    }

    if (!companyId) {
      return NextResponse.json(
        { error: "Missing companyId. Set PROCORE_COMPANY_ID or provide companyId in request body." },
        { status: 400 }
      );
    }

    if (hostCandidates.error) {
      return NextResponse.json({ error: hostCandidates.error }, { status: 400 });
    }

    await ensureEstimatingCatalogItemStagingTable();

    const requestHeaders = {
      Authorization: `Bearer ${String(accessToken).trim()}`,
      Accept: "application/json",
      "Procore-Company-Id": companyId,
    };

    const parseArrayPayload = (json: unknown): Record<string, unknown>[] => {
      if (Array.isArray(json)) return json as Record<string, unknown>[];
      if (json && typeof json === "object") {
        const data = (json as { data?: unknown }).data;
        if (Array.isArray(data)) return data as Record<string, unknown>[];
        const items = (json as { items?: unknown }).items;
        if (Array.isArray(items)) return items as Record<string, unknown>[];
      }
      return [];
    };

    const requestTimeoutMs = Math.min(Math.max(Number(body.requestTimeoutMs) || 15000, 3000), 60000);

    const fetchJson = async (url: string) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        const response = await fetch(url, {
          method: "GET",
          headers: requestHeaders,
          cache: "no-store",
          signal: controller.signal,
        });

        const bodyText = await response.text();
        let json: unknown = null;
        try {
          json = bodyText ? JSON.parse(bodyText) : null;
        } catch {
          json = null;
        }

        return {
          ok: response.ok,
          status: response.status,
          bodyText,
          json,
          items: parseArrayPayload(json),
          url,
          networkError: null as string | null,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          status: -1,
          bodyText: message,
          json: null,
          items: [] as Record<string, unknown>[],
          url,
          networkError: message,
        };
      } finally {
        clearTimeout(timeout);
      }
    };

    // Single-item sync path
    if (itemId) {
      const itemCandidates = hostCandidates.candidates.flatMap((host) => [
        `${host}/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/catalogs/items/${encodeURIComponent(itemId)}`,
        `${host}/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/catalog_items/${encodeURIComponent(itemId)}`,
        `${host}/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/catalog/items/${encodeURIComponent(itemId)}`,
        `${host}/rest/v1.0/companies/${encodeURIComponent(companyId)}/estimating/catalogs/items/${encodeURIComponent(itemId)}`,
        `${host}/rest/v1.0/companies/${encodeURIComponent(companyId)}/estimating/catalog_items/${encodeURIComponent(itemId)}`,
        `${host}/rest/v1.0/companies/${encodeURIComponent(companyId)}/estimating/catalog/items/${encodeURIComponent(itemId)}`,
      ]);

      const tried404: string[] = [];
      const networkErrors: Array<{ url: string; message: string }> = [];
      let itemPayload: unknown = null;
      let successfulUrl: string | null = null;

      for (const candidateUrl of itemCandidates) {
        const attempted = await fetchJson(candidateUrl);

        if (attempted.ok) {
          const responseJson = attempted.json;
          itemPayload =
            responseJson && typeof responseJson === "object" && "data" in responseJson
              ? (responseJson as { data: unknown }).data
              : responseJson;
          successfulUrl = candidateUrl;
          break;
        }

        if (attempted.status === 404) {
          tried404.push(candidateUrl);
          continue;
        }

        if (attempted.status === -1) {
          networkErrors.push({ url: candidateUrl, message: attempted.networkError || attempted.bodyText || "Network error" });
          continue;
        }

        return NextResponse.json(
          {
            error: "Failed to fetch estimating catalog item",
            details: `Estimating API error ${attempted.status}: ${attempted.bodyText}`,
            url: candidateUrl,
          },
          { status: toHttpStatus(attempted.status) }
        );
      }

      if (!successfulUrl) {
        const status = networkErrors.length > 0 ? 502 : 404;
        return NextResponse.json(
          {
            error: "Failed to fetch estimating catalog item",
            details:
              networkErrors.length > 0
                ? "All known estimating catalog item endpoints failed with network errors or 404."
                : "All known estimating catalog item endpoints returned 404.",
            tried404,
            networkErrors: networkErrors.slice(0, 10),
          },
          { status }
        );
      }

      const payloadObj = itemPayload && typeof itemPayload === "object" ? (itemPayload as Record<string, unknown>) : {};
      const name = typeof payloadObj.name === "string" ? payloadObj.name : null;
      const code = typeof payloadObj.code === "string" ? payloadObj.code : null;
      const costCodeIdRaw = payloadObj.cost_code_id;
      const costCodeId =
        typeof costCodeIdRaw === "string" || typeof costCodeIdRaw === "number"
          ? String(costCodeIdRaw)
          : null;

      await upsertEstimatingCatalogItem({
        companyId,
        itemId,
        baseUrl: new URL(successfulUrl).origin,
        name,
        code,
        costCodeId,
        catalogId: catalogIdFilter || null,
        payload: itemPayload,
        dynamicFields: payloadObj,
      });

      const counts = await prisma.$queryRawUnsafe<Array<{ row_count: bigint }>>(
        `
          SELECT COUNT(*)::bigint AS row_count
          FROM procore_estimating_catalog_item_staging
          WHERE company_id = $1
            AND item_id = $2
            AND base_url = $3
        `,
        companyId,
        itemId,
        new URL(successfulUrl).origin
      );

      return NextResponse.json({
        success: true,
        mode: "single-item",
        table: "procore_estimating_catalog_item_staging",
        companyId,
        itemId,
        baseUrl: new URL(successfulUrl).origin,
        totalRowsInScope: Number(counts[0]?.row_count || 0),
        item: itemPayload,
        sourceUrl: successfulUrl,
      });
    }

    // Full-catalog sync path
    const allItems: unknown[] = [];
    let keptItems = 0;
    let matchedExactCostCode = 0;
    let skippedNonMatchingCatalogId = 0;
    let skippedOutOfCatalogRange = 0;
    let skippedMissingCostCode = 0;
    let skippedNonMatchingCostCode = 0;
    let stoppedEarly = false;
    let currentPage = startPage;
    let pagesFetched = 0;
    let listMode: "global-list" | "catalog-scoped" = catalogIdFilter ? "catalog-scoped" : "global-list";
    let discoveredListUrl: string | null = null;
    let catalogIds: string[] | null = catalogIdFilter ? [catalogIdFilter] : null;

    while (pagesFetched < maxPages) {
      const params = new URLSearchParams({
        page: String(currentPage),
        per_page: String(perPage),
      });

      let pageItems: Record<string, unknown>[] = [];

      if (listMode === "global-list") {
          const listCandidates = hostCandidates.candidates.flatMap((host) => [
            `${host}/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/catalogs/items`,
            `${host}/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/catalog_items`,
            `${host}/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/catalog/items`,
            `${host}/rest/v1.0/companies/${encodeURIComponent(companyId)}/estimating/catalogs/items`,
            `${host}/rest/v1.0/companies/${encodeURIComponent(companyId)}/estimating/catalog_items`,
            `${host}/rest/v1.0/companies/${encodeURIComponent(companyId)}/estimating/catalog/items`,
          ]);

        const tried404: string[] = [];
        const networkErrors: Array<{ url: string; message: string }> = [];
        let non404Failure: { status: number; bodyText: string; url: string } | null = null;

        for (const baseCandidate of listCandidates) {
          const url = `${baseCandidate}?${params.toString()}`;
          const attempted = await fetchJson(url);

          if (attempted.ok) {
            pageItems = attempted.items;
            discoveredListUrl = baseCandidate;
            break;
          }

          if (attempted.status === 404) {
            tried404.push(url);
            continue;
          }

          if (attempted.status === -1) {
            networkErrors.push({ url, message: attempted.networkError || attempted.bodyText || "Network error" });
            continue;
          }

          non404Failure = { status: attempted.status, bodyText: attempted.bodyText, url };
          break;
        }

        if (non404Failure) {
          return NextResponse.json(
            {
              error: "Failed to fetch estimating catalog items",
              details: `Estimating API error ${non404Failure.status}: ${non404Failure.bodyText}`,
              url: non404Failure.url,
              page: currentPage,
            },
            { status: toHttpStatus(non404Failure.status) }
          );
        }

        if (!discoveredListUrl) {
          if (networkErrors.length > 0 && tried404.length === 0) {
            return NextResponse.json(
              {
                error: "Failed to fetch estimating catalog items",
                details: "All known global catalog list endpoints failed with network errors.",
                networkErrors: networkErrors.slice(0, 10),
              },
              { status: 502 }
            );
          }
          listMode = "catalog-scoped";
        }
      }

      if (listMode === "catalog-scoped") {
        if (!catalogIds) {
          const catalogCandidates = hostCandidates.candidates.flatMap((host) => [
            `${host}/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/catalogs`,
            `${host}/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/catalog`,
            `${host}/rest/v1.0/companies/${encodeURIComponent(companyId)}/estimating/catalogs`,
            `${host}/rest/v1.0/companies/${encodeURIComponent(companyId)}/estimating/catalog`,
          ]);

          let catalogResponseItems: Record<string, unknown>[] | null = null;
          let catalogFailure: { status: number; bodyText: string; url: string } | null = null;
          const catalog404Urls: string[] = [];

          for (const catalogBase of catalogCandidates) {
            const catalogUrl = `${catalogBase}?per_page=200`;
            const attemptedCatalogs = await fetchJson(catalogUrl);

            if (attemptedCatalogs.ok) {
              catalogResponseItems = attemptedCatalogs.items;
              break;
            }

            if (attemptedCatalogs.status !== 404) {
              if (attemptedCatalogs.status === -1) {
                catalog404Urls.push(`${catalogUrl} (network error: ${attemptedCatalogs.networkError || attemptedCatalogs.bodyText || "unknown"})`);
                continue;
              }

              catalogFailure = {
                status: attemptedCatalogs.status,
                bodyText: attemptedCatalogs.bodyText,
                url: catalogUrl,
              };
              break;
            }

            catalog404Urls.push(catalogUrl);
          }

          if (catalogFailure) {
            return NextResponse.json(
              {
                error: "Failed to fetch estimating catalogs",
                details: `Estimating API error ${catalogFailure.status}: ${catalogFailure.bodyText}`,
                url: catalogFailure.url,
              },
              { status: toHttpStatus(catalogFailure.status) }
            );
          }

          if (!catalogResponseItems && catalog404Urls.length > 0) {
            return NextResponse.json(
              {
                error: "Failed to fetch estimating catalogs",
                details: "All known estimating catalog list endpoints returned 404.",
                triedUrls: catalog404Urls,
              },
              { status: 404 }
            );
          }

          catalogIds = (catalogResponseItems || [])
            .map((catalog) => {
              const rawId = catalog?.id;
              return typeof rawId === "string" || typeof rawId === "number" ? String(rawId) : "";
            })
            .filter(Boolean);
        }

        if (!catalogIds || catalogIds.length === 0) {
          break;
        }

        for (const catalogId of catalogIds) {
          const scopedCandidates = hostCandidates.candidates.flatMap((host) => [
            `${host}/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/catalogs/${encodeURIComponent(catalogId)}/items`,
            `${host}/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/catalog/${encodeURIComponent(catalogId)}/items`,
            `${host}/rest/v1.0/companies/${encodeURIComponent(companyId)}/estimating/catalogs/${encodeURIComponent(catalogId)}/items`,
            `${host}/rest/v1.0/companies/${encodeURIComponent(companyId)}/estimating/catalog/${encodeURIComponent(catalogId)}/items`,
          ]);

          for (const scopedBase of scopedCandidates) {
            const scopedUrl = `${scopedBase}?${params.toString()}`;
            const attemptedScoped = await fetchJson(scopedUrl);

            if (attemptedScoped.ok) {
              pageItems.push(...attemptedScoped.items);
              break;
            }

            if (attemptedScoped.status === -1) {
              continue;
            }

            if (attemptedScoped.status !== 404) {
              return NextResponse.json(
                {
                  error: "Failed to fetch catalog-scoped estimating items",
                  details: `Estimating API error ${attemptedScoped.status}: ${attemptedScoped.bodyText}`,
                  url: scopedUrl,
                  page: currentPage,
                  catalogId,
                },
                { status: toHttpStatus(attemptedScoped.status) }
              );
            }
          }
        }
      }

      if (pageItems.length === 0) {
        break;
      }

      allItems.push(...pageItems);

      for (const item of pageItems as Record<string, unknown>[]) {
        const resolvedItemIdRaw = item?.id;
        const resolvedItemId =
          typeof resolvedItemIdRaw === "string" || typeof resolvedItemIdRaw === "number"
            ? String(resolvedItemIdRaw)
            : "";

        if (!resolvedItemId) continue;

        const name = typeof item.name === "string" ? item.name : null;
        const code = typeof item.code === "string" ? item.code : null;
        const costCodeIdRaw = item.cost_code_id;
        const costCodeId =
          typeof costCodeIdRaw === "string" || typeof costCodeIdRaw === "number"
            ? String(costCodeIdRaw)
            : null;
        const catalogIdRaw = item.catalog_id ?? item.catalogId;
        const resolvedCatalogId =
          typeof catalogIdRaw === "string" || typeof catalogIdRaw === "number"
            ? String(catalogIdRaw)
            : "";
        const resolvedCatalogIdNum = Number(resolvedCatalogId);
        const resolvedCostCode = resolveCostCodeValue(item);

        if (catalogIdFilter && resolvedCatalogId !== catalogIdFilter) {
          skippedNonMatchingCatalogId += 1;
          continue;
        }

        if ((catalogIdMin !== null || catalogIdMax !== null)) {
          if (!Number.isFinite(resolvedCatalogIdNum)) {
            skippedOutOfCatalogRange += 1;
            continue;
          }
          if (catalogIdMin !== null && resolvedCatalogIdNum < catalogIdMin) {
            skippedOutOfCatalogRange += 1;
            continue;
          }
          if (catalogIdMax !== null && resolvedCatalogIdNum > catalogIdMax) {
            skippedOutOfCatalogRange += 1;
            continue;
          }
        }

        if (onlyWithCostCode && !costCodeId && !resolvedCostCode) {
          skippedMissingCostCode += 1;
          continue;
        }

        if (exactCostCode && resolvedCostCode !== exactCostCode) {
          skippedNonMatchingCostCode += 1;
          continue;
        }

        if (exactCostCode && resolvedCostCode === exactCostCode) {
          matchedExactCostCode += 1;
        }

        await upsertEstimatingCatalogItem({
          companyId,
          itemId: resolvedItemId,
          baseUrl: storageBaseUrl,
          name,
          code,
          costCodeId,
          catalogId: resolvedCatalogId || catalogIdFilter || null,
          payload: item,
          dynamicFields: buildDynamicFieldsFromPayload(item),
        });
        keptItems += 1;

        if (stopOnFirstMatch && matchedExactCostCode > 0) {
          stoppedEarly = true;
          break;
        }
      }

      if (stoppedEarly) {
        break;
      }

      pagesFetched += 1;

      if (pageItems.length < perPage) {
        break;
      }

      currentPage += 1;
    }

    const counts = await prisma.$queryRawUnsafe<Array<{ row_count: bigint }>>(
      `
        SELECT COUNT(*)::bigint AS row_count
        FROM procore_estimating_catalog_item_staging
        WHERE company_id = $1
          AND base_url = $2
      `,
      companyId,
      storageBaseUrl
    );

    return NextResponse.json({
      success: true,
      mode: "full-catalog",
      catalogIdFilter: catalogIdFilter || null,
      catalogIdMin,
      catalogIdMax,
      onlyWithCostCode,
      exactCostCode: exactCostCode || null,
      stopOnFirstMatch,
      stoppedEarly,
      matchedExactCostCode,
      listMode,
      discoveredListUrl,
      attemptedHosts: hostCandidates.candidates,
      table: "procore_estimating_catalog_item_staging",
      companyId,
      baseUrl: storageBaseUrl,
      pagesFetched,
      totalFetched: allItems.length,
      totalKept: keptItems,
      skippedNonMatchingCatalogId,
      skippedOutOfCatalogRange,
      skippedMissingCostCode,
      skippedNonMatchingCostCode,
      totalRowsInScope: Number(counts[0]?.row_count || 0),
      sample: allItems.slice(0, 5),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Procore estimating catalog item sync API error:", message);
    return NextResponse.json(
      {
        error: "Failed to sync estimating catalog item",
        details: message,
      },
      { status: 500 }
    );
  }
}
