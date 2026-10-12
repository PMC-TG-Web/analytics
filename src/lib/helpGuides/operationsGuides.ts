import { defineGuide } from './defineGuide.ts';

export const operationsGuides = [
  defineGuide('home', {
    purpose: 'Start your day with personal updates, schedule assignments, company information, and quick links. The information shown depends on your account and available employee/role information.',
    steps: [{ title: 'Check the window', body: 'Read the dates on My Personal Update before interpreting upcoming assignments, absences, or pours.' }, { title: 'Open your work', body: 'Use schedule assignments and Quick Access to reach the page relevant to today’s task.' }, { title: 'Record requests accurately', body: 'When using Call Off or Time Off, check the date, type, hours, and notes before submitting.' }],
    data: ['Personal information comes from your signed-in identity and stored employee, schedule, absence, and company records.', 'Weather and company communication provide context; personal and leadership snapshots can show different sections.'],
    terms: [['My assignments', 'Work connected to your identity within the displayed window.'], ['Crew members off', 'Recorded absence information relevant to the snapshot.'], ['Position unavailable', 'The account has not resolved to the expected employee/position information.']],
    example: 'An assignment outside the next-seven-days window may not appear in the personal snapshot. Open the relevant schedule to inspect later dates.',
    checks: ['Verify that the displayed account is yours and that the date window includes the work.', 'If employee or position information is missing, have the employee record and email association reviewed. A missing assignment is not proof there is no scheduled work.'],
  }),
  defineGuide('my-work', {
    purpose: 'See your next five workdays of assigned RFIs, tasks, meetings, and connected Outlook events, plus overdue items that need attention.',
    steps: [{ title: 'Start with overdue work', body: 'Review Clear these first, then the dated daily columns.' }, { title: 'Focus on a project', body: 'Choose a project or All my projects. Read each item’s type, status, and due time.' }, { title: 'Follow through', body: 'Open the available Procore or Outlook link to act in the source system. Use Open Changes for change-management work.' }],
    data: ['Synchronized Procore assignments are matched to your signed-in identity. Connected Outlook calendar events are included when available.', 'The page displays its latest sync and calendar connection context. It is a personal work view, not a list of every company task.'],
    terms: [['RFI / Task', 'Assigned work with a due date; overdue items can remain visible until their source status changes.'], ['Meeting / Outlook', 'Timed events. Past events are not treated as overdue tasks.'], ['Five workdays', 'The workday window shown on the page; read the dates rather than assuming the next five calendar days.']],
    example: 'Yesterday’s unfinished task can remain overdue, while yesterday’s meeting simply passes. They should not be interpreted as the same kind of outstanding work.',
    checks: ['Check the account, project filter, assignment, and latest sync if an item is missing.', 'Missing Outlook events can reflect connection or synchronization status. Correct task status in the source system and allow it to synchronize.'],
  }),
  defineGuide('wip', {
    purpose: 'Plan monthly workload from each In Progress job’s estimated labor hours, excluding Project Management.',
    steps: [{ title: 'Find the job', body: 'Filter by project, PM, or allocation status. Review estimated hours and the Project Management deduction.' }, { title: 'Allocate months', body: 'Choose Allocate months or Edit allocation. Add the expected months and enter percentages totaling 100%. Months can cross years or have gaps.' }, { title: 'Save and review', body: 'Save the allocation and check monthly workload totals. Planning notes and revision history explain later changes.' }],
    data: ['The current company’s synchronized Bid Board and selected estimate supply job status and estimated hours. The existing estimating PM classification excludes Project Management hours.', 'WIP uses fresh plans linked by explicit Procore project IDs. Old schedule allocations are not imported. Actual hours and change-order hours do not enter the allocation basis.'],
    terms: [['Estimated hours excluding PM', 'The entire selected estimate’s hours minus Project Management, before allocating across months.'], ['Needs allocation', 'An In Progress job with no saved monthly plan.'], ['Estimate changed', 'The estimate basis differs from the saved plan. Monthly figures retain the saved basis until the PM reviews and saves again.'], ['Monthly workload', 'Saved allocated hours across the filtered jobs. Unallocated jobs contribute no monthly hours.']],
    example: 'An estimate with 1,200 hours including 200 Project Management hours has 1,000 hours to allocate: October 40% is 400 hours, November 40% is 400 hours, and January 20% is 200 hours.',
    checks: ['Every saved plan must total 100%. All months count, including months outside the displayed window.', 'Missing estimate data or an ambiguous project link requires source review before saving. If another PM saved first, reload before editing again.', 'Use Refresh with the editor closed to load synchronized status changes. Jobs leave this active view when they are no longer In Progress; their saved revisions remain stored.'],
  }),
];
