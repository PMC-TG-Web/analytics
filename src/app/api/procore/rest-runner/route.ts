import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getClientCredentialsToken, procoreConfig } from "@/lib/procore";

type UnknownRecord = Record<string, unknown>;

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStr(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return "";
}

function sanitizeMethod(value: unknown): string {
  const method = readStr(value).toUpperCase() || "GET";
  return ALLOWED_METHODS.has(method) ? method : "GET";
}

function applyPathReplacements(pathOrUrl: string, companyId: string): string {
  if (!companyId) return pathOrUrl;
  return pathOrUrl
    .replaceAll("{company_id}", encodeURIComponent(companyId))
    .replaceAll("%7Bcompany_id%7D", encodeURIComponent(companyId))
    .replaceAll("%7bcompany_id%7d", encodeURIComponent(companyId));
}

function buildTargetUrl(pathOrUrl: string, query: unknown, companyId: string): string {
  const token = pathOrUrl.trim();
  if (!token) throw new Error("path is required.");
  const replacedToken = applyPathReplacements(token, companyId);

  const rootApi = "https://api.procore.com";
  let url: URL;

  if (/^https?:\/\//i.test(replacedToken)) {
    url = new URL(replacedToken);
    if (url.protocol !== "https:" || url.hostname !== "api.procore.com") {
      throw new Error("Only https://api.procore.com URLs are allowed.");
    }
  } else {
    const normalized = replacedToken.startsWith("/") ? replacedToken : `/${replacedToken}`;
    url = new URL(`${rootApi}${normalized}`);
  }

  if (!url.pathname.startsWith("/rest/")) {
    throw new Error("Only Procore /rest/* endpoints are allowed.");
  }

  if (isRecord(query)) {
    for (const [key, raw] of Object.entries(query)) {
      if (raw === undefined || raw === null) continue;
      const value = readStr(raw);
      if (value) url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

function mergeSafeHeaders(input: unknown): Record<string, string> {
  const output: Record<string, string> = {};
  if (!isRecord(input)) return output;

  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = rawKey.trim();
    const lower = key.toLowerCase();

    if (!key) continue;
    if (lower === "authorization" || lower === "cookie" || lower === "host" || lower === "content-length") {
      continue;
    }

    const value = readStr(rawValue);
    if (!value) continue;
    output[key] = value;
  }

  return output;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as UnknownRecord;
    const cookieStore = await cookies();

    const explicitToken = readStr(body.accessToken);
    const cookieToken = readStr(cookieStore.get("procore_access_token")?.value);
    let accessToken = explicitToken || cookieToken;
    let tokenSource: "explicit" | "cookie" | "client_credentials" | "missing" = explicitToken
      ? "explicit"
      : cookieToken
        ? "cookie"
        : "missing";

    if (!accessToken) {
      try {
        accessToken = await getClientCredentialsToken();
        tokenSource = "client_credentials";
      } catch {
        tokenSource = "missing";
      }
    }

    if (!accessToken) {
      return NextResponse.json(
        {
          error: "Missing Procore access token.",
          details: "Provide accessToken, authenticate on /procore, or configure PROCORE_CLIENT_ID/PROCORE_CLIENT_SECRET.",
        },
        { status: 401 }
      );
    }

    const companyId =
      readStr(body.companyId) ||
      readStr(cookieStore.get("procore_company_id")?.value) ||
      readStr(procoreConfig.companyId);

    const method = sanitizeMethod(body.method);
    const targetUrl = buildTargetUrl(readStr(body.path ?? body.url), body.query, companyId);

    const targetPathname = new URL(targetUrl).pathname;
    if ((targetPathname === "/rest/v1.0/me" || /\/rest\/v1\.3\/companies\/[^/]+\/me$/.test(targetPathname)) && method !== "GET") {
      return NextResponse.json(
        {
          error: "Invalid method for Procore me endpoint",
          details: "Use GET for Procore me endpoints. Procore returns 404 for unsupported methods on these endpoints.",
          method,
          url: targetUrl,
        },
        { status: 400 }
      );
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...mergeSafeHeaders(body.headers),
    };

    if (companyId && !headers["Procore-Company-Id"] && !headers["procore-company-id"]) {
      headers["Procore-Company-Id"] = companyId;
    }

    const init: RequestInit = {
      method,
      headers,
      cache: "no-store",
    };

    if (method !== "GET" && method !== "DELETE") {
      if (body.body !== undefined) {
        init.body = JSON.stringify(body.body);
        if (!headers["Content-Type"] && !headers["content-type"]) {
          headers["Content-Type"] = "application/json";
        }
      }
    }

    const upstream = await fetch(targetUrl, init);
    const responseText = await upstream.text();

    let parsed: unknown = responseText;
    try {
      parsed = responseText ? JSON.parse(responseText) : {};
    } catch {
      parsed = responseText;
    }

    const responseHeaders = Object.fromEntries(upstream.headers.entries());

    return NextResponse.json(
      {
        ok: upstream.ok,
        status: upstream.status,
        statusText: upstream.statusText,
        method,
        url: targetUrl,
        tokenSource,
        companyId: companyId || null,
        responseHeaders,
        result: parsed,
      },
      { status: upstream.status }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to run Procore REST command", details: message },
      { status: 500 }
    );
  }
}
