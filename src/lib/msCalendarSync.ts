import { prisma } from "@/lib/prisma";
import { graphRequest, isGraphMailboxUnavailable, isMsGraphConfigured } from "@/lib/msGraph";
import {
  GRAPH_CALENDAR_SELECT,
  calendarSyncWindow,
  normalizeGraphCalendarEvent,
  type CalendarEventInput,
  type UnknownRecord,
} from "@/lib/msCalendar";

const DEFAULT_REPOLL_MINUTES = 15;
const ACCESS_DENIED_BACKOFF_HOURS = 24;

export function calendarRepollMinutes(): number {
  const parsed = Number.parseInt(String(process.env.MS_CALENDAR_REPOLL_MINUTES || ""), 10);
  return Number.isFinite(parsed) && parsed >= 5 ? parsed : DEFAULT_REPOLL_MINUTES;
}

type GraphPage = { value?: unknown[]; "@odata.nextLink"?: string };

async function fetchCalendarWindow(userEmail: string, start: Date, end: Date): Promise<CalendarEventInput[]> {
  const params = new URLSearchParams({
    startDateTime: start.toISOString(),
    endDateTime: end.toISOString(),
    $select: GRAPH_CALENDAR_SELECT,
    $top: "100",
    $orderby: "start/dateTime",
  });
  let next: string | null = `/users/${encodeURIComponent(userEmail)}/calendarView?${params.toString()}`;
  const events: CalendarEventInput[] = [];
  let pages = 0;
  while (next && pages < 10) {
    const page: GraphPage = await graphRequest<GraphPage>(next, {
      headers: { Prefer: 'outlook.timezone="UTC"' },
    });
    for (const record of page.value || []) {
      const normalized = normalizeGraphCalendarEvent(record as UnknownRecord);
      if (normalized) events.push(normalized);
    }
    next = page["@odata.nextLink"] || null;
    pages += 1;
  }
  return events;
}

export type CalendarSyncResult = {
  userEmail: string;
  outcome: "synced" | "access_denied" | "error";
  eventCount: number;
  error?: string;
};

/**
 * Replace the mirror for one mailbox over the rolling window. Events outside
 * the window are left alone (they age out on later runs); events inside the
 * window that Graph no longer returns are deleted.
 */
export async function syncUserCalendar(userEmailRaw: string, now = new Date()): Promise<CalendarSyncResult> {
  const userEmail = userEmailRaw.trim().toLowerCase();
  const attemptedAt = now;
  const { start, end } = calendarSyncWindow(now);

  try {
    const events = await fetchCalendarWindow(userEmail, start, end);
    const syncedAt = new Date();
    const keepIds = events.map((event) => event.graphEventId);

    await prisma.$transaction([
      ...events.map((event) => prisma.pmcCalendarEvent.upsert({
        where: { userEmail_graphEventId: { userEmail, graphEventId: event.graphEventId } },
        create: { userEmail, ...event, syncedAt },
        update: { ...event, syncedAt },
      })),
      prisma.pmcCalendarEvent.deleteMany({
        where: {
          userEmail,
          startsAt: { gte: start, lt: end },
          ...(keepIds.length ? { graphEventId: { notIn: keepIds } } : {}),
        },
      }),
      prisma.pmcCalendarSyncState.upsert({
        where: { userEmail },
        create: { userEmail, lastAttemptAt: attemptedAt, lastSuccessAt: syncedAt, eventCount: events.length, lastError: null, accessDeniedAt: null },
        update: { lastAttemptAt: attemptedAt, lastSuccessAt: syncedAt, eventCount: events.length, lastError: null, accessDeniedAt: null },
      }),
    ]);

    return { userEmail, outcome: "synced", eventCount: events.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const accessDenied = isGraphMailboxUnavailable(error);
    await prisma.pmcCalendarSyncState.upsert({
      where: { userEmail },
      create: {
        userEmail,
        lastAttemptAt: attemptedAt,
        lastError: message.slice(0, 2000),
        accessDeniedAt: accessDenied ? attemptedAt : null,
      },
      update: {
        lastAttemptAt: attemptedAt,
        lastError: message.slice(0, 2000),
        ...(accessDenied ? { accessDeniedAt: attemptedAt } : {}),
      },
    }).catch(() => undefined);
    return { userEmail, outcome: accessDenied ? "access_denied" : "error", eventCount: 0, error: message };
  }
}

type CandidateRow = { email: string };

/**
 * Sync the mailboxes that are due. Candidates are active employees with a
 * company email; mailboxes outside the Exchange access policy are retried
 * once a day so newly added group members pick up automatically.
 */
export async function syncDueCalendars(options: { limit?: number; now?: Date } = {}) {
  if (!isMsGraphConfigured()) {
    return { configured: false, scanned: 0, synced: 0, accessDenied: 0, failed: 0, results: [] as CalendarSyncResult[], nextBatch: false };
  }
  const now = options.now || new Date();
  const limit = Math.max(1, Math.min(25, options.limit || 5));
  const repollMinutes = calendarRepollMinutes();
  const domain = String(process.env.MS_CALENDAR_EMAIL_DOMAIN || "pmcdecor.com").trim().toLowerCase();

  const candidates = await prisma.$queryRaw<CandidateRow[]>`
    SELECT lower(e."email") AS "email"
    FROM "Employee" e
    LEFT JOIN "pmc_calendar_sync_state" s ON s."user_email" = lower(e."email")
    WHERE e."isActive" = true
      AND e."email" IS NOT NULL
      AND lower(e."email") LIKE ${`%@${domain}`}
      AND (s."last_attempt_at" IS NULL OR s."last_attempt_at" < NOW() - (${repollMinutes} * INTERVAL '1 minute'))
      AND (s."access_denied_at" IS NULL OR s."access_denied_at" < NOW() - (${ACCESS_DENIED_BACKOFF_HOURS} * INTERVAL '1 hour'))
    ORDER BY s."last_attempt_at" ASC NULLS FIRST, e."email" ASC
    LIMIT ${limit}
  `;

  const results: CalendarSyncResult[] = [];
  for (const candidate of candidates) {
    results.push(await syncUserCalendar(candidate.email, now));
  }

  return {
    configured: true,
    scanned: results.length,
    synced: results.filter((r) => r.outcome === "synced").length,
    accessDenied: results.filter((r) => r.outcome === "access_denied").length,
    failed: results.filter((r) => r.outcome === "error").length,
    results,
    nextBatch: candidates.length === limit,
  };
}
