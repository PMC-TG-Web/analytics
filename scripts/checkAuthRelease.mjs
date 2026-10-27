// Runs before production migrations/build. Read-only, no Procore calls, no credentials in output.
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { validateAuthReleaseAccounts, validateAuthReleaseConfiguration } from '../src/lib/authReleasePreflight.ts';

if (process.env.CONTEXT !== 'production' && !process.argv.includes('--check')) {
  console.log('Auth release database preflight applies to production builds only.');
} else {
  let db;
  try {
    validateAuthReleaseConfiguration(process.env);
    const expected = JSON.parse(fs.readFileSync(new URL('../config/authReleaseAccounts.json', import.meta.url), 'utf8'));
    const url = process.env.DIRECT_DATABASE_URL;
    if (!url || !/^postgres(?:ql)?:\/\//.test(url)) throw new Error('Production direct database configuration is required for the read-only access check.');
    db = new PrismaClient({ datasources: { db: { url } }, log: [] });
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '10000ms'");
      const accounts = await tx.user.findMany({
        where: { OR: Object.values(expected).map(email => ({ email: { equals: email, mode: 'insensitive' } })) },
        select: { email: true, isActive: true, permissions: true },
      });
      validateAuthReleaseAccounts(accounts, expected);
    }, { timeout: 15000 });
    console.log('Auth release preflight passed: dedicated connections, owner administration and employee analytics access.');
  } catch (error) {
    // Database exceptions can contain connection details; only our fixed validation messages are safe.
    const message = error instanceof Error && /^(Production |Missing PROCORE_|Invalid PROCORE_|Configure both PROCORE_|Analytics sync |Billing |Release access check failed:)/.test(error.message)
      ? error.message : 'Unable to verify production access; release stopped.';
    console.error(message);
    process.exitCode = 1;
  } finally { await db?.$disconnect(); }
}
