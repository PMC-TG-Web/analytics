import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getClientCredentialsToken, procoreConfig } from "@/lib/procore";

export const dynamic = "force-dynamic";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown, keys: string[] = []): UnknownRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of ["data", ...keys]) {
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

function readBool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "0", "no", "n"].includes(normalized)) return false;
  }
  return fallback;
}

function normalize(value: unknown): string {
  return readStr(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function unwrapData(value: unknown): unknown {
  if (isRecord(value) && isRecord(value.data)) return value.data;
  return value;
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

function compactDeepPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map((entry) => compactDeepPayload(entry)).filter((entry) => {
      if (entry === undefined || entry === null || entry === "") return false;
      if (Array.isArray(entry)) return entry.length > 0;
      if (isRecord(entry)) return Object.keys(entry).length > 0;
      return true;
    });
    return items;
  }
  if (!isRecord(value)) return value;
  const out: UnknownRecord = {};
  for (const [key, entry] of Object.entries(value)) {
    const compacted = compactDeepPayload(entry);
    if (compacted === undefined || compacted === null || compacted === "") continue;
    if (Array.isArray(compacted) && compacted.length === 0) continue;
    if (isRecord(compacted) && Object.keys(compacted).length === 0) continue;
    out[key] = compacted;
  }
  return out;
}

function nestedRecord(value: unknown, key: string): UnknownRecord {
  return isRecord(value) && isRecord(value[key]) ? value[key] : {};
}

function parseIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(readStr).filter(Boolean);
  return readStr(value).split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
}

function buildStringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, mapValue] of Object.entries(value)) {
    const normalizedKey = readStr(key);
    const normalizedValue = readStr(mapValue);
    if (normalizedKey && normalizedValue) out[normalizedKey] = normalizedValue;
  }
  return out;
}

function buildDefaults(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function mapId(value: unknown, map: Record<string, string>) {
  const id = readStr(isRecord(value) ? value.id : value);
  if (!id) return undefined;
  const mapped = map[id] || map[normalize(isRecord(value) ? value.name : "")] || "";
  return readNum(mapped) ?? (mapped || undefined);
}

function readIdentity(value: unknown) {
  if (isRecord(value)) {
    return {
      id: readStr(value.id),
      name: readStr(value.name),
      login: readStr(value.login),
    };
  }
  const raw = readStr(value);
  return { id: raw, name: "", login: "" };
}

function resolveUserId(value: unknown, map: Record<string, string>, targetUsers: UnknownRecord[]) {
  const identity = readIdentity(value);
  const mappedFromMap = [
    map[identity.id],
    map[normalize(identity.name)],
    map[normalize(identity.login)],
  ].find(Boolean);
  const mappedId = readNum(mappedFromMap);
  if (mappedId !== undefined) return mappedId;

  const normalizedLogin = normalize(identity.login);
  const normalizedName = normalize(identity.name);
  if (!normalizedLogin && !normalizedName) return undefined;

  for (const user of targetUsers) {
    const userId = readNum(user.id);
    if (userId === undefined) continue;
    const userLogin = normalize(user.login);
    const userName = normalize(user.name);
    if ((normalizedLogin && userLogin === normalizedLogin) || (normalizedName && userName === normalizedName)) {
      return userId;
    }
  }
  return undefined;
}

function trimReference(value: string) {
  return value.length > 255 ? `${value.slice(0, 252)}...` : value;
}

function buildOriginalAuditReference(source: UnknownRecord, existingReference: string) {
  const createdBy = readStr(nestedRecord(source, "created_by").name ?? nestedRecord(source, "created_by").login);
  const initiatedAt = readStr(source.initiated_at ?? source.initiated_on ?? source.created_at);
  const sourceManager = readStr(nestedRecord(source, "rfi_manager").name ?? nestedRecord(source, "rfi_manager").login);
  const auditParts = [
    sourceManager ? `Orig Mgr: ${sourceManager}` : "",
    createdBy ? `Orig Created By: ${createdBy}` : "",
    initiatedAt ? `Orig Initiated: ${initiatedAt}` : "",
  ].filter(Boolean);
  if (auditParts.length === 0) return existingReference;
  const audit = auditParts.join(" | ");
  return trimReference(existingReference ? `${existingReference} | ${audit}` : audit);
}

function firstId(records: UnknownRecord[]) {
  for (const record of records) {
    const id = readNum(record.id);
    if (id !== undefined) return id;
  }
  return undefined;
}

function recordIds(records: UnknownRecord[]) {
  return records
    .map((record) => readNum(record.id))
    .filter((id) => id !== undefined);
}

function uniqNumIds(values: Array<number | undefined>) {
  return [...new Set(values.filter((value) => value !== undefined))];
}

function buildScheduleImpact(source: UnknownRecord) {
  const impact = source.schedule_impact;
  if (isRecord(impact)) {
    return compactPayload({
      status: readStr(impact.status).toLowerCase(),
      value: readNum(impact.value),
    });
  }
  const statusFromFields = readStr(source.schedule_impact_status).toLowerCase();
  if (statusFromFields) {
    return compactPayload({
      status: statusFromFields,
      value: readNum(source.schedule_impact_value),
    });
  }
  const statusFromText = readStr(impact).toLowerCase();
  if (statusFromText) {
    return compactPayload({ status: statusFromText });
  }
  return undefined;
}

function buildCostImpact(source: UnknownRecord) {
  const impact = source.cost_impact;
  if (isRecord(impact)) {
    return compactPayload({
      status: readStr(impact.status).toLowerCase(),
      value: readNum(impact.value),
    });
  }
  const statusFromFields = readStr(source.cost_impact_status).toLowerCase();
  if (statusFromFields) {
    return compactPayload({
      status: statusFromFields,
      value: readNum(source.cost_impact_value),
    });
  }
  const statusFromText = readStr(impact).toLowerCase();
  if (statusFromText) {
    return compactPayload({ status: statusFromText });
  }
  return undefined;
}

function buildTextFieldValue(value: unknown) {
  if (isRecord(value)) return readStr(value.value ?? value.text ?? value.body ?? value.name);
  return readStr(value);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function getToken(bodyToken: unknown) {
  const cookieStore = await cookies();
  const explicitToken = readStr(bodyToken);
  const cookieToken = readStr(cookieStore.get("procore_access_token")?.value);
  if (explicitToken) return { accessToken: explicitToken, tokenSource: "body" };
  if (cookieToken) return { accessToken: cookieToken, tokenSource: "cookie" };
  return { accessToken: await getClientCredentialsToken(), tokenSource: "client_credentials" };
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
  const maxRetries = params.maxRetries ?? (method === "GET" ? 1 : 4);
  let response: Response | undefined;
  let text = "";

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
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
    text = await response.text();
    if ((response.status !== 429 && response.status !== 502 && response.status !== 504) || attempt >= maxRetries) break;
    const retryAfter = Number(response.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * Math.pow(2, attempt);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  let payload: unknown = text;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    // Keep text.
  }

  if (!response) throw new Error(`Procore ${method} ${params.path} did not return a response.`);
  if (!response.ok && !params.allowStatuses?.includes(response.status)) {
    throw new Error(`Procore ${method} ${params.path} failed (${response.status}): ${safeJson(payload)}`);
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
  const errors: UnknownRecord[] = [];
  for (let page = 1; page <= params.maxPages; page += 1) {
    const separator = params.path.includes("?") ? "&" : "?";
    const path = `${params.path}${separator}page=${page}&per_page=100`;
    const response = await procoreJson({
      accessToken: params.accessToken,
      companyId: params.companyId,
      path,
      allowStatuses: [400, 403, 404, 405],
    });
    if (!response.ok) {
      errors.push({ path, status: response.status, response: response.payload });
      break;
    }
    const pageRows = asArray(response.payload, params.keys || []);
    rows.push(...pageRows);
    if (pageRows.length < 100) break;
  }
  return { rows, errors };
}

async function fetchRfis(params: { accessToken: string; companyId: string; projectId: string; maxPages: number }) {
  const paths = [
    `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/rfis`,
    `/rest/v1.0/rfis?project_id=${encodeURIComponent(params.projectId)}`,
  ];
  const errors: UnknownRecord[] = [];
  for (const path of paths) {
    const result = await fetchPaged({
      accessToken: params.accessToken,
      companyId: params.companyId,
      path,
      keys: ["rfis"],
      maxPages: params.maxPages,
    });
    errors.push(...result.errors);
    if (result.rows.length > 0 || result.errors.length === 0) return { rfis: result.rows, errors };
  }
  return { rfis: [] as UnknownRecord[], errors };
}

async function fetchRfi(params: { accessToken: string; companyId: string; projectId: string; rfiId: string }) {
  const paths = [
    `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/rfis/${encodeURIComponent(params.rfiId)}`,
    `/rest/v1.0/rfis/${encodeURIComponent(params.rfiId)}?project_id=${encodeURIComponent(params.projectId)}`,
  ];
  const attempts: UnknownRecord[] = [];
  for (const path of paths) {
    const response = await procoreJson({
      accessToken: params.accessToken,
      companyId: params.companyId,
      path,
      allowStatuses: [400, 403, 404, 405],
    });
    attempts.push({ path, status: response.status, ok: response.ok, response: response.payload });
    if (response.ok) return { rfi: isRecord(unwrapData(response.payload)) ? unwrapData(response.payload) as UnknownRecord : {}, attempts };
  }
  return { rfi: {}, attempts };
}

async function fetchRfiReplies(params: { accessToken: string; companyId: string; projectId: string; rfiId: string; maxPages: number }) {
  const paths = [
    `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/rfis/${encodeURIComponent(params.rfiId)}/replies`,
    `/rest/v1.0/rfis/${encodeURIComponent(params.rfiId)}/replies?project_id=${encodeURIComponent(params.projectId)}`,
  ];
  const errors: UnknownRecord[] = [];
  for (const path of paths) {
    const result = await fetchPaged({
      accessToken: params.accessToken,
      companyId: params.companyId,
      path,
      keys: ["replies", "rfi_replies"],
      maxPages: params.maxPages,
    });
    errors.push(...result.errors);
    if (result.rows.length > 0 || result.errors.length === 0) return { replies: result.rows, errors };
  }
  return { replies: [] as UnknownRecord[], errors };
}

async function fetchRfiHelperRows(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  endpoint: string;
  keys?: string[];
}) {
  const encodedProjectId = encodeURIComponent(params.projectId);
  const endpoint = params.endpoint.replace(/^\/+/, "");
  const paths = [
    `/rest/v1.0/projects/${encodedProjectId}/rfis/${endpoint}`,
    `/rest/v1.0/rfis/${endpoint}?project_id=${encodedProjectId}`,
  ];
  const attempts: UnknownRecord[] = [];
  for (const path of paths) {
    const response = await procoreJson({
      accessToken: params.accessToken,
      companyId: params.companyId,
      path,
      allowStatuses: [400, 403, 404, 405],
    });
    attempts.push({ endpoint, path, status: response.status, ok: response.ok, response: response.payload });
    if (response.ok) return { rows: asArray(response.payload, params.keys || []), attempts };
  }
  return { rows: [] as UnknownRecord[], attempts };
}

async function fetchRfiTargetSetup(params: { accessToken: string; companyId: string; projectId: string }) {
  const [potentialManagers, potentialAssignees, defaultDistribution, filterOptions] = await Promise.all([
    fetchRfiHelperRows({
      accessToken: params.accessToken,
      companyId: params.companyId,
      projectId: params.projectId,
      endpoint: "potential_rfi_managers",
      keys: ["potential_rfi_managers", "rfi_managers", "users"],
    }),
    fetchRfiHelperRows({
      accessToken: params.accessToken,
      companyId: params.companyId,
      projectId: params.projectId,
      endpoint: "potential_assignees",
      keys: ["potential_assignees", "assignees", "users"],
    }),
    fetchRfiHelperRows({
      accessToken: params.accessToken,
      companyId: params.companyId,
      projectId: params.projectId,
      endpoint: "default_distribution",
      keys: ["default_distribution", "distribution_members", "users"],
    }),
    fetchRfiHelperRows({
      accessToken: params.accessToken,
      companyId: params.companyId,
      projectId: params.projectId,
      endpoint: "filter_options",
      keys: ["filter_options", "statuses", "data"],
    }),
  ]);
  return {
    potentialManagers: potentialManagers.rows,
    potentialAssignees: potentialAssignees.rows,
    defaultDistribution: defaultDistribution.rows,
    filterOptions: filterOptions.rows,
    attempts: [
      ...potentialManagers.attempts,
      ...potentialAssignees.attempts,
      ...defaultDistribution.attempts,
      ...filterOptions.attempts,
    ],
  };
}

function rfiNumber(value: UnknownRecord) {
  return readStr(value.number ?? value.rfi_number);
}

function rfiSubject(value: UnknownRecord) {
  return readStr(value.subject ?? value.title);
}

function rfiQuestion(value: UnknownRecord) {
  const questionRows = asArray(value.questions ?? value.question_threads ?? value.rfi_questions);
  const firstQuestion = questionRows[0] ?? {};
  const questionFromRows = readStr(
    firstQuestion.rich_text_body ??
    firstQuestion.plain_text_body ??
    firstQuestion.body ??
    firstQuestion.html_body
  );
  if (questionFromRows) return questionFromRows;

  const nestedQuestion = isRecord(value.question)
    ? readStr(value.question.body ?? value.question.plain_text_body ?? value.question.html_body)
    : "";
  if (nestedQuestion) return nestedQuestion;

  const question = readStr(
    value.question ??
    value.body ??
    value.description ??
    value.plain_text_body ??
    value.html_body ??
    value.details
  );
  if (question) return question;
  const subject = rfiSubject(value);
  return subject ? subject : "Cloned RFI";
}

function rfiKey(value: UnknownRecord) {
  return `${normalize(rfiNumber(value))}|${normalize(rfiSubject(value))}`;
}

function offsetNumber(value: unknown, offset: number) {
  const text = readStr(value);
  if (!text || !offset || !/^\d+$/.test(text)) return text;
  return String(Number(text) + offset).padStart(text.length, "0");
}

function buildRfiPayload(params: {
  source: UnknownRecord;
  userIdMap: Record<string, string>;
  vendorIdMap: Record<string, string>;
  defaults: UnknownRecord;
  targetSetup: Awaited<ReturnType<typeof fetchRfiTargetSetup>>;
  preserveNumber: boolean;
  numberOffset: number;
  preserveStatus: boolean;
  issues: UnknownRecord[];
  sourceCompanyId: string;
  targetCompanyId: string;
}) {
  const source = params.source;
  const assigneeIds = asArray(source.assignees)
    .map((user) => resolveUserId(user, params.userIdMap, params.targetSetup.potentialAssignees))
    .filter((id) => id !== undefined);
  const distributionFromUsers = asArray(source.distribution_members ?? source.distribution_list)
    .map((user) => resolveUserId(user, params.userIdMap, [...params.targetSetup.potentialAssignees, ...params.targetSetup.defaultDistribution]))
    .filter((id) => id !== undefined);
  const distributionFromIds = parseIds(source.distribution_ids)
    .map((entry) => {
      const mapped = readNum(params.userIdMap[entry] || "");
      if (mapped !== undefined) return mapped;
      if (params.sourceCompanyId === params.targetCompanyId) return readNum(entry);
      return undefined;
    });
  const distributionIds = uniqNumIds([...distributionFromUsers, ...distributionFromIds]);
  const sourceManager = source.rfi_manager ?? source.manager ?? source.rfi_manager_id;
  const managerId = resolveUserId(sourceManager, params.userIdMap, params.targetSetup.potentialManagers);
  const ballInCourtId = resolveUserId(source.ball_in_court ?? source.ball_in_court_id, params.userIdMap, [
    ...params.targetSetup.potentialAssignees,
    ...params.targetSetup.potentialManagers,
  ]);
  const sourceReceivedFrom = source.received_from ?? source.received_from_id ?? source.received_from_login_information_id;
  const receivedFromId = resolveUserId(sourceReceivedFrom, params.userIdMap, [
    ...params.targetSetup.potentialAssignees,
    ...params.targetSetup.potentialManagers,
  ]);
  const defaultManagerId =
    readNum(params.defaults.rfiManagerId ?? params.defaults.defaultRfiManagerId) ??
    firstId(params.targetSetup.potentialManagers);
  const defaultAssigneeId =
    readNum(params.defaults.assigneeId ?? params.defaults.defaultAssigneeId) ??
    firstId(params.targetSetup.potentialAssignees);
  const defaultAssigneeIds = parseIds(params.defaults.assigneeIds ?? params.defaults.defaultAssigneeIds)
    .map((entry) => readNum(entry))
    .filter((id) => id !== undefined);
  if (defaultAssigneeIds.length === 0 && defaultAssigneeId !== undefined) defaultAssigneeIds.push(defaultAssigneeId);
  const defaultDistributionIds = recordIds(params.targetSetup.defaultDistribution);
  const responsibleContractor = source.responsible_contractor ?? source.responsible_contractor_id;
  const sourceResponsibleContractorId = readStr(isRecord(responsibleContractor) ? responsibleContractor.id : responsibleContractor);
  let responsibleContractorId =
    mapId(responsibleContractor, params.vendorIdMap) ??
    readNum(params.defaults.responsibleContractorId ?? params.defaults.defaultResponsibleContractorId);
  if (responsibleContractorId === undefined && params.sourceCompanyId === params.targetCompanyId) {
    responsibleContractorId = readNum(sourceResponsibleContractorId);
  }
  if (responsibleContractorId === undefined && sourceResponsibleContractorId) {
    params.issues.push({
      type: "missing_vendor_mapping",
      field: "responsible_contractor_id",
      oldId: sourceResponsibleContractorId,
      rfiId: readStr(source.id),
      rfiNumber: rfiNumber(source),
      subject: rfiSubject(source),
    });
  }

  if (managerId === undefined && readStr(isRecord(sourceManager) ? sourceManager.id ?? sourceManager.name ?? sourceManager.login : sourceManager)) {
    params.issues.push({
      type: "missing_user_mapping",
      field: "rfi_manager_id",
      oldId: readStr(isRecord(sourceManager) ? sourceManager.id : sourceManager),
      oldLogin: readStr(isRecord(sourceManager) ? sourceManager.login : ""),
      oldName: readStr(isRecord(sourceManager) ? sourceManager.name : ""),
      rfiId: readStr(source.id),
      rfiNumber: rfiNumber(source),
      subject: rfiSubject(source),
    });
  }

  const sourceReference = readStr(source.reference);
  const referenceWithAudit = buildOriginalAuditReference(source, sourceReference);
  const scheduleImpact = buildScheduleImpact(source);
  const costImpact = buildCostImpact(source);

  return compactPayload({
    number: params.preserveNumber ? rfiNumber(source) : offsetNumber(rfiNumber(source), params.numberOffset),
    subject: rfiSubject(source) || "Cloned RFI",
    question: compactPayload({ body: rfiQuestion(source) }),
    accepted: typeof source.accepted === "boolean" ? source.accepted : undefined,
    due_date: readStr(source.due_date),
    rfi_manager_id: managerId ?? defaultManagerId,
    ball_in_court_id: ballInCourtId,
    assignee_id: assigneeIds[0] ?? defaultAssigneeIds[0],
    assignee_ids: assigneeIds.length ? assigneeIds : defaultAssigneeIds,
    required_assignee_ids: assigneeIds.length ? assigneeIds : defaultAssigneeIds,
    distribution_ids: distributionIds.length ? distributionIds : defaultDistributionIds,
    received_from_login_information_id: receivedFromId,
    private: typeof source.private === "boolean" ? source.private : undefined,
    project_stage_id: readNum(nestedRecord(source, "project_stage").id ?? source.project_stage_id),
    schedule_impact: scheduleImpact,
    cost_impact: costImpact,
    drawing_number: readStr(source.drawing_number),
    specification_section_id: readNum(nestedRecord(source, "specification_section").id ?? source.specification_section_id),
    cost_code_id: readNum(nestedRecord(source, "cost_code").id ?? source.cost_code_id),
    sub_job_id: readNum(nestedRecord(source, "sub_job").id ?? source.sub_job_id),
    custom_textfield_1: buildTextFieldValue(source.custom_textfield_1),
    custom_textfield_2: buildTextFieldValue(source.custom_textfield_2),
    reference: referenceWithAudit,
    location_id: readNum(nestedRecord(source, "location").id ?? source.location_id),
    responsible_contractor_id: responsibleContractorId,
    draft: params.preserveStatus ? readStr(source.status).toLowerCase() === "draft" : undefined,
  });
}

function buildReplyPayload(reply: UnknownRecord, userIdMap: Record<string, string>) {
  return compactPayload({
    body: readStr(reply.body ?? reply.reply ?? reply.response ?? reply.plain_text_body ?? reply.html_body),
    plain_text_body: readStr(reply.plain_text_body),
    created_at: readStr(reply.created_at),
    user_id: mapId(reply.user ?? reply.created_by ?? reply.user_id, userIdMap),
    official: typeof reply.official === "boolean" ? reply.official : undefined,
  });
}

async function createRfi(params: { accessToken: string; companyId: string; projectId: string; payload: UnknownRecord }) {
  const question = isRecord(params.payload.question)
    ? compactPayload({ body: readStr(params.payload.question.body) })
    : compactPayload({ body: readStr(params.payload.question) });
  const basePayload = compactPayload({ ...params.payload, question });
  const minimalPayload = compactPayload({
    subject: basePayload.subject,
    question: basePayload.question,
    rfi_manager_id: basePayload.rfi_manager_id,
    responsible_contractor_id: basePayload.responsible_contractor_id,
    assignee_id: basePayload.assignee_id,
    assignee_ids: basePayload.assignee_ids,
    required_assignee_ids: basePayload.required_assignee_ids,
    distribution_ids: basePayload.distribution_ids,
    schedule_impact: basePayload.schedule_impact,
    private: basePayload.private,
    due_date: basePayload.due_date,
  });
  const requiredPayload = compactPayload({
    subject: basePayload.subject,
    question: basePayload.question,
    rfi_manager_id: basePayload.rfi_manager_id,
  });
  const payloads = [basePayload, minimalPayload, requiredPayload];
  const paths = [
    `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/rfis?run_configurable_validations=false`,
    `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/rfis`,
  ];
  const attempts: UnknownRecord[] = [];
  const seen = new Set<string>();

  for (const path of paths) {
    for (const rfiPayload of payloads) {
      const key = `${path}|${safeJson(rfiPayload)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      let responsePayload: unknown = null;
      let status = 0;
      let ok = false;
      try {
        const response = await fetch(`${procoreConfig.apiUrl}${path}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${params.accessToken}`,
            Accept: "application/json",
            "Content-Type": "application/json",
            "Procore-Company-Id": params.companyId,
          },
          body: JSON.stringify({ rfi: rfiPayload }),
          cache: "no-store",
        });
        status = response.status;
        ok = response.ok;
        const text = await response.text();
        try {
          responsePayload = text ? JSON.parse(text) : null;
        } catch {
          responsePayload = text;
        }
      } catch (error) {
        responsePayload = error instanceof Error ? error.message : String(error);
      }
      attempts.push({ path, body: { rfi: rfiPayload }, status, ok, response: responsePayload });
      if (ok) return { created: unwrapData(responsePayload), attempts };
    }
  }

  throw new Error(`RFI create failed: ${safeJson(attempts)}`);
}

async function updateRfiAfterCreate(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  rfiId: string;
  payload: UnknownRecord;
}) {
  const updatePayload = compactDeepPayload(params.payload);
  if (Object.keys(updatePayload).length === 0) return { skipped: true, attempts: [] as UnknownRecord[] };

  const paths = [
    `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/rfis/${encodeURIComponent(params.rfiId)}?run_configurable_validations=false`,
    `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/rfis/${encodeURIComponent(params.rfiId)}`,
  ];
  const attempts: UnknownRecord[] = [];
  for (const path of paths) {
    const response = await procoreJson({
      accessToken: params.accessToken,
      companyId: params.companyId,
      method: "PATCH",
      path,
      body: { rfi: updatePayload },
      allowStatuses: [400, 403, 404, 405, 409, 422],
    });
    attempts.push({ path, body: { rfi: updatePayload }, status: response.status, ok: response.ok, response: response.payload });
    if (response.ok) return { updated: unwrapData(response.payload), attempts };
  }
  return { error: `RFI post-create update failed: ${safeJson(attempts.slice(-2))}`, attempts };
}

async function createRfiReply(params: { accessToken: string; companyId: string; projectId: string; rfiId: string; payload: UnknownRecord }) {
  const bodies = [{ reply: params.payload }, { rfi_reply: params.payload }, params.payload];
  const paths = [
    `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/rfis/${encodeURIComponent(params.rfiId)}/replies`,
    `/rest/v1.0/rfis/${encodeURIComponent(params.rfiId)}/replies?project_id=${encodeURIComponent(params.projectId)}`,
  ];
  const attempts: UnknownRecord[] = [];
  for (const path of paths) {
    for (const body of bodies) {
      const response = await procoreJson({
        accessToken: params.accessToken,
        companyId: params.companyId,
        method: "POST",
        path,
        body,
        allowStatuses: [400, 403, 404, 405, 409, 422],
      });
      attempts.push({ path, body, status: response.status, ok: response.ok, response: response.payload });
      if (response.ok) return { created: unwrapData(response.payload), attempts };
    }
  }
  return { error: `RFI reply create failed: ${safeJson(attempts.slice(-4))}`, attempts };
}

async function recycleRfi(params: { accessToken: string; companyId: string; projectId: string; rfiId: string }) {
  const paths = [
    `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/rfis/${encodeURIComponent(params.rfiId)}/recycle`,
    `/rest/v1.1/projects/${encodeURIComponent(params.projectId)}/rfis/${encodeURIComponent(params.rfiId)}/recycle`,
  ];
  const attempts: UnknownRecord[] = [];
  for (const path of paths) {
    const response = await procoreJson({
      accessToken: params.accessToken,
      companyId: params.companyId,
      method: "PATCH",
      path,
      allowStatuses: [400, 403, 404, 405, 409, 422],
    });
    attempts.push({ path, status: response.status, ok: response.ok, response: response.payload });
    if (response.ok) return { recycled: true, attempts };
  }
  return { error: `RFI recycle failed: ${safeJson(attempts.slice(-2))}`, attempts };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as UnknownRecord;
    const { accessToken, tokenSource } = await getToken(body.accessToken);
    const sourceCompanyId = readStr(body.sourceCompanyId || body.companyId);
    const sourceProjectId = readStr(body.sourceProjectId || body.projectId);
    const targetCompanyId = readStr(body.targetCompanyId || procoreConfig.companyId);
    const targetProjectId = readStr(body.targetProjectId);
    const dryRun = readBool(body.dryRun, true);
    const cloneReplies = readBool(body.cloneReplies, true);
    const preserveNumber = readBool(body.preserveNumber, true);
    const preserveStatus = readBool(body.preserveStatus, false);
    const numberOffset = readNum(body.numberOffset) ?? 0;
    const createOffset = readNum(body.createOffset) ?? 0;
    const createLimit = Math.max(1, Math.min(100, readNum(body.createLimit) ?? 10));
    const maxPages = Math.max(1, Math.min(50, readNum(body.maxPages) ?? 10));
    const requestedRfiIds = new Set(parseIds(body.rfiIds));
    const userIdMap = buildStringMap(body.userIdMap);
    const vendorIdMap = buildStringMap(body.vendorIdMap);
    const rfiDefaults = buildDefaults(body.rfiDefaults);

    if (!sourceCompanyId || !sourceProjectId || !targetCompanyId || !targetProjectId) {
      return NextResponse.json(
        { success: false, error: "sourceCompanyId, sourceProjectId, targetCompanyId, and targetProjectId are required." },
        { status: 400 }
      );
    }

    const sourceFetch = await fetchRfis({ accessToken, companyId: sourceCompanyId, projectId: sourceProjectId, maxPages });
    const targetFetch = await fetchRfis({ accessToken, companyId: targetCompanyId, projectId: targetProjectId, maxPages });
    const targetSetup = await fetchRfiTargetSetup({ accessToken, companyId: targetCompanyId, projectId: targetProjectId });
    const selected = sourceFetch.rfis.filter((rfi) => requestedRfiIds.size === 0 || requestedRfiIds.has(readStr(rfi.id)));
    const sourceDetails: UnknownRecord[] = [];
    const fetchWarnings: UnknownRecord[] = [...sourceFetch.errors, ...targetFetch.errors, ...targetSetup.attempts.filter((attempt) => !attempt.ok)];

    for (const sourceRfi of selected) {
      const sourceId = readStr(sourceRfi.id);
      const detail = sourceId
        ? await fetchRfi({ accessToken, companyId: sourceCompanyId, projectId: sourceProjectId, rfiId: sourceId })
        : { rfi: sourceRfi, attempts: [] as UnknownRecord[] };
      const detailedRfi = Object.keys(detail.rfi).length ? detail.rfi : sourceRfi;
      const nestedReplies = asArray(detailedRfi.replies ?? detailedRfi.rfi_replies);
      const repliesFetch = cloneReplies && sourceId && nestedReplies.length === 0
        ? await fetchRfiReplies({ accessToken, companyId: sourceCompanyId, projectId: sourceProjectId, rfiId: sourceId, maxPages: 5 })
        : { replies: nestedReplies, errors: [] as UnknownRecord[] };
      fetchWarnings.push(...repliesFetch.errors);
      sourceDetails.push({ ...detailedRfi, _cloneReplies: repliesFetch.replies });
    }

    const targetKeys = new Set(targetFetch.rfis.map(rfiKey));
    const plan = sourceDetails.map((rfi) => {
      const issues: UnknownRecord[] = [];
      const payload = buildRfiPayload({
        source: rfi,
        userIdMap,
        vendorIdMap,
        defaults: rfiDefaults,
        targetSetup,
        preserveNumber,
        numberOffset,
        preserveStatus,
        issues,
        sourceCompanyId,
        targetCompanyId,
      });
      const simulatedTarget = { ...rfi, number: payload.number, subject: payload.subject };
      const duplicate = targetKeys.has(rfiKey(simulatedTarget as UnknownRecord));
      const replies = asArray(rfi._cloneReplies).map((reply) => buildReplyPayload(reply, userIdMap)).filter((reply) => readStr(reply.body || reply.plain_text_body));
      return {
        sourceRfiId: readStr(rfi.id),
        number: rfiNumber(rfi),
        subject: rfiSubject(rfi),
        duplicate,
        payload,
        issues,
        replies,
        replyCount: replies.length,
      };
    });
    const creatable = plan.filter((entry) => !entry.duplicate);
    const batch = dryRun ? [] : creatable.slice(createOffset, createOffset + createLimit);

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        tokenSource,
        readyForLiveClone: true,
        source: { companyId: sourceCompanyId, projectId: sourceProjectId },
        target: { companyId: targetCompanyId, projectId: targetProjectId },
        options: { cloneReplies, preserveNumber, preserveStatus, numberOffset, createOffset, createLimit },
        targetSetup: {
          potentialManagers: targetSetup.potentialManagers.slice(0, 10),
          potentialAssignees: targetSetup.potentialAssignees.slice(0, 10),
          defaultDistribution: targetSetup.defaultDistribution.slice(0, 10),
          filterOptions: targetSetup.filterOptions.slice(0, 10),
        },
        counts: {
          sourceRfis: selected.length,
          targetRfis: targetFetch.rfis.length,
          creatable: creatable.length,
          duplicates: plan.length - creatable.length,
          replies: plan.reduce((sum, entry) => sum + entry.replyCount, 0),
          missingVendorMappings: plan.reduce((sum, entry) => sum + asArray(entry.issues).length, 0),
        },
        fetchWarnings: fetchWarnings.slice(0, 20),
        plan,
      });
    }

    const createResults: UnknownRecord[] = [];
    for (const entry of batch) {
      try {
        const createResult = await createRfi({
          accessToken,
          companyId: targetCompanyId,
          projectId: targetProjectId,
          payload: entry.payload as UnknownRecord,
        });
        const createdRecord = isRecord(createResult.created) ? createResult.created : {};
        const targetRfiId = readStr(createdRecord.id);
        const updateResult = targetRfiId
          ? await updateRfiAfterCreate({
            accessToken,
            companyId: targetCompanyId,
            projectId: targetProjectId,
            rfiId: targetRfiId,
            payload: entry.payload as UnknownRecord,
          })
          : { skipped: true, attempts: [] as UnknownRecord[] };
        const replyResults = [];
        if (cloneReplies && targetRfiId) {
          for (const reply of asArray(entry.replies)) {
            const replyResult = await createRfiReply({
              accessToken,
              companyId: targetCompanyId,
              projectId: targetProjectId,
              rfiId: targetRfiId,
              payload: reply,
            });
            replyResults.push(replyResult);
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        }
        const recycleResult = targetRfiId
          ? await recycleRfi({
            accessToken,
            companyId: targetCompanyId,
            projectId: targetProjectId,
            rfiId: targetRfiId,
          })
          : { skipped: true, attempts: [] as UnknownRecord[] };
        createResults.push({
          sourceRfiId: entry.sourceRfiId,
          ok: true,
          targetRfiId,
          createAttempts: createResult.attempts,
          updateResult,
          recycleResult,
          replyResults,
        });
      } catch (error) {
        createResults.push({
          sourceRfiId: entry.sourceRfiId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          attemptedPayload: entry.payload,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }

    const errors = createResults.filter((entry) => !entry.ok);
    const nextCreateOffset = errors.length === 0 && createOffset + createLimit < creatable.length ? createOffset + createLimit : null;
    return NextResponse.json({
      success: errors.length === 0,
      dryRun: false,
      tokenSource,
      source: { companyId: sourceCompanyId, projectId: sourceProjectId },
      target: { companyId: targetCompanyId, projectId: targetProjectId },
      counts: {
        sourceRfis: selected.length,
        creatable: creatable.length,
        created: createResults.filter((entry) => entry.ok).length,
        failed: errors.length,
        createOffset,
        createLimit,
        nextCreateOffset,
      },
      createResults,
      errors,
      nextStep: nextCreateOffset !== null ? `Continue at createOffset ${nextCreateOffset}.` : "RFI clone batch complete.",
    }, { status: errors.length ? 207 : 200 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: `RFI clone failed: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
