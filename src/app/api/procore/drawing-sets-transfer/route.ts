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

function readBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  const text = readStr(value).toLowerCase();
  if (text === "true") return true;
  if (text === "false") return false;
  return undefined;
}

function normalizeDate(value: unknown): string | null {
  const text = readStr(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

async function getToken(bodyToken?: unknown) {
  const cookieStore = await cookies();
  const explicitToken = readStr(bodyToken);
  const cookieToken = readStr(cookieStore.get("procore_access_token")?.value);
  if (explicitToken || cookieToken) return explicitToken || cookieToken;
  return getClientCredentialsToken();
}

function getCompanyId(input: unknown) {
  return readStr(input) || readStr(procoreConfig.companyId);
}

function buildDrawingSetsUrl(projectId: string, params: URLSearchParams) {
  const apiBase = (procoreConfig.apiUrl || "https://api.procore.com").replace(/\/$/, "");
  return `${apiBase}/rest/v1.0/projects/${encodeURIComponent(projectId)}/drawing_sets?${params.toString()}`;
}

function drawingSetPayload(row: UnknownRecord) {
  const name = readStr(row.name);
  const date = normalizeDate(row.date || row.created_at || row.updated_at);

  if (!name) {
    throw new Error("Drawing set name is required.");
  }

  return {
    name,
    ...(date ? { date } : {}),
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = readStr(url.searchParams.get("projectId"));
    const companyId = getCompanyId(url.searchParams.get("companyId"));

    if (!projectId) {
      return NextResponse.json({ error: "Missing required query param: projectId" }, { status: 400 });
    }
    if (!companyId) {
      return NextResponse.json({ error: "Missing required query param: companyId" }, { status: 400 });
    }

    const params = new URLSearchParams();
    params.set("page", readStr(url.searchParams.get("page")) || "1");
    params.set("per_page", readStr(url.searchParams.get("perPage")) || "100");

    const optionalBooleans: Array<[string, string]> = [
      ["excludeEmptySets", "filters[exclude_empty_sets]"],
      ["onlyAttachableSets", "filters[only_attachable_sets]"],
      ["withSketches", "filters[with_sketches]"],
      ["withMeasurements", "filters[with_measurements]"],
    ];

    for (const [inputKey, outputKey] of optionalBooleans) {
      const value = readBool(url.searchParams.get(inputKey));
      if (value !== undefined) params.set(outputKey, String(value));
    }

    const drawingAreaId = readStr(url.searchParams.get("drawingAreaId"));
    if (drawingAreaId) params.set("drawing_area_id", drawingAreaId);

    const accessToken = await getToken();
    const response = await fetch(buildDrawingSetsUrl(projectId, params), {
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
        { error: "Failed to fetch drawing sets", status: response.status, details: data },
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
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Failed to fetch drawing sets", details: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as UnknownRecord;
    const targetProjectId = readStr(body.targetProjectId || body.projectId);
    const targetCompanyId = getCompanyId(body.targetCompanyId || body.companyId);

    if (!targetProjectId) {
      return NextResponse.json({ error: "Missing required field: targetProjectId" }, { status: 400 });
    }
    if (!targetCompanyId) {
      return NextResponse.json({ error: "Missing required field: targetCompanyId" }, { status: 400 });
    }

    const drawingSets = Array.isArray(body.drawingSets)
      ? body.drawingSets
      : body.drawingSet
        ? [body.drawingSet]
        : [];

    if (!drawingSets.length) {
      return NextResponse.json({ error: "Missing drawingSets payload." }, { status: 400 });
    }

    const accessToken = await getToken(body.accessToken);
    const apiBase = (procoreConfig.apiUrl || "https://api.procore.com").replace(/\/$/, "");
    const targetUrl = `${apiBase}/rest/v1.0/projects/${encodeURIComponent(targetProjectId)}/drawing_sets`;
    const results = [];

    for (const row of drawingSets) {
      if (typeof row !== "object" || row === null) {
        results.push({ success: false, error: "Invalid drawing set row." });
        continue;
      }

      const payload = drawingSetPayload(row as UnknownRecord);
      const response = await fetch(targetUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "Procore-Company-Id": targetCompanyId,
        },
        body: JSON.stringify(payload),
        cache: "no-store",
      });

      const text = await response.text();
      let data: unknown = text;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        // Keep raw text for diagnostics.
      }

      results.push({
        success: response.ok,
        status: response.status,
        sourceId: readStr((row as UnknownRecord).id) || null,
        payload,
        data,
      });
    }

    return NextResponse.json({
      success: results.every((result) => result.success),
      targetCompanyId,
      targetProjectId,
      count: results.length,
      created: results.filter((result) => result.success).length,
      failed: results.filter((result) => !result.success).length,
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Failed to create drawing sets", details: message }, { status: 500 });
  }
}
