type UnknownRecord = Record<string, unknown>;

const DEFAULT_PROCORE_WEB_ORIGIN = "https://us02.procore.com";

export const PM_CHANGE_TYPES = ["change_event", "pco", "pcco"] as const;
export type PmChangeType = (typeof PM_CHANGE_TYPES)[number];

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function safeProcoreUrl(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:" && (hostname === "procore.com" || hostname.endsWith(".procore.com"))
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function readChangeEventStatus(changeEvent: UnknownRecord): { label: string; state: string } {
  for (const value of [changeEvent.status, changeEvent.state, changeEvent.change_event_status]) {
    if (typeof value === "string" && value.trim()) return { label: value.trim(), state: value.trim() };
    const nested = record(value);
    const label = text(nested?.name);
    const mapped = text(nested?.mapped_to_status);
    if (label || mapped) return { label: label || mapped, state: mapped || label };
  }
  return { label: "", state: "" };
}

export function changeEventStatus(changeEvent: UnknownRecord): string {
  return readChangeEventStatus(changeEvent).label;
}

export function isOpenPmChange(type: PmChangeType, status: unknown, payload?: UnknownRecord | null): boolean {
  if (payload && (payload.deleted_at || payload.deletedAt)) return false;
  if (type === "change_event" && payload?.in_recycle_bin === true) return false;
  // The retained source payload is authoritative when older mirrors saved a
  // blank status/isOpen=true after ignoring Procore's structured status object.
  const sourceStatus = type === "change_event"
    ? (payload ? readChangeEventStatus(payload).state : "") || readChangeEventStatus({ status }).state
    : text(status);
  const normalized = sourceStatus.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (!normalized) return true;

  const terminal = type === "change_event"
    ? ["closed", "complete", "completed", "void", "voided", "recycled", "deleted"]
    : ["approved", "closed", "complete", "completed", "rejected", "not proceeding", "void", "voided", "deleted"];
  return !terminal.includes(normalized);
}

export function buildProcoreChangeUrl(params: {
  type: PmChangeType;
  companyId?: unknown;
  projectId: unknown;
  sourceId: unknown;
  contractId?: unknown;
  existingUrl?: unknown;
  procoreWebOrigin?: unknown;
}): string | null {
  const existingUrl = safeProcoreUrl(params.existingUrl);
  if (existingUrl && params.type !== "change_event") return existingUrl;

  const companyId = text(params.companyId);
  const projectId = text(params.projectId);
  const sourceId = text(params.sourceId);
  if (!companyId || !projectId || !sourceId) return null;
  const configuredOrigin = safeProcoreUrl(params.procoreWebOrigin);
  const origin = configuredOrigin ? new URL(configuredOrigin).origin
    : existingUrl ? new URL(existingUrl).origin : DEFAULT_PROCORE_WEB_ORIGIN;
  const projectPath = `/webclients/host/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}`;

  if (params.type === "change_event") {
    const destination = new URL(`${projectPath}/tools/change-events/events/${encodeURIComponent(sourceId)}`, origin);
    // Saved mirrors contain our old /project/change_events/:id fallback.
    // Only an exact current destination may override the canonical identity.
    const existing = existingUrl ? new URL(existingUrl) : null;
    return existing?.origin === destination.origin && existing.pathname === destination.pathname
      ? existing.toString() : destination.toString();
  }

  const contractId = text(params.contractId);
  if (!contractId) return null;
  // Procore's browser routes differ from its REST resource names. These are
  // the destinations linked by the Change Orders tool, scoped to the prime.
  const collection = params.type === "pco" ? "prime-change-orders" : "prime-change-order-batches";
  return new URL(
    `${projectPath}/tools/contracts/prime_contracts/${encodeURIComponent(contractId)}/change_orders/${collection}/${encodeURIComponent(sourceId)}`,
    origin,
  ).toString();
}
