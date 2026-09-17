import type { DirectCostIssueSource } from '@/lib/qboDirectCosts';
import { dailyLogIssueUrl, purchaseOrderIssueUrl } from '@/lib/qboIssueLinks';

export default function BillIssue({ message, companyId, projectId, sources }: {
  message: string; companyId: string; projectId: string; sources?: DirectCostIssueSource[];
}) {
  const source = sources?.find(entry => entry.message === message);
  const href = source ? dailyLogIssueUrl(companyId, projectId, source.date) : null;
  const poHref = source?.purchaseOrderId ? purchaseOrderIssueUrl(companyId, projectId, source.purchaseOrderId) : null;
  const isPoIssue = source?.target === 'purchaseOrder';
  const primaryHref = isPoIssue ? poHref : href;
  const primaryLabel = isPoIssue ? 'purchase order' : 'daily log';
  const secondaryHref = isPoIssue ? href : poHref;
  const secondaryLabel = isPoIssue ? 'Open daily log' : 'Open PO';
  const linkStyle = 'text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900';
  return <>
    {primaryHref ? <a href={primaryHref} target="_blank" rel="noopener noreferrer" className={linkStyle} title={`Open this ${primaryLabel} in Procore (new tab)`}>{message}<span className="sr-only"> — opens {primaryLabel} in a new tab</span></a> : message}
    {secondaryHref && <span className="mt-1 block"><a href={secondaryHref} target="_blank" rel="noopener noreferrer" className={linkStyle}>{secondaryLabel}<span className="sr-only"> — opens in a new tab</span></a></span>}
  </>;
}
