import { execFileSync } from 'node:child_process';

const MIGRATION_TO_ROLL_BACK = '20260504153000_add_projects_master_covering_indexes';

const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';

try {
  execFileSync(
    npxBin,
    ['prisma', 'migrate', 'resolve', '--rolled-back', MIGRATION_TO_ROLL_BACK],
    { stdio: 'inherit' }
  );
} catch (error) {
  console.warn(
    `[resolveFailedMigration] Continuing without resolving ${MIGRATION_TO_ROLL_BACK}. ` +
      'This is expected once the migration is no longer in a failed state.'
  );
}
