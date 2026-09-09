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
  request: () => Promise<Response>;
  signal: AbortSignal;
  onResponse: () => void;
  now?: () => number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}) {
  const now = options.now ?? Date.now;
  const wait = options.wait ?? waitForNextAttempt;
  const deadline = now() + 65 * 60_000;
  for (let attempt = 0; ; attempt += 1) {
    options.signal.throwIfAborted();
    const response = await options.request();
    const responseText = await response.text();
    options.onResponse();
    let payload: MakerPayload = {};
    try {
      const parsed: unknown = responseText ? JSON.parse(responseText) : {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as MakerPayload;
    } catch { /* The caller handles incomplete responses without replaying writes. */ }

    if (response.status === 429 && payload.rateLimited === true && payload.outcomeUnknown !== true) {
      const until = typeof payload.rateLimitUntil === "string" ? Date.parse(payload.rateLimitUntil) : NaN;
      const delay = Math.max(1_000, until - now());
      if (payload.retryable === true && Number.isFinite(until) && attempt < 10 && now() + delay <= deadline) {
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
