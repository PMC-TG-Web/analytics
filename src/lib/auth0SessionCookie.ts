function resolveAppBaseUrl(explicitBaseUrl?: string) {
  return explicitBaseUrl || process.env.APP_BASE_URL;
}

export function resolveAuth0SessionCookieOptions(explicitBaseUrl?: string) {
  const baseUrl = (resolveAppBaseUrl(explicitBaseUrl) || '').trim().toLowerCase();
  const secureContext = process.env.NODE_ENV === 'production' || baseUrl.startsWith('https://');

  if (secureContext) {
    return {
      sameSite: 'none' as const,
      secure: true,
    };
  }

  return {
    sameSite: 'lax' as const,
    secure: false,
  };
}
