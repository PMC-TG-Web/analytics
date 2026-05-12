// POST /api/procore/sync/company-users
// Fetches all company users from Procore and caches them in procore_company_users_live.
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

function displayName(user: Record<string, unknown>): string {
  const name = readText(user.name);
  if (name) return name;
  const first = readText(user.first_name);
  const last = readText(user.last_name);
  const full = `${first} ${last}`.trim();
  if (full) return full;
  return readText(user.login) || "-";
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
        page: String(page),
        per_page: String(perPage),
      });

      const endpoint = `/rest/v1.0/companies/${encodeURIComponent(companyId)}/users?${qs.toString()}`;
      const payload = await makeRequest(endpoint, accessToken, undefined, companyId);
      const users = asArray(payload);

      if (users.length === 0) break;

      for (const item of users) {
        const user = asObject(item);
        const userId = String(user.id ?? "").trim();
        if (!userId) continue;

        await prisma.$executeRawUnsafe(
          `
            INSERT INTO procore_company_users_live
              (user_id, company_id, login, name, company_name, payload, synced_at)
            VALUES
              ($1, $2, $3, $4, $5, $6::jsonb, NOW())
            ON CONFLICT (user_id) DO UPDATE SET
              company_id   = EXCLUDED.company_id,
              login        = EXCLUDED.login,
              name         = EXCLUDED.name,
              company_name = EXCLUDED.company_name,
              payload      = EXCLUDED.payload,
              synced_at    = NOW()
          `,
          userId,
          companyId,
          readText(user.login) || null,
          displayName(user) || null,
          readText(user.company_name) || null,
          JSON.stringify(user)
        );

        totalUpserted += 1;
      }

      if (users.length < perPage) {
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
      { success: false, error: "Failed to sync company users", details: message },
      { status: 500 }
    );
  }
}
