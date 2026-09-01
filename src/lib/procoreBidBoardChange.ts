type JsonObject = Record<string, unknown>;

const LOCAL_SYNC_FIELDS = new Set([
  "sync_missing_at",
  "sync_missing_from_procore",
]);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  // PostgreSQL JSONB and JavaScript can choose adjacent IEEE-754
  // representations for the same Procore decimal (for example,
  // 462372.34269816 vs 462372.34269816004). Treat sub-micro-unit drift as
  // serialization noise so an unchanged Bid Board project is not requeued on
  // every header poll.
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 1e6) / 1e6;
  }
  if (!value || typeof value !== "object") return value;

  const object = value as JsonObject;
  return Object.fromEntries(
    Object.keys(object)
      .filter((key) => !LOCAL_SYNC_FIELDS.has(key))
      .sort()
      .map((key) => [key, canonicalize(object[key])]),
  );
}

export function bidBoardPayloadChanged(previous: unknown, current: unknown): boolean {
  if (previous == null) return true;
  return JSON.stringify(canonicalize(previous)) !== JSON.stringify(canonicalize(current));
}

export function bidBoardPayloadNeedsPersistence(previous: unknown, current: unknown): boolean {
  if (!previous || typeof previous !== "object" || Array.isArray(previous)) return true;
  const previousObject = previous as JsonObject;
  return previousObject.sync_missing_from_procore === true
    || bidBoardPayloadChanged(previous, current);
}
