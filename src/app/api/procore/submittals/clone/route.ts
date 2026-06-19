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

function offsetNumber(value: unknown, offset: number) {
  const text = readStr(value);
  if (!text || !offset || !/^\d+$/.test(text)) return text;
  return String(Number(text) + offset).padStart(text.length, "0");
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

async function fetchSubmittalPackages(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  maxPages: number;
}) {
  return fetchPaged({
    accessToken: params.accessToken,
    companyId: params.companyId,
    path: `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/submittal_packages`,
    keys: ["submittal_packages"],
    maxPages: params.maxPages,
  });
}

async function fetchSubmittals(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  maxPages: number;
}) {
  return fetchPaged({
    accessToken: params.accessToken,
    companyId: params.companyId,
    path: `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/submittals`,
    keys: ["submittals"],
    maxPages: params.maxPages,
  });
}

async function fetchSubmittal(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  submittalId: string;
}) {
  const payload = await procoreJson({
    accessToken: params.accessToken,
    companyId: params.companyId,
    path: `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/submittals/${encodeURIComponent(params.submittalId)}`,
  });
  return isRecord(payload) ? payload : {};
}

function packageKey(pkg: UnknownRecord) {
  return `${normalize(pkg.number)}|${normalize(pkg.title)}`;
}

function resolveTargetPackage(sourcePackage: UnknownRecord, targetPackages: UnknownRecord[], createdPackages: UnknownRecord[]) {
  const candidates = [...createdPackages, ...targetPackages];
  const sourceId = readStr(sourcePackage.id);
  const sourceNumber = normalize(sourcePackage.number);
  const sourceTitle = normalize(sourcePackage.title);
  return (
    candidates.find((pkg) => readStr(pkg.sourceId) === sourceId && sourceId) ||
    candidates.find((pkg) => packageKey(pkg) === packageKey(sourcePackage)) ||
    candidates.find((pkg) => normalize(pkg.number) === sourceNumber && sourceNumber) ||
    candidates.find((pkg) => normalize(pkg.title) === sourceTitle && sourceTitle)
  );
}

function responseId(value: unknown): string {
  if (isRecord(value)) {
    const direct = readStr(value.id);
    if (direct) return direct;
    const data = nestedRecord(value, "data");
    const dataId = readStr(data.id);
    if (dataId) return dataId;
    const pkg = nestedRecord(value, "submittal_package");
    const packageId = readStr(pkg.id);
    if (packageId) return packageId;
    const submittal = nestedRecord(value, "submittal");
    const submittalId = readStr(submittal.id);
    if (submittalId) return submittalId;
  }
  return "";
}

function buildPackagePayload(pkg: UnknownRecord, preserveNumber: boolean, numberOffset: number) {
  return compactPayload({
    number: preserveNumber ? offsetNumber(pkg.number, numberOffset) : undefined,
    title: readStr(pkg.title) || "Cloned Submittal Package",
    description: readStr(pkg.description),
    specification_section_id: readNum(pkg.specification_section_id),
  });
}

function buildSubmittalPayload(params: {
  submittal: UnknownRecord;
  targetPackageId?: string;
  preserveNumber: boolean;
  numberOffset: number;
  preserveStatus: boolean;
  typeIdMap: Record<string, string>;
  responsibleContractorIdMap: Record<string, string>;
  submittalManagerIdMap: Record<string, string>;
  defaultResponsibleContractorId: string;
  defaultSubmittalManagerId: string;
}) {
  const source = params.submittal;
  const type = nestedRecord(source, "type");
  const responsibleContractor = nestedRecord(source, "responsible_contractor");
  const submittalManager = nestedRecord(source, "submittal_manager");
  const status = nestedRecord(source, "status");
  const sourceTypeId = readStr(type.id);
  const sourceResponsibleContractorId = readStr(responsibleContractor.id);
  const sourceSubmittalManagerId = readStr(submittalManager.id);
  const mappedTypeId = readStr(params.typeIdMap[sourceTypeId] || params.typeIdMap[readStr(type.name)]);
  const mappedResponsibleContractorId = readStr(
    params.responsibleContractorIdMap[sourceResponsibleContractorId] ||
      params.responsibleContractorIdMap[readStr(responsibleContractor.name)] ||
      params.defaultResponsibleContractorId
  );
  const mappedSubmittalManagerId = readStr(
    params.submittalManagerIdMap[sourceSubmittalManagerId] ||
      params.submittalManagerIdMap[readStr(submittalManager.login)] ||
      params.submittalManagerIdMap[readStr(submittalManager.name)] ||
      params.defaultSubmittalManagerId
  );
  return compactPayload({
    number: params.preserveNumber ? offsetNumber(source.number, params.numberOffset) : undefined,
    revision: readStr(source.revision),
    title: readStr(source.title) || "Cloned Submittal",
    description: readStr(source.description),
    rich_text_description: readStr(source.rich_text_description),
    due_date: readStr(source.due_date),
    issue_date: readStr(source.issue_date),
    open_date: readStr(source.open_date),
    submit_by: readStr(source.submit_by),
    required_on_site_date: readStr(source.required_on_site_date),
    actual_delivery_date: readStr(source.actual_delivery_date),
    confirmed_delivery_date: readStr(source.confirmed_delivery_date),
    received_date: readStr(source.received_date),
    private: typeof source.private === "boolean" ? source.private : undefined,
    for_record_only: typeof source.for_record_only === "boolean" ? source.for_record_only : undefined,
    lead_time: readNum(source.lead_time),
    prepare_time: readNum(source.prepare_time),
    design_team_review_time: readNum(source.design_team_review_time),
    internal_review_time: readNum(source.internal_review_time),
    type_id: readNum(mappedTypeId),
    submittal_package_id: readNum(params.targetPackageId) || readStr(params.targetPackageId),
    responsible_contractor_id: readNum(mappedResponsibleContractorId),
    submittal_manager_id: readNum(mappedSubmittalManagerId),
    status_id: params.preserveStatus ? readNum(status.id) : undefined,
  });
}

async function createSubmittalPackage(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  payload: UnknownRecord;
}) {
  return procoreJson({
    accessToken: params.accessToken,
    companyId: params.companyId,
    method: "POST",
    path: `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/submittal_packages`,
    body: { submittal_package: params.payload },
  });
}

async function createSubmittal(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  payload: UnknownRecord;
}) {
  return procoreJson({
    accessToken: params.accessToken,
    companyId: params.companyId,
    method: "POST",
    path: `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/submittals`,
    body: { submittal: params.payload },
  });
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
    const preserveNumber = readBool(body.preserveNumber, true);
    const preserveStatus = readBool(body.preserveStatus, false);
    const numberOffset = Math.trunc(readNum(body.numberOffset) || 0);
    const clonePackages = readBool(body.clonePackages, true);
    const cloneSubmittals = readBool(body.cloneSubmittals, true);
    const submittalIds = new Set(parseIds(body.submittalIds || body.ids));
    const typeIdMap = buildStringMap(body.typeIdMap);
    const responsibleContractorIdMap = buildStringMap(body.responsibleContractorIdMap);
    const submittalManagerIdMap = buildStringMap(body.submittalManagerIdMap);
    const defaultResponsibleContractorId = readStr(body.defaultResponsibleContractorId);
    const defaultSubmittalManagerId = readStr(body.defaultSubmittalManagerId);

    if (!sourceCompanyId || !sourceProjectId || !targetCompanyId || !targetProjectId) {
      return NextResponse.json(
        { error: "Missing required fields: sourceCompanyId, sourceProjectId, targetCompanyId, targetProjectId." },
        { status: 400 }
      );
    }

    const [sourcePackagesRaw, targetPackages, sourceSubmittalsRaw] = await Promise.all([
      fetchSubmittalPackages({ accessToken, companyId: sourceCompanyId, projectId: sourceProjectId, maxPages }),
      fetchSubmittalPackages({ accessToken, companyId: targetCompanyId, projectId: targetProjectId, maxPages }),
      fetchSubmittals({ accessToken, companyId: sourceCompanyId, projectId: sourceProjectId, maxPages }),
    ]);

    const sourceSubmittalsList = submittalIds.size
      ? sourceSubmittalsRaw.filter((submittal) => submittalIds.has(readStr(submittal.id)) || submittalIds.has(readStr(submittal.number)))
      : sourceSubmittalsRaw;

    const sourceSubmittals = await Promise.all(
      sourceSubmittalsList.map((submittal) =>
        fetchSubmittal({ accessToken, companyId: sourceCompanyId, projectId: sourceProjectId, submittalId: readStr(submittal.id) })
      )
    );

    const sourcePackageIds = new Set(
      sourceSubmittals.map((submittal) => readStr(nestedRecord(submittal, "submittal_package").id)).filter(Boolean)
    );
    const sourcePackages = cloneSubmittals && sourcePackageIds.size
      ? sourcePackagesRaw.filter((pkg) => sourcePackageIds.has(readStr(pkg.id)))
      : sourcePackagesRaw;

    const packagePlan = sourcePackages.map((pkg) => {
      const existingTarget = resolveTargetPackage(pkg, targetPackages, []);
      return {
        sourceId: readStr(pkg.id),
        sourceNumber: readStr(pkg.number),
        targetNumber: preserveNumber ? offsetNumber(pkg.number, numberOffset) : "",
        title: readStr(pkg.title),
        existingTarget: existingTarget ? { id: readStr(existingTarget.id), number: readStr(existingTarget.number), title: readStr(existingTarget.title) } : null,
        payload: buildPackagePayload(pkg, preserveNumber, numberOffset),
        skipped: {
          attachments: nestedArray(pkg, "attachments"),
        },
      };
    });

    const createdOrPlannedPackages: UnknownRecord[] = packagePlan
      .filter((item) => item.existingTarget)
      .map((item) => ({ ...item.existingTarget, sourceId: item.sourceId }));

    const submittalPlan = sourceSubmittals.map((submittal) => {
      const sourcePackage = nestedRecord(submittal, "submittal_package");
      const targetPackage = sourcePackage.id ? resolveTargetPackage(sourcePackage, targetPackages, createdOrPlannedPackages) : null;
      return {
        sourceId: readStr(submittal.id),
        sourceNumber: readStr(submittal.number),
        targetNumber: preserveNumber ? offsetNumber(submittal.number, numberOffset) : "",
        title: readStr(submittal.title),
        revision: readStr(submittal.revision),
        sourcePackage: sourcePackage.id ? { id: readStr(sourcePackage.id), number: readStr(sourcePackage.number), title: readStr(sourcePackage.title) } : null,
        targetPackage: targetPackage ? { id: readStr(targetPackage.id), number: readStr(targetPackage.number), title: readStr(targetPackage.title) } : null,
        payload: buildSubmittalPayload({
          submittal,
          targetPackageId: readStr(targetPackage?.id),
          preserveNumber,
          numberOffset,
          preserveStatus,
          typeIdMap,
          responsibleContractorIdMap,
          submittalManagerIdMap,
          defaultResponsibleContractorId,
          defaultSubmittalManagerId,
        }),
        skipped: {
          attachments: nestedArray(submittal, "attachments"),
          approvers: nestedArray(submittal, "approvers"),
          distributionMembers: nestedArray(submittal, "distribution_members"),
          customFields: isRecord(submittal.custom_fields) ? Object.keys(submittal.custom_fields) : [],
          receivedFrom: nestedRecord(submittal, "received_from"),
          location: nestedRecord(submittal, "location"),
          costCode: nestedRecord(submittal, "cost_code"),
          type: typeIdMap[readStr(nestedRecord(submittal, "type").id)] ? null : nestedRecord(submittal, "type"),
          responsibleContractor:
            responsibleContractorIdMap[readStr(nestedRecord(submittal, "responsible_contractor").id)] || defaultResponsibleContractorId
              ? null
              : nestedRecord(submittal, "responsible_contractor"),
          submittalManager:
            submittalManagerIdMap[readStr(nestedRecord(submittal, "submittal_manager").id)] || defaultSubmittalManagerId
              ? null
              : nestedRecord(submittal, "submittal_manager"),
        },
      };
    });

    const missingMappings = submittalPlan
      .filter((item) => item.sourcePackage && !item.targetPackage && !clonePackages)
      .map((item) => ({
        type: "submittal_package",
        sourceSubmittalId: item.sourceId,
        sourceSubmittalNumber: item.sourceNumber,
        sourcePackage: item.sourcePackage,
        issue: "target_package_missing_and_package_clone_disabled",
      }));

    const createResults: UnknownRecord[] = [];
    const packageCreateResults: UnknownRecord[] = [];
    if (!dryRun && missingMappings.length === 0) {
      const createdPackages: UnknownRecord[] = [...createdOrPlannedPackages];
      if (clonePackages) {
        for (const item of packagePlan) {
          const alreadyTarget = resolveTargetPackage({ id: item.sourceId, number: item.targetNumber || item.sourceNumber, title: item.title }, targetPackages, createdPackages);
          if (alreadyTarget) {
            packageCreateResults.push({ sourceId: item.sourceId, ok: true, reused: true, targetId: readStr(alreadyTarget.id), payload: item.payload });
            createdPackages.push({ ...alreadyTarget, sourceId: item.sourceId });
            continue;
          }
          try {
            const created = await createSubmittalPackage({ accessToken, companyId: targetCompanyId, projectId: targetProjectId, payload: item.payload });
            const targetId = responseId(created);
            packageCreateResults.push({ sourceId: item.sourceId, ok: true, targetId, created, payload: item.payload });
            createdPackages.push({ ...item.payload, id: targetId, sourceId: item.sourceId });
          } catch (error) {
            packageCreateResults.push({
              sourceId: item.sourceId,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
              attemptedPayload: item.payload,
            });
          }
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }

      if (cloneSubmittals && packageCreateResults.every((result) => result.ok !== false)) {
        for (const item of submittalPlan.slice(createOffset, createOffset + createLimit)) {
          const sourcePackage = item.sourcePackage || {};
          const targetPackage = sourcePackage ? resolveTargetPackage(sourcePackage, targetPackages, createdPackages) : null;
          const payload = {
            ...(isRecord(item.payload) ? item.payload : {}),
            ...(targetPackage?.id ? { submittal_package_id: readNum(targetPackage.id) || readStr(targetPackage.id) } : {}),
          };
          try {
            const created = await createSubmittal({ accessToken, companyId: targetCompanyId, projectId: targetProjectId, payload });
            createResults.push({ sourceId: item.sourceId, sourceNumber: item.sourceNumber, ok: true, created, payload });
          } catch (error) {
            createResults.push({
              sourceId: item.sourceId,
              sourceNumber: item.sourceNumber,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
              attemptedPayload: payload,
            });
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }

    const failedPackages = packageCreateResults.filter((result) => result.ok === false);
    const failedSubmittals = createResults.filter((result) => result.ok === false);
    return NextResponse.json({
      success: dryRun ? true : failedPackages.length === 0 && failedSubmittals.length === 0,
      dryRun,
      tokenSource,
      source: { companyId: sourceCompanyId, projectId: sourceProjectId },
      target: { companyId: targetCompanyId, projectId: targetProjectId },
      options: {
        clonePackages,
        cloneSubmittals,
        preserveNumber,
        numberOffset,
        preserveStatus,
        createOffset,
        createLimit,
        mappedTypes: Object.keys(typeIdMap).length,
        mappedResponsibleContractors: Object.keys(responsibleContractorIdMap).length,
        mappedSubmittalManagers: Object.keys(submittalManagerIdMap).length,
        defaultResponsibleContractorId: defaultResponsibleContractorId || null,
        defaultSubmittalManagerId: defaultSubmittalManagerId || null,
      },
      counts: {
        sourcePackages: sourcePackages.length,
        sourceSubmittals: sourceSubmittals.length,
        targetPackages: targetPackages.length,
        missingMappings: missingMappings.length,
        createdPackages: packageCreateResults.filter((result) => result.ok === true && !result.reused).length,
        reusedPackages: packageCreateResults.filter((result) => result.reused).length,
        createdSubmittals: createResults.filter((result) => result.ok === true).length,
        failedPackages: failedPackages.length,
        failedSubmittals: failedSubmittals.length,
      },
      readyForLiveClone: missingMappings.length === 0,
      missingMappings,
      packagePlan,
      submittalPlan: submittalPlan.slice(0, 200),
      packageCreateResults,
      createResults,
      failedCreateResults: [...failedPackages, ...failedSubmittals],
      nextStep: dryRun
        ? "Review package/submittal payloads and skipped approvers/attachments/custom fields. If ready, run live clone."
        : failedPackages.length || failedSubmittals.length
          ? "Submittal clone finished with create errors."
          : "Submittal clone batch complete.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Submittal clone failed.", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
