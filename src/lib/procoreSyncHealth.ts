export type ProcoreSyncHealthSnapshot = {
  datasets: Array<{
    dataset: string;
    never_succeeded: number;
    failed_projects: number;
    max_failure_count: number;
    newest_success: Date | string | null;
  }>;
  webhookQueue: Array<{
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

export function evaluateProcoreSyncHealth(snapshot: ProcoreSyncHealthSnapshot, now = new Date()) {
  const issues: string[] = [];
  const datasets = new Map(snapshot.datasets.map((row) => [row.dataset, row]));
  const actuals = datasets.get("actuals");
  if (!actuals || ageMinutes(actuals.newest_success, now) > 180) {
    issues.push("Actuals have not completed successfully within 3 hours.");
  } else if (actuals.failed_projects > 5) {
    issues.push(`${actuals.failed_projects} actuals projects are failing.`);
  }

  const structure = datasets.get("nightly_structure");
  if (structure && structure.failed_projects > 5) {
    issues.push(`${structure.failed_projects} nightly structure projects are failing.`);
  }

  const onboarding = datasets.get("project_onboarding");
  if (onboarding && onboarding.max_failure_count >= 3) {
    issues.push(
      `${onboarding.failed_projects} project onboarding job(s) are repeatedly failing.`,
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

  return issues;
}

export function procoreHealthAlertFingerprint(issues: string[]) {
  return issues.slice().sort().join("\n").slice(0, 4_000).replace(/\d+/g, "#");
}
