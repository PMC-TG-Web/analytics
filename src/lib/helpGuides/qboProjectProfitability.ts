import type { HelpGuide } from './types.ts';

export const qboProjectProfitabilityGuide: HelpGuide = {
  slug: 'qbo-project-profitability',
  title: 'QBO P&L (QBO Project Profitability)',
  category: 'Accounting',
  summary:
    'Per-project sales, cost, profit, billing progress, and A/R from QuickBooks Online, matched to Procore projects and compared with Procore direct costs.',
  pagePath: '/accounting/project-profitability',
  pageLabel: 'QBO P&L',
  pagePermission: 'accounting-project-profitability',
  fallbackPermission: 'admin',
  updated: '2026-10-08',
  sections: [
    {
      id: 'purpose',
      title: 'What this page is for',
      intro:
        'The QBO P&L page answers one question per project: based on what has actually been posted in QuickBooks Online, how much did we sell, what did it cost, and how much is left to bill and collect?',
      blocks: [
        {
          type: 'bullets',
          items: [
            '**Actuals, not estimates.** Sales, cost, and profit are the amounts recorded in QuickBooks. Procore supplies context: the matched project, its status, its contract value, and its direct-cost total for comparison.',
            '**Read only.** Nothing on this page writes to QuickBooks or Procore. Each refresh produces a new, immutable snapshot; older snapshots stay available for comparison.',
            '**Restricted.** The page and its APIs require the `accounting-project-profitability` permission (OWNER and ADMIN groups also have access). It appears in navigation as **QBO P&L**.',
          ],
        },
      ],
    },
    {
      id: 'data-flow',
      title: 'Where the data comes from',
      intro:
        'The page never calls QuickBooks or Procore while you are looking at it. Data arrives through a controlled pipeline and is stored in the Analytics PostgreSQL database first.',
      blocks: [
        {
          type: 'steps',
          items: [
            {
              title: 'The integration machine reads QuickBooks Online',
              body:
                'A separate, credentialed integration (the `QBO_1` project) runs a read-only report. It pulls the **Profit & Loss summarized by Customer** for the reporting window (by default January 1, 2025 through today, accrual basis, in six-month slices), the **lifetime P&L income** for net-billed totals, the **A/R Aging Summary**, all **invoices** in the window, all **estimates**, the full customer list, and a **P&L Detail** per project for drill-through lines.',
            },
            {
              title: 'The same run reads Procore',
              body:
                'Using its own Procore credentials, the integration lists company projects, keeps only those whose canonical bid-board status is **In Progress**, **Accepted**, or **Complete**, matches QBO projects to them, and totals the **Direct Cost** line items on each matched project.',
            },
            {
              title: 'A normalized export is written',
              body:
                'The run writes `project-profitability-<start>-to-<end>.json` (plus CSV, Markdown, and a cost-lines file) to the integration\'s `reports` folder. QuickBooks and Procore business records are never changed.',
            },
            {
              title: 'Analytics imports the export as a snapshot',
              body:
                '`scripts/importQboProjectProfitability.mjs` validates the file, hashes it so the same export is never imported twice, and stores an immutable `QboProfitabilitySnapshot` with one normalized row per QBO project, plus the per-project drill-through lines.',
            },
            {
              title: 'The page reads PostgreSQL and adds live Analytics context',
              body:
                '`GET /api/accounting/project-profitability` loads the selected snapshot, removes any QBO customers listed in the `qbo_project_exclusions` table, and layers on data that already lives in Analytics: Procore contract value (primary estimate + approved change orders) and current Procore status from `pmc_projects`. These two are read fresh every time the page opens, so they can change without a new snapshot.',
            },
          ],
        },
        {
          type: 'columns',
          columns: [
            {
              title: 'Frozen (from the snapshot)',
              items: [
                'Sales, cost, profit, margin',
                'Net billed, invoices, A/R, estimate totals',
                'Procore match and Procore direct cost',
                'Drill-through cost and billing lines',
              ],
            },
            {
              title: 'Live (from the Analytics database)',
              items: [
                'Contract value for matched projects and its source label',
                'Billing %, remaining to bill (derived from contract value)',
                'Procore status badge and status filter',
                'Project exclusions',
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'matching',
      title: 'How QBO projects are matched to Procore',
      intro:
        'Matching is deliberately conservative: a QBO project is paired with a Procore project only when there is exactly one candidate. Guessing would silently put costs on the wrong job.',
      blocks: [
        {
          type: 'paragraph',
          text:
            'Only Procore projects with a canonical bid-board status of In Progress, Accepted, or Complete are eligible. The **Match** value exported in the CSV, and the behavior you will see, map to these methods:',
        },
        {
          type: 'table',
          columns: ['Method', 'What it means'],
          rows: [
            ['`exact-name`', 'The QBO project name (or the last segment of its full name) equals exactly one eligible Procore project name after normalizing case, punctuation, and "&".'],
            ['`project-number`', 'No name match, but the QBO name contains exactly one eligible Procore project number of four or more characters.'],
            ['`procore-only`', 'An eligible Procore project with no unambiguous QBO counterpart. It appears with zero QBO sales and cost so you can see Procore direct cost and contract value alone.'],
            ['`not-a-project`', 'A top-level QBO customer (not a sub-customer/project) that has P&L activity. Shown under "Customer-only review".'],
            ['`ambiguous-name`, `ambiguous-number`, `unmatched`', 'Two or more Procore candidates, or none. QBO projects in this state are left out of the report rather than guessed, so a missing project usually means its name or number needs to be cleaned up in QBO or Procore.'],
          ],
        },
        {
          type: 'paragraph',
          text:
            'When several QBO projects point at the same Procore project and have no P&L activity, the single *active* QBO customer wins; if that is still ambiguous, none is chosen and the Procore project appears as `procore-only`.',
        },
      ],
    },
    {
      id: 'columns',
      title: 'Column reference',
      intro: 'Each table column, what it means, and which system the number ultimately comes from.',
      blocks: [
        {
          type: 'table',
          columns: ['Column', 'Meaning', 'Source'],
          rows: [
            ['QuickBooks project', 'The QBO customer or sub-customer (project) name. "Inactive" marks customers that are inactive in QBO.', 'QBO Customer list, read by the integration at refresh time.'],
            ['Procore match', 'The Procore project this QBO project was paired with, plus its project number.', 'Matching performed by the integration (see "How QBO projects are matched to Procore").'],
            ['Contract value', 'What the job is expected to bill in total. The small label underneath says where the value came from.', 'Matched rows: Procore primary estimate plus approved change orders (Analytics database). Unmatched rows: total of the QBO estimates attached to the customer.'],
            ['Net billed', 'Lifetime income posted to the project in the QBO P&L: invoices, credit memos, and other posting entries. A red "vs sales" note appears when lifetime billing differs from the sales inside the snapshot window (for example, billing that happened before the window start).', 'QBO Profit & Loss by Customer, from the billing start date through the snapshot end date.'],
            ['Billing', 'Net billed as a percentage of contract value.', 'Calculated at page load from the two columns to the left.'],
            ['A/R', 'Open invoice balance for the project, with the overdue portion called out in red.', 'QBO invoice documents inside the snapshot window, evaluated as of the snapshot end date.'],
            ['QBO actual cost', 'Cost of Goods Sold + Expenses + Other Expenses assigned to this project in QBO.', 'QBO Profit & Loss by Customer for the snapshot window.'],
            ['Procore direct cost', 'Total of Procore Direct Cost line items on the matched project. Shows "—" when the project is unmatched or Procore could not be read.', 'Procore Direct Costs, read by the integration at refresh time and stored in the snapshot.'],
            ['QBO − Procore', 'QBO actual cost minus Procore direct cost. Red (positive) means QBO carries more cost than Procore; green (negative) means Procore has cost QBO does not.', 'Calculated by the integration when the snapshot is produced.'],
            ['Profit / Margin', 'Profit = Sales + Other Income − QBO actual cost. Margin = Profit ÷ Sales. Margin is blank when sales are zero.', 'QBO Profit & Loss by Customer for the snapshot window.'],
            ['Status', 'The current Procore bid-board status of the matched project, or "No Procore match".', 'Analytics database (`pmc_projects`), loaded live when the page opens — not frozen in the snapshot.'],
            ['Drill through', 'Opens the row to show billing detail, invoice documents, and every QBO cost line that makes up the actual cost.', 'QBO Profit & Loss Detail per project, stored with the snapshot.'],
          ],
        },
        {
          type: 'callout',
          title: 'Contract value source labels',
          blocks: [
            {
              type: 'bullets',
              items: [
                '**Procore estimate** / **Procore estimate + approved CO** — matched project; value comes from Analytics\' Procore estimating data.',
                '**Procore value unavailable** — matched, but Analytics has no primary estimate for that Procore project yet. Billing % and remaining to bill are blank.',
                '**1 QBO estimate** / **N QBO estimates · review** — unmatched row; the total of the QBO estimates on that customer is used. Multiple estimates are flagged so someone can confirm the total is right.',
                '**No contract source** — unmatched and no QBO estimates exist.',
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'using',
      title: 'Using the page',
      intro: 'Open QBO P&L from the navigation bar. The page loads the newest snapshot automatically.',
      blocks: [
        {
          type: 'steps',
          items: [
            {
              title: 'Check the snapshot banner',
              body:
                'The top-right box on the header shows the reporting window, the accounting basis (Accrual or Cash), and when the snapshot was imported. If the import time is older than you expect, use **Refresh costs** (see "Refreshing the data").',
            },
            {
              title: 'Read the summary cards',
              body: [
                '**Sold <year>** — total contract value for projects sold in the current year. It always uses the newest snapshot and does not change with filters or when viewing an older snapshot.',
                '**QBO actual cost**, **Procore direct cost**, **Matched QBO minus Procore**, **Profit**, **A/R outstanding** — totals for the rows currently in view; they recalculate as you filter.',
                '**Rows in view** — how many rows pass the current filters.',
              ],
            },
            {
              title: 'Narrow the list with filters',
              body: [
                '**Search projects** — matches QBO name, Procore name, Procore number, or Procore status.',
                '**Record type** — *Projects* (default) shows QBO sub-customers/projects; *Customer-only review* shows top-level customers that have P&L activity but are not projects (often costs or income that should be moved to a project); *All records* shows both.',
                '**Procore match** — *Matched* or *Needs review* (rows with no Procore project, mainly customer-only records).',
                '**Procore status** — filter by current Procore bid-board status, or *No Procore status*.',
                '**Imported snapshot** — switch to an earlier snapshot to compare a prior point in time. Up to 24 recent snapshots are listed.',
              ],
            },
            {
              title: 'Drill into a project',
              body:
                'Click a row (or its **Open** button). The expanded panel shows billing cards (net billed, contract value, remaining to bill, gross invoices, collected, outstanding, overdue), the **P&L billing activity** that nets to sales, the **invoice documents** with current balances, and then every **QBO cost line** (date, transaction type, document number, memo, amount) followed by **section totals** such as COGS and Expenses. Use this to see exactly which bills, checks, or journal entries make up the actual cost.',
            },
            {
              title: 'Export what you see',
              body:
                '**Export view** downloads a CSV of the filtered rows with every column, including the match method, contract source, Procore base estimate, approved change orders, and QBO estimate count/total.',
            },
          ],
        },
      ],
    },
    {
      id: 'refresh',
      title: 'Refreshing the data',
      intro:
        '**Refresh costs** re-reads QuickBooks and Procore and imports a brand-new snapshot. Existing snapshots are never modified.',
      blocks: [
        { type: 'paragraph', text: 'What happens depends on where the app is running:' },
        {
          type: 'bullets',
          items: [
            '**Production (remote refresh).** The button sends a signed request to the integration machine\'s webhook. The page then checks status every five seconds and shows progress messages ("Refresh queued", "Reading current QuickBooks activity and Procore direct costs…"). When the run finishes and the snapshot is imported, the page reloads with the new data. A full run typically takes several minutes; the page waits up to 45 minutes before giving up, and the previous snapshot remains available either way.',
            '**Local development.** If the `QBO_1` report script and the import script are both present on the machine, the server runs them directly and reloads when finished.',
            '**Not configured.** If neither path is available the page reports that refresh is not configured. The data can still be refreshed manually by running the integration report and then `node scripts/importQboProjectProfitability.mjs`.',
          ],
        },
        {
          type: 'paragraph',
          text:
            'Re-importing an identical export is harmless: the import recognizes the file hash, reports that the snapshot already exists, and only tops up drill-through details.',
        },
      ],
    },
    {
      id: 'gotchas',
      title: 'Things to know when reading the numbers',
      blocks: [
        {
          type: 'bullets',
          items: [
            '**The window matters.** Sales, cost, profit, and margin cover only the snapshot window (shown in the header). Net billed is lifetime income, which is why it can exceed sales and trigger the red "vs sales" note.',
            '**A QBO project that is missing** from the Projects view either has no unambiguous Procore match, is matched to a Procore project outside In Progress / Accepted / Complete, or is listed in the exclusions table. Check the project name and number in both systems first.',
            '**Procore-only rows** (zero sales, zero QBO cost, but a Procore direct cost) mean Procore knows about the job and QuickBooks has not posted anything to it yet, or the QBO project is named differently.',
            '**QBO − Procore** compares QBO\'s full project cost (COGS, expenses, other expenses) with Procore\'s direct-cost line items. Overhead posted to a project in QBO, or costs entered in only one system, will show as a difference. It is a reconciliation prompt, not an error by itself.',
            '**Status is live, numbers are frozen.** If a project moved to Complete yesterday, the badge updates immediately, but its sales and cost reflect the last refresh.',
            '**Procore value unavailable** usually means the estimating/contract data for that project has not synced into Analytics yet; it is not a QuickBooks problem.',
            '**Customer-only review** rows often reveal invoices or bills coded to the parent customer instead of the project. Fixing the customer assignment in QBO and refreshing moves the amounts onto the right project.',
          ],
        },
      ],
    },
    {
      id: 'technical',
      title: 'Technical reference',
      intro: 'For administrators and developers. Environment variable names are listed; values are never shown.',
      blocks: [
        {
          type: 'columns',
          columns: [
            {
              title: 'Analytics code',
              items: [
                '`src/app/accounting/project-profitability/page.tsx`',
                '`src/app/api/accounting/project-profitability/route.ts`',
                '`src/app/api/accounting/project-profitability/qbo-details/route.ts`',
                '`src/app/api/accounting/project-profitability/procore-statuses/route.ts`',
                '`src/lib/projectProfitabilityContractValue.js`',
                '`src/lib/qboProjectExclusions.ts`',
                '`scripts/importQboProjectProfitability.mjs`',
              ],
            },
            {
              title: 'Database tables',
              items: [
                '`qbo_profitability_snapshots`',
                '`qbo_project_profitability_rows`',
                '`qbo_profitability_drillthrough_projects`',
                '`qbo_project_exclusions`',
                '`pmc_projects` (status, live)',
              ],
            },
            {
              title: 'Integration (QBO_1)',
              items: [
                '`src/report-project-profitability.js`',
                '`src/project-profitability.js` (matching, P&L math)',
                '`reports/project-profitability-*.json`',
              ],
            },
            {
              title: 'Environment variables',
              items: [
                '`QBO_INTEGRATION_ROOT`',
                '`QBO_PROFITABILITY_REFRESH_WEBHOOK_URL`',
                '`QBO_PROFITABILITY_REFRESH_WEBHOOK_SECRET`',
                '`QBO_PROFITABILITY_REFRESH_PAIRING_KEY_BASE64`',
                '`PROJECT_PROFITABILITY_START_DATE` / `END_DATE`',
                '`PROJECT_PROFITABILITY_ACCOUNTING_METHOD`',
                '`PROJECT_PROFITABILITY_PROCORE_STATUS_FILE`',
              ],
            },
          ],
        },
        {
          type: 'paragraph',
          text:
            'Validation: `node --test test/permissions.test.mjs test/helpGuides.test.mjs`. See `docs/architecture.md` ("QuickBooks profitability") for the authoritative pipeline description.',
        },
      ],
    },
  ],
};
