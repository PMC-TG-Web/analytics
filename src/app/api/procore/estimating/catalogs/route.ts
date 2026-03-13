import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { procoreConfig } from "@/lib/procore";

const DEFAULT_ESTIMATING_BASE_URL =
  "https://estimating-esticom-ccbd079470ce2b6.na-east-01-tugboat.procoretech-qa.com";
const FALLBACK_ESTIMATING_BASE_URL =
  "https://estimating-esticom-829a58c093c92de.na-east-01-tugboat.procoretech-qa.com";

function parseRows(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  if (json && typeof json === "object") {
    const data = (json as { data?: unknown }).data;
    if (Array.isArray(data)) return data as Record<string, unknown>[];

    const items = (json as { items?: unknown }).items;
    if (Array.isArray(items)) return items as Record<string, unknown>[];
  }
  return [];
}

function collectNestedCatalogIds(node: unknown, out: Set<string>) {
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  const rawId = obj.id;
  if (typeof rawId === "string" || typeof rawId === "number") {
    out.add(String(rawId));
  }

  const children = obj.catalogs;
  if (Array.isArray(children)) {
    for (const child of children) {
      collectNestedCatalogIds(child, out);
    }
  }
}

function buildNumericRanges(values: number[]): Array<{ start: number; end: number; count: number }> {
  if (values.length === 0) return [];
  const ranges: Array<{ start: number; end: number; count: number }> = [];
  let start = values[0];
  let prev = values[0];

  for (let i = 1; i < values.length; i += 1) {
    const cur = values[i];
    if (cur === prev + 1) {
      prev = cur;
      continue;
    }

    ranges.push({ start, end: prev, count: prev - start + 1 });
    start = cur;
    prev = cur;
  }

  ranges.push({ start, end: prev, count: prev - start + 1 });
  return ranges;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const cookieStore = await cookies();

    const accessToken = body.accessToken || cookieStore.get("procore_access_token")?.value;
    const companyId = String(
      body.companyId || cookieStore.get("procore_company_id")?.value || procoreConfig.companyId || ""
    ).trim();
    const startPage = Math.max(Number(body.page) || 1, 1);
    const perPage = Math.min(Math.max(Number(body.perPage) || 100, 1), 200);
    const maxPages = Math.min(Math.max(Number(body.maxPages) || 50, 1), 200);

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

    const attempted: Array<{ host: string; url: string; status?: number; error?: string }> = [];

    for (const host of hostCandidates) {
      const endpointBases = [
        `${host}/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/catalogs`,
        `${host}/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/catalog`,
        `${host}/rest/v1.0/companies/${encodeURIComponent(companyId)}/estimating/catalogs`,
        `${host}/rest/v1.0/companies/${encodeURIComponent(companyId)}/estimating/catalog`,
      ];

      for (const endpointBase of endpointBases) {
        const allRows: Record<string, unknown>[] = [];
        let currentPage = startPage;
        let pagesFetched = 0;
        let endpointWorked = false;

        while (pagesFetched < maxPages) {
          const params = new URLSearchParams({
            page: String(currentPage),
            per_page: String(perPage),
          });

          const url = `${endpointBase}?${params.toString()}`;

          try {
            const response = await fetch(url, {
              method: "GET",
              headers,
              cache: "no-store",
            });

            const text = await response.text();

            if (!response.ok) {
              attempted.push({ host, url, status: response.status, error: text || "Request failed" });
              if (response.status === 404) break;

              return NextResponse.json(
                {
                  error: "Failed to fetch estimating catalogs",
                  details: `Estimating API error ${response.status}: ${text}`,
                  url,
                },
                { status: response.status }
              );
            }

            endpointWorked = true;

            let json: unknown = null;
            try {
              json = text ? JSON.parse(text) : null;
            } catch {
              json = null;
            }

            const pageRows = parseRows(json);
            if (pageRows.length === 0) break;

            allRows.push(...pageRows);
            pagesFetched += 1;

            if (pageRows.length < perPage) break;
            currentPage += 1;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            attempted.push({ host, url, error: message });
            break;
          }
        }

        if (!endpointWorked) {
          continue;
        }

        const catalogIds = Array.from(
          new Set(
            allRows
              .map((row) => {
                const raw = row.id ?? row.catalog_id ?? row.catalogId;
                return typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
              })
              .filter(Boolean)
          )
        );

        const allCatalogNodeIdsSet = new Set<string>();
        for (const row of allRows) {
          collectNestedCatalogIds(row, allCatalogNodeIdsSet);
        }
        const allCatalogNodeIds = Array.from(allCatalogNodeIdsSet);

        const childCatalogIds = allCatalogNodeIds.filter((id) => !catalogIds.includes(id));

        const numericCatalogIds = Array.from(
          new Set(
            catalogIds
              .map((id) => Number(id))
              .filter((id) => Number.isFinite(id) && Number.isInteger(id))
          )
        ).sort((a, b) => a - b);

        const numericAllCatalogNodeIds = Array.from(
          new Set(
            allCatalogNodeIds
              .map((id) => Number(id))
              .filter((id) => Number.isFinite(id) && Number.isInteger(id))
          )
        ).sort((a, b) => a - b);

        const catalogIdRanges = buildNumericRanges(numericCatalogIds);
        const allCatalogNodeIdRanges = buildNumericRanges(numericAllCatalogNodeIds);
        const minCatalogId = numericCatalogIds.length > 0 ? numericCatalogIds[0] : null;
        const maxCatalogId = numericCatalogIds.length > 0 ? numericCatalogIds[numericCatalogIds.length - 1] : null;
        const minAllCatalogNodeId =
          numericAllCatalogNodeIds.length > 0 ? numericAllCatalogNodeIds[0] : null;
        const maxAllCatalogNodeId =
          numericAllCatalogNodeIds.length > 0
            ? numericAllCatalogNodeIds[numericAllCatalogNodeIds.length - 1]
            : null;

        const catalogs = allRows.map((row) => ({
          id: row.id ?? row.catalog_id ?? null,
          name: row.name ?? row.catalog_name ?? null,
          code: row.code ?? row.catalog_code ?? null,
          source: row,
        }));

        return NextResponse.json({
          success: true,
          source: "estimating.catalogs.by_company",
          companyId,
          endpointBase,
          host,
          startPage,
          perPage,
          maxPages,
          pagesFetched,
          count: allRows.length,
          distinctCatalogIds: catalogIds.length,
          catalogIds,
          allCatalogNodeIds,
          childCatalogIds,
          distinctAllCatalogNodeIds: allCatalogNodeIds.length,
          numericCatalogIds,
          numericAllCatalogNodeIds,
          minCatalogId,
          maxCatalogId,
          catalogIdRanges,
          minAllCatalogNodeId,
          maxAllCatalogNodeId,
          allCatalogNodeIdRanges,
          catalogs,
          attempted,
        });
      }
    }

    return NextResponse.json(
      {
        error: "Failed to fetch estimating catalogs",
        details: "All known endpoints failed or returned 404.",
        attempted,
      },
      { status: 404 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: "Failed to test estimating catalogs by company",
        details: message,
      },
      { status: 500 }
    );
  }
}
