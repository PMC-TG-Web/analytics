import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { procoreConfig } from "@/lib/procore";

type UnknownRecord = Record<string, unknown>;

type CompanyUserRow = {
  user_id: string;
  name: string | null;
  login: string | null;
};

type ProjectUser = {
  id: string;
  name: string;
  login: string;
};

type CostCodeRow = {
  cost_code_id: string;
  code: string | null;
  full_code: string | null;
  name: string | null;
  active: boolean | null;
};

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
  const token = readStr(value).toLowerCase();
  if (["yes", "true", "y", "1"].includes(token)) return true;
  if (["no", "false", "n", "0"].includes(token)) return false;
  return undefined;
}

function readHoursNumber(value: unknown): number | undefined {
  const token = readStr(value);
  if (!token) return undefined;
  const parsed = Number(token);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

function normalizeKey(value: unknown): string {
  return readStr(value).replace(/\s+/g, " ").toLowerCase();
}

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function getTimecardTypeLabels(timeType: Record<string, unknown>): string[] {
  const labels: string[] = [];
  const customFields = asRecord(timeType.customFields);
  const candidates = [
    timeType.name,
    customFields?.time_type,
    customFields?.abbreviated_time_type,
  ];

  for (const candidate of candidates) {
    const label = readStr(candidate);
    if (label && !labels.includes(label)) labels.push(label);
  }

  return labels;
}

function parseCostCodeLabel(raw: string): { code: string; name: string } {
  const token = raw.trim();
  const match = token.match(/^([^\s]+)\s*-\s*(.+)$/);
  if (!match) return { code: token, name: token };
  return { code: match[1].trim(), name: match[2].trim() };
}

async function fetchProjectUsers(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
}): Promise<{ users: ProjectUser[]; source: string }> {
  const headers = {
    Authorization: `Bearer ${params.accessToken}`,
    Accept: "application/json",
    "Procore-Company-Id": params.companyId,
  };

  const endpoints = [
    `${procoreConfig.apiUrl}/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/users?company_id=${encodeURIComponent(params.companyId)}&page=1&per_page=1000`,
    `${procoreConfig.apiUrl}/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/users?page=1&per_page=1000`,
  ];

  let lastError = "";
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { method: "GET", headers, cache: "no-store" });
      if (!response.ok) {
        lastError = `Project users API error ${response.status}`;
        continue;
      }

      const payload = (await response.json().catch(() => [])) as unknown;
      const users = Array.isArray(payload)
        ? payload
            .filter((item): item is UnknownRecord => isRecord(item))
            .map((item) => ({
              id: readStr(item.id),
              name: readStr(item.name),
              login: readStr(item.login),
            }))
            .filter((user) => Boolean(user.id))
        : [];

      return { users, source: endpoint };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(lastError || "Failed to fetch project users.");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as UnknownRecord;
    const cookieStore = await cookies();

    const accessToken = readStr(body.accessToken || cookieStore.get("procore_access_token")?.value);
    const companyId = readStr(body.companyId || cookieStore.get("procore_company_id")?.value || procoreConfig.companyId);
    const projectId = readStr(body.projectId || body.project_id);
    const rows = Array.isArray(body.rows) ? body.rows.filter((row): row is UnknownRecord => isRecord(row)) : [];

    if (!companyId) {
      return NextResponse.json({ error: "Missing companyId." }, { status: 400 });
    }
    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId." }, { status: 400 });
    }
    if (rows.length === 0) {
      return NextResponse.json({ error: "rows must be a non-empty array." }, { status: 400 });
    }

    const employeeIds = [...new Set(rows.map((row) => readStr(row.employeeId)).filter(Boolean))];
    const employeeNames = [...new Set(rows.map((row) => normalizeKey(row.employeeName)).filter(Boolean))];
    const timeTypeNames = [...new Set(rows.map((row) => normalizeKey(row.timeTypeName)).filter(Boolean))];
    const costCodeNumbers = [...new Set(rows.map((row) => readStr(row.costCodeLongNumber)).filter(Boolean))];
    const costCodeNames = [...new Set(rows.map((row) => normalizeKey(row.costCodeName)).filter(Boolean))];
    const costCodeLongNames = [...new Set(rows.map((row) => normalizeKey(row.costCodeLongName)).filter(Boolean))];

    const companyUsers = await prisma.$queryRawUnsafe<CompanyUserRow[]>(
      `
        SELECT user_id, name, login
        FROM procore_company_users_live
        WHERE company_id = $1
      `,
      companyId
    );

    const costCodes = await prisma.$queryRawUnsafe<CostCodeRow[]>(
      `
        SELECT cost_code_id, code, full_code, name, active
        FROM procore_cost_code_staging
        WHERE company_id = $1
          AND project_id = $2
      `,
      companyId,
      projectId
    );

    const timecardTypes = await prisma.timecardTimeType.findMany({
      where: {
        OR: [
          { projectId },
          { procoreProjectId: projectId },
          { global: true },
        ],
      },
      orderBy: [{ global: "desc" }, { name: "asc" }],
      take: 500,
    });

    let projectUsers: ProjectUser[] = [];
    let projectUsersSource = "none";
    let projectUsersError = "";
    if (accessToken) {
      try {
        const result = await fetchProjectUsers({ accessToken, companyId, projectId });
        projectUsers = result.users;
        projectUsersSource = result.source;
      } catch (error) {
        projectUsersError = error instanceof Error ? error.message : String(error);
      }
    }

    const usersById = new Map(companyUsers.map((user) => [readStr(user.user_id), user]));
    const usersByName = new Map<string, CompanyUserRow>();
    for (const user of companyUsers) {
      const key = normalizeKey(user.name);
      if (key && !usersByName.has(key)) usersByName.set(key, user);
    }

    const projectUsersById = new Map(projectUsers.map((user) => [readStr(user.id), user]));
    const projectUsersByName = new Map<string, ProjectUser>();
    for (const user of projectUsers) {
      const key = normalizeKey(user.name);
      if (key && !projectUsersByName.has(key)) projectUsersByName.set(key, user);
    }
    const hasProjectUserDirectory = projectUsers.length > 0;

    const costCodesByFullCode = new Map<string, CostCodeRow>();
    const costCodesByCode = new Map<string, CostCodeRow>();
    const costCodesByName = new Map<string, CostCodeRow>();
    for (const code of costCodes) {
      const fullCode = readStr(code.full_code);
      const shortCode = readStr(code.code);
      const name = normalizeKey(code.name);
      if (fullCode && !costCodesByFullCode.has(fullCode)) costCodesByFullCode.set(fullCode, code);
      if (shortCode && !costCodesByCode.has(shortCode)) costCodesByCode.set(shortCode, code);
      if (name && !costCodesByName.has(name)) costCodesByName.set(name, code);
    }

    const timeTypesByName = new Map<string, { id: string; name: string }>();
    for (const timeType of timecardTypes) {
      const timeTypeId = readStr(timeType.procoreId);
      if (!timeTypeId) continue;

      const labels = getTimecardTypeLabels(timeType as unknown as Record<string, unknown>);
      const primaryName = labels[0] || timeTypeId;

      for (const label of labels) {
        const key = normalizeKey(label);
        if (key && !timeTypesByName.has(key)) {
          timeTypesByName.set(key, { id: timeTypeId, name: primaryName });
        }
      }
    }

    const resolvedRows = rows.map((row, index) => {
      const notes: string[] = [];
      const employeeId = readStr(row.employeeId);
      const employeeName = readStr(row.employeeName);
      const timeTypeName = readStr(row.timeTypeName);
      const costCodeLongNumber = readStr(row.costCodeLongNumber);
      const costCodeName = readStr(row.costCodeName);
      const costCodeLongName = readStr(row.costCodeLongName);
      const description = readStr(row.description) || costCodeLongName || costCodeName;
      const hours = readHoursNumber(row.hours);
      const billable = readBool(row.billable);
      const date = readStr(row.date);

      let partyId = "";
      let resolvedPartyName = "";

      if (hasProjectUserDirectory) {
        if (employeeId && projectUsersById.has(employeeId)) {
          const projectUser = projectUsersById.get(employeeId)!;
          partyId = readStr(projectUser.id);
          resolvedPartyName = readStr(projectUser.name);
        } else {
          const matchedProjectUser = projectUsersByName.get(normalizeKey(employeeName));
          if (matchedProjectUser) {
            partyId = readStr(matchedProjectUser.id);
            resolvedPartyName = readStr(matchedProjectUser.name);
          }
        }

        if (!partyId && employeeId && usersById.has(employeeId)) {
          notes.push("Employee exists in company users but is not assigned to this project (party_id ancestry mismatch risk).");
        }
      } else {
        if (employeeId && usersById.has(employeeId)) {
          const user = usersById.get(employeeId)!;
          partyId = readStr(user.user_id);
          resolvedPartyName = readStr(user.name);
        } else if (employeeId && /^\d+$/.test(employeeId)) {
          partyId = employeeId;
          notes.push("Used EMPLOYEE ID directly as party_id (project membership not validated).");
        } else {
          const matchedUser = usersByName.get(normalizeKey(employeeName));
          if (matchedUser) {
            partyId = readStr(matchedUser.user_id);
            resolvedPartyName = readStr(matchedUser.name);
          }
        }

        if (projectUsersError) {
          notes.push("Project user directory unavailable; party_id resolved from company users only.");
        }
      }

      if (!partyId) notes.push("Could not resolve party_id from EMPLOYEE ID / EMPLOYEE NAME.");

      const matchedTimeType = timeTypesByName.get(normalizeKey(timeTypeName));
      const timecardTimeTypeId = matchedTimeType?.id || "";
      if (!timecardTimeTypeId) notes.push("Could not resolve timecard_time_type_id from FORMATTED TIME TYPE.");

      let matchedCostCode: CostCodeRow | undefined;
      if (costCodeLongNumber) {
        matchedCostCode = costCodesByFullCode.get(costCodeLongNumber) || costCodesByCode.get(costCodeLongNumber);
      }
      if (!matchedCostCode && costCodeLongName) {
        const parsed = parseCostCodeLabel(costCodeLongName);
        matchedCostCode = costCodesByFullCode.get(parsed.code) || costCodesByCode.get(parsed.code) || costCodesByName.get(normalizeKey(parsed.name));
      }
      if (!matchedCostCode && costCodeName) {
        matchedCostCode = costCodesByName.get(normalizeKey(costCodeName));
      }

      const costCodeId = matchedCostCode ? readStr(matchedCostCode.cost_code_id) : "";
      if (!costCodeId) notes.push("Could not resolve cost_code_id from COST CODE LONG NUMBER / COST CODE NAME.");

      const payload: UnknownRecord = {
        ...(date ? { date } : {}),
        ...(description ? { description } : {}),
        ...(billable !== undefined ? { billable } : {}),
        ...(hours !== undefined ? { hours } : {}),
        ...(partyId ? { party_id: Number(partyId) } : {}),
        ...(timecardTimeTypeId ? { timecard_time_type_id: Number(timecardTimeTypeId) } : {}),
        ...(costCodeId ? { cost_code_id: Number(costCodeId) } : {}),
        origin_data: JSON.stringify(row),
      };

      const resolved = Boolean(date && hours !== undefined && partyId && timecardTimeTypeId && costCodeId);

      return {
        rowNumber: index + 2,
        source: row,
        payload,
        resolved,
        resolutionNotes: notes,
        resolvedPartyName,
        resolvedTimeTypeName: matchedTimeType?.name || "",
        resolvedCostCodeName: matchedCostCode ? readStr(matchedCostCode.name) : "",
      };
    });

    return NextResponse.json({
      success: true,
      companyId,
      projectId,
      lookupStats: {
        companyUsers: companyUsers.length,
        projectUsers: projectUsers.length,
        projectUsersDirectory: hasProjectUserDirectory ? "loaded" : accessToken ? "unavailable" : "missing_access_token",
        projectUsersError: projectUsersError || undefined,
        projectUsersSource: projectUsersSource !== "none" ? projectUsersSource : undefined,
        timecardTypes: timecardTypes.length,
        costCodes: costCodes.length,
        distinctEmployeeIds: employeeIds.length,
        distinctEmployeeNames: employeeNames.length,
        distinctTimeTypeNames: timeTypeNames.length,
        distinctCostCodeNumbers: costCodeNumbers.length,
        distinctCostCodeNames: costCodeNames.length + costCodeLongNames.length,
      },
      rows: resolvedRows,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to resolve timecard CSV rows", details: message },
      { status: 500 }
    );
  }
}
