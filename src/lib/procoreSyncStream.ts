// JSON whitespace heartbeats keep long authenticated syncs alive through the proxy.
// HTTP status cannot change after streaming starts; failures remain explicit in JSON.
export function streamSyncResponse(operation: () => Promise<Response>, intervalMs = 8000): Response {
  const encoder = new TextEncoder();
  let closed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => { if (!closed) controller.enqueue(encoder.encode(text)); };
      const heartbeat = () => send(' '.repeat(2048) + '\n');
      heartbeat();
      timer = setInterval(heartbeat, intervalMs);
      void Promise.resolve().then(operation).then(async response => {
        const body = await response.json();
        const result = { ...body, httpStatus: response.status };
        if (!response.ok) result.success = false;
        if (response.status === 429) result.rateLimited = true;
        const until = response.headers.get('x-procore-rate-limit-until');
        if (until) result.rateLimitUntil = until;
        const count = response.headers.get('x-procore-api-request-count');
        if (count) result.apiRequests = Number(count) || 0;
        send(JSON.stringify(result));
      }).catch(error => send(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) })))
        .finally(() => { clearInterval(timer); if (!closed) { closed = true; controller.close(); } });
    },
    cancel() { closed = true; clearInterval(timer); },
  });
  return new Response(stream, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' } });
}
