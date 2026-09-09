import type { PrismaClient } from "@prisma/client";

export const WEBHOOK_CLAIM_TIMEOUT_MS = 15 * 60_000;

export async function recoverStaleWebhookClaims(db: Pick<PrismaClient, "procoreWebhookQueue">, now = new Date()) {
  const cutoff = new Date(now.getTime() - WEBHOOK_CLAIM_TIMEOUT_MS);
  const stale = await db.procoreWebhookQueue.findMany({
    where: {
      status: "processing",
      OR: [{ lockedAt: { lt: cutoff } }, { lockedAt: null, updatedAt: { lt: cutoff } }],
    },
    select: { id: true, lockedAt: true, lockedBy: true, attempts: true, maxAttempts: true },
    orderBy: { updatedAt: "asc" },
    take: 100,
  });
  let recovered = 0;
  let failed = 0;
  for (const item of stale) {
    const exhausted = item.attempts >= item.maxAttempts;
    const result = await db.procoreWebhookQueue.updateMany({
      // Fence recovery against another worker that already reclaimed this item.
      where: { id: item.id, status: "processing", lockedAt: item.lockedAt, lockedBy: item.lockedBy },
      data: {
        status: exhausted ? "failed" : "pending",
        availableAt: now,
        lockedAt: null,
        lockedBy: null,
        lastError: exhausted ? "Webhook worker interrupted; retry limit exhausted." : "Recovered interrupted webhook worker.",
      },
    });
    if (exhausted) failed += result.count;
    else recovered += result.count;
  }
  return { recovered, failed };
}
