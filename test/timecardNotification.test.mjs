import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function loadModule() {
  const source = fs.readFileSync("src/lib/timecardNotification.ts", "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function(module, exports) { ${output} })(module, module.exports);`, {
    module,
  });
  return module.exports;
}

const {
  buildTimecardNotificationErrorEmail,
  buildTimecardNotificationEmail,
  extractTimesheetId,
  isPmcdecorEmail,
  parsePmcdecorEmailList,
  selectProjectManagerRecipients,
  selectProjectManagerRecipientsForDomain,
} = loadModule();

test("uses the parent timesheet ID instead of the individual entry ID", () => {
  assert.equal(extractTimesheetId({ id: "line-1", timesheet_id: 98765 }), "98765");
  assert.equal(extractTimesheetId({ id: "line-2", _timesheet_id: "98765" }), "98765");
  assert.equal(extractTimesheetId({ id: "line-3" }), null);
});

test("selects only active users assigned to the Project Manager project role", () => {
  const recipients = selectProjectManagerRecipients([
    { role: "Project Manager", user_id: 10, is_active: true },
    { role: "Project Manager", user_id: 11, is_active: false },
    { role: "Foreman", user_id: 12, is_active: true },
    { role: "Project Manager", user_id: 13, is_active: true },
    { role: "Project Manager", user_id: 14, is_active: true, email: "vendor@example.com" },
  ], [
    { id: 10, name: "Pat Manager", login: "PAT@PMCDECOR.COM" },
    { id: 11, name: "Old Manager", login: "old@pmcdecor.com" },
    { id: 12, name: "Fran Foreman", login: "foreman@pmcdecor.com" },
    { id: 13, name: "External Manager", login: "manager@vendor.com" },
  ]);

  assert.deepEqual(JSON.parse(JSON.stringify(recipients)), [
    { id: "10", name: "Pat Manager", email: "pat@pmcdecor.com" },
  ]);
});

test("accepts only the exact pmcdecor.com recipient domain", () => {
  assert.equal(isPmcdecorEmail("User@PMCDECOR.COM"), true);
  assert.equal(isPmcdecorEmail("user@sub.pmcdecor.com"), false);
  assert.equal(isPmcdecorEmail("user@pmcdecor.com.example"), false);
  assert.equal(isPmcdecorEmail("user@example.com"), false);
});

test("parses only exact PMC recipient lists and rejects mixed-company lists", () => {
  assert.deepEqual(
    Array.from(parsePmcdecorEmailList("Todd@PMCDECOR.COM, todd@pmcdecor.com, pm@pmcdecor.com")),
    ["todd@pmcdecor.com", "pm@pmcdecor.com"],
  );
  assert.throws(
    () => parsePmcdecorEmailList("pm@pmcdecor.com, vendor@example.com"),
    /exact @pmcdecor\.com domain/,
  );
});

test("limits project manager recipients to the exact requested email domain", () => {
  const recipients = selectProjectManagerRecipientsForDomain([
    { role: "Project Manager", user_id: 10, is_active: true },
    { role: "Project Manager", user_id: 11, is_active: true },
    { role: "Project Manager", user_id: 12, is_active: true },
  ], [
    { id: 10, name: "Internal PM", login: "pm@PMCDECOR.COM" },
    { id: 11, name: "External PM", login: "pm@example.com" },
    { id: 12, name: "Lookalike Domain", login: "pm@notpmcdecor.com" },
  ], "@pmcdecor.com");

  assert.deepEqual(JSON.parse(JSON.stringify(recipients)), [
    { id: "10", name: "Internal PM", email: "pm@pmcdecor.com" },
  ]);
});

test("builds one timecard email summarizing all entry lines", () => {
  const email = buildTimecardNotificationEmail({
    projectNumber: "2601",
    projectName: "<Sample & Project>",
    timecardDate: new Date("2026-08-19T00:00:00.000Z"),
    createdByName: "Crew Lead",
    entries: [
      { partyName: "Employee One", hours: 8 },
      { partyName: "Employee One", hours: 1.5 },
      { partyName: "Employee Two", hours: 7 },
    ],
    projectUrl: "https://example.com/project",
  });

  assert.match(email.subject, /2601/);
  assert.match(email.text, /Entries: 3/);
  assert.match(email.text, /Total hours: 16\.5/);
  assert.match(email.text, /Employee One, Employee Two/);
  assert.doesNotMatch(email.html, /<Sample/);
  assert.match(email.html, /&lt;Sample &amp; Project&gt;/);
});

test("builds an error alert with timecard delivery details", () => {
  const email = buildTimecardNotificationErrorEmail({
    projectNumber: "2601",
    projectName: "Sample Project",
    timesheetId: "98765",
    timecardDate: new Date("2026-08-24T00:00:00.000Z"),
    attemptNumber: 2,
    errorMessage: "No active Project Manager was found.",
    projectUrl: "https://example.com/project",
  });

  assert.match(email.subject, /Timecard email error/);
  assert.match(email.text, /Timesheet ID: 98765/);
  assert.match(email.text, /Delivery attempt: 2/);
  assert.match(email.text, /No active Project Manager/);
});

test("the sender is scheduled and the delivery table is unique per timesheet", () => {
  const scheduledSync = fs.readFileSync("netlify/functions/scheduled-sync.mts", "utf8");
  const migration = fs.readFileSync(
    "prisma/migrations/20260819123000_add_timecard_notifications/migration.sql",
    "utf8",
  );
  assert.match(scheduledSync, /api\/cron\/timecard-notifications/);
  assert.match(migration, /UNIQUE \(company_id, project_id, timesheet_id\)/);
});

test("timecard errors are durably retried only to Todd", () => {
  const sender = fs.readFileSync("src/app/api/cron/timecard-notifications/route.ts", "utf8");
  const migration = fs.readFileSync(
    "prisma/migrations/20260824100000_add_timecard_notification_error_alerts/migration.sql",
    "utf8",
  );

  assert.match(sender, /TIMECARD_ERROR_RECIPIENT = "todd@pmcdecor\.com"/);
  assert.match(sender, /idempotencyKey: `timecard-error-/);
  assert.match(sender, /processErrorAlerts/);
  assert.match(migration, /error_alert_attempts INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /error_alert_sent_at TIMESTAMPTZ/);
  assert.match(migration, /error_alert_message = last_error/);
});
