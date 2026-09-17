type CustomerOption = { id: string; name: string; fullName: string };

// Only case and spacing are ignored. Similar names and duplicate project names
// under different parents require a choice; existing saved IDs take precedence.
export function matchQboCustomer(projectName: string, customers: CustomerOption[]) {
  const normalize = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
  const target = normalize(projectName);
  if (!target) return null;
  const matches = customers.filter(customer => normalize(customer.name) === target || normalize(customer.fullName) === target);
  return matches.length === 1 ? matches[0].id : null;
}
