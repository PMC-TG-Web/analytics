import type { Config } from "@netlify/functions";

function easternParts() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  return {
    weekday: parts.find((part) => part.type === "weekday")?.value,
    hour: Number(parts.find((part) => part.type === "hour")?.value || 0),
  };
}

const handler = async () => {
  const { weekday, hour } = easternParts();
  if (weekday !== "Sun" || hour >= 12) {
    return Response.json({ success: true, skipped: true, reason: "outside_weekly_window" });
  }
  const secret = (process.env.PROCORE_SYNC_SECRET || "").trim();
  const baseUrl = (process.env.APP_BASE_URL || process.env.URL || "").replace(/\/$/, "");
  if (!secret || !baseUrl) {
    return Response.json({ success: false, error: "Missing sync configuration." }, { status: 500 });
  }
  const response = await fetch(`${baseUrl}/.netlify/functions/actuals-sync-background`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sync-secret": secret },
    body: JSON.stringify({ mode: "reconcile" }),
  });
  return Response.json({ success: response.ok, dispatchStatus: response.status }, { status: response.ok ? 200 : 500 });
};

export default handler;

export const config: Config = {
  // The handler restricts execution to Sunday midnight–noon Eastern.
  schedule: "*/5 * * * 0",
};
