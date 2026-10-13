import { prisma } from '@/lib/prisma';
import { getClientCredentialsToken, makeRequest, withProcoreLiveApiBypassForSyncSecret } from '@/lib/procore';
import { acquireProcoreWorker, releaseProcoreWorker } from '@/lib/procoreSyncQueue';
import { loadSubcontractAllocation } from '@/lib/loadSubcontractAllocation';
import { groupNamesFromRecords } from '@/lib/subcontractAllocationGroups';

/** Controlled metadata ingestion; never changes estimates, budgets or POs in Procore. */
export async function syncSubcontractAllocationGroups(companyId: string, projectId: string) {
  const { source, missingGroupNames } = await loadSubcontractAllocation(companyId, projectId);
  if (!missingGroupNames) return { synced: true };
  const secret = process.env.PROCORE_SYNC_SECRET || process.env.SYNC_SECRET;
  if (!secret) throw new Error('The server sync connection is not configured.');
  return withProcoreLiveApiBypassForSyncSecret(new Request('http://internal/allocation-groups', { headers: { 'x-sync-secret': secret, 'x-procore-connection': 'shared' } }), async () => {
    const lease = await acquireProcoreWorker(companyId);
    if (!lease.acquired) return { synced: false, message: 'Group names are waiting for Procore sync capacity. Use Reload to retry.' };
    try {
      const token = await getClientCredentialsToken();
      const groups: unknown[] = [];
      let complete = false;
      for (let page = 1; page <= 3; page++) {
        const result = await makeRequest(`/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/bid_board_projects/${encodeURIComponent(source.bidBoardProjectId)}/proposals/${encodeURIComponent(source.proposalId)}/line_item_groups?page=${page}&per_page=100`, token, {}, companyId);
        const payload = result as { data?: unknown; line_item_groups?: unknown; groups?: unknown };
        const batch = Array.isArray(result) ? result : payload?.data || payload?.line_item_groups || payload?.groups;
        if (!Array.isArray(batch)) throw new Error('The group-name response was incomplete.');
        groups.push(...batch);
        if (batch.length < 100) { complete = true; break; }
      }
      if (!complete) throw new Error('The estimate has too many groups to refresh in one request.');
      const names = groupNamesFromRecords(groups);
      const required = new Set(source.lines.map(line => line.groupId).filter(Boolean));
      if ([...required].some(id => !names.has(id))) throw new Error('Some estimate groups changed in Procore. Sync the estimate before refreshing group names.');
      await prisma.$transaction([...names].map(([groupId, groupName]) => prisma.procoreEstimateLineItem.updateMany({
        where: { companyId, bidBoardProjectId: source.bidBoardProjectId, proposalId: source.proposalId, groupId }, data: { groupName },
      })));
      return { synced: true };
    } finally { await releaseProcoreWorker(companyId, lease.leaseId); }
  });
}
