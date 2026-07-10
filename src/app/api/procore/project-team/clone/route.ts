import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getClientCredentialsToken, procoreConfig } from "@/lib/procore";

export const dynamic = "force-dynamic";

type UnknownRecord = Record<string, unknown>;

type ProjectUser = {
  id: number;
  name: string;
  login: string;
  companyName: string;
};

type ProjectRoleRecord = {
  id: number;
  name: string;
  roleType: "person" | "company";
  userIds: number[];
  vendorIds: number[];
  vendorNames: string[];
};

type CompanyRoleRecord = {
  id: number;
  name: string;
  roleType: "person" | "company";
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): UnknownRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value) && Array.isArray(value.data)) return value.data.filter(isRecord);
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

function normalizeCompanyKey(value: unknown): string {
  return normalize(value)
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(incorporated|inc|llc|ltd|co|company|corp|corporation|pllc|lp|llp)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toUniqueNums(values: unknown[]): number[] {
  const next: number[] = [];
  const seen = new Set<number>();
  for (const value of values) {
    const n = readNum(value);
    if (n === undefined || seen.has(n)) continue;
    seen.add(n);
    next.push(n);
  }
  return next;
}

function normalizeRoleType(value: unknown): "person" | "company" {
  const token = normalize(value);
  if (["company", "vendor", "organization", "trade"].includes(token)) return "company";
  return "person";
}

function isLikelyCompanyRoleName(value: unknown): boolean {
  const name = normalize(value);
  if (!name) return false;
  return ["general contractor", "subcontractor/vendor", "subcontractor", "vendor", "contractor"]
    .some((token) => name.includes(token));
}

function parseProjectRoleRow(row: UnknownRecord): ProjectRoleRecord | null {
  const id = readNum(row.id);
  const roleLabel = readStr(row.role);
  const memberLabel = readStr(row.name || row.contact_name || row.company_name || row.vendor_name);
  const name = readStr(roleLabel || memberLabel || row.title);
  if (id === undefined || !name) return null;

  const usersFromArray = Array.isArray(row.users)
    ? row.users.map((entry) => {
        if (!isRecord(entry)) return undefined;
        return readNum(entry.id ?? entry.user_id);
      })
    : [];

  const vendorNamesFromArray = [
    ...(Array.isArray(row.vendors) ? row.vendors : []),
    ...(Array.isArray(row.companies) ? row.companies : []),
  ]
    .map((entry) => {
      if (!isRecord(entry)) return "";
      return readStr(entry.name || entry.company_name || entry.vendor_name || entry.display_name);
    })
    .filter(Boolean);

  const contactNamesFromObject = [row.contact, row.vendor, row.company]
    .map((entry) => {
      if (!isRecord(entry)) return "";
      return readStr(entry.name || entry.company_name || entry.vendor_name || entry.display_name);
    })
    .filter(Boolean);

  const vendorsFromArray = Array.isArray(row.vendors)
    ? row.vendors.map((entry) => {
        if (!isRecord(entry)) return undefined;
        return readNum(entry.id ?? entry.vendor_id ?? entry.company_id);
      })
    : [];

  const companysFromArray = Array.isArray(row.companies)
    ? row.companies.map((entry) => {
        if (!isRecord(entry)) return undefined;
        return readNum(entry.id ?? entry.vendor_id ?? entry.company_id);
      })
    : [];

  const userIds = toUniqueNums([
    row.user_id,
    ...(Array.isArray(row.user_ids) ? row.user_ids : []),
    ...usersFromArray,
  ]);
  const vendorIds = toUniqueNums([
    row.vendor_id,
    row.company_id,
    ...(Array.isArray(row.vendor_ids) ? row.vendor_ids : []),
    ...(Array.isArray(row.company_ids) ? row.company_ids : []),
    ...vendorsFromArray,
    ...companysFromArray,
  ]);

  const explicitRoleType = normalizeRoleType(row.type || row.role_type || row.member_type);
  const roleType = explicitRoleType === "person" && vendorIds.length > 0 && userIds.length === 0
    ? "company"
    : explicitRoleType;

  const vendorNames = [...vendorNamesFromArray, ...contactNamesFromObject];
  if (memberLabel && roleLabel && normalize(memberLabel) !== normalize(roleLabel)) {
    vendorNames.push(memberLabel);
  }

  return {
    id,
    name,
    roleType,
    userIds,
    vendorIds,
    vendorNames: [...new Set(vendorNames.map((value) => normalize(value)).filter(Boolean))],
  };
}

function parseCompanyRoleRow(row: UnknownRecord): CompanyRoleRecord | null {
  const id = readNum(row.id);
  const name = readStr(row.name || row.role || row.title);
  if (id === undefined || !name) return null;

  const inferredType = row.is_vendor_role === true ? "company" : undefined;
  const roleType = normalizeRoleType(row.type || row.role_type || row.member_type || inferredType);

  return {
    id,
    name,
    roleType,
  };
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
    throw new Error(
      `Procore ${params.method || "GET"} ${params.path} failed (${response.status}): ${typeof payload === "string" ? payload : JSON.stringify(payload)}`
    );
  }

  return { status: response.status, ok: response.ok, payload };
}

function uniqueUsers(rows: ProjectUser[]): ProjectUser[] {
  const byId = new Map<number, ProjectUser>();
  for (const row of rows) {
    const existing = byId.get(row.id);
    if (!existing) {
      byId.set(row.id, row);
      continue;
    }

    byId.set(row.id, {
      ...existing,
      name: existing.name || row.name,
      login: existing.login || row.login,
      companyName: existing.companyName || row.companyName,
    });
  }
  return [...byId.values()];
}

async function fetchProjectUsers(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  maxPages: number;
}): Promise<{ users: ProjectUser[]; sourcePath: string }> {
  const basePaths = [
    `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/users?company_id=${encodeURIComponent(params.companyId)}`,
    `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/users`,
  ];

  let lastError = "";

  for (const basePath of basePaths) {
    const collected: ProjectUser[] = [];
    try {
      for (let page = 1; page <= params.maxPages; page += 1) {
        const separator = basePath.includes("?") ? "&" : "?";
        const path = `${basePath}${separator}page=${page}&per_page=100`;
        const result = await procoreJson({
          accessToken: params.accessToken,
          companyId: params.companyId,
          path,
        });

        const pageRows = asArray(result.payload)
          .map((row) => ({
            id: readNum(row.id),
            name: readStr(row.name || `${readStr(row.first_name)} ${readStr(row.last_name)}`),
            login: readStr(row.login || row.email || row.email_address),
            companyName: readStr(
              (isRecord(row.company) ? row.company.name : undefined) ||
              (isRecord(row.vendor) ? row.vendor.name : undefined) ||
              row.company_name ||
              row.vendor_name ||
              row.company ||
              row.vendor
            ),
          }))
          .filter((row): row is ProjectUser => row.id !== undefined);

        if (pageRows.length === 0) break;
        collected.push(...pageRows);
        if (pageRows.length < 100) break;
      }

      return { users: uniqueUsers(collected), sourcePath: basePath };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(lastError || "Failed to fetch project users.");
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
    allowStatuses: [409, 422],
  });
}

function dedupeProjectRoles(roles: ProjectRoleRecord[]): ProjectRoleRecord[] {
  const byKey = new Map<string, ProjectRoleRecord>();
  for (const role of roles) {
    const key = `${normalize(role.name)}|${role.roleType}`;
    if (!byKey.has(key)) {
      byKey.set(key, role);
      continue;
    }

    const existing = byKey.get(key)!;
    byKey.set(key, {
      ...existing,
      userIds: toUniqueNums([...existing.userIds, ...role.userIds]),
      vendorIds: toUniqueNums([...existing.vendorIds, ...role.vendorIds]),
      vendorNames: [...new Set([...existing.vendorNames, ...role.vendorNames])],
    });
  }

  return [...byKey.values()];
}

async function fetchProjectVendors(params: {
  accessToken: string;
  companyIds: string[];
  projectId: string;
  maxPages: number;
}): Promise<{ vendors: Array<{ id: number; name: string }>; companyIdUsed: string }> {
  const candidateCompanyIds = params.companyIds.map(readStr).filter(Boolean);
  if (candidateCompanyIds.length === 0) {
    throw new Error("At least one company ID is required to fetch project vendors.");
  }

  const basePaths = [
    `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/vendors`,
    `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/vendors?project_id=${encodeURIComponent(params.projectId)}`,
  ];

  let lastError = "";

  for (const companyId of candidateCompanyIds) {
    for (const basePath of basePaths) {
      const collected: Array<{ id: number; name: string }> = [];
      try {
        for (let page = 1; page <= params.maxPages; page += 1) {
          const separator = basePath.includes("?") ? "&" : "?";
          const path = `${basePath}${separator}page=${page}&per_page=100`;
          const result = await procoreJson({
            accessToken: params.accessToken,
            companyId,
            path,
          });

          const pageRows = asArray(result.payload)
            .map((row) => ({
              id: readNum(row.id),
              name: readStr(row.name || row.vendor_name || row.company_name),
            }))
            .filter((row): row is { id: number; name: string } => row.id !== undefined);

          if (pageRows.length === 0) break;
          collected.push(...pageRows);
          if (pageRows.length < 100) break;
        }

        if (collected.length > 0) {
          const seen = new Set<number>();
          const vendors: Array<{ id: number; name: string }> = [];
          for (const row of collected) {
            if (seen.has(row.id)) continue;
            seen.add(row.id);
            vendors.push(row);
          }
          return { vendors, companyIdUsed: companyId };
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  if (lastError) throw new Error(lastError);
  return { vendors: [], companyIdUsed: candidateCompanyIds[0] };
}

async function fetchProjectRoles(params: {
  accessToken: string;
  companyIds: string[];
  projectId: string;
  maxPages: number;
}): Promise<{ roles: ProjectRoleRecord[]; companyIdUsed: string }> {
  const candidateCompanyIds = params.companyIds.map(readStr).filter(Boolean);
  if (candidateCompanyIds.length === 0) {
    throw new Error("At least one company ID is required to fetch project roles.");
  }

  let lastError = "";

  for (const companyId of candidateCompanyIds) {
    const collected: ProjectRoleRecord[] = [];
    try {
      for (let page = 1; page <= params.maxPages; page += 1) {
        const path = `/rest/v1.0/project_roles?project_id=${encodeURIComponent(params.projectId)}&page=${page}&per_page=100`;
        const result = await procoreJson({
          accessToken: params.accessToken,
          companyId,
          path,
        });

        const pageRows = asArray(result.payload)
          .map(parseProjectRoleRow)
          .filter((row): row is ProjectRoleRecord => row !== null);

        if (pageRows.length === 0) break;
        collected.push(...pageRows);
        if (pageRows.length < 100) break;
      }

      const roles = dedupeProjectRoles(collected);
      if (roles.length > 0) {
        return { roles, companyIdUsed: companyId };
      }

      // Continue trying fallback company IDs when this candidate returns no roles.
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  if (lastError) throw new Error(lastError);
  return { roles: [], companyIdUsed: candidateCompanyIds[0] };
}

async function fetchCompanyRoles(params: {
  accessToken: string;
  companyIds: string[];
  maxPages: number;
}): Promise<{ roles: CompanyRoleRecord[]; companyIdUsed: string }> {
  const candidateCompanyIds = params.companyIds.map(readStr).filter(Boolean);
  if (candidateCompanyIds.length === 0) {
    throw new Error("At least one company ID is required to fetch company roles.");
  }

  const basePathFactories = [
    (companyId: string) => `/rest/v1.0/companies/${encodeURIComponent(companyId)}/roles`,
    (companyId: string) => `/rest/v2.0/companies/${encodeURIComponent(companyId)}/roles`,
  ];

  let lastError = "";

  for (const companyId of candidateCompanyIds) {
    for (const makeBasePath of basePathFactories) {
      const collected: CompanyRoleRecord[] = [];
      try {
        const basePath = makeBasePath(companyId);
        for (let page = 1; page <= params.maxPages; page += 1) {
          const separator = basePath.includes("?") ? "&" : "?";
          const path = `${basePath}${separator}page=${page}&per_page=100`;
          const result = await procoreJson({
            accessToken: params.accessToken,
            companyId,
            path,
          });

          const pageRows = asArray(result.payload)
            .map(parseCompanyRoleRow)
            .filter((row): row is CompanyRoleRecord => row !== null);

          if (pageRows.length === 0) break;
          collected.push(...pageRows);
          if (pageRows.length < 100) break;
        }

        if (collected.length > 0) {
          const byKey = new Map<string, CompanyRoleRecord>();
          for (const role of collected) {
            const key = `${normalize(role.name)}|${role.roleType}`;
            if (!byKey.has(key)) byKey.set(key, role);
          }
          return {
            roles: [...byKey.values()],
            companyIdUsed: companyId,
          };
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  if (lastError) throw new Error(lastError);
  return { roles: [], companyIdUsed: candidateCompanyIds[0] };
}

async function updateUserProjectRoleMembers(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  roleId: number;
  userIds: number[];
}) {
  return procoreJson({
    accessToken: params.accessToken,
    companyId: params.companyId,
    path: `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/user_project_roles/${encodeURIComponent(String(params.roleId))}`,
    method: "PATCH",
    body: { user_ids: params.userIds },
    allowStatuses: [409, 422],
  });
}

async function updateVendorProjectRoleMembers(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  roleId: number;
  vendorIds: number[];
}) {
  return procoreJson({
    accessToken: params.accessToken,
    companyId: params.companyId,
    path: `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/vendor_project_roles/${encodeURIComponent(String(params.roleId))}`,
    method: "PATCH",
    body: { vendor_ids: params.vendorIds },
    allowStatuses: [409, 422],
  });
}

async function createProjectRole(params: {
  accessToken: string;
  companyIds: string[];
  projectId: string;
  roleName: string;
  userId: number;
}) {
  const companyIds = params.companyIds.map(readStr).filter(Boolean);
  const endpointCandidates: Array<{ path: string; includeProjectIdInBody: boolean }> = [
    { path: "/rest/v1.0/project_roles", includeProjectIdInBody: true },
    {
      path: `/rest/v1.0/project_roles?project_id=${encodeURIComponent(params.projectId)}`,
      includeProjectIdInBody: false,
    },
    {
      path: `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/project_roles`,
      includeProjectIdInBody: false,
    },
    { path: "/rest/v1.1/project_roles", includeProjectIdInBody: true },
    {
      path: `/rest/v1.1/project_roles?project_id=${encodeURIComponent(params.projectId)}`,
      includeProjectIdInBody: false,
    },
    {
      path: `/rest/v1.1/projects/${encodeURIComponent(params.projectId)}/project_roles`,
      includeProjectIdInBody: false,
    },
  ];

  const attempts: Array<{
    status: number;
    ok: boolean;
    payload: unknown;
    companyId: string;
    path: string;
  }> = [];

  for (const companyId of companyIds) {
    for (const endpoint of endpointCandidates) {
      const result = await procoreJson({
        accessToken: params.accessToken,
        companyId,
        path: endpoint.path,
        method: "POST",
        body: {
          ...(endpoint.includeProjectIdInBody ? { project_id: params.projectId } : {}),
          project_role: {
            role: params.roleName,
            user_id: params.userId,
          },
        },
        allowStatuses: [404, 409, 422],
      });

      const attempt = {
        status: result.status,
        ok: result.ok,
        payload: result.payload,
        companyId,
        path: endpoint.path,
      };
      attempts.push(attempt);

      if (result.ok || result.status === 409 || result.status === 422) {
        return {
          ...result,
          companyId,
          path: endpoint.path,
          attempts,
        };
      }
    }
  }

  if (attempts.length > 0) {
    return {
      ...attempts[attempts.length - 1],
      attempts,
    };
  }

  throw new Error("Unable to create project role: no company ID candidates available.");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as UnknownRecord;
    const cookieStore = await cookies();

    const fallbackCompanyId = readStr(
      body.companyId ||
      body.sourceCompanyId ||
      body.targetCompanyId ||
      cookieStore.get("procore_company_id")?.value ||
      procoreConfig.companyId
    );

    const sourceCompanyId = readStr(body.sourceCompanyId || body.companyId || fallbackCompanyId);
    const sourceProjectId = readStr(body.sourceProjectId);
    const targetCompanyId = readStr(body.targetCompanyId || body.companyId || sourceCompanyId || fallbackCompanyId);
    const targetProjectId = readStr(body.targetProjectId);
    const dryRun = body.dryRun !== false;
    const syncRoles = body.syncRoles !== false;
    const createMissingRoles = syncRoles && body.createMissingRoles !== false;
    const maxPages = Math.max(1, Math.min(50, Math.trunc(readNum(body.maxPages) || 10)));

    if (!sourceCompanyId || !sourceProjectId || !targetCompanyId || !targetProjectId) {
      return NextResponse.json(
        {
          success: false,
          error: "sourceCompanyId, sourceProjectId, targetCompanyId, and targetProjectId are required.",
        },
        { status: 400 }
      );
    }

    const { accessToken, tokenSource } = await getToken(body.accessToken);

    const [source, target] = await Promise.all([
      fetchProjectUsers({
        accessToken,
        companyId: sourceCompanyId,
        projectId: sourceProjectId,
        maxPages,
      }),
      fetchProjectUsers({
        accessToken,
        companyId: targetCompanyId,
        projectId: targetProjectId,
        maxPages,
      }),
    ]);

    const [sourceVendorLookup, targetVendorLookup] = syncRoles
      ? await Promise.all([
          fetchProjectVendors({
            accessToken,
            companyIds: [sourceCompanyId, fallbackCompanyId],
            projectId: sourceProjectId,
            maxPages,
          }),
          fetchProjectVendors({
            accessToken,
            companyIds: [targetCompanyId, sourceCompanyId, fallbackCompanyId],
            projectId: targetProjectId,
            maxPages,
          }),
        ])
      : [
          { vendors: [] as Array<{ id: number; name: string }>, companyIdUsed: sourceCompanyId },
          { vendors: [] as Array<{ id: number; name: string }>, companyIdUsed: targetCompanyId },
        ];

    const [sourceRoleLookup, targetRoleLookup, sourceCompanyRoleLookup, targetCompanyRoleLookup] = syncRoles
      ? await Promise.all([
          fetchProjectRoles({
            accessToken,
            companyIds: [sourceCompanyId, fallbackCompanyId],
            projectId: sourceProjectId,
            maxPages,
          }),
          fetchProjectRoles({
            accessToken,
            companyIds: [targetCompanyId, sourceCompanyId, fallbackCompanyId],
            projectId: targetProjectId,
            maxPages,
          }),
          fetchCompanyRoles({
            accessToken,
            companyIds: [sourceCompanyId, fallbackCompanyId],
            maxPages,
          }),
          fetchCompanyRoles({
            accessToken,
            companyIds: [targetCompanyId, sourceCompanyId, fallbackCompanyId],
            maxPages,
          }),
        ])
      : [
          { roles: [] as ProjectRoleRecord[], companyIdUsed: sourceCompanyId },
          { roles: [] as ProjectRoleRecord[], companyIdUsed: targetCompanyId },
          { roles: [] as CompanyRoleRecord[], companyIdUsed: sourceCompanyId },
          { roles: [] as CompanyRoleRecord[], companyIdUsed: targetCompanyId },
        ];

    const sourceCompanyRoleTypeByName = new Map(
      sourceCompanyRoleLookup.roles.map((role) => [normalize(role.name), role.roleType] as const)
    );
    const sourceRoles = sourceRoleLookup.roles.map((role) => ({
      ...role,
      roleType: sourceCompanyRoleTypeByName.get(normalize(role.name)) || role.roleType,
    }));
    let targetRoles = targetRoleLookup.roles;
    let targetCompanyRoles = targetCompanyRoleLookup.roles;

    const targetById = new Set(target.users.map((user) => String(user.id)));
    const targetByLogin = new Set(target.users.map((user) => normalize(user.login)).filter(Boolean));
    const targetByName = new Set(target.users.map((user) => normalize(user.name)).filter(Boolean));

    const alreadyPresent: ProjectUser[] = [];
    const toAdd: ProjectUser[] = [];

    const sourceUsersById = new Map(source.users.map((user) => [String(user.id), user] as const));
    const sourceVendorsById = new Map(sourceVendorLookup.vendors.map((vendor) => [vendor.id, vendor.name] as const));
    const targetVendorIdByName = new Map(
      targetVendorLookup.vendors
        .map((vendor) => [normalize(vendor.name), vendor.id] as const)
        .filter(([key]) => Boolean(key))
    );
    const targetVendorIdByCanonicalName = new Map<string, number>();
    const ambiguousCanonicalVendorNames = new Set<string>();
    for (const vendor of targetVendorLookup.vendors) {
      const key = normalizeCompanyKey(vendor.name);
      if (!key || ambiguousCanonicalVendorNames.has(key)) continue;
      const existing = targetVendorIdByCanonicalName.get(key);
      if (existing === undefined) {
        targetVendorIdByCanonicalName.set(key, vendor.id);
        continue;
      }
      if (existing !== vendor.id) {
        targetVendorIdByCanonicalName.delete(key);
        ambiguousCanonicalVendorNames.add(key);
      }
    }

    const targetCompanyRolesByKey = () => {
      const byTyped = new Map<string, CompanyRoleRecord>();
      const byName = new Map<string, CompanyRoleRecord>();
      for (const role of targetCompanyRoles) {
        const typedKey = `${normalize(role.name)}|${role.roleType}`;
        const nameKey = normalize(role.name);
        if (!byTyped.has(typedKey)) byTyped.set(typedKey, role);
        if (!byName.has(nameKey)) byName.set(nameKey, role);
      }
      return { byTyped, byName };
    };

    const resolveSourceUserIdsAgainstTargetUsers = (sourceUserIds: number[], targetUserDirectory: ProjectUser[]) => {
      const targetUsersById = new Set(targetUserDirectory.map((user) => user.id));
      const targetUsersByLogin = new Map(
        targetUserDirectory
          .map((user) => [normalize(user.login), user.id] as const)
          .filter(([key]) => Boolean(key))
      );
      const targetUsersByName = new Map(
        targetUserDirectory
          .map((user) => [normalize(user.name), user.id] as const)
          .filter(([key]) => Boolean(key))
      );

      const resolvedUserIds: number[] = [];
      for (const sourceUserId of sourceUserIds) {
        if (targetUsersById.has(sourceUserId)) {
          resolvedUserIds.push(sourceUserId);
          continue;
        }

        const sourceUser = sourceUsersById.get(String(sourceUserId));
        const loginMatch = sourceUser ? targetUsersByLogin.get(normalize(sourceUser.login)) : undefined;
        if (loginMatch !== undefined) {
          resolvedUserIds.push(loginMatch);
          continue;
        }

        const nameMatch = sourceUser ? targetUsersByName.get(normalize(sourceUser.name)) : undefined;
        if (nameMatch !== undefined) {
          resolvedUserIds.push(nameMatch);
        }
      }

      return toUniqueNums(resolvedUserIds);
    };

    for (const sourceUser of source.users) {
      const idKey = String(sourceUser.id);
      const loginKey = normalize(sourceUser.login);
      const nameKey = normalize(sourceUser.name);

      const exists =
        targetById.has(idKey) ||
        (loginKey && targetByLogin.has(loginKey)) ||
        (nameKey && targetByName.has(nameKey));

      if (exists) {
        alreadyPresent.push(sourceUser);
      } else {
        toAdd.push(sourceUser);
      }
    }

    const buildRolePlan = (targetUserDirectory: ProjectUser[]) => {
      const targetUsersById = new Set(targetUserDirectory.map((user) => user.id));
      const targetUsersByLogin = new Map(
        targetUserDirectory
          .map((user) => [normalize(user.login), user.id] as const)
          .filter(([key]) => Boolean(key))
      );
      const targetUsersByName = new Map(
        targetUserDirectory
          .map((user) => [normalize(user.name), user.id] as const)
          .filter(([key]) => Boolean(key))
      );

      const roleMaps = targetCompanyRolesByKey();
      return sourceRoles.map((sourceRole) => {
        const inferredCompanyFromMembers = sourceRole.vendorIds.length > 0 && sourceRole.userIds.length === 0;
        const inferredCompanyFromName = isLikelyCompanyRoleName(sourceRole.name) && sourceRole.userIds.length === 0;
        const preferredRoleType = (inferredCompanyFromMembers || inferredCompanyFromName)
          ? "company"
          : sourceRole.roleType;

        const targetRole =
          roleMaps.byTyped.get(`${normalize(sourceRole.name)}|${preferredRoleType}`) ||
          roleMaps.byTyped.get(`${normalize(sourceRole.name)}|${sourceRole.roleType}`) ||
          roleMaps.byName.get(normalize(sourceRole.name));
        const effectiveRoleType = (inferredCompanyFromMembers || inferredCompanyFromName)
          ? "company"
          : (targetRole?.roleType || sourceRole.roleType);

        if (!targetRole) {
          return {
            roleName: sourceRole.name,
            roleType: effectiveRoleType,
            sourceRoleId: sourceRole.id,
            targetRoleId: null,
            sourceMemberCount: effectiveRoleType === "person" ? sourceRole.userIds.length : sourceRole.vendorIds.length,
            resolvedMemberCount: 0,
            unresolvedMembers: effectiveRoleType === "person"
              ? sourceRole.userIds.map((id) => String(id))
              : sourceRole.vendorIds.map((id) => String(id)),
            action: "skipped_missing_target_role",
          };
        }

        if (effectiveRoleType === "company") {
          const sourceVendorNames = [
            ...sourceRole.vendorNames,
            ...sourceRole.vendorIds
              .map((vendorId) => sourceVendorsById.get(vendorId))
              .filter((name): name is string => Boolean(name))
              .map((name) => normalize(name)),
          ];

          const uniqueSourceVendorNames = [...new Set(sourceVendorNames.filter(Boolean))];

          const vendorIdsByName = toUniqueNums(
            uniqueSourceVendorNames
              .map((vendorName) => {
                const exact = targetVendorIdByName.get(normalize(vendorName));
                if (typeof exact === "number") return exact;
                return targetVendorIdByCanonicalName.get(normalizeCompanyKey(vendorName));
              })
              .filter((vendorId): vendorId is number => typeof vendorId === "number")
          );

          const resolvedVendorIds = vendorIdsByName.length > 0 || sourceCompanyId !== targetCompanyId
            ? vendorIdsByName
            : toUniqueNums(sourceRole.vendorIds);
          return {
            roleName: sourceRole.name,
            roleType: effectiveRoleType,
            sourceRoleId: sourceRole.id,
            targetRoleId: targetRole.id,
            sourceMemberCount: sourceRole.vendorIds.length,
            resolvedMemberCount: resolvedVendorIds.length,
            unresolvedMembers: uniqueSourceVendorNames,
            resolvedIds: resolvedVendorIds,
            action: resolvedVendorIds.length > 0 ? "ready_vendor_role_update" : "skipped_no_resolved_members",
          };
        }

        const resolvedUserIds: number[] = [];
        const unresolvedMembers: string[] = [];
        for (const sourceUserId of sourceRole.userIds) {
          if (targetUsersById.has(sourceUserId)) {
            resolvedUserIds.push(sourceUserId);
            continue;
          }

          const sourceUser = sourceUsersById.get(String(sourceUserId));
          const loginMatch = sourceUser ? targetUsersByLogin.get(normalize(sourceUser.login)) : undefined;
          if (loginMatch !== undefined) {
            resolvedUserIds.push(loginMatch);
            continue;
          }

          const nameMatch = sourceUser ? targetUsersByName.get(normalize(sourceUser.name)) : undefined;
          if (nameMatch !== undefined) {
            resolvedUserIds.push(nameMatch);
            continue;
          }

          unresolvedMembers.push(
            sourceUser
              ? `${sourceUser.name || sourceUser.login || sourceUser.id} (${sourceUserId})`
              : String(sourceUserId)
          );
        }

        const dedupedResolved = toUniqueNums(resolvedUserIds);
        return {
          roleName: sourceRole.name,
          roleType: effectiveRoleType,
          sourceRoleId: sourceRole.id,
          targetRoleId: targetRole.id,
          sourceMemberCount: sourceRole.userIds.length,
          resolvedMemberCount: dedupedResolved.length,
          unresolvedMembers,
          resolvedIds: dedupedResolved,
          action: dedupedResolved.length > 0 ? "ready_user_role_update" : "skipped_no_resolved_members",
        };
      });
    };

    const projectedTargetUsers = uniqueUsers([...target.users, ...toAdd]);
    const rolePlanPreview = syncRoles ? buildRolePlan(projectedTargetUsers) : [];

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        tokenSource,
        sourceLookupPath: source.sourcePath,
        targetLookupPath: target.sourcePath,
        counts: {
          sourceUsers: source.users.length,
          targetUsers: target.users.length,
          alreadyPresent: alreadyPresent.length,
          toAdd: toAdd.length,
          sourceRoles: sourceRoles.length,
          targetRoles: targetRoles.length,
          rolesReadyToUpdate: rolePlanPreview.filter((item) => item.action.startsWith("ready_")).length,
          rolesSkipped: rolePlanPreview.filter((item) => item.action.startsWith("skipped_")).length,
        },
        preview: {
          alreadyPresent: alreadyPresent.slice(0, 50),
          toAdd: toAdd.slice(0, 200),
          roles: rolePlanPreview.slice(0, 200),
        },
      });
    }

    const added: ProjectUser[] = [];
    const failed: Array<ProjectUser & { error: string }> = [];

    for (const user of toAdd) {
      try {
        const result = await addCompanyUserToProject({
          accessToken,
          companyId: targetCompanyId,
          projectId: targetProjectId,
          userId: user.id,
        });

        if (result.ok || result.status === 409 || result.status === 422) {
          added.push(user);
          continue;
        }

        failed.push({
          id: user.id,
          name: user.name,
          login: user.login,
          companyName: user.companyName,
          error: `Unexpected status ${result.status}`,
        });
      } catch (error) {
        failed.push({
          id: user.id,
          name: user.name,
          login: user.login,
          companyName: user.companyName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    let rolePlanToExecute = rolePlanPreview;
    if (syncRoles) {
      try {
        const refreshedTarget = await fetchProjectUsers({
          accessToken,
          companyId: targetCompanyId,
          projectId: targetProjectId,
          maxPages,
        });
        rolePlanToExecute = buildRolePlan(refreshedTarget.users);
      } catch {
        // Keep preview-based plan if a refresh fails.
      }
    }

    const rolesCreated: Array<{ roleName: string; roleType: string; roleId: number | null; companyIdUsed: string; pathUsed: string }> = [];
    const rolesCreateFailed: Array<{ roleName: string; roleType: string; error: string }> = [];
    const rolesUpdated: Array<{ roleName: string; roleType: string; roleId: number; memberCount: number }> = [];
    const rolesFailed: Array<{ roleName: string; roleType: string; roleId: number; error: string }> = [];
    const initialSkipped = rolePlanToExecute
      .filter((item) => item.action.startsWith("skipped_"))
      .map((item) => ({
        roleName: item.roleName,
        roleType: item.roleType,
        reason: item.action,
        unresolvedMembers: item.unresolvedMembers,
      }));

    if (syncRoles && createMissingRoles) {
      const projectedUsersAfterAdd = uniqueUsers([...target.users, ...added]);
      const targetRoleKeys = new Set(targetCompanyRoles.map((role) => `${normalize(role.name)}|${role.roleType}`));
      const missingRoles = sourceRoles.filter(
        (role) => !targetRoleKeys.has(`${normalize(role.name)}|${role.roleType}`)
      );
      let roleCreationUnsupported = false;
      let roleCreationUnsupportedReason = "";

      for (const missingRole of missingRoles) {
        if (roleCreationUnsupported) {
          rolesCreateFailed.push({
            roleName: missingRole.name,
            roleType: missingRole.roleType,
            error: roleCreationUnsupportedReason,
          });
          continue;
        }

        if (missingRole.roleType !== "person") {
          rolesCreateFailed.push({
            roleName: missingRole.name,
            roleType: missingRole.roleType,
            error: "Automatic creation currently supports person roles only.",
          });
          continue;
        }

        const resolvedMembers = resolveSourceUserIdsAgainstTargetUsers(missingRole.userIds, projectedUsersAfterAdd);
        const preferredUserId = resolvedMembers[0];

        if (typeof preferredUserId !== "number") {
          rolesCreateFailed.push({
            roleName: missingRole.name,
            roleType: missingRole.roleType,
            error: "No resolvable user_id for role creation. Source role membership may be empty or unmapped in target project users.",
          });
          continue;
        }

        try {
          let createdResult = await createProjectRole({
            accessToken,
            companyIds: [targetCompanyId, sourceCompanyId, fallbackCompanyId],
            projectId: targetProjectId,
            roleName: missingRole.name,
            userId: preferredUserId,
          });

          if (!createdResult.ok && createdResult.status !== 409 && createdResult.status !== 422) {
            const attempts = Array.isArray((createdResult as { attempts?: unknown }).attempts)
              ? (createdResult as { attempts: Array<{ companyId?: unknown; path?: unknown; status?: unknown; payload?: unknown }> }).attempts
              : [];

            const attemptSummary = Array.isArray((createdResult as { attempts?: unknown }).attempts)
              ? (attempts
                  .map((attempt) => {
                    const payloadText = typeof attempt.payload === "string"
                      ? attempt.payload
                      : JSON.stringify(attempt.payload ?? null);
                    return `${readStr(attempt.companyId)} ${readStr(attempt.path)} => ${readNum(attempt.status) ?? "?"} ${payloadText}`;
                  })
                  .join(" | "))
              : "";

            const allAttemptsNotFound = attempts.length > 0 && attempts.every((attempt) => readNum(attempt.status) === 404);
            if (allAttemptsNotFound) {
              roleCreationUnsupported = true;
              roleCreationUnsupportedReason =
                "Target project roles are missing and could not be auto-created (all Procore create attempts returned 404). The User/Vendor Project Role APIs only update existing role memberships. Create matching roles in the target project first, then rerun clone.";
            }

            rolesCreateFailed.push({
              roleName: missingRole.name,
              roleType: missingRole.roleType,
              error: roleCreationUnsupported
                ? `${roleCreationUnsupportedReason}${attemptSummary ? ` Attempts: ${attemptSummary}` : ""}`
                : attemptSummary
                ? `Unexpected status ${createdResult.status}. Attempts: ${attemptSummary}`
                : `Unexpected status ${createdResult.status}`,
            });
            continue;
          }

          const createdPayload = isRecord(createdResult.payload) ? createdResult.payload : null;
          const createdRoleId = createdPayload ? readNum(createdPayload.id) ?? null : null;
          rolesCreated.push({
            roleName: missingRole.name,
            roleType: missingRole.roleType,
            roleId: createdRoleId,
            companyIdUsed: readStr((createdResult as { companyId?: unknown }).companyId),
            pathUsed: readStr((createdResult as { path?: unknown }).path),
          });
        } catch (error) {
          rolesCreateFailed.push({
            roleName: missingRole.name,
            roleType: missingRole.roleType,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (rolesCreated.length > 0) {
        try {
          const refreshedTargetRoles = await fetchProjectRoles({
            accessToken,
            companyIds: [targetCompanyId, sourceCompanyId, fallbackCompanyId],
            projectId: targetProjectId,
            maxPages,
          });
          targetRoles = refreshedTargetRoles.roles;
          const refreshedCompanyRoles = await fetchCompanyRoles({
            accessToken,
            companyIds: [targetCompanyId, sourceCompanyId, fallbackCompanyId],
            maxPages,
          });
          targetCompanyRoles = refreshedCompanyRoles.roles;
          rolePlanToExecute = buildRolePlan(uniqueUsers([...target.users, ...added]));
        } catch {
          // Continue with existing target roles if refresh fails.
        }
      }
    }

    const rolesSkipped = rolePlanToExecute
      .filter((item) => item.action.startsWith("skipped_"))
      .map((item) => ({
        roleName: item.roleName,
        roleType: item.roleType,
        reason: item.action,
        unresolvedMembers: item.unresolvedMembers,
      }));

    if (syncRoles) {
      for (const planItem of rolePlanToExecute) {
        if (!planItem.action.startsWith("ready_") || typeof planItem.targetRoleId !== "number") continue;

        try {
          if (planItem.roleType === "company") {
            await updateVendorProjectRoleMembers({
              accessToken,
              companyId: targetCompanyId,
              projectId: targetProjectId,
              roleId: planItem.targetRoleId,
              vendorIds: toUniqueNums(Array.isArray(planItem.resolvedIds) ? planItem.resolvedIds : []),
            });
            rolesUpdated.push({
              roleName: planItem.roleName,
              roleType: planItem.roleType,
              roleId: planItem.targetRoleId,
              memberCount: Array.isArray(planItem.resolvedIds) ? planItem.resolvedIds.length : 0,
            });
            continue;
          }

          await updateUserProjectRoleMembers({
            accessToken,
            companyId: targetCompanyId,
            projectId: targetProjectId,
            roleId: planItem.targetRoleId,
            userIds: toUniqueNums(Array.isArray(planItem.resolvedIds) ? planItem.resolvedIds : []),
          });
          rolesUpdated.push({
            roleName: planItem.roleName,
            roleType: planItem.roleType,
            roleId: planItem.targetRoleId,
            memberCount: Array.isArray(planItem.resolvedIds) ? planItem.resolvedIds.length : 0,
          });
        } catch (error) {
          rolesFailed.push({
            roleName: planItem.roleName,
            roleType: planItem.roleType,
            roleId: planItem.targetRoleId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const missingTargetRoleSkips = rolesSkipped.filter((item) => item.reason === "skipped_missing_target_role");

    return NextResponse.json({
      success: failed.length === 0 && rolesFailed.length === 0 && rolesCreateFailed.length === 0 && missingTargetRoleSkips.length === 0,
      partialSuccess:
        failed.length === 0 &&
        rolesFailed.length === 0 &&
        missingTargetRoleSkips.length > 0,
      dryRun: false,
      syncRoles,
      createMissingRoles,
      tokenSource,
      sourceLookupPath: source.sourcePath,
      targetLookupPath: target.sourcePath,
      roleLookup: {
        sourceCompanyIdUsed: sourceRoleLookup.companyIdUsed,
        targetCompanyIdUsed: targetRoleLookup.companyIdUsed,
      },
      counts: {
        sourceUsers: source.users.length,
        targetUsersBefore: target.users.length,
        alreadyPresent: alreadyPresent.length,
        attemptedToAdd: toAdd.length,
        added: added.length,
        failed: failed.length,
        sourceRoles: sourceRoles.length,
        targetRoles: targetCompanyRoles.length,
        rolesCreated: rolesCreated.length,
        rolesCreateFailed: rolesCreateFailed.length,
        rolesUpdated: rolesUpdated.length,
        rolesFailed: rolesFailed.length,
        rolesSkippedBeforeCreateAttempt: initialSkipped.length,
        rolesSkipped: rolesSkipped.length,
        rolesMissingTargetRole: missingTargetRoleSkips.length,
      },
      added,
      failed,
      roleSync: {
        created: rolesCreated,
        createFailed: rolesCreateFailed,
        updated: rolesUpdated,
        failed: rolesFailed,
        skipped: rolesSkipped,
        guidance:
          rolesCreateFailed.some((entry) => entry.error.includes("could not be auto-created"))
            ? "Target roles must already exist in the target project for membership sync."
            : undefined,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
