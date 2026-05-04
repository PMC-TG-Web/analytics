// User permissions configuration
// Define groups for easier management
export const PERMISSION_GROUPS: Record<string, string[]> = {
  "OWNER": [
    "home", "dashboard", "kpi", "scheduling", "wip", "productivity", "short-term-schedule", "crew-dispatch", "crew-management",
    "long-term-schedule", "concrete-orders-schedule", "project-schedule", "projects", "project",
    "procore", "endpoints", "field", "estimating-tools", "constants", "equipment", 
    "certifications", "employees", "kpi-cards-management", "holidays", "handbook", "diagnostics", "admin", "reporting"
  ],
  "ADMIN": [
    "home", "dashboard", "kpi", "scheduling", "wip", "productivity", "short-term-schedule", "crew-dispatch", "crew-management",
    "long-term-schedule", "concrete-orders-schedule", "project-schedule", "projects", "project",
    "procore", "estimating-tools", "constants", "equipment", 
    "certifications", "employees", "kpi-cards-management", "holidays", "handbook", "reporting"
  ],
  "HR": [
    "home", "certifications", "crew-dispatch", "holidays", "handbook"
  ],
  "ESTIMATOR": [
    "home", "dashboard", "kpi", "scheduling", "wip", "productivity", "project-schedule", "estimating-tools",
    "crew-dispatch", "short-term-schedule", "long-term-schedule", "concrete-orders-schedule", "constants", "handbook"
  ],
  "OPERATIONS": [
    "home", "scheduling", "short-term-schedule", "crew-dispatch", "crew-management", "productivity",
    "long-term-schedule", "concrete-orders-schedule", "project-schedule", "wip", "projects", "field", "equipment", "certifications", "dashboard", "kpi", "handbook"
  ],
  "PMs": [
    "home", "scheduling", "short-term-schedule", "crew-dispatch", "crew-management", "productivity",
    "long-term-schedule", "concrete-orders-schedule", "project-schedule", "project", "wip", "projects", "procore", "equipment", "handbook"
  ],
  "FIELD": [
    "home", "crew-dispatch", "short-term-schedule", "long-term-schedule", "concrete-orders-schedule", "project-schedule", "handbook"
  ],
 
};

type UserPermissionRow = {
  email: string | null;
  permissions: string[] | null;
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
  const sources = [
    process.env.USER_PERMISSIONS_JSON,
    process.env.NEXT_PUBLIC_USER_PERMISSIONS_JSON,
  ];

  for (const raw of sources) {
    if (!raw || !raw.trim()) continue;

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;

      const normalized: Record<string, string[]> = {};
      for (const [email, permissions] of Object.entries(parsed)) {
        if (typeof email !== "string" || !Array.isArray(permissions)) continue;
        const normalizedPermissions = permissions.filter((perm): perm is string => typeof perm === "string");
        if (normalizedPermissions.length > 0) {
          normalized[email.toLowerCase()] = normalizedPermissions;
        }
      }

      return normalized;
    } catch {
      // Ignore malformed JSON and continue to fallback.
    }
  }

  return {};
}

// Load permissions from database (called on middleware initialization)
export async function loadUserPermissionsFromDatabase(prisma: any): Promise<Record<string, string[]>> {
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
  prisma: any,
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
  prisma: any,
  userEmail: string | null,
  page: string
): Promise<boolean> {
  if (!userEmail) return false;
  const permissions = await loadUserAssignedPermissionsFromDatabase(prisma, userEmail);
  return expandAssignedPermissions(permissions).some(p => p.toLowerCase() === page.toLowerCase());
}

// Map user emails to permission groups/pages from database or environment variables.
export let USER_PERMISSIONS: Record<string, string[]> = parseUserPermissionsFromEnv();

let permissionsLoadedFromDb = false;

// Lazy-load permissions from database on first access (if not already loaded)
export async function ensurePermissionsLoaded(prisma: any): Promise<void> {
  if (permissionsLoadedFromDb || Object.keys(USER_PERMISSIONS).length > 0) {
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
  if (permissionsLoadedFromDb || Object.keys(USER_PERMISSIONS).length > 0) {
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

const PATH_PERMISSION_RULES: Array<{ prefix: string; permission: string }> = [
  { prefix: '/auth0-test', permission: 'diagnostics' },
  { prefix: '/procore/test', permission: 'diagnostics' },
  { prefix: '/seed-kpi-cards', permission: 'admin' },
  { prefix: '/test-schedules', permission: 'diagnostics' },
  { prefix: '/debug-cookies', permission: 'diagnostics' },
  { prefix: '/dev-login', permission: 'diagnostics' },
  { prefix: '/diagnostics', permission: 'diagnostics' },
  { prefix: '/employees/handbook', permission: 'handbook' },
  { prefix: '/daily-crew-dispatch-board', permission: 'crew-dispatch' },
  { prefix: '/short-term-schedule', permission: 'short-term-schedule' },
  { prefix: '/long-term-schedule', permission: 'long-term-schedule' },
  { prefix: '/concrete-orders-schedule', permission: 'concrete-orders-schedule' },
  { prefix: '/project-schedule', permission: 'project-schedule' },
  { prefix: '/kpi-cards-management', permission: 'kpi-cards-management' },
    { prefix: '/reporting', permission: 'reporting' },
  { prefix: '/estimating-tools', permission: 'estimating-tools' },
  { prefix: '/crew-management', permission: 'crew-management' },
  { prefix: '/dashboard', permission: 'dashboard' },
  { prefix: '/projects', permission: 'projects' },
  { prefix: '/project', permission: 'project' },
  { prefix: '/procore', permission: 'procore' },
  { prefix: '/scheduling', permission: 'scheduling' },
  { prefix: '/equipment', permission: 'equipment' },
  { prefix: '/holidays', permission: 'holidays' },
  { prefix: '/employees', permission: 'employees' },
  { prefix: '/onboarding', permission: 'onboarding' },
  { prefix: '/endpoints', permission: 'endpoints' },
  { prefix: '/constants', permission: 'constants' },
  { prefix: '/certifications', permission: 'certifications' },
  { prefix: '/kpi', permission: 'kpi' },
  { prefix: '/wip', permission: 'wip' },
  { prefix: '/', permission: 'home' },
];

const API_PERMISSION_RULES: Array<{ prefix: string; permission: string }> = [
  { prefix: '/api/admin', permission: 'admin' },
  { prefix: '/api/debug', permission: 'diagnostics' },
  { prefix: '/api/explore', permission: 'diagnostics' },
  { prefix: '/api/health', permission: 'diagnostics' },
  { prefix: '/api/procore/diagnostics', permission: 'diagnostics' },
  { prefix: '/api/procore/test', permission: 'diagnostics' },
  { prefix: '/api/procore/estimating/bid-board-projects', permission: 'admin' },
  { prefix: '/api/procore/estimating/proposals-bulk', permission: 'admin' },
  { prefix: '/api/procore/estimating/proposal-line-items-bulk', permission: 'admin' },
  { prefix: '/api/procore/sync', permission: 'admin' },
  { prefix: '/api/weather', permission: 'home' },
  { prefix: '/api/gantt-v2/debug-sync', permission: 'diagnostics' },
  { prefix: '/api/gantt-v2/setup', permission: 'admin' },
  { prefix: '/api/gantt-v2', permission: 'project-schedule' },
  { prefix: '/api/kpi-cards/seed', permission: 'admin' },
  { prefix: '/api/crew-templates', permission: 'crew-management' },
  { prefix: '/api/job-titles', permission: 'employees' },
  { prefix: '/api/status', permission: 'projects' },
  { prefix: '/api/short-term-schedule', permission: 'short-term-schedule' },
  { prefix: '/api/concrete-orders', permission: 'crew-dispatch' },
  { prefix: '/api/long-term-schedule', permission: 'long-term-schedule' },
  { prefix: '/api/project-schedule', permission: 'project-schedule' },
  { prefix: '/api/project-scopes', permission: 'project-schedule' },
  { prefix: '/api/schedule-allocations', permission: 'scheduling' },
  { prefix: '/api/scheduling', permission: 'scheduling' },
  { prefix: '/api/dashboard-summary', permission: 'dashboard' },
  { prefix: '/api/estimating-constants', permission: 'estimating-tools' },
  { prefix: '/api/estimates', permission: 'estimating-tools' },
  { prefix: '/api/kpi-cards', permission: 'kpi' },
  { prefix: '/api/kpi', permission: 'kpi' },
  { prefix: '/api/equipment-assignments', permission: 'equipment' },
  { prefix: '/api/equipment', permission: 'equipment' },
  { prefix: '/api/certifications', permission: 'certifications' },
  { prefix: '/api/holidays', permission: 'holidays' },
  { prefix: '/api/employees', permission: 'employees' },
  { prefix: '/api/onboarding-submissions', permission: 'onboarding' },
  { prefix: '/api/projects', permission: 'projects' },
  { prefix: '/api/procore', permission: 'procore' },
];

function normalizePath(pathname: string): string {
  if (!pathname) return '/';
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

export function resolvePermissionForPath(pathname: string): string | null {
  const normalizedPath = normalizePath(pathname);
  const rules = normalizedPath.startsWith('/api/') ? API_PERMISSION_RULES : PATH_PERMISSION_RULES;

  for (const rule of rules) {
    if (rule.prefix === '/') {
      if (normalizedPath === '/') {
        return rule.permission;
      }
      continue;
    }

    if (normalizedPath === rule.prefix || normalizedPath.startsWith(`${rule.prefix}/`)) {
      return rule.permission;
    }
  }

  return null;
}
