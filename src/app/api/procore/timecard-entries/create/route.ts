import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getClientCredentialsToken, procoreConfig } from "@/lib/procore";

type UnknownRecord = Record<string, unknown>;

type AncestryValidationResult = {
  ok: boolean;
  checks: {
    party_id?: { provided: number; valid: boolean; source?: string };
    timecard_time_type_id?: { provided: number; valid: boolean };
    cost_code_id?: { provided: number; valid: boolean };
  };
  details: string[];
};

const ANCESTRY_SENSITIVE_OPTIONAL_FIELDS = [
  "timesheet_id",
  "sub_job_id",
  "location_id",
  "login_information_id",
  "origin_id",
  "line_item_type_id",
  "daily_log_segment_id",
] as const;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStr(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return "";
}

function readBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const token = value.trim().toLowerCase();
    if (["true", "yes", "y", "1"].includes(token)) return true;
    if (["false", "no", "n", "0"].includes(token)) return false;
  }
  return undefined;
}

function readInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function readNumeric(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeTimecardEntry(value: unknown): UnknownRecord | null {
  if (!isRecord(value)) return null;

  const input: UnknownRecord = { ...value };
  if (input.timecard_time_type_id === undefined && input.timecardTimeTypeId !== undefined) {
    input.timecard_time_type_id = input.timecardTimeTypeId;
  }
  if (input.party_id === undefined && input.partyId !== undefined) {
    input.party_id = input.partyId;
  }
  if (input.cost_code_id === undefined && input.costCodeId !== undefined) {
    input.cost_code_id = input.costCodeId;
  }
  if (input.lunch_time === undefined && input.lunchTime !== undefined) {
    input.lunch_time = input.lunchTime;
  }
  if (input.time_in === undefined && input.timeIn !== undefined) {
    input.time_in = input.timeIn;
  }
  if (input.time_out === undefined && input.timeOut !== undefined) {
    input.time_out = input.timeOut;
  }
  if (input.timesheet_id === undefined && input.timesheetId !== undefined) {
    input.timesheet_id = input.timesheetId;
  }
  if (input.sub_job_id === undefined && input.subJobId !== undefined) {
    input.sub_job_id = input.subJobId;
  }
  if (input.location_id === undefined && input.locationId !== undefined) {
    input.location_id = input.locationId;
  }
  if (input.login_information_id === undefined && input.loginInformationId !== undefined) {
    input.login_information_id = input.loginInformationId;
  }
  if (input.origin_id === undefined && input.originId !== undefined) {
    input.origin_id = input.originId;
  }
  if (input.origin_data === undefined && input.originData !== undefined) {
    input.origin_data = input.originData;
  }
  if (input.line_item_type_id === undefined && input.lineItemTypeId !== undefined) {
    input.line_item_type_id = input.lineItemTypeId;
  }
  if (input.daily_log_segment_id === undefined && input.dailyLogSegmentId !== undefined) {
    input.daily_log_segment_id = input.dailyLogSegmentId;
  }

  const output: UnknownRecord = {};
  const originDataDebug = readStr(input.origin_data);

  const date = readStr(input.date);
  const description = readStr(input.description);
  const billable = readBool(input.billable);
  const hours = readNumeric(input.hours);
  const lunchTime = readNumeric(input.lunch_time);
  const partyId = readInt(input.party_id);
  const timeIn = readStr(input.time_in);
  const timeOut = readStr(input.time_out);
  const timecardTimeTypeId = readInt(input.timecard_time_type_id);
  const timesheetId = readInt(input.timesheet_id);
  const costCodeId = readInt(input.cost_code_id);
  const subJobId = readInt(input.sub_job_id);
  const locationId = readInt(input.location_id);
  const loginInformationId = readInt(input.login_information_id);
  const originId = readInt(input.origin_id);
  const originData = readStr(input.origin_data);
  const lineItemTypeId = readInt(input.line_item_type_id);
  const dailyLogSegmentId = readInt(input.daily_log_segment_id);

  if (date) output.date = date;
  if (description) output.description = description;
  if (billable !== undefined) output.billable = billable;
  if (hours !== undefined) output.hours = hours;
  if (lunchTime !== undefined) output.lunch_time = lunchTime;
  if (partyId !== undefined) output.party_id = partyId;
  if (timeIn) output.time_in = timeIn;
  if (timeOut) output.time_out = timeOut;
  if (timecardTimeTypeId !== undefined) output.timecard_time_type_id = timecardTimeTypeId;
  if (timesheetId !== undefined) output.timesheet_id = timesheetId;
  if (costCodeId !== undefined) output.cost_code_id = costCodeId;
  if (subJobId !== undefined) output.sub_job_id = subJobId;
  if (locationId !== undefined) output.location_id = locationId;
  if (loginInformationId !== undefined) output.login_information_id = loginInformationId;
  if (originId !== undefined) output.origin_id = originId;
  if (lineItemTypeId !== undefined) output.line_item_type_id = lineItemTypeId;
  if (dailyLogSegmentId !== undefined) output.daily_log_segment_id = dailyLogSegmentId;

  if (originDataDebug) {
    Object.defineProperty(output, "_origin_data", {
      value: originDataDebug,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }

  return Object.keys(output).length > 0 ? output : null;
}

function hasAncestryMismatchError(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const errors = value.errors;
  if (!isRecord(errors)) return false;
  const base = errors.base;
  if (!Array.isArray(base)) return false;
  return base.some((item) => readStr(item).toLowerCase().includes("ancestry does not match"));
}

function stripAncestrySensitiveOptionalFields(timecardEntry: UnknownRecord) {
  const sanitized: UnknownRecord = { ...timecardEntry };
  const removedFields: string[] = [];

  for (const field of ANCESTRY_SENSITIVE_OPTIONAL_FIELDS) {
    if (sanitized[field] !== undefined) {
      delete sanitized[field];
      removedFields.push(field);
    }
  }

  return { sanitized, removedFields };
}

function collectNumericIds(items: unknown, idKey: string = "id"): Set<number> {
  const ids = new Set<number>();
  if (!Array.isArray(items)) return ids;
  for (const item of items) {
    if (!isRecord(item)) continue;
    const id = readInt(item[idKey]);
    if (id !== undefined) ids.add(id);
  }
  return ids;
}

function collectNestedPartyIds(items: unknown): Set<number> {
  const ids = new Set<number>();
  if (!Array.isArray(items)) return ids;
  for (const item of items) {
    if (!isRecord(item)) continue;
    const party = item.party;
    if (!isRecord(party)) continue;
    const id = readInt(party.id);
    if (id !== undefined) ids.add(id);
  }
  return ids;
}

async function fetchJsonArray(url: string, headers: Record<string, string>): Promise<unknown[]> {
  const response = await fetch(url, {
    method: "GET",
    headers,
    cache: "no-store",
  });
  if (!response.ok) return [];
  const payload = (await response.json().catch(() => [])) as unknown;
  return Array.isArray(payload) ? payload : [];
}

async function validateAncestry(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  timecardEntry: UnknownRecord;
}): Promise<AncestryValidationResult> {
  const { accessToken, companyId, projectId, timecardEntry } = params;
  const result: AncestryValidationResult = { ok: true, checks: {}, details: [] };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "Procore-Company-Id": companyId,
  };

  const partyId = readInt(timecardEntry.party_id);
  const timecardTimeTypeId = readInt(timecardEntry.timecard_time_type_id);
  const costCodeId = readInt(timecardEntry.cost_code_id);

  if (partyId !== undefined) {
    const usersEndpoints = [
      `${procoreConfig.apiUrl}/rest/v1.0/projects/${encodeURIComponent(projectId)}/users?company_id=${encodeURIComponent(companyId)}&page=1&per_page=1000`,
      `${procoreConfig.apiUrl}/rest/v1.0/projects/${encodeURIComponent(projectId)}/users?page=1&per_page=1000`,
    ];
    let projectUsers: unknown[] = [];
    for (const endpoint of usersEndpoints) {
      projectUsers = await fetchJsonArray(endpoint, headers);
      if (projectUsers.length > 0) break;
    }
    const userIds = collectNumericIds(projectUsers);
    let valid = userIds.has(partyId);
    let source = "project_users";

    if (!valid) {
      // Some valid labor parties are visible on existing project timecards but not
      // returned by /projects/:id/users for this token context.
      const entriesEndpoint = `${procoreConfig.apiUrl}/rest/v1.0/projects/${encodeURIComponent(projectId)}/timecard_entries?page=1&per_page=1000`;
      const existingEntries = await fetchJsonArray(entriesEndpoint, headers);
      const existingPartyIds = collectNestedPartyIds(existingEntries);
      if (existingPartyIds.has(partyId)) {
        valid = true;
        source = "existing_timecard_entries";
      }
    }

    result.checks.party_id = { provided: partyId, valid, source };
    if (!valid) {
      result.ok = false;
      result.details.push(`party_id ${partyId} is not a user on project ${projectId}.`);
    }
  }

  if (timecardTimeTypeId !== undefined) {
    const endpoint = `${procoreConfig.apiUrl}/rest/v1.0/timecard_time_types?project_id=${encodeURIComponent(projectId)}&page=1&per_page=1000`;
    const types = await fetchJsonArray(endpoint, headers);
    const typeIds = collectNumericIds(types);
    const valid = typeIds.has(timecardTimeTypeId);
    result.checks.timecard_time_type_id = { provided: timecardTimeTypeId, valid };
    if (!valid) {
      result.ok = false;
      result.details.push(`timecard_time_type_id ${timecardTimeTypeId} is not available for project ${projectId}.`);
    }
  }

  if (costCodeId !== undefined) {
    const endpoint = `${procoreConfig.apiUrl}/rest/v1.0/cost_codes?project_id=${encodeURIComponent(projectId)}&page=1&per_page=1000`;
    const costCodes = await fetchJsonArray(endpoint, headers);
    const costCodeIds = collectNumericIds(costCodes);
    const valid = costCodeIds.has(costCodeId);
    result.checks.cost_code_id = { provided: costCodeId, valid };
    if (!valid) {
      result.ok = false;
      result.details.push(`cost_code_id ${costCodeId} is not available for project ${projectId}.`);
    }
  }

  return result;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as UnknownRecord;
    const cookieStore = await cookies();

    const explicitToken = readStr(body.accessToken);
    const cookieToken = readStr(cookieStore.get("procore_access_token")?.value);
    let accessToken = explicitToken || cookieToken;
    let tokenSource: "explicit" | "cookie" | "client_credentials" | "missing" = explicitToken
      ? "explicit"
      : cookieToken
        ? "cookie"
        : "missing";

    if (!accessToken) {
      try {
        accessToken = await getClientCredentialsToken();
        tokenSource = "client_credentials";
      } catch {
        tokenSource = "missing";
      }
    }

    const companyId = readStr(body.companyId || cookieStore.get("procore_company_id")?.value || procoreConfig.companyId);
    const projectId = readStr(body.project_id || body.projectId);

    if (!accessToken) {
      return NextResponse.json(
        {
          error: "Missing Procore access token.",
          details: "Provide accessToken, authenticate on /procore, or configure PROCORE_CLIENT_ID/PROCORE_CLIENT_SECRET.",
        },
        { status: 401 }
      );
    }
    if (!projectId) {
      return NextResponse.json({ error: "Missing required field: project_id" }, { status: 400 });
    }

    const timecardEntry = normalizeTimecardEntry(body.timecard_entry ?? body.timecardEntry);
    if (!timecardEntry) {
      return NextResponse.json({ error: "Missing required field: timecard_entry" }, { status: 400 });
    }

    const ancestryValidation = await validateAncestry({
      accessToken,
      companyId,
      projectId,
      timecardEntry,
    });

    if (!ancestryValidation.ok) {
      return NextResponse.json(
        {
          error: "Invalid timecard_entry ancestry",
          details: ancestryValidation.details.join(" "),
          ancestryValidation,
          attemptedPayload: { timecard_entry: timecardEntry },
        },
        { status: 422 }
      );
    }

    const url = `https://api.procore.com/rest/v1.0/projects/${encodeURIComponent(projectId)}/timecard_entries`;
    const executeCreate = async (payload: UnknownRecord) => {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(companyId ? { "Procore-Company-Id": companyId } : {}),
        },
        body: JSON.stringify({ timecard_entry: payload }),
      });

      const rawText = await response.text();
      let parsed: unknown = rawText;
      try {
        parsed = rawText ? JSON.parse(rawText) : {};
      } catch {
        parsed = rawText || {};
      }

      return { response, rawText, parsed };
    };

    const firstAttempt = await executeCreate(timecardEntry);

    let finalResponse = firstAttempt.response;
    let finalRawText = firstAttempt.rawText;
    let finalParsed = firstAttempt.parsed;
    let retryUsed = false;
    let retryRemovedFields: string[] = [];

    if (!finalResponse.ok && hasAncestryMismatchError(finalParsed)) {
      const { sanitized, removedFields } = stripAncestrySensitiveOptionalFields(timecardEntry);
      if (removedFields.length > 0) {
        const retryAttempt = await executeCreate(sanitized);
        retryUsed = true;
        retryRemovedFields = removedFields;
        finalResponse = retryAttempt.response;
        finalRawText = retryAttempt.rawText;
        finalParsed = retryAttempt.parsed;
      }
    }

    return NextResponse.json(
      {
        ok: finalResponse.ok,
        status: finalResponse.status,
        statusText: finalResponse.statusText,
        url,
        tokenSource,
        attemptedPayload: { timecard_entry: timecardEntry },
        retry: retryUsed
          ? {
              used: true,
              reason: "Procore ancestry mismatch",
              removedFields: retryRemovedFields,
            }
          : { used: false },
        result: finalParsed,
        rawResponseText: finalRawText,
      },
      { status: finalResponse.status }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to create timecard entry", details: message },
      { status: 500 }
    );
  }
}
