// POST /api/procore/sync/estimating-catalogs
// Fetches all estimating catalogs from the Procore Estimating API and caches them
// in procore_estimating_catalogs_live.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { procoreConfig, getClientCredentialsToken } from "@/lib/procore";
import { prisma } from "@/lib/prisma";
import { buildAllowedProcoreHostCandidates } from "@/lib/procoreHosts";

export const dynamic = "force-dynamic";

const DEFAULT_ESTIMATING_BASE_URL =
  "https://estimating-esticom-ccbd079470ce2b6.na-east-01-tugboat.procoretech-qa.com";
const FALLBACK_ESTIMATING_BASE_URL =
  "https://estimating-esticom-829a58c093c92de.na-east-01-tugboat.procoretech-qa.com";

function readText(value: unknown): string {
  return String(value ?? "").trim();
}

function asArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data as Record<string, unknown>[];
    if (Array.isArray(obj.items)) return obj.items as Record<string, unknown>[];
  }
  return [];
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const cookieStore = await cookies();

    const userAccessToken = readText(
      cookieStore.get("procore_access_token")?.value || body?.accessToken
    );
    const companyId = readText(
      body?.companyId ||
        cookieStore.get("procore_company_id")?.value ||
        procoreConfig.companyId ||
        ""
    );

    let accessToken: string;
    if (userAccessToken) {
      accessToken = userAccessToken;
    } else {
      try {
        accessToken = await getClientCredentialsToken();
      } catch {
        return NextResponse.json(
          { success: false, error: "Missing access token. Please authenticate via OAuth first." },
          { status: 401 }
        );
      }
    }


    if (!companyId) {
      return NextResponse.json({ success: false, error: "Missing companyId." }, { status: 400 });
    }

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

    if (hostCandidates.error) {
      return NextResponse.json({ success: false, error: hostCandidates.error }, { status: 400 });
    }

    const headers = {
      Authorization: `Bearer ${String(accessToken).trim()}`,
      Accept: "application/json",
      "Procore-Company-Id": companyId,
    };

    const perPage = 200;
    let totalUpserted = 0;
    let successfulHost: string | null = null;
    let successfulEndpoint: string | null = null;

    for (const host of hostCandidates.candidates) {
      const endpointBases = [
        `${host}/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/catalogs`,
        `${host}/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/catalog`,
        `${host}/rest/v1.0/companies/${encodeURIComponent(companyId)}/estimating/catalogs`,
        `${host}/rest/v1.0/companies/${encodeURIComponent(companyId)}/estimating/catalog`,
      ];

      let hostWorked = false;

      for (const endpointBase of endpointBases) {
        let page = 1;
        let endpointWorked = false;

        while (true) {
          const url = `${endpointBase}?page=${page}&per_page=${perPage}`;

          try {
            const response = await fetch(url, {
              method: "GET",
              headers,
              cache: "no-store",
            });

            const text = await response.text();

            if (!response.ok) {
              if (response.status === 404) break;
              return NextResponse.json(
                {
                  success: false,
                  error: `Estimating API error ${response.status}`,
                  details: text,
                  url,
                },
                { status: response.status }
              );
            }

            endpointWorked = true;
            hostWorked = true;
            successfulHost = host;
            successfulEndpoint = endpointBase;

            let json: unknown = null;
            try { json = text ? JSON.parse(text) : null; } catch { json = null; }

            const rows = asArray(json);
            if (rows.length === 0) break;

            for (const row of rows) {
              const catalogId = String(row.id ?? row.catalog_id ?? "").trim();
              if (!catalogId) continue;

              await prisma.$executeRawUnsafe(
                `
                  INSERT INTO procore_estimating_catalogs_live
                    (catalog_id, company_id, base_url, name, payload, synced_at)
                  VALUES
                    ($1, $2, $3, $4, $5::jsonb, NOW())
                  ON CONFLICT (catalog_id) DO UPDATE SET
                    company_id = EXCLUDED.company_id,
                    base_url   = EXCLUDED.base_url,
                    name       = EXCLUDED.name,
                    payload    = EXCLUDED.payload,
                    synced_at  = NOW()
                `,
                catalogId,
                companyId,
                host,
                readText(row.name) || null,
                JSON.stringify(row)
              );

              totalUpserted += 1;
            }

            if (rows.length < perPage) break;
            page += 1;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            // Network error — try next endpoint
            void message;
            break;
          }
        }

        if (endpointWorked) break;
      }

      if (hostWorked) break;
    }

    return NextResponse.json({
      success: true,
      companyId,
      totalUpserted,
      host: successfulHost,
      endpoint: successfulEndpoint,
      syncedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: "Failed to sync estimating catalogs", details: message },
      { status: 500 }
    );
  }
}
