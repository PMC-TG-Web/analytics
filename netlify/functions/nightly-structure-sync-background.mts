const handler = async (request: Request) => {
  const secret = (process.env.PROCORE_SYNC_SECRET || "").trim();
  if (!secret || request.headers.get("x-sync-secret")?.trim() !== secret) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const baseUrl = (process.env.APP_BASE_URL || process.env.URL || "").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/api/cron/nightly-structure`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sync-secret": secret },
    body: "{}",
  });
  const result = await response.json().catch(() => null);
  console.log(JSON.stringify({
    event: "nightly-structure-sync-background",
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
