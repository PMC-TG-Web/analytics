type JsonObject = Record<string, unknown>;

const LOCAL_SYNC_FIELDS = new Set([
  "sync_missing_at",
  "sync_missing_from_procore",
]);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
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
