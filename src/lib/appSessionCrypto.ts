import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export function createAppSessionToken() { return randomBytes(32).toString('base64url'); }
export function hashAppSessionToken(token: string) { return createHash('sha256').update(token).digest('hex'); }
export function isAppSessionToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
}

function encryptionKey() {
  const secret = process.env.PROCORE_APP_SESSION_SECRET || '';
  if (Buffer.byteLength(secret) < 32) throw new Error('PROCORE_APP_SESSION_SECRET must contain at least 32 bytes.');
  return createHash('sha256').update(secret).digest();
}

export function encryptAppCredential(value: string, sessionHash: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(sessionHash));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

export function decryptAppCredential(value: string, sessionHash: string) {
  const parts = value.split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted app credential.');
  const [iv, tag, ciphertext] = parts.map((part) => Buffer.from(part, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAAD(Buffer.from(sessionHash));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
