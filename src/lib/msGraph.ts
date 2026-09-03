/**
 * Microsoft Graph client (application permissions, client credentials).
 *
 * Server-side only. Credentials come from MS_GRAPH_TENANT_ID / MS_GRAPH_CLIENT_ID /
 * MS_GRAPH_CLIENT_SECRET and are never exposed to the browser. Mailbox scope is
 * enforced by an Exchange Application Access Policy, not by this code.
 */

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export type GraphError = Error & {
  status?: number;
  code?: string;
  retryAfterMs?: number;
};

type CachedToken = { token: string; expiresAt: number };
let cachedToken: CachedToken | null = null;

function config() {
  return {
    tenantId: String(process.env.MS_GRAPH_TENANT_ID || "").trim(),
    clientId: String(process.env.MS_GRAPH_CLIENT_ID || "").trim(),
    clientSecret: String(process.env.MS_GRAPH_CLIENT_SECRET || "").trim(),
  };
}

export function isMsGraphConfigured(): boolean {
  const { tenantId, clientId, clientSecret } = config();
  return Boolean(tenantId && clientId && clientSecret);
}

export async function getGraphAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.token;
  const { tenantId, clientId, clientSecret } = config();
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, and MS_GRAPH_CLIENT_SECRET must be set.");
  }
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
    }).toString(),
  });
  const body = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!response.ok || !body.access_token) {
    const error = new Error(`Graph token request failed (${response.status}): ${body.error || "unknown"}`) as GraphError;
    error.status = response.status;
    error.code = body.error;
    throw error;
  }
  cachedToken = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return body.access_token;
}

function retryAfterMs(response: Response): number {
  const header = response.headers.get("retry-after");
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  return 2_000;
}

/**
 * Perform a Graph request. `path` may be a relative path ("/users/...") or an
 * absolute @odata.nextLink. Retries 429/503 honoring Retry-After (bounded).
 */
export async function graphRequest<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string>; maxRetries?: number } = {},
): Promise<T> {
  const url = /^https?:\/\//i.test(path) ? path : `${GRAPH_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const maxRetries = options.maxRetries ?? 3;
  const token = await getGraphAccessToken();

  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(20_000),
    });

    if ((response.status === 429 || response.status === 503) && attempt < maxRetries) {
      const waitMs = Math.min(30_000, retryAfterMs(response));
      await response.text().catch(() => "");
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }

    if (!response.ok) {
      const graphError = (json as { error?: { code?: string; message?: string } } | null)?.error;
      const error = new Error(
        `Graph ${options.method || "GET"} ${url.replace(GRAPH_BASE, "")} failed (${response.status}): ${graphError?.code || ""} ${graphError?.message || text.slice(0, 200)}`.trim(),
      ) as GraphError;
      error.status = response.status;
      error.code = graphError?.code;
      if (response.status === 429) error.retryAfterMs = retryAfterMs(response);
      throw error;
    }
    return json as T;
  }
}

export function graphErrorStatus(error: unknown): number {
  return Number((error as GraphError | null)?.status || 0);
}

/** Exchange application-access-policy denial ("RAOP"), or a mailbox that does not exist. */
export function isGraphMailboxUnavailable(error: unknown): boolean {
  const status = graphErrorStatus(error);
  const message = String((error as Error | null)?.message || "");
  if (status === 404) return true;
  return status === 403 && /AccessPolicy|RAOP|ErrorAccessDenied/i.test(message);
}
