import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getClientCredentialsToken, procoreConfig } from "@/lib/procore";

type UnknownRecord = Record<string, unknown>;

function readStr(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return "";
}

async function getToken() {
  const cookieStore = await cookies();
  const cookieToken = readStr(cookieStore.get("procore_access_token")?.value);
  if (cookieToken) return cookieToken;
  return getClientCredentialsToken();
}

function getCompanyId(input: unknown) {
  return readStr(input) || readStr(procoreConfig.companyId);
}

function buildDrawingUploadsUrl(projectId: string, params: URLSearchParams) {
  const apiBase = (procoreConfig.apiUrl || "https://api.procore.com").replace(/\/$/, "");
  return `${apiBase}/rest/v1.1/projects/${encodeURIComponent(projectId)}/drawing_uploads?${params.toString()}`;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const companyId = getCompanyId(url.searchParams.get("companyId"));
    const projectId = readStr(url.searchParams.get("projectId"));

    if (!companyId) {
      return NextResponse.json({ error: "Missing required query param: companyId" }, { status: 400 });
    }
    if (!projectId) {
      return NextResponse.json({ error: "Missing required query param: projectId" }, { status: 400 });
    }

    const params = new URLSearchParams();
    params.set("page", readStr(url.searchParams.get("page")) || "1");
    params.set("per_page", readStr(url.searchParams.get("perPage")) || "100");

    const view = readStr(url.searchParams.get("view"));
    if (view) params.set("view", view);

    const accessToken = await getToken();
    const response = await fetch(buildDrawingUploadsUrl(projectId, params), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Procore-Company-Id": companyId,
      },
      cache: "no-store",
    });

    const text = await response.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : [];
    } catch {
      // Keep raw text for diagnostics.
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch drawing uploads", status: response.status, details: data },
        { status: response.status }
      );
    }

    const maybeWrappedData = (data as UnknownRecord)?.data;
    const rows: unknown[] = Array.isArray(data)
      ? data
      : Array.isArray(maybeWrappedData)
        ? maybeWrappedData
        : [];

    return NextResponse.json({
      success: true,
      companyId,
      projectId,
      count: rows.length,
      data: rows,
      raw: data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Failed to fetch drawing uploads", details: message }, { status: 500 });
  }
}
