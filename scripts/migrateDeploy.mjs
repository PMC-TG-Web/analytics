/**
 * Retry wrapper for `prisma migrate deploy`.
 * Handles transient "too many connections" errors that can occur during Netlify builds
 * when the prisma_migration role connection limit is briefly saturated.
 */
import { execFileSync } from 'node:child_process';

const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 3000;

const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  try {
    execFileSync(npxBin, ['prisma', 'migrate', 'deploy'], { stdio: 'inherit' });
    process.exit(0);
  } catch (error) {
    const msg = error?.stderr?.toString() || error?.message || '';
    const isTooManyConnections = msg.includes('too many connections') || (error?.status === 1 && attempt < MAX_ATTEMPTS);

    if (isTooManyConnections && attempt < MAX_ATTEMPTS) {
      const delay = BASE_DELAY_MS * attempt;
      console.warn(`[migrateDeploy] Attempt ${attempt} failed (too many connections). Retrying in ${delay / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    } else {
      console.error(`[migrateDeploy] Migration deploy failed after ${attempt} attempt(s).`);
      process.exit(1);
    }
  }
}
