// User permissions configuration
// Define groups for easier management
export const PERMISSION_GROUPS: Record<string, string[]> = {
  "ADMIN": [
    "home", "dashboard", "kpi", "scheduling", "wip", "short-term-schedule", "crew-dispatch",
    "long-term-schedule", "project-schedule", "projects", "employees", 
    "procore", "field", "estimating-tools", "constants", "equipment", 
    "certifications", "onboarding", "kpi-cards-management"
  ],
  "ESTIMATOR": [
    "home", "dashboard", "kpi", "scheduling", "wip", "project-schedule", "estimating-tools",
    "crew-dispatch", "short-term-schedule", "long-term-schedule","constants"
  ],
  "OPERATIONS": [
    "home", "scheduling", "short-term-schedule", "crew-dispatch",
    "long-term-schedule", "project-schedule"
  ],
  "FIELD": [
    "home", "crew-dispatch", "short-term-schedule", "long-term-schedule", "project-schedule"
  ],
  "HR": [
    "home", "employees", "certifications", "onboarding"
  ]
};

// Map Procore email addresses to groups or specific pages
export const USER_PERMISSIONS: Record<string, string[]> = {
  "todd@pmcdecor.com": ["ADMIN"], // Full access
  "levi@paradise-concrete.com": ["ADMIN"],
  "rick@pmcdecor.com": ["ADMIN"],
  "shelly@pmcdecor.com": ["ADMIN"],
  "isaac@pmcdecor.com": ["ESTIMATOR"] // Upgraded to Admin
};

export function hasPageAccess(userEmail: string | null, page: string): boolean {
  // All access granted globally
  return true;
}

export function getUserPermissions(userEmail: string | null): string[] {
  if (!userEmail) return [];
  
  const userPerms = USER_PERMISSIONS[userEmail.toLowerCase()];
  if (!userPerms) return [];

  const allPages = new Set<string>();
  
  userPerms.forEach(perm => {
    if (PERMISSION_GROUPS[perm]) {
      // It's a group, add all pages from it
      PERMISSION_GROUPS[perm].forEach(page => allPages.add(page));
    } else {
      // It's a specific page
      allPages.add(perm);
    }
  });

  return Array.from(allPages);
}
