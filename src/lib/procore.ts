// lib/procore.ts - Procore API utilities

interface ProcoreTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

type ErrorWithStatusAndCause = Error & {
  status?: number;
  cause?: unknown;
};

export const procoreConfig = {
  clientId: (process.env.PROCORE_CLIENT_ID || '').trim(),
  clientSecret: (process.env.PROCORE_CLIENT_SECRET || '').trim(),
  companyId: (process.env.PROCORE_COMPANY_ID || '598134325658789').trim(),
  apiUrl: (process.env.PROCORE_API_URL || 'https://api.procore.com').trim(),
  authUrl: (process.env.PROCORE_AUTH_URL || 'https://login.procore.com/oauth/authorize').trim(),
  tokenUrl: (process.env.PROCORE_TOKEN_URL || 'https://api.procore.com/oauth/token').trim(),
  redirectUri: (process.env.NEXT_PUBLIC_REDIRECT_URI || `${process.env.AUTH0_BASE_URL || 'http://localhost:3000'}/api/auth/procore/callback`).trim(),
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const when = Date.parse(value);
  if (Number.isNaN(when)) return null;
  return Math.max(0, when - Date.now());
}

// Get OAuth authorization URL
export function getAuthorizationUrl(state: string = 'default'): string {
  const params = new URLSearchParams({
    client_id: (procoreConfig.clientId || '').trim(),
    response_type: 'code',
    redirect_uri: (procoreConfig.redirectUri || '').trim(),
    state,
  });
  return `${procoreConfig.authUrl}?${params.toString()}`;
}

// Exchange authorization code for access token
export async function getAccessToken(code: string): Promise<ProcoreTokenResponse> {
  try {
    const clientId = (procoreConfig.clientId || '').trim();
    const clientSecret = (procoreConfig.clientSecret || '').trim();
    const redirectUri = (procoreConfig.redirectUri || '').trim();
    const tokenUrl = (procoreConfig.tokenUrl || '').trim();

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }).toString(),
    });

    console.log('Sending token request to:', tokenUrl);
    console.log('Body params:', {
      grant_type: 'authorization_code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code: code.substring(0, 5) + '...'
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('Procore Token Exchange Error:', {
        status: response.status,
        statusText: response.statusText,
        body: errorBody
      });
      throw new Error(`Failed to get access token (${response.status}): ${errorBody}`);
    }

    return response.json();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Token exchange failed: ${msg}`);
  }
}

// Refresh access token using refresh token
export async function refreshAccessToken(refreshToken: string): Promise<ProcoreTokenResponse> {
  try {
    const clientId = (procoreConfig.clientId || '').trim();
    const clientSecret = (procoreConfig.clientSecret || '').trim();
    const tokenUrl = (procoreConfig.tokenUrl || '').trim();

    console.log('Attempting to refresh Procore access token...');

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('Token refresh failed:', {
        status: response.status,
        statusText: response.statusText,
      });
      throw new Error(`Failed to refresh token (${response.status})`);
    }

    const result = await response.json();
    console.log('✅ Token refreshed successfully');
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Token refresh failed: ${msg}`);
  }
}

// Make authenticated request to Procore API
export async function makeRequest(
  endpoint: string,
  accessToken: string,
  options?: RequestInit,
  companyIdOverride?: string,
  quietStatuses: number[] = []
): Promise<unknown> {
  const apiUrl = (procoreConfig.apiUrl || '').trim();
  const url = `${apiUrl}${endpoint}`;
  const cleanToken = (accessToken || '').trim();
  
  // Use explicit company override when provided, otherwise fall back to config.
  const companyId = String(companyIdOverride || procoreConfig.companyId || '').trim();

  // CRITICAL: Stop the request if we still don't have a company ID
  if (!companyId || companyId === 'undefined') {
    throw new Error('MISSING_COMPANY_ID: The Procore Company ID is not configured.');
  }

  console.log(`[Procore API] Requesting: ${url}`);
  console.log(`[Procore API] Using Company ID Header: "${companyId}"`);

  const maxRetries = Math.max(0, Number.parseInt(process.env.PROCORE_API_MAX_RETRIES || '3', 10) || 3);
  const baseDelayMs = Math.max(250, Number.parseInt(process.env.PROCORE_API_RETRY_BASE_MS || '1000', 10) || 1000);
  const maxDelayMs = Math.max(baseDelayMs, Number.parseInt(process.env.PROCORE_API_RETRY_MAX_MS || '15000', 10) || 15000);

  try {
    const requestHeaders: Record<string, string> = {
      'Authorization': `Bearer ${cleanToken}`,
      'Procore-Company-Id': companyId,
      'Accept': 'application/json',
      ...((options?.headers as Record<string, string>) || {}),
    };

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout
      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
          headers: requestHeaders,
        });

        if (response.status === 429 && attempt < maxRetries) {
          const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
          const expoBackoff = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
          const jitter = Math.floor(Math.random() * 250);
          const delayMs = Math.min(maxDelayMs, Math.max(baseDelayMs, retryAfterMs ?? expoBackoff) + jitter);
          console.warn(`[Procore API] Rate limited (429). Retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries}).`);
          await sleep(delayMs);
          continue;
        }

        if (!response.ok) {
          const errorBody = await response.text();
          // 404 is expected for some project-scoped tools that are not enabled.
          const shouldLog = response.status !== 404 && !quietStatuses.includes(response.status);
          if (shouldLog) {
            console.error(`Procore API error ${response.status}:`, errorBody);
          }
          const apiError = new Error(`Procore API error ${response.status}: ${errorBody}`) as Error & { status?: number };
          apiError.status = response.status;
          throw apiError;
        }

        return response.json();
      } finally {
        clearTimeout(timeoutId);
      }
    }

    const exhausted = new Error(`Procore API error 429: exceeded ${maxRetries + 1} attempts`) as Error & { status?: number };
    exhausted.status = 429;
    throw exhausted;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const status = Number((error as { status?: number })?.status || 0);
    const isNotFound = status === 404 || /(?:^|\D)404(?:\D|$)/.test(msg);
    const isQuietStatus = quietStatuses.includes(status);
    const cause = (error as ErrorWithStatusAndCause).cause;
    if (!isNotFound && !isQuietStatus) {
      console.error(`Request to ${url} failed!`);
      console.error(`Message: ${msg}`);
      if (cause) console.error(`Cause:`, cause);
    }

    const wrapped = new Error(`API Request Failed: ${msg}`) as Error & { status?: number };
    if (status > 0) wrapped.status = status;
    throw wrapped;
  }
}
