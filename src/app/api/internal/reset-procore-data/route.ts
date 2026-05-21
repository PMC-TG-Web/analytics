import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * POST /api/internal/reset-procore-data?dryRun=true|false
 *
 * Truncates all Procore-synced tables while preserving app-created data
 * (GanttV2*, ProjectScope, Schedule, KPIEntry, User accounts).
 *
 * Use this when migrating to a new Procore company instance so the next
 * full sync starts with a clean slate.
 *
 * Protected by Bearer CRON_SECRET.
 */

const TABLES_TO_TRUNCATE = [
  // Procore project feed / staging
  'procore_project_feed',
  'procore_project_staging',
  'procore_projects_v1_live',
  'procore_bid_board_live',
  'procore_prime_contracts_live',
  'procore_proposal_line_items_live',
  'procore_project_stages_live',
  // Timecard
  'timecard_entry_unpacked_fields',
  'TimeCardEntry',
  // Productivity
  'productivity_log_unpacked_fields',
  'ProductivityLog',
  // Budget
  'budget_line_item_unpacked_fields',
  'BudgetLineItem',
  // Commitments
  'commitment_change_order_line_item_unpacked_fields',
  'CommitmentChangeOrderLineItem',
  'CommitmentChangeOrder',
  'commitment_contract_unpacked_fields',
  'CommitmentContract',
  // Purchase orders
  'purchase_order_line_item_contract_detail_unpacked_fields',
  'PurchaseOrderLineItemContractDetail',
  'PurchaseOrderContract',
  // Cost codes / estimating
  'ProcoreCostCodeStaging',
  'ProcoreEstimatingCatalogItemStaging',
  // Analytics aggregates
  'DashboardSummary',
  'mv_refresh_tracking',
  // Webhooks
  'ProcoreWebhookQueue',
  'ProcoreWebhookEvent',
  'ProcoreWebhookHook',
  // Core project table (re-synced from Procore)
  'Project',
] as const;

// Tables we verify exist before building the TRUNCATE statement
async function getExistingTables(tableNames: readonly string[]): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename = ANY(${tableNames as unknown as string[]})
  `;
  return rows.map((r) => r.tablename);
}

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get('dryRun') !== 'false';

  const existing = await getExistingTables(TABLES_TO_TRUNCATE);
  const missing = TABLES_TO_TRUNCATE.filter((t) => !existing.includes(t));

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      tablesToTruncate: existing,
      tablesNotFound: missing,
      message: 'Pass ?dryRun=false to execute',
    });
  }

  if (existing.length === 0) {
    return NextResponse.json({ ok: true, truncated: [], skipped: missing });
  }

  // TRUNCATE with CASCADE in a single statement for FK safety
  const quotedTables = existing.map((t) => `"${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quotedTables} CASCADE`);

  return NextResponse.json({
    ok: true,
    truncated: existing,
    skipped: missing,
    message: `Truncated ${existing.length} tables. Re-run full cron sync to repopulate.`,
  });
}
