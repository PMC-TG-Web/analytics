import { execFileSync } from 'node:child_process';

const MIGRATIONS_TO_ROLL_BACK = [
  // Migrations listed here are resolved — list is intentionally empty.
  // Add migration names here only if a migration is stuck in a failed state.
];

const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';

for (const migration of MIGRATIONS_TO_ROLL_BACK) {
  try {
    execFileSync(
      npxBin,
      ['prisma', 'migrate', 'resolve', '--rolled-back', migration],
      { stdio: 'inherit' }
    );
  } catch (error) {
    console.warn(
      `[resolveFailedMigration] Continuing without resolving ${migration}. ` +
        'This is expected once the migration is no longer in a failed state.'
    );
  }
}
