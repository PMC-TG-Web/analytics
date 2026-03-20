import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { makeRequest, procoreConfig } from "@/lib/procore";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

async function fetchBudgetLineItemById(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  budgetLineItemId: string;
}) {
  const { accessToken, companyId, projectId, budgetLineItemId } = params;

  const query = new URLSearchParams({ project_id: projectId });
  const encodedId = encodeURIComponent(budgetLineItemId);
  const encodedProjectId = encodeURIComponent(projectId);

  const endpoints = [
    // Exact endpoint shape from your snippet.
    `/rest/v1.1/budget_line_items/${encodedId}?${query.toString()}`,
    `/rest/v1.0/budget_line_items/${encodedId}?${query.toString()}`,
    `/rest/v1.1/projects/${encodedProjectId}/budget_line_items/${encodedId}`,
    `/rest/v1.0/projects/${encodedProjectId}/budget_line_items/${encodedId}`,
  ];

  const failures: string[] = [];
  for (const endpoint of endpoints) {
    try {
      const data = await makeRequest(endpoint, accessToken, undefined, companyId);
      return { data, endpoint, failures };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${endpoint} => ${message}`);
    }
  }

  throw new Error(failures.join(" | "));
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const budgetLineItemId = String(body?.budgetLineItemId || body?.id || "").trim();
    const projectId = String(body?.projectId || "").trim();
    const companyIdFromBody = String(body?.companyId || "").trim();

    if (!budgetLineItemId || !projectId) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing budgetLineItemId or projectId.",
        },
        { status: 400 }
      );
    }

    const cookieStore = await cookies();
    const accessToken = cookieStore.get("procore_access_token")?.value;
    const companyId = String(
      companyIdFromBody || cookieStore.get("procore_company_id")?.value || procoreConfig.companyId
    ).trim();

    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: "Missing access token. Please login via OAuth." },
        { status: 401 }
      );
    }

    const { data, endpoint } = await fetchBudgetLineItemById({
      accessToken,
      companyId,
      projectId,
      budgetLineItemId,
    });

    return NextResponse.json({
      success: true,
      message: "Budget line item fetched",
      data: {
        companyId,
        projectId,
        budgetLineItemId,
        endpoint,
        budgetLineItem: asObject(data) || data,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: `Failed to fetch budget line item: ${message}` },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const body = JSON.stringify({
    companyId: url.searchParams.get("companyId") || undefined,
    projectId: url.searchParams.get("projectId") || undefined,
    budgetLineItemId: url.searchParams.get("budgetLineItemId") || url.searchParams.get("id") || undefined,
  });

  return POST(
    new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    })
  );
}
