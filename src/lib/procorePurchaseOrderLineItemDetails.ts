import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveProcoreLegacyProject } from "@/lib/procoreLegacyProjectIdentity";
import { selectProcoreSourceProjectLink, reportProcoreSourceProjectLinkConflicts } from "@/lib/procoreSourceProjectLink";

export type ProcorePurchaseOrderContract = Record<string, unknown>;
export type ProcoreLineItemContractDetail = Record<string, unknown>;

type MutableJsonObject = Record<string, Prisma.InputJsonValue>;

type PersistParams = {
  companyId?: string;
  projectId: string;
  projectName?: string;
  projectNumber?: string;
  createProjectIfMissing?: boolean;
  persistUnpackedFields?: boolean;
};

let detailUnpackedTableReady: Promise<void> | null = null;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asJsonValue(value: unknown): Prisma.InputJsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return value as Prisma.InputJsonValue;
  if (Array.isArray(value)) return value.map((i) => asJsonValue(i));
  if (typeof value === "object") {
    const out: MutableJsonObject = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = asJsonValue(v);
    return out as Prisma.InputJsonObject;
  }
  return String(value);
}

function toNullableDate(value: unknown): Date | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toNullableFloat(value: unknown): number | null {
  const n = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : null;
}

function toNullableString(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s || null;
}

function extractContractColumns(record: ProcorePurchaseOrderContract, companyId: string | undefined, projectId: string) {
  const vendor = asObject(record.vendor);
  return {
    procoreId: toNullableString(record.id),
    procoreCompanyId: toNullableString(companyId),
    procoreProjectId: toNullableString(projectId),
    title: toNullableString(record.title),
    number: toNullableString(record.number),
    status: toNullableString(record.status),
    vendorId: toNullableString(vendor.id ?? record.vendor_id),
    vendorName: toNullableString(vendor.name ?? record.vendor_name),
    value: toNullableFloat(record.value),
    originalValue: toNullableFloat(record.original_value ?? record.original_contract_value),
    startDate: toNullableDate(record.start_date),
    completionDate: toNullableDate(record.completion_date),
    procoreCreatedAt: toNullableDate(record.created_at),
    procoreUpdatedAt: toNullableDate(record.updated_at),
    procoreDeletedAt: toNullableDate(record.deleted_at),
  };
}

function extractDetailColumns(
  record: ProcoreLineItemContractDetail,
  companyId: string | undefined,
  projectId: string,
  purchaseOrderContractId: string
) {
  const wbs = asObject(record.wbs_code ?? record.cost_code ?? {});
  const costCodeObj = asObject(record.cost_code ?? {});
  const costTypeObj = asObject(record.line_item_type ?? record.cost_type ?? {});

  return {
    procoreId: toNullableString(record.id),
    procoreCompanyId: toNullableString(companyId),
    procoreProjectId: toNullableString(projectId),
    procorePurchaseOrderContractId: toNullableString(purchaseOrderContractId),
    description: toNullableString(record.description ?? record.title),
    quantity: toNullableFloat(record.quantity),
    unitCost: toNullableFloat(record.unit_cost),
    totalAmount: toNullableFloat(record.amount ?? record.total_amount),
    uom: toNullableString(record.uom),
    position: record.position != null ? Number(record.position) || null : null,
    wbsCode: toNullableString(wbs.flat_code ?? wbs.code ?? record.wbs_code),
    costCode: toNullableString(costCodeObj.full_code ?? costCodeObj.code ?? record.cost_code),
    costType: toNullableString(costTypeObj.name ?? record.cost_type),
    procoreCreatedAt: toNullableDate(record.created_at),
    procoreUpdatedAt: toNullableDate(record.updated_at),
  };
}

async function ensureDetailUnpackedTable() {
  if (detailUnpackedTableReady) return detailUnpackedTableReady;
  detailUnpackedTableReady = (async () => {
    return;
  })();
  return detailUnpackedTableReady;
}

function classifyValue(value: unknown) {
  if (value === null || value === undefined)
    return { valueType: "null", valueText: null, valueNumber: null, valueBoolean: null, valueJson: "null" };
  if (typeof value === "string")
    return { valueType: "string", valueText: value, valueNumber: null, valueBoolean: null, valueJson: JSON.stringify(value) };
  if (typeof value === "number")
    return { valueType: "number", valueText: null, valueNumber: value, valueBoolean: null, valueJson: JSON.stringify(value) };
  if (typeof value === "boolean")
    return { valueType: "boolean", valueText: null, valueNumber: null, valueBoolean: value, valueJson: JSON.stringify(value) };
  return { valueType: "object", valueText: null, valueNumber: null, valueBoolean: null, valueJson: JSON.stringify(asJsonValue(value)) };
}

async function persistDetailUnpackedFields(detailId: string, record: ProcoreLineItemContractDetail) {
  await ensureDetailUnpackedTable();
  for (const [k, v] of Object.entries(record)) {
    const c = classifyValue(v);
    await prisma.$executeRawUnsafe(
      `
        INSERT INTO purchase_order_line_item_contract_detail_unpacked_fields
          (detail_id, field_path, value_type, value_text, value_number, value_boolean, value_json, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
        ON CONFLICT (detail_id, field_path) DO UPDATE SET
          value_type = EXCLUDED.value_type,
          value_text = EXCLUDED.value_text,
          value_number = EXCLUDED.value_number,
          value_boolean = EXCLUDED.value_boolean,
          value_json = EXCLUDED.value_json,
          updated_at = NOW()
      `,
      detailId,
      k,
      c.valueType,
      c.valueText,
      c.valueNumber,
      c.valueBoolean,
      c.valueJson
    );
  }
}


export async function persistPurchaseOrderLineItemDetails(
  contract: ProcorePurchaseOrderContract,
  details: ProcoreLineItemContractDetail[],
  params: PersistParams
) {
  const { companyId, projectId } = params;
  const linkedProjectResult = await resolveProcoreLegacyProject({ ...params, companyId: params.companyId, source: "procore_po_line_item_details_sync" });
  const linkedProjectId = linkedProjectResult.project?.id ?? null;
  const projectCreated = linkedProjectResult.created;
  const projectIdentity = { status: linkedProjectResult.status, reason: linkedProjectResult.reason };
  let projectLinkConflicts = 0;

  const rawContractId = toNullableString(asObject(contract).id);
  if (!rawContractId) {
    return { saved: 0, skipped: details.length, linkedProjectId, projectCreated, contractDbId: "", projectIdentity, projectLinkConflicts };
  }

  const contractUid = `poc_${rawContractId}_${projectId}`;
  const contractCols = extractContractColumns(contract, companyId, projectId);
  const existingContract = await prisma.purchaseOrderContract.findFirst({
    where: { procoreId: rawContractId, procoreProjectId: projectId },
    select: { id: true, projectId: true, jobKey: true },
  });
  const contractProjectLink = selectProcoreSourceProjectLink(existingContract, linkedProjectResult.project, "id");
  if (contractProjectLink.conflict) projectLinkConflicts += 1;
  const contractShared = {
    ...contractCols,
    jobKey: contractProjectLink.jobKey,
    projectId: contractProjectLink.projectId,
    customFields: contract as unknown as Prisma.InputJsonObject,
    updatedAt: new Date(),
  };

  let contractDbId = contractUid;
  if (existingContract) {
    await prisma.purchaseOrderContract.update({
      where: { id: existingContract.id }, data: { ...contractShared, ...contractProjectLink.update },
    });
    contractDbId = existingContract.id;
  } else {
    await prisma.purchaseOrderContract.create({ data: { id: contractUid, ...contractShared } });
  }

  let saved = 0;
  let skipped = 0;
  let cursor = 0;
  const workerCount = Math.min(6, Math.max(1, details.length));

  async function persistNextDetail() {
    while (cursor < details.length) {
      const index = cursor;
      cursor += 1;
      const record = details[index];
    try {
      const rawId = toNullableString(asObject(record).id);
      if (!rawId) {
        skipped += 1;
        continue;
      }

      const uid = `pold_${rawId}_${projectId}`;
      const cols = extractDetailColumns(record, companyId, projectId, rawContractId);
      const existing = await prisma.purchaseOrderLineItemContractDetail.findFirst({
        where: { procoreId: rawId, procoreProjectId: projectId },
        select: { id: true, projectId: true, jobKey: true },
      });
      const projectLink = selectProcoreSourceProjectLink(existing, linkedProjectResult.project, "id");
      if (projectLink.conflict) projectLinkConflicts += 1;
      const sharedFields = {
        ...cols,
        jobKey: projectLink.jobKey,
        projectId: projectLink.projectId,
        purchaseOrderContractId: contractDbId,
        customFields: record as unknown as Prisma.InputJsonObject,
        updatedAt: new Date(),
      };

      let finalId = uid;
      if (existing) {
        await prisma.purchaseOrderLineItemContractDetail.update({
          where: { id: existing.id }, data: { ...sharedFields, ...projectLink.update },
        });
        finalId = existing.id;
      } else {
        await prisma.purchaseOrderLineItemContractDetail.create({ data: { id: uid, ...sharedFields } });
      }

      if (params.persistUnpackedFields !== false) {
        await persistDetailUnpackedFields(finalId, record);
      }
      saved += 1;
    } catch (err) {
      console.error(`[POLineItemDetails] persist error:`, err);
      skipped += 1;
    }
  }
  }

  await Promise.all(Array.from({ length: workerCount }, () => persistNextDetail()));

  reportProcoreSourceProjectLinkConflicts("purchase-order-details", params, projectLinkConflicts);
  return { saved, skipped, linkedProjectId, projectCreated, contractDbId, projectIdentity, projectLinkConflicts };
}
