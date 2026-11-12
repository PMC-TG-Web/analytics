import { defineGuide } from './defineGuide.ts';

export const adminGuides = [
  defineGuide('manage-kpis', {
    updated: '2026-11-12',
    purpose: 'Use this page to enter the monthly numbers on the KPI page that are typed in by hand, such as goals and recorded history. A **card** is one table on the KPI page, for example Sales by Month. Each row in a card is one measure, called a **KPI** (key performance indicator), with one value for each month. Come here when a goal or another hand-entered figure needs to be added or corrected.',
    steps: [
      {
        title: 'Open the card',
        body: [
          'The page opens on a list of cards. Each card shows its name, its number of rows and an “Updated” date and time.',
          'Click **Edit Card** on the card you want to change.',
          '**Refresh Cards** reloads the list. “Last fetched” shows when the list was last loaded.',
        ],
      },
      {
        title: 'Choose the year',
        body: 'Set **Editing year** at the top right before you type. The month columns change to that year, for example “Jan 2026”. Only 2026 and 2027 can be edited.',
      },
      {
        title: 'Type the monthly values',
        body: [
          'Find the row by its **KPI Name**, then type in the box under the correct month.',
          'Keep the kind of number the row already uses: dollars, hours or a percent.',
          'To add a measure, type its name in the “New KPI name” box at the bottom and click **Add Row**.',
          '**Delete** removes the whole row, including both years.',
          'Do not rename a row unless you mean to. The KPI page finds some rows, such as Goal, by name.',
        ],
      },
      {
        title: 'Optional: enter hours by pay period',
        body: [
          'Use this when you have one hours total for a pay period (the dates covered by one payroll run) and the period may cross a month end.',
          'Click **+ Pay Period** on the row that should receive the hours.',
          'Choose the dates under **Select Pay Period**, type the total under **Total Hours for Period**, and click **Calculate Distribution**.',
          'Review **Calculated Distribution**. The hours are split between months by the number of weekdays (Monday to Friday) in each month, leaving out holidays.',
          'Click **Save Hours**. The hours are *added* to what is already in those months; they do not replace it. Months outside 2026 and 2027 are skipped.',
        ],
      },
      {
        title: 'Save and check',
        body: [
          'Click **Save Changes**. Nothing is stored until you do. **Cancel** closes the card and discards what you typed.',
          'The page returns to the card list. Check that the card’s “Updated” time has changed. The page does not show a message if a save fails.',
          'Open **KPI** and look at the same card and year.',
        ],
      },
    ],
    data: [
      'The values on this page are the ones people have saved here. They stay until someone changes them. Inside a card, “Last updated” shows when it was last saved and by whom.',
      'Some rows on the KPI page are calculated by Analytics and ignore what is typed here. The next bullets list them.',
      'Sales by Month: Actual Sales and Actual Hours are calculated from the same sold projects, counted in the month of each project’s Contract Date. Actual Hours leaves out Project Management hours.',
      'WIP by Month (the table of that name on the KPI page): the Scheduled dollars and Scheduled Hours come from the monthly plans saved on the WIP page. WIP means work in progress. Older jobs imported from past reports add their own monthly hours and revenue. A value typed here does not replace any of these calculated rows.',
      'Estimates by Month: from October 2026 onward, the dollars and the hours (full hours, including Project Management) are calculated from project estimates and supported rebid changes. Earlier months keep their saved figures. A value typed here for October 2026 or later does not replace the calculation.',
      'Leadtimes by Month: KPI calculates the current month’s Leadtime Hours, Leadtime Months and Unscheduled Hours from WIP. A value entered here for the current month is not shown. Values entered for earlier months remain as the recorded history.',
      'KPI does not save the current month’s leadtime figures automatically. If you want a month’s closing figures kept, record them here before the month ends.',
      'Sales % of Goal ($): KPI calculates the last completed month. It uses year-to-date Actual Sales (January through that month) and the Goal row of Sales by Month. A value entered here for that month is not shown. Values entered for other months remain as recorded.',
      'Keep every monthly Goal filled in. A blank Goal makes the Sales % of Goal ($) calculation show “Unavailable”.',
    ],
    terms: [
      ['Card', 'One table on the KPI page, such as Sales by Month. Each card is opened and saved separately.'],
      ['KPI Name', 'The name of one row in the card. Each row is one measure.'],
      ['Editing year', 'The year whose twelve months you are typing into. Switching years does not lose what you typed for the other year.'],
      ['+ Pay Period', 'Opens the **Enter Hours by Pay Period** window for that row.'],
      ['Pay period', 'The dates covered by one payroll run. Each choice in the list shows the start date, end date and pay date.'],
      ['Calculated Distribution', 'The proposed split of the hours between months. Review it before you click **Save Hours**.'],
      ['Save Hours', 'Adds the split hours to the months in the open card. They are not stored until you click **Save Changes**.'],
      ['Save Changes', 'Stores the whole card, including added and deleted rows.'],
      ['Updated', 'On the card list, when the card was last saved.'],
    ],
    example: 'Suppose the sales goal for March 2027 changes. Open the Sales by Month card, set **Editing year** to 2027, type the new figure in the Goal row under “Mar 2027”, and click **Save Changes**. The 2026 goals do not change, and neither does Actual Sales, which is calculated.',
    checks: [
      'An edit looks missing: wait a minute, click **Refresh Cards**, then reopen the same card and the same **Editing year**. If the card’s “Updated” time did not change, the save did not go through, so enter it again.',
      'A value you typed does not show on KPI: check the calculated rows listed under “Where the data comes from”. Those rows ignore typed values.',
      'A month is too high after using **+ Pay Period**: **Save Hours** adds to the value already there. Correct the month box by hand, then click **Save Changes**.',
      'A job is missing from the Scheduled figures: on KPI, open the **Not scheduled** list under the Scheduled row and click **Open WIP**. In WIP, spread the job across its months until it totals 100% and save it. Typing a value on this page does not schedule a job. You need access to WIP.',
      'Actual Sales or Actual Hours looks wrong: on KPI, click the amount to see the projects behind it. Correct the project at its source, for example its Contract Date in Procore. Wait for the next sync, then refresh KPI. It cannot be corrected on this page.',
      'The page says “No KPI cards found in database” or shows another warning box: tell the administrator. The cards must be set up before they can be edited.',
    ],
  }),
  defineGuide('procore', {
    updated: '2026-11-12',
    purpose: 'A toolbox for administrators who move or repair records in Procore, the company’s construction management system. Most of its tools copy (“clone”) one kind of record from one Procore project to another. It is not a report: to review jobs, start from Projects, Analytics or the financial pages. Use this page only when you have been asked to run a specific tool and you know the exact projects involved.',
    steps: [
      {
        title: 'Check the connection',
        body: [
          'The page is titled **Procore Integration Explorer**.',
          'A green bar reading “OK Authenticated with Procore” or “Connected to Procore through the server integration” means the tools can reach Procore.',
          'If you see **Authenticate with Procore** instead, click **Login with Procore** and sign in with your Procore account.',
          'If a red error says the session has expired, click **Click here to Re-login**.',
        ],
      },
      {
        title: 'Find the tool you were asked to use',
        body: [
          'Scroll to the box with the matching heading. Each box is one tool and works on one kind of record.',
          'Tools that copy contract, cost and field records: **Clone Estimate or Change Order**, **Clone Prime Contracts**, **Clone Commitments**, **Clone Change Events**, **Clone Time and Material** and **Clone Daily Productivity and Timecards**.',
          'Tools that copy other project records: **Clone Submittals**, **Clone RFIs**, **Clone Correspondences**, **Clone Meetings**, **Clone Project Team**, **Clone Task Items** and **Clone Photos**.',
          '**Simple Clone Suite** runs the simpler copy tools you tick (Correspondences, Submittals, RFIs, Meetings, Project Team, Task Items, Photos) in one pass.',
          'Other tools: **Bid Board Project Import (Step 1)** creates Bid Board projects from a spreadsheet, **Drawings Migration Inventory** lists and copies drawings, and **Procore REST Command Runner** sends a single request to Procore.',
        ],
      },
      {
        title: 'Enter the source and the target',
        body: [
          'The **source** is the project you copy from. The **target** is the project that receives the copies.',
          'Fill in the company and project boxes, such as **Source Project ID** and **Target Project ID**. An ID is the number Procore uses for that company or project.',
          'Check every ID twice. The tools act on the IDs you type, so a wrong ID sends the work to the wrong project.',
        ],
      },
      {
        title: 'Preview with a dry run',
        body: [
          'Click the tool’s dry-run button: **Dry Run Clone**, **Dry Run Suite**, **Preview Projects (Dry Run)** or **Dry Run Budget Patch**. A dry run is a preview. It reports what a live run would do and creates nothing.',
          'Read the result line under the buttons. Open the detail below it if you need the full list.',
          'If the result reports missing mappings, the live run is blocked. A **mapping** tells the tool which ID in the target project matches an ID in the source project, for example a vendor or a cost code. Fill in the missing ones and run the dry run again.',
        ],
      },
      {
        title: 'Run it for real, then check Procore',
        body: [
          'Click the live button, such as **Run Live Clone** or **Create Projects From Rows**. The browser asks you to confirm before anything is created.',
          'Large jobs run in batches. If a button starting with “Continue” appears, click it to carry on from where the last batch stopped.',
          'Click **Download Result JSON** to keep a record of the run.',
          'Open the target project in Procore and confirm the records are there before you run anything again.',
        ],
      },
    ],
    data: [
      'The tools talk directly to Procore when you click their buttons. A dry run only reads. A live run creates or changes records in the target Procore project.',
      'A result describes that one run and its target project only.',
      'These tools do not refresh the reports elsewhere in Analytics. Those pages show information that Analytics has already saved from Procore.',
      'The six buttons across the top (**Explore Available Data**, **Sync Bid Board**, **Clear Old Data**, **Sync Productivity**, **Check Data Sources** and **Check Database**) are older checks. At present only **Check Database** shows a result: a raw list of saved project status records, in a box at the bottom of the page.',
      'The other five top buttons currently finish without showing a result. Leave them alone, especially **Clear Old Data**, unless an administrator tells you otherwise.',
    ],
    terms: [
      ['Source / Target', 'Source is the project copied from. Target is the project that receives the copies.'],
      ['Company ID / Project ID', 'The numbers Procore uses to identify a company and a project. A Bid Board ID or a proposal ID is a different number. Use one only where the box label asks for it.'],
      ['Dry run', 'A preview. It reports what would be created without creating it.'],
      ['Live', 'The real run. It creates or changes records in Procore after you confirm.'],
      ['Missing mappings', 'IDs from the source project that the tool could not match in the target project. Fill them in the tool’s mapping table or mapping box, then repeat the dry run.'],
      ['Crosswalk workbook', 'A spreadsheet (“Codes to use.xlsx”) that lists which old cost codes match which new ones. Several tools let you upload it.'],
      ['Continue', 'Appears when a live run stopped partway, for example at a batch limit. It resumes from the next record.'],
      ['Download Result JSON', 'Saves the full result of the last run as a file. JSON is a plain-text data format.'],
      ['Patch Target Budget Codes', 'Inside **Clone Commitments**. Corrects the budget code on budget lines in the target project. Amounts, units and quantities are not changed.'],
      ['Delete Target Timecards', 'Inside **Clone Daily Productivity and Timecards**. Permanently removes the target project’s timecard entries for the chosen dates. Click **Preview Target Timecards** first.'],
      ['Drawings Migration Inventory', '**Pull Drawings Inventory** only lists the drawings in the source project. **Run Drawing Batch**, **Create in Project Tool** and **Upload to Estimating** create drawings.'],
      ['Procore REST Command Runner', 'An advanced tool that sends one request straight to Procore. The **Method** decides what it does: GET only reads; POST, PUT, PATCH and DELETE change or remove records. Use it only with exact instructions.'],
    ],
    example: 'Suppose you are asked to copy the RFIs (requests for information) from an old project to its new project. In **Clone RFIs**, enter both project IDs and click **Dry Run Clone**. Review the result, click **Run Live Clone** and confirm. Then open the new project in Procore and check the RFIs. This run copies RFIs only. Commitments, timecards and other records have their own tools.',
    checks: [
      'A tool shows a red error: read the message, then check the green connection bar and every company and project ID before you try again.',
      'The dry run says the live clone is blocked: fill in the missing mappings and run the dry run again.',
      'A live run ended and you are not sure it finished: look in the target project in Procore before you retry. Running it again without checking can create duplicate records.',
      'A button in the top row seems to do nothing: see the note about the six top buttons under “Where the data comes from”.',
      'Overhead & Profit belongs on budget code 90-100-10-10.O. The “O” means Other. **Dry Run Budget Patch** proposes this code even when the line is currently marked Materials.',
      'If a project already has budget amounts on both the Other and the Materials code for Overhead & Profit, do not simply delete one. Combine the amounts, correct the contract lines that point to the old code, and make sure the project total stays the same.',
    ],
  }),
  defineGuide('timecards', {
    updated: '2026-11-12',
    purpose: 'Use this page to pull timecards from Procore into Analytics by hand, and to see how many records came in for each project. A **timecard entry** is one line of time that a worker logged in Procore. Analytics also brings timecards in automatically in the background, so use this page for a catch-up or a check. To read labor hours, use Reporting or All Hours instead.',
    steps: [
      {
        title: 'Check the connection',
        body: [
          'Look at **Procore Auth** near the top. It should read “Connected”.',
          'If it reads “Not Connected”, click **Connect Procore** and sign in. The two sync buttons cannot be clicked until the page is connected.',
          'Leave **Company ID** as it is filled in, unless you were told to change it.',
        ],
      },
      {
        title: 'Choose the dates',
        body: [
          '**Start Date** and **End Date** set the range of work dates to bring in. The page opens with August 1, 2025 through today.',
          'For a catch-up, shorten the range to the days you need. Every Procore project is checked, so a long range takes longer.',
          'To ask for one day only, fill in **Log Date**.',
          'Leave **filters[created_by_id]** and **filters[daily_log_segment_id]** blank unless you were given Procore ID numbers for them.',
        ],
      },
      {
        title: 'Decide whether to save',
        body: [
          '**Write to Prisma** is ticked when the page opens. Ticked means the timecards are saved into Analytics. Prisma is the name of the database tool behind Analytics.',
          'Untick it only when you want to count what Procore holds without saving anything.',
          'Leave **Per Page** at 100. It only sets how many records are requested from Procore at a time.',
        ],
      },
      {
        title: 'Sync the entries and read the result',
        body: [
          'In the **Timecard Entries** box, click **Sync Entries**. The button reads “Syncing...” while it works. A long date range can take several minutes.',
          'Five counts appear: **Projects Checked**, **Projects With Entries**, **Entries Fetched**, **Entries Saved** and **Projects Created**.',
          'Below them, a table lists each project that had entries, with its **Entries**, **Saved** and **Skipped** counts.',
          'A red **Errors** box lists any project that failed.',
        ],
      },
      {
        title: 'Sync time types when needed',
        body: 'In the **Timecard Time Types** box, **Sync Time Types** brings in the list of time types for every project. A time type is a kind of time a worker can pick on a timecard. Run it when a time type has been added or changed in Procore. It uses the same **Company ID**, **Per Page** and **Write to Prisma** settings, and ignores the dates.',
      },
    ],
    data: [
      'Both buttons read directly from Procore at the moment you click them. They go through every project in the company.',
      'With **Write to Prisma** ticked, what is fetched is saved into Analytics. An entry that was saved before is updated, not duplicated.',
      'If Analytics has no record of a project yet, the sync can add one. **Projects Created** counts these.',
      'With **Write to Prisma** unticked, nothing is saved. **Entries Saved** shows 0, but the **Saved** column in the project table still repeats the number fetched. Ignore that column in this case.',
      'This page never changes anything in Procore.',
      'The grey line under each box heading that starts with “GET” is a technical reference. You can ignore it.',
    ],
    terms: [
      ['Procore Auth', 'Whether this page can reach Procore: “Checking...”, “Connected” or “Not Connected”.'],
      ['Timecard Entries', 'Individual lines of logged time from Procore. One entry is one record, not one hour.'],
      ['Timecard Time Types', 'The kinds of time available on a timecard. They are a reference list, not extra labor hours.'],
      ['Log Date', 'A single work date to request.'],
      ['filters[created_by_id]', 'Optional. Limits the sync to entries created by the listed Procore users. Type their Procore user ID numbers, separated by commas.'],
      ['Per Page', 'How many records are requested from Procore at a time, from 1 to 200. It is not a total of hours or people.'],
      ['Write to Prisma', 'Ticked: save what is fetched into Analytics. Unticked: fetch and count only.'],
      ['Entries Fetched / Entries Saved', 'How many entries Procore returned, and how many of them were saved into Analytics.'],
      ['Skipped', 'Entries that were not saved, for example because they had no ID or no date.'],
      ['Projects Created', 'Projects added to Analytics during this sync because they were not there yet.'],
      ['Linked ID', 'The Analytics project record the Procore project was matched to. “-” means none.'],
    ],
    example: 'A result showing 50 under **Entries Fetched** means 50 time records, not 50 hours. One entry might be 8 hours and another 2. To see the hours themselves, open Reporting or All Hours for the same project and dates.',
    checks: [
      'No entries came back: check the dates first, then clear **Log Date** and the two filter boxes, then check **Procore Auth**.',
      'A red message appears in the box: read it. If it mentions a missing access token, click **Connect Procore** and try again.',
      'The sync runs for a long time or stops with an error on a long date range: shorten the range and run it again.',
      '**Entries Saved** is lower than **Entries Fetched**: look at the **Skipped** column and the **Errors** box.',
      'Reports did not change: confirm **Write to Prisma** was ticked and **Entries Saved** is above 0. Then check that the report uses the same project and dates.',
    ],
  }),
];
