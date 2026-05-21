import { NextResponse } from "next/server";

const DEFAULT_COMPANY_ID = process.env.PROCORE_COMPANY_ID || "";

type SyncSummary = {
  ok: boolean;
  status: number;
  route: string;
  body: unknown;
};

async function postJson(request: Request, path: string, payload: unknown): Promise<SyncSummary> {
  const url = new URL(path, request.url);
  const syncSecret = request.headers.get("x-sync-secret") || "";
  const authorization = request.headers.get("authorization") || "";
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: request.headers.get("cookie") || "",
      ...(syncSecret ? { "x-sync-secret": syncSecret } : {}),
      ...(authorization ? { authorization } : {}),
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  let body: unknown = null;
  const contentLength = Number(response.headers.get("content-length") || "0");
  const contentType = String(response.headers.get("content-type") || "");

  // The wrapper only needs status codes. Large child responses can blow up this
  // orchestration step even when the underlying sync succeeded, so only parse
  // compact JSON bodies or failures.
  if (!response.ok || (contentType.includes("application/json") && contentLength > 0 && contentLength < 200_000)) {
    const text = await response.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text.slice(0, 2000) };
      }
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    route: path,
    body,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const companyId = String(body?.companyId || DEFAULT_COMPANY_ID).trim() || DEFAULT_COMPANY_ID;
    const limitProjects = Math.max(
      1,
      Math.min(10000, Number.parseInt(String(body?.limitProjects || "100"), 10) || 100)
    );
    const perPage = Math.min(100, Math.max(1, Number.parseInt(String(body?.perPage || "100"), 10) || 100));

    const bids = await postJson(request, "/api/procore/sync/bids", {
      companyWide: true,
      companyId,
      fetchAll: true,
      limitProjects,
      perPage,
    });

    const bidForms = await postJson(request, "/api/procore/sync/bidforms", {
      companyWide: true,
      companyId,
      fetchAll: true,
      limitProjects,
      perPage,
    });

    const proposalLineItems = await postJson(request, "/api/procore/estimating/proposal-line-items-bulk", {
      companyId,
      fetchAll: true,
      persist: true,
      includeProjectSummaries: false,
      includeLineItems: false,
      perPage: 100,
      "filters[by_status]": "All",
      maxBidBoardProjects: limitProjects,
      maxProposalsPerProject: 50,
      maxLineItemsPages: 10,
    });

    const results = {
      bids,
      bidForms,
      proposalLineItems,
    };

    const success = bids.ok && bidForms.ok && proposalLineItems.ok;

    return NextResponse.json(
      {
        success,
        message: success
          ? "Project commercial data sync complete"
          : "Project commercial data sync finished with one or more errors",
        companyId,
        limitProjects,
        results,
      },
      { status: success ? 200 : 207 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to sync project commercial data",
        details: message,
      },
      { status: 500 }
    );
  }
}
