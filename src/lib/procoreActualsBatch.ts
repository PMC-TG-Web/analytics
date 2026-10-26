// Catch up delayed work within the existing per-tick quota and time limits.
export function actualsBatchSize({
  dueProjects,
  oldestDue,
  cap,
  now = new Date(),
}: {
  dueProjects: number;
  oldestDue: Date | string | null;
  cap: number;
  now?: Date;
}) {
  const oldest = oldestDue ? new Date(oldestDue).getTime() : NaN;
  const catchingUp = dueProjects > 0 && now.getTime() - oldest > 30 * 60_000;
  return Math.min(cap, catchingUp ? Math.max(3, dueProjects) : Math.max(3, Math.ceil(dueProjects / 12)));
}
