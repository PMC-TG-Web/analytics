import { timingSafeEqual } from 'node:crypto';

export function authorizedMarketSync(provided: string | null, expected = process.env.PROCORE_SYNC_SECRET): boolean {
  const secret = expected?.trim();
  if (!secret || !provided) return false;
  const actual = Buffer.from(provided.trim());
  const wanted = Buffer.from(secret);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}
