import { createHash, timingSafeEqual } from 'crypto';
import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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

    const immediate: { attempted: boolean; processed: boolean; reason: string } = {
      attempted: false,
      processed: false,
      reason: 'queued-for-scheduled-processing',
    };

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
