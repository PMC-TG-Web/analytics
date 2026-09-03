/**
 * Pure helpers for the Outlook calendar mirror. No I/O so they can be unit
 * tested directly and shared between the sync worker and the dashboard API.
 */

export type UnknownRecord = Record<string, unknown>;

export type CalendarEventInput = {
  graphEventId: string;
  iCalUid: string | null;
  seriesMasterId: string | null;
  subject: string;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
  isAllDay: boolean;
  isCancelled: boolean;
  showAs: string | null;
  sensitivity: string | null;
  organizerEmail: string | null;
  attendeeEmails: string[];
  onlineMeetingUrl: string | null;
  webLink: string | null;
};

export const PRIVATE_EVENT_SUBJECT = "Busy";

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: unknown): string {
  const email = text(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

/**
 * Graph returns dateTimeTimeZone objects; with `Prefer: outlook.timezone="UTC"`
 * the dateTime is UTC without a trailing Z. All-day events are date-only at
 * midnight in the mailbox's zone and are represented as UTC midnight here.
 */
export function graphDateTimeToDate(value: unknown): Date | null {
  if (!isRecord(value)) return null;
  const raw = text(value.dateTime);
  if (!raw) return null;
  const zone = text(value.timeZone);
  const iso = /(Z|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw}${zone === "UTC" || zone === "" ? "Z" : ""}`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function safeHttpsUrl(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Convert a Graph calendarView event to the mirror shape. Private events keep
 * only their time block; subject/location/attendees are dropped so a colleague
 * viewing the dashboard sees exactly what Outlook would show them.
 */
export function normalizeGraphCalendarEvent(record: unknown): CalendarEventInput | null {
  if (!isRecord(record)) return null;
  const graphEventId = text(record.id);
  const startsAt = graphDateTimeToDate(record.start);
  const endsAt = graphDateTimeToDate(record.end);
  if (!graphEventId || !startsAt || !endsAt) return null;

  const sensitivity = text(record.sensitivity).toLowerCase() || null;
  const isPrivate = sensitivity === "private" || sensitivity === "confidential";

  const organizer = isRecord(record.organizer) && isRecord(record.organizer.emailAddress)
    ? normalizeEmail(record.organizer.emailAddress.address)
    : "";
  const attendees = Array.isArray(record.attendees)
    ? record.attendees
      .map((attendee) => (isRecord(attendee) && isRecord(attendee.emailAddress) ? normalizeEmail(attendee.emailAddress.address) : ""))
      .filter(Boolean)
    : [];
  const location = isRecord(record.location) ? text(record.location.displayName) : text(record.location);
  const onlineMeeting = isRecord(record.onlineMeeting) ? safeHttpsUrl(record.onlineMeeting.joinUrl) : null;

  return {
    graphEventId,
    iCalUid: text(record.iCalUId) || null,
    seriesMasterId: text(record.seriesMasterId) || null,
    subject: isPrivate ? PRIVATE_EVENT_SUBJECT : (text(record.subject) || "(No subject)"),
    location: isPrivate ? null : (location || null),
    startsAt,
    endsAt,
    isAllDay: record.isAllDay === true,
    isCancelled: record.isCancelled === true,
    showAs: text(record.showAs).toLowerCase() || null,
    sensitivity,
    organizerEmail: isPrivate ? null : (organizer || null),
    attendeeEmails: isPrivate ? [] : Array.from(new Set(attendees)),
    onlineMeetingUrl: isPrivate ? null : (onlineMeeting || safeHttpsUrl(record.onlineMeetingUrl)),
    webLink: safeHttpsUrl(record.webLink),
  };
}

/** Rolling sync window: yesterday through N days ahead, UTC day boundaries. */
export function calendarSyncWindow(now = new Date(), daysAhead = 14): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysAhead + 1));
  return { start, end };
}

export const GRAPH_CALENDAR_SELECT = [
  "id", "iCalUId", "seriesMasterId", "subject", "location", "start", "end", "isAllDay",
  "isCancelled", "showAs", "sensitivity", "organizer", "attendees", "onlineMeeting",
  "onlineMeetingUrl", "webLink",
].join(",");
