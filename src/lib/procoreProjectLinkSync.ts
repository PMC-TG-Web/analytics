import { makeRequest } from "@/lib/procore";
import { createCommitmentMakerAccessToken } from "@/lib/commitmentMakerAccess";

type UnknownRecord = Record<string, unknown>;

export type ProjectLinkSyncStatus =
  | "missing_folder"
  | "missing_file"
  | "missing_file_url"
  | "created"
  | "updated"
  | "unchanged";

export type ProjectLinkSyncResult = {
  status: ProjectLinkSyncStatus;
  folderId?: string;
  documentId?: string;
  fileVersionId?: string;
  linkId?: string;
  url?: string;
};

export type StaticProjectLinkSyncResult = {
  status: "created" | "updated" | "unchanged";
  linkId?: string;
  title: string;
  url: string;
};

const DEFAULT_FOLDER_NAME = "Job-Schedule";
const DEFAULT_FILE_NAME = "PMC_JobSchedule.xlsx";
const DEFAULT_LINK_TITLE = "PMC Job Schedule";
const DEFAULT_COMMITMENT_MAKER_LINK_TITLE = "Commitment Maker";
const DEFAULT_ANALYTICS_BASE_URL = "https://analyticspmc.netlify.app";
const MANAGED_LINK_TITLES = new Set(["job schedule", "pmc job schedule"]);
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function normalized(value: unknown): string {
  return text(value).toLocaleLowerCase("en-US");
}

function compactFileName(value: unknown): string {
  return normalized(value).replace(/[^a-z0-9]/g, "");
}

function rowsFromPayload(payload: unknown): UnknownRecord[] {
  const rows = Array.isArray(payload) ? payload : record(payload).data;
  return Array.isArray(rows)
    ? rows.filter((row): row is UnknownRecord => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    : [];
}

function isRemoved(row: UnknownRecord): boolean {
  return row.is_deleted === true
    || row.deleted === true
    || row.is_in_recycle_bin === true
    || row.in_recycle_bin === true;
}

function documentKind(row: UnknownRecord): string {
  return normalized(row.document_type || row.type || row.kind);
}

function documentId(row: UnknownRecord): string {
  return text(row.id);
}

function parentId(row: UnknownRecord): string {
  return text(row.parent_id || record(row.parent).id || row.folder_id);
}

export function findJobScheduleDocument(
  documents: unknown,
  folderName = DEFAULT_FOLDER_NAME,
  fileName = DEFAULT_FILE_NAME,
): { status: "missing_folder" | "missing_file" | "found"; folderId?: string; file?: UnknownRecord } {
  const rows = rowsFromPayload(documents).filter((row) => !isRemoved(row));
  const matchingFolders = rows.filter((row) => (
    documentKind(row).includes("folder")
    && normalized(row.name) === normalized(folderName)
    && Boolean(documentId(row))
  ));
  if (!matchingFolders.length) return { status: "missing_folder" };

  const folderIds = new Set(matchingFolders.map(documentId));
  const expectedFileName = compactFileName(fileName);
  const matchingFiles = rows.filter((row) => (
    !documentKind(row).includes("folder")
    && compactFileName(row.name || row.file_name || row.filename) === expectedFileName
    && folderIds.has(parentId(row))
  ));
  const file = matchingFiles.sort((left, right) => {
    const leftVersion = record(record(left.file).current_version);
    const rightVersion = record(record(right.file).current_version);
    const leftTime = Date.parse(text(leftVersion.updated_at || leftVersion.created_at || left.updated_at)) || 0;
    const rightTime = Date.parse(text(rightVersion.updated_at || rightVersion.created_at || right.updated_at)) || 0;
    return rightTime - leftTime || Number(documentId(right)) - Number(documentId(left));
  })[0];
  const folderId = file ? parentId(file) : documentId(matchingFolders[0]);
  return file ? { status: "found", folderId, file } : { status: "missing_file", folderId };
}

export function jobScheduleFileUrl(
  file: unknown,
  companyId: string,
  projectId: string,
): string | null {
  const fileRecord = record(file);
  const currentVersion = record(record(fileRecord.file).current_version);
  const normalizedCompanyId = text(companyId);
  const normalizedProjectId = text(projectId);
  const normalizedDocumentId = documentId(fileRecord);
  const creatorId = text(record(currentVersion.created_by).id || record(fileRecord.created_by).id);
  if (
    !/^\d+$/.test(normalizedCompanyId)
    || !/^\d+$/.test(normalizedProjectId)
    || !/^\d+$/.test(normalizedDocumentId)
    || !/^\d+$/.test(creatorId)
  ) return null;

  const url = new URL(`/wopi/viewer/${encodeURIComponent(normalizedDocumentId)}`, "https://wopi.procore.com");
  url.search = new URLSearchParams({
    project_id: normalizedProjectId,
    company_id: normalizedCompanyId,
    hint: creatorId,
    mode: "view",
  }).toString();
  url.hash = "";
  return url.toString();
}

export function buildProjectLinksBulkUpdate(
  existingPayload: unknown,
  title: string,
  url: string,
): { changed: boolean; action: "created" | "updated" | "unchanged"; body: Array<{ id?: string; title: string; url: string }>; linkId?: string } {
  const rows = rowsFromPayload(existingPayload)
    .map((row, index) => ({ row, index, position: Number(row.position) }))
    .sort((left, right) => {
      const leftPosition = Number.isFinite(left.position) ? left.position : left.index;
      const rightPosition = Number.isFinite(right.position) ? right.position : right.index;
      return leftPosition - rightPosition || left.index - right.index;
    })
    .map(({ row }) => row);

  const body: Array<{ id?: string; title: string; url: string }> = rows.map((row) => {
    const id = text(row.id);
    const existingTitle = text(row.title || row.name);
    const existingUrl = text(row.url);
    if (!id || !existingTitle || !existingUrl) {
      throw new Error("Procore returned a project link without an id, title, or URL; refusing a bulk update that could drop it.");
    }
    return { id, title: existingTitle, url: existingUrl };
  });

  const normalizedTitle = normalized(title);
  const managedTitles = MANAGED_LINK_TITLES.has(normalizedTitle)
    ? MANAGED_LINK_TITLES
    : new Set([normalizedTitle]);
  const existingIndex = body.findIndex((link) => managedTitles.has(normalized(link.title)));
  if (existingIndex < 0) {
    body.push({ title, url });
    return { changed: true, action: "created", body };
  }

  const existing = body[existingIndex];
  if (existing.title === title && existing.url === url) {
    return { changed: false, action: "unchanged", body, linkId: existing.id };
  }
  body[existingIndex] = { id: existing.id, title, url };
  return { changed: true, action: "updated", body, linkId: existing.id };
}

export function commitmentMakerProjectUrl(
  projectId: string,
  baseUrl = process.env.APP_BASE_URL || DEFAULT_ANALYTICS_BASE_URL,
  accessToken = "",
): string {
  const normalizedProjectId = text(projectId);
  if (!/^\d+$/.test(normalizedProjectId)) {
    throw new Error("A numeric Procore project ID is required for the Commitment Maker link.");
  }
  const parsed = new URL(text(baseUrl) || DEFAULT_ANALYTICS_BASE_URL);
  if (parsed.protocol !== "https:") {
    throw new Error("The Commitment Maker project link must use HTTPS.");
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(text(accessToken))) {
    throw new Error("A signed Commitment Maker project access token is required.");
  }
  parsed.pathname = "/procore/commitments-live/maker";
  parsed.search = new URLSearchParams({
    projectId: normalizedProjectId,
    source: "procore-project-home",
    access: text(accessToken),
  }).toString();
  parsed.hash = "";
  return parsed.toString();
}

async function fetchAllPages(params: {
  path: string;
  token: string;
  companyId: string;
  query?: Record<string, string>;
}) {
  const rows: UnknownRecord[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const query = new URLSearchParams({
      ...(params.query || {}),
      page: String(page),
      per_page: String(PAGE_SIZE),
    });
    const payload = await makeRequest(
      `${params.path}?${query.toString()}`,
      params.token,
      { method: "GET", cache: "no-store" },
      params.companyId,
    );
    const pageRows = rowsFromPayload(payload);
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) return rows;
  }
  throw new Error(`Procore pagination exceeded ${MAX_PAGES} pages for ${params.path}.`);
}

export async function syncJobScheduleProjectLink(params: {
  token: string;
  companyId: string;
  projectId: string;
  folderName?: string;
  fileName?: string;
  linkTitle?: string;
}): Promise<ProjectLinkSyncResult> {
  const folderName = text(params.folderName || process.env.PROCORE_JOB_SCHEDULE_FOLDER_NAME) || DEFAULT_FOLDER_NAME;
  const fileName = text(params.fileName || process.env.PROCORE_JOB_SCHEDULE_FILE_NAME) || DEFAULT_FILE_NAME;
  const linkTitle = text(params.linkTitle || process.env.PROCORE_JOB_SCHEDULE_LINK_TITLE) || DEFAULT_LINK_TITLE;
  const projectId = encodeURIComponent(params.projectId);
  const companyId = encodeURIComponent(params.companyId);

  const documents = await fetchAllPages({
    path: `/rest/v2.0/projects/${projectId}/documents`,
    token: params.token,
    companyId: params.companyId,
    query: { view: "extended", "filters[is_in_recycle_bin]": "false" },
  });
  const match = findJobScheduleDocument(documents, folderName, fileName);
  if (match.status !== "found") return { status: match.status, folderId: match.folderId };

  const file = match.file || {};
  const url = jobScheduleFileUrl(file, params.companyId, params.projectId);
  const baseResult = {
    folderId: match.folderId,
    documentId: documentId(file),
    fileVersionId: text(record(record(file.file).current_version).id) || undefined,
  };
  if (!url) return { status: "missing_file_url", ...baseResult };

  const linksPath = `/rest/v2.0/companies/${companyId}/projects/${projectId}/links`;
  const links = await fetchAllPages({
    path: linksPath,
    token: params.token,
    companyId: params.companyId,
  });
  const update = buildProjectLinksBulkUpdate(links, linkTitle, url);
  if (!update.changed) {
    return { status: "unchanged", ...baseResult, url, linkId: update.linkId };
  }

  const response = await makeRequest(
    `${linksPath}/bulk_update`,
    params.token,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update.body),
    },
    params.companyId,
  );
  const updatedLinks = rowsFromPayload(response);
  const saved = updatedLinks.find((link) => normalized(link.title || link.name) === normalized(linkTitle));
  return {
    status: update.action,
    ...baseResult,
    url,
    linkId: text(saved?.id) || update.linkId,
  };
}

export async function syncCommitmentMakerProjectLink(params: {
  token: string;
  companyId: string;
  projectId: string;
  linkTitle?: string;
  baseUrl?: string;
}): Promise<StaticProjectLinkSyncResult> {
  const linkTitle = text(
    params.linkTitle || process.env.PROCORE_COMMITMENT_MAKER_LINK_TITLE,
  ) || DEFAULT_COMMITMENT_MAKER_LINK_TITLE;
  const accessToken = await createCommitmentMakerAccessToken(params.projectId);
  const url = commitmentMakerProjectUrl(params.projectId, params.baseUrl, accessToken);
  const projectId = encodeURIComponent(params.projectId);
  const companyId = encodeURIComponent(params.companyId);
  const linksPath = `/rest/v2.0/companies/${companyId}/projects/${projectId}/links`;
  const links = await fetchAllPages({
    path: linksPath,
    token: params.token,
    companyId: params.companyId,
  });
  const update = buildProjectLinksBulkUpdate(links, linkTitle, url);
  if (!update.changed) {
    return { status: "unchanged", title: linkTitle, url, linkId: update.linkId };
  }

  const response = await makeRequest(
    `${linksPath}/bulk_update`,
    params.token,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update.body),
    },
    params.companyId,
  );
  const updatedLinks = rowsFromPayload(response);
  const saved = updatedLinks.find((link) => normalized(link.title || link.name) === normalized(linkTitle));
  return {
    status: update.action,
    title: linkTitle,
    url,
    linkId: text(saved?.id) || update.linkId,
  };
}
