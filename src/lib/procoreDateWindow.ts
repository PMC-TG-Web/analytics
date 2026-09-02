const PROCORE_TIME_ZONE = "America/New_York";

const procoreDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: PROCORE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function formatProcoreDate(date: Date): string {
  const parts = procoreDateFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error("Unable to format the Procore date window.");
  }
  return `${year}-${month}-${day}`;
}

export function procoreLookbackWindow(now: Date, lookbackDays: number) {
  const safeLookbackDays = Math.max(0, Math.trunc(lookbackDays));
  return {
    startDate: formatProcoreDate(new Date(now.getTime() - safeLookbackDays * 86_400_000)),
    endDate: formatProcoreDate(now),
  };
}

const DAY_MS = 86_400_000;

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(parsed) ? Math.trunc(parsed) : fallback));
}

export function buildIncrementalActualsWindow(params: {
  now: Date;
  lastSuccessAt: Date | null;
  initialLookbackDays?: number;
  overlapDays?: number;
}) {
  const initialLookbackDays = boundedInteger(params.initialLookbackDays, 45, 7, 120);
  const overlapDays = boundedInteger(params.overlapDays, 3, 1, 14);
  const initialStartMs = params.now.getTime() - initialLookbackDays * DAY_MS;
  const incrementalStartMs = params.lastSuccessAt
    ? params.lastSuccessAt.getTime() - overlapDays * DAY_MS
    : initialStartMs;
  const startMs = Math.max(initialStartMs, Math.min(params.now.getTime(), incrementalStartMs));
  return {
    startDate: formatProcoreDate(new Date(startMs)),
    endDate: formatProcoreDate(params.now),
    mode: params.lastSuccessAt ? "incremental" : "bootstrap",
    overlapDays,
  };
}

function priorReconciliationOffset(lastResult: unknown) {
  if (!lastResult || typeof lastResult !== "object" || Array.isArray(lastResult)) return 0;
  const cursor = (lastResult as Record<string, unknown>).reconciliationCursor;
  if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return 0;
  return boundedInteger((cursor as Record<string, unknown>).nextOffsetDays, 0, 0, 730);
}

export function buildReconciliationActualsWindow(params: {
  now: Date;
  lastResult: unknown;
  totalLookbackDays?: number;
  chunkDays?: number;
}) {
  const totalLookbackDays = boundedInteger(params.totalLookbackDays, 400, 30, 730);
  const chunkDays = boundedInteger(params.chunkDays, 100, 30, 180);
  const offsetDays = Math.min(priorReconciliationOffset(params.lastResult), totalLookbackDays);
  const nextOffsetDays = Math.min(totalLookbackDays, offsetDays + chunkDays);
  const completedCycle = nextOffsetDays >= totalLookbackDays;
  return {
    startDate: formatProcoreDate(new Date(params.now.getTime() - nextOffsetDays * DAY_MS)),
    endDate: formatProcoreDate(new Date(params.now.getTime() - offsetDays * DAY_MS)),
    mode: "reconciliation-chunk",
    reconciliationCursor: {
      offsetDays,
      nextOffsetDays: completedCycle ? 0 : nextOffsetDays,
      totalLookbackDays,
      chunkDays,
      completedCycle,
    },
  };
}
