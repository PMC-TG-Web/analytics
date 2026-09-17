export function purchaseOrderIssueUrl(companyId: string, projectId: string, purchaseOrderId: string): string | null {
  if (![companyId, projectId, purchaseOrderId].every(id => /^\d+$/.test(id))) return null;
  return `https://us02.procore.com/webclients/host/companies/${companyId}/projects/${projectId}/tools/contracts/commitments/purchase_order_contracts/${purchaseOrderId}`;
}

export function dailyLogIssueUrl(companyId: string, projectId: string, date: string): string | null {
  if (!/^\d+$/.test(companyId) || !/^\d+$/.test(projectId) || !/^20\d{2}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  return `https://us02.procore.com/webclients/host/companies/${companyId}/projects/${projectId}/tools/dailylog/list?date=${date}`;
}
