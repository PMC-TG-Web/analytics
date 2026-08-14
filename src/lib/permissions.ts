import { PATH_PERMISSION_RULES } from './permissionRoutes.js';

export { resolvePermissionForPath } from './permissionRoutes.js';

// User permissions configuration
// Define groups for easier management
export const PERMISSION_GROUPS: Record<string, string[]> = {
  "OWNER": [
    "home", "dashboard", "kpi", "scheduling", "wip", "productivity", "short-term-schedule", "crew-dispatch", "crew-management",
    "long-term-schedule", "concrete-orders-schedule", "project-schedule", "projects", "project",
    "procore", "endpoints", "field", "estimating-tools", "constants", "equipment", 
    "employees", "certifications", "onboarding", "kpi-cards-management", "holidays", "handbook", "diagnostics", "admin", "reporting", "analytics", "analytics-cost-code-sales", "accounting-project-profitability",
    "procore-timecards", "procore-line-items", "procore-commitments", "procore-scope-map"
  ],
  "ADMIN": [
    "home", "dashboard", "kpi", "scheduling", "wip", "productivity", "short-term-schedule", "crew-dispatch", "crew-management",
    "long-term-schedule", "concrete-orders-schedule", "project-schedule", "projects", "project",
    "procore", "estimating-tools", "constants", "equipment", 
    "employees", "certifications", "onboarding", "kpi-cards-management", "holidays", "handbook", "admin", "reporting", "analytics", "analytics-cost-code-sales", "accounting-project-profitability",
    "procore-timecards", "procore-line-items", "procore-commitments", "procore-scope-map"
  ],
  "HR": [
    "home", "employees", "certifications", "onboarding", "crew-dispatch", "holidays", "handbook"
  ],
  "ESTIMATOR": [
    "home", "dashboard", "kpi", "scheduling", "wip", "productivity", "project-schedule", "estimating-tools",
    "crew-dispatch", "short-term-schedule", "long-term-schedule", "concrete-orders-schedule", "constants", "handbook", "analytics", "analytics-cost-code-sales"
  ],
  "OPERATIONS": [
    "home", "scheduling", "short-term-schedule", "crew-dispatch", "crew-management", "productivity",
    "long-term-schedule", "concrete-orders-schedule", "project-schedule", "wip", "projects", "field", "equipment", "certifications", "dashboard", "kpi", "handbook"
  ],
  "PMs": [
    "home", "scheduling", "short-term-schedule", "crew-dispatch", "crew-management", "productivity",
    "long-term-schedule", "concrete-orders-schedule", "project-schedule", "project", "wip", "projects", "equipment", "handbook"
  ],
  "FIELD": [
    "home", "crew-dispatch", "short-term-schedule", "long-term-schedule", "concrete-orders-schedule", "project-schedule", "handbook"
  ],
 
};

const JOB_TITLE_TO_PERMISSION_GROUP: Record<string, keyof typeof PERMISSION_GROUPS> = {
  "executive": "OWNER",
  "owner": "OWNER",
  "admin": "ADMIN",
  "administrator": "ADMIN",
  "office staff": "HR",
  "office": "HR",
  "hr": "HR",
  "estimator": "ESTIMATOR",
  "operations": "OPERATIONS",
  "project manager": "PMs",
  "pm": "PMs",
  "superintendent": "FIELD",
  "foreman": "FIELD",
  "field worker": "FIELD",
  "field": "FIELD",
};

export const JOB_TITLE_TEMPLATE_CATEGORY = "PermissionTemplate";
export const JOB_TITLE_TEMPLATE_PREFIX = "job-title-template:";

export function normalizeJobTitleTemplateKey(jobTitle: string | null | undefined): string {
  if (!jobTitle) return "";
  return jobTitle
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function buildJobTitleTemplateConstantName(jobTitle: string): string {
  return `${JOB_TITLE_TEMPLATE_PREFIX}${normalizeJobTitleTemplateKey(jobTitle)}`;
}

function resolvePermissionGroupForJobTitle(jobTitle: string | null | undefined): keyof typeof PERMISSION_GROUPS | null {
  const normalized = normalizeJobTitleTemplateKey(jobTitle);
  if (!normalized) return null;

  const exactMatch = JOB_TITLE_TO_PERMISSION_GROUP[normalized];
  if (exactMatch) return exactMatch;

  if (normalized.includes("estimat")) return "ESTIMATOR";
  if (normalized.includes("project manager")) return "PMs";
  if (normalized.includes("superintendent") || normalized.includes("foreman") || normalized.includes("field")) return "FIELD";
  if (normalized.includes("operations")) return "OPERATIONS";
  if (normalized.includes("office") || normalized.includes("human resources") || normalized === "hr") return "HR";
  if (normalized.includes("owner") || normalized.includes("executive")) return "OWNER";

  return null;
}

export function getTemplatePermissionsForJobTitle(jobTitle: string | null | undefined): string[] {
  const group = resolvePermissionGroupForJobTitle(jobTitle);
  if (!group) return [];
  return [...PERMISSION_GROUPS[group]];
}

export const JOB_TITLE_PERMISSION_TEMPLATES: Record<string, string[]> = Object.keys(JOB_TITLE_TO_PERMISSION_GROUP)
  .sort((a, b) => a.localeCompare(b))
  .reduce<Record<string, string[]>>((acc, title) => {
    const group = JOB_TITLE_TO_PERMISSION_GROUP[title];
    acc[title] = [...PERMISSION_GROUPS[group]];
    return acc;
  }, {});

type UserPermissionRow = {
  email: string | null;
  permissions: string[] | null;
};

type RawQueryClient = {
  $queryRaw<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
};

function normalizeAssignedPermissions(permissions: unknown): string[] {
  if (!Array.isArray(permissions)) return [];
  return permissions.filter((perm): perm is string => typeof perm === "string" && perm.trim().length > 0);
}

export function expandAssignedPermissions(permissions: string[]): string[] {
  const allPages = new Set<string>();

  permissions.forEach(perm => {
    const normalizedPermission = perm.trim();
    const groupKey = Object.keys(PERMISSION_GROUPS).find(
      key => key.toLowerCase() === normalizedPermission.toLowerCase()
    );

    if (groupKey) {
      PERMISSION_GROUPS[groupKey].forEach(page => allPages.add(page));
    } else {
      allPages.add(normalizedPermission);
    }
  });

  return Array.from(allPages);
}

function parseUserPermissionsFromEnv(): Record<string, string[]> {
  // Production hardening: permissions must come from the database only.
  // Keep this function for API compatibility, but disable env-based sources.
  return {};
}

// Load permissions from database (called on middleware initialization)
export async function loadUserPermissionsFromDatabase(prisma: RawQueryClient): Promise<Record<string, string[]>> {
  try {
    const users = await prisma.$queryRaw<UserPermissionRow[]>`
      SELECT "email", "permissions"
      FROM "User"
      WHERE "isActive" = true
      ORDER BY "email" ASC
    `;
    
    const perms: Record<string, string[]> = {};
    for (const user of users) {
      const permissions = normalizeAssignedPermissions(user.permissions);
      if (user.email && permissions.length > 0) {
        perms[user.email.toLowerCase()] = permissions;
      }
    }
    
    return perms;
  } catch (error) {
    console.error("Failed to load permissions from database:", error);
    return {};
  }
}

export async function loadUserAssignedPermissionsFromDatabase(
  prisma: RawQueryClient,
  userEmail: string | null
): Promise<string[]> {
  if (!userEmail) return [];

  try {
    const users = await prisma.$queryRaw<UserPermissionRow[]>`
      SELECT "email", "permissions"
      FROM "User"
      WHERE lower("email") = ${userEmail.toLowerCase()}
        AND "isActive" = true
      LIMIT 1
    `;

    return normalizeAssignedPermissions(users[0]?.permissions);
  } catch (error) {
    console.error("Failed to load user permissions from database:", error);
    return [];
  }
}

export async function hasDatabasePageAccess(
  prisma: RawQueryClient,
  userEmail: string | null,
  page: string
): Promise<boolean> {
  if (!userEmail) return false;
  const permissions = await loadUserAssignedPermissionsFromDatabase(prisma, userEmail);
  return expandAssignedPermissions(permissions).some(p => p.toLowerCase() === page.toLowerCase());
}

// Map user emails to permission groups/pages from database or environment variables.
export const USER_PERMISSIONS: Record<string, string[]> = parseUserPermissionsFromEnv();

let permissionsLoadedFromDb = false;

// Lazy-load permissions from database on first access (if not already loaded)
export async function ensurePermissionsLoaded(prisma: RawQueryClient): Promise<void> {
  if (permissionsLoadedFromDb) {
    return; // Already loaded
  }

  try {
    const dbPerms = await loadUserPermissionsFromDatabase(prisma);
    if (Object.keys(dbPerms).length > 0) {
      Object.keys(USER_PERMISSIONS).forEach(key => delete USER_PERMISSIONS[key]);
      Object.assign(USER_PERMISSIONS, dbPerms);
      permissionsLoadedFromDb = true;
      console.log(`✓ Loaded ${Object.keys(dbPerms).length} users from database permissions`);
    }
  } catch (error) {
    console.error("Failed to lazy-load permissions from database:", error);
  }
}

// Initialize permissions from database (called from root layout)
export async function initializePermissions(): Promise<void> {
  if (permissionsLoadedFromDb) {
    return; // Already initialized
  }

  try {
    const { prisma } = await import("@/lib/prisma");
    const dbPerms = await loadUserPermissionsFromDatabase(prisma);
    if (Object.keys(dbPerms).length > 0) {
      Object.keys(USER_PERMISSIONS).forEach(key => delete USER_PERMISSIONS[key]);
      Object.assign(USER_PERMISSIONS, dbPerms);
      permissionsLoadedFromDb = true;
      console.log(`✓ Initialized ${Object.keys(dbPerms).length} users from database permissions`);
    }
  } catch (error) {
    console.error("Failed to initialize permissions from database:", error);
    // Will fall back to env var permissions if available
  }
}

export function hasPageAccess(userEmail: string | null, page: string): boolean {
  if (!userEmail) return false;
  const permissions = getUserPermissions(userEmail);
  return permissions.some(p => p.toLowerCase() === page.toLowerCase());
}

export function getUserPermissions(userEmail: string | null): string[] {
  if (!userEmail) return [];
  
  const userPerms = USER_PERMISSIONS[userEmail.toLowerCase()];
  if (!userPerms) return [];
  return expandAssignedPermissions(userPerms);
}

export function getUserAssignedPermissions(userEmail: string | null): string[] {
  if (!userEmail) return [];
  return USER_PERMISSIONS[userEmail.toLowerCase()] || [];
}

export const NAVIGATION_PERMISSION_OPTIONS: string[] = Array.from(
  new Set([
    ...Object.values(PERMISSION_GROUPS).flat(),
    ...PATH_PERMISSION_RULES.map((rule) => rule.permission),
    'analytics-cost-code-sales',
    'accounting-project-profitability',
    'procore-timecards',
    'procore-line-items',
    'procore-commitments',
    'procore-scope-map',
  ])
)
  .map((permission) => permission.trim())
  .filter((permission) => permission.length > 0)
  .sort((a, b) => a.localeCompare(b));
