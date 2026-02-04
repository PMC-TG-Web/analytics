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
  redirectUri: process.env.NEXT_PUBLIC_REDIRECT_URI,
};

// Get OAuth authorization URL
export function getAuthorizationUrl(state: string = 'default'): string {
  const params = new URLSearchParams({
    client_id: procoreConfig.clientId || '',
    response_type: 'code',
    redirect_uri: procoreConfig.redirectUri || '',
    state,
  });
  return `${procoreConfig.authUrl}?${params.toString()}`;
}

// Exchange authorization code for access token
export async function getAccessToken(code: string): Promise<ProcoreTokenResponse> {
  try {
    const response = await fetch(`${procoreConfig.tokenUrl}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: procoreConfig.clientId || '',
        client_secret: procoreConfig.clientSecret || '',
        redirect_uri: procoreConfig.redirectUri || '',
      }).toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get access token (${response.status}): ${error}`);
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
  const url = `${procoreConfig.apiUrl}${endpoint}`;
  console.log(`Making request to: ${url}`);

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Procore-Company-Id': procoreConfig.companyId || '',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Procore API error ${response.status}: ${errorBody}`);
    }

    return response.json();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`Request to ${url} failed:`, msg);
    throw error;
  }
}
