import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getClientCredentialsToken, procoreConfig } from "@/lib/procore";

export const dynamic = "force-dynamic";

type UnknownRecord = Record<string, unknown>;

type ProjectUser = {
  id: number;
  name: string;
  login: string;
};

type ProjectRoleRecord = {
  id: number;
  name: string;
  roleType: "person" | "company";
  userIds: number[];
  vendorIds: number[];
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

function parseProjectRoleRow(row: UnknownRecord): ProjectRoleRecord | null {
  const id = readNum(row.id);
  const name = readStr(row.role || row.name || row.title);
  if (id === undefined || !name) return null;

  const usersFromArray = Array.isArray(row.users)
    ? row.users.map((entry) => {
        if (!isRecord(entry)) return undefined;
        return readNum(entry.id ?? entry.user_id);
      })
    : [];

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
    ...(Array.isArray(row.user_ids) ? row.user_ids : []),
    ...usersFromArray,
  ]);
  const vendorIds = toUniqueNums([
    ...(Array.isArray(row.vendor_ids) ? row.vendor_ids : []),
    ...(Array.isArray(row.company_ids) ? row.company_ids : []),
    ...vendorsFromArray,
    ...companysFromArray,
  ]);

  const explicitRoleType = normalizeRoleType(row.type || row.role_type || row.member_type);
  const roleType = explicitRoleType === "person" && vendorIds.length > 0 && userIds.length === 0
    ? "company"
    : explicitRoleType;

  return {
    id,
    name,
    roleType,
    userIds,
    vendorIds,
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
  const seen = new Set<number>();
  const users: ProjectUser[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    users.push(row);
  }
  return users;
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

async function fetchProjectRoles(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  maxPages: number;
}): Promise<ProjectRoleRecord[]> {
  const collected: ProjectRoleRecord[] = [];

  for (let page = 1; page <= params.maxPages; page += 1) {
    const path = `/rest/v1.0/project_roles?project_id=${encodeURIComponent(params.projectId)}&page=${page}&per_page=100`;
    const result = await procoreJson({
      accessToken: params.accessToken,
      companyId: params.companyId,
      path,
    });

    const pageRows = asArray(result.payload)
      .map(parseProjectRoleRow)
      .filter((row): row is ProjectRoleRecord => row !== null);

    if (pageRows.length === 0) break;
    collected.push(...pageRows);
    if (pageRows.length < 100) break;
  }

  const byKey = new Map<string, ProjectRoleRecord>();
  for (const role of collected) {
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
    });
  }

  return [...byKey.values()];
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

    const [sourceRoles, targetRoles] = syncRoles
      ? await Promise.all([
          fetchProjectRoles({
            accessToken,
            companyId: sourceCompanyId,
            projectId: sourceProjectId,
            maxPages,
          }),
          fetchProjectRoles({
            accessToken,
            companyId: targetCompanyId,
            projectId: targetProjectId,
            maxPages,
          }),
        ])
      : [[], []];

    const targetById = new Set(target.users.map((user) => String(user.id)));
    const targetByLogin = new Set(target.users.map((user) => normalize(user.login)).filter(Boolean));
    const targetByName = new Set(target.users.map((user) => normalize(user.name)).filter(Boolean));

    const alreadyPresent: ProjectUser[] = [];
    const toAdd: ProjectUser[] = [];

    const sourceUsersById = new Map(source.users.map((user) => [String(user.id), user] as const));

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

      return sourceRoles.map((sourceRole) => {
        const targetRole = targetRoles.find(
          (candidate) => normalize(candidate.name) === normalize(sourceRole.name) && candidate.roleType === sourceRole.roleType
        );

        if (!targetRole) {
          return {
            roleName: sourceRole.name,
            roleType: sourceRole.roleType,
            sourceRoleId: sourceRole.id,
            targetRoleId: null,
            sourceMemberCount: sourceRole.roleType === "person" ? sourceRole.userIds.length : sourceRole.vendorIds.length,
            resolvedMemberCount: 0,
            unresolvedMembers: sourceRole.roleType === "person"
              ? sourceRole.userIds.map((id) => String(id))
              : sourceRole.vendorIds.map((id) => String(id)),
            action: "skipped_missing_target_role",
          };
        }

        if (sourceRole.roleType === "company") {
          const resolvedVendorIds = toUniqueNums(sourceRole.vendorIds);
          return {
            roleName: sourceRole.name,
            roleType: sourceRole.roleType,
            sourceRoleId: sourceRole.id,
            targetRoleId: targetRole.id,
            sourceMemberCount: sourceRole.vendorIds.length,
            resolvedMemberCount: resolvedVendorIds.length,
            unresolvedMembers: [] as string[],
            resolvedIds: resolvedVendorIds,
            action: "ready_vendor_role_update",
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
          roleType: sourceRole.roleType,
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

        failed.push({ id: user.id, name: user.name, login: user.login, error: `Unexpected status ${result.status}` });
      } catch (error) {
        failed.push({
          id: user.id,
          name: user.name,
          login: user.login,
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

    const rolesUpdated: Array<{ roleName: string; roleType: string; roleId: number; memberCount: number }> = [];
    const rolesFailed: Array<{ roleName: string; roleType: string; roleId: number; error: string }> = [];
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

    return NextResponse.json({
      success: failed.length === 0 && rolesFailed.length === 0,
      dryRun: false,
      syncRoles,
      tokenSource,
      sourceLookupPath: source.sourcePath,
      targetLookupPath: target.sourcePath,
      counts: {
        sourceUsers: source.users.length,
        targetUsersBefore: target.users.length,
        alreadyPresent: alreadyPresent.length,
        attemptedToAdd: toAdd.length,
        added: added.length,
        failed: failed.length,
        sourceRoles: sourceRoles.length,
        targetRoles: targetRoles.length,
        rolesUpdated: rolesUpdated.length,
        rolesFailed: rolesFailed.length,
        rolesSkipped: rolesSkipped.length,
      },
      added,
      failed,
      roleSync: {
        updated: rolesUpdated,
        failed: rolesFailed,
        skipped: rolesSkipped,
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
