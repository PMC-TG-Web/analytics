import { createHash, timingSafeEqual } from 'crypto';
import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { processEvent } from '@/app/api/webhooks/procore/process/route';

const IMMEDIATE_LOCK_OWNER = 'webhook:immediate';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toOptionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function getWebhookSecretFromRequest(request: NextRequest): string {
  const directHeader = request.headers.get('x-procore-webhook-secret')?.trim();
  if (directHeader) return directHeader;

  const altHeader = request.headers.get('x-webhook-secret')?.trim();
  if (altHeader) return altHeader;

  const auth = request.headers.get('authorization')?.trim();
  if (!auth) return '';

  const bearerMatch = auth.match(/^Bearer\s+(.+)$/i);
  return bearerMatch?.[1]?.trim() || auth;
}

function secretsMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

function nextRetryDelayMs(attemptNumber: number): number {
  const baseMs = 1_000;
  const maxMs = 5 * 60 * 1000;
  return Math.min(maxMs, baseMs * Math.pow(2, Math.max(0, attemptNumber - 1)));
}

async function runImmediateProjectsProcessing(params: {
  queueId: string;
  eventId: string;
  maxAttempts: number;
  event: {
    companyId: string | null;
    projectId: string | null;
    resourceName: string | null;
    eventType: string | null;
    resourceId: string | null;
    payload: unknown;
  };
  timeoutMs: number;
}) {
  const { queueId, eventId, maxAttempts, event, timeoutMs } = params;

  const claim = await prisma.procoreWebhookQueue.updateMany({
    where: {
      id: queueId,
      status: 'pending',
    },
    data: {
      status: 'processing',
      lockedAt: new Date(),
      lockedBy: IMMEDIATE_LOCK_OWNER,
      attempts: { increment: 1 },
    },
  });

  if (claim.count === 0) {
    return { attempted: false, processed: false };
  }

  const processingPromise = processEvent(event);
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(`Immediate processing timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    await Promise.race([processingPromise, timeoutPromise]);
    if (timeoutHandle) clearTimeout(timeoutHandle);

    await prisma.$transaction([
      prisma.procoreWebhookQueue.update({
        where: { id: queueId },
        data: {
          status: 'completed',
          processedAt: new Date(),
          lastError: null,
          lockedAt: null,
          lockedBy: null,
        },
      }),
      prisma.procoreWebhookEvent.update({
        where: { id: eventId },
        data: { processedAt: new Date() },
      }),
    ]);

    return { attempted: true, processed: true };
  } catch (error) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    const attempted = 1;
    const shouldFailPermanently = attempted >= maxAttempts;

    await prisma.procoreWebhookQueue.update({
      where: { id: queueId },
      data: {
        status: shouldFailPermanently ? 'failed' : 'pending',
        availableAt: shouldFailPermanently
          ? new Date()
          : new Date(Date.now() + nextRetryDelayMs(attempted)),
        lockedAt: null,
        lockedBy: null,
        lastError: error instanceof Error ? error.message.slice(0, 1000) : 'Immediate processing failed',
      },
    });

    return {
      attempted: true,
      processed: false,
      error: error instanceof Error ? error.message : 'Immediate processing failed',
    };
  }
}

export async function POST(request: NextRequest) {
  const expectedSecret = (process.env.PROCORE_WEBHOOK_SHARED_SECRET || '').trim();
  if (!expectedSecret) {
    return NextResponse.json(
      {
        success: false,
        error: 'Webhook secret is not configured',
        details: 'Set PROCORE_WEBHOOK_SHARED_SECRET in environment settings.',
      },
      { status: 503 }
    );
  }

  const providedSecret = getWebhookSecretFromRequest(request);
  if (!providedSecret || !secretsMatch(providedSecret, expectedSecret)) {
    return NextResponse.json({ success: false, error: 'Unauthorized webhook request' }, { status: 401 });
  }

  const rawBody = await request.text();
  if (!rawBody.trim()) {
    return NextResponse.json({ success: false, error: 'Empty request body' }, { status: 400 });
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON payload' }, { status: 400 });
  }

  const envelope = isRecord(parsedBody) ? parsedBody : {};
  const payload = isRecord(envelope.payload) ? envelope.payload : envelope;

  const companyId = toOptionalString(payload.company_id ?? envelope.company_id);
  const projectId = toOptionalString(payload.project_id ?? envelope.project_id);
  const eventType = toOptionalString(payload.event_type ?? envelope.event_type) || 'unknown';
  const resourceName = toOptionalString(payload.resource_name ?? envelope.resource_name) || 'unknown';
  const resourceId = toOptionalString(payload.resource_id ?? envelope.resource_id);
  const procoreEventId = toOptionalString(payload.id ?? envelope.id);
  const eventUlid = toOptionalString(payload.ulid ?? envelope.ulid);

  const bodyHash = createHash('sha256').update(rawBody).digest('hex');
  const eventKey = eventUlid || procoreEventId || `sha256:${bodyHash}`;
  const maxAttempts = Math.max(1, Number.parseInt(process.env.PROCORE_WEBHOOK_MAX_ATTEMPTS || '5', 10) || 5);
  const immediateProjectsEnabled = process.env.PROCORE_WEBHOOK_IMMEDIATE_PROJECTS !== 'false';
  const immediateTimeoutMs = Math.max(
    500,
    Math.min(10_000, Number.parseInt(process.env.PROCORE_WEBHOOK_IMMEDIATE_TIMEOUT_MS || '3000', 10) || 3000)
  );

  try {
    const created = await prisma.$transaction(async (tx) => {
      const event = await tx.procoreWebhookEvent.create({
        data: {
          eventKey,
          procoreEventId,
          eventUlid,
          companyId,
          projectId,
          resourceName,
          eventType,
          resourceId,
          payload: parsedBody as Prisma.InputJsonValue,
        },
      });

      const queueItem = await tx.procoreWebhookQueue.create({
        data: {
          eventId: event.id,
          maxAttempts,
        },
      });

      return { event, queueItem };
    });

    let immediate: { attempted: boolean; processed: boolean; error?: string } = {
      attempted: false,
      processed: false,
    };

    const isProjectsEvent = (resourceName || '').toLowerCase() === 'projects';
    if (immediateProjectsEnabled && isProjectsEvent) {
      immediate = await runImmediateProjectsProcessing({
        queueId: created.queueItem.id,
        eventId: created.event.id,
        maxAttempts,
        event: {
          companyId,
          projectId,
          resourceName,
          eventType,
          resourceId,
          payload: parsedBody,
        },
        timeoutMs: immediateTimeoutMs,
      });
    }

    return NextResponse.json(
      {
        success: true,
        queued: true,
        eventKey,
        eventId: created.event.id,
        immediate,
      },
      { status: 202 }
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json(
        {
          success: true,
          queued: false,
          duplicate: true,
          eventKey,
        },
        { status: 202 }
      );
    }

    const message = error instanceof Error ? error.message : 'Unknown error while storing webhook event';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
