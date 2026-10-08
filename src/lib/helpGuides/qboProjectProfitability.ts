import { defineGuide } from './defineGuide.ts';

export const qboProjectProfitabilityGuide = defineGuide('qbo-project-profitability', {
  purpose: 'Review recorded project income, actual costs, profit, billing, and money owed by customers. Compare QBO costs with Procore direct costs. This page reads reports and does not change QuickBooks or Procore business records.',
  steps: [
    { title: 'Read the snapshot banner', body: 'Check the reporting window, accounting basis, and import date. The page starts with the newest snapshot; Imported snapshot selects an earlier one.' },
    { title: 'Filter records', body: 'Use Search projects, Record type, Procore match, and Procore status. Customer-only review helps locate activity assigned to a parent customer.' },
    { title: 'Expand a project', body: 'Inspect billing activity, invoice balances, and cost transactions. Check dates, amounts, and memos before explaining a difference.' },
    { title: 'Export or refresh', body: 'Export view downloads filtered rows. Refresh costs requests a new snapshot and can take several minutes. Read its progress message; the previous snapshot stays available while it runs.' },
  ],
  data: ['A controlled integration imports dated QuickBooks P&L, customer, invoice, estimate, and transaction information. Procore direct-cost comparisons are captured with that snapshot.', 'Analytics adds current stored Procore status and contract information. Matched contract value here uses the selected primary estimate plus approved change orders; unmatched records can use QBO estimates. Read the source label.', 'Sales and costs cover the snapshot window. Net billed uses lifetime posted income. Selecting an old snapshot does not rewind current project status.', 'The Sold year card uses the newest snapshot population independently of table filters. Its sold year uses Procore Project > Additional Information > Contract Date first, the same field as Financial WIP, followed by the job-number year and then project start date when the preceding source is missing or invalid. Its project population and contract-value basis can still differ from Financial WIP.'],
  terms: [
    ['Contract value', 'Expected total billing from the displayed source. Multiple QBO estimates need review; unavailable values leave related calculations blank.'],
    ['Net billed / Billing %', 'Lifetime net posted income and that amount divided by contract value. Credits and other entries can make it differ from gross invoices.'],
    ['A/R / Overdue', 'Unpaid invoice balances and the past-due portion as of the snapshot, separate from work not yet billed.'],
    ['QBO actual cost', 'Project cost of goods sold, expenses, and other expenses within the snapshot window.'],
    ['QBO − Procore', 'QBO actual cost less Procore direct cost. Positive means QBO carries more cost; timing and cost coverage can explain differences.'],
    ['Profit / Margin', 'Sales plus other income less actual cost; margin divides profit by sales. Zero sales leaves margin unavailable.'],
    ['Procore-only / Needs review', 'A project without a usable QBO match, or a record needing matching review. Ambiguous matching can affect the visible population.'],
  ],
  example: '$100,000 contract value with $60,000 net billed means 60% billed. If report-window sales are $60,000 and actual costs are $40,000 with no other income, profit is $20,000 and margin is about 33.3%. Unpaid invoices are a separate collection question.',
  checks: ['Check snapshot dates, accounting basis, filters, match, and contract source before comparing reports. A color-coded difference is a review prompt, not proof of an accounting error.', 'A missing project can reflect ambiguous matching, source status, or an exclusion. Check the project name and number in both systems.', 'If refresh fails or is unconfigured, the visible report still uses the earlier snapshot. Reloading the page alone does not produce new accounting activity.', 'Correct source coding through the accounting workflow, then refresh. QBO P&L itself is read-only.'],
});
