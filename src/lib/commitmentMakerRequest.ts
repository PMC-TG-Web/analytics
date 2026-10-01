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
  readCreationStatus?: () => Promise<Response>;
  now?: () => number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}) {
  const now = options.now ?? Date.now;
  const wait = options.wait ?? waitForNextAttempt;
  const deadline = now() + 65 * 60_000;
  let preparationId: string | undefined;
  let preparationSteps = 0;
  let creationSteps = 0;
  let attempt = 0;
  const recoverCreation = async () => {
    if (!options.readCreationStatus) return null;
    const recoveryDeadline = now() + 5 * 60_000;
    for (let poll = 0; poll < 60 && now() < recoveryDeadline; poll += 1) {
      options.signal.throwIfAborted();
      try {
        const response = await options.readCreationStatus();
        const payload = await response.json() as MakerPayload;
        if (response.ok && payload.creationStatus === 'completed' && payload.success === true && Array.isArray(payload.results)) {
          options.onResponse();
          return { response, payload };
        }
        if ([401, 403, 404].includes(response.status)) return null;
      } catch { options.signal.throwIfAborted(); }
      await wait(5_000, options.signal);
    }
    return null;
  };
  for (;;) {
    options.signal.throwIfAborted();
    let response: Response;
    let responseText: string;
    try {
      response = await options.request(preparationId);
      responseText = await response.text();
    } catch (error) {
      options.signal.throwIfAborted();
      const recovered = await recoverCreation();
      if (recovered) return recovered;
      throw error;
    }
    options.onResponse();
    let payload: MakerPayload = {};
    try {
      const parsed: unknown = responseText ? JSON.parse(responseText) : {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as MakerPayload;
    } catch { /* The caller handles incomplete responses without replaying writes. */ }

    if ([502, 504].includes(response.status) && !Array.isArray(payload.results)) {
      const recovered = await recoverCreation();
      if (recovered) return recovered;
    }

    if (response.status === 202 && payload.continuing === true && payload.retryable === true && payload.outcomeUnknown !== true) {
      const until = typeof payload.resumeAt === 'string' ? Date.parse(payload.resumeAt) : NaN;
      const delay = Math.max(250, until - now());
      if (!Number.isFinite(until) || creationSteps >= 200 || now() + delay > deadline) throw new Error(INCOMPLETE_MESSAGE);
      creationSteps += 1;
      await wait(delay, options.signal);
      continue;
    }

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
