type LocalRequest = {
  nextUrl: { hostname: string };
  cookies: { get(name: string): { value: string } | undefined };
};

export function isLocalDeveloperRequest(request: Pick<LocalRequest, 'nextUrl'>, environment = process.env.NODE_ENV) {
  return environment === 'development'
    && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(request.nextUrl.hostname.toLowerCase());
}

export function getDeveloperEmail(request: LocalRequest, environment = process.env.NODE_ENV): string | null {
  if (!isLocalDeveloperRequest(request, environment)) return null;
  const email = request.cookies.get('dev_user_email')?.value.trim().toLowerCase();
  return email && email.includes('@') ? email : null;
}
