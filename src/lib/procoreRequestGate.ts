import { Prisma } from '@prisma/client';
import { currentProcoreConnection, procoreCoordinationTables, type ProcoreConnection } from '@/lib/procoreConnection';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { procoreBackgroundReserve, procoreQuotaObservation, type ProcoreQuotaObservation } from '@/lib/procoreRateLimit';
import {
  observeProcoreBudget, procoreUsageEndpoint, reserveProcoreRequest, PROCORE_REQUEST_LEASE_MS,
  type ProcoreBudgetWindow, type ProcoreRequestLane,
} from '@/lib/procoreRequestBudget';

type GateRow = {
  lease_id: string | null; lease_until: Date | null; interactive_until: Date | null;
  blocked_until: Date | null; windows: ProcoreBudgetWindow[]; now: Date;
};
export type ProcoreRequestPermit = { leaseId: string; companyId: string; lane: ProcoreRequestLane; connection?: ProcoreConnection };

export async function acquireProcoreRequestPermit(companyId: string, lane: ProcoreRequestLane) {
  const connection = currentProcoreConnection();
  const table = Prisma.raw(procoreCoordinationTables(connection).gates);
  // Lock only while reserving within this app/company, never during a fetch.
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`INSERT INTO ${table} (company_id) VALUES (${companyId}) ON CONFLICT DO NOTHING`;
    const [row] = await tx.$queryRaw<GateRow[]>`SELECT *, clock_timestamp() AS now FROM ${table} WHERE company_id = ${companyId} FOR UPDATE`;
    const now = row.now.getTime();
    const decision = reserveProcoreRequest({
      leaseId: row.lease_id, leaseUntil: row.lease_until?.getTime() || 0,
      interactiveUntil: row.interactive_until?.getTime() || 0,
      blockedUntil: row.blocked_until?.getTime() || 0, windows: row.windows,
    }, lane, now, procoreBackgroundReserve(process.env.PROCORE_API_BACKGROUND_RESERVE));
    if (decision.retryAt) {
      await tx.$executeRaw`UPDATE ${table} SET interactive_until = ${new Date(decision.interactiveUntil)}, updated_at = NOW() WHERE company_id = ${companyId}`;
      return { permit: null, retryAt: decision.retryAt };
    }
    const leaseId = randomUUID();
    await tx.$executeRaw`UPDATE ${table}
      SET lease_id = ${leaseId}, lease_until = ${new Date(now + PROCORE_REQUEST_LEASE_MS)},
          interactive_until = ${new Date(decision.interactiveUntil)}, windows = ${JSON.stringify(decision.windows)}::jsonb,
          updated_at = NOW() WHERE company_id = ${companyId}`;
    return { permit: { leaseId, companyId, lane, connection } satisfies ProcoreRequestPermit, retryAt: 0 };
  });
}

export async function waitForProcoreRequestPermit(companyId: string, lane: ProcoreRequestLane, maxWaitMs = 8_000) {
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    const admission = await acquireProcoreRequestPermit(companyId, lane);
    if (admission.permit || admission.retryAt > deadline || Date.now() >= deadline) return admission;
    await new Promise(resolve => setTimeout(resolve, Math.max(1, admission.retryAt - Date.now())));
  }
}

/** Capacity wrapper for legacy sync readers that need the raw Response headers. */
export async function coordinatedProcoreFetch(url: string, options: RequestInit, companyId: string) {
  const admission = await waitForProcoreRequestPermit(companyId, 'background');
  if (!admission.permit) {
    return Response.json({ message: `Procore rate limit cooldown is active until ${new Date(admission.retryAt).toISOString()}.`,
      rateLimited: true, rateLimitUntil: new Date(admission.retryAt).toISOString(),
    }, {
      status: 429,
      headers: {
        'Retry-After': String(Math.max(1, Math.ceil((admission.retryAt - Date.now()) / 1000))),
        'X-Rate-Limit-Reset': String(Math.ceil(admission.retryAt / 1000)),
      },
    });
  }
  let status = 0;
  let observation: ProcoreQuotaObservation | null = null;
  try {
    const deadline = AbortSignal.timeout(20_000);
    const response = await fetch(url, { ...options, signal: options.signal ? AbortSignal.any([options.signal, deadline]) : deadline });
    status = response.status;
    observation = procoreQuotaObservation(response.headers, status, {
      reserve: procoreBackgroundReserve(process.env.PROCORE_API_BACKGROUND_RESERVE), fallbackCooldownMs: 60_000,
    });
    if (status === 429) {
      await response.body?.cancel().catch(() => undefined);
      return Response.json({ message: `Procore rate limit cooldown is active until ${observation.cooldownUntil?.toISOString()}.`,
        rateLimited: true, rateLimitUntil: observation.cooldownUntil?.toISOString(),
      }, { status: 429, headers: response.headers });
    }
    return response;
  } finally {
    await completeProcoreRequestPermit({ permit: admission.permit, observation, method: options.method || 'GET',
      path: new URL(url).pathname, status,
    }).catch(() => console.warn('Procore sync request accounting could not be completed.'));
  }
}

export async function completeProcoreRequestPermit(params: {
  permit: ProcoreRequestPermit; observation: ProcoreQuotaObservation | null;
  method: string; path: string; status: number;
}) {
  const { permit, observation } = params;
  const tables = procoreCoordinationTables(permit.connection || 'shared');
  const table = Prisma.raw(tables.gates);
  const usageTable = Prisma.raw(tables.usage);
  await prisma.$transaction(async tx => {
    const [row] = await tx.$queryRaw<GateRow[]>`SELECT *, clock_timestamp() AS now FROM ${table} WHERE company_id = ${permit.companyId} FOR UPDATE`;
    // A late response from an expired owner cannot overwrite another request's
    // newer quota observation or release its lease.
    if (!row || row.lease_id !== permit.leaseId) return;
    const windows = observeProcoreBudget(row.windows, observation, row.now.getTime());
    const blockedUntil = observation?.rateLimited || observation?.remaining === 0 ? observation.cooldownUntil : row.blocked_until;
    await tx.$executeRaw`UPDATE ${table} SET lease_id = NULL, lease_until = NULL,
      windows = ${JSON.stringify(windows)}::jsonb, blocked_until = ${blockedUntil}, updated_at = NOW()
      WHERE company_id = ${permit.companyId} AND lease_id = ${permit.leaseId}`;
    await tx.$executeRaw`INSERT INTO ${usageTable} (company_id, hour, lane, endpoint, status, requests)
      VALUES (${permit.companyId}, date_trunc('hour', NOW()), ${permit.lane},
              ${procoreUsageEndpoint(params.method, params.path)}, ${params.status}, 1)
      ON CONFLICT (company_id, hour, lane, endpoint, status) DO UPDATE
      SET requests = ${usageTable}.requests + 1`;
  });
}

export async function procoreApiUsageSummary(companyId: string) {
  const table = Prisma.raw(procoreCoordinationTables().usage);
  return prisma.$queryRaw<Array<{ lane: string; endpoint: string; requests: number; rejected: number; errors: number }>>`
    SELECT lane, endpoint, SUM(requests)::int AS requests,
      SUM(CASE WHEN status = 429 THEN requests ELSE 0 END)::int AS rejected,
      SUM(CASE WHEN status = 0 OR status >= 400 THEN requests ELSE 0 END)::int AS errors
    FROM ${table} WHERE company_id = ${companyId} AND hour >= NOW() - INTERVAL '24 hours'
    GROUP BY lane, endpoint ORDER BY requests DESC LIMIT 30`;
}
