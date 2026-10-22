import * as XLSX from 'xlsx';
import type { ProjectUsageReport, UsageLine } from './projectUsageReport.ts';

/** Native Excel values: quantities are numbers; external identifiers remain text. */
export function createProjectUsageWorkbook(report: ProjectUsageReport) {
  const workbook = XLSX.utils.book_new();
  workbook.Props = { Title: 'Project labor and material usage', CreatedDate: new Date(report.loadedAt) };
  function sheet(name: string, headers: string[], rows: (string | number | Date | null)[][], widths: number[], numeric: number[] = []) {
    if (rows.length > 1_048_568) throw new Error('Select a shorter date range to stay within the Excel row limit.');
    const data = [[report.projectFilter ? `Project labor and material usage: ${report.projectFilter.name}` : 'Project labor and material usage'],
      [`Work dates: ${report.from || 'All saved dates'} to ${report.through || 'Latest saved date'}`],
      [`Report loaded: ${report.loadedAt}. Source: saved Procore timecards and productivity logs.`], [], headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(data, { cellDates: true });
    ws['!cols'] = widths.map(wch => ({ wch }));
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ r: 4, c: 0 }, { r: Math.max(4, rows.length + 4), c: headers.length - 1 }) };
    for (let r = 5; r < data.length; r++) for (const c of numeric) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell?.t === 'n') cell.z = '#,##0.####;[Red](#,##0.####);0';
    }
    if (headers.includes('First work date')) for (let r = 5; r < data.length; r++) for (const c of [11, 12]) {
      ws[XLSX.utils.encode_cell({ r, c })].z = 'mm/dd/yy';
    }
    XLSX.utils.book_append_sheet(workbook, ws, name);
  }
  sheet('Projects', ['Project', 'Project number', 'Customer', 'Status', 'Procore project ID', 'Timecard hours', 'Daily-log labor hours', 'Subcontractor hours (included)', 'Material items', 'Items to review', 'Concrete (CY)', 'Rebar (tons)', 'Rebar entries not converted'],
    report.projects.map(p => [p.projectName, p.projectNumber, p.customer, p.status, p.projectId, p.timecardHours, p.dailyLogHours, p.subcontractorHours, p.materialLines, p.reviewLines, p.concreteCy, p.rebarTons, p.rebarUnconvertedEntries]),
    [48, 20, 32, 20, 25, 22, 25, 32, 18, 20, 20, 20, 30], [5, 6, 7, 8, 9, 10, 11, 12]);
  function detail(name: string, rows: UsageLine[]) {
    const material = name === 'Materials';
    sheet(name, ['Project', 'Project number', 'Procore project ID', 'Source', 'Labor type', 'Cost code', 'Description', 'Worker', 'Quantity used / hours', 'Unit', 'Source entries', 'First work date', 'Last work date', 'Purchase order ID', 'Line item ID', 'Note', ...(material ? ['Concrete (CY)', 'Rebar (tons)', 'Rebar entries not converted'] : [])],
      rows.map(r => [r.projectName, r.projectNumber, r.projectId, r.source, r.laborType, r.costCode, r.description, r.worker,
        r.note === 'Missing or invalid quantity.' ? null : r.quantity, r.unit, r.entries,
        Date.parse(`${r.firstDate}T00:00:00Z`) / 86_400_000 + 25569,
        Date.parse(`${r.lastDate}T00:00:00Z`) / 86_400_000 + 25569, r.holderId, r.lineItemId, r.note,
        ...(material ? [r.concreteCy, r.rebarTons, r.rebarUnconvertedEntries] : [])]),
      [48, 20, 25, 18, 20, 20, 58, 28, 25, 14, 18, 20, 20, 25, 25, 85, ...(material ? [20, 20, 30] : [])], [8, 10, ...(material ? [16, 17, 18] : [])]);
  }
  detail('Labor', report.labor);
  detail('Materials', report.materials);
  detail('Other quantities', report.other);
  detail('Review', report.review);
  sheet('Report notes', ['Subject', 'Definition'], [
    ['Scope', report.projectFilter ? `Selected project: ${report.projectFilter.name}. Procore project ID: ${report.projectFilter.id || 'Missing ID'}. All data sheets use this project filter.` : 'All projects in the configured company, including projects without usage. Records absent from the project directory are retained by Procore project ID.'],
    ['Company ID', report.companyId],
    ['Labor', 'Timecard hours and daily-log labor hours are separate sources. They can overlap; this report does not assume they represent different hours.'],
    ['Subcontractors', 'Subcontractor hours are already included in the two source columns. Do not add them again.'],
    ['Materials', 'Quantity used, grouped by project, purchase-order line, description, cost code and unit. Different materials and units are not added together. Delivered quantities are not included.'],
    ['Concrete (CY)', 'Concrete quantity used, in cubic yards, using the existing concrete cost-code classification and unit corrections. Fiber and pump services are excluded.'],
    ['Rebar (tons)', 'US short tons (2,000 lb). Piece quantities use explicit bar size, length and the standard weight per foot from Estimating Tools. Recorded pounds or linear feet are converted when supported. Chairs, dowels, wire mesh and accessories are excluded.'],
    ['Rebar entries not converted', 'A positive count means the rebar tonnage is partial: these source entries lack usable or unambiguous size, length or unit. See Materials for affected items; original quantities remain available.'],
    ['Units', 'Uses saved purchase-order units and existing field-analytics corrections for concrete and fiber. Explicit labor/subcontractor LS entries follow the existing hours convention.'],
    ['Other quantities', 'Equipment, subcontract and other non-material cost types remain separate from materials.'],
    ['Review', 'Missing project IDs, quantities, coding, or usable units are listed for review and excluded from labor/material totals.'],
    ['Zero', 'Zero means no included saved quantity for this scope, not proof of no work or complete source synchronization.'],
    ['Period', 'Inclusive source work dates in UTC. Blank boundaries include all available history on that side.'],
    ['Latest mirror update (all projects)', report.latestMirrorUpdate || 'No included source records'],
    ['Freshness', 'Loaded time is the report read time. Latest mirror update is not proof that every project has synchronized.'],
    ['Deleted entries excluded (all projects)', report.excluded.deleted], ['Billing File logs excluded (all projects)', report.excluded.billingLogs],
    ['Precision', 'Quantities are rounded to four decimals after aggregation. Dollar costs are not part of this report.'],
  ], [34, 120]);
  return workbook;
}

export function downloadProjectUsageWorkbook(report: ProjectUsageReport) {
  const project = report.projectFilter ? `-${report.projectFilter.id.replace(/[^a-zA-Z0-9_-]/g, '_') || 'missing-id'}` : '';
  XLSX.writeFile(createProjectUsageWorkbook(report), `project-labor-material${project}-${report.from || 'all'}-${report.through || 'to-date'}.xlsx`, { compression: true });
}
