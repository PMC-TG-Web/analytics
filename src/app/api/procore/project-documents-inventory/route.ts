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

function readInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(readStr(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
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

function rowsFromPayload(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  const wrapped = (data as UnknownRecord)?.data;
  return Array.isArray(wrapped) ? wrapped : [];
}

function field(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  return (value as UnknownRecord)[key];
}

function nestedField(value: unknown, firstKey: string, secondKey: string): unknown {
  return field(field(value, firstKey), secondKey);
}

function documentType(row: unknown): string {
  const directType = readStr(field(row, "type") || field(row, "document_type") || field(row, "kind"));
  if (directType) return directType.toLowerCase();

  if (field(row, "folder") || field(row, "folder_id") || nestedField(row, "parent", "id")) return "file";
  return "";
}

function isFolder(row: unknown): boolean {
  const type = documentType(row);
  if (type.includes("folder")) return true;
  if (typeof field(row, "is_folder") === "boolean") return Boolean(field(row, "is_folder"));
  return false;
}

function isFile(row: unknown): boolean {
  const type = documentType(row);
  if (type.includes("file") || type.includes("document")) return !isFolder(row);
  if (typeof field(row, "is_file") === "boolean") return Boolean(field(row, "is_file"));
  return !isFolder(row);
}

function isPdf(row: unknown): boolean {
  const name = readStr(field(row, "name") || field(row, "file_name") || field(row, "filename")).toLowerCase();
  const contentType = readStr(field(row, "content_type") || field(row, "mime_type")).toLowerCase();
  return name.endsWith(".pdf") || contentType.includes("pdf");
}

function pickDownloadFields(row: unknown): Record<string, unknown> {
  const candidates: Record<string, unknown> = {};
  const keys = [
    "download_url",
    "downloadUrl",
    "url",
    "file_url",
    "fileUrl",
    "web_url",
    "webUrl",
    "view_url",
    "viewUrl",
    "signed_url",
    "signedUrl",
  ];

  for (const key of keys) {
    const value = field(row, key);
    if (value) candidates[key] = value;
  }

  const file = field(row, "file");
  if (file && typeof file === "object") {
    for (const key of keys) {
      const value = field(file, key);
      if (value) candidates[`file.${key}`] = value;
    }
  }

  return candidates;
}

function summarizeDocument(row: unknown): Record<string, unknown> {
  return {
    id: field(row, "id"),
    type: documentType(row) || (isFolder(row) ? "folder" : "file"),
    name: field(row, "name") || field(row, "file_name") || field(row, "filename"),
    parentId: field(row, "parent_id") || nestedField(row, "parent", "id") || field(row, "folder_id"),
    path: field(row, "path") || field(row, "full_path"),
    size: field(row, "size") || field(row, "file_size"),
    contentType: field(row, "content_type") || field(row, "mime_type"),
    createdAt: field(row, "created_at"),
    updatedAt: field(row, "updated_at"),
    downloadFields: pickDownloadFields(row),
  };
}

async function fetchJson(url: string, accessToken: string, companyId: string) {
  const response = await fetch(url, {
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
    const error = new Error(`Procore request failed (${response.status})`) as Error & {
      status?: number;
      details?: unknown;
    };
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return {
    data,
    rows: rowsFromPayload(data),
    total: response.headers.get("total"),
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const companyId = getCompanyId(url.searchParams.get("companyId"));
    const projectId = readStr(url.searchParams.get("projectId"));
    const perPage = readInt(url.searchParams.get("perPage"), 100, 1, 100);
    const maxPages = readInt(url.searchParams.get("maxPages"), 20, 1, 100);
    const view = readStr(url.searchParams.get("view")) || "extended";
    const search = readStr(url.searchParams.get("search"));

    if (!companyId) {
      return NextResponse.json({ error: "Missing required query param: companyId" }, { status: 400 });
    }
    if (!projectId) {
      return NextResponse.json({ error: "Missing required query param: projectId" }, { status: 400 });
    }

    const accessToken = await getToken();
    const apiBase = (procoreConfig.apiUrl || "https://api.procore.com").replace(/\/$/, "");
    const encodedProjectId = encodeURIComponent(projectId);
    const rows: unknown[] = [];
    const rawPages: unknown[] = [];

    for (let page = 1; page <= maxPages; page += 1) {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
      });
      if (view) params.set("view", view);
      if (search) params.set("search", search);

      const result = await fetchJson(
        `${apiBase}/rest/v2.0/projects/${encodedProjectId}/documents?${params.toString()}`,
        accessToken,
        companyId
      );

      rows.push(...result.rows);
      rawPages.push({ page, count: result.rows.length, total: result.total, data: result.data });
      if (result.rows.length < perPage) break;
    }

    const folders = rows.filter(isFolder);
    const files = rows.filter(isFile);
    const pdfs = files.filter(isPdf);
    const summary = rows.map(summarizeDocument);

    return NextResponse.json({
      success: true,
      companyId,
      projectId,
      view,
      perPage,
      maxPages,
      counts: {
        total: rows.length,
        folders: folders.length,
        files: files.length,
        pdfs: pdfs.length,
      },
      documents: rows,
      folders,
      files,
      pdfs,
      summary,
      rawPages,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = Number((error as { status?: number })?.status || 500);
    return NextResponse.json(
      {
        error: "Failed to fetch project documents inventory",
        details: message,
        procoreDetails: (error as { details?: unknown })?.details,
      },
      { status: status >= 400 && status < 600 ? status : 500 }
    );
  }
}
