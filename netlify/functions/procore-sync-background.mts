import { getRequiredSyncSecret, parsePositiveInt, runProcoreCronSync } from "../../src/lib/cronSync";

function getBaseUrl(): string {
  return (
    process.env.URL ||
    process.env.APP_BASE_URL ||
    process.env.AUTH0_BASE_URL ||
    ""
  ).replace(/\/$/, "");
}

const handler = async (request: Request) => {
  const url = new URL(request.url);
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  if (!cronSecret) {
    return Response.json(
      { error: "CRON_SECRET is not configured" },
      { status: 503 }
    );
  }

  const provided = request.headers.get("x-cron-secret")?.trim();
  if (provided !== cronSecret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const syncSecret = getRequiredSyncSecret();
  if (!syncSecret) {
    return Response.json(
      { error: "PROCORE_SYNC_SECRET is not configured" },
      { status: 503 }
    );
  }

  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    return Response.json(
      { error: "No base URL configured. Set URL or APP_BASE_URL." },
      { status: 500 }
    );
  }

  const body = await request.json().catch(() => ({})) as {
    companyId?: unknown;
    maxProjects?: unknown;
    lookbackDays?: unknown;
  };
  const maxProjectsInput = body.maxProjects ?? url.searchParams.get("maxProjects");
  const lookbackDaysInput = body.lookbackDays ?? url.searchParams.get("lookbackDays");
  const companyId = String(
    body.companyId || url.searchParams.get("companyId") || process.env.PROCORE_COMPANY_ID || ""
  ).trim();
  const maxProjects = maxProjectsInput === undefined || maxProjectsInput === null
    ? undefined
    : Math.max(1, parsePositiveInt(String(maxProjectsInput), 25));
  const lookbackDays = lookbackDaysInput === undefined || lookbackDaysInput === null
    ? undefined
    : Math.max(7, parsePositiveInt(String(lookbackDaysInput), 30));
  if (!companyId) {
    return Response.json(
      { error: "MISSING_COMPANY_ID: Set PROCORE_COMPANY_ID in environment." },
      { status: 400 }
    );
  }

  const result = await runProcoreCronSync({
    origin: baseUrl,
    companyId,
    syncSecret,
    triggeredBy: "cron-background",
    maxProjects,
    lookbackDays,
  });

  return Response.json(result, { status: result.success ? 200 : 207 });
};

export default handler;
