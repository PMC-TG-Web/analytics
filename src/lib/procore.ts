// lib/procore.ts - Procore API utilities
import { AsyncLocalStorage } from 'node:async_hooks';

import {
  getProcoreBackgroundCooldown,
  recordProcoreQuotaObservation,
} from '@/lib/procoreQuotaControl';
import {
  procoreBackgroundReserve,
  procoreQuotaObservation,
  procoreRateLimitDelayMs,
} from '@/lib/procoreRateLimit';

interface ProcoreTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

type ErrorWithStatusAndCause = Error & {
  status?: number;
  cause?: unknown;
  rateLimitUntil?: Date;
};

type ProcoreRequestContext = {
  lane: 'background' | 'interactive';
  apiRequests: number;
  rateLimitUntil: Date | null;
};

const liveApiBypassStore = new AsyncLocalStorage<ProcoreRequestContext>();

export function getCurrentProcoreRequestMetrics() {
  const context = liveApiBypassStore.getStore();
  return {
    apiRequests: context?.apiRequests || 0,
    rateLimitUntil: context?.rateLimitUntil || null,
  };
}

function recordContextRateLimit(context: ProcoreRequestContext | undefined, until: Date | null) {
  if (!context || !until) return;
  if (!context.rateLimitUntil || until > context.rateLimitUntil) {
    context.rateLimitUntil = until;
  }
}

async function runWithProcoreRequestContext<T>(
  lane: ProcoreRequestContext['lane'],
  operation: () => Promise<T>,
): Promise<T> {
  const context: ProcoreRequestContext = { lane, apiRequests: 0, rateLimitUntil: null };
  return liveApiBypassStore.run(context, async () => {
    const result = await operation();
    if (result instanceof Response) {
      result.headers.set('x-procore-api-request-count', String(context.apiRequests));
      if (context.rateLimitUntil) {
        result.headers.set('x-procore-rate-limit-until', context.rateLimitUntil.toISOString());
      }
    }
    return result;
  });
}

export const procoreConfig = {
  clientId: (process.env.PROCORE_CLIENT_ID || '').trim(),
  clientSecret: (process.env.PROCORE_CLIENT_SECRET || '').trim(),
  companyId: (process.env.PROCORE_COMPANY_ID || '').trim(),
  apiUrl: (process.env.PROCORE_API_URL || 'https://api.procore.com').trim(),
  authUrl: (process.env.PROCORE_AUTH_URL || 'https://login.procore.com/oauth/authorize').trim(),
  tokenUrl: (process.env.PROCORE_TOKEN_URL || 'https://api.procore.com/oauth/token').trim(),
  redirectUri: (process.env.NEXT_PUBLIC_REDIRECT_URI || '').trim(),
};

export function getProcoreRedirectUri(requestOrigin?: string): string {
  const configuredRedirectUri = String(process.env.PROCORE_REDIRECT_URI || '').trim();
  const legacyPublicRedirectUri = String(process.env.NEXT_PUBLIC_REDIRECT_URI || '').trim();

  if (
    configuredRedirectUri &&
    /^https?:\/\//i.test(configuredRedirectUri) &&
    (process.env.NODE_ENV !== 'production' || !/localhost|127\.0\.0\.1/i.test(configuredRedirectUri))
  ) {
    return configuredRedirectUri;
  }

  if (
    process.env.NODE_ENV !== 'production' &&
    legacyPublicRedirectUri &&
    /^https?:\/\//i.test(legacyPublicRedirectUri)
  ) {
    return legacyPublicRedirectUri;
  }

  const configuredBaseUrl = String(
    process.env.APP_BASE_URL || process.env.AUTH0_BASE_URL || requestOrigin || ''
  ).trim().replace(/\/$/, '');

  if (!configuredBaseUrl || !/^https?:\/\//i.test(configuredBaseUrl)) {
    throw new Error('Missing valid app base URL for Procore OAuth redirect URI.');
  }

  return `${configuredBaseUrl}/api/auth/procore/callback`;
}

export function isProcoreLiveApiEnabled(): boolean {
  const value = String(process.env.PROCORE_LIVE_API_ENABLED || '').trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
}

function getRequestSyncSecret(request: Request): string {
  const headerSecret = request.headers.get('x-sync-secret')?.trim();
  if (headerSecret) return headerSecret;

  const cronSecret = request.headers.get('x-cron-secret')?.trim();
  if (cronSecret) return cronSecret;

  const authorization = request.headers.get('authorization')?.trim() || '';
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
  return bearerMatch?.[1]?.trim() || '';
}

function hasProcoreAccessTokenCookie(request: Request): boolean {
  const cookieHeader = request.headers.get('cookie') || '';
  return /(?:^|;\s*)procore_access_token=/.test(cookieHeader);
}

export function hasValidProcoreSyncSecret(request: Request): boolean {
  const provided = getRequestSyncSecret(request);
  return Boolean(provided) && [process.env.PROCORE_SYNC_SECRET, process.env.CRON_SECRET]
    .some((secret) => Boolean(secret?.trim()) && provided === secret!.trim());
}

export function withProcoreLiveApiBypassForSyncSecret<T>(
  request: Request,
  operation: () => Promise<T>
): Promise<T> {
  if (!hasValidProcoreSyncSecret(request)) {
    return operation();
  }

  return runWithProcoreRequestContext('background', operation);
}

export function withProcoreLiveApiBypassForAuthenticatedSession<T>(
  request: Request,
  operation: () => Promise<T>
): Promise<T> {
  if (hasValidProcoreSyncSecret(request)) {
    return runWithProcoreRequestContext('background', operation);
  }
  if (!hasProcoreAccessTokenCookie(request)) {
    return operation();
  }

  return runWithProcoreRequestContext('interactive', operation);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Get OAuth authorization URL
export function getAuthorizationUrl(state: string = 'default', redirectUriOverride?: string): string {
  const redirectUri = String(redirectUriOverride || procoreConfig.redirectUri || '').trim();
  const params = new URLSearchParams({
    client_id: (procoreConfig.clientId || '').trim(),
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
  });
  return `${procoreConfig.authUrl}?${params.toString()}`;
}

// Exchange authorization code for access token
export async function getAccessToken(code: string, redirectUriOverride?: string): Promise<ProcoreTokenResponse> {
  try {
    const clientId = (procoreConfig.clientId || '').trim();
    const clientSecret = (procoreConfig.clientSecret || '').trim();
    const redirectUri = String(redirectUriOverride || procoreConfig.redirectUri || '').trim();
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

// Get a service-account token using client_credentials grant.
// This token has company-level access to all projects (vs. user OAuth which is scoped to the user's memberships).
let _cachedServiceToken: { token: string; expiresAt: number } | null = null;
export async function getClientCredentialsToken(): Promise<string> {
  // NOTE: No PROCORE_LIVE_API_ENABLED check here — client credentials are a
  // pure server-to-server call (cron, webhooks). The live API gate in
  // middleware already protects browser/user-initiated routes.

  if (_cachedServiceToken && Date.now() < _cachedServiceToken.expiresAt - 30_000) {
    return _cachedServiceToken.token;
  }
  const clientId = (procoreConfig.clientId || '').trim();
  const clientSecret = (procoreConfig.clientSecret || '').trim();
  if (!clientId || !clientSecret) {
    throw new Error('PROCORE_CLIENT_ID and PROCORE_CLIENT_SECRET must be set to use client credentials');
  }
  const tokenUrl = (procoreConfig.tokenUrl || '').trim();
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });
  if (!response.ok) {
    const body = await response.text();
    const quota = procoreQuotaObservation(response.headers, response.status, {
      reserve: 0,
      fallbackCooldownMs: 15 * 60_000,
    });
    const tokenError = new Error(
      `Client credentials token request failed (${response.status}): ${body}`,
    ) as ErrorWithStatusAndCause;
    tokenError.status = response.status;
    tokenError.rateLimitUntil = quota.cooldownUntil || undefined;
    throw tokenError;
  }
  const data = (await response.json()) as ProcoreTokenResponse;
  _cachedServiceToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return data.access_token;
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
  const requestContext = liveApiBypassStore.getStore();
  if (!isProcoreLiveApiEnabled() && !requestContext) {
    throw new Error('PROCORE_LIVE_API_DISABLED: Set PROCORE_LIVE_API_ENABLED=true to allow outbound Procore API requests.');
  }

  const apiUrl = (procoreConfig.apiUrl || '').trim();
  const url = `${apiUrl}${endpoint}`;
  const cleanToken = (accessToken || '').trim();
  
  // Use explicit company override when provided, otherwise fall back to config.
  const companyId = String(companyIdOverride || procoreConfig.companyId || '').trim();

  // CRITICAL: Stop the request if we still don't have a company ID
  if (!companyId || companyId === 'undefined') {
    throw new Error('MISSING_COMPANY_ID: The Procore Company ID is not configured.');
  }

  if (requestContext?.lane === 'background') {
    const cooldownUntil = await getProcoreBackgroundCooldown(companyId);
    if (cooldownUntil) {
      recordContextRateLimit(requestContext, cooldownUntil);
      const deferred = new Error(
        `Procore background rate limit cooldown is active until ${cooldownUntil.toISOString()}.`,
      ) as Error & { status?: number; rateLimitUntil?: Date };
      deferred.status = 429;
      deferred.rateLimitUntil = cooldownUntil;
      throw deferred;
    }
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
        if (requestContext) requestContext.apiRequests += 1;
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
          headers: requestHeaders,
        });

        const quota = procoreQuotaObservation(response.headers, response.status, {
          reserve: procoreBackgroundReserve(process.env.PROCORE_API_BACKGROUND_RESERVE),
          fallbackCooldownMs: 15 * 60_000,
        });
        recordContextRateLimit(requestContext, quota.cooldownUntil);
        if (quota.cooldownUntil || quota.rateLimited) {
          await recordProcoreQuotaObservation({
            companyId,
            observation: quota,
            error: response.status === 429 ? `Procore API rate limit reached for ${endpoint}.` : null,
          }).catch((quotaError) => {
            console.error('[Procore API] Failed to persist quota state:', quotaError);
          });
        }

        if (response.status === 429 && attempt < maxRetries) {
          const expoBackoff = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
          const jitter = Math.floor(Math.random() * 250);
          const delayMs = procoreRateLimitDelayMs(response.headers, {
            fallbackMs: Math.max(baseDelayMs, expoBackoff) + jitter,
            maxDelayMs,
          });
          await response.body?.cancel().catch(() => undefined);
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
          const apiError = new Error(`Procore API error ${response.status}: ${errorBody}`) as ErrorWithStatusAndCause;
          apiError.status = response.status;
          apiError.rateLimitUntil = quota.cooldownUntil || undefined;
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

    const wrapped = new Error(`API Request Failed: ${msg}`) as ErrorWithStatusAndCause;
    if (status > 0) wrapped.status = status;
    wrapped.rateLimitUntil = (error as ErrorWithStatusAndCause).rateLimitUntil;
    throw wrapped;
  }
}
