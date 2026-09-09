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

export function changeEventStatus(changeEvent: UnknownRecord): string {
  const direct = text(changeEvent.status ?? changeEvent.state);
  if (direct) return direct;
  const nested = record(changeEvent.change_event_status);
  return text(nested?.name ?? nested?.mapped_to_status);
}

export function isOpenPmChange(type: PmChangeType, status: unknown, payload?: UnknownRecord | null): boolean {
  if (payload && (payload.deleted_at || payload.deletedAt)) return false;
  const normalized = text(status).toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (!normalized) return true;

  const terminal = type === "change_event"
    ? ["closed", "void", "voided", "deleted"]
    : ["approved", "closed", "complete", "completed", "rejected", "not proceeding", "void", "voided", "deleted"];
  return !terminal.includes(normalized);
}

export function buildProcoreChangeUrl(params: {
  type: PmChangeType;
  projectId: unknown;
  sourceId: unknown;
  contractId?: unknown;
  existingUrl?: unknown;
  procoreWebOrigin?: unknown;
}): string | null {
  const existingUrl = safeProcoreUrl(params.existingUrl);
  if (existingUrl) return existingUrl;

  const projectId = text(params.projectId);
  const sourceId = text(params.sourceId);
  if (!projectId || !sourceId) return null;
  const configuredOrigin = safeProcoreUrl(params.procoreWebOrigin);
  const origin = configuredOrigin ? new URL(configuredOrigin).origin : DEFAULT_PROCORE_WEB_ORIGIN;
  const projectPath = `/${encodeURIComponent(projectId)}/project`;

  if (params.type === "change_event") {
    return new URL(`${projectPath}/change_events/${encodeURIComponent(sourceId)}`, origin).toString();
  }

  const contractId = text(params.contractId);
  if (!contractId) return null;
  const collection = params.type === "pco" ? "potential_change_orders" : "change_order_packages";
  return new URL(
    `${projectPath}/contracts/${encodeURIComponent(contractId)}/${collection}/${encodeURIComponent(sourceId)}`,
    origin,
  ).toString();
}
