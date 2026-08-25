export type ProcoreSyncHealthSnapshot = {
  datasets: Array<{
    dataset: string;
    never_succeeded: number;
    failed_projects: number;
    max_failure_count: number;
    due_projects?: number;
    oldest_due?: Date | string | null;
    newest_success: Date | string | null;
  }>;
  webhookQueue: Array<{
    status: string;
    count: number;
    oldest_available: Date | string | null;
  }>;
  timecardNotifications?: Array<{
    status: string;
    count: number;
    oldest_available: Date | string | null;
  }>;
  projectReconciliation: {
    last_success_at: Date | string | null;
    last_attempt_at: Date | string | null;
  } | null;
};

function ageMinutes(value: Date | string | null, now: Date) {
  if (!value) return Number.POSITIVE_INFINITY;
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? (now.getTime() - timestamp) / 60_000 : Number.POSITIVE_INFINITY;
}

function easternMinuteOfDay(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function actualsStalenessMonitoringPaused(now: Date) {
  const minute = easternMinuteOfDay(now);
  // scheduled-sync runs nightly structure work instead of Actuals from 2:00-6:00
  // Eastern. Give the Actuals worker another 30 minutes to resume after that window.
  return minute >= 2 * 60 && minute < 6 * 60 + 30;
}

export function evaluateProcoreSyncHealth(snapshot: ProcoreSyncHealthSnapshot, now = new Date()) {
  const issues: string[] = [];
  const datasets = new Map(snapshot.datasets.map((row) => [row.dataset, row]));
  const actuals = datasets.get("actuals");
  const actualsIsStale = !actuals || ageMinutes(actuals.newest_success, now) > 180;
  if (actualsIsStale && !actualsStalenessMonitoringPaused(now)) {
    issues.push("Actuals have not completed successfully within 3 hours.");
  } else if (actuals && actuals.failed_projects > 5) {
    issues.push(`${actuals.failed_projects} actuals projects are failing.`);
  }

  const structure = datasets.get("nightly_structure");
  if (structure && structure.failed_projects > 5) {
    issues.push(`${structure.failed_projects} nightly structure projects are failing.`);
  }

  const estimates = datasets.get("nightly_estimates");
  if (
    estimates
    && Number(estimates.due_projects || 0) > 0
    && ageMinutes(estimates.oldest_due || null, now) > 120
  ) {
    issues.push(
      `${estimates.due_projects} estimate detail project(s) have been overdue for more than 2 hours.`,
    );
  }
  if (estimates && estimates.max_failure_count >= 3) {
    issues.push(`${estimates.failed_projects} estimate detail project(s) are repeatedly failing.`);
  }

  const onboarding = datasets.get("project_onboarding");
  if (onboarding && onboarding.max_failure_count >= 3) {
    issues.push(
      `${onboarding.failed_projects} project onboarding job(s) are repeatedly failing.`,
    );
  }

  const projectLinks = datasets.get("project_home_links");
  if (projectLinks && projectLinks.max_failure_count >= 3) {
    issues.push(
      `${projectLinks.failed_projects} Project Link Sync job(s) are repeatedly failing.`,
    );
  }

  const reconciliationAge = ageMinutes(snapshot.projectReconciliation?.last_success_at || null, now);
  if (reconciliationAge > 120) {
    issues.push("The full active-project reconciliation has not succeeded within 2 hours.");
  }

  for (const row of snapshot.webhookQueue) {
    const status = String(row.status || "").toLowerCase();
    if (status === "failed" && row.count > 0) {
      issues.push(`${row.count} Procore webhook event(s) are permanently failed.`);
    }
    if (["pending", "processing"].includes(status) && ageMinutes(row.oldest_available, now) > 20) {
      issues.push(`${row.count} Procore webhook event(s) have been stuck for more than 20 minutes.`);
    }
  }

  for (const row of snapshot.timecardNotifications || []) {
    const status = String(row.status || "").toLowerCase();
    if (status === "failed" && row.count > 0) {
      issues.push(`${row.count} timecard notification(s) are permanently failed.`);
    }
    if (["pending", "processing"].includes(status) && ageMinutes(row.oldest_available, now) > 30) {
      issues.push(`${row.count} timecard notification(s) have been stuck for more than 30 minutes.`);
    }
  }

  return issues;
}

export function procoreHealthAlertFingerprint(issues: string[]) {
  return issues.slice().sort().join("\n").slice(0, 4_000).replace(/\d+/g, "#");
}
