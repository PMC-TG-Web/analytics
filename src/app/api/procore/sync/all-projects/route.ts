import { cookies } from "next/headers";
import { hasValidProcoreSyncSecret } from "@/lib/procore";
import { runAllProjectsSync } from "@/lib/procoreAllProjectsSync";
import { readProcoreSyncCookieValues } from "@/lib/procoreSyncRequestCookies";
import { streamSyncResponse } from "@/lib/procoreSyncStream";

export const maxDuration = 800;

export async function POST(request: Request) {
  const hasSyncSecret = hasValidProcoreSyncSecret(request);
  const cookieValues = await readProcoreSyncCookieValues(hasSyncSecret, cookies);
  const run = () => runAllProjectsSync(request, cookieValues);
  return hasSyncSecret ? streamSyncResponse(run) : run();
}
