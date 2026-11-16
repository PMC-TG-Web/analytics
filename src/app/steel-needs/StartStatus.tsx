import type { SteelProject } from '@/lib/steelNeeds';
import { month } from './format';

/** Green once field work has started; red until then, showing the planned WIP start month. */
export default function StartStatus({ project, className = '' }: {
  project: Pick<SteelProject, 'started' | 'plannedStart' | 'dailyLogs' | 'timesheets' | 'firstActivity'>; className?: string;
}) {
  const title = `${project.dailyLogs} daily-log entries · ${project.timesheets} timesheet entries · first field entry ${project.firstActivity || 'none'}`;
  return project.started
    ? <span title={title} className={`font-semibold text-emerald-700 ${className}`}>Started</span>
    : <span title={title} className={`font-semibold text-red-700 ${className}`}>{project.plannedStart ? `Starts ${month(project.plannedStart)}` : month(null)}</span>;
}
