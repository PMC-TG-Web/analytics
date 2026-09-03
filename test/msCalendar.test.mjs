import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PRIVATE_EVENT_SUBJECT,
  calendarSyncWindow,
  graphDateTimeToDate,
  normalizeGraphCalendarEvent,
} from "../src/lib/msCalendar.ts";

test("Graph dateTimeTimeZone values are parsed as UTC when the zone is UTC or omitted", () => {
  assert.equal(graphDateTimeToDate({ dateTime: "2026-09-04T13:30:00.0000000", timeZone: "UTC" })?.toISOString(), "2026-09-04T13:30:00.000Z");
  assert.equal(graphDateTimeToDate({ dateTime: "2026-09-04T13:30:00Z" })?.toISOString(), "2026-09-04T13:30:00.000Z");
  assert.equal(graphDateTimeToDate({ dateTime: "" }), null);
  assert.equal(graphDateTimeToDate(null), null);
});

test("Outlook events are normalized with attendees, location, and join link", () => {
  const event = normalizeGraphCalendarEvent({
    id: "AAMk1",
    iCalUId: "040000008200E00074C5B7101A82E008",
    subject: "OAC meeting - Giant #6459",
    location: { displayName: "Job trailer" },
    start: { dateTime: "2026-09-04T13:00:00.0000000", timeZone: "UTC" },
    end: { dateTime: "2026-09-04T14:00:00.0000000", timeZone: "UTC" },
    isAllDay: false,
    isCancelled: false,
    showAs: "busy",
    sensitivity: "normal",
    organizer: { emailAddress: { address: "Todd@PMCdecor.com" } },
    attendees: [
      { emailAddress: { address: "abner@pmcdecor.com" } },
      { emailAddress: { address: "abner@pmcdecor.com" } },
      { emailAddress: { address: "not-an-email" } },
    ],
    onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/abc" },
    webLink: "https://outlook.office365.com/owa/?itemid=AAMk1",
  });
  assert.ok(event);
  assert.equal(event.subject, "OAC meeting - Giant #6459");
  assert.equal(event.location, "Job trailer");
  assert.equal(event.organizerEmail, "todd@pmcdecor.com");
  assert.deepEqual(event.attendeeEmails, ["abner@pmcdecor.com"]);
  assert.equal(event.onlineMeetingUrl, "https://teams.microsoft.com/l/meetup-join/abc");
  assert.equal(event.startsAt.toISOString(), "2026-09-04T13:00:00.000Z");
  assert.equal(event.showAs, "busy");
});

test("private and confidential events keep only their time block", () => {
  for (const sensitivity of ["private", "confidential"]) {
    const event = normalizeGraphCalendarEvent({
      id: "AAMk2",
      subject: "Doctor appointment",
      location: { displayName: "Clinic" },
      start: { dateTime: "2026-09-04T15:00:00Z" },
      end: { dateTime: "2026-09-04T16:00:00Z" },
      sensitivity,
      organizer: { emailAddress: { address: "todd@pmcdecor.com" } },
      attendees: [{ emailAddress: { address: "someone@example.com" } }],
      onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/xyz" },
      webLink: "https://outlook.office365.com/owa/?itemid=AAMk2",
    });
    assert.ok(event);
    assert.equal(event.subject, PRIVATE_EVENT_SUBJECT);
    assert.equal(event.location, null);
    assert.equal(event.organizerEmail, null);
    assert.deepEqual(event.attendeeEmails, []);
    assert.equal(event.onlineMeetingUrl, null);
    // The user's own Outlook link is still safe to keep.
    assert.equal(event.webLink, "https://outlook.office365.com/owa/?itemid=AAMk2");
  }
});

test("events missing an id or times are skipped and non-https links are dropped", () => {
  assert.equal(normalizeGraphCalendarEvent({ subject: "no id", start: { dateTime: "2026-09-04T15:00:00Z" }, end: { dateTime: "2026-09-04T16:00:00Z" } }), null);
  assert.equal(normalizeGraphCalendarEvent({ id: "x", subject: "no end", start: { dateTime: "2026-09-04T15:00:00Z" } }), null);
  const event = normalizeGraphCalendarEvent({
    id: "x",
    start: { dateTime: "2026-09-04T15:00:00Z" },
    end: { dateTime: "2026-09-04T16:00:00Z" },
    webLink: "javascript:alert(1)",
    onlineMeetingUrl: "http://insecure.example.com",
  });
  assert.ok(event);
  assert.equal(event.subject, "(No subject)");
  assert.equal(event.webLink, null);
  assert.equal(event.onlineMeetingUrl, null);
});

test("the sync window runs from yesterday through two weeks ahead on UTC day boundaries", () => {
  const { start, end } = calendarSyncWindow(new Date("2026-09-03T16:45:00Z"), 14);
  assert.equal(start.toISOString(), "2026-09-02T00:00:00.000Z");
  assert.equal(end.toISOString(), "2026-09-18T00:00:00.000Z");
});

test("calendar sync stays inside the secret-authenticated worker lane and the dashboard reads only the mirror", async () => {
  const middleware = await readFile(new URL("../middleware.ts", import.meta.url), "utf8");
  assert.match(middleware, /pathname === '\/api\/cron\/calendar-sync'/);
  assert.match(middleware, /pathname === '\/api\/background\/calendar-sync'/);

  const scheduler = await readFile(new URL("../netlify/functions/scheduled-sync.mts", import.meta.url), "utf8");
  assert.match(scheduler, /\/api\/background\/calendar-sync/);

  const dashboard = await readFile(new URL("../src/app/api/pm-dashboard/route.ts", import.meta.url), "utf8");
  assert.match(dashboard, /FROM "pmc_calendar_events" c/);
  assert.match(dashboard, /c\."user_email" = \$\{email\.toLowerCase\(\)\}/);
  assert.doesNotMatch(dashboard, /graph\.microsoft\.com|graphRequest/);

  const sync = await readFile(new URL("../src/lib/msCalendarSync.ts", import.meta.url), "utf8");
  // Access-policy denials back off instead of being treated as failures.
  assert.match(sync, /isGraphMailboxUnavailable\(error\)/);
  assert.match(sync, /access_denied_at" < NOW\(\) - \(\$\{ACCESS_DENIED_BACKOFF_HOURS\}/);
});
