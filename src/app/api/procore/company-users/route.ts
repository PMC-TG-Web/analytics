// DB-first: reads from procore_company_users_live (populated by /api/procore/sync/company-users)
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getClientCredentialsToken, procoreConfig } from "@/lib/procore";

export const dynamic = "force-dynamic";

function readText(value: unknown): string {
  return String(value ?? "").trim();
}

function toPositiveInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const cookieStore = await cookies();

    const companyId = readText(
      body?.companyId ||
        cookieStore.get("procore_company_id")?.value ||
        procoreConfig.companyId ||
        ""
    );

    if (!companyId) {
      return NextResponse.json({ success: false, error: "Missing companyId." }, { status: 400 });
    }

    const page = toPositiveInt(body?.page, 1, 1, 1000);
    const perPage = toPositiveInt(body?.perPage, 100, 1, 1000);
    const search = readText(body?.search).toLowerCase();
    const projectId = readText(body?.projectId || body?.project_id);
    const offset = (page - 1) * perPage;

    const rows = await prisma.procore_company_users_live.findMany({
      where: {
        company_id: companyId,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { login: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { name: "asc" },
      skip: offset,
      take: perPage,
    });

    const partyIdByUserId = new Map<string, string>();
    if (projectId) {
      try {
        const accessToken =
          readText(body?.accessToken || cookieStore.get("procore_access_token")?.value) ||
          (await getClientCredentialsToken());

        if (accessToken) {
          const endpoint = `${procoreConfig.apiUrl}/rest/v1.0/projects/${encodeURIComponent(projectId)}/timecard_entries?page=1&per_page=1000`;
          const upstream = await fetch(endpoint, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/json",
              "Procore-Company-Id": companyId,
            },
            cache: "no-store",
          });

          if (upstream.ok) {
            const entries = (await upstream.json().catch(() => [])) as unknown;
            if (Array.isArray(entries)) {
              for (const item of entries) {
                const row = item as Record<string, unknown>;
                const party = row.party as Record<string, unknown> | undefined;
                const userId = readText(party?.user_id);
                const partyId = readText(party?.id);
                if (userId && partyId) {
                  partyIdByUserId.set(userId, partyId);
                }
              }
            }
          }
        }
      } catch {
        // Non-blocking: return cached users even if party enrichment fails.
      }
    }

    const data = rows.map((r) => ({
      id: r.user_id,
      party_id: partyIdByUserId.get(String(r.user_id)) || null,
      login: r.login,
      name: r.name,
      company_name: r.company_name,
      payload: r.payload,
    }));

    return NextResponse.json({
      success: true,
      source: "db",
      companyId,
      page,
      perPage,
      search: search || null,
      syncedAt: rows[0]?.synced_at ?? null,
      count: data.length,
      data,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: "Failed to fetch company users", details: message },
      { status: 500 }
    );
  }
}
