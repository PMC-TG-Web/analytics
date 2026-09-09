import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getRequestUserEmail } from "@/lib/requestUser";
import { isReviewEligible } from "@/lib/productivityReviewCooldown";

export const dynamic = "force-dynamic";

type CompleteReviewBody = {
  companyId?: unknown;
  projectId?: unknown;
  weightedCompletion?: unknown;
  completionSnapshot?: unknown;
  retryNotification?: unknown;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function serializeReview(review: {
  projectId: string;
  projectNumber: string | null;
  projectName: string;
  bidBoardId: string | null;
  bidBoardStatus: string | null;
  cooldownStartedAt: Date | null;
  reviewEligibleAt: Date | null;
  reminderStatus: string;
  reminderSentAt: Date | null;
  status: string;
  reviewedAt: Date | null;
  reviewedByEmail: string | null;
  notificationEmail: string | null;
  notificationStatus: string;
  notificationError: string | null;
  weightedCompletion: Prisma.Decimal | null;
  updatedAt: Date;
}) {
  return {
    projectId: review.projectId,
    projectNumber: review.projectNumber,
    projectName: review.projectName,
    bidBoardId: review.bidBoardId,
    bidBoardStatus: review.bidBoardStatus,
    cooldownStartedAt: review.cooldownStartedAt?.toISOString() ?? null,
    reviewEligibleAt: review.reviewEligibleAt?.toISOString() ?? null,
    reminderStatus: review.reminderStatus,
    reminderSentAt: review.reminderSentAt?.toISOString() ?? null,
    status: review.status,
    reviewedAt: review.reviewedAt?.toISOString() ?? null,
    reviewedByEmail: review.reviewedByEmail,
    notificationEmail: review.notificationEmail,
    notificationStatus: review.notificationStatus,
    notificationError: review.notificationError,
    weightedCompletion:
      review.weightedCompletion === null ? null : Number(review.weightedCompletion),
    updatedAt: review.updatedAt.toISOString(),
  };
}

function unexpectedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[productivity-reviews]", error);
  return NextResponse.json(
    {
      success: false,
      error: "The project review service could not complete the request.",
      ...(process.env.NODE_ENV !== "production" ? { details: message } : {}),
    },
    { status: 500 },
  );
}

async function getReviews(request: NextRequest) {
  const companyId = text(
    request.nextUrl.searchParams.get("companyId") || process.env.PROCORE_COMPANY_ID,
  );
  if (!companyId) {
    return NextResponse.json({ success: false, error: "Missing companyId." }, { status: 400 });
  }

  const reviews = await prisma.productivityProjectReview.findMany({
    where: { companyId },
    orderBy: { reviewedAt: "desc" },
  });

  return NextResponse.json({
    success: true,
    reviews: reviews.map(serializeReview),
  });
}

export async function GET(request: NextRequest) {
  try {
    return await getReviews(request);
  } catch (error) {
    return unexpectedError(error);
  }
}

async function completeReview(request: NextRequest) {
  const reviewerEmail = await getRequestUserEmail(request);
  if (!reviewerEmail) {
    return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  }

  let body: CompleteReviewBody;
  try {
    body = (await request.json()) as CompleteReviewBody;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const companyId = text(body.companyId || process.env.PROCORE_COMPANY_ID);
  const projectId = text(body.projectId);
  const notificationEmails = ["todd@pmcdecor.com", "david@pmcdecor.com"];
  const notificationEmail = notificationEmails.join(", ");
  const retryNotification = body.retryNotification === true;
  if (!companyId || !projectId) {
    return NextResponse.json(
      { success: false, error: "companyId and projectId are required." },
      { status: 400 },
    );
  }
  const project = await prisma.pmcProject.findUnique({
    where: {
      companyId_procoreProjectId: { companyId, procoreProjectId: projectId },
    },
    select: {
      projectNumber: true,
      projectName: true,
    },
  });
  if (!project) {
    return NextResponse.json(
      { success: false, error: "Project was not found in the synced project table." },
      { status: 404 },
    );
  }

  const rawCompletion = Number(body.weightedCompletion);
  const weightedCompletion =
    body.weightedCompletion === null
    || body.weightedCompletion === undefined
    || !Number.isFinite(rawCompletion)
      ? null
      : Math.min(1, Math.max(0, rawCompletion));
  const incomingCompletionSnapshot =
    body.completionSnapshot
    && typeof body.completionSnapshot === "object"
    && !Array.isArray(body.completionSnapshot)
      ? (body.completionSnapshot as Prisma.InputJsonObject)
      : Prisma.JsonNull;

  const existing = await prisma.productivityProjectReview.findUnique({
    where: { companyId_projectId: { companyId, projectId } },
  });
  const existingSnapshot =
    existing?.completionSnapshot
    && typeof existing.completionSnapshot === "object"
    && !Array.isArray(existing.completionSnapshot)
      ? existing.completionSnapshot as Prisma.JsonObject
      : null;
  const reviewHistory = Array.isArray(existingSnapshot?.reviewHistory)
    ? existingSnapshot.reviewHistory
    : [];
  const completionSnapshot =
    incomingCompletionSnapshot !== Prisma.JsonNull && reviewHistory.length
      ? { ...incomingCompletionSnapshot, reviewHistory } as Prisma.InputJsonObject
      : incomingCompletionSnapshot;
  if (existing?.status === "completed" && ["sent", "queued"].includes(existing.notificationStatus)) {
    return NextResponse.json({
      success: true,
      alreadyCompleted: true,
      review: serializeReview(existing),
    });
  }
  if (!retryNotification && !isReviewEligible({
    bidBoardStatus: existing?.bidBoardStatus,
    reviewEligibleAt: existing?.reviewEligibleAt,
  })) {
    return NextResponse.json(
      {
        success: false,
        error: existing?.bidBoardStatus === "Complete"
          ? `This project cannot be reviewed until ${existing.reviewEligibleAt?.toLocaleDateString("en-US") || "its cooldown is complete"}.`
          : "This project must be marked Complete on the Procore Bid Board before it can be reviewed.",
      },
      { status: 409 },
    );
  }
  if (retryNotification && existing?.status !== "completed") {
    return NextResponse.json(
      { success: false, error: "Only a completed review can retry its notification." },
      { status: 409 },
    );
  }
  const stalePendingBefore = new Date(Date.now() - 10 * 60 * 1000);
  if (
    existing?.notificationStatus === "pending"
    && existing.updatedAt > stalePendingBefore
  ) {
    return NextResponse.json(
      { success: false, error: "The office review task is already being created." },
      { status: 409 },
    );
  }

  const reviewedAt = retryNotification && existing?.reviewedAt
    ? existing.reviewedAt
    : new Date();

  let pendingReview;
  if (existing) {
    const claimed = await prisma.productivityProjectReview.updateMany({
      where: {
        id: existing.id,
        updatedAt: existing.updatedAt,
        OR: [
          { notificationStatus: { not: "pending" } },
          { updatedAt: { lte: stalePendingBefore } },
        ],
      },
      data: {
        projectNumber: project.projectNumber,
        projectName: project.projectName,
        status: "completed",
        reviewedAt,
        reviewedByEmail: retryNotification
          ? existing.reviewedByEmail || reviewerEmail
          : reviewerEmail,
        notificationEmail,
        notificationStatus: "queued",
        notificationId: null,
        notificationError: null,
        reminderStatus: "not_needed",
        reminderError: null,
        weightedCompletion,
        completionSnapshot,
        completionCount: retryNotification ? existing.completionCount : { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      return NextResponse.json(
        { success: false, error: "The office review task is already being created." },
        { status: 409 },
      );
    }
    pendingReview = await prisma.productivityProjectReview.findUniqueOrThrow({
      where: { id: existing.id },
    });
  } else {
    try {
      pendingReview = await prisma.productivityProjectReview.create({
        data: {
          companyId,
          projectId,
          projectNumber: project.projectNumber,
          projectName: project.projectName,
          status: "completed",
          reviewedAt,
          reviewedByEmail: reviewerEmail,
          notificationEmail,
          notificationStatus: "queued",
          reminderStatus: "not_needed",
          weightedCompletion,
          completionSnapshot,
          completionCount: 1,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return NextResponse.json(
          { success: false, error: "This project review is already being processed." },
          { status: 409 },
        );
      }
      throw error;
    }
  }

  return NextResponse.json({ success: true, review: serializeReview(pendingReview) });
}

export async function POST(request: NextRequest) {
  try {
    return await completeReview(request);
  } catch (error) {
    return unexpectedError(error);
  }
}

async function unreviewProject(request: NextRequest) {
  const unreviewedByEmail = await getRequestUserEmail(request);
  if (!unreviewedByEmail) {
    return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  }

  let body: { companyId?: unknown; projectId?: unknown };
  try {
    body = (await request.json()) as { companyId?: unknown; projectId?: unknown };
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const companyId = text(body.companyId || process.env.PROCORE_COMPANY_ID);
  const projectId = text(body.projectId);
  if (!companyId || !projectId) {
    return NextResponse.json(
      { success: false, error: "companyId and projectId are required." },
      { status: 400 },
    );
  }

  const existing = await prisma.productivityProjectReview.findUnique({
    where: { companyId_projectId: { companyId, projectId } },
  });
  if (!existing) {
    return NextResponse.json(
      { success: false, error: "No project review was found." },
      { status: 404 },
    );
  }
  if (existing.status !== "completed") {
    return NextResponse.json({
      success: true,
      alreadyOpen: true,
      review: serializeReview(existing),
    });
  }

  if (existing.notificationStatus === "pending"
    && existing.updatedAt > new Date(Date.now() - 10 * 60_000)) {
    return NextResponse.json(
      { success: false, error: "The office review task is being created. Please try again after it finishes." },
      { status: 409 },
    );
  }

  const previousSnapshot =
    existing.completionSnapshot
    && typeof existing.completionSnapshot === "object"
    && !Array.isArray(existing.completionSnapshot)
      ? existing.completionSnapshot as Prisma.JsonObject
      : {};
  const priorHistory = Array.isArray(previousSnapshot.reviewHistory)
    ? previousSnapshot.reviewHistory
    : [];
  const completionSnapshot: Prisma.InputJsonObject = {
    ...previousSnapshot,
    reviewHistory: [
      ...priorHistory,
      {
        event: "unreviewed",
        at: new Date().toISOString(),
        by: unreviewedByEmail,
        previousReviewedAt: existing.reviewedAt?.toISOString() || null,
        previousReviewedBy: existing.reviewedByEmail,
        previousNotificationEmail: existing.notificationEmail,
        previousNotificationId: existing.notificationId,
      },
    ],
  };

  const changed = await prisma.productivityProjectReview.updateMany({
    where: { id: existing.id, updatedAt: existing.updatedAt },
    data: {
      status: "open",
      notificationStatus: "not_sent",
      notificationError: null,
      completionSnapshot,
    },
  });

  if (!changed.count) {
    return NextResponse.json(
      { success: false, error: "The review changed while this request was being processed. Please refresh and try again." },
      { status: 409 },
    );
  }
  const review = await prisma.productivityProjectReview.findUniqueOrThrow({ where: { id: existing.id } });

  return NextResponse.json({ success: true, review: serializeReview(review) });
}

export async function DELETE(request: NextRequest) {
  try {
    return await unreviewProject(request);
  } catch (error) {
    return unexpectedError(error);
  }
}
