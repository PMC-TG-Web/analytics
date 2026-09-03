export const PROCORE_USER_SESSION_COOKIE = "analytics_procore_user";
export const DEFAULT_PROCORE_USER_SESSION_MAX_AGE_SECONDS = 2 * 60 * 60;

type ProcoreUserSessionPayload = {
  v: 1;
  email: string;
  exp: number;
};

function sessionSecret(): string {
  return (
    process.env.PROCORE_USER_SESSION_SECRET
    || process.env.PERMISSIONS_COOKIE_SECRET
    || process.env.AUTH0_SECRET
    || process.env.AUTH0_CLIENT_SECRET
    || ""
  ).trim();
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function signingKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function normalizeEmail(value: unknown): string | null {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function getProcoreUserSessionCookieOptions(maxAge = DEFAULT_PROCORE_USER_SESSION_MAX_AGE_SECONDS) {
  const isProduction = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" as const : "lax" as const,
    path: "/",
    maxAge: Math.max(1, Math.floor(maxAge)),
  };
}

export async function createProcoreUserSessionCookieValue(
  emailValue: unknown,
  maxAge = DEFAULT_PROCORE_USER_SESSION_MAX_AGE_SECONDS,
): Promise<string | null> {
  const secret = sessionSecret();
  const email = normalizeEmail(emailValue);
  if (!secret || !email) return null;

  const payload: ProcoreUserSessionPayload = {
    v: 1,
    email,
    exp: Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(maxAge)),
  };
  const payloadPart = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await signingKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadPart));
  return `${payloadPart}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function verifyProcoreUserSessionCookieValue(
  cookieValue: string | undefined,
): Promise<ProcoreUserSessionPayload | null> {
  const secret = sessionSecret();
  if (!secret || !cookieValue) return null;

  const [payloadPart, signaturePart] = cookieValue.split(".");
  if (!payloadPart || !signaturePart) return null;

  try {
    const key = await signingKey(secret);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlToBytes(signaturePart),
      new TextEncoder().encode(payloadPart),
    );
    if (!valid) return null;

    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadPart))) as Partial<ProcoreUserSessionPayload>;
    const email = normalizeEmail(payload.email);
    if (payload.v !== 1 || !email || typeof payload.exp !== "number") return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return { v: 1, email, exp: payload.exp };
  } catch {
    return null;
  }
}
