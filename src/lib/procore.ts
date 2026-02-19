// lib/procore.ts - Procore API utilities

interface ProcoreTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

interface ProcoreAuthCode {
  code: string;
  state?: string;
}

export const procoreConfig = {
  clientId: (process.env.PROCORE_CLIENT_ID || '').trim(),
  clientSecret: (process.env.PROCORE_CLIENT_SECRET || '').trim(),
  companyId: (process.env.PROCORE_COMPANY_ID || '598134325658789').trim(),
  apiUrl: (process.env.PROCORE_API_URL || 'https://api.procore.com').trim(),
  authUrl: (process.env.PROCORE_AUTH_URL || 'https://login.procore.com/oauth/authorize').trim(),
  tokenUrl: (process.env.PROCORE_TOKEN_URL || 'https://api.procore.com/oauth/token').trim(),
  redirectUri: (process.env.NEXT_PUBLIC_REDIRECT_URI || `${process.env.AUTH0_BASE_URL || 'http://localhost:3000'}/api/auth/procore/callback`).trim(),
};

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
  options?: RequestInit
): Promise<any> {
  const apiUrl = (procoreConfig.apiUrl || '').trim();
  const url = `${apiUrl}${endpoint}`;
  const cleanToken = (accessToken || '').trim();
  
  // Use config (which has hardcoded fallback)
  const companyId = procoreConfig.companyId;

  // CRITICAL: Stop the request if we still don't have a company ID
  if (!companyId || companyId === 'undefined') {
    throw new Error('MISSING_COMPANY_ID: The Procore Company ID is not configured.');
  }

  console.log(`[Procore API] Requesting: ${url}`);
  console.log(`[Procore API] Using Company ID Header: "${companyId}"`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

    const requestHeaders: Record<string, string> = {
      'Authorization': `Bearer ${cleanToken}`,
      'Procore-Company-Id': companyId,
      'Accept': 'application/json',
      ...((options?.headers as Record<string, string>) || {}),
    };

    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: requestHeaders,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Procore API error ${response.status}:`, errorBody);
      throw new Error(`Procore API error ${response.status}: ${errorBody}`);
    }

    return response.json();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const cause = (error as any).cause;
    console.error(`Request to ${url} failed!`);
    console.error(`Message: ${msg}`);
    if (cause) console.error(`Cause:`, cause);
    
    throw new Error(`API Request Failed: ${msg}`);
  }
}
