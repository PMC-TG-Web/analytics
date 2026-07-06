import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getClientCredentialsToken, procoreConfig } from "@/lib/procore";

export const dynamic = "force-dynamic";

type UnknownRecord = Record<string, unknown>;

type TargetUserLookup = {
  id: number;
  login: string;
  name: string;
  source: "project_user" | "company_user";
};

type MeetingCloneRow = {
  sourceId: string;
  sourceParentId: string;
  seriesKey: string;
  sourceTitle: string;
  sourceStart: string;
  sourceEnd: string;
  sourceMode: string;
  sourcePosition: number | null;
  sourceAttendees: Array<{ id: string; login: string; name: string; status: string }>;
  mappedAttendees: number[];
  mappedAttendance: Array<{ attendeeId: number; status: string }>;
  missingAttendees: Array<{ id: string; login: string; name: string }>;
  existingTargetMeeting: boolean;
  payload: UnknownRecord;
  issues: string[];
};

const MEETING_FALLBACK_START_DATETIME = "2026-01-01T12:00:00Z";
const MEETING_FALLBACK_END_DATETIME = "2026-01-01T13:00:00Z";

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown, keys: string[] = []): UnknownRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of ["data", "meetings", ...keys]) {
    const nested = value[key];
    if (Array.isArray(nested)) return nested.filter(isRecord);
  }
  return [];
}

function readStr(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return "";
}

function readNum(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalize(value: unknown): string {
  return readStr(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function compactPayload(value: UnknownRecord) {
  const out: UnknownRecord = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || entry === null || entry === "") continue;
    if (Array.isArray(entry) && entry.length === 0) continue;
    if (isRecord(entry) && Object.keys(entry).length === 0) continue;
    out[key] = entry;
  }
  return out;
}

function readIdentity(value: unknown) {
  if (isRecord(value)) {
    return {
      id: readStr(value.id),
      name: readStr(value.name),
      login: readStr(value.login || value.email || value.email_address),
    };
  }
  const raw = readStr(value);
  return { id: raw, name: "", login: "" };
}

function buildStringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = readStr(key);
    const normalizedValue = readStr(entry);
    if (normalizedKey && normalizedValue) out[normalizedKey] = normalizedValue;
  }
  return out;
}

function parseIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(readStr).filter(Boolean);
  return readStr(value)
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function flattenMeetingGroups(payload: unknown): UnknownRecord[] {
  if (Array.isArray(payload)) {
    if (payload.every((entry) => isRecord(entry) && Array.isArray(entry.meetings))) {
      return payload.flatMap((group) => asArray(group.meetings));
    }
    return payload.filter(isRecord);
  }
  if (isRecord(payload)) {
    if (Array.isArray(payload.meetings)) return payload.meetings.filter(isRecord);
    if (Array.isArray(payload.data)) return payload.data.filter(isRecord);
  }
  return [];
}

function normalizeMeetingKey(meeting: UnknownRecord) {
  return [
    normalize(meeting.title),
    readStr(meeting.starts_at),
    readStr(meeting.ends_at),
    normalize(meeting.location),
    normalize(meeting.mode),
  ].join("|");
}

function meetingSeriesKey(meeting: UnknownRecord) {
  return `${normalize(meeting.title)}|${normalize(meeting.mode || "minutes")}`;
}

function firstRecord(...values: unknown[]): UnknownRecord | null {
  for (const value of values) {
    if (isRecord(value)) return value;
  }
  return null;
}

function attendeeIdentity(attendee: UnknownRecord) {
  const nested = firstRecord(attendee.login_information, attendee.user, attendee.person, attendee.attendee);
  return {
    id: readStr(attendee.id || nested?.id),
    name: readStr(nested?.name || attendee.name || attendee.display_name),
    login: readStr(nested?.login || nested?.email || attendee.login || attendee.email || attendee.email_address),
    status: readStr(attendee.status),
  };
}

function normalizeAttendeeStatus(value: unknown): string {
  const normalized = normalize(value).replace(/\s+/g, "_");
  if (!normalized) return "";
  if (["present", "attended", "in_person"].includes(normalized)) return "present";
  if (["absent", "not_present"].includes(normalized)) return "absent";
  if (["for_distribution_only", "distribution_only", "fordistributiononly"].includes(normalized)) return "for_distribution_only";
  if (["conference", "remote", "virtual"].includes(normalized)) return "conference";
  return readStr(value);
}

function resolveTargetUserId(value: unknown, attendeeMap: Record<string, string>, targetUsers: TargetUserLookup[]) {
  const identity = readIdentity(value);
  const mapped = [
    attendeeMap[identity.id],
    attendeeMap[identity.name],
    attendeeMap[normalize(identity.name)],
    attendeeMap[identity.login],
    attendeeMap[normalize(identity.login)],
  ].find(Boolean);
  const mappedId = readNum(mapped);
  if (mappedId !== undefined) return mappedId;

  const normalizedLogin = normalize(identity.login);
  const normalizedName = normalize(identity.name);
  const normalizedId = normalize(identity.id);
  for (const user of targetUsers) {
    if ((normalizedId && normalize(user.id) === normalizedId) || (normalizedLogin && normalize(user.login) === normalizedLogin) || (normalizedName && normalize(user.name) === normalizedName)) {
      return user.id;
    }
  }
  return undefined;
}

async function getToken(bodyToken: unknown) {
  const cookieStore = await cookies();
  const explicitToken = readStr(bodyToken);
  const cookieToken = readStr(cookieStore.get("procore_access_token")?.value);
  if (explicitToken) return { accessToken: explicitToken, tokenSource: "body" as const };
  if (cookieToken) return { accessToken: cookieToken, tokenSource: "cookie" as const };
  return { accessToken: await getClientCredentialsToken(), tokenSource: "client_credentials" as const };
}

async function procoreJson(params: {
  accessToken: string;
  companyId: string;
  path: string;
  method?: string;
  body?: unknown;
  allowStatuses?: number[];
}) {
  const response = await fetch(`${procoreConfig.apiUrl}${params.path}`, {
    method: params.method || "GET",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      Accept: "application/json",
      ...(params.body === undefined ? {} : { "Content-Type": "application/json" }),
      "Procore-Company-Id": params.companyId,
    },
    body: params.body === undefined ? undefined : JSON.stringify(params.body),
    cache: "no-store",
  });

  const text = await response.text();
  let payload: unknown = text;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    // Keep text response.
  }

  if (!response.ok && !params.allowStatuses?.includes(response.status)) {
    throw new Error(`Procore ${params.method || "GET"} ${params.path} failed (${response.status}): ${typeof payload === "string" ? payload : JSON.stringify(payload)}`);
  }

  return { status: response.status, ok: response.ok, payload };
}

async function fetchPaged(params: {
  accessToken: string;
  companyId: string;
  path: string;
  keys?: string[];
  maxPages: number;
}) {
  const rows: UnknownRecord[] = [];
  for (let page = 1; page <= params.maxPages; page += 1) {
    const separator = params.path.includes("?") ? "&" : "?";
    const result = await procoreJson({
      accessToken: params.accessToken,
      companyId: params.companyId,
      path: `${params.path}${separator}page=${page}&per_page=100`,
    });
    const pageRows = asArray(result.payload, params.keys || []);
    if (!pageRows.length) break;
    rows.push(...pageRows);
    if (pageRows.length < 100) break;
  }
  return rows;
}

async function fetchAllMeetings(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  maxPages: number;
}) {
  const rows: UnknownRecord[] = [];
  for (let page = 1; page <= params.maxPages; page += 1) {
    const result = await procoreJson({
      accessToken: params.accessToken,
      companyId: params.companyId,
      path: `/rest/v1.1/projects/${encodeURIComponent(params.projectId)}/meetings?serializer_view=extended&page=${page}&per_page=100`,
    });
    const pageMeetings = flattenMeetingGroups(result.payload);
    if (!pageMeetings.length) break;
    rows.push(...pageMeetings);
    if (pageMeetings.length < 100) break;
  }
  return rows;
}

async function fetchMeetingDetail(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  meetingId: string;
}) {
  const result = await procoreJson({
    accessToken: params.accessToken,
    companyId: params.companyId,
    path: `/rest/v1.1/projects/${encodeURIComponent(params.projectId)}/meetings/${encodeURIComponent(params.meetingId)}`,
  });
  return isRecord(result.payload) ? result.payload : {};
}

async function fetchProjectUsers(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  maxPages: number;
}) {
  return fetchPaged({
    accessToken: params.accessToken,
    companyId: params.companyId,
    maxPages: params.maxPages,
    path: `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/users?company_id=${encodeURIComponent(params.companyId)}`,
  });
}

async function fetchCompanyUsers(params: { accessToken: string; companyId: string; maxPages: number }) {
  return fetchPaged({
    accessToken: params.accessToken,
    companyId: params.companyId,
    maxPages: params.maxPages,
    path: `/rest/v1.0/companies/${encodeURIComponent(params.companyId)}/users`,
  });
}

function buildTargetUsers(projectUsers: UnknownRecord[], companyUsers: UnknownRecord[]) {
  const users: TargetUserLookup[] = [];
  const seenIds = new Set<number>();
  for (const user of [...projectUsers, ...companyUsers]) {
    const id = readNum(user.id);
    if (id === undefined || seenIds.has(id)) continue;
    seenIds.add(id);
    users.push({
      id,
      login: readStr(user.login || user.email || user.email_address),
      name: readStr(user.name || `${readStr(user.first_name)} ${readStr(user.last_name)}`),
      source: projectUsers.some((item) => readNum(item.id) === id) ? "project_user" : "company_user",
    });
  }
  return users;
}

async function addCompanyUserToProject(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  userId: number;
}) {
  return procoreJson({
    accessToken: params.accessToken,
    companyId: params.companyId,
    path: `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/users/${encodeURIComponent(String(params.userId))}/actions/add`,
    method: "POST",
    body: { user: {} },
  });
}

async function createMeeting(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  payload: UnknownRecord;
}) {
  return procoreJson({
    accessToken: params.accessToken,
    companyId: params.companyId,
    path: `/rest/v1.1/projects/${encodeURIComponent(params.projectId)}/meetings`,
    method: "POST",
    body: { project_id: params.projectId, meeting: params.payload },
  });
}

function buildAgendaTopicPayload(topic: UnknownRecord) {
  return compactPayload({
    title: readStr(topic.title || topic.name || topic.subject || topic.description) || "Agenda Item",
    position: readNum(topic.position),
    due_date: readStr(topic.due_date),
    minutes: readStr(topic.minutes),
    note: readStr(topic.note || topic.notes),
    status: readStr(topic.status),
  });
}

function buildAgendaCategoryPayloads(meeting: UnknownRecord) {
  const categories = asArray(meeting.meeting_categories).map((category) => {
    const rawTopics = asArray(category.meeting_topics).length
      ? asArray(category.meeting_topics)
      : asArray(category.meeting_topic);
    const topics = rawTopics.map((topic) => buildAgendaTopicPayload(topic));
    return compactPayload({
      title: readStr(category.title || category.name) || "Uncategorized Items",
      position: readNum(category.position),
      meeting_topic: topics,
      meeting_topics: topics,
    });
  });

  return categories.filter((category) => {
    const title = readStr(category.title);
    const hasTopics = Array.isArray(category.meeting_topic) && category.meeting_topic.length > 0;
    return Boolean(title || hasTopics);
  });
}

async function cloneMeetingAgenda(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  targetMeetingId: number;
  sourceMeeting: UnknownRecord;
}) {
  const categoryPayloads = buildAgendaCategoryPayloads(params.sourceMeeting);
  const sourceTopicCount = categoryPayloads.reduce((sum, category) => {
    const topics = Array.isArray(category.meeting_topic) ? category.meeting_topic : [];
    return sum + topics.length;
  }, 0);

  if (!categoryPayloads.length || sourceTopicCount === 0) {
    return {
      ok: true,
      method: "none",
      sourceCategories: categoryPayloads.length,
      sourceTopics: sourceTopicCount,
      createdTopics: 0,
      createdCategories: 0,
      skipped: true,
    };
  }

  const patchAttempt = await procoreJson({
    accessToken: params.accessToken,
    companyId: params.companyId,
    path: `/rest/v1.1/projects/${encodeURIComponent(params.projectId)}/meetings/${encodeURIComponent(String(params.targetMeetingId))}`,
    method: "PATCH",
    body: {
      project_id: params.projectId,
      meeting: {
        meeting_categories: categoryPayloads,
      },
    },
    allowStatuses: [400, 404, 405, 422],
  });

  if (patchAttempt.ok) {
    return {
      ok: true,
      method: "patch_meeting_categories",
      sourceCategories: categoryPayloads.length,
      sourceTopics: sourceTopicCount,
      createdTopics: sourceTopicCount,
      createdCategories: categoryPayloads.length,
    };
  }

  const topicPaths = [
    `/rest/v1.1/projects/${encodeURIComponent(params.projectId)}/meetings/${encodeURIComponent(String(params.targetMeetingId))}/meeting_topics`,
    `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/meetings/${encodeURIComponent(String(params.targetMeetingId))}/meeting_topics`,
    `/rest/v1.1/projects/${encodeURIComponent(params.projectId)}/meetings/${encodeURIComponent(String(params.targetMeetingId))}/topics`,
  ];

  const topicErrors: UnknownRecord[] = [];
  let createdTopics = 0;
  for (const category of categoryPayloads) {
    const topics = Array.isArray(category.meeting_topic) ? category.meeting_topic : [];
    for (const topic of topics) {
      let created = false;
      for (const path of topicPaths) {
        const topicAttempt = await procoreJson({
          accessToken: params.accessToken,
          companyId: params.companyId,
          path,
          method: "POST",
          body: {
            meeting_topic: topic,
          },
          allowStatuses: [400, 404, 405, 422],
        });
        if (topicAttempt.ok) {
          createdTopics += 1;
          created = true;
          break;
        }
      }

      if (!created) {
        topicErrors.push({ topic, categoryTitle: readStr(category.title), error: "topic_create_not_supported" });
      }
    }
  }

  return {
    ok: topicErrors.length === 0,
    method: "topic_fallback",
    sourceCategories: categoryPayloads.length,
    sourceTopics: sourceTopicCount,
    createdTopics,
    createdCategories: 0,
    patchError: patchAttempt.payload,
    errors: topicErrors,
  };
}

async function cloneMeetingAttendance(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  targetMeetingId: number;
  mappedAttendance: Array<{ attendeeId: number; status: string }>;
}) {
  if (!params.mappedAttendance.length) {
    return {
      ok: true,
      method: "none",
      sourceAttendance: 0,
      appliedAttendance: 0,
      skipped: true,
    };
  }

  const patchBodyVariants = [
    {
      project_id: params.projectId,
      meeting: {
        attendees: params.mappedAttendance.map((entry) => entry.attendeeId),
        meeting_attendees: params.mappedAttendance.map((entry) => ({ id: entry.attendeeId, status: entry.status })),
      },
    },
    {
      project_id: params.projectId,
      meeting: {
        meeting_attendees: params.mappedAttendance.map((entry) => ({ attendee_id: entry.attendeeId, status: entry.status })),
      },
    },
    {
      project_id: params.projectId,
      meeting: {
        attendees_attributes: params.mappedAttendance.map((entry) => ({ id: entry.attendeeId, status: entry.status })),
      },
    },
  ];

  for (const body of patchBodyVariants) {
    const patchAttempt = await procoreJson({
      accessToken: params.accessToken,
      companyId: params.companyId,
      path: `/rest/v1.1/projects/${encodeURIComponent(params.projectId)}/meetings/${encodeURIComponent(String(params.targetMeetingId))}`,
      method: "PATCH",
      body,
      allowStatuses: [400, 404, 405, 422],
    });

    if (patchAttempt.ok) {
      return {
        ok: true,
        method: "patch_meeting_attendees",
        sourceAttendance: params.mappedAttendance.length,
        appliedAttendance: params.mappedAttendance.length,
      };
    }
  }

  const attendeePaths = [
    `/rest/v1.1/projects/${encodeURIComponent(params.projectId)}/meetings/${encodeURIComponent(String(params.targetMeetingId))}/meeting_attendees`,
    `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/meetings/${encodeURIComponent(String(params.targetMeetingId))}/meeting_attendees`,
  ];
  const attendeeBodyVariants = (entry: { attendeeId: number; status: string }) => [
    { meeting_attendee: { attendee_id: entry.attendeeId, status: entry.status } },
    { meeting_attendee: { user_id: entry.attendeeId, status: entry.status } },
    { meeting_attendee: { id: entry.attendeeId, status: entry.status } },
  ];

  const errors: UnknownRecord[] = [];
  let appliedAttendance = 0;
  for (const entry of params.mappedAttendance) {
    let applied = false;
    for (const path of attendeePaths) {
      for (const body of attendeeBodyVariants(entry)) {
        const attempt = await procoreJson({
          accessToken: params.accessToken,
          companyId: params.companyId,
          path,
          method: "POST",
          body,
          allowStatuses: [400, 404, 405, 422],
        });
        if (attempt.ok) {
          appliedAttendance += 1;
          applied = true;
          break;
        }
      }
      if (applied) break;
    }

    if (!applied) {
      errors.push({ attendeeId: entry.attendeeId, status: entry.status, error: "attendee_status_not_supported" });
    }
  }

  return {
    ok: errors.length === 0,
    method: "attendee_fallback",
    sourceAttendance: params.mappedAttendance.length,
    appliedAttendance,
    errors,
  };
}

function buildMeetingCloneRow(params: {
  meeting: UnknownRecord;
  attendeeMap: Record<string, string>;
  targetUsers: TargetUserLookup[];
  existingTargetKeys: Set<string>;
}) {
  const sourceAttendeesRaw = asArray(params.meeting.attendees);
  const sourceAttendees = sourceAttendeesRaw.map((attendee) => attendeeIdentity(attendee));
  const mappedAttendees = new Set<number>();
  const mappedAttendance = new Map<number, string>();
  const missingAttendees: Array<{ id: string; login: string; name: string }> = [];

  for (const attendee of sourceAttendees) {
    const targetId = resolveTargetUserId(attendee, params.attendeeMap, params.targetUsers);
    if (targetId !== undefined) {
      mappedAttendees.add(targetId);
      const normalizedStatus = normalizeAttendeeStatus(attendee.status);
      if (normalizedStatus && !mappedAttendance.has(targetId)) {
        mappedAttendance.set(targetId, normalizedStatus);
      }
    } else if (attendee.id || attendee.login || attendee.name) {
      missingAttendees.push({ id: attendee.id, login: attendee.login, name: attendee.name });
    }
  }

  const sourceTitle = readStr(params.meeting.title) || "Cloned Meeting";
  const sourceId = readStr(params.meeting.id);
  const rawParentId = readStr(params.meeting.parent_id || params.meeting.parentId || params.meeting.root_id || params.meeting.rootId);
  const sourceParentId = rawParentId && rawParentId !== sourceId ? rawParentId : "";
  const sourceStart = readStr(params.meeting.starts_at);
  const sourceEnd = readStr(params.meeting.ends_at);
  const payloadStart = sourceStart || MEETING_FALLBACK_START_DATETIME;
  const payloadEnd = sourceEnd || MEETING_FALLBACK_END_DATETIME;
  const sourceMode = readStr(params.meeting.mode) || "minutes";
  const seriesKey = `${normalize(sourceTitle)}|${normalize(sourceMode)}`;
  const sourcePosition = readNum(params.meeting.position) ?? null;
  const sourceTimeZone = readStr(params.meeting.time_zone);
  const payload = compactPayload({
    position: sourcePosition ?? undefined,
    title: sourceTitle,
    description: readStr(params.meeting.description),
    location: readStr(params.meeting.location),
    occurred: typeof params.meeting.occurred === "boolean" ? params.meeting.occurred : undefined,
    starts_at: payloadStart,
    ends_at: payloadEnd,
    time_zone: sourceTimeZone,
    is_private: typeof params.meeting.is_private === "boolean" ? params.meeting.is_private : undefined,
    is_draft: typeof params.meeting.is_draft === "boolean" ? params.meeting.is_draft : undefined,
    mode: sourceMode,
    minutes: readStr(params.meeting.minutes),
    overview: readStr(params.meeting.overview),
    conclusion: readStr(params.meeting.conclusion),
    remote_meeting_url: readStr(params.meeting.remote_meeting_url),
    attendees: mappedAttendees.size ? Array.from(mappedAttendees) : undefined,
  });

  const issues = [
    sourcePosition === null ? "missing_position" : "",
    sourceAttendees.length > 0 && missingAttendees.length > 0 ? "missing_target_attendees" : "",
  ].filter(Boolean);

  return {
    sourceId,
    sourceParentId,
    seriesKey,
    sourceTitle,
    sourceStart,
    sourceEnd,
    sourceMode,
    sourcePosition,
    sourceAttendees,
    mappedAttendees: Array.from(mappedAttendees),
    mappedAttendance: Array.from(mappedAttendance.entries()).map(([attendeeId, status]) => ({ attendeeId, status })),
    missingAttendees,
    existingTargetMeeting: params.existingTargetKeys.has(normalizeMeetingKey(params.meeting)),
    payload,
    issues,
  } satisfies MeetingCloneRow;
}

async function retryableCreate<T>(operation: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= maxAttempts || !/\((429|502|503|504)\)/.test(message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
  throw lastError;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as UnknownRecord;
    const { accessToken, tokenSource } = await getToken(body.accessToken);

    const sourceCompanyId = readStr(body.sourceCompanyId);
    const sourceProjectId = readStr(body.sourceProjectId);
    const targetCompanyId = readStr(body.targetCompanyId || body.companyId || procoreConfig.companyId);
    const targetProjectId = readStr(body.targetProjectId);
    const dryRun = body.dryRun !== false;
    const createOffset = Math.max(0, Math.trunc(readNum(body.createOffset) || 0));
    const createLimit = Math.max(1, Math.min(100, Math.trunc(readNum(body.createLimit) || (dryRun ? 100 : 10))));
    const maxPages = Math.max(1, Math.min(50, Math.trunc(readNum(body.maxPages) || 10)));
    const meetingIds = parseIds(body.meetingIds || body.meetingIdsText);
    const attendeeMap = buildStringMap(body.attendeeMap || body.attendeeMapText);

    if (!sourceCompanyId || !sourceProjectId || !targetCompanyId || !targetProjectId) {
      return NextResponse.json({ error: "Missing required fields: sourceCompanyId, sourceProjectId, targetCompanyId, targetProjectId." }, { status: 400 });
    }

    const [sourceMeetingsRaw, targetMeetingsRaw, projectUsers, companyUsers] = await Promise.all([
      fetchAllMeetings({ accessToken, companyId: sourceCompanyId, projectId: sourceProjectId, maxPages }),
      fetchAllMeetings({ accessToken, companyId: targetCompanyId, projectId: targetProjectId, maxPages }),
      fetchProjectUsers({ accessToken, companyId: targetCompanyId, projectId: targetProjectId, maxPages }),
      fetchCompanyUsers({ accessToken, companyId: targetCompanyId, maxPages: 5 }),
    ]);

    const sourceMeetings = sourceMeetingsRaw
      .filter((meeting) => (meetingIds.length === 0 ? true : meetingIds.includes(readStr(meeting.id))))
      .map((meeting) => readStr(meeting.id))
      .filter(Boolean);

    const sourceMeetingDetails = await Promise.all(
      sourceMeetings.map((meetingId) =>
        fetchMeetingDetail({ accessToken, companyId: sourceCompanyId, projectId: sourceProjectId, meetingId })
      )
    );

    const sourceMeetingById = new Map<string, UnknownRecord>();
    for (const meeting of sourceMeetingDetails) {
      const id = readStr(meeting.id);
      if (id) sourceMeetingById.set(id, meeting);
    }

    const targetMeetingIdByKey = new Map<string, number>();
    for (const meeting of targetMeetingsRaw) {
      const key = normalizeMeetingKey(meeting);
      const id = readNum(meeting.id);
      if (key && id !== undefined && !targetMeetingIdByKey.has(key)) {
        targetMeetingIdByKey.set(key, id);
      }
    }

    const targetSeriesRootByKey = new Map<string, number>();
    for (const meeting of targetMeetingsRaw) {
      const id = readNum(meeting.id);
      if (id === undefined) continue;
      const key = meetingSeriesKey(meeting);
      if (!key) continue;
      const parentId = readNum(meeting.parent_id || meeting.parentId);
      const isRoot = parentId === undefined || parentId === id;
      if (isRoot && !targetSeriesRootByKey.has(key)) {
        targetSeriesRootByKey.set(key, id);
      }
    }

    const targetUsers = buildTargetUsers(projectUsers, companyUsers);
    const existingTargetKeys = new Set(targetMeetingsRaw.map((meeting) => normalizeMeetingKey(meeting)));
    const meetingRows = sourceMeetingDetails.map((meeting) => buildMeetingCloneRow({
      meeting,
      attendeeMap,
      targetUsers,
      existingTargetKeys,
    }));

    const missingMappings = meetingRows.flatMap((row) => [
      ...(row.issues.includes("missing_position") ? [{ type: "meeting_position", sourceId: row.sourceId, title: row.sourceTitle }] : []),
      ...(row.issues.includes("missing_starts_at") ? [{ type: "meeting_starts_at", sourceId: row.sourceId, title: row.sourceTitle }] : []),
      ...(row.issues.includes("missing_ends_at") ? [{ type: "meeting_ends_at", sourceId: row.sourceId, title: row.sourceTitle }] : []),
      ...(row.issues.includes("missing_target_attendees")
        ? row.missingAttendees.map((attendee) => ({
            type: "meeting_attendee",
            sourceId: row.sourceId,
            title: row.sourceTitle,
            attendee,
          }))
        : []),
    ]);

    const createResults: UnknownRecord[] = [];
    let attemptedCreateRows = 0;
    let pausedBeforeTimeout = false;
    let pauseReason = "";
    const createStartedAt = Date.now();

    if (!dryRun) {
      const rowsToCreate = meetingRows
        .filter((row) => row.issues.length === 0 && !row.existingTargetMeeting)
        .sort((a, b) => (a.sourcePosition ?? Number.MAX_SAFE_INTEGER) - (b.sourcePosition ?? Number.MAX_SAFE_INTEGER));
      const slice = rowsToCreate.slice(createOffset, createOffset + createLimit);
      const addedProjectUserIds = new Set<number>();
      const createdTargetIdBySourceId = new Map<string, number>();
      const createdSeriesRootByKey = new Map<string, number>();

      for (const row of slice) {
        if (Date.now() - createStartedAt > 18000) {
          pausedBeforeTimeout = true;
          pauseReason = `Stopped before gateway timeout. Continue at create offset ${createOffset + attemptedCreateRows}.`;
          break;
        }

        try {
          attemptedCreateRows += 1;
          for (const attendeeId of row.mappedAttendees) {
            if (addedProjectUserIds.has(attendeeId)) continue;
            const projectUser = projectUsers.find((user) => readNum(user.id) === attendeeId);
            const companyUser = companyUsers.find((user) => readNum(user.id) === attendeeId);
            if (projectUser) {
              addedProjectUserIds.add(attendeeId);
              continue;
            }
            if (companyUser) {
              await retryableCreate(() =>
                addCompanyUserToProject({ accessToken, companyId: targetCompanyId, projectId: targetProjectId, userId: attendeeId })
              ).catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                if (!/already|taken|exists|has already/i.test(message)) throw error;
                return null;
              });
              addedProjectUserIds.add(attendeeId);
            }
          }

          const payload: UnknownRecord = { ...row.payload };
          let parentTargetId: number | undefined;
          if (row.sourceParentId) {
            parentTargetId = createdTargetIdBySourceId.get(row.sourceParentId);
            if (parentTargetId === undefined) {
              const sourceParent = sourceMeetingById.get(row.sourceParentId);
              if (sourceParent) {
                parentTargetId = targetMeetingIdByKey.get(normalizeMeetingKey(sourceParent));
              }
            }
          }

          if (parentTargetId === undefined) {
            parentTargetId = createdSeriesRootByKey.get(row.seriesKey);
          }

          if (parentTargetId === undefined) {
            parentTargetId = targetSeriesRootByKey.get(row.seriesKey);
          }

          if (parentTargetId !== undefined) {
            payload.parent_id = parentTargetId;
          }

          const result = await retryableCreate(() =>
            createMeeting({ accessToken, companyId: targetCompanyId, projectId: targetProjectId, payload })
          );
          const createdPayload = isRecord(result.payload) ? result.payload : {};
          const createdId = readNum(createdPayload.id || (isRecord(createdPayload.data) ? createdPayload.data.id : undefined));
          let agendaClone: UnknownRecord | null = null;
          let attendanceClone: UnknownRecord | null = null;
          if (createdId !== undefined) {
            createdTargetIdBySourceId.set(row.sourceId, createdId);
            if (!createdSeriesRootByKey.has(row.seriesKey)) {
              createdSeriesRootByKey.set(row.seriesKey, createdId);
            }
            if (!targetSeriesRootByKey.has(row.seriesKey)) {
              targetSeriesRootByKey.set(row.seriesKey, createdId);
            }
            const sourceMeeting = sourceMeetingById.get(row.sourceId);
            if (sourceMeeting) {
              agendaClone = await cloneMeetingAgenda({
                accessToken,
                companyId: targetCompanyId,
                projectId: targetProjectId,
                targetMeetingId: createdId,
                sourceMeeting,
              });
            }
            attendanceClone = await cloneMeetingAttendance({
              accessToken,
              companyId: targetCompanyId,
              projectId: targetProjectId,
              targetMeetingId: createdId,
              mappedAttendance: row.mappedAttendance,
            });
          }
          createResults.push({ type: "meeting", sourceId: row.sourceId, ok: true, result, agendaClone, attendanceClone });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          createResults.push({ type: "meeting", sourceId: row.sourceId, ok: false, error: message, payload: row.payload });
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    const created = createResults.filter((row) => row.ok === true).length;
    const failed = createResults.filter((row) => row.ok === false).length;
    const creatableMeetings = meetingRows.filter((row) => row.issues.length === 0 && !row.existingTargetMeeting).length;

    return NextResponse.json({
      success: dryRun ? true : failed === 0,
      dryRun,
      tokenSource,
      source: { companyId: sourceCompanyId, projectId: sourceProjectId },
      target: { companyId: targetCompanyId, projectId: targetProjectId },
      counts: {
        sourceMeetings: sourceMeetingDetails.length,
        mappedMeetings: meetingRows.filter((row) => row.issues.length === 0).length,
        creatableMeetings,
        skippedExistingMeetings: meetingRows.filter((row) => row.existingTargetMeeting).length,
        missingMappings: missingMappings.length,
        createOffset,
        createLimit,
        nextCreateOffset: dryRun ? null : createOffset + attemptedCreateRows,
        hasMoreCreatableRows: dryRun ? false : createOffset + attemptedCreateRows < creatableMeetings,
        pausedBeforeTimeout,
        created,
        failed,
      },
      readyForLiveClone: missingMappings.length === 0,
      diagnostics: {
        targetUsers: targetUsers.slice(0, 200),
        missingMappings,
      },
      meetings: meetingRows.map((row) => ({
        ...row,
        attachmentsCount: asArray(sourceMeetingDetails.find((meeting) => readStr(meeting.id) === row.sourceId)?.attachments).length,
        categoriesCount: asArray(sourceMeetingDetails.find((meeting) => readStr(meeting.id) === row.sourceId)?.meeting_categories).length,
      })),
      createResults,
      nextStep: dryRun
        ? "Review missingMappings. If readyForLiveClone is true, rerun with dryRun=false."
        : pauseReason
          ? pauseReason
          : failed
            ? "Some live creates failed. Review createResults before continuing."
            : missingMappings.length
              ? `Live clone completed for this batch, but ${missingMappings.length} row(s) still need mappings.`
              : "Live clone completed for this batch.",
    });
  } catch (error) {
    return NextResponse.json({ error: "Meeting clone failed.", details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
