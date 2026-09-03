export const PM_DASHBOARD_TIME_ZONE = "America/New_York";
export const DEFAULT_PROCORE_WEB_ORIGIN = "https://us02.procore.com";

export const PM_ACTION_ITEM_TYPES = ["rfi", "task", "meeting"] as const;
export type PmActionItemType = (typeof PM_ACTION_ITEM_TYPES)[number];

export type UnknownRecord = Record<string, unknown>;

export type PmActionItemInput = {
  sourceType: PmActionItemType;
  sourceId: string;
  number: string | null;
  title: string;
  description: string | null;
  status: string | null;
  dueAt: Date | null;
  startsAt: Date | null;
  endsAt: Date | null;
  assigneeEmails: string[];
  assigneeNames: string[];
  isOpen: boolean;
  sourceUrl: string | null;
  payload: UnknownRecord;
};

export type MemberIdentity = { id?: string; name?: string; email?: string };

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function firstText(record: UnknownRecord, keys: string[]): string {
  for (const key of keys) {
    const value = text(record[key]);
    if (value) return value;
  }
  return "";
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalizeEmail(value: unknown): string {
  const email = text(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function safeProcoreUrl(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:" && (hostname === "procore.com" || hostname.endsWith(".procore.com"))
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function buildProcoreItemUrl(params: {
  sourceType: PmActionItemType;
  projectId: unknown;
  sourceId: unknown;
  existingUrl?: unknown;
  procoreWebOrigin?: unknown;
}): string | null {
  const existingUrl = safeProcoreUrl(params.existingUrl);
  if (existingUrl) return existingUrl;

  const projectId = text(params.projectId);
  const sourceId = text(params.sourceId);
  if (!projectId || !sourceId) return null;

  const configuredOrigin = safeProcoreUrl(params.procoreWebOrigin);
  const origin = configuredOrigin ? new URL(configuredOrigin).origin : DEFAULT_PROCORE_WEB_ORIGIN;
  const projectPath = `/${encodeURIComponent(projectId)}/project`;
  const itemPath = params.sourceType === "rfi"
    ? `${projectPath}/rfi/show/${encodeURIComponent(sourceId)}`
    : params.sourceType === "task"
      ? `${projectPath}/task_items/${encodeURIComponent(sourceId)}`
      : `${projectPath}/meetings/${encodeURIComponent(sourceId)}`;
  return new URL(itemPath, origin).toString();
}

function memberIdentity(value: unknown, directory: Map<string, MemberIdentity>): MemberIdentity | null {
  if (typeof value === "number" || typeof value === "string") {
    const key = text(value);
    if (!key) return null;
    return directory.get(key) || (key.includes("@") ? { email: key } : { id: key });
  }
  if (!isRecord(value)) return null;

  const nested = [value.user, value.person, value.contact, value.member].find(isRecord);
  const id = firstText(value, ["id", "user_id", "person_id"]) || (nested ? firstText(nested, ["id", "user_id"]) : "");
  const fromDirectory = id ? directory.get(id) : undefined;
  const firstName = firstText(value, ["first_name", "firstName"]);
  const lastName = firstText(value, ["last_name", "lastName"]);
  const name = firstText(value, ["name", "full_name", "label"])
    || (nested ? firstText(nested, ["name", "full_name", "label"]) : "")
    || `${firstName} ${lastName}`.trim()
    || fromDirectory?.name
    || "";
  const email = normalizeEmail(
    firstText(value, ["email", "login", "email_address"])
      || (nested ? firstText(nested, ["email", "login", "email_address"]) : "")
      || fromDirectory?.email,
  );

  if (!id && !name && !email) return null;
  return { id: id || undefined, name: name || undefined, email: email || undefined };
}

function collectMembers(
  record: UnknownRecord,
  fields: string[],
  directory: Map<string, MemberIdentity>,
): MemberIdentity[] {
  const result: MemberIdentity[] = [];
  for (const field of fields) {
    const value = record[field];
    const values = Array.isArray(value) ? value : value == null ? [] : [value];
    for (const candidate of values) {
      const identity = memberIdentity(candidate, directory);
      if (identity) result.push(identity);
    }
  }
  return result;
}

export function toProcoreDate(value: unknown): Date | null {
  const raw = text(value);
  if (!raw) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00Z` : raw;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isOpenPmItem(sourceType: PmActionItemType, record: UnknownRecord): boolean {
  if (sourceType === "meeting") {
    const cancelled = record.cancelled ?? record.canceled ?? record.is_cancelled ?? record.is_canceled;
    return cancelled !== true && text(record.status).toLowerCase() !== "cancelled";
  }

  const status = firstText(record, ["status", "state"]).toLowerCase();
  if (!status) return true;
  return ![
    "closed",
    "complete",
    "completed",
    "void",
    "voided",
    "recycled",
    "deleted",
  ].includes(status);
}

function sourceMemberFields(sourceType: PmActionItemType): string[] {
  if (sourceType === "rfi") {
    return [
      "rfi_manager",
      "rfi_managers",
      "assignee",
      "assignees",
      "assigned_to",
      "ball_in_court",
      "ball_in_court_user",
      "responsible_contractors",
    ];
  }
  if (sourceType === "meeting") {
    return ["attendees", "meeting_attendees", "invitees", "participants"];
  }
  return ["assigned", "assigned_to", "assignee", "assignees", "assigned_id", "assignee_ids"];
}

export function normalizePmActionItem(params: {
  sourceType: PmActionItemType;
  record: UnknownRecord;
  projectId?: unknown;
  procoreWebOrigin?: unknown;
  memberDirectory?: Map<string, MemberIdentity>;
}): PmActionItemInput | null {
  const { sourceType, record } = params;
  const sourceId = firstText(record, ["id", "task_item_id", "rfi_id", "meeting_id"]);
  if (!sourceId) return null;

  const directory = params.memberDirectory || new Map<string, MemberIdentity>();
  const members = collectMembers(record, sourceMemberFields(sourceType), directory);
  const assigneeEmails = unique(members.map((member) => normalizeEmail(member.email)).filter(Boolean));
  const assigneeNames = unique(members.map((member) => text(member.name)).filter(Boolean));
  const startsAt = toProcoreDate(record.starts_at ?? record.start_at ?? record.start_time);
  const endsAt = toProcoreDate(record.ends_at ?? record.end_at ?? record.end_time);
  const dueAt = sourceType === "meeting"
    ? startsAt
    : toProcoreDate(record.due_date ?? record.due_at ?? record.deadline);
  const number = firstText(record, ["number", "rfi_number", "position"]);
  const title = firstText(record, ["title", "subject", "name"])
    || `${sourceType === "rfi" ? "RFI" : sourceType === "meeting" ? "Meeting" : "Task"}${number ? ` ${number}` : ""}`;
  const sourceUrl = buildProcoreItemUrl({
    sourceType,
    projectId: params.projectId,
    sourceId,
    existingUrl: firstText(record, ["url", "link", "web_url"]),
    procoreWebOrigin: params.procoreWebOrigin,
  });

  return {
    sourceType,
    sourceId,
    number: number || null,
    title,
    description: firstText(record, ["description", "question", "overview", "agenda"]) || null,
    status: firstText(record, ["status", "state", "mode"]) || null,
    dueAt,
    startsAt,
    endsAt,
    assigneeEmails,
    assigneeNames,
    isOpen: isOpenPmItem(sourceType, record),
    sourceUrl,
    payload: record,
  };
}

export function unwrapProcoreRows(payload: unknown, keys: string[] = []): UnknownRecord[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];
  for (const key of ["data", ...keys]) {
    const nested = payload[key];
    if (Array.isArray(nested)) return nested.filter(isRecord);
  }
  return [];
}

export function dateKeyInTimeZone(date: Date, timeZone = PM_DASHBOARD_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function nextBusinessDateKeys(now = new Date(), days = 5): string[] {
  const noonUtc = new Date(`${dateKeyInTimeZone(now)}T12:00:00Z`);
  const dateKeys: string[] = [];
  const date = new Date(noonUtc);

  while (dateKeys.length < Math.max(0, days)) {
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      dateKeys.push(date.toISOString().slice(0, 10));
    }
    date.setUTCDate(date.getUTCDate() + 1);
  }

  return dateKeys;
}

export function dateKeyAfter(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateKey;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
