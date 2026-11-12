'use client';
import type { EstimateAmount } from '@/lib/kpiEstimateMonthly';

export default function KpiEstimateAmount({ amount, dollars = false, onDetails }: { amount: EstimateAmount; dollars?: boolean; onDetails: () => void }) {
  if (amount.failed) return <span title="Calculated estimates could not be loaded. Retry the report.">Unavailable</span>;
  if (amount.pending) return <span>Loading…</span>;
  return <button type="button" onClick={onDetails} title={amount.missing ? `${amount.missing} project contributions need review; this is a partial amount.` : 'View estimate contributions from October 2026 onward. Totals also retain saved earlier months.'}
    style={{ background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', fontWeight: 700, fontSize: 12, textDecoration: 'underline', padding: 0 }}>
    {dollars ? '$' : ''}{amount.value.toLocaleString('en-US', { maximumFractionDigits: dollars ? 0 : 1 })}{amount.missing ? '*' : ''}
  </button>;
}
