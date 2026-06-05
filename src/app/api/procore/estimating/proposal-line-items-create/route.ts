import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { procoreConfig } from "@/lib/procore";
import { buildAllowedProcoreHostCandidates } from "@/lib/procoreHosts";
import { normalizeProcoreCostItemUnit, normalizeProcoreLaborTimeUnit } from "@/lib/procoreUnits";

const DEFAULT_ESTIMATING_BASE_URL = "https://api.procore.com";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function omitKeys(record: UnknownRecord, keys: string[]): UnknownRecord {
  const next: UnknownRecord = { ...record };
  for (const key of keys) {
    delete next[key];
  }
  return next;
}

function isUnsupportedLayerTypeError(status: number, bodyText: string): boolean {
  return status === 500 && /Unsupported LayerType/i.test(bodyText || "");
}

function extractRequestId(errorText: string): string | null {
  if (!errorText) return null;
  try {
    const parsed = JSON.parse(errorText) as UnknownRecord;
    const id = typeof parsed.requestId === "string" ? parsed.requestId.trim() : "";
    if (id) return id;
  } catch {
    // Fall back to regex extraction for non-JSON payloads.
  }

  const match = errorText.match(/"requestId"\s*:\s*"([^"]+)"/i);
  return match?.[1]?.trim() || null;
}

function isLayerGroupAccessDenied(status: number, bodyText: string): boolean {
  return (
    status === 403 &&
    /LayerGroup\(ID:\d+\) not accessible/i.test(bodyText || "")
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as UnknownRecord;
    const cookieStore = await cookies();

    const bodyToken = String(body.accessToken || "").trim();
    const cookieToken = String(cookieStore.get("procore_access_token")?.value || "").trim();
    const accessToken = cookieToken || bodyToken;

    if (!accessToken) {
      return NextResponse.json(
        { error: "Missing access token. Authenticate with Procore first or provide accessToken." },
        { status: 401 }
      );
    }

    const companyId = String(
      body.companyId || cookieStore.get("procore_company_id")?.value || procoreConfig.companyId || ""
    ).trim();
    const bidBoardProjectId = String(body.bidBoardProjectId || body.bid_board_project_id || "").trim();
    const projectId = String(body.projectId || body.project_id || "").trim();
    const proposalId = String(body.proposalId || body.proposal_id || "").trim();

    if (!companyId || !proposalId || (!bidBoardProjectId && !projectId)) {
      return NextResponse.json(
        { error: "Missing required fields: companyId, proposalId, and either bidBoardProjectId or projectId" },
        { status: 400 }
      );
    }

    if (bidBoardProjectId && bidBoardProjectId === companyId) {
      return NextResponse.json(
        {
          error: "Invalid bidBoardProjectId",
          details: "bidBoardProjectId matches companyId. Provide the Bid Board Project ID (not the company ID).",
        },
        { status: 400 }
      );
    }

    const readStr = (v: unknown) =>
      typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
    const readNum = (v: unknown): number | undefined => {
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string" && v.trim() !== "") { const n = Number(v); if (Number.isFinite(n)) return n; }
      return undefined;
    };
    const readBool = (v: unknown): boolean | undefined => {
      if (typeof v === "boolean") return v;
      if (typeof v === "string") { const s = v.trim().toLowerCase(); if (s === "true") return true; if (s === "false") return false; }
      return undefined;
    };
    const readCostCode = (v: unknown): string => {
      if (isRecord(v)) {
        return readStr(v.code ?? v.name ?? v.value);
      }
      return readStr(v);
    };

    // Support both a pre-built lineItem object or flat body fields
    const src = isRecord(body.lineItem) ? body.lineItem : body;

    const name = readStr(src.name);
    if (!name) {
      return NextResponse.json({ error: "Missing required field: name" }, { status: 400 });
    }

    const lineItemPayload: UnknownRecord = { name };

    const groupId = readStr(src.group_id ?? src.groupId);
    const tag = readStr(src.tag);
    const laborFactor = readNum(src.labor_factor ?? src.laborFactor);
    const count = readNum(src.count ?? src.quantity ?? src.qty);
    const itemCost = readNum(src.item_cost ?? src.itemCost);
    const laborCost = readNum(src.labor_cost ?? src.laborCost);
    const costCode = readCostCode(src.cost_code ?? src.costCode ?? src.budget_code ?? src.budgetCode);
    if (groupId) lineItemPayload.group_id = groupId;
    if (tag) lineItemPayload.tag = tag;
    if (laborFactor !== undefined) lineItemPayload.labor_factor = laborFactor;
    if (count !== undefined) lineItemPayload.count = count;
    if (itemCost !== undefined) lineItemPayload.item_cost = itemCost;
    if (laborCost !== undefined) lineItemPayload.labor_cost = laborCost;
    if (costCode) lineItemPayload.cost_code = { code: costCode };

    // Build cost_item sub-object — check ci_* prefixed flat keys for xlsx upload ergonomics
    const ciSrc = isRecord(src.cost_item) ? src.cost_item : src;
    const ciStrFields: Array<[string, string]> = [
      ["type", "type"],
      ["based_on_item_id", "basedOnItemId"],
      ["name", "costItemName"],
      ["description", "description"],
      ["labor_time_unit", "laborTimeUnit"],
      ["manufacturer", "manufacturer"],
      ["catalog_number", "catalogNumber"],
      ["url", "url"],
      ["supplier", "supplier"],
      ["unit", "unit"],
      ["notes", "costItemNotes"],
      ["id", "costItemId"],
      ["color", "color"],
      ["symbol_id", "symbolId"],
      ["catalog_id", "catalogId"],
    ];
    const ciNumFields: Array<[string, string]> = [
      ["unit_cost", "unitCost"],
      ["unit_labor", "unitLabor"],
      ["unit_labor_cost", "unitLaborCost"],
      ["waste", "waste"],
      ["material_waste", "materialWaste"],
      ["item_margin", "itemMargin"],
      ["labor_margin", "laborMargin"],
      ["unit_labor_rate", "unitLaborRate"],
      ["delivery_unit", "deliveryUnit"],
    ];

    const costItem: UnknownRecord = {};
    for (const [snake, camel] of ciStrFields) {
      const v = readStr(ciSrc[snake] ?? ciSrc[camel] ?? src[`ci_${snake}`] ?? src[`ci_${camel}`]);
      if (v) costItem[snake] = v;
    }
    const aliasedCostItemId = readStr(
      ciSrc.item_id ??
      ciSrc.itemId ??
      src.ci_item_id ??
      src.ci_itemId ??
      src.item_id ??
      src.itemId
    );
    if (aliasedCostItemId && typeof costItem.id !== "string") {
      costItem.id = aliasedCostItemId;
    }
    if (typeof costItem.labor_time_unit === "string") {
      const normalizedLaborTimeUnit = normalizeProcoreLaborTimeUnit(costItem.labor_time_unit);
      if (normalizedLaborTimeUnit) {
        costItem.labor_time_unit = normalizedLaborTimeUnit;
      } else {
        delete costItem.labor_time_unit;
      }
    }
    if (typeof costItem.unit === "string") {
      costItem.unit = normalizeProcoreCostItemUnit(costItem.unit);
    }
    for (const [snake, camel] of ciNumFields) {
      const v = readNum(ciSrc[snake] ?? ciSrc[camel] ?? src[`ci_${snake}`] ?? src[`ci_${camel}`]);
      if (v !== undefined) costItem[snake] = v;
    }
    const isUntaxed = readBool(ciSrc.is_untaxed ?? ciSrc.isUntaxed ?? src.is_untaxed ?? src.isUntaxed);
    if (isUntaxed !== undefined) costItem.is_untaxed = isUntaxed;

    const requiredCostItemId = readStr(costItem.id);
    if (!requiredCostItemId) {
      return NextResponse.json(
        {
          error: "Missing required field: cost_item.id",
          details: "Provide a valid item id using cost_item.id, item_id/itemId, or ci_item_id/ci_itemId.",
        },
        { status: 400 }
      );
    }

    if (Object.keys(costItem).length > 0) lineItemPayload.cost_item = costItem;

    const requestedBaseUrl = String(
      body.baseUrl || process.env.PROCORE_ESTIMATING_API_URL || DEFAULT_ESTIMATING_BASE_URL
    ).trim();

    const hostCandidates = buildAllowedProcoreHostCandidates({
      requestedOrigin: requestedBaseUrl,
      extraOrigins: [process.env.PROCORE_ESTIMATING_API_URL, DEFAULT_ESTIMATING_BASE_URL, "https://api.procore.com"],
    });

    if (hostCandidates.error) {
      return NextResponse.json({ error: hostCandidates.error }, { status: 400 });
    }

    const pathVariants: Array<{ label: string; path: string }> = [];
    if (projectId) {
      pathVariants.push({
        label: "project",
        path: `/rest/v2.0/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(
          projectId
        )}/estimating/proposals/${encodeURIComponent(proposalId)}/line_items`,
      });
    }
    if (bidBoardProjectId) {
      pathVariants.push({
        label: "bid_board_project",
        path: `/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/bid_board_projects/${encodeURIComponent(
          bidBoardProjectId
        )}/proposals/${encodeURIComponent(proposalId)}/line_items`,
      });
    }

    const attempts: Array<{
      host: string;
      url: string;
      pathVariant: string;
      variant: string;
      status: number;
      message: string;
      payload: UnknownRecord;
    }> = [];

    const payloadVariants: Array<{ label: string; payload: UnknownRecord }> = [];
    const seenPayloads = new Set<string>();
    const addVariant = (label: string, payload: UnknownRecord) => {
      const key = JSON.stringify(payload);
      if (seenPayloads.has(key)) return;
      seenPayloads.add(key);
      payloadVariants.push({ label, payload });
    };

    addVariant("original", lineItemPayload);

    // Keep quantity/cost intent intact: do not fall back to stripped payloads when
    // caller explicitly provided quantitative fields.
    const hasQuantitativeInput =
      count !== undefined ||
      itemCost !== undefined ||
      laborCost !== undefined;

    if (isRecord(lineItemPayload.cost_item)) {
      const costItemNoType = omitKeys(lineItemPayload.cost_item as UnknownRecord, ["type"]);
      if (Object.keys(costItemNoType).length > 0) {
        addVariant("no_cost_item_type", { ...lineItemPayload, cost_item: costItemNoType });
      }
      if (!hasQuantitativeInput) {
        addVariant("no_cost_item", omitKeys(lineItemPayload, ["cost_item"]));
      }
    }

    if (!hasQuantitativeInput) {
      const noCostItemBase = omitKeys(lineItemPayload, ["cost_item"]);
      addVariant("no_group_id", omitKeys(noCostItemBase, ["group_id"]));
      addVariant("no_labor_factor", omitKeys(noCostItemBase, ["labor_factor"]));
      addVariant("name_only", { name });
    }

    for (const host of hostCandidates.candidates) {
      for (const pathVariant of pathVariants) {
        const url = `${host.replace(/\/$/, "")}${pathVariant.path}`;

        for (let variantIndex = 0; variantIndex < payloadVariants.length; variantIndex += 1) {
          const candidate = payloadVariants[variantIndex];
          const candidatePayload = candidate.payload;
          let response: Response;
          try {
            response = await fetch(url, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json",
                "Content-Type": "application/json",
                "Procore-Company-Id": companyId,
              },
              body: JSON.stringify(candidatePayload),
            });
          } catch (fetchError) {
            const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
            attempts.push({
              host,
              url,
              pathVariant: pathVariant.label,
              variant: candidate.label,
              status: 0,
              message: `Fetch error: ${errorMessage}`,
              payload: candidatePayload,
            });
            break;
          }

          if (!response.ok) {
            const errorText = await response.text();

            attempts.push({
              host,
              url,
              pathVariant: pathVariant.label,
              variant: candidate.label,
              status: response.status,
              message: errorText || "No response body",
              payload: candidatePayload,
            });

            // This is a definitive permission/scope error for the supplied group_id.
            if (isLayerGroupAccessDenied(response.status, errorText)) {
              const requestIds = Array.from(
                new Set(
                  attempts
                    .map((attempt) => extractRequestId(attempt.message))
                    .filter((id): id is string => Boolean(id))
                )
              );

              return NextResponse.json(
                {
                  error: `Create line item API error ${response.status}`,
                  details: errorText,
                  host,
                  url,
                  attemptedPathVariant: pathVariant.label,
                  unsupportedLayerType: false,
                  requestIds,
                  attemptedVariant: candidate.label,
                  attemptedPayload: candidatePayload,
                  attempts,
                },
                { status: response.status }
              );
            }

            if (response.status === 404) {
              break;
            }

            // If one endpoint path is unauthorized, try the next path variant (project vs bid-board).
            if (response.status === 401 || response.status === 403) {
              break;
            }

            const shouldRetryNextVariant =
              variantIndex < payloadVariants.length - 1 && isUnsupportedLayerTypeError(response.status, errorText);
            if (shouldRetryNextVariant) {
              continue;
            }

            const unsupportedLayerType = isUnsupportedLayerTypeError(response.status, errorText);
            const requestIds = Array.from(
              new Set(
                attempts
                  .map((attempt) => extractRequestId(attempt.message))
                  .filter((id): id is string => Boolean(id))
              )
            );

            return NextResponse.json(
              {
                error: `Create line item API error ${response.status}`,
                details: errorText,
                host,
                url,
                attemptedPathVariant: pathVariant.label,
                unsupportedLayerType,
                requestIds,
                attemptedVariant: candidate.label,
                attemptedPayload: candidatePayload,
                attempts,
              },
              { status: response.status }
            );
          }

          const payload = (await response.json().catch(() => ({}))) as unknown;
          const payloadRecord = isRecord(payload) ? payload : {};
          const dataRecord = isRecord(payloadRecord.data) ? payloadRecord.data : payloadRecord;
          const createdLineItemId = String(dataRecord.id || dataRecord.line_item_id || "").trim() || null;

          const requestedCount = readNum(candidatePayload.count);
          const requestedItemCost = readNum(candidatePayload.item_cost);
          const requestedLaborCost = readNum(candidatePayload.labor_cost);
          const returnedCount = readNum(dataRecord.count);
          const returnedItemCost = readNum(dataRecord.item_cost);
          const returnedLaborCost = readNum(dataRecord.labor_cost);
          const quantitativeMismatch =
            (requestedCount !== undefined && returnedCount !== undefined && requestedCount !== returnedCount) ||
            (requestedItemCost !== undefined && returnedItemCost !== undefined && requestedItemCost !== returnedItemCost) ||
            (requestedLaborCost !== undefined && returnedLaborCost !== undefined && requestedLaborCost !== returnedLaborCost);

          return NextResponse.json({
            success: true,
            source: "estimating.create_line_item",
            companyId,
            bidBoardProjectId,
            projectId,
            proposalId,
            baseUrl: host,
            url,
            attemptedPathVariant: pathVariant.label,
            attemptedVariant: candidate.label,
            lineItemId: createdLineItemId,
            lineItem: payload,
            attemptedPayload: candidatePayload,
            requestedQuantitative: {
              count: requestedCount ?? null,
              item_cost: requestedItemCost ?? null,
              labor_cost: requestedLaborCost ?? null,
            },
            returnedQuantitative: {
              count: returnedCount ?? null,
              item_cost: returnedItemCost ?? null,
              labor_cost: returnedLaborCost ?? null,
            },
            quantitativeMismatch,
            warning: quantitativeMismatch
              ? "Procore accepted the create request but returned different quantitative values (count/item_cost/labor_cost)."
              : null,
          });
        }
      }
    }

    if (attempts.length > 0) {
      const preferredAttempt =
        attempts.find((attempt) => isLayerGroupAccessDenied(attempt.status, attempt.message)) ||
        attempts.find((attempt) => attempt.status >= 400 && attempt.status < 500) ||
        attempts.find((attempt) => attempt.status >= 500) ||
        attempts.find((attempt) => attempt.status > 0) ||
        attempts[attempts.length - 1];
      const requestIds = Array.from(
        new Set(
          attempts
            .map((attempt) => extractRequestId(attempt.message))
            .filter((id): id is string => Boolean(id))
        )
      );
      const unsupportedLayerType = attempts.some((attempt) =>
        isUnsupportedLayerTypeError(attempt.status, attempt.message)
      );

      return NextResponse.json(
        {
          error: `Create line item API error ${preferredAttempt.status}`,
          details: preferredAttempt.message,
          host: preferredAttempt.host,
          url: preferredAttempt.url,
          attemptedPathVariant: preferredAttempt.pathVariant,
          unsupportedLayerType,
          requestIds,
          attemptedVariant: preferredAttempt.variant,
          attemptedPayload: preferredAttempt.payload,
          attempts,
        },
        { status: preferredAttempt.status }
      );
    }

    return NextResponse.json(
      {
        error: "Failed to create line item",
        details: "All configured hosts failed",
        attempts,
      },
      { status: 404 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: "Failed to create line item",
        details: message,
      },
      { status: 500 }
    );
  }
}
