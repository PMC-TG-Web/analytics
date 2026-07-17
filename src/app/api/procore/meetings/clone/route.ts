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

let procoreRequestStartChain: Promise<void> = Promise.resolve();
let lastProcoreRequestStartedAt = 0;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldPaceProcoreRequest(path: string, method: string) {
  if (method === "GET") return /\/meetings(?:[/?]|$)|\/users(?:[/?]|$)|\/meeting_(?:topics|categories)(?:[/?]|$)/i.test(path);
  return /\/meetings(?:[/?]|$)|\/meeting_(?:topics|categories)(?:[/?]|$)/i.test(path);
}

async function paceProcoreRequestStart(path: string, method: string) {
  if (!shouldPaceProcoreRequest(path, method)) return;

  const minGapMs = 320;
  const jitterMs = Math.floor(Math.random() * 90);

  let release: (() => void) | null = null;
  const previous = procoreRequestStartChain;
  procoreRequestStartChain = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  const waitForGap = Math.max(0, lastProcoreRequestStartedAt + minGapMs - Date.now());
  if (waitForGap > 0) {
    await sleep(waitForGap + jitterMs);
  }

  lastProcoreRequestStartedAt = Date.now();
  release?.();
}

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

function parseNumericIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => readNum(entry))
    .filter((entry): entry is number => entry !== undefined);
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
  maxRetries?: number;
}) {
  const method = params.method || "GET";
  const maxRetries = params.maxRetries ?? (method === "GET" ? 5 : 3);
  const retryableStatuses = new Set([429, 502, 503, 504]);

  let response: Response | null = null;
  let payload: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    await paceProcoreRequestStart(params.path, method);

    response = await fetch(`${procoreConfig.apiUrl}${params.path}`, {
      method,
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
    payload = text;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      // Keep text response.
    }

    const shouldRetry = retryableStatuses.has(response.status) && attempt < maxRetries;
    if (!shouldRetry) break;

    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
    const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : (method === "GET" ? 1000 : 1500) * Math.pow(2, attempt) + Math.floor(Math.random() * 300);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  if (!response) {
    throw new Error(`Procore ${method} ${params.path} failed: no response.`);
  }

  if (!response.ok && !params.allowStatuses?.includes(response.status)) {
    throw new Error(`Procore ${method} ${params.path} failed (${response.status}): ${typeof payload === "string" ? payload : JSON.stringify(payload)}`);
  }

  return { status: response.status, ok: response.ok, payload };
}

async function fetchAllMeetings(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  maxPages: number;
  maxRetries?: number;
}) {
  const rows: UnknownRecord[] = [];
  for (let page = 1; page <= params.maxPages; page += 1) {
    const result = await procoreJson({
      accessToken: params.accessToken,
      companyId: params.companyId,
      path: `/rest/v1.1/projects/${encodeURIComponent(params.projectId)}/meetings?serializer_view=extended&page=${page}&per_page=100`,
      maxRetries: params.maxRetries,
    });
    const pageMeetings = flattenMeetingGroups(result.payload);
    if (!pageMeetings.length) break;
    rows.push(...pageMeetings);
    if (pageMeetings.length < 100) break;
  }
  return rows;
}

function hasAgendaData(meeting: UnknownRecord): boolean {
  const categories = asArray(meeting.meeting_categories);
  const directTopics = [
    ...asArray(meeting.meeting_topics),
    ...asArray(meeting.meeting_topic),
    ...asArray(meeting.agenda_items),
    ...asArray(meeting.agenda_item),
    ...asArray(meeting.topics),
  ];

  if (directTopics.length > 0) return true;
  return categories.some((category) => {
    const topics = [
      ...asArray(category.meeting_topics),
      ...asArray(category.meeting_topic),
      ...asArray(category.agenda_items),
      ...asArray(category.agenda_item),
      ...asArray(category.topics),
    ];
    return topics.length > 0;
  });
}

async function fetchOptionalArray(params: {
  accessToken: string;
  companyId: string;
  path: string;
  keys?: string[];
}): Promise<UnknownRecord[]> {
  const result = await procoreJson({
    accessToken: params.accessToken,
    companyId: params.companyId,
    path: params.path,
    allowStatuses: [400, 404, 405, 422],
  });
  if (!result.ok) return [];
  return asArray(result.payload, params.keys || []);
}

function hydrateMeetingAgenda(meeting: UnknownRecord, categories: UnknownRecord[], topics: UnknownRecord[]): UnknownRecord {
  const hydrated: UnknownRecord = { ...meeting };

  if (categories.length > 0) {
    const topicsByCategoryId = new Map<string, UnknownRecord[]>();
    const unassignedTopics: UnknownRecord[] = [];

    for (const topic of topics) {
      const categoryId = readStr(topic.meeting_category_id || topic.category_id || topic.meetingCategoryId || topic.categoryId);
      if (!categoryId) {
        unassignedTopics.push(topic);
        continue;
      }
      const list = topicsByCategoryId.get(categoryId) || [];
      list.push(topic);
      topicsByCategoryId.set(categoryId, list);
    }

    hydrated.meeting_categories = categories.map((category) => {
      const categoryId = readStr(category.id);
      const categoryTopics = categoryId ? (topicsByCategoryId.get(categoryId) || []) : [];
      return {
        ...category,
        meeting_topics: categoryTopics,
      };
    });

    if (unassignedTopics.length > 0) {
      hydrated.meeting_topics = unassignedTopics;
    }

    return hydrated;
  }

  if (topics.length > 0) {
    hydrated.meeting_topics = topics;
  }

  return hydrated;
}

async function fetchMeetingDetail(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  meetingId: string;
}) {
  const detailPaths = [
    `/rest/v1.1/projects/${encodeURIComponent(params.projectId)}/meetings/${encodeURIComponent(params.meetingId)}?serializer_view=extended`,
    `/rest/v1.1/projects/${encodeURIComponent(params.projectId)}/meetings/${encodeURIComponent(params.meetingId)}`,
    `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/meetings/${encodeURIComponent(params.meetingId)}`,
  ];

  let meeting: UnknownRecord = {};
  for (const path of detailPaths) {
    const result = await procoreJson({
      accessToken: params.accessToken,
      companyId: params.companyId,
      path,
      allowStatuses: [404],
    });
    if (!result.ok) continue;
    if (isRecord(result.payload)) {
      meeting = result.payload;
      break;
    }
  }

  if (!isRecord(meeting) || Object.keys(meeting).length === 0) {
    return {};
  }

  if (hasAgendaData(meeting)) {
    return meeting;
  }

  const categoryPaths = [
    `/rest/v1.1/projects/${encodeURIComponent(params.projectId)}/meetings/${encodeURIComponent(params.meetingId)}/meeting_categories`,
    `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/meetings/${encodeURIComponent(params.meetingId)}/meeting_categories`,
    `/rest/v1.0/meeting_categories?project_id=${encodeURIComponent(params.projectId)}&meeting_id=${encodeURIComponent(params.meetingId)}`,
  ];
  let categories: UnknownRecord[] = [];
  for (const path of categoryPaths) {
    const rows = await fetchOptionalArray({
      accessToken: params.accessToken,
      companyId: params.companyId,
      path,
    });
    if (rows.length > 0) {
      categories = rows;
      break;
    }
  }

  const topicPaths = [
    `/rest/v1.1/projects/${encodeURIComponent(params.projectId)}/meetings/${encodeURIComponent(params.meetingId)}/meeting_topics`,
    `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/meetings/${encodeURIComponent(params.meetingId)}/meeting_topics`,
    `/rest/v1.1/projects/${encodeURIComponent(params.projectId)}/meetings/${encodeURIComponent(params.meetingId)}/topics`,
    `/rest/v1.1/projects/${encodeURIComponent(params.projectId)}/meetings/${encodeURIComponent(params.meetingId)}/agenda_items`,
    `/rest/v1.0/meeting_topics?project_id=${encodeURIComponent(params.projectId)}&meeting_id=${encodeURIComponent(params.meetingId)}`,
  ];
  let topics: UnknownRecord[] = [];
  for (const path of topicPaths) {
    const rows = await fetchOptionalArray({
      accessToken: params.accessToken,
      companyId: params.companyId,
      path,
    });
    if (rows.length > 0) {
      topics = rows;
      break;
    }
  }

  return hydrateMeetingAgenda(meeting, categories, topics);
}

function targetUserIdentity(user: UnknownRecord) {
  const nested = firstRecord(user.login_information, user.user, user.person);
  return {
    id: readNum(user.id || nested?.id),
    login: readStr(user.login || user.email || user.email_address || nested?.login || nested?.email || nested?.email_address),
    name: readStr(user.name || user.display_name || nested?.name || `${readStr(user.first_name)} ${readStr(user.last_name)}`),
  };
}

function exactUserMatches(rows: UnknownRecord[], attendee: { login: string; name: string }) {
  const normalizedLogin = normalize(attendee.login);
  const normalizedName = normalize(attendee.name);
  const loginMatches = normalizedLogin
    ? rows.filter((row) => normalize(targetUserIdentity(row).login) === normalizedLogin)
    : [];
  if (loginMatches.length === 1) return loginMatches;
  if (loginMatches.length > 1) return [];

  const nameMatches = normalizedName
    ? rows.filter((row) => normalize(targetUserIdentity(row).name) === normalizedName)
    : [];
  return nameMatches.length === 1 ? nameMatches : [];
}

async function searchTargetUsers(params: {
  accessToken: string;
  companyId: string;
  projectId?: string;
  attendee: { login: string; name: string };
}) {
  const search = params.attendee.login || params.attendee.name;
  if (!search) return [];

  const basePath = params.projectId
    ? `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/users`
    : `/rest/v1.3/companies/${encodeURIComponent(params.companyId)}/users`;
  const searchFilter = params.projectId && !params.attendee.login
    ? "filters[search_by_full_name]"
    : "filters[search]";
  const query = new URLSearchParams({
    ...(params.projectId ? { company_id: params.companyId } : {}),
    [searchFilter]: search,
    page: "1",
    per_page: "25",
  });
  const result = await procoreJson({
    accessToken: params.accessToken,
    companyId: params.companyId,
    maxRetries: 0,
    path: `${basePath}?${query.toString()}`,
  });
  return exactUserMatches(asArray(result.payload), params.attendee);
}

function buildTargetUsers(projectUsers: UnknownRecord[], companyUsers: UnknownRecord[]) {
  const users: TargetUserLookup[] = [];
  const seenIds = new Set<number>();
  for (const user of [...projectUsers, ...companyUsers]) {
    const identity = targetUserIdentity(user);
    const id = identity.id;
    if (id === undefined || seenIds.has(id)) continue;
    seenIds.add(id);
    users.push({
      id,
      login: identity.login,
      name: identity.name,
      source: projectUsers.some((item) => targetUserIdentity(item).id === id) ? "project_user" : "company_user",
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
    description: readStr(topic.description),
    due_date: readStr(topic.due_date),
    minutes: readStr(topic.minutes),
    status: readStr(topic.status),
    priority: readStr(topic.priority),
    closed_at: readStr(topic.closed_at),
    is_private: typeof topic.is_private === "boolean" ? topic.is_private : undefined,
    added_under_agenda: typeof topic.added_under_agenda === "boolean" ? topic.added_under_agenda : undefined,
    meeting_wide_number: readNum(topic.meeting_wide_number),
    assignment_ids: parseNumericIds(topic.assignment_ids),
    upload_ids: parseIds(topic.upload_ids),
  });
}

function agendaTopicKey(topic: UnknownRecord) {
  return [
    normalize(topic.title || topic.name || topic.subject || topic.description),
    normalize(topic.description),
    readStr(topic.meeting_wide_number),
    readStr(topic.due_date),
  ].join("|");
}

function collectAgendaCategories(meeting: UnknownRecord): UnknownRecord[] {
  const categorySources = [
    meeting.meeting_categories,
    meeting.agenda_categories,
    meeting.agenda_item_categories,
    meeting.meeting_agenda_categories,
    meeting.categories,
  ];

  const categories = categorySources.flatMap((source) => asArray(source));
  if (categories.length > 0) {
    return categories;
  }

  const directTopicSources = [
    meeting.meeting_topics,
    meeting.meeting_topic,
    meeting.agenda_items,
    meeting.agenda_item,
    meeting.topics,
    meeting.meeting_agenda_items,
    meeting.meeting_agenda_item,
  ];

  const directTopics = directTopicSources.flatMap((source) => asArray(source));
  if (directTopics.length === 0) {
    return [];
  }

  return [
    {
      title: "Agenda Items",
      position: undefined,
      meeting_topic: directTopics,
      meeting_topics: directTopics,
    },
  ];
}

function buildAgendaCategoryPayloads(meeting: UnknownRecord) {
  const categories = collectAgendaCategories(meeting).map((category) => {
    const rawTopics = [
      ...asArray(category.meeting_topics),
      ...asArray(category.meeting_topic),
      ...asArray(category.agenda_items),
      ...asArray(category.agenda_item),
      ...asArray(category.topics),
    ];
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
  existingTargetMeeting?: UnknownRecord;
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

  const topicErrors: UnknownRecord[] = [];
  let createdTopics = 0;
  let createdCategories = 0;
  let existingTopics = 0;
  const existingCategories = params.existingTargetMeeting
    ? collectAgendaCategories(params.existingTargetMeeting)
    : [];

  for (const category of categoryPayloads) {
    const topics = Array.isArray(category.meeting_topic) ? category.meeting_topic : [];
    const categoryTitle = readStr(category.title);
    const categoryPosition = readNum(category.position);
    const existingCategory = existingCategories.find((candidate) => (
      normalize(candidate.title || candidate.name) === normalize(categoryTitle) &&
      (categoryPosition === undefined || readNum(candidate.position) === categoryPosition)
    ));
    let targetCategoryId = readNum(existingCategory?.id);

    if (targetCategoryId === undefined) {
      const categoryAttempt = await procoreJson({
        accessToken: params.accessToken,
        companyId: params.companyId,
        path: "/rest/v1.0/meeting_categories",
        method: "POST",
        body: {
          project_id: params.projectId,
          meeting_id: params.targetMeetingId,
          meeting_category: compactPayload({ title: categoryTitle, position: categoryPosition }),
        },
        allowStatuses: [400, 404, 405, 422],
      });
      if (!categoryAttempt.ok) {
        topicErrors.push({ categoryTitle, error: "category_create_failed", response: categoryAttempt.payload });
        continue;
      }
      const payloadRecord = isRecord(categoryAttempt.payload) ? categoryAttempt.payload : null;
      const categoryRecord = payloadRecord ? firstRecord(payloadRecord.meeting_category, payloadRecord.data) : null;
      targetCategoryId = readNum(categoryRecord?.id || payloadRecord?.id);
      createdCategories += 1;
    }

    const existingTopicKeys = new Set([
      ...asArray(existingCategory?.meeting_topics),
      ...asArray(existingCategory?.meeting_topic),
      ...asArray(existingCategory?.agenda_items),
      ...asArray(existingCategory?.agenda_item),
      ...asArray(existingCategory?.topics),
    ].map(agendaTopicKey));

    for (const topic of topics) {
      const topicKey = agendaTopicKey(topic);
      if (existingTopicKeys.has(topicKey)) {
        existingTopics += 1;
        continue;
      }
      const topicWithCategory = compactPayload({
        ...topic,
        meeting_category_id: targetCategoryId,
      });
      const topicAttachmentIds = parseIds(topic.upload_ids || topic.attachments || topic.attachment_ids);
      const topicAttempt = await procoreJson({
        accessToken: params.accessToken,
        companyId: params.companyId,
        path: `/rest/v1.1/projects/${encodeURIComponent(params.projectId)}/meeting_topics`,
        method: "POST",
        body: {
          meeting_id: params.targetMeetingId,
          meeting_topic: topicWithCategory,
          ...(topicAttachmentIds.length > 0 ? { attachments: topicAttachmentIds } : {}),
        },
        allowStatuses: [400, 404, 405, 422],
      });
      if (topicAttempt.ok) {
        createdTopics += 1;
      } else {
        topicErrors.push({ topic, categoryTitle, error: "topic_create_failed", response: topicAttempt.payload });
      }
    }
  }

  return {
    ok: topicErrors.length === 0,
    method: "official_meeting_topic_endpoint",
    sourceCategories: categoryPayloads.length,
    sourceTopics: sourceTopicCount,
    createdTopics,
    createdCategories,
    existingTopics,
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
      // procoreJson already honored Retry-After/retried the HTTP request. Repeating
      // the whole create here turns one 429 into another burst of create attempts.
      if (/\(429\)/.test(message)) throw error;
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
    const updateExistingMeetings = body.updateExistingMeetings !== false;
    const createOffset = Math.max(0, Math.trunc(readNum(body.createOffset) || 0));
    const createLimit = Math.max(1, Math.min(100, Math.trunc(readNum(body.createLimit) || (dryRun ? 100 : 10))));
    const maxPages = Math.max(1, Math.min(50, Math.trunc(readNum(body.maxPages) || 10)));
    const meetingIds = parseIds(body.meetingIds || body.meetingIdsText);
    const attendeeMap = buildStringMap(body.attendeeMap || body.attendeeMapText);
    const cloneAttendees = body.cloneAttendees !== false;

    if (!sourceCompanyId || !sourceProjectId || !targetCompanyId || !targetProjectId) {
      return NextResponse.json({ error: "Missing required fields: sourceCompanyId, sourceProjectId, targetCompanyId, targetProjectId." }, { status: 400 });
    }

    let targetMeetingLookupWarning = "";
    let projectUserLookupWarning = "";
    let companyUserLookupWarning = "";

    // Fetch source meetings first; the clone cannot proceed without this data.
    const sourceMeetingsRaw = await fetchAllMeetings({ accessToken, companyId: sourceCompanyId, projectId: sourceProjectId, maxPages });

    // Target-side lookups are helpful but non-critical and frequently throttled.
    let targetMeetingsRaw: UnknownRecord[] = [];
    try {
      targetMeetingsRaw = await fetchAllMeetings({ accessToken, companyId: targetCompanyId, projectId: targetProjectId, maxPages, maxRetries: 0 });
    } catch (error) {
      targetMeetingLookupWarning = error instanceof Error ? error.message : String(error);
      targetMeetingsRaw = [];
    }

    if (/\(429\)/.test(targetMeetingLookupWarning)) {
      const selectedSourceMeetings = sourceMeetingsRaw.filter((meeting) => (
        meetingIds.length === 0 ? true : meetingIds.includes(readStr(meeting.id))
      ));
      return NextResponse.json({
        success: false,
        dryRun,
        tokenSource,
        error: "Target Procore rate limit is already exhausted.",
        details: targetMeetingLookupWarning,
        source: { companyId: sourceCompanyId, projectId: sourceProjectId },
        target: { companyId: targetCompanyId, projectId: targetProjectId },
        counts: {
          sourceMeetings: selectedSourceMeetings.length,
          createOffset,
          createLimit,
          nextCreateOffset: createOffset,
          hasMoreCreatableRows: selectedSourceMeetings.length > createOffset,
          created: 0,
          failed: 0,
        },
        readyForLiveClone: false,
        diagnostics: {
          cloneAttendees,
          targetUsers: [],
          missingMappings: [],
          warnings: [{ type: "target_meeting_lookup_rate_limited", message: targetMeetingLookupWarning }],
        },
        meetings: [],
        createResults: [],
        nextStep: `Wait for Procore's target-company rate limit to reset, then retry the same create offset (${createOffset}). No user-directory or create requests were attempted.`,
      }, { status: 429 });
    }

    const projectUsers: UnknownRecord[] = [];
    const companyUsers: UnknownRecord[] = [];
    let uniqueAttendeeLookups = 0;
    let targetedUserRequests = 0;

    const sourceMeetings = sourceMeetingsRaw
      .filter((meeting) => (meetingIds.length === 0 ? true : meetingIds.includes(readStr(meeting.id))))
      .map((meeting) => readStr(meeting.id))
      .filter(Boolean);

    const sourceMeetingDetails: UnknownRecord[] = [];
    for (const meetingId of sourceMeetings) {
      const detail = await fetchMeetingDetail({ accessToken, companyId: sourceCompanyId, projectId: sourceProjectId, meetingId });
      sourceMeetingDetails.push(detail);
    }

    const sourceMeetingById = new Map<string, UnknownRecord>();
    for (const meeting of sourceMeetingDetails) {
      const id = readStr(meeting.id);
      if (id) sourceMeetingById.set(id, meeting);
    }

    if (cloneAttendees) {
      const attendeesByKey = new Map<string, { id: string; login: string; name: string; status: string }>();
      for (const meeting of sourceMeetingDetails) {
        for (const rawAttendee of asArray(meeting.attendees)) {
          const attendee = attendeeIdentity(rawAttendee);
          const key = normalize(attendee.login) || normalize(attendee.name);
          if (!key || attendeesByKey.has(key)) continue;
          if (resolveTargetUserId(attendee, attendeeMap, []) !== undefined) continue;
          attendeesByKey.set(key, attendee);
        }
      }
      uniqueAttendeeLookups = attendeesByKey.size;

      for (const attendee of attendeesByKey.values()) {
        try {
          targetedUserRequests += 1;
          const projectMatches = await searchTargetUsers({
            accessToken,
            companyId: targetCompanyId,
            projectId: targetProjectId,
            attendee,
          });
          if (projectMatches.length === 1) {
            projectUsers.push(projectMatches[0]);
            continue;
          }
        } catch (error) {
          projectUserLookupWarning = error instanceof Error ? error.message : String(error);
          if (/\(429\)/.test(projectUserLookupWarning)) break;
        }

        try {
          targetedUserRequests += 1;
          const companyMatches = await searchTargetUsers({
            accessToken,
            companyId: targetCompanyId,
            attendee,
          });
          if (companyMatches.length === 1) companyUsers.push(companyMatches[0]);
        } catch (error) {
          companyUserLookupWarning = error instanceof Error ? error.message : String(error);
          if (/\(429\)/.test(companyUserLookupWarning)) break;
        }
      }
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
    const buildRows = (users: TargetUserLookup[]) => sourceMeetingDetails.map((meeting) => buildMeetingCloneRow({
      meeting,
      attendeeMap: cloneAttendees ? attendeeMap : {},
      targetUsers: users,
      existingTargetKeys,
    }));

    let meetingRows = buildRows(targetUsers);

    const attendeeLookupInterrupted = cloneAttendees && Boolean(projectUserLookupWarning || companyUserLookupWarning);
    if (!cloneAttendees) {
      meetingRows = meetingRows.map((row) => ({
        ...row,
        issues: row.issues.filter((issue) => issue !== "missing_target_attendees"),
      }));
    }

    const missingMappings = meetingRows.flatMap((row) => [
      ...(row.issues.includes("missing_position") ? [{ type: "meeting_position", sourceId: row.sourceId, title: row.sourceTitle }] : []),
      ...(row.issues.includes("missing_starts_at") ? [{ type: "meeting_starts_at", sourceId: row.sourceId, title: row.sourceTitle }] : []),
      ...(row.issues.includes("missing_ends_at") ? [{ type: "meeting_ends_at", sourceId: row.sourceId, title: row.sourceTitle }] : []),
      ...(cloneAttendees && row.issues.includes("missing_target_attendees")
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
    const eligibleRows = meetingRows
      .filter((row) => row.issues.length === 0)
      .sort((a, b) => (a.sourcePosition ?? Number.MAX_SAFE_INTEGER) - (b.sourcePosition ?? Number.MAX_SAFE_INTEGER));

    if (!dryRun) {
      // Slice the stable eligible list, including existing meetings. Filtering out
      // meetings created by a prior batch shifts indexes and silently skips rows.
      const slice = eligibleRows.slice(createOffset, createOffset + createLimit);
      const addedProjectUserIds = new Set<number>();
      const createdTargetIdBySourceId = new Map<string, number>();
      const createdSeriesRootByKey = new Map<string, number>();

      for (const row of slice) {
        if (Date.now() - createStartedAt > 18000) {
          pausedBeforeTimeout = true;
          pauseReason = `Stopped before gateway timeout. Continue at create offset ${createOffset + attemptedCreateRows}.`;
          break;
        }

        let targetMeetingIdForRow: number | undefined;
        try {
          for (const attendeeId of row.mappedAttendees) {
            if (addedProjectUserIds.has(attendeeId)) continue;
            const projectUser = projectUsers.find((user) => targetUserIdentity(user).id === attendeeId);
            if (projectUser) {
              addedProjectUserIds.add(attendeeId);
              continue;
            }

            await retryableCreate(() =>
              addCompanyUserToProject({ accessToken, companyId: targetCompanyId, projectId: targetProjectId, userId: attendeeId })
            ).catch((error) => {
              const message = error instanceof Error ? error.message : String(error);
              if (!/already|taken|exists|has already/i.test(message)) throw error;
              return null;
            });
            addedProjectUserIds.add(attendeeId);
          }

          const sourceMeeting = sourceMeetingById.get(row.sourceId);
          if (!sourceMeeting) throw new Error(`Source meeting ${row.sourceId} detail is unavailable.`);

          if (row.existingTargetMeeting) {
            targetMeetingIdForRow = targetMeetingIdByKey.get(normalizeMeetingKey(sourceMeeting));
            if (targetMeetingIdForRow === undefined) throw new Error(`Target meeting match for ${row.sourceId} is unavailable.`);
            createdTargetIdBySourceId.set(row.sourceId, targetMeetingIdForRow);

            let agendaClone: UnknownRecord | null = null;
            let attendanceClone: UnknownRecord | null = null;
            if (updateExistingMeetings) {
              const existingTargetMeeting = await fetchMeetingDetail({
                accessToken,
                companyId: targetCompanyId,
                projectId: targetProjectId,
                meetingId: String(targetMeetingIdForRow),
              });
              agendaClone = await retryableCreate(() => cloneMeetingAgenda({
                accessToken,
                companyId: targetCompanyId,
                projectId: targetProjectId,
                targetMeetingId: targetMeetingIdForRow as number,
                sourceMeeting,
                existingTargetMeeting,
              }));
              if (agendaClone.ok === false) throw new Error(`Agenda clone incomplete: ${JSON.stringify(agendaClone.errors || [])}`);
              attendanceClone = await retryableCreate(() => cloneMeetingAttendance({
                accessToken,
                companyId: targetCompanyId,
                projectId: targetProjectId,
                targetMeetingId: targetMeetingIdForRow as number,
                mappedAttendance: row.mappedAttendance,
              }));
            }

            createResults.push({
              type: "meeting_update_existing",
              sourceId: row.sourceId,
              targetMeetingId: targetMeetingIdForRow,
              ok: true,
              skipped: !updateExistingMeetings,
              agendaClone,
              attendanceClone,
            });
            attemptedCreateRows += 1;
            continue;
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
          targetMeetingIdForRow = createdId;
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
            agendaClone = await retryableCreate(() => cloneMeetingAgenda({
              accessToken,
              companyId: targetCompanyId,
              projectId: targetProjectId,
              targetMeetingId: createdId,
              sourceMeeting,
            }));
            if (agendaClone.ok === false) throw new Error(`Agenda clone incomplete: ${JSON.stringify(agendaClone.errors || [])}`);
            attendanceClone = await retryableCreate(() =>
              cloneMeetingAttendance({
                accessToken,
                companyId: targetCompanyId,
                projectId: targetProjectId,
                targetMeetingId: createdId,
                mappedAttendance: row.mappedAttendance,
              })
            );
          }
          createResults.push({ type: "meeting", sourceId: row.sourceId, ok: true, result, agendaClone, attendanceClone });
          attemptedCreateRows += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          createResults.push({ type: "meeting", sourceId: row.sourceId, targetMeetingId: targetMeetingIdForRow, ok: false, error: message, payload: row.payload });
          pauseReason = /\(429\)/.test(message)
            ? `Stopped after Procore rate limiting. Retry at create offset ${createOffset + attemptedCreateRows} after the limit resets.`
            : `Stopped after a meeting create failed. Retry at create offset ${createOffset + attemptedCreateRows}.`;
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    const created = createResults.filter((row) => row.ok === true && row.type === "meeting").length;
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
        hasMoreCreatableRows: dryRun ? false : createOffset + attemptedCreateRows < eligibleRows.length,
        pausedBeforeTimeout,
        created,
        failed,
      },
      readyForLiveClone: missingMappings.length === 0,
      diagnostics: {
        cloneAttendees,
        userLookupMode: cloneAttendees ? "targeted_exact_match" : "disabled",
        uniqueAttendeeLookups,
        targetedUserRequests,
        targetUsers: targetUsers.slice(0, 200),
        missingMappings,
        warnings: [
          ...(targetMeetingLookupWarning ? [{ type: "target_meeting_lookup_failed", message: targetMeetingLookupWarning }] : []),
          ...(projectUserLookupWarning ? [{ type: "project_user_lookup_failed", message: projectUserLookupWarning }] : []),
          ...(companyUserLookupWarning ? [{ type: "company_user_lookup_failed", message: companyUserLookupWarning }] : []),
          ...(!cloneAttendees && meetingRows.some((row) => row.sourceAttendees.length > 0)
            ? [{
                type: "attendee_cloning_disabled",
                message: "Attendees were skipped. Enable attendee cloning only when user-directory matching is required.",
              }]
            : []),
          ...(attendeeLookupInterrupted
            ? [{
                type: "attendee_mapping_incomplete_due_to_lookup_failure",
                message: "Targeted attendee matching was interrupted. Meetings with unresolved attendees remain blocked instead of silently dropping those attendees.",
              }]
            : []),
        ],
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
