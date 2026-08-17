import { prisma } from "@/lib/prisma";
import { normalizeQboCustomerId } from "@/lib/qboProjectExclusionFilter";

export { excludeMarkedQboProjects } from "@/lib/qboProjectExclusionFilter";

export async function loadExcludedQboCustomerIds() {
  const rows = await prisma.qboProjectExclusion.findMany({
    select: { qboCustomerId: true },
  });
  return new Set(rows.map((row) => row.qboCustomerId));
}

export async function isQboProjectExcluded(qboCustomerId: unknown) {
  const normalized = normalizeQboCustomerId(qboCustomerId);
  if (!normalized) return false;
  const exclusion = await prisma.qboProjectExclusion.findUnique({
    where: { qboCustomerId: normalized },
    select: { qboCustomerId: true },
  });
  return Boolean(exclusion);
}
