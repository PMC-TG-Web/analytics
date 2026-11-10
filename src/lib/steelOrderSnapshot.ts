import { createHmac, timingSafeEqual } from 'node:crypto';

type Snapshot = { projectId: string; itemKey: string; quantity: number };
const lifetimeMs = 24 * 60 * 60 * 1000;
function signingSecret() {
  // Same configured key fallback as permission cookies; a distinct HMAC purpose isolates this protocol.
  const secret = process.env.PERMISSIONS_COOKIE_SECRET || process.env.AUTH0_SECRET || process.env.AUTH0_CLIENT_SECRET;
  if (!secret) throw new Error('Steel order snapshot signing is unavailable.');
  return secret;
}
function signature(companyId: string, input: Snapshot, expires: number, secret: string) {
  if (!secret) throw new Error('Steel order snapshot signing is unavailable.');
  return createHmac('sha256', secret).update('steel-order-snapshot:v1\0')
    .update(JSON.stringify([companyId, input.projectId, input.itemKey, input.quantity, expires])).digest();
}

/** Binds a mark to the estimate actually displayed, without rebuilding the report on every click. */
export function createSteelOrderSnapshot(companyId: string, input: Snapshot, secret = signingSecret(), now = Date.now()): string {
  const expires = now + lifetimeMs;
  return `${expires}.${signature(companyId, input, expires, secret).toString('base64url')}`;
}

export function verifySteelOrderSnapshot(token: unknown, companyId: string, input: Snapshot, secret = signingSecret(), now = Date.now()): boolean {
  if (typeof token !== 'string') return false;
  const match = /^(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return false;
  const expires = Number(match[1]);
  if (expires <= now || expires > now + lifetimeMs) return false;
  const actual = Buffer.from(match[2], 'base64url');
  const expected = signature(companyId, input, expires, secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
