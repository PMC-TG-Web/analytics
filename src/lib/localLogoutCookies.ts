const LOCAL_AUTH_COOKIES = [
  '__session', 'appSession', 'dev_user_email', 'analytics_permissions',
  'procore_access_token', 'procore_refresh_token', 'procore_company_id',
  'procore_scope', 'analytics_procore_user', 'analytics_procore_link_access',
];

export function localLogoutCookies(cookieNames: string[], secure: boolean) {
  const names = new Set(LOCAL_AUTH_COOKIES);
  // Auth0 v4 chunks use __N; the legacy appSession cookie uses .N.
  for (const name of cookieNames) {
    if (/^(?:__session__\d+|appSession\.\d+)$/.test(name)) names.add(name);
  }
  return [...names].map(name => ({
    name, value: '', path: '/', expires: new Date(0), maxAge: 0,
    httpOnly: true, secure, sameSite: secure ? 'none' as const : 'lax' as const,
  }));
}
