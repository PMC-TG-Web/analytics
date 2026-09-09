type ProjectScope = {
  projectName?: string | null;
  status?: string | null;
  bidBoardStatus?: string | null;
};

function normalized(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
}

export function procorePollingProjectClass(project: ProjectScope) {
  if (/template/i.test(project.projectName || "")) return "excluded";
  // Bid Board status is the canonical business status; portfolio status uses
  // different labels (notably Post-Construction for Complete).
  const status = normalized(project.bidBoardStatus) || normalized(project.status);
  if (/cancel|lost|no bid|do not bid/.test(status)) return "excluded";
  if (["complete", "completed", "closed", "post construction"].includes(status)) return "closeout";
  if (["bidding", "bid submitted", "estimating", "pre construction"].includes(status)) return "bidding";
  return "active";
}

export function pmDashboardPollingMinutes(project: ProjectScope, activeMinutes = 90): number | null {
  const scope = procorePollingProjectClass(project);
  if (scope === "excluded") return null;
  if (scope === "closeout") return Math.max(activeMinutes, 24 * 60);
  if (scope === "bidding") return Math.max(activeMinutes, 6 * 60);
  return activeMinutes;
}

export function purchaseOrderDiscoveryPolling(params: {
  previousEmptyChecks: unknown;
  success: boolean;
  lineCount: number;
}) {
  const parsed = Number(params.previousEmptyChecks);
  const previous = Number.isFinite(parsed) ? Math.max(0, Math.min(7, Math.trunc(parsed))) : 0;
  if (!params.success) return { emptyChecks: previous, nextRunMinutes: 30 };
  if (params.lineCount > 0) return { emptyChecks: 0, nextRunMinutes: 365 * 24 * 60 };
  const emptyChecks = Math.min(7, previous + 1);
  return { emptyChecks, nextRunMinutes: Math.min(24 * 60, 30 * 2 ** (emptyChecks - 1)) };
}

export function actualsPollingMinutes(params: {
  active: boolean;
  recentlyActive: boolean;
  activeMinutes: number;
  idleMinutes: number;
  webhookCoverage: unknown;
  webhookVerifiedAt: Date | null;
  webhookFailureCount: number;
  lastActualsEventAt: Date | null;
  now?: Date;
}) {
  if (!params.active) return params.idleMinutes;
  const nowMs = (params.now || new Date()).getTime();
  const recent = (date: Date | null, days: number) => Boolean(date
    && date.getTime() <= nowMs && date.getTime() >= nowMs - days * 86_400_000);
  // Registration alone doesn't establish a functioning delivery path. Retain
  // the existing interval until both coverage and actual deliveries are known.
  const covered = params.webhookCoverage === true && params.webhookFailureCount === 0
    && recent(params.webhookVerifiedAt, 8) && recent(params.lastActualsEventAt, 7);
  if (!covered) return params.activeMinutes;
  return Math.max(params.activeMinutes, params.recentlyActive ? 180 : 360);
}
