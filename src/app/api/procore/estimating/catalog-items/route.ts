import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { procoreConfig } from "@/lib/procore";

const DEFAULT_ESTIMATING_BASE_URL =
  "https://estimating-esticom-ccbd079470ce2b6.na-east-01-tugboat.procoretech-qa.com";
const FALLBACK_ESTIMATING_BASE_URL =
  "https://estimating-esticom-829a58c093c92de.na-east-01-tugboat.procoretech-qa.com";

function parseItems(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  if (json && typeof json === "object") {
    const data = (json as { data?: unknown }).data;
    if (Array.isArray(data)) return data as Record<string, unknown>[];

    const items = (json as { items?: unknown }).items;
    if (Array.isArray(items)) return items as Record<string, unknown>[];
  }
  return [];
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const cookieStore = await cookies();

    const accessToken = body.accessToken || cookieStore.get("procore_access_token")?.value;
    const companyId = String(
      body.companyId || cookieStore.get("procore_company_id")?.value || procoreConfig.companyId || ""
    ).trim();
    const catalogId = String(body.catalogId || "").trim();
    const page = Math.max(Number(body.page) || 1, 1);
    const perPage = Math.min(Math.max(Number(body.perPage) || 100, 1), 200);

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

    if (!catalogId) {
      return NextResponse.json({ error: "Missing catalogId." }, { status: 400 });
    }

    const baseUrl = String(body.baseUrl || process.env.PROCORE_ESTIMATING_API_URL || DEFAULT_ESTIMATING_BASE_URL)
      .trim()
      .replace(/\/$/, "");

    const hostCandidates = Array.from(
      new Set(
        [
          baseUrl,
          String(process.env.PROCORE_ESTIMATING_API_URL || "").trim(),
          DEFAULT_ESTIMATING_BASE_URL,
          FALLBACK_ESTIMATING_BASE_URL,
          "https://qa-estimating.procore.com",
          String(procoreConfig.apiUrl || "").trim(),
          "https://api.procore.com",
        ]
          .map((host) => host.replace(/\/$/, ""))
          .filter(Boolean)
      )
    );

    const headers = {
      Authorization: `Bearer ${String(accessToken).trim()}`,
      Accept: "application/json",
      "Procore-Company-Id": companyId,
    };

    const attempted: Array<{ url: string; status?: number; error?: string }> = [];

    for (const host of hostCandidates) {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
        catalog_id: catalogId,
      });

      const paramsFilterStyle = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
      });
      paramsFilterStyle.set("filters[catalog_id]", catalogId);

      const paramsAlt = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
        catalog: catalogId,
      });

      const endpointCandidates = [
        // Catalog-scoped item endpoints (most common)
        `${host}/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/catalogs/${encodeURIComponent(catalogId)}/items?page=${page}&per_page=${perPage}`,
        `${host}/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/catalog/${encodeURIComponent(catalogId)}/items?page=${page}&per_page=${perPage}`,
        `${host}/rest/v1.0/companies/${encodeURIComponent(companyId)}/estimating/catalogs/${encodeURIComponent(catalogId)}/items?page=${page}&per_page=${perPage}`,
        `${host}/rest/v1.0/companies/${encodeURIComponent(companyId)}/estimating/catalog/${encodeURIComponent(catalogId)}/items?page=${page}&per_page=${perPage}`,
        // Query-filtered item endpoints
        `${host}/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/catalogs/items?${params.toString()}`,
        `${host}/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/catalog_items?${params.toString()}`,
        `${host}/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/catalog/items?${params.toString()}`,
        `${host}/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/catalogs/items?${paramsFilterStyle.toString()}`,
        `${host}/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/catalogs/items?${paramsAlt.toString()}`,
        `${host}/rest/v1.0/companies/${encodeURIComponent(companyId)}/estimating/catalogs/items?${params.toString()}`,
        `${host}/rest/v1.0/companies/${encodeURIComponent(companyId)}/estimating/catalog_items?${params.toString()}`,
        `${host}/rest/v1.0/companies/${encodeURIComponent(companyId)}/estimating/catalog/items?${params.toString()}`,
        `${host}/rest/v1.0/companies/${encodeURIComponent(companyId)}/estimating/catalogs/items?${paramsFilterStyle.toString()}`,
        `${host}/rest/v1.0/companies/${encodeURIComponent(companyId)}/estimating/catalogs/items?${paramsAlt.toString()}`,
      ];

      for (const url of endpointCandidates) {
        try {
          const response = await fetch(url, {
            method: "GET",
            headers,
            cache: "no-store",
          });

          const text = await response.text();

          if (!response.ok) {
            attempted.push({ url, status: response.status, error: text || "Request failed" });
            if (response.status === 404) continue;
            return NextResponse.json(
              {
                error: "Failed to fetch estimating catalog items by catalog_id",
                details: `Estimating API error ${response.status}: ${text}`,
                url,
              },
              { status: response.status }
            );
          }

          let json: unknown = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = null;
          }

          const items = parseItems(json);

          const catalogAttempted: Array<{ url: string; status?: number; error?: string }> = [];
          let catalogExists: boolean | null = null;
          let catalogData: unknown = null;

          const catalogCandidates = [
            `${host}/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/catalogs/${encodeURIComponent(catalogId)}`,
            `${host}/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/catalog/${encodeURIComponent(catalogId)}`,
            `${host}/rest/v1.0/companies/${encodeURIComponent(companyId)}/estimating/catalogs/${encodeURIComponent(catalogId)}`,
            `${host}/rest/v1.0/companies/${encodeURIComponent(companyId)}/estimating/catalog/${encodeURIComponent(catalogId)}`,
          ];

          for (const catalogUrl of catalogCandidates) {
            try {
              const catalogRes = await fetch(catalogUrl, {
                method: "GET",
                headers,
                cache: "no-store",
              });

              const catalogText = await catalogRes.text();
              if (!catalogRes.ok) {
                catalogAttempted.push({
                  url: catalogUrl,
                  status: catalogRes.status,
                  error: catalogText || "Request failed",
                });
                if (catalogRes.status === 404) continue;
                break;
              }

              let parsedCatalog: unknown = null;
              try {
                parsedCatalog = catalogText ? JSON.parse(catalogText) : null;
              } catch {
                parsedCatalog = null;
              }

              if (parsedCatalog && typeof parsedCatalog === "object" && "data" in parsedCatalog) {
                const data = (parsedCatalog as { data?: unknown }).data;
                catalogData = Array.isArray(data) ? data[0] ?? null : data;
              } else {
                catalogData = parsedCatalog;
              }

              catalogExists = true;
              catalogAttempted.push({ url: catalogUrl, status: catalogRes.status });
              break;
            } catch (catalogErr) {
              const message = catalogErr instanceof Error ? catalogErr.message : String(catalogErr);
              catalogAttempted.push({ url: catalogUrl, error: message });
            }
          }

          if (catalogExists === null) {
            const has404 = catalogAttempted.some((a) => a.status === 404);
            catalogExists = has404 ? false : null;
          }

          return NextResponse.json({
            success: true,
            source: "estimating.catalog_items.by_catalog_id",
            companyId,
            catalogId,
            page,
            perPage,
            endpoint: url,
            count: items.length,
            items,
            raw: json,
            catalogExists,
            catalogData,
            catalogCheckAttempted: catalogAttempted,
            note:
              items.length === 0
                ? "Catalog items endpoint returned no rows for this catalog_id/page. Check catalogExists/catalogData to confirm the catalog is valid in this company."
                : null,
            attempted,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          attempted.push({ url, error: message });
        }
      }
    }

    return NextResponse.json(
      {
        error: "Failed to fetch estimating catalog items by catalog_id",
        details: "All known endpoints failed or returned 404.",
        attempted,
      },
      { status: 404 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: "Failed to test estimating catalog items by catalog_id",
        details: message,
      },
      { status: 500 }
    );
  }
}
