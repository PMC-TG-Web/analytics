import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { Resend } from "resend";
import { getRequiredSyncSecret } from "@/lib/cronSync";
import { prisma } from "@/lib/prisma";
import {
  getClientCredentialsToken,
  makeRequest,
  procoreConfig,
  withProcoreLiveApiBypassForSyncSecret,
} from "@/lib/procore";
import {
  buildTimecardNotificationEmail,
  isPmcdecorEmail,
  selectProjectManagerRecipients,
  type ProjectRoleLike,
  type ProjectUserLike,
} from "@/lib/timecardNotification";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type UnknownRecord = Record<string, unknown>;

function authorized(request: NextRequest) {
  const provided = request.headers.get("x-sync-secret")?.trim()
    || request.headers.get("x-cron-secret")?.trim()
    || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const syncSecret = getRequiredSyncSecret();
  const cronSecret = String(process.env.CRON_SECRET || "").trim();
  return Boolean(provided) && (provided === syncSecret || (!!cronSecret && provided === cronSecret));
}

function records(value: unknown): UnknownRecord[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is UnknownRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  }
  if (value && typeof value === "object" && Array.isArray((value as UnknownRecord).data)) {
    return ((value as UnknownRecord).data as unknown[])
      .filter((item): item is UnknownRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  }
  return [];
}

async function fetchAll(params: {
  token: string;
  companyId: string;
  basePath: string;
}) {
  const result: UnknownRecord[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const separator = params.basePath.includes("?") ? "&" : "?";
    const payload = await makeRequest(
      `${params.basePath}${separator}page=${page}&per_page=100`,
      params.token,
      undefined,
      params.companyId,
    );
    const rows = records(payload);
    result.push(...rows);
    if (rows.length < 100) break;
  }
  return result;
}

async function resolveProjectManagerRecipients(params: {
  token: string;
  companyId: string;
  projectId: string;
}) {
  const [roles, users] = await Promise.all([
    fetchAll({
      ...params,
      basePath: `/rest/v1.0/project_roles?project_id=${encodeURIComponent(params.projectId)}`,
    }),
    fetchAll({
      ...params,
      basePath: `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/users?company_id=${encodeURIComponent(params.companyId)}`,
    }),
  ]);
  return selectProjectManagerRecipients(
    roles as ProjectRoleLike[],
    users as ProjectUserLike[],
  );
}

function retryDelay(attempts: number) {
  const minutes = [5, 15, 30, 60, 120, 240, 480, 720, 1_440, 1_440, 1_440, 1_440];
  return minutes[Math.min(Math.max(0, attempts - 1), minutes.length - 1)] * 60_000;
}

async function processNotifications() {
  const now = new Date();
  const workerId = `timecard-email:${Date.now()}`;
  await prisma.timecardNotification.updateMany({
    where: {
      status: "processing",
      lockedAt: { lt: new Date(now.getTime() - 15 * 60_000) },
    },
    data: { status: "pending", lockedAt: null, lockedBy: null },
  });

  const candidates = await prisma.timecardNotification.findMany({
    where: {
      status: "pending",
      availableAt: { lte: now },
    },
    orderBy: { createdAt: "asc" },
    take: 10,
  });

  if (!candidates.length) {
    return { scanned: 0, claimed: 0, sent: 0, retried: 0, failed: 0 };
  }

  const token = await getClientCredentialsToken();
  const resendApiKey = String(process.env.RESEND_API_KEY || "").trim();
  if (!resendApiKey) throw new Error("RESEND_API_KEY is not configured.");
  const resend = new Resend(resendApiKey);
  const from = String(
    process.env.TIMECARD_NOTIFICATION_FROM_EMAIL
    || process.env.RESEND_FROM_EMAIL
    || "Procore Timecards <notifications@pmcdecor.com>",
  ).trim();
  const recipientCache = new Map<string, Awaited<ReturnType<typeof resolveProjectManagerRecipients>>>();

  let claimed = 0;
  let sent = 0;
  let retried = 0;
  let failed = 0;

  for (const candidate of candidates) {
    const claim = await prisma.timecardNotification.updateMany({
      where: { id: candidate.id, status: "pending" },
      data: {
        status: "processing",
        attempts: { increment: 1 },
        lockedAt: new Date(),
        lockedBy: workerId,
      },
    });
    if (!claim.count) continue;
    claimed += 1;
    const attemptNumber = candidate.attempts + 1;

    try {
      const project = await prisma.pmcProject.findUnique({
        where: {
          companyId_procoreProjectId: {
            companyId: candidate.companyId,
            procoreProjectId: candidate.projectId,
          },
        },
        select: { projectNumber: true, projectName: true },
      });
      const fallbackProject = project ? null : await prisma.project.findFirst({
        where: { procoreId: candidate.projectId },
        select: { projectNumber: true, projectName: true },
      });
      const projectName = project?.projectName || fallbackProject?.projectName || `Procore Project ${candidate.projectId}`;
      const projectNumber = project?.projectNumber || fallbackProject?.projectNumber || null;

      const cacheKey = `${candidate.companyId}:${candidate.projectId}`;
      let recipients = recipientCache.get(cacheKey);
      if (!recipients) {
        recipients = await resolveProjectManagerRecipients({
          token,
          companyId: candidate.companyId,
          projectId: candidate.projectId,
        });
        recipientCache.set(cacheKey, recipients);
      }
      if (!recipients.length) {
        throw new Error("No active Project Manager with a @pmcdecor.com email was found in the Procore project directory.");
      }

      const lines = await prisma.$queryRaw<Array<{
        party_name: string | null;
        hours: number | null;
        created_by_name: string | null;
      }>>`
        SELECT
          "partyName" AS party_name,
          "hours" AS hours,
          "createdByName" AS created_by_name
        FROM "TimecardEntry"
        WHERE "procoreProjectId" = ${candidate.projectId}
          AND "procoreCompanyId" = ${candidate.companyId}
          AND "procoreDeletedAt" IS NULL
          AND COALESCE(
            "customFields" #>> '{originalData,timesheet_id}',
            "customFields" #>> '{originalData,_timesheet_id}'
          ) = ${candidate.timesheetId}
        ORDER BY "procoreId"
      `;
      if (!lines.length) throw new Error("The timecard has no synchronized entry lines yet.");

      const createdByName = candidate.createdByName
        || lines.find((line) => line.created_by_name)?.created_by_name
        || null;
      const projectUrl = `https://us02.procore.com/${encodeURIComponent(candidate.projectId)}/project/home`;
      const email = buildTimecardNotificationEmail({
        projectNumber,
        projectName,
        timecardDate: candidate.timecardDate,
        createdByName,
        entries: lines.map((line) => ({ partyName: line.party_name, hours: line.hours })),
        projectUrl,
      });
      // Defense in depth: never pass a non-PMC address to the email provider,
      // even if recipient-resolution logic changes later.
      const recipientEmails = recipients
        .map((recipient) => recipient.email)
        .filter(isPmcdecorEmail);
      if (!recipientEmails.length) {
        throw new Error("No active Project Manager with a @pmcdecor.com email was found in the Procore project directory.");
      }
      const result = await resend.emails.send({
        from,
        to: recipientEmails,
        subject: email.subject,
        text: email.text,
        html: email.html,
      }, {
        idempotencyKey: `timecard-${candidate.companyId}-${candidate.projectId}-${candidate.timesheetId}`,
      });
      if (result.error) throw new Error(result.error.message);

      await prisma.timecardNotification.update({
        where: { id: candidate.id },
        data: {
          status: "sent",
          recipientEmails: recipientEmails as Prisma.InputJsonValue,
          providerMessageId: result.data?.id || null,
          sentAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lastError: null,
        },
      });
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const terminal = attemptNumber >= candidate.maxAttempts;
      await prisma.timecardNotification.update({
        where: { id: candidate.id },
        data: {
          status: terminal ? "failed" : "pending",
          availableAt: terminal
            ? candidate.availableAt
            : new Date(Date.now() + retryDelay(attemptNumber)),
          lockedAt: null,
          lockedBy: null,
          lastError: message.slice(0, 1_000),
        },
      });
      if (terminal) failed += 1;
      else retried += 1;
    }
  }

  return { scanned: candidates.length, claimed, sent, retried, failed };
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  return withProcoreLiveApiBypassForSyncSecret(request, async () => {
    try {
      const result = await processNotifications();
      return NextResponse.json({ success: true, ...result });
    } catch (error) {
      return NextResponse.json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        companyId: procoreConfig.companyId || null,
      }, { status: 500 });
    }
  });
}
