function savedNumber(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const parsed = Number(text.replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function resolveEstimateActualHours(
  entryValue: unknown,
  cardValue: unknown,
  calculatedValue: number,
) {
  // Inline KPI edits remain authoritative; card-editor entries supply months
  // that have no inline override. An explicit zero is still a saved override.
  const hours = savedNumber(entryValue) ?? savedNumber(cardValue);
  return { hours: hours ?? calculatedValue, isManual: hours !== null };
}
