export const PERMISSION_COOKIE_NAME = 'analytics_permissions';
const DEFAULT_PERMISSION_COOKIE_MAX_AGE_SECONDS = 60 * 60;

function resolvePermissionCookieMaxAgeSeconds(): number {
  const fromEnv = Number.parseInt(String(process.env.PERMISSION_COOKIE_MAX_AGE_SECONDS || '').trim(), 10);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return fromEnv;
  }
  return DEFAULT_PERMISSION_COOKIE_MAX_AGE_SECONDS;
}

export const PERMISSION_COOKIE_MAX_AGE_SECONDS = resolvePermissionCookieMaxAgeSeconds();

type PermissionCookiePayload = {
  v: 1;
  email: string;
  permissions: string[];
  exp: number;
};

function getPermissionCookieSecret() {
  return (
    process.env.PERMISSIONS_COOKIE_SECRET ||
    process.env.AUTH0_SECRET ||
    process.env.AUTH0_CLIENT_SECRET ||
    ''
  );
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlToBytes(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

async function importSigningKey(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

function normalizePermissions(permissions: string[]) {
  return Array.from(
    new Set(
      permissions
        .filter((permission) => typeof permission === 'string' && permission.trim().length > 0)
        .map((permission) => permission.trim())
    )
  );
}

function isPermissionCookiePayload(value: unknown): value is PermissionCookiePayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<PermissionCookiePayload>;
  return (
    payload.v === 1 &&
    typeof payload.email === 'string' &&
    Array.isArray(payload.permissions) &&
    typeof payload.exp === 'number'
  );
}

export function getPermissionCookieOptions() {
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' as const : 'lax' as const,
    path: '/',
    maxAge: PERMISSION_COOKIE_MAX_AGE_SECONDS,
  };
}

export async function createPermissionCookieValue(
  email: string,
  permissions: string[]
): Promise<string | null> {
  const secret = getPermissionCookieSecret();
  if (!secret) return null;

  const payload: PermissionCookiePayload = {
    v: 1,
    email: email.trim().toLowerCase(),
    permissions: normalizePermissions(permissions),
    exp: Math.floor(Date.now() / 1000) + PERMISSION_COOKIE_MAX_AGE_SECONDS,
  };
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const payloadPart = bytesToBase64Url(payloadBytes);
  const key = await importSigningKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadPart));

  return `${payloadPart}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function verifyPermissionCookieValue(
  cookieValue: string | undefined,
  expectedEmail: string | null
): Promise<PermissionCookiePayload | null> {
  const secret = getPermissionCookieSecret();
  if (!secret || !cookieValue || !expectedEmail) return null;

  const [payloadPart, signaturePart] = cookieValue.split('.');
  if (!payloadPart || !signaturePart) return null;

  try {
    const key = await importSigningKey(secret);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlToBytes(signaturePart),
      new TextEncoder().encode(payloadPart)
    );
    if (!valid) return null;

    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadPart))) as unknown;
    if (!isPermissionCookiePayload(payload)) return null;
    if (payload.email.toLowerCase() !== expectedEmail.trim().toLowerCase()) return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;

    return {
      ...payload,
      permissions: normalizePermissions(payload.permissions),
    };
  } catch {
    return null;
  }
}