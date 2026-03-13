import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { procoreConfig } from "@/lib/procore";

function parseBids(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json as Record<string, unknown>[];

  if (json && typeof json === "object") {
    const data = (json as { data?: unknown }).data;
    if (Array.isArray(data)) return data as Record<string, unknown>[];

    const bids = (json as { bids?: unknown }).bids;
    if (Array.isArray(bids)) return bids as Record<string, unknown>[];

    const items = (json as { items?: unknown }).items;
    if (Array.isArray(items)) return items as Record<string, unknown>[];
  }

  return [];
}

async function fetchProjectBids(params: {
  accessToken: string;
  projectId: string;
  page: number;
  perPage: number;
  fetchAll: boolean;
  maxPages: number;
  baseUrl: string;
  companyId?: string;
}) {
  const { accessToken, projectId, page, perPage, fetchAll, maxPages, baseUrl, companyId } = params;

  const bids: Record<string, unknown>[] = [];
  let currentPage = page;
  let pagesFetched = 0;

  while (pagesFetched < maxPages) {
    const query = new URLSearchParams({
      page: String(currentPage),
      per_page: String(perPage),
    });

    const url = `${baseUrl}/rest/v1.0/projects/${encodeURIComponent(projectId)}/bids?${query.toString()}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    };

    if (companyId) {
      headers["Procore-Company-Id"] = companyId;
    }

    const response = await fetch(url, {
      method: "GET",
      headers,
      cache: "no-store",
    });

    const text = await response.text();

    if (!response.ok) {
      const retryAfterHeader = response.headers.get("retry-after");
      const resetHeader =
        response.headers.get("x-rate-limit-reset") || response.headers.get("ratelimit-reset");
      const remainingHeader =
        response.headers.get("x-rate-limit-remaining") || response.headers.get("ratelimit-remaining");
      const limitHeader = response.headers.get("x-rate-limit-limit") || response.headers.get("ratelimit-limit");

      const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : null;
      const resetEpochSeconds = resetHeader ? Number(resetHeader) : null;

      return {
        ok: false as const,
        status: response.status,
        error: `Procore bids API error ${response.status}: ${text}`,
        url,
        rateLimit: {
          retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : null,
          resetEpochSeconds: Number.isFinite(resetEpochSeconds) ? resetEpochSeconds : null,
          remaining: remainingHeader,
          limit: limitHeader,
        },
      };
    }

    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    const pageItems = parseBids(json);
    if (pageItems.length === 0) {
      break;
    }

    bids.push(...pageItems);
    pagesFetched += 1;

    if (!fetchAll || pageItems.length < perPage) {
      break;
    }

    currentPage += 1;
  }

  return {
    ok: true as const,
    projectId,
    page,
    perPage,
    pagesFetched,
    count: bids.length,
    bids,
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const cookieStore = await cookies();

    const accessToken =
      searchParams.get("accessToken") || cookieStore.get("procore_access_token")?.value || "";
    const projectId = String(searchParams.get("projectId") || "").trim();
    const page = Math.max(Number(searchParams.get("page")) || 1, 1);
    const perPage = Math.min(Math.max(Number(searchParams.get("perPage")) || 100, 1), 200);
    const fetchAll = searchParams.get("fetchAll") === "true";
    const maxPages = Math.min(Math.max(Number(searchParams.get("maxPages")) || 1, 1), 200);
    const baseUrl = String(searchParams.get("baseUrl") || procoreConfig.apiUrl || "https://api.procore.com")
      .trim()
      .replace(/\/$/, "");
    const companyId = String(
      searchParams.get("companyId") || cookieStore.get("procore_company_id")?.value || procoreConfig.companyId || ""
    ).trim();

    if (!accessToken) {
      return NextResponse.json(
        { error: "Missing access token. Please authenticate via OAuth first or provide accessToken." },
        { status: 401 }
      );
    }

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId." }, { status: 400 });
    }

    const result = await fetchProjectBids({
      accessToken: String(accessToken).trim(),
      projectId,
      page,
      perPage,
      fetchAll,
      maxPages,
      baseUrl,
      companyId: companyId || undefined,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.status === 429 ? "Rate limited by Procore" : "Failed to fetch project bids",
          details:
            result.status === 429
              ? "Procore rate limit exceeded. Wait for retryAfterSeconds/resetEpochSeconds before retrying."
              : result.error,
          url: result.url,
          upstreamError: result.error,
          rateLimit: result.rateLimit ?? null,
        },
        { status: result.status }
      );
    }

    return NextResponse.json({ success: true, source: "projects.bids", ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: "Failed to fetch Procore project bids",
        details: message,
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const cookieStore = await cookies();

    const accessToken = String(body.accessToken || cookieStore.get("procore_access_token")?.value || "").trim();
    const projectId = String(body.projectId || "").trim();
    const page = Math.max(Number(body.page) || 1, 1);
    const perPage = Math.min(Math.max(Number(body.perPage) || 100, 1), 200);
    const fetchAll = body.fetchAll === true;
    const maxPages = Math.min(Math.max(Number(body.maxPages) || 1, 1), 200);
    const baseUrl = String(body.baseUrl || procoreConfig.apiUrl || "https://api.procore.com")
      .trim()
      .replace(/\/$/, "");
    const companyId = String(
      body.companyId || cookieStore.get("procore_company_id")?.value || procoreConfig.companyId || ""
    ).trim();

    if (!accessToken) {
      return NextResponse.json(
        { error: "Missing access token. Please authenticate via OAuth first or provide accessToken." },
        { status: 401 }
      );
    }

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId." }, { status: 400 });
    }

    const result = await fetchProjectBids({
      accessToken,
      projectId,
      page,
      perPage,
      fetchAll,
      maxPages,
      baseUrl,
      companyId: companyId || undefined,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.status === 429 ? "Rate limited by Procore" : "Failed to fetch project bids",
          details:
            result.status === 429
              ? "Procore rate limit exceeded. Wait for retryAfterSeconds/resetEpochSeconds before retrying."
              : result.error,
          url: result.url,
          upstreamError: result.error,
          rateLimit: result.rateLimit ?? null,
        },
        { status: result.status }
      );
    }

    return NextResponse.json({ success: true, source: "projects.bids", ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: "Failed to fetch Procore project bids",
        details: message,
      },
      { status: 500 }
    );
  }
}
