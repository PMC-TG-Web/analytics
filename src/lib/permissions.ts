// User permissions configuration
// Map Procore email addresses to allowed pages

export const USER_PERMISSIONS: Record<string, string[]> = {
  // Admin - full access
  "todd@pmcdecor.com": ["dashboard", "kpi", "scheduling", "wip", "long-term-schedule", "procore"],
  
  // Full access
  "levi@pmcdecor.com": ["dashboard", "kpi", "scheduling", "wip", "long-term-schedule", "procore"],
  "isaac@pmcdecor.com": ["dashboard", "kpi", "scheduling", "wip", "long-term-schedule", "procore"],
  "levi@paradise-concrete.com": ["dashboard", "kpi", "scheduling", "wip", "long-term-schedule", "procore"],
  "rick@pmcdecor.com": ["dashboard", "kpi", "scheduling", "wip", "long-term-schedule", "procore"],
  
  // Add more users here:
  // "manager@pmcdecor.com": ["dashboard", "kpi", "scheduling"],
  // "viewer@pmcdecor.com": ["dashboard"],
};

export function hasPageAccess(userEmail: string | null, page: string): boolean {
  if (!userEmail) return false;

  if (page === "wip") return true;
  
  const permissions = USER_PERMISSIONS[userEmail.toLowerCase()];
  if (!permissions) return false;
  
  return permissions.includes(page);
}

export function getUserPermissions(userEmail: string | null): string[] {
  if (!userEmail) return [];
  return USER_PERMISSIONS[userEmail.toLowerCase()] || [];
}
