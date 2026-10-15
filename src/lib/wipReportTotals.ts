import type { WipReportProject } from './wipReportImport';
import type { WipScheduledHours } from './wipScheduledHours';
import type { WipScheduledSales } from './wipScheduledSales';

export function addWipReportHours(report: WipScheduledHours, projects: WipReportProject[]): WipScheduledHours {
  const months = { ...report.months };
  for (const project of projects) for (const line of project.lines) months[line.month] = (months[line.month] || 0) + line.hours;
  return { ...report, months, years: [...new Set(Object.keys(months).map(month => month.slice(0, 4)))].sort(), reportProjectCount: projects.length };
}

export function addWipReportSales(report: WipScheduledSales, projects: WipReportProject[]): WipScheduledSales {
  const months = { ...report.months }, projectsByMonth = Object.fromEntries(Object.entries(report.projectsByMonth).map(([month, rows]) => [month, [...rows]]));
  for (const project of projects) for (const line of project.lines) {
    months[line.month] = (months[line.month] || 0) + line.revenue;
    if (!line.revenue && !line.hours) continue;
    (projectsByMonth[line.month] ||= []).push({ id: `${project.id}:${line.row}`, projectName: project.projectName, projectNumber: '', customer: project.customer, value: line.revenue, dateLabel: `${line.month} · WIP report row ${line.row}`, projectValue: line.contractValue ?? undefined, percent: line.percent });
  }
  return { ...report, months, projectsByMonth, years: [...new Set(Object.keys(months).map(month => month.slice(0, 4)))].sort(), reportProjectCount: projects.length };
}
