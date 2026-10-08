import { defineGuide } from './defineGuide.ts';

export const adminGuides = [
  defineGuide('manage-kpis', {
    purpose: 'Maintain the saved monthly rows used by KPI cards. Use this page when a target or manually maintained measure needs updating.',
    steps: [{ title: 'Choose card and year', body: 'Open Edit Card and confirm Editing year before entering values.' }, { title: 'Edit the intended row', body: 'Check the KPI Name and monthly column. Add Row creates a new saved measure; preserve the intended units.' }, { title: 'Save and verify', body: 'Use Save Changes, then inspect the same card and year on KPI. For hours by pay period, calculate and review the distribution before Save Hours.' }],
    data: ['Saved KPI cards and their yearly/monthly values supply this editor.', 'Calculated KPI rows also exist on the dashboard. Editing a saved card does not rewrite the source project or accounting data behind calculated measures.'],
    terms: [['Editing year', 'The year receiving the saved monthly changes.'], ['Pay Period', 'The date interval used to distribute an entered hours total.'], ['Calculated Distribution', 'The proposed split to review before saving hours.']],
    example: 'Entering a new sales goal in next year’s card does not change this year’s Actual Sales. Check both the measure and editing year.',
    checks: ['If an edit appears missing, reopen the same card and year and confirm the save completed.', 'Check whether the dashboard row is saved or calculated before attempting to correct it here.'],
  }),
  defineGuide('procore', {
    purpose: 'An integration workspace for checking the Procore connection, inspecting source data, synchronizing records, and performing controlled maintenance. Ordinary report review usually starts from Projects, Analytics, or the financial pages.',
    steps: [{ title: 'Check the connection', body: 'Read authentication status and use Authenticate with Procore or re-login when required.' }, { title: 'Identify the tool and target', body: 'Confirm company, project, source, and target before running a tool. Different tools inspect, synchronize, create, move, or delete records.' }, { title: 'Review before applying', body: 'Use previews or dry-run options where provided. Inspect results and counts before continuing with a write action.' }],
    data: ['Connection checks and explicit integration tools communicate with Procore. Stored mirrors supply the ordinary analytics pages.', 'A tool result describes that operation and its target; it does not prove every data source in the application has refreshed.'],
    terms: [['Company / Project ID', 'The exact external target. A bid-board ID or proposal ID is not interchangeable with a Procore project ID.'], ['Sync', 'Brings source information into the application for the selected scope.'], ['REST Command Runner', 'An advanced request tool; the method and endpoint determine whether it reads or changes records.'], ['Clone / Transfer / Delete', 'Operations that can change source or target records and require a deliberately chosen target.']],
    example: 'Refreshing project headers does not necessarily refresh every timecard or commitment line. Use the result and source-specific sync information to understand what changed.',
    checks: ['Check connection, target IDs, and returned error before rerunning an operation.', 'After an uncertain write result, inspect the destination before retrying to avoid creating duplicate records.'],
  }),
  defineGuide('timecards', {
    purpose: 'Synchronize and inspect Procore timecard entries and time-type reference data. This is an integration tool; Reporting is the simpler starting point for a project labor report.',
    steps: [{ title: 'Confirm the connection', body: 'Check Procore Auth and use Connect Procore if needed. Verify the intended company configuration.' }, { title: 'Set the entry filters', body: 'Choose Log Date or the intended Start/End Date range and any additional source filters. Review Write to Prisma before synchronizing.' }, { title: 'Run and inspect', body: 'Use Sync Entries or Sync Time Types as appropriate. Read the returned counts and preview rows before assuming the records are available in reports.' }],
    data: ['Explicit sync actions retrieve Procore timecards and time-type definitions.', 'Write to Prisma controls saving retrieved information into the application’s database. A preview alone should not be treated as proof that downstream reporting data was updated.'],
    terms: [['Entries', 'Individual labor/time records from Procore.'], ['Time Types', 'Reference classifications for time, not additional labor hours.'], ['Per Page', 'The requested source page size, not the total number of hours or employees.'], ['Write to Prisma', 'The interface’s label for persisting the retrieved data in Analytics.']],
    example: 'A result showing 50 entries means 50 time records, not 50 hours. Inspect the hours fields and dates to understand actual labor.',
    checks: ['For no results, check date and creator/segment filters as well as the connection.', 'If reports remain unchanged, verify that the sync saved records and that the report uses the same project and dates.'],
  }),
];
