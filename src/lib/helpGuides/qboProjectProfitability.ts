import { defineGuide } from './defineGuide.ts';

export const qboProjectProfitabilityGuide = defineGuide('qbo-project-profitability', {
  updated: '2026-11-12',
  purpose: 'See how each job is doing in the books: what has been billed, what it has cost, the profit, and what the customer still owes. The numbers come from QuickBooks Online (QBO), the company’s accounting system, and each job is lined up with its Procore project. You can also compare QuickBooks costs with Procore direct costs. The page only reads: it never changes anything in QuickBooks or Procore.',
  steps: [
    {
      title: 'Check how current the report is',
      body: [
        'The box at the top right shows the report’s date range, the accounting basis (for example “Accrual basis”) and when it was imported.',
        'The page shows a **snapshot**: a saved copy of the QuickBooks figures taken at that import time. Newer activity appears only after a new snapshot is imported.',
        'The newest snapshot opens first. Use **Imported snapshot** to open an earlier one.',
      ],
    },
    {
      title: 'Read the cards across the top',
      body: [
        'The first card, **Sold** followed by the current year, is the contract value of jobs sold this year. It does not change when you filter the table.',
        '**QBO actual cost**, **Procore direct cost**, **Matched QBO minus Procore**, **Profit** and **A/R outstanding** add up the rows currently in the table.',
        '**Rows in view** counts those rows.',
      ],
    },
    {
      title: 'Find a job',
      body: [
        'Type part of a QuickBooks name, Procore name or job number in **Search projects**.',
        '**Record type** starts on “Projects”. Choose “Customer-only review” to see money posted to a customer instead of to one of its jobs, or “All records” to see both.',
        '**Procore match**: “Matched” shows rows tied to a Procore project. “Needs review” shows rows that are not.',
        'Rows that need review are usually customer-only records. Set **Record type** to “All records” when you choose “Needs review”.',
        '**Procore status** narrows the table to one project status.',
      ],
    },
    {
      title: 'Read across a row',
      body: 'Each row is one QuickBooks job. From left to right it shows the matching Procore project, the contract value, what has been billed, what is owed, the costs, and the profit. The table under “How to read it” explains each column.',
    },
    {
      title: 'Open a job for detail',
      body: [
        'Click the row, or its **Open** button, to see the detail underneath.',
        'The first line gives the billing totals: **P&L net billed**, **Contract value**, **Remaining to bill**, **Gross invoices**, **Collected**, **Outstanding** and **Overdue**.',
        '**P&L billing activity** lists the invoices, credit memos and other entries that add up to net billed.',
        '**Invoice documents** lists each invoice with its total and its unpaid balance.',
        'Below these, each cost transaction is listed with its date, type, number, description and amount. **QBO cost section totals** sums them by cost section.',
        'Check dates, amounts and descriptions before you explain a difference. Click **Close** to hide the detail.',
      ],
    },
    {
      title: 'Export or refresh',
      body: [
        '**Export view** downloads the rows currently in the table as a spreadsheet file (CSV). It includes extra columns, such as the Procore base estimate and approved change orders.',
        '**Refresh costs** asks for a new snapshot from QuickBooks and Procore. It can take several minutes.',
        'Keep the page open and read the green progress message. When the refresh finishes, the new snapshot loads by itself.',
        'The previous snapshot stays available while the refresh runs.',
      ],
    },
  ],
  data: [
    'QuickBooks: a separate read-only connection copies the profit and loss (P&L) report by job, plus customers, invoices, estimates and transactions, into a dated snapshot.',
    'Procore direct cost is read from each matched project’s Direct Costs in Procore when the snapshot is made, and is saved with it.',
    'Project status and contract value are not part of the snapshot. Analytics adds the current values it has saved from Procore. Opening an old snapshot therefore still shows today’s status and contract value.',
    'Contract value for a matched job is the Procore primary estimate plus approved change orders. A record with no Procore match uses its QuickBooks estimate total. The small label under the amount names the source.',
    'Sales, costs, profit and margin cover only the snapshot’s date range. Net billed counts income posted over the whole life of the job.',
    'The **Sold** card always uses the newest snapshot. It ignores the table filters and the **Imported snapshot** choice.',
    'The **Sold** card leaves out jobs whose current Bid Board status is Accepted, because an accepted bid is not yet won. This applies even when the job’s Procore project status shows In Progress. Financial WIP uses the same rule.',
    'A job’s sold year comes from the Contract Date in Procore (Project > Additional Information > Contract Date), the same field Financial WIP uses. If that date is missing or invalid, the year in the job number is used, and after that the project start date.',
    'The **Sold** total can still differ from Financial WIP, because the two pages do not use exactly the same list of jobs or the same contract values.',
    'QuickBooks jobs that have been marked as excluded from this report do not appear.',
  ],
  terms: [
    ['QuickBooks project', 'The job’s full name in QuickBooks. An “Inactive” tag means the job is marked inactive there.'],
    ['Procore match', 'The Procore project name and number tied to this QuickBooks job. “—” means there is none.'],
    ['Contract value', 'The total expected to be billed for the job. The label beneath names the source: “Procore estimate”, “Procore estimate + approved CO” (CO means change order), or a count of QBO estimates. More than one QBO estimate is marked “review”.'],
    ['Procore value unavailable / No contract source', 'No contract value could be found. The contract value and the billing percent are left blank.'],
    ['Net billed', 'Income posted to the job in QuickBooks over its whole life. Credit memos and other adjustments are included, so it can differ from the total of the invoices.'],
    ['Red “vs sales” note', 'Shown under Net billed when it differs from sales inside the snapshot’s date range. The amount is the difference, usually income posted before the date range began.'],
    ['Billing', 'Net billed divided by contract value, shown as a percent “of contract”.'],
    ['A/R', 'Accounts receivable: the unpaid balance of the job’s invoices. A red “overdue” line shows the part that was past its due date when the snapshot was taken. Work not yet invoiced is not included.'],
    ['QBO actual cost', 'Costs posted to the job in QuickBooks within the date range: cost of goods sold, expenses and other expenses.'],
    ['Procore direct cost', 'The job’s Direct Costs total in Procore. “—” means it was not available.'],
    ['QBO − Procore', 'QBO actual cost minus Procore direct cost. Red means QuickBooks holds more cost. A gap is a prompt to look, **not** proof of an error: timing, and the fact that the two systems do not always cover the same costs or dates, can explain it.'],
    ['Profit', 'Sales plus other income, minus QBO actual cost, within the date range. Green is a profit; red is a loss.'],
    ['Margin', 'Profit divided by sales, as a percent. “—” means the job has no sales in the date range.'],
    ['Status', 'The project’s current status from Procore, using the Bid Board status when there is one. “Status unavailable” means no status is saved. “No Procore match” means the row is not tied to a Procore project.'],
    ['Customer-only review', 'A QuickBooks customer record that is not a job. Money shows here when it was posted to the customer instead of to one of its jobs.'],
    ['A row of zeros', 'Either a job with no QuickBooks activity in the date range, or a Procore project that has no QuickBooks job matched to it. The second kind is listed under its Procore name, and in the export its Match column reads “procore-only”.'],
  ],
  example: 'A job has a $100,000 contract value and $60,000 net billed, so Billing shows 60.0% of contract. Inside the date range it has $60,000 of sales, $40,000 of actual cost and no other income. Profit is $20,000 and Margin is 33.3%. If $15,000 of its invoices are unpaid, A/R shows $15,000. That is a collection question, separate from profit.',
  checks: [
    'Before you compare this page with another report, match the date range, the accounting basis, the filters and the contract value source. Different date ranges give different numbers.',
    'A job is missing: clear **Search projects**, set **Record type** to “All records”, and set **Procore match** to “All” and **Procore status** to “All statuses”. If it is still missing, it may be unmatched between the two systems, have a Procore status this report does not include, or be excluded. Compare the job’s name and number in QuickBooks and Procore.',
    'A yellow box says the latest refresh contained no project records: the page is showing the previous saved report. Check the import time at the top, and try **Refresh costs** again later.',
    'The refresh fails, or a red message says refresh is not configured: the table still shows the earlier snapshot. Reloading the browser page does not bring in new accounting activity. Tell the administrator.',
    'The refresh is still running after 45 minutes: the page stops waiting and says so. The earlier snapshot is still shown.',
    'Opening a job shows “No QBO line item details were found for this project”: that snapshot holds no transaction detail for the job.',
    'A cost or an invoice is on the wrong job: accounting must correct it in QuickBooks, then use **Refresh costs**. Nothing can be edited on this page.',
    'You cannot open the page: it needs the QBO P&L permission or administrator access.',
  ],
});
