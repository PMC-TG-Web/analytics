import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getClientCredentialsToken, procoreConfig } from "@/lib/procore";

type UnknownRecord = Record<string, unknown>;

function readStr(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function field(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  return (value as UnknownRecord)[key];
}

function readPdfUrl(drawing: UnknownRecord): string {
  const pdfFields = field(drawing, "pdfFields");
  return readStr(
    field(drawing, "pdfUrl") ||
      field(drawing, "pdf_url") ||
      field(pdfFields, "current_revision.pdf_url") ||
      field(pdfFields, "pdf_url") ||
      field(pdfFields, "download_url") ||
      field(pdfFields, "url")
  );
}

function filenameForDrawing(drawing: UnknownRecord): string {
  const number = readStr(field(drawing, "number")).replace(/[\\/:*?"<>|]+/g, "-");
  const title = readStr(field(drawing, "title")).replace(/[\\/:*?"<>|]+/g, "-");
  const base = [number, title].filter(Boolean).join(" - ") || `drawing-${readStr(field(drawing, "id")) || "migration"}`;
  return `${base}.pdf`;
}

async function getToken(bodyToken?: unknown) {
  const cookieStore = await cookies();
  const explicitToken = readStr(bodyToken);
  const cookieToken = readStr(cookieStore.get("procore_access_token")?.value);
  if (explicitToken) return { accessToken: explicitToken, tokenSource: "body" };
  if (cookieToken) return { accessToken: cookieToken, tokenSource: "cookie" };
  return { accessToken: await getClientCredentialsToken(), tokenSource: "client_credentials" };
}

async function fetchJsonOrText(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Keep raw text.
  }
  return { response, body, text };
}

function summarizeLegacyPlan(payload: unknown) {
  const plans = Array.isArray(field(payload, "plans")) ? (field(payload, "plans") as unknown[]) : [];
  return {
    planCount: plans.length,
    lastPlans: plans.slice(-5).map((plan) => {
      const row = plan && typeof plan === "object" ? (plan as UnknownRecord) : {};
      return {
        id: field(row, "id"),
        name: field(row, "name"),
        folder: field(row, "folder"),
        currentRevisionId: field(row, "currentRevisionId"),
      };
    }),
  };
}

function makeCoopConnectionId(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let value = "";
  for (let index = 0; index < 22; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return value;
}

async function fetchLegacyPlanSnapshot(params: {
  companyId: string;
  bidBoardProjectId: string;
  accessToken: string;
}) {
  const url = `https://estimating-tool.procore.com/api/project/${encodeURIComponent(params.bidBoardProjectId)}/legacyPlan?_t=${Date.now()}`;
  const { response, body, text } = await fetchJsonOrText(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      Accept: "application/json",
      "X-Procore-Company-Id": params.companyId,
      "Procore-Company-Id": params.companyId,
    },
  });

  return {
    url,
    status: response.status,
    ok: response.ok,
    summary: response.ok ? summarizeLegacyPlan(body) : null,
    body: response.ok ? body : text.slice(0, 1200),
  };
}

async function fetchTextWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    const text = await response.text();
    return {
      status: response.status,
      ok: response.ok,
      body: text.slice(0, 1200),
    };
  } catch (error) {
    return {
      aborted: error instanceof Error && error.name === "AbortError",
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as UnknownRecord;
    const drawing = field(body, "drawing");
    if (!drawing || typeof drawing !== "object") {
      return NextResponse.json({ error: "Missing drawing payload." }, { status: 400 });
    }

    const drawingRecord = drawing as UnknownRecord;
    const companyId = readStr(body.companyId || procoreConfig.companyId);
    const bidBoardProjectId = readStr(body.bidBoardProjectId || body.bid_board_project_id || body.bidBoardId);
    const projectId = readStr(body.projectId || body.procoreProjectId);
    const userId = readStr(body.userId || body.procoreUserId || "14134125");
    const requestedFileName = readStr(body.fileName);
    const fileName = requestedFileName || filenameForDrawing(drawingRecord);
    const pdfUrl = readPdfUrl(drawingRecord);

    if (!companyId || !bidBoardProjectId) {
      return NextResponse.json({ error: "companyId and bidBoardProjectId are required." }, { status: 400 });
    }
    if (!pdfUrl || !/^https:\/\//i.test(pdfUrl)) {
      return NextResponse.json({ error: "Selected drawing is missing a valid PDF URL." }, { status: 400 });
    }

    const { accessToken, tokenSource } = await getToken(body.accessToken);

    const before = await fetchLegacyPlanSnapshot({ companyId, bidBoardProjectId, accessToken }).catch((error) => ({
      error: error instanceof Error ? error.message : String(error),
    }));

    const pdfResponse = await fetch(pdfUrl, { redirect: "follow", cache: "no-store" });
    if (!pdfResponse.ok) {
      return NextResponse.json(
        { error: "Source PDF download failed.", status: pdfResponse.status },
        { status: 502 }
      );
    }
    const pdfBytes = Buffer.from(await pdfResponse.arrayBuffer());
    const md5Hex = createHash("md5").update(pdfBytes).digest("hex");
    const sha256Hex = createHash("sha256").update(pdfBytes).digest("hex");

    const uploadPayload = {
      name: fileName,
      content_type: "application/pdf",
      size: pdfBytes.byteLength,
      md5: md5Hex,
      sha256: sha256Hex,
    };
    const uploadUrl = `https://us02.procore.com/rest/v2.0/companies/${encodeURIComponent(companyId)}/uploads`;
    const uploadSlot = await fetchJsonOrText(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "Procore-Company-Id": companyId,
      },
      body: JSON.stringify(uploadPayload),
    });

    if (!uploadSlot.response.ok || !uploadSlot.body || typeof uploadSlot.body !== "object") {
      return NextResponse.json(
        {
          error: "Create company upload slot failed.",
          status: uploadSlot.response.status,
          uploadPayload,
          response: uploadSlot.body,
        },
        { status: uploadSlot.response.status >= 400 ? uploadSlot.response.status : 502 }
      );
    }

    const uploadData = field(uploadSlot.body, "data");
    const uploadRecord = uploadData && typeof uploadData === "object" ? (uploadData as UnknownRecord) : (uploadSlot.body as UnknownRecord);
    const uploadId = readStr(field(uploadRecord, "id"));
    const s3Url = readStr(field(uploadRecord, "url"));
    const s3Headers = field(uploadRecord, "headers");

    if (!uploadId || !s3Url || !s3Headers || typeof s3Headers !== "object") {
      return NextResponse.json(
        {
          error: "Upload slot did not return id, url, and headers.",
          uploadSlot: uploadSlot.body,
        },
        { status: 502 }
      );
    }

    const putHeaders = new Headers();
    for (const [key, value] of Object.entries(s3Headers as Record<string, unknown>)) {
      putHeaders.set(key, readStr(value));
    }

    const s3Response = await fetch(s3Url, {
      method: "PUT",
      headers: putHeaders,
      body: pdfBytes,
      cache: "no-store",
    });
    const s3Text = await s3Response.text().catch(() => "");

    let coopAttach: unknown = null;
    if (s3Response.ok && projectId && userId) {
      const coopPayload = {
        arguments: [
          Number.isFinite(Number(bidBoardProjectId)) ? Number(bidBoardProjectId) : bidBoardProjectId,
          "estimating",
          [
            {
              url: uploadId,
              handle: uploadId,
              filename: fileName,
              mimetype: "application/pdf",
              alt: fileName,
              source: "FileSelectLocalSource",
              originalPath: fileName,
              size: pdfBytes.byteLength,
              uploadId,
            },
          ],
        ],
        invocationId: "4",
        target: "UploadPlansFromFasV6",
        type: 1,
      };
      const coopBaseQuery =
        `?X-Procore-Company-Id=${encodeURIComponent(companyId)}` +
        `&X-Procore-Project-Id=${encodeURIComponent(projectId)}` +
        `&X-Procore-User-Id=${encodeURIComponent(userId)}`;
      const coopHeaders = {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json, text/plain, */*",
        "Content-Type": "text/plain;charset=UTF-8",
        "X-Procore-Company-Id": companyId,
        "X-Procore-Project-Id": projectId,
        "X-Procore-User-Id": userId,
      };
      const negotiateUrl = `https://estimating-tool.procore.com/hub/coop/negotiate${coopBaseQuery}&negotiateVersion=1`;

      const negotiateResult = await fetchJsonOrText(negotiateUrl, {
        method: "POST",
        headers: coopHeaders,
        body: "",
      }).catch((error) => ({
        error: error instanceof Error ? error.message : String(error),
      }));

      if (!("response" in negotiateResult)) {
        coopAttach = {
          negotiateUrl,
          negotiate: { error: negotiateResult.error },
          payload: coopPayload,
        };
      } else if (!negotiateResult.response.ok || !negotiateResult.body || typeof negotiateResult.body !== "object") {
        coopAttach = {
          negotiateUrl,
          negotiate: {
            status: negotiateResult.response.status,
            ok: negotiateResult.response.ok,
            response: negotiateResult.body,
            responsePreview: negotiateResult.text.slice(0, 1200),
          },
          payload: coopPayload,
        };
      } else {
        const negotiated = negotiateResult.body as UnknownRecord;
        const connectionToken =
          readStr(field(negotiated, "connectionToken")) ||
          readStr(field(negotiated, "connectionId")) ||
          makeCoopConnectionId();
        const coopUrl = `https://estimating-tool.procore.com/hub/coop${coopBaseQuery}&id=${encodeURIComponent(connectionToken)}`;
        const longPoll = fetchTextWithTimeout(
          coopUrl,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "text/event-stream, text/plain, */*",
              "X-Procore-Company-Id": companyId,
              "X-Procore-Project-Id": projectId,
              "X-Procore-User-Id": userId,
            },
          },
          3500
        );
        await new Promise((resolve) => setTimeout(resolve, 400));
        const handshakeResult = await fetchJsonOrText(coopUrl, {
          method: "POST",
          headers: coopHeaders,
          body: `${JSON.stringify({ protocol: "json", version: 1 })}\u001e`,
        }).catch((error) => ({
          error: error instanceof Error ? error.message : String(error),
        }));
        const coopResult = await fetchJsonOrText(coopUrl, {
          method: "POST",
          headers: coopHeaders,
          body: `${JSON.stringify(coopPayload)}\u001e`,
        }).catch((error) => ({
          error: error instanceof Error ? error.message : String(error),
        }));

        const handshake =
          "response" in handshakeResult
            ? {
                status: handshakeResult.response.status,
                ok: handshakeResult.response.ok,
                response: handshakeResult.body,
                responsePreview: handshakeResult.text.slice(0, 1200),
              }
            : { error: handshakeResult.error };
        const longPollResult = await longPoll;

        if ("response" in coopResult) {
          coopAttach = {
            negotiateUrl,
            negotiate: {
              status: negotiateResult.response.status,
              ok: negotiateResult.response.ok,
              response: negotiateResult.body,
            },
            url: coopUrl,
            connectionToken,
            longPoll: longPollResult,
            handshake,
            payload: coopPayload,
            status: coopResult.response.status,
            ok: coopResult.response.ok,
            response: coopResult.body,
            responsePreview: coopResult.text.slice(0, 1200),
          };
        } else {
          coopAttach = {
            negotiateUrl,
            negotiate: {
              status: negotiateResult.response.status,
              ok: negotiateResult.response.ok,
              response: negotiateResult.body,
            },
            url: coopUrl,
            connectionToken,
            longPoll: longPollResult,
            handshake,
            payload: coopPayload,
            error: coopResult.error,
          };
        }
      }
    }

    const pollResults: unknown[] = [];
    for (let index = 0; index < 5; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, index === 0 ? 1500 : 3000));
      pollResults.push(await fetchLegacyPlanSnapshot({ companyId, bidBoardProjectId, accessToken }).catch((error) => ({
        error: error instanceof Error ? error.message : String(error),
      })));
    }
    const confirmedInEstimating = pollResults.some((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const record = entry as UnknownRecord;
      const summary = field(record, "summary");
      return Boolean(field(record, "ok")) && Boolean(summary && typeof summary === "object");
    });

    return NextResponse.json({
      success: s3Response.ok,
      experimental: true,
      confirmedInEstimating,
      statusMessage: s3Response.ok
        ? confirmedInEstimating
          ? "Uploaded to company storage and legacyPlan polling returned Estimating data."
          : "Uploaded to company storage, but legacyPlan polling did not confirm Estimating attachment."
        : "S3 upload failed.",
      tokenSource,
      source: {
        drawingId: field(drawingRecord, "id"),
        number: field(drawingRecord, "number"),
        title: field(drawingRecord, "title"),
        pdfUrl,
      },
      target: {
        companyId,
        bidBoardProjectId,
        projectId,
        userId,
        fileName,
      },
      before,
      upload: {
        url: uploadUrl,
        payload: uploadPayload,
        id: uploadId,
        status: uploadSlot.response.status,
        response: uploadSlot.body,
      },
      s3Upload: {
        status: s3Response.status,
        ok: s3Response.ok,
        responsePreview: s3Text.slice(0, 1000),
      },
      coopAttach,
      pollResults,
      conclusion: s3Response.ok
        ? "Company upload, S3 PUT, and experimental UploadPlansFromFasV6 coop call completed. Check coopAttach and pollResults for whether Estimating accepted it."
        : "S3 upload failed; Estimating cannot process this file until S3 upload succeeds.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        error: "Estimating plans upload experiment failed.",
        details: message,
      },
      { status: 500 }
    );
  }
}
