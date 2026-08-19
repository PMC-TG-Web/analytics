export type TimecardNotificationEntry = {
  partyName: string | null;
  hours: number | null;
};

export type ProjectRoleLike = Record<string, unknown>;
export type ProjectUserLike = Record<string, unknown>;

export type TimecardNotificationEmailInput = {
  projectNumber: string | null;
  projectName: string;
  timecardDate: Date | null;
  createdByName: string | null;
  entries: TimecardNotificationEntry[];
  projectUrl: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function normalize(value: unknown): string {
  return text(value).replace(/\s+/g, " ").toLowerCase();
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function isValidTimecardNotificationEmail(value: string): boolean {
  const email = value.trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function extractTimesheetId(entry: Record<string, unknown>): string | null {
  const originData = asRecord(entry.origin_data);
  const id = text(
    entry.timesheet_id
    ?? entry._timesheet_id
    ?? originData?.timesheet_id
    ?? originData?.timesheetId,
  );
  return id || null;
}

export function selectProjectManagerRecipients(
  roles: ProjectRoleLike[],
  users: ProjectUserLike[],
): Array<{ id: string; name: string; email: string }> {
  const managerIds = new Set<string>();
  const emailsFromRoles = new Map<string, { name: string; email: string }>();

  for (const role of roles) {
    if (normalize(role.role ?? role.title) !== "project manager") continue;
    if (role.is_active === false) continue;

    const roleUser = asRecord(role.user);
    const id = text(role.user_id ?? role.contact_id ?? roleUser?.id);
    if (id) managerIds.add(id);

    const email = text(role.login ?? role.email ?? role.email_address ?? roleUser?.login ?? roleUser?.email)
      .toLowerCase();
    if (email && isValidTimecardNotificationEmail(email)) {
      emailsFromRoles.set(id || email, {
        name: text(role.name ?? roleUser?.name),
        email,
      });
    }
  }

  const recipients = new Map<string, { id: string; name: string; email: string }>();
  for (const user of users) {
    const id = text(user.id ?? user.user_id);
    if (!id || !managerIds.has(id)) continue;
    const email = text(user.login ?? user.email ?? user.email_address).toLowerCase();
    if (!isValidTimecardNotificationEmail(email)) continue;
    recipients.set(email, {
      id,
      name: text(user.name || `${text(user.first_name)} ${text(user.last_name)}`),
      email,
    });
  }

  for (const [id, recipient] of emailsFromRoles) {
    if (!recipients.has(recipient.email)) {
      recipients.set(recipient.email, { id, ...recipient });
    }
  }

  return [...recipients.values()].sort((a, b) => a.email.localeCompare(b.email));
}

export function buildTimecardNotificationEmail(input: TimecardNotificationEmailInput) {
  const projectLabel = [input.projectNumber, input.projectName]
    .filter(Boolean)
    .join(" · ")
    .replace(/[\r\n]+/g, " ");
  const dateLabel = input.timecardDate
    ? input.timecardDate.toLocaleDateString("en-US", {
        timeZone: "UTC",
        dateStyle: "long",
      })
    : "Date not available";
  const employees = [...new Set(input.entries.map((entry) => entry.partyName?.trim()).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b))) as string[];
  const totalHours = input.entries.reduce(
    (sum, entry) => sum + (typeof entry.hours === "number" && Number.isFinite(entry.hours) ? entry.hours : 0),
    0,
  );
  const hoursLabel = Number.isInteger(totalHours) ? String(totalHours) : totalHours.toFixed(2);
  const creator = input.createdByName || "Not available";
  const employeeLabel = employees.length ? employees.join(", ") : "Not available";
  const subject = `New Procore timecard — ${projectLabel}`;
  const textBody = [
    `A new timecard was created for ${projectLabel}.`,
    "",
    `Work date: ${dateLabel}`,
    `Created by: ${creator}`,
    `Employees: ${employeeLabel}`,
    `Entries: ${input.entries.length}`,
    `Total hours: ${hoursLabel}`,
    "",
    `Open project: ${input.projectUrl}`,
  ].join("\n");
  const html = `
    <div style="background:#f1f5f9;padding:24px;font-family:Arial,sans-serif;color:#0f172a">
      <div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #cbd5e1;border-radius:12px;overflow:hidden">
        <div style="background:#1e293b;padding:20px 24px;color:#fff">
          <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#99f6e4">Procore Timecards</div>
          <h1 style="font-size:22px;margin:8px 0 0">New timecard created</h1>
        </div>
        <div style="padding:24px">
          <h2 style="font-size:18px;margin:0 0 18px">${escapeHtml(projectLabel)}</h2>
          <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px">
            <tr><td style="padding:8px 0;color:#64748b">Work date</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(dateLabel)}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b">Created by</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(creator)}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b">Employees</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(employeeLabel)}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b">Entries</td><td style="padding:8px 0;text-align:right;font-weight:700">${input.entries.length}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b">Total hours</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(hoursLabel)}</td></tr>
          </table>
          <a href="${escapeHtml(input.projectUrl)}" style="display:inline-block;margin-top:22px;background:#0f766e;color:#fff;text-decoration:none;font-weight:700;padding:11px 16px;border-radius:8px">Open Project in Procore</a>
        </div>
      </div>
    </div>
  `.trim();

  return { subject, text: textBody, html };
}
