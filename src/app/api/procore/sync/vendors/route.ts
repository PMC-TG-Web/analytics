// POST /api/procore/sync/vendors
// Fetches all company vendors from Procore and caches them in procore_company_vendors_live.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { makeRequest, procoreConfig, getClientCredentialsToken } from "@/lib/procore";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function readText(value: unknown): string {
  return String(value ?? "").trim();
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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

    const perPage = 500;
    let page = 1;
    let totalUpserted = 0;
    let done = false;

    while (!done) {
      const qs = new URLSearchParams({
        company_id: companyId,
        page: String(page),
        per_page: String(perPage),
      });

      let payload: unknown;
      try {
        payload = await makeRequest(`/rest/v1.0/vendors?${qs.toString()}`, accessToken);
      } catch {
        // Some companies use the company-prefixed endpoint
        payload = await makeRequest(
          `/rest/v1.0/companies/${encodeURIComponent(companyId)}/vendors?page=${page}&per_page=${perPage}`,
          accessToken
        );
      }

      const vendors = asArray(payload);
      if (vendors.length === 0) break;

      for (const item of vendors) {
        const vendor = asObject(item);
        const vendorId = String(vendor.id ?? "").trim();
        if (!vendorId) continue;

        const tradeName =
          readText((asObject(vendor.trade)).name) ||
          readText(vendor.trade_name) ||
          null;

        await prisma.$executeRawUnsafe(
          `
            INSERT INTO procore_company_vendors_live
              (vendor_id, company_id, name, trade, is_active, payload, synced_at)
            VALUES
              ($1, $2, $3, $4, $5, $6::jsonb, NOW())
            ON CONFLICT (vendor_id) DO UPDATE SET
              company_id = EXCLUDED.company_id,
              name       = EXCLUDED.name,
              trade      = EXCLUDED.trade,
              is_active  = EXCLUDED.is_active,
              payload    = EXCLUDED.payload,
              synced_at  = NOW()
          `,
          vendorId,
          companyId,
          readText(vendor.name) || null,
          tradeName,
          typeof vendor.is_active === "boolean" ? vendor.is_active : null,
          JSON.stringify(vendor)
        );

        totalUpserted += 1;
      }

      if (vendors.length < perPage) {
        done = true;
      } else {
        page += 1;
      }
    }

    return NextResponse.json({
      success: true,
      companyId,
      pagesRead: page,
      totalUpserted,
      syncedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: "Failed to sync vendors", details: message },
      { status: 500 }
    );
  }
}
