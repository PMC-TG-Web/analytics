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

function nestedRecord(value: unknown, key: string): UnknownRecord {
  return isRecord(value) && isRecord(value[key]) ? value[key] : {};
}

function nestedArray(value: unknown, key: string): UnknownRecord[] {
  return isRecord(value) ? asArray(value[key]) : [];
}

function compactPayload(value: UnknownRecord) {
  const out: UnknownRecord = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || entry === null || entry === "") continue;
    if (isRecord(entry) && Object.keys(entry).length === 0) continue;
    out[key] = entry;
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
}) {
  const method = params.method || "GET";
  const response = await fetch(`${procoreConfig.apiUrl}${params.path}`, {
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
  let payload: unknown = text;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    // Keep text response.
  }

  if (!response.ok) {
    const message = typeof payload === "string" ? payload : JSON.stringify(payload);
    throw new Error(`Procore ${method} ${params.path} failed (${response.status}): ${message}`);
  }
  return payload;
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
    const payload = await procoreJson({
      accessToken: params.accessToken,
      companyId: params.companyId,
      path: `${params.path}${separator}page=${page}&per_page=100`,
    });
    const pageRows = asArray(payload, params.keys || []);
    rows.push(...pageRows);
    if (pageRows.length < 100) break;
  }
  return rows;
}

async function fetchTimeAndMaterialEntries(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  maxPages: number;
}) {
  return fetchPaged({
    accessToken: params.accessToken,
    companyId: params.companyId,
    path: `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/time_and_material_entries`,
    keys: ["time_and_material_entries"],
    maxPages: params.maxPages,
  });
}

async function fetchMaterials(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  timeAndMaterialEntryId: string;
  maxPages: number;
}) {
  return fetchPaged({
    accessToken: params.accessToken,
    companyId: params.companyId,
    path: `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/materials?time_and_material_entry_id=${encodeURIComponent(params.timeAndMaterialEntryId)}`,
    keys: ["materials"],
    maxPages: params.maxPages,
  });
}

async function fetchChangeEvents(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  maxPages: number;
}) {
  return fetchPaged({
    accessToken: params.accessToken,
    companyId: params.companyId,
    path: `/rest/v1.1/change_events?project_id=${encodeURIComponent(params.projectId)}`,
    maxPages: params.maxPages,
  });
}

async function fetchChangeEventStatuses(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
}) {
  return fetchPaged({
    accessToken: params.accessToken,
    companyId: params.companyId,
    path: `/rest/v1.1/change_events/statuses?project_id=${encodeURIComponent(params.projectId)}`,
    keys: ["statuses", "change_event_statuses"],
    maxPages: 5,
  });
}

function offsetNumber(value: unknown, offset: number) {
  const text = readStr(value);
  if (!text || !offset || !/^\d+$/.test(text)) return text;
  return String(Number(text) + offset).padStart(text.length, "0");
}

function sourceChangeEventNumber(entry: UnknownRecord) {
  const changeEvent = nestedRecord(entry, "change_event");
  const title = readStr(changeEvent.title);
  const match = title.match(/CE\s*#?(\d+)/i);
  return match?.[1] || "";
}

function targetEventKey(event: UnknownRecord) {
  return {
    number: readStr(event.number),
    title: normalize(event.title),
  };
}

function resolveTargetChangeEvent(entry: UnknownRecord, targetEvents: UnknownRecord[], numberOffset: number) {
  const changeEvent = nestedRecord(entry, "change_event");
  const sourceNumber = sourceChangeEventNumber(entry);
  const targetNumber = sourceNumber ? offsetNumber(sourceNumber, numberOffset) : "";
  const rawTitle = readStr(changeEvent.title).replace(/^CE\s*#?\d+\s*-\s*/i, "");
  const title = normalize(rawTitle || changeEvent.title);
  const found =
    (targetNumber ? targetEvents.find((event) => readStr(event.number) === targetNumber) : undefined) ||
    (title ? targetEvents.find((event) => targetEventKey(event).title === title) : undefined);
  return found
    ? { id: readNum(found.id) || readStr(found.id), number: readStr(found.number), title: readStr(found.title), strategy: targetNumber ? "number_offset" : "title" }
    : null;
}

function resolveTargetStatus(sourceStatus: UnknownRecord, targetStatuses: UnknownRecord[]) {
  const mapped = normalize(sourceStatus.mapped_to_status || sourceStatus.name);
  const name = normalize(sourceStatus.name);
  const target =
    targetStatuses.find((status) => normalize(status.mapped_to_status || status.name) === mapped && mapped) ||
    targetStatuses.find((status) => normalize(status.name) === name && name);
  return target ? { id: readNum(target.id) || readStr(target.id), name: readStr(target.name) } : null;
}

function buildTimeAndMaterialPayload(params: {
  entry: UnknownRecord;
  targetChangeEvent: UnknownRecord | null;
  targetStatus: UnknownRecord | null;
  orderedByIdMap: Record<string, string>;
  defaultOrderedById: string;
  preserveNumber: boolean;
  numberOffset: number;
}) {
  const orderedById = readStr(params.orderedByIdMap[readStr(params.entry.ordered_by_id)] || params.defaultOrderedById);
  const description = readStr(params.entry.description) || "Cloned T&M Entry";
  return compactPayload({
    number: params.preserveNumber ? readNum(offsetNumber(params.entry.number, params.numberOffset)) || offsetNumber(params.entry.number, params.numberOffset) : undefined,
    name: description,
    description,
    work_performed_on_date: readStr(params.entry.work_performed_on_date),
    reference_number: readStr(params.entry.reference_number),
    notes: readStr(params.entry.notes),
    private: typeof params.entry.private === "boolean" ? params.entry.private : undefined,
    status: readStr(params.entry.status),
    open: typeof params.entry.open === "boolean" ? params.entry.open : undefined,
    location_id: readNum(params.entry.location_id),
    ordered_by_id: readNum(orderedById) || undefined,
    change_event_id: readNum(params.targetChangeEvent?.id),
    change_event_status_id: readNum(params.targetStatus?.id),
  });
}

function buildMaterialPayload(material: UnknownRecord, targetTimeAndMaterialEntryId?: string | number) {
  return compactPayload({
    name: readStr(material.name),
    description: readStr(material.description),
    quantity: readNum(material.quantity),
    uom: readStr(material.uom),
    time_and_material_entry_id: readNum(targetTimeAndMaterialEntryId) || readStr(targetTimeAndMaterialEntryId),
  });
}

function buildSignatureClonePlan(entry: UnknownRecord) {
  return [
    { field: "company_signature_id", partyField: "company_signee_party_id", signature: nestedRecord(entry, "company_signature"), party: nestedRecord(entry, "company_signee_party") },
    { field: "customer_signature_id", partyField: "customer_signee_party_id", signature: nestedRecord(entry, "customer_signature"), party: nestedRecord(entry, "customer_signee_party") },
  ]
    .filter((item) => readStr(item.signature.id))
    .map((item) => {
      const signatureText = readStr(item.signature.signature_text);
      return {
        sourceSignatureId: readStr(item.signature.id),
        field: item.field,
        partyField: item.partyField,
        sourcePartyId: readStr(item.party.id),
        sourcePartyName: readStr(item.party.name),
        sourceFileName: readStr(item.signature.file_name),
        sourceUrl: readStr(item.signature.url),
        signatureText,
        cloneable: Boolean(signatureText),
        issue: signatureText ? null : "source_signature_is_image_file; text signature endpoint cannot recreate this without the image upload/capture payload",
      };
    });
}

function withoutKeys(payload: UnknownRecord, keys: string[]) {
  const out = { ...payload };
  for (const key of keys) delete out[key];
  return out;
}

function timeAndMaterialCreatePayloads(payload: UnknownRecord) {
  const attempts = [
    { name: "full", payload },
    {
      name: "without_state_fields",
      payload: withoutKeys(payload, ["status", "open", "change_event_status_id"]),
    },
    {
      name: "without_change_event",
      payload: withoutKeys(payload, ["status", "open", "change_event_status_id", "change_event_id"]),
    },
    {
      name: "minimal",
      payload: compactPayload({
        name: payload.name,
        description: payload.description,
        number: payload.number,
        work_performed_on_date: payload.work_performed_on_date,
        private: payload.private,
        reference_number: payload.reference_number,
      }),
    },
  ];

  const seen = new Set<string>();
  return attempts.filter((attempt) => {
    const key = JSON.stringify(attempt.payload);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function createTimeAndMaterialEntry(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  payload: UnknownRecord;
}) {
  return procoreJson({
    accessToken: params.accessToken,
    companyId: params.companyId,
    method: "POST",
    path: `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/time_and_material_entries`,
    body: { time_and_material_entry: params.payload },
  });
}

async function createMaterial(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  payload: UnknownRecord;
}) {
  return procoreJson({
    accessToken: params.accessToken,
    companyId: params.companyId,
    method: "POST",
    path: `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/materials`,
    body: { material: params.payload },
  });
}

async function createTimeAndMaterialSignature(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  payload: UnknownRecord;
}) {
  return procoreJson({
    accessToken: params.accessToken,
    companyId: params.companyId,
    method: "POST",
    path: `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/time_and_material_entries/signatures`,
    body: { signature: params.payload },
  });
}

async function createTimeAndMaterialSignatureWithFallback(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  sourceSignature: UnknownRecord;
}) {
  const signatureText = readStr(params.sourceSignature.signatureText);
  if (!signatureText) return null;
  const payload = compactPayload({
    signature_text: signatureText,
    file_name: readStr(params.sourceSignature.sourceFileName),
  });
  const attempts = [
    { name: "signature", body: { signature: payload } },
    { name: "time_and_material_signature", body: { time_and_material_signature: payload } },
    { name: "raw", body: payload },
  ];
  const errors: UnknownRecord[] = [];
  for (const attempt of attempts) {
    try {
      const response = await procoreJson({
        accessToken: params.accessToken,
        companyId: params.companyId,
        method: "POST",
        path: `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/time_and_material_entries/signatures`,
        body: attempt.body,
      });
      return { ok: true, successfulAttempt: attempt.name, payload: attempt.body, created: response };
    } catch (error) {
      errors.push({ name: attempt.name, payload: attempt.body, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { ok: false, errors };
}

async function createTimeAndMaterialEntryWithFallback(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  payload: UnknownRecord;
}) {
  const attempts: UnknownRecord[] = [];
  for (const attempt of timeAndMaterialCreatePayloads(params.payload)) {
    try {
      const created = await createTimeAndMaterialEntry({ ...params, payload: attempt.payload });
      return { created, successfulAttempt: attempt.name, successfulPayload: attempt.payload, attempts };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attempts.push({ name: attempt.name, ok: false, error: message, payload: attempt.payload });
      if (!/\(500\)|Internal Server Error/i.test(message)) break;
    }
  }
  const last = attempts[attempts.length - 1];
  throw new Error(readStr(last?.error) || "T&M create failed.");
}

function responseId(value: unknown): string {
  if (isRecord(value)) {
    const direct = readStr(value.id);
    if (direct) return direct;
    const data = nestedRecord(value, "data");
    const dataId = readStr(data.id);
    if (dataId) return dataId;
    const entry = nestedRecord(value, "time_and_material_entry");
    const entryId = readStr(entry.id);
    if (entryId) return entryId;
  }
  return "";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as UnknownRecord;
    const { accessToken, tokenSource } = await getToken(body.accessToken);

    const sourceCompanyId = readStr(body.sourceCompanyId || body.companyId);
    const sourceProjectId = readStr(body.sourceProjectId || body.projectId);
    const targetCompanyId = readStr(body.targetCompanyId || procoreConfig.companyId);
    const targetProjectId = readStr(body.targetProjectId);
    const dryRun = body.dryRun !== false;
    const createOffset = Math.max(0, Math.trunc(readNum(body.createOffset) || 0));
    const createLimit = Math.max(1, Math.min(100, Math.trunc(readNum(body.createLimit) || 25)));
    const maxPages = Math.max(1, Math.min(50, Math.trunc(readNum(body.maxPages) || 10)));
    const preserveNumber = readBool(body.preserveNumber, false);
    const numberOffset = Math.trunc(readNum(body.numberOffset) || 0);
    const timeAndMaterialIds = new Set(parseIds(body.timeAndMaterialIds || body.ids));
    const orderedByIdMap = buildStringMap(body.orderedByIdMap);
    const defaultOrderedById = readStr(body.defaultOrderedById);

    if (!sourceCompanyId || !sourceProjectId || !targetCompanyId || !targetProjectId) {
      return NextResponse.json(
        { error: "Missing required fields: sourceCompanyId, sourceProjectId, targetCompanyId, targetProjectId." },
        { status: 400 }
      );
    }

    const [sourceEntriesRaw, targetEvents, targetStatuses] = await Promise.all([
      fetchTimeAndMaterialEntries({ accessToken, companyId: sourceCompanyId, projectId: sourceProjectId, maxPages }),
      fetchChangeEvents({ accessToken, companyId: targetCompanyId, projectId: targetProjectId, maxPages: 50 }),
      fetchChangeEventStatuses({ accessToken, companyId: targetCompanyId, projectId: targetProjectId }),
    ]);
    const sourceEntries = timeAndMaterialIds.size
      ? sourceEntriesRaw.filter((entry) => timeAndMaterialIds.has(readStr(entry.id)) || timeAndMaterialIds.has(readStr(entry.number)))
      : sourceEntriesRaw;

    const sourceMaterialsByEntryId: Record<string, UnknownRecord[]> = {};
    await Promise.all(
      sourceEntries.map(async (entry) => {
        const sourceId = readStr(entry.id);
        if (!sourceId) return;
        sourceMaterialsByEntryId[sourceId] = await fetchMaterials({
          accessToken,
          companyId: sourceCompanyId,
          projectId: sourceProjectId,
          timeAndMaterialEntryId: sourceId,
          maxPages,
        });
      })
    );

    const missingMappings: UnknownRecord[] = [];
    const plan = sourceEntries.map((entry) => {
      const targetChangeEvent = resolveTargetChangeEvent(entry, targetEvents, numberOffset);
      const targetStatus = resolveTargetStatus(nestedRecord(entry, "change_event_status"), targetStatuses);
      const sourceId = readStr(entry.id);
      const sourceMaterials = sourceMaterialsByEntryId[sourceId] || [];
      if (readStr(nestedRecord(entry, "change_event").id) && !targetChangeEvent) {
        missingMappings.push({
          type: "time_and_material_change_event",
          sourceId,
          sourceNumber: readStr(entry.number),
          sourceChangeEvent: nestedRecord(entry, "change_event"),
          issue: "target_change_event_missing",
        });
      }
      if (readStr(nestedRecord(entry, "change_event_status").id) && !targetStatus) {
        missingMappings.push({
          type: "time_and_material_change_event_status",
          sourceId: readStr(entry.id),
          sourceNumber: readStr(entry.number),
          sourceStatus: nestedRecord(entry, "change_event_status"),
          issue: "target_status_missing",
        });
      }
      const payload = buildTimeAndMaterialPayload({
        entry,
        targetChangeEvent,
        targetStatus,
        orderedByIdMap,
        defaultOrderedById,
        preserveNumber,
        numberOffset,
      });
      return {
        sourceId,
        sourceNumber: readStr(entry.number),
        targetNumber: preserveNumber ? offsetNumber(entry.number, numberOffset) : "",
        description: readStr(entry.description),
        workPerformedOnDate: readStr(entry.work_performed_on_date),
        sourceChangeEvent: nestedRecord(entry, "change_event"),
        targetChangeEvent,
        sourceStatus: readStr(entry.status),
        sourceChangeEventStatus: nestedRecord(entry, "change_event_status"),
        targetStatus,
        materials: sourceMaterials.map((material) => ({
          sourceId: readStr(material.id),
          name: readStr(material.name),
          description: readStr(material.description),
          quantity: readNum(material.quantity),
          uom: readStr(material.uom),
          skippedCustomFields: isRecord(material.custom_fields) ? Object.keys(material.custom_fields) : [],
          payloadDraft: buildMaterialPayload(material),
        })),
        signatureClonePlan: buildSignatureClonePlan(entry),
        skipped: {
          companySignature: readStr(nestedRecord(entry, "company_signature").signature_text) ? null : nestedRecord(entry, "company_signature"),
          customerSignature: readStr(nestedRecord(entry, "customer_signature").signature_text) ? null : nestedRecord(entry, "customer_signature"),
          attachments: nestedArray(entry, "time_and_material_entry_attachments"),
          customFields: isRecord(entry.custom_fields) ? Object.keys(entry.custom_fields) : [],
        },
        payload,
      };
    });

    const createResults: UnknownRecord[] = [];
    if (!dryRun && missingMappings.length === 0) {
      for (const entry of plan.slice(createOffset, createOffset + createLimit)) {
        try {
          const signatureResults: UnknownRecord[] = [];
          const payload = isRecord(entry.payload) ? { ...entry.payload } : {};
          for (const signaturePlan of asArray(entry.signatureClonePlan)) {
            if (!signaturePlan.cloneable) {
              signatureResults.push({ ...signaturePlan, ok: false, skipped: true, issue: readStr(signaturePlan.issue) });
              continue;
            }
            const signatureResult = await createTimeAndMaterialSignatureWithFallback({
              accessToken,
              companyId: targetCompanyId,
              projectId: targetProjectId,
              sourceSignature: signaturePlan,
            });
            signatureResults.push({ ...signaturePlan, ...signatureResult });
            if (signatureResult?.ok && isRecord(signatureResult.created)) {
              const createdId = readNum(signatureResult.created.id) || readStr(signatureResult.created.id);
              if (createdId) payload[readStr(signaturePlan.field)] = createdId;
              const partyId = readNum(signaturePlan.sourcePartyId);
              if (partyId) payload[readStr(signaturePlan.partyField)] = partyId;
            }
          }
          const created = await createTimeAndMaterialEntryWithFallback({
            accessToken,
            companyId: targetCompanyId,
            projectId: targetProjectId,
            payload,
          });
          const createdEntryId = responseId(created.created);
          const materialResults: UnknownRecord[] = [];
          for (const material of asArray(entry.materials)) {
            const materialPayload = buildMaterialPayload(material, createdEntryId);
            if (!createdEntryId) {
              materialResults.push({ sourceId: material.sourceId, ok: false, skipped: true, error: "Created T&M entry response did not include an id.", attemptedPayload: materialPayload });
              continue;
            }
            try {
              const createdMaterial = await createMaterial({
                accessToken,
                companyId: targetCompanyId,
                projectId: targetProjectId,
                payload: materialPayload,
              });
              materialResults.push({ sourceId: material.sourceId, ok: true, created: createdMaterial, payload: materialPayload });
            } catch (error) {
              materialResults.push({
                sourceId: material.sourceId,
                ok: false,
                error: error instanceof Error ? error.message : String(error),
                attemptedPayload: materialPayload,
              });
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          createResults.push({ sourceId: entry.sourceId, sourceNumber: entry.sourceNumber, ok: materialResults.every((result) => result.ok !== false), signatureResults, materialResults, ...created });
        } catch (error) {
          createResults.push({
            sourceId: entry.sourceId,
            sourceNumber: entry.sourceNumber,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            attemptedPayload: entry.payload,
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    const failed = createResults.filter((result) => result.ok === false);
    return NextResponse.json({
      success: dryRun ? true : failed.length === 0,
      dryRun,
      tokenSource,
      source: { companyId: sourceCompanyId, projectId: sourceProjectId },
      target: { companyId: targetCompanyId, projectId: targetProjectId },
      options: { preserveNumber, numberOffset, createOffset, createLimit },
      counts: {
        sourceEntries: sourceEntries.length,
        targetChangeEvents: targetEvents.length,
        targetStatuses: targetStatuses.length,
        sourceMaterials: Object.values(sourceMaterialsByEntryId).reduce((sum, rows) => sum + rows.length, 0),
        missingMappings: missingMappings.length,
        created: createResults.filter((result) => result.ok === true).length,
        failed: failed.length,
      },
      readyForLiveClone: missingMappings.length === 0,
      missingMappings,
      plan: plan.slice(0, 200),
      createResults,
      failedCreateResults: failed,
      nextStep: dryRun
        ? "Review plan and skipped signatures/attachments/custom fields. If ready, rerun live."
        : failed.length
          ? "Some T&M entries failed. Review createResults."
          : "T&M clone batch complete.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Time and Material clone failed.", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
