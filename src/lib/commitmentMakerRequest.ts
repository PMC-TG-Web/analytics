type MakerPayload = Record<string, unknown>;

const INCOMPLETE_MESSAGE = "We couldn’t finish this request. Your saved progress is safe. Please try again later.";

function waitForNextAttempt(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Keep recoverable pauses inside one user operation; publish only its final result. */
export async function runCommitmentMakerRequest(options: {
  request: (preparationId?: string) => Promise<Response>;
  signal: AbortSignal;
  onResponse: () => void;
  now?: () => number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}) {
  const now = options.now ?? Date.now;
  const wait = options.wait ?? waitForNextAttempt;
  const deadline = now() + 65 * 60_000;
  let preparationId: string | undefined;
  let preparationSteps = 0;
  let attempt = 0;
  for (;;) {
    options.signal.throwIfAborted();
    const response = await options.request(preparationId);
    const responseText = await response.text();
    options.onResponse();
    let payload: MakerPayload = {};
    try {
      const parsed: unknown = responseText ? JSON.parse(responseText) : {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as MakerPayload;
    } catch { /* The caller handles incomplete responses without replaying writes. */ }

    if (response.status === 202 && payload.preparing === true && payload.retryable === true && payload.outcomeUnknown !== true) {
      const until = typeof payload.resumeAt === 'string' ? Date.parse(payload.resumeAt) : NaN;
      const delay = Math.max(250, until - now());
      if (typeof payload.preparationId === 'string' && /^[a-f0-9-]{36}$/i.test(payload.preparationId)
        && Number.isFinite(until) && preparationSteps < 200 && now() + delay <= deadline) {
        preparationId = payload.preparationId;
        preparationSteps += 1;
        await wait(delay, options.signal);
        continue;
      }
      throw new Error(INCOMPLETE_MESSAGE);
    }
    if (response.status === 429 && payload.rateLimited === true && payload.outcomeUnknown !== true) {
      const until = typeof payload.rateLimitUntil === "string" ? Date.parse(payload.rateLimitUntil) : NaN;
      const delay = Math.max(1_000, until - now());
      if (payload.retryable === true && Number.isFinite(until) && attempt < 10 && now() + delay <= deadline) {
        attempt += 1;
        await wait(delay, options.signal);
        continue;
      }
      // Exhausted or unsafe recovery is a real terminal result, not an endless spinner.
      payload = { ...payload, error: INCOMPLETE_MESSAGE };
      if (Array.isArray(payload.results)) {
        payload.results = payload.results.map((item: MakerPayload) => item.success === true ? item : {
          ...item, status: "Incomplete", error: INCOMPLETE_MESSAGE,
        });
      }
    }
    return { response, payload };
  }
}
