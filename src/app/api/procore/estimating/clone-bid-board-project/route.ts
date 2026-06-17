import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getClientCredentialsToken, procoreConfig } from "@/lib/procore";
import { buildAllowedProcoreHostCandidates } from "@/lib/procoreHosts";

type UnknownRecord = Record<string, unknown>;

const DEFAULT_ESTIMATING_BASE_URL = "https://api.procore.com";

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStr(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return "";
}

function readNum(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function readBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "0", "no", "n"].includes(normalized)) return false;
  }
  return undefined;
}

function unwrapData(value: unknown): UnknownRecord {
  if (isRecord(value) && isRecord(value.data)) return value.data;
  return isRecord(value) ? value : {};
}

function arrayFromPayload(value: unknown): UnknownRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of ["data", "projects", "bid_board_projects"]) {
    const candidate = value[key];
    if (Array.isArray(candidate)) return candidate.filter(isRecord);
  }
  return [];
}

async function getToken(bodyToken: unknown) {
  const cookieStore = await cookies();
  const explicitToken = readStr(bodyToken);
  const cookieToken = readStr(cookieStore.get("procore_access_token")?.value);
  if (explicitToken) return { accessToken: explicitToken, tokenSource: "body" };
  if (cookieToken) return { accessToken: cookieToken, tokenSource: "cookie" };
  return { accessToken: await getClientCredentialsToken(), tokenSource: "client_credentials" };
}

async function requestJson(params: {
  url: string;
  accessToken: string;
  companyId: string;
  method?: string;
  body?: unknown;
}) {
  const response = await fetch(params.url, {
    method: params.method || "GET",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      Accept: "application/json",
      ...(params.body ? { "Content-Type": "application/json" } : {}),
      "Procore-Company-Id": params.companyId,
    },
    ...(params.body ? { body: JSON.stringify(params.body) } : {}),
    cache: "no-store",
  });
  const text = await response.text();
  let payload: unknown = text;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    // Keep text response.
  }
  return { ok: response.ok, status: response.status, payload };
}

function getAddress(source: UnknownRecord): UnknownRecord {
  const address = isRecord(source.address) ? source.address : {};
  const out: UnknownRecord = {};
  const street = readStr(address.street ?? source.address_street ?? source.street);
  const city = readStr(address.city ?? source.address_city ?? source.city);
  const state = readStr(address.state ?? source.address_state ?? source.state);
  const zip = readStr(address.zip ?? source.address_zip ?? source.zip);
  const country = readStr(address.country ?? source.address_country ?? source.country);
  if (street) out.street = street;
  if (city) out.city = city;
  if (state) out.state = state;
  if (zip) out.zip = zip;
  if (country) out.country = country;
  return out;
}

function buildCreatePayload(source: UnknownRecord, overrides: UnknownRecord) {
  const payload: UnknownRecord = {};
  const sourceName = readStr(source.name ?? source.display_name ?? source.project_name);
  const overrideName = readStr(overrides.name);
  payload.name = overrideName || sourceName;

  const status = readStr(overrides.status ?? source.status) || "ESTIMATING";
  if (status) payload.status = status;

  const textFields = [
    ["description", source.description],
    ["project_number", source.project_number ?? source.projectNumber],
  ] as const;
  for (const [field, value] of textFields) {
    const overrideValue = overrides[field];
    const finalValue = readStr(overrideValue ?? value);
    if (finalValue) payload[field] = finalValue;
  }

  const dueDate = readStr(overrides.due_date ?? overrides.dueDate ?? source.due_date ?? source.dueDate);
  if (dueDate) payload.due_date = dueDate;

  const squareFootage = readNum(overrides.square_footage ?? overrides.squareFootage ?? source.square_footage ?? source.squareFootage);
  if (squareFootage !== undefined) payload.square_footage = squareFootage;

  const boolFields = [
    "use_metric_units",
    "use_tax_from_cost",
    "individual_labor_rates",
    "is_template",
    "use_unit_labor_cost",
    "wbs_validation_enabled",
    "disable_ea_parts_rounding",
  ];
  for (const field of boolFields) {
    const value = readBool(overrides[field] ?? source[field]);
    if (value !== undefined) payload[field] = value;
  }

  const address = isRecord(overrides.address) ? getAddress(overrides) : getAddress(source);
  if (Object.keys(address).length > 0) payload.address = address;

  return payload;
}

async function fetchBidBoardProject(params: {
  accessToken: string;
  companyId: string;
  bidBoardProjectId: string;
  hosts: string[];
}) {
  const attempts: UnknownRecord[] = [];
  for (const host of params.hosts) {
    const base = host.replace(/\/$/, "");
    const showUrl = `${base}/rest/v2.0/companies/${encodeURIComponent(
      params.companyId
    )}/estimating/bid_board_projects/${encodeURIComponent(params.bidBoardProjectId)}`;
    const show = await requestJson({ url: showUrl, accessToken: params.accessToken, companyId: params.companyId });
    attempts.push({ url: showUrl, status: show.status, ok: show.ok });
    if (show.ok) return { project: unwrapData(show.payload), host, attempts };

    const listUrl = `${base}/rest/v2.0/companies/${encodeURIComponent(
      params.companyId
    )}/estimating/bid_board_projects?page=1&per_page=200`;
    const list = await requestJson({ url: listUrl, accessToken: params.accessToken, companyId: params.companyId });
    attempts.push({ url: listUrl, status: list.status, ok: list.ok });
    if (list.ok) {
      const project = arrayFromPayload(list.payload).find((entry) => {
        const id = readStr(entry.id ?? entry.bid_board_project_id);
        const projectId = readStr(entry.project_id);
        return id === params.bidBoardProjectId || projectId === params.bidBoardProjectId;
      });
      if (project) return { project, host, attempts };
    }
  }
  return { project: null, host: "", attempts };
}

async function fetchProject(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  hosts: string[];
}) {
  const attempts: UnknownRecord[] = [];
  for (const host of params.hosts) {
    const base = host.replace(/\/$/, "");
    const showUrls = [
      `${base}/rest/v1.0/projects/${encodeURIComponent(params.projectId)}?company_id=${encodeURIComponent(
        params.companyId
      )}`,
      `${base}/rest/v1.0/projects/${encodeURIComponent(params.projectId)}`,
    ];

    for (const url of showUrls) {
      const show = await requestJson({ url, accessToken: params.accessToken, companyId: params.companyId });
      attempts.push({ url, status: show.status, ok: show.ok });
      if (show.ok) return { project: unwrapData(show.payload), host, attempts };
    }

    const listUrl = `${base}/rest/v1.0/projects?company_id=${encodeURIComponent(params.companyId)}&page=1&per_page=200`;
    const list = await requestJson({ url: listUrl, accessToken: params.accessToken, companyId: params.companyId });
    attempts.push({ url: listUrl, status: list.status, ok: list.ok });
    if (list.ok) {
      const project = arrayFromPayload(list.payload).find((entry) => readStr(entry.id) === params.projectId);
      if (project) return { project, host, attempts };
    }
  }
  return { project: null, host: "", attempts };
}

async function createBidBoardProject(params: {
  accessToken: string;
  companyId: string;
  host: string;
  payload: UnknownRecord;
}) {
  const url = `${params.host.replace(/\/$/, "")}/rest/v2.0/companies/${encodeURIComponent(
    params.companyId
  )}/estimating/bid_board_projects`;
  const response = await requestJson({
    url,
    method: "POST",
    accessToken: params.accessToken,
    companyId: params.companyId,
    body: params.payload,
  });
  return { ...response, url };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as UnknownRecord;
    const { accessToken, tokenSource } = await getToken(body.accessToken);

    const sourceCompanyId = readStr(body.sourceCompanyId);
    const sourceProjectId = readStr(body.sourceProjectId ?? body.projectId);
    const sourceBidBoardProjectId = readStr(body.sourceBidBoardProjectId ?? body.bidBoardProjectId);
    const targetCompanyId = readStr(body.targetCompanyId || procoreConfig.companyId);
    const dryRun = readBool(body.dryRun) !== false;
    const overrides = isRecord(body.overrides) ? body.overrides : {};
    const requestedBaseUrl = readStr(body.baseUrl || process.env.PROCORE_ESTIMATING_API_URL || DEFAULT_ESTIMATING_BASE_URL);

    if (!sourceCompanyId || (!sourceProjectId && !sourceBidBoardProjectId) || !targetCompanyId) {
      return NextResponse.json(
        { success: false, error: "sourceCompanyId, sourceProjectId, and targetCompanyId are required." },
        { status: 400 }
      );
    }

    const hostCandidates = buildAllowedProcoreHostCandidates({
      requestedOrigin: requestedBaseUrl,
      extraOrigins: [process.env.PROCORE_ESTIMATING_API_URL, DEFAULT_ESTIMATING_BASE_URL, "https://api.procore.com"],
    });
    if (hostCandidates.error) {
      return NextResponse.json({ success: false, error: hostCandidates.error }, { status: 400 });
    }

    const sourceFetch = sourceProjectId
      ? await fetchProject({
          accessToken,
          companyId: sourceCompanyId,
          projectId: sourceProjectId,
          hosts: hostCandidates.candidates,
        })
      : await fetchBidBoardProject({
          accessToken,
          companyId: sourceCompanyId,
          bidBoardProjectId: sourceBidBoardProjectId,
          hosts: hostCandidates.candidates,
        });

    if (!sourceFetch.project) {
      return NextResponse.json(
        {
          success: false,
          error: sourceProjectId ? "Source Procore project not found." : "Source bid board project not found.",
          source: { companyId: sourceCompanyId, projectId: sourceProjectId || null, bidBoardProjectId: sourceBidBoardProjectId || null },
          attempts: sourceFetch.attempts,
        },
        { status: 404 }
      );
    }

    const payload = buildCreatePayload(sourceFetch.project, overrides);
    const readyForLiveImport = Boolean(readStr(payload.name));

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        tokenSource,
        readyForLiveImport,
        source: {
          companyId: sourceCompanyId,
          projectId: sourceProjectId || null,
          bidBoardProjectId: sourceBidBoardProjectId || null,
          host: sourceFetch.host,
          project: sourceFetch.project,
        },
        target: { companyId: targetCompanyId },
        createPayload: payload,
        warnings: readyForLiveImport ? [] : ["Create payload is missing name."],
        attempts: sourceFetch.attempts,
      });
    }

    if (!readyForLiveImport) {
      return NextResponse.json(
        {
          success: false,
          dryRun: false,
          error: "Live import blocked because create payload is missing name.",
          createPayload: payload,
        },
        { status: 409 }
      );
    }

    const created = await createBidBoardProject({
      accessToken,
      companyId: targetCompanyId,
      host: sourceFetch.host || hostCandidates.candidates[0],
      payload,
    });

    if (!created.ok) {
      return NextResponse.json(
        {
          success: false,
          dryRun: false,
          error: `Create bid board project API error ${created.status}`,
          upstream: created.payload,
          url: created.url,
          createPayload: payload,
        },
        { status: created.status }
      );
    }

    const createdProject = unwrapData(created.payload);
    return NextResponse.json({
      success: true,
      dryRun: false,
      tokenSource,
      source: {
        companyId: sourceCompanyId,
        projectId: sourceProjectId || null,
        bidBoardProjectId: sourceBidBoardProjectId || null,
      },
      target: { companyId: targetCompanyId },
      createPayload: payload,
      created: {
        url: created.url,
        status: created.status,
        bidBoardProjectId: readStr(createdProject.id ?? createdProject.bid_board_project_id) || null,
        projectId: readStr(createdProject.project_id) || null,
        data: created.payload,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: "Failed to clone bid board project.", details: message },
      { status: 500 }
    );
  }
}
