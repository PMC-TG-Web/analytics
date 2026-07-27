const handler = async (request: Request) => {
  const expected = (process.env.PROCORE_SYNC_SECRET || "").trim();
  const provided = request.headers.get("x-sync-secret")?.trim() || "";
  if (!expected || provided !== expected) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = (process.env.APP_BASE_URL || process.env.URL || "").replace(/\/$/, "");
  const body = await request.json().catch(() => ({}));
  const response = await fetch(`${baseUrl}/api/cron/actuals`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sync-secret": expected },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  console.log(JSON.stringify({
    event: "actuals-sync-background",
    status: response.status,
    success: result?.success,
    skipped: result?.skipped,
    reason: result?.reason,
    projectId: result?.projectId,
    totalMs: result?.totalMs,
  }));
  return Response.json({ status: response.status, result }, { status: response.ok ? 200 : 207 });
};

export default handler;
