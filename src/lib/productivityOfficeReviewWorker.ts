import { prisma } from '@/lib/prisma';
import { getClientCredentialsToken } from '@/lib/procore';
import { ensureProductivityOfficeReviewTask } from '@/lib/procoreProductivityReviewTask';

/** Review rows are the durable queue. Existing "sent" email history is not replayed. */
export async function processProductivityOfficeReviews(companyId: string) {
  const staleBefore = new Date(Date.now() - 10 * 60_000);
  const candidates = await prisma.productivityProjectReview.findMany({
    where: {
      companyId,
      status: 'completed',
      notificationEmail: 'todd@pmcdecor.com, david@pmcdecor.com',
      OR: [
        { notificationStatus: { in: ['queued', 'failed'] } },
        { notificationStatus: 'pending', updatedAt: { lte: staleBefore } },
      ],
    },
    orderBy: { updatedAt: 'asc' },
    take: 10,
  });
  let created = 0;
  let failed = 0;
  for (const review of candidates) {
    const claim = await prisma.productivityProjectReview.updateMany({
      where: { id: review.id, updatedAt: review.updatedAt, status: 'completed' },
      data: { notificationStatus: 'pending', notificationError: null },
    });
    if (!claim.count) continue;
    try {
      const result = await ensureProductivityOfficeReviewTask({
        token: await getClientCredentialsToken(), companyId, projectId: review.projectId,
        reviewId: review.id, completionCount: review.completionCount,
        projectName: review.projectName, reviewedByEmail: review.reviewedByEmail || '',
      });
      await prisma.productivityProjectReview.updateMany({
        where: { id: review.id, completionCount: review.completionCount, notificationStatus: 'pending' },
        data: { notificationStatus: 'sent', notificationId: result.taskId, notificationError: null },
      });
      created += 1;
    } catch (error) {
      await prisma.productivityProjectReview.updateMany({
        where: { id: review.id, completionCount: review.completionCount, notificationStatus: 'pending' },
        data: { notificationStatus: 'failed', notificationError: String(error instanceof Error ? error.message : error).slice(0, 1000) },
      });
      failed += 1;
    }
  }
  return { scanned: candidates.length, created, failed };
}
