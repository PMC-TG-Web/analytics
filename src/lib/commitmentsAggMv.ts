import { prisma } from "@/lib/prisma";

function isMissingRelationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("does not exist") || message.includes("undefined_table");
}

export async function refreshCommitmentsAggMaterializedView(): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY commitments_agg_mv`);
    return;
  } catch (error) {
    // Fallback for environments where concurrent refresh cannot run.
    if (isMissingRelationError(error)) return;
  }

  try {
    await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW commitments_agg_mv`);
  } catch (error) {
    if (!isMissingRelationError(error)) {
      console.error("[commitmentsAggMv] refresh failed:", error);
    }
  }
}
