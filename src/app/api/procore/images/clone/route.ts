import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getClientCredentialsToken, procoreConfig } from "@/lib/procore";

export const dynamic = "force-dynamic";

type UnknownRecord = Record<string, unknown>;

class ImageCreateAttemptError extends Error {
  uploadId: string;
  s3Status: number;
  attempts: UnknownRecord[];

  constructor(message: string, uploadId: string, s3Status: number, attempts: UnknownRecord[]) {
    super(message);
    this.name = "ImageCreateAttemptError";
    this.uploadId = uploadId;
    this.s3Status = s3Status;
    this.attempts = attempts;
  }
}

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
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function readBool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "0", "no", "n"].includes(normalized)) return false;
  }
  return fallback;
}

function normalize(value: unknown): string {
  return readStr(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function rowsFromPayload(value: unknown, keys: string[] = []): UnknownRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of ["data", ...keys]) {
    const nested = value[key];
    if (Array.isArray(nested)) return nested.filter(isRecord);
  }
  return readStr(value.id) ? [value] : [];
}

function nestedRecord(value: unknown, key: string): UnknownRecord {
  return isRecord(value) && isRecord(value[key]) ? value[key] : {};
}

function compactPayload(value: UnknownRecord) {
  const out: UnknownRecord = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || entry === null || entry === "") continue;
    if (isRecord(entry) && Object.keys(entry).length === 0) continue;
    out[key] = entry;
  }
  return out;
}

function parseIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(readStr).filter(Boolean);
  return readStr(value)
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function contentTypeForFileName(filename: string, fallback: string) {
  if (fallback) return fallback;
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".heic")) return "image/heic";
  return "image/jpeg";
}

async function getToken(bodyToken: unknown) {
  const cookieStore = await cookies();
  const explicitToken = readStr(bodyToken);
  const cookieToken = readStr(cookieStore.get("procore_access_token")?.value);
  if (explicitToken) return { accessToken: explicitToken, tokenSource: "body" };
  if (cookieToken) return { accessToken: cookieToken, tokenSource: "cookie" };
  return { accessToken: await getClientCredentialsToken(), tokenSource: "client_credentials" };
}

async function procoreJson(params: {
  accessToken: string;
  companyId: string;
  path: string;
  method?: string;
  body?: unknown;
}) {
  const method = params.method || "GET";
  const response = await fetch(`${procoreConfig.apiUrl}${params.path}`, {
    method,
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      Accept: "application/json",
      ...(params.body === undefined ? {} : { "Content-Type": "application/json" }),
      "Procore-Company-Id": params.companyId,
    },
    body: params.body === undefined ? undefined : JSON.stringify(params.body),
    cache: "no-store",
  });
  const text = await response.text();
  let payload: unknown = text;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    // Keep text body.
  }
  if (!response.ok) {
    const message = typeof payload === "string" ? payload : JSON.stringify(payload);
    throw new Error(`Procore ${method} ${params.path} failed (${response.status}): ${message}`);
  }
  return payload;
}

async function fetchPaged(params: {
  accessToken: string;
  companyId: string;
  path: string;
  keys?: string[];
  maxPages: number;
}) {
  const rows: UnknownRecord[] = [];
  for (let page = 1; page <= params.maxPages; page += 1) {
    const separator = params.path.includes("?") ? "&" : "?";
    const payload = await procoreJson({
      accessToken: params.accessToken,
      companyId: params.companyId,
      path: `${params.path}${separator}page=${page}&per_page=100`,
    });
    const pageRows = rowsFromPayload(payload, params.keys || []);
    rows.push(...pageRows);
    if (pageRows.length < 100) break;
  }
  return rows;
}

async function fetchImageCategories(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  maxPages: number;
}) {
  return fetchPaged({
    accessToken: params.accessToken,
    companyId: params.companyId,
    path: `/rest/v1.0/image_categories?project_id=${encodeURIComponent(params.projectId)}`,
    keys: ["image_categories"],
    maxPages: params.maxPages,
  });
}

async function fetchImages(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  maxPages: number;
}) {
  return fetchPaged({
    accessToken: params.accessToken,
    companyId: params.companyId,
    path: `/rest/v1.0/images?project_id=${encodeURIComponent(params.projectId)}`,
    keys: ["images"],
    maxPages: params.maxPages,
  });
}

async function createImageCategory(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  payload: UnknownRecord;
}) {
  return procoreJson({
    accessToken: params.accessToken,
    companyId: params.companyId,
    method: "POST",
    path: `/rest/v1.0/image_categories?project_id=${encodeURIComponent(params.projectId)}`,
    body: { image_category: params.payload },
  });
}

async function createCompanyUpload(params: {
  accessToken: string;
  companyId: string;
  filename: string;
  contentType: string;
  bytes: Buffer;
}) {
  const md5Hex = createHash("md5").update(params.bytes).digest("hex");
  const sha256Hex = createHash("sha256").update(params.bytes).digest("hex");
  const response = await fetch(`https://us02.procore.com/rest/v2.0/companies/${encodeURIComponent(params.companyId)}/uploads`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "Procore-Company-Id": params.companyId,
    },
    body: JSON.stringify({
      name: params.filename,
      content_type: params.contentType,
      size: params.bytes.byteLength,
      md5: md5Hex,
      sha256: sha256Hex,
    }),
    cache: "no-store",
  });
  const text = await response.text();
  let payload: unknown = text;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    // Keep text.
  }
  if (!response.ok || !isRecord(payload)) {
    throw new Error(`Create upload failed (${response.status}): ${typeof payload === "string" ? payload : JSON.stringify(payload)}`);
  }
  const record = isRecord(payload.data) ? payload.data : payload;
  const uploadId = readStr(record.id);
  const url = readStr(record.url);
  const headers = isRecord(record.headers) ? record.headers : {};
  if (!uploadId || !url || Object.keys(headers).length === 0) throw new Error("Upload response did not include id/url/headers.");

  const putHeaders = new Headers();
  for (const [key, value] of Object.entries(headers)) putHeaders.set(key, readStr(value));
  const s3Response = await fetch(url, { method: "PUT", headers: putHeaders, body: new Uint8Array(params.bytes), cache: "no-store" });
  const s3Text = await s3Response.text().catch(() => "");
  if (!s3Response.ok) throw new Error(`S3 image upload failed (${s3Response.status}): ${s3Text.slice(0, 500)}`);
  return { uploadId, uploadResponse: payload, s3Status: s3Response.status };
}

async function createImage(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  uploadUuid: string;
  imageName: string;
  image: UnknownRecord;
}) {
  const form = new FormData();
  form.set("image", JSON.stringify(params.image));
  form.set("image_name", params.imageName);
  form.set("upload_uuid", params.uploadUuid);

  const response = await fetch(`${procoreConfig.apiUrl}/rest/v1.0/images?project_id=${encodeURIComponent(params.projectId)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      Accept: "application/json",
      "Procore-Company-Id": params.companyId,
    },
    body: form,
    cache: "no-store",
  });

  const text = await response.text();
  let payload: unknown = text;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    // Keep text response.
  }
  if (!response.ok) {
    const message = typeof payload === "string" ? payload : JSON.stringify(payload);
    throw new Error(`Procore POST /rest/v1.0/images?project_id=${params.projectId} failed (${response.status}): ${message}`);
  }
  return payload;
}

function categoryPayload(category: UnknownRecord) {
  return compactPayload({
    name: readStr(category.name) || "Unclassified",
    private: typeof category.private === "boolean" ? category.private : undefined,
  });
}

function imagePayload(image: UnknownRecord, targetCategoryId: string) {
  const location = nestedRecord(image, "location");
  const tradeIds = rowsFromPayload(image.trades).map((trade) => readNum(trade.id)).filter((id): id is number => Boolean(id));
  return compactPayload({
    private: typeof image.private === "boolean" ? image.private : undefined,
    source: "Image from API",
    description: readStr(image.description),
    image_category_id: readNum(targetCategoryId) || readStr(targetCategoryId),
    location_id: readNum(location.id),
    daily_log_segment_id: readNum(image.daily_log_segment_id),
    trade_ids: tradeIds.length ? tradeIds : undefined,
    log_date: readStr(image.taken_at || image.created_at).slice(0, 10),
  });
}

function withoutKeys(payload: UnknownRecord, keys: string[]) {
  const out = { ...payload };
  for (const key of keys) delete out[key];
  return out;
}

function imageCreatePayloadAttempts(payload: UnknownRecord) {
  const attempts = [
    { name: "full", image: payload },
    { name: "without_daily_log", image: withoutKeys(payload, ["daily_log_segment_id", "log_date"]) },
    { name: "without_location_trade_log", image: withoutKeys(payload, ["location_id", "trade_ids", "daily_log_segment_id", "log_date"]) },
    {
      name: "minimal_category",
      image: compactPayload({
        private: payload.private,
        source: payload.source,
        image_category_id: payload.image_category_id,
        description: payload.description,
      }),
    },
    {
      name: "minimal_no_source",
      image: compactPayload({
        private: payload.private,
        image_category_id: payload.image_category_id,
        description: payload.description,
      }),
    },
  ];
  const seen = new Set<string>();
  return attempts.filter((attempt) => {
    const key = JSON.stringify(attempt.image);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveCategory(sourceCategory: UnknownRecord, targetCategories: UnknownRecord[], createdCategories: UnknownRecord[]) {
  const candidates = [...createdCategories, ...targetCategories];
  const sourceName = normalize(sourceCategory.name);
  return candidates.find((category) => normalize(category.name) === sourceName && sourceName);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as UnknownRecord;
    const { accessToken, tokenSource } = await getToken(body.accessToken);
    const sourceCompanyId = readStr(body.sourceCompanyId || body.companyId);
    const sourceProjectId = readStr(body.sourceProjectId || body.projectId);
    const targetCompanyId = readStr(body.targetCompanyId || procoreConfig.companyId);
    const targetProjectId = readStr(body.targetProjectId);
    const dryRun = body.dryRun !== false;
    const createOffset = Math.max(0, Math.trunc(readNum(body.createOffset) || 0));
    const createLimit = Math.max(1, Math.min(50, Math.trunc(readNum(body.createLimit) || 10)));
    const maxPages = Math.max(1, Math.min(50, Math.trunc(readNum(body.maxPages) || 10)));
    const cloneCategories = readBool(body.cloneCategories, true);
    const imageIds = new Set(parseIds(body.imageIds || body.ids));

    if (!sourceCompanyId || !sourceProjectId || !targetCompanyId || !targetProjectId) {
      return NextResponse.json(
        { error: "Missing required fields: sourceCompanyId, sourceProjectId, targetCompanyId, targetProjectId." },
        { status: 400 }
      );
    }

    const [sourceCategories, targetCategories, sourceImagesRaw] = await Promise.all([
      fetchImageCategories({ accessToken, companyId: sourceCompanyId, projectId: sourceProjectId, maxPages }),
      fetchImageCategories({ accessToken, companyId: targetCompanyId, projectId: targetProjectId, maxPages }),
      fetchImages({ accessToken, companyId: sourceCompanyId, projectId: sourceProjectId, maxPages }),
    ]);
    const sourceImages = imageIds.size
      ? sourceImagesRaw.filter((image) => imageIds.has(readStr(image.id)) || imageIds.has(readStr(image.filename)))
      : sourceImagesRaw;
    const categoryById = new Map(sourceCategories.map((category) => [readStr(category.id), category]));
    const unclassifiedTarget = targetCategories.find((category) => normalize(category.name) === "unclassified") || targetCategories[0];

    const categoryPlan = sourceCategories.map((category) => {
      const existingTarget = resolveCategory(category, targetCategories, []);
      return {
        sourceId: readStr(category.id),
        name: readStr(category.name),
        count: readNum(category.count) || 0,
        existingTarget: existingTarget ? { id: readStr(existingTarget.id), name: readStr(existingTarget.name) } : null,
        payload: categoryPayload(category),
      };
    });

    const plannedCategories = categoryPlan
      .filter((category) => category.existingTarget)
      .map((category) => ({ ...category.existingTarget, sourceId: category.sourceId }));

    const imagePlan = sourceImages.map((image) => {
      const sourceCategory = categoryById.get(readStr(image.image_category_id)) || { name: readStr(image.image_category_name), id: readStr(image.image_category_id) };
      const targetCategory = resolveCategory(sourceCategory, targetCategories, plannedCategories) || (cloneCategories ? null : unclassifiedTarget);
      return {
        sourceId: readStr(image.id),
        filename: readStr(image.filename) || `image-${readStr(image.id)}.jpg`,
        size: readNum(image.size),
        url: readStr(image.url),
        thumbnailUrl: readStr(image.thumbnail_url),
        sourceCategory: { id: readStr(sourceCategory.id), name: readStr(sourceCategory.name) },
        targetCategory: targetCategory ? { id: readStr(targetCategory.id), name: readStr(targetCategory.name) } : null,
        payloadDraft: imagePayload(image, readStr(targetCategory?.id)),
        skipped: {
          commentsCount: readNum(image.comments_count),
          uploader: nestedRecord(image, "uploader"),
          gpsLat: readStr(image.gps_lat),
          gpsLong: readStr(image.gps_long),
          starred: image.starred,
          projection: readStr(image.projection),
        },
      };
    });

    const missingMappings = imagePlan
      .filter((image) => !image.url || (!image.targetCategory && !cloneCategories))
      .map((image) => ({
        type: !image.url ? "image_url" : "image_category",
        sourceImageId: image.sourceId,
        filename: image.filename,
        sourceCategory: image.sourceCategory,
        issue: !image.url ? "source_image_url_missing" : "target_category_missing_and_category_clone_disabled",
      }));

    const categoryCreateResults: UnknownRecord[] = [];
    const createResults: UnknownRecord[] = [];
    if (!dryRun && missingMappings.length === 0) {
      const createdCategories: UnknownRecord[] = [...plannedCategories];
      if (cloneCategories) {
        for (const category of categoryPlan) {
          const existing = resolveCategory({ name: category.name }, targetCategories, createdCategories);
          if (existing) {
            categoryCreateResults.push({ sourceId: category.sourceId, ok: true, reused: true, targetId: readStr(existing.id), payload: category.payload });
            createdCategories.push({ ...existing, sourceId: category.sourceId });
            continue;
          }
          try {
            const created = await createImageCategory({ accessToken, companyId: targetCompanyId, projectId: targetProjectId, payload: category.payload });
            const targetId = readStr(isRecord(created) ? created.id : "");
            categoryCreateResults.push({ sourceId: category.sourceId, ok: true, targetId, created, payload: category.payload });
            createdCategories.push({ ...category.payload, id: targetId, sourceId: category.sourceId });
          } catch (error) {
            categoryCreateResults.push({ sourceId: category.sourceId, ok: false, error: error instanceof Error ? error.message : String(error), attemptedPayload: category.payload });
          }
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }

      if (categoryCreateResults.every((result) => result.ok !== false)) {
        for (const image of sourceImages.slice(createOffset, createOffset + createLimit)) {
          const filename = readStr(image.filename) || `image-${readStr(image.id)}.jpg`;
          const sourceCategory = categoryById.get(readStr(image.image_category_id)) || { name: readStr(image.image_category_name), id: readStr(image.image_category_id) };
          const targetCategory = resolveCategory(sourceCategory, targetCategories, createdCategories) || unclassifiedTarget;
          try {
            const downloadResponse = await fetch(readStr(image.url), { redirect: "follow", cache: "no-store" });
            if (!downloadResponse.ok) throw new Error(`Source image download failed (${downloadResponse.status}).`);
            const bytes = Buffer.from(await downloadResponse.arrayBuffer());
            const contentType = contentTypeForFileName(filename, downloadResponse.headers.get("content-type") || "");
            const upload = await createCompanyUpload({ accessToken, companyId: targetCompanyId, filename, contentType, bytes });
            const payload = imagePayload(image, readStr(targetCategory?.id));
            const attempts: UnknownRecord[] = [];
            let created: unknown = null;
            let successfulAttempt = "";
            let successfulPayload: UnknownRecord | null = null;
            for (const attempt of imageCreatePayloadAttempts(payload)) {
              try {
                created = await createImage({
                  accessToken,
                  companyId: targetCompanyId,
                  projectId: targetProjectId,
                  uploadUuid: upload.uploadId,
                  imageName: filename,
                  image: attempt.image,
                });
                successfulAttempt = attempt.name;
                successfulPayload = attempt.image;
                break;
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                attempts.push({ name: attempt.name, ok: false, error: message, payload: attempt.image });
                if (!/\(500\)|Internal Server Error/i.test(message)) break;
              }
            }
            if (!created) {
              const last = attempts[attempts.length - 1];
              throw new ImageCreateAttemptError(readStr(last?.error) || "Image create failed after upload.", upload.uploadId, upload.s3Status, attempts);
            }
            createResults.push({
              sourceId: readStr(image.id),
              filename,
              ok: true,
              uploadId: upload.uploadId,
              s3Status: upload.s3Status,
              successfulAttempt,
              attempts,
              created,
              payload: successfulPayload,
            });
          } catch (error) {
            createResults.push({
              sourceId: readStr(image.id),
              filename,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
              uploadId: error instanceof ImageCreateAttemptError ? error.uploadId : undefined,
              s3Status: error instanceof ImageCreateAttemptError ? error.s3Status : undefined,
              attempts: error instanceof ImageCreateAttemptError ? error.attempts : undefined,
            });
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    }

    const failedCategories = categoryCreateResults.filter((result) => result.ok === false);
    const failedImages = createResults.filter((result) => result.ok === false);
    return NextResponse.json({
      success: dryRun ? true : failedCategories.length === 0 && failedImages.length === 0,
      dryRun,
      tokenSource,
      source: { companyId: sourceCompanyId, projectId: sourceProjectId },
      target: { companyId: targetCompanyId, projectId: targetProjectId },
      options: { cloneCategories, createOffset, createLimit, maxPages },
      counts: {
        sourceCategories: sourceCategories.length,
        targetCategories: targetCategories.length,
        sourceImages: sourceImages.length,
        missingMappings: missingMappings.length,
        createdCategories: categoryCreateResults.filter((result) => result.ok === true && !result.reused).length,
        reusedCategories: categoryCreateResults.filter((result) => result.reused).length,
        createdImages: createResults.filter((result) => result.ok === true).length,
        failedCategories: failedCategories.length,
        failedImages: failedImages.length,
      },
      readyForLiveClone: missingMappings.length === 0,
      missingMappings,
      categoryPlan,
      imagePlan: imagePlan.slice(0, 200),
      categoryCreateResults,
      createResults,
      failedCreateResults: [...failedCategories, ...failedImages],
      nextStep: dryRun
        ? "Review image/category plan. Live clone uploads images in batches using createOffset/createLimit."
        : failedCategories.length || failedImages.length
          ? "Image clone finished with create errors."
          : "Image clone batch complete.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Image clone failed.", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
