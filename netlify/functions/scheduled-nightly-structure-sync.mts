import type { Config } from "@netlify/functions";

function easternHour() {
  return Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    hour12: false,
  }).format(new Date()));
}

const handler = async () => {
  const hour = easternHour();
  if (hour < 2 || hour >= 6) {
    return Response.json({ success: true, skipped: true, reason: "outside_nightly_window" });
  }
  const secret = (process.env.PROCORE_SYNC_SECRET || "").trim();
  const baseUrl = (process.env.APP_BASE_URL || process.env.URL || "").replace(/\/$/, "");
  if (!secret || !baseUrl) {
    return Response.json({ success: false, error: "Missing sync configuration." }, { status: 500 });
  }
  const response = await fetch(`${baseUrl}/.netlify/functions/nightly-structure-sync-background`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sync-secret": secret },
    body: "{}",
  });
  return Response.json({ success: response.ok, dispatchStatus: response.status }, { status: response.ok ? 200 : 500 });
};

export default handler;

export const config: Config = {
  // The handler enforces 2:00–6:00 AM America/New_York, including DST.
  schedule: "*/2 6-11 * * *",
};
