// User permissions configuration
// Define groups for easier management
export const PERMISSION_GROUPS: Record<string, string[]> = {
  "OWNER": [
    "home", "dashboard", "kpi", "scheduling", "wip", "productivity", "short-term-schedule", "crew-dispatch",
    "long-term-schedule", "project-schedule", "projects", "project",
    "procore", "endpoints", "field", "estimating-tools", "constants", "equipment", 
    "certifications", "onboarding", "kpi-cards-management", "holidays", "handbook"
  ],
  "ADMIN": [
    "home", "dashboard", "kpi", "scheduling", "wip", "productivity", "short-term-schedule", "crew-dispatch",
    "long-term-schedule", "project-schedule", "projects", "project",
     "estimating-tools", "constants", "equipment", 
    "certifications", "kpi-cards-management", "holidays", "handbook"
  ],
  "HR": [
    "home", "certifications", "onboarding", "crew-dispatch", "holidays", "handbook"
  ],
  "ESTIMATOR": [
    "home", "dashboard", "kpi", "scheduling", "wip", "productivity", "project-schedule", "estimating-tools",
    "crew-dispatch", "short-term-schedule", "long-term-schedule", "constants", "handbook"
  ],
  "OPERATIONS": [
    "home", "scheduling", "short-term-schedule", "crew-dispatch", "productivity",
    "long-term-schedule", "project-schedule", "wip", "projects", "field", "equipment", "certifications", "dashboard", "kpi", "handbook"
  ],
  "PMs": [
    "home", "scheduling", "short-term-schedule", "crew-dispatch", "productivity",
    "long-term-schedule", "project-schedule", "wip", "projects", "equipment", "handbook"
  ],
  "FIELD": [
    "home", "crew-dispatch", "short-term-schedule", "long-term-schedule", "project-schedule", "handbook"
  ],
 
};

// Map Procore email addresses to groups or specific pages
export const USER_PERMISSIONS: Record<string, string[]> = {
  // OWNER access + Personnel Management (employees page)
  "todd@pmcdecor.com": ["OWNER", "employees"],
  
  "levi@paradise-concrete.com": ["ADMIN"],
  "rick@pmcdecor.com": ["ADMIN"],
  "shelly@pmcdecor.com": ["ADMIN"],

  // HR access + Personnel Management (employees page)
  "jane@pmcdecor.com": ["HR", "employees"],
  
  // Personnel Management access only
  "dave@pmcdecor.com": ["employees"],


// PM access
"mervin@pmcdecor.com": ["PMs"],
"abner@pmcdecor.com": ["PMs"],

// Operations access
"john@pmcdecor.com": ["OPERATIONS"],

  //Estimator access
  "isaac@pmcdecor.com": ["ESTIMATOR"] 
};

export function hasPageAccess(userEmail: string | null, page: string): boolean {
  if (!userEmail) return false;
  const permissions = getUserPermissions(userEmail);
  return permissions.some(p => p.toLowerCase() === page.toLowerCase());
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
