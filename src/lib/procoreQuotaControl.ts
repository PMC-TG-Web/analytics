import { prisma } from "@/lib/prisma";
import type { ProcoreQuotaObservation } from "@/lib/procoreRateLimit";

const quotaCooldownCache = new Map<string, { checkedAt: number; until: Date | null }>();
const QUOTA_CACHE_MS = 5_000;

export async function getProcoreBackgroundCooldown(companyId: string, now = new Date()) {
  const cached = quotaCooldownCache.get(companyId);
  if (cached && now.getTime() - cached.checkedAt < QUOTA_CACHE_MS) {
    return cached.until && cached.until > now ? cached.until : null;
  }

  const rows = await prisma.$queryRawUnsafe<Array<{ rate_limit_until: Date | null }>>(
    `SELECT rate_limit_until FROM procore_sync_controls WHERE company_id = $1`,
    companyId,
  );
  const until = rows[0]?.rate_limit_until || null;
  quotaCooldownCache.set(companyId, { checkedAt: now.getTime(), until });
  return until && until > now ? until : null;
}

export async function recordProcoreQuotaObservation(params: {
  companyId: string;
  observation: ProcoreQuotaObservation;
  error?: string | null;
}) {
  const { observation } = params;
  if (
    observation.limit === null
    && observation.remaining === null
    && observation.resetAt === null
    && !observation.rateLimited
  ) return;

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO procore_sync_controls (
        company_id, rate_limit_until, last_429_at, last_error,
        rate_limit_limit, rate_limit_remaining, rate_limit_reset_at,
        rate_limit_observed_at, created_at, updated_at
      ) VALUES (
        $1, $2, CASE WHEN $3 THEN NOW() ELSE NULL END,
        CASE WHEN $3 THEN $4 ELSE NULL END,
        $5, $6, $7, NOW(), NOW(), NOW()
      )
      ON CONFLICT (company_id)
      DO UPDATE SET
        rate_limit_until = CASE
          WHEN EXCLUDED.rate_limit_until IS NULL THEN procore_sync_controls.rate_limit_until
          ELSE GREATEST(
            COALESCE(procore_sync_controls.rate_limit_until, EXCLUDED.rate_limit_until),
            EXCLUDED.rate_limit_until
          )
        END,
        last_429_at = CASE
          WHEN $3 THEN NOW()
          ELSE procore_sync_controls.last_429_at
        END,
        last_error = CASE
          WHEN $3 THEN EXCLUDED.last_error
          ELSE procore_sync_controls.last_error
        END,
        rate_limit_limit = COALESCE(EXCLUDED.rate_limit_limit, procore_sync_controls.rate_limit_limit),
        rate_limit_remaining = COALESCE(EXCLUDED.rate_limit_remaining, procore_sync_controls.rate_limit_remaining),
        rate_limit_reset_at = COALESCE(EXCLUDED.rate_limit_reset_at, procore_sync_controls.rate_limit_reset_at),
        rate_limit_observed_at = NOW(),
        updated_at = NOW()
    `,
    params.companyId,
    observation.cooldownUntil,
    observation.rateLimited,
    params.error || "Procore API rate limit reached.",
    observation.limit,
    observation.remaining,
    observation.resetAt,
  );

  if (observation.cooldownUntil) {
    quotaCooldownCache.set(params.companyId, {
      checkedAt: Date.now(),
      until: observation.cooldownUntil,
    });
  }
}