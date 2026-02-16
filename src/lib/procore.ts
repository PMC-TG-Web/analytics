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
  clientId: process.env.PROCORE_CLIENT_ID,
  clientSecret: process.env.PROCORE_CLIENT_SECRET,
  companyId: process.env.PROCORE_COMPANY_ID,
  apiUrl: process.env.PROCORE_API_URL,
  authUrl: process.env.PROCORE_AUTH_URL,
  tokenUrl: process.env.PROCORE_TOKEN_URL,
  redirectUri: process.env.NEXT_PUBLIC_REDIRECT_URI || `${process.env.AUTH0_BASE_URL || 'http://localhost:3000'}/api/auth/procore/callback`,
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

// Make authenticated request to Procore API
export async function makeRequest(
  endpoint: string,
  accessToken: string,
  options?: RequestInit
): Promise<any> {
  const apiUrl = (procoreConfig.apiUrl || '').trim();
  const url = `${apiUrl}${endpoint}`;
  const cleanToken = (accessToken || '').trim();
  const companyId = (procoreConfig.companyId || '').trim();

  console.log(`Making request to: ${url}`);
  console.log(`Using Company ID: "${companyId}"`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${cleanToken}`,
        'Procore-Company-Id': companyId,
        'Accept': 'application/json',
        ...options?.headers,
      },
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
