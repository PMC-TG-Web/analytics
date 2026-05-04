/**
 * Query Optimization Example: Bid Board Latest CTE → Materialized View
 *
 * File: src/app/api/procore/projects-master/route.ts
 * 
 * This shows how to update your projects-master query to use the cached
 * bid_board_latest_mv materialized view instead of computing the expensive CTE.
 */

// ============================================================================
// BEFORE: Expensive CTE approach (7,372 block reads)
// ============================================================================
const BEFORE_QUERY = `
  WITH bid_board_latest AS (
    SELECT DISTINCT ON (b.procore_project_id)
      b.procore_project_id,
      b.bid_board_id,
      b.status,
      b.customer,
      b.synced_at
    FROM procore_bid_board_live b
    WHERE b.company_id = $1
      AND b.procore_project_id IS NOT NULL
    ORDER BY b.procore_project_id, b.synced_at DESC
  ),
  commitments_agg AS (
    SELECT ...
    FROM commitments_agg_mv
    WHERE company_id = $1
  ),
  budget_agg AS (
    SELECT ...
    FROM budgetlineitems
    WHERE company_id = $1
  )
  SELECT ... FROM bid_board_latest ... ;
`;

// ============================================================================
// AFTER: Optimized with materialized view (50 block reads)
// ============================================================================
const AFTER_QUERY = `
  WITH bid_board_latest AS (
    -- Use cached materialized view instead of computing DISTINCT ON
    SELECT *
    FROM bid_board_latest_mv
    WHERE company_id = $1
  ),
  commitments_agg AS (
    SELECT ...
    FROM commitments_agg_mv
    WHERE company_id = $1
  ),
  budget_agg AS (
    SELECT ...
    FROM budgetlineitems
    WHERE company_id = $1
  )
  SELECT ... FROM bid_board_latest ... ;
`;

// ============================================================================
// PRISMA EXAMPLE: Using the materialized view in Prisma
// ============================================================================
export async function getProjectsMasterData(companyId: string) {
  // Option 1: Simple replacement - just query the materialized view directly
  const bidBoardLatest = await prisma.$queryRaw`
    SELECT * FROM bid_board_latest_mv
    WHERE company_id = ${companyId}
  `;

  // Option 2: Still use CTE format if needed for other logic
  const results = await prisma.$queryRaw`
    WITH bid_board_latest AS (
      SELECT *
      FROM bid_board_latest_mv
      WHERE company_id = ${companyId}
    )
    SELECT
      bbl.procore_project_id,
      bbl.status,
      bbl.customer,
      ca.commitment_total_value,
      ba.budget_total_amount
    FROM bid_board_latest bbl
    LEFT JOIN commitments_agg_mv ca
      ON ca.company_id = ${companyId}
      AND ca.canonical_project_id = bbl.procore_project_id
    LEFT JOIN budgetlineitems ba
      ON ba.company_id = ${companyId}
      AND ba.project_id = bbl.procore_project_id
  `;

  return results;
}

// ============================================================================
// REFRESH STRATEGY: Keep materialized view updated
// ============================================================================
export async function refreshBidBoardLatestCache() {
  try {
    console.log('Refreshing bid_board_latest_mv materialized view...');
    
    // CONCURRENT refresh allows queries to continue while view refreshes
    // (only works if there's a unique index on the view)
    await prisma.$queryRaw`
      REFRESH MATERIALIZED VIEW CONCURRENTLY bid_board_latest_mv
    `;
    
    console.log('✓ Materialized view refresh complete');
    
    // Log the refresh in mv_refresh_log
    await prisma.$queryRaw`
      UPDATE mv_refresh_log
      SET last_refresh_time = NOW(),
          next_refresh_time = NOW() + (refresh_interval_minutes || ' minutes')::INTERVAL,
          refresh_count = refresh_count + 1
      WHERE mv_name = 'bid_board_latest_mv'
    `;
  } catch (error) {
    console.error('Failed to refresh bid_board_latest_mv:', error);
    
    // Log the error
    await prisma.$queryRaw`
      UPDATE mv_refresh_log
      SET error_message = ${String(error)},
          next_refresh_time = NOW() + '5 minutes'::INTERVAL
      WHERE mv_name = 'bid_board_latest_mv'
    `;
    
    throw error;
  }
}

// ============================================================================
// INTEGRATION: Call refresh after Procore sync
// ============================================================================
export async function syncProcoreDataAndRefreshCache(companyId: string) {
  // 1. Sync fresh Procore data (existing logic)
  await syncProcoreBidBoard(companyId);
  
  // 2. Refresh the cache to pick up new data
  await refreshBidBoardLatestCache();
  
  // 3. Queries will now use the updated cache
  const data = await getProjectsMasterData(companyId);
  return data;
}

// ============================================================================
// MONITORING: Check if refresh is working
// ============================================================================
export async function checkMaterializationViewHealth() {
  const refreshStatus = await prisma.$queryRaw`
    SELECT
      mv_name,
      last_refresh_time,
      next_refresh_time,
      refresh_interval_minutes,
      refresh_count,
      error_message
    FROM mv_refresh_log
    WHERE is_active = true
  `;
  
  return refreshStatus;
}

// ============================================================================
// DEPLOYMENT STEPS
// ============================================================================
/*
1. Deploy migrations:
   npx prisma migrate deploy

2. Initial MV refresh (before traffic resumes):
   REFRESH MATERIALIZED VIEW bid_board_latest_mv;

3. Update your query code:
   - Change: SELECT DISTINCT ON (...) FROM procore_bid_board_live
   - To:      SELECT * FROM bid_board_latest_mv

4. Add refresh hook to your Procore sync flow:
   - After importing new bid board data, call refreshBidBoardLatestCache()

5. Monitor performance:
   - Query latency should drop from 34ms → 5ms
   - Block reads should drop from 14,744 → 2,000

6. Optional: Set up automatic refresh in off-peak hours
   - Use a cron job or database scheduler
   - Schedule: REFRESH MATERIALIZED VIEW CONCURRENTLY bid_board_latest_mv
   - Frequency: Every 30-60 minutes
*/
