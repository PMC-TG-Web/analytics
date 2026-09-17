import { AsyncLocalStorage } from "node:async_hooks";

import { procoreQuotaObservation, procoreRateLimitDelayMs, type ProcoreQuotaObservation } from "@/lib/procoreRateLimit";
import type { ProcoreRequestPermit } from "@/lib/procoreRequestGate";

export type CommitmentMakerProcoreResponse = { ok: boolean; status: number; payload: unknown; path: string };
type RequestParams = {
  path: string;
  accessToken: string;
  companyId: string;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
};

const PROCORE_READ_TIMEOUT_MS = 8_000;
const PROCORE_MUTATION_TIMEOUT_MS = 12_000;
const RETRY_WAIT_BUDGET_MS = 8_000;

export class CommitmentMakerRateLimitError extends Error {
  readonly status = 429;
  readonly rateLimitUntil: string;

  constructor(untilMs: number) {
    super("Procore has temporarily paused requests because its rate limit was reached. Confirmed PO lines are saved.");
    this.name = "CommitmentMakerRateLimitError";
    this.rateLimitUntil = new Date(untilMs).toISOString();
  }
}

/** One client per incoming request: every line shares the same bounded wait budget. */
export function createCommitmentMakerProcoreClient(options: {
  apiUrl: string;
  reserve: number;
  observeQuota: (companyId: string, observation: ProcoreQuotaObservation) => Promise<unknown>;
  acquirePermit?: (companyId: string) => Promise<{ permit: ProcoreRequestPermit | null; retryAt: number }>;
  completePermit?: (params: { permit: ProcoreRequestPermit; observation: ProcoreQuotaObservation | null; method: string; path: string; status: number }) => Promise<unknown>;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}) {
  const send = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const blockedUntil = new Map<string, number>();
  let remainingWaitMs = RETRY_WAIT_BUDGET_MS;

  return async (params: RequestParams): Promise<CommitmentMakerProcoreResponse> => {
    const path = params.path.startsWith("/") ? params.path : `/${params.path}`;
    const method = params.method || "GET";
    // Serialize exactly once, so retries submit the same rejected operation.
    const body = params.body === undefined ? undefined : JSON.stringify(params.body);
    for (let attempt = 0; ; attempt += 1) {
      const until = blockedUntil.get(params.companyId) ?? 0;
      const delayMs = Math.max(0, until - now());
      if (delayMs > remainingWaitMs) throw new CommitmentMakerRateLimitError(until);
      if (delayMs > 0) {
        remainingWaitMs -= delayMs;
        await sleep(delayMs);
      }

      const admission = await options.acquirePermit?.(params.companyId);
      if (admission?.retryAt) {
        const waitMs = Math.max(1, admission.retryAt - now());
        if (waitMs > remainingWaitMs) throw new CommitmentMakerRateLimitError(admission.retryAt);
        remainingWaitMs -= waitMs;
        await sleep(waitMs);
        attempt -= 1; // Local queue contention does not consume a provider retry.
        continue;
      }

      let response: Response;
      let payload: unknown;
      let observed: ProcoreQuotaObservation | null = null;
      let status = 0;
      try {
        response = await send(`${options.apiUrl}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${params.accessToken}`,
            Accept: "application/json",
            "Content-Type": "application/json",
            "Procore-Company-Id": params.companyId,
          },
          body,
          cache: "no-store",
          signal: AbortSignal.timeout(method === "GET" ? PROCORE_READ_TIMEOUT_MS : PROCORE_MUTATION_TIMEOUT_MS),
        });
        status = response.status;
        observed = procoreQuotaObservation(response.headers, response.status, {
          reserve: options.reserve, fallbackCooldownMs: 60_000, nowMs: now(),
        });
        // An explicit 429 is a rejection, even if its response body cannot be read.
        if (response.status === 429) {
          await response.body?.cancel().catch(() => undefined);
        } else {
          const raw = await response.text();
          try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = raw || {}; }
        }
      } catch (error) {
        const timedOut = error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name);
        // Never replay a mutation after a timeout, disconnect, or unreadable body.
        return {
          ok: false,
          status: method === "GET" ? (timedOut ? 504 : 502) : 504,
          payload: { error: method === "GET"
            ? "The Procore read failed before a complete response was received."
            : "Procore did not confirm the mutation before the connection ended; its outcome is unknown." },
          path,
        };
      } finally {
        if (admission?.permit && options.completePermit) {
          try { await options.completePermit({ permit: admission.permit, observation: observed, method, path, status }); }
          catch { console.warn("Commitment Maker could not complete shared request accounting."); }
        }
      }

      const observation = procoreQuotaObservation(response.headers, response.status, {
        reserve: options.reserve, fallbackCooldownMs: 60_000, nowMs: now(),
      });
      if (observation.cooldownUntil || observation.rateLimited) {
        // A telemetry failure must never turn an accepted write into a retry.
        try { await options.observeQuota(params.companyId, observation); }
        catch { console.warn("Commitment Maker could not persist Procore quota state."); }
      }
      if (response.status === 429 || observation.remaining === 0) {
        // Do not cap the provider's delay: defer instead of retrying before reset.
        const retryAt = now() + procoreRateLimitDelayMs(response.headers, {
          nowMs: now(), fallbackMs: response.status === 429 ? 1_000 * 2 ** attempt : 1_000,
          maxDelayMs: Number.MAX_SAFE_INTEGER, resetPaddingMs: 1_500,
        });
        blockedUntil.set(params.companyId, retryAt);
        if (response.status === 429) {
          if (attempt >= 2) throw new CommitmentMakerRateLimitError(retryAt);
          continue;
        }
      }
      return { ok: response.ok, status: response.status, payload, path };
    }
  };
}

const clients = new AsyncLocalStorage<ReturnType<typeof createCommitmentMakerProcoreClient>>();

export function withCommitmentMakerProcoreClient<T>(
  options: Parameters<typeof createCommitmentMakerProcoreClient>[0],
  operation: () => Promise<T>,
) {
  return clients.run(createCommitmentMakerProcoreClient(options), operation);
}

export function commitmentMakerProcoreJson(params: RequestParams) {
  const client = clients.getStore();
  if (!client) throw new Error("Commitment Maker Procore request context is missing.");
  return client(params);
}
