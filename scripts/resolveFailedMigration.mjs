import { execFileSync } from 'node:child_process';

const MIGRATIONS_TO_ROLL_BACK = [
  '20260504153000_add_projects_master_covering_indexes',
  '20260505120000_add_bid_board_latest_materialized_view',
  '20260505130000_verify_budget_agg_indexes',
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
