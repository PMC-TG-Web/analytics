import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { prisma } from "@/lib/prisma";
import { getRequiredSyncSecret } from "@/lib/cronSync";
import {
  calculateReviewEligibleAt,
  isCompleteBidBoardStatus,
  parseBidBoardStatusChangedAt,
} from "@/lib/productivityReviewCooldown";
import {
  buildProductivityCompleteEmail,
  buildProductivityReadyEmail,
} from "@/lib/productivityReviewEmail";
import {
  getProductivityCompleteNotificationConfig,
  getProductivityReviewNotificationConfig,
} from "@/lib/productivityReviewNotifications";
import {
  getClientCredentialsToken,
  withProcoreLiveApiBypassForSyncSecret,
} from "@/lib/procore";
import { ensureProductivityReviewTaskOnComplete } from "@/lib/procoreProductivityReviewTask";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: NextRequest) {
  const provided = request.headers.get("x-sync-secret")?.trim()
    || request.headers.get("x-cron-secret")?.trim()
    || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const syncSecret = getRequiredSyncSecret();
  const cronSecret = String(process.env.CRON_SECRET || "").trim();
  return Boolean(provided) && (provided === syncSecret || (!!cronSecret && provided === cronSecret));
}

function sameInstant(left: Date | null, right: Date): boolean {
  return Boolean(left) && left!.getTime() === right.getTime();
}

function projectMetadataChanged(
  existing: {
    bidBoardId: string | null;
    bidBoardStatus: string | null;
    projectNumber: string | null;
    projectName: string;
  },
  next: {
    bidBoardId: string;
    bidBoardStatus: string;
    projectNumber: string | null;
    projectName: string;
  },
) {
  return (
    existing.bidBoardId !== next.bidBoardId
    || existing.bidBoardStatus !== next.bidBoardStatus
    || existing.projectNumber !== next.projectNumber
    || existing.projectName !== next.projectName
  );
}

function resolveReviewAnchorDate(params: {
  projectCreatedAt: Date | null | undefined;
  completedAt: Date;
}): Date {
  const createdAt = params.projectCreatedAt;
  if (createdAt && Number.isFinite(createdAt.getTime())) {
    return createdAt;
  }
  return params.completedAt;
}

async function processReminders(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const companyId = String(
    request.nextUrl.searchParams.get("companyId")
    || process.env.PROCORE_COMPANY_ID
    || "",
  ).trim();
  if (!companyId) {
    return NextResponse.json({ success: false, error: "Missing companyId." }, { status: 400 });
  }

  const bidBoardRows = await prisma.pmcBidBoardProject.findMany({
    where: {
      companyId,
      procoreProjectId: { not: null },
    },
    orderBy: { syncedAt: "desc" },
  });
  const canonicalByProject = new Map<string, (typeof bidBoardRows)[number]>();
  for (const row of bidBoardRows) {
    if (!row.procoreProjectId) continue;
    const current = canonicalByProject.get(row.procoreProjectId);
    if (!current || (current.bidBoardId.includes(":") && !row.bidBoardId.includes(":"))) {
      canonicalByProject.set(row.procoreProjectId, row);
    }
  }

  const projectIds = [...canonicalByProject.keys()];
  const pmcProjects = projectIds.length
    ? await prisma.pmcProject.findMany({
        where: { companyId, procoreProjectId: { in: projectIds } },
        select: {
          procoreProjectId: true,
          procoreCreatedAt: true,
          createdAt: true,
        },
      })
    : [];
  const projectCreatedAtById = new Map(
    pmcProjects.map((project) => [
      project.procoreProjectId,
      project.procoreCreatedAt || project.createdAt,
    ]),
  );
  const existingRows = projectIds.length
    ? await prisma.productivityProjectReview.findMany({
        where: { companyId, projectId: { in: projectIds } },
      })
    : [];
  const existingByProject = new Map(existingRows.map((row) => [row.projectId, row]));
  let scheduled = 0;
  let canceled = 0;
  let grandfathered = 0;
  let completionNoticesScheduled = 0;

  for (const [projectId, bidBoard] of canonicalByProject) {
    const existing = existingByProject.get(projectId);
    const complete = isCompleteBidBoardStatus(bidBoard.status);
    const baseData = {
      bidBoardId: bidBoard.bidBoardId,
      bidBoardStatus: bidBoard.status,
      projectNumber: bidBoard.projectNumber,
      projectName: bidBoard.projectName,
    };

    if (complete) {
      const completedAt = parseBidBoardStatusChangedAt(bidBoard.payload, bidBoard.syncedAt);
      const reviewAnchorAt = resolveReviewAnchorDate({
        projectCreatedAt: projectCreatedAtById.get(projectId),
        completedAt,
      });
      const reviewEligibleAt = calculateReviewEligibleAt(reviewAnchorAt);
      const sameCycle =
        existing
        && isCompleteBidBoardStatus(existing.bidBoardStatus)
        && sameInstant(existing.cooldownStartedAt, completedAt);
      const reviewedThisCycle =
        existing?.status === "completed"
        && Boolean(existing.reviewedAt)
        && existing.reviewedAt! >= completedAt;

      if (!existing) {
        const created = await prisma.productivityProjectReview.create({
          data: {
            companyId,
            projectId,
            ...baseData,
            cooldownStartedAt: completedAt,
            reviewEligibleAt,
            reminderStatus: "scheduled",
            completionNoticeStatus: "scheduled",
            status: "open",
          },
        });
        existingByProject.set(projectId, created);
        scheduled += 1;
        completionNoticesScheduled += 1;
      } else if (!sameCycle) {
        const updated = await prisma.productivityProjectReview.update({
          where: { id: existing.id },
          data: {
            ...baseData,
            cooldownStartedAt: completedAt,
            reviewEligibleAt,
            reminderStatus: reviewedThisCycle ? "not_needed" : "scheduled",
            reminderSentAt: null,
            reminderId: null,
            reminderError: null,
            completionNoticeStatus: "scheduled",
            completionNoticeSentAt: null,
            completionNoticeId: null,
            completionNoticeError: null,
            ...(!reviewedThisCycle
              ? {
                  status: "open",
                  notificationStatus: "not_sent",
                  notificationError: null,
                }
              : {}),
          },
        });
        existingByProject.set(projectId, updated);
        if (reviewedThisCycle) grandfathered += 1;
        else scheduled += 1;
        completionNoticesScheduled += 1;
      } else {
        if (projectMetadataChanged(existing, baseData)) {
          await prisma.productivityProjectReview.update({
            where: { id: existing.id },
            data: baseData,
          });
        }
      }
      continue;
    }

    if (!existing) {
      const created = await prisma.productivityProjectReview.create({
        data: {
          companyId,
          projectId,
          ...baseData,
          reminderStatus: "not_scheduled",
          completionNoticeStatus: "not_scheduled",
          status: "open",
        },
      });
      existingByProject.set(projectId, created);
    } else {
      const wasComplete = isCompleteBidBoardStatus(existing.bidBoardStatus);
      const resetReview = wasComplete || existing.status === "completed";
      if (resetReview || projectMetadataChanged(existing, baseData)) {
        const updated = await prisma.productivityProjectReview.update({
          where: { id: existing.id },
          data: {
            ...baseData,
            ...(resetReview
              ? {
                  status: "open",
                  cooldownStartedAt: null,
                  reviewEligibleAt: null,
                  reminderStatus: wasComplete ? "canceled" : "not_scheduled",
                  reminderSentAt: null,
                  reminderId: null,
                  reminderError: null,
                  completionNoticeStatus: "not_scheduled",
                  completionNoticeSentAt: null,
                  completionNoticeId: null,
                  completionNoticeError: null,
                  notificationStatus: "not_sent",
                  notificationError: null,
                }
              : {}),
          },
        });
        existingByProject.set(projectId, updated);
        if (wasComplete) canceled += 1;
      }
    }
  }

  const now = new Date();
  const stalePendingBefore = new Date(now.getTime() - 10 * 60 * 1000);
  const completionNoticesDue = await prisma.productivityProjectReview.findMany({
    where: {
      companyId,
      bidBoardStatus: "Complete",
      OR: [
        { completionNoticeStatus: { in: ["scheduled", "failed"] } },
        { completionNoticeStatus: "pending", updatedAt: { lte: stalePendingBefore } },
      ],
    },
    orderBy: { cooldownStartedAt: "asc" },
    take: 20,
  });
  const due = await prisma.productivityProjectReview.findMany({
    where: {
      companyId,
      bidBoardStatus: "Complete",
      status: { not: "completed" },
      reviewEligibleAt: { lte: now },
      OR: [
        { reminderStatus: { in: ["scheduled", "failed"] } },
        { reminderStatus: "pending", updatedAt: { lte: stalePendingBefore } },
      ],
    },
    orderBy: { reviewEligibleAt: "asc" },
    take: 20,
  });

  const completionNotification = getProductivityCompleteNotificationConfig();
  const reviewNotification = getProductivityReviewNotificationConfig();
  const completionResend = new Resend(completionNotification.apiKey);
  const reviewResend = new Resend(reviewNotification.apiKey);
  const baseUrl = String(process.env.APP_BASE_URL || request.nextUrl.origin).replace(/\/$/, "");
  let completionNoticesSent = 0;
  let completionNoticesFailed = 0;
  let sent = 0;
  let failed = 0;
  let procoreToken: string | null = null;

  for (const review of completionNoticesDue) {
    const claimed = await prisma.productivityProjectReview.updateMany({
      where: {
        id: review.id,
        OR: [
          { completionNoticeStatus: { in: ["scheduled", "failed"] } },
          { completionNoticeStatus: "pending", updatedAt: { lte: stalePendingBefore } },
        ],
      },
      data: {
        completionNoticeStatus: "pending",
        completionNoticeError: null,
      },
    });
    if (!claimed.count) continue;

    const completedAt = review.cooldownStartedAt || now;
    const eligibleAt = review.reviewEligibleAt || calculateReviewEligibleAt(completedAt);
    const projectUrl = new URL("/analytics/productivity", baseUrl);
    projectUrl.searchParams.set("projectId", review.projectId);
    const email = buildProductivityCompleteEmail({
      projectNumber: review.projectNumber,
      projectName: review.projectName,
      completedAt,
      eligibleAt,
      projectUrl: projectUrl.toString(),
    });

    try {
      procoreToken ||= await getClientCredentialsToken();
      await ensureProductivityReviewTaskOnComplete({
        token: procoreToken,
        companyId,
        projectId: review.projectId,
        projectNumber: review.projectNumber,
        projectName: review.projectName,
        completedAt,
      });
      if (!completionNotification.apiKey) throw new Error("RESEND_API_KEY is not configured.");
      const result = await completionResend.emails.send({
        from: completionNotification.from,
        to: completionNotification.to,
        subject: email.subject,
        text: email.text,
        html: email.html,
      }, {
        idempotencyKey: `pmc-productivity-complete-${review.projectId}-${completedAt.getTime()}`,
      });
      if (result.error) throw new Error(result.error.message);
      await prisma.productivityProjectReview.update({
        where: { id: review.id },
        data: {
          completionNoticeStatus: "sent",
          completionNoticeSentAt: new Date(),
          completionNoticeId: result.data?.id || null,
          completionNoticeError: null,
        },
      });
      completionNoticesSent += 1;
    } catch (error) {
      await prisma.productivityProjectReview.update({
        where: { id: review.id },
        data: {
          completionNoticeStatus: "failed",
          completionNoticeError: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
        },
      });
      completionNoticesFailed += 1;
    }
  }

  for (const review of due) {
    const claimed = await prisma.productivityProjectReview.updateMany({
      where: {
        id: review.id,
        OR: [
          { reminderStatus: { in: ["scheduled", "failed"] } },
          { reminderStatus: "pending", updatedAt: { lte: stalePendingBefore } },
        ],
      },
      data: {
        reminderStatus: "pending",
        reminderError: null,
      },
    });
    if (!claimed.count) continue;

    const projectUrl = new URL("/analytics/productivity", baseUrl);
    projectUrl.searchParams.set("projectId", review.projectId);
    const email = buildProductivityReadyEmail({
      projectNumber: review.projectNumber,
      projectName: review.projectName,
      completedAt: review.cooldownStartedAt || now,
      eligibleAt: review.reviewEligibleAt || now,
      projectUrl: projectUrl.toString(),
    });

    try {
      if (!reviewNotification.apiKey) throw new Error("RESEND_API_KEY is not configured.");
      const result = await reviewResend.emails.send({
        from: reviewNotification.from,
        to: reviewNotification.to,
        subject: email.subject,
        text: email.text,
        html: email.html,
      }, {
        idempotencyKey: `pmc-productivity-ready-${review.projectId}-${(review.reviewEligibleAt || now).getTime()}`,
      });
      if (result.error) throw new Error(result.error.message);
      await prisma.productivityProjectReview.update({
        where: { id: review.id },
        data: {
          reminderStatus: "sent",
          reminderSentAt: new Date(),
          reminderId: result.data?.id || null,
          reminderError: null,
        },
      });
      sent += 1;
    } catch (error) {
      await prisma.productivityProjectReview.update({
        where: { id: review.id },
        data: {
          reminderStatus: "failed",
          reminderError: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
        },
      });
      failed += 1;
    }
  }

  return NextResponse.json({
    success: failed === 0 && completionNoticesFailed === 0,
    scanned: canonicalByProject.size,
    scheduled,
    canceled,
    grandfathered,
    completionNoticesScheduled,
    completionNoticesDue: completionNoticesDue.length,
    completionNoticesSent,
    completionNoticesFailed,
    due: due.length,
    sent,
    failed,
  }, { status: failed === 0 && completionNoticesFailed === 0 ? 200 : 502 });
}

export async function POST(request: NextRequest) {
  try {
    return await withProcoreLiveApiBypassForSyncSecret(request, () => processReminders(request));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[productivity-review-reminders]", error);
    return NextResponse.json(
      {
        success: false,
        error: "The productivity review reminder job could not complete.",
        ...(process.env.NODE_ENV !== "production" ? { details: message } : {}),
      },
      { status: 500 },
    );
  }
}
