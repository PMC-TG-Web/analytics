import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveProcoreLegacyProject } from "@/lib/procoreLegacyProjectIdentity";
import { selectProcoreSourceProjectLink, reportProcoreSourceProjectLinkConflicts } from "@/lib/procoreSourceProjectLink";

export type ProcoreChangeOrder = Record<string, unknown>;
export type ProcoreChangeOrderLineItem = Record<string, unknown>;

type MutableJsonObject = Record<string, Prisma.InputJsonValue>;

type PersistParams = {
  companyId?: string;
  projectId: string;
  projectName?: string;
  projectNumber?: string;
  createProjectIfMissing?: boolean;
};

let lineItemUnpackedTableReady: Promise<void> | null = null;

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

function extractChangeOrderColumns(record: ProcoreChangeOrder, companyId: string | undefined, projectId: string) {
  return {
    procoreId: toNullableString(record.id),
    procoreCompanyId: toNullableString(companyId),
    procoreProjectId: toNullableString(projectId),
    procoreContractId: toNullableString(record.commitment_id ?? record.contract_id ?? record.commitment_contract_id),
    title: toNullableString(record.title),
    number: toNullableString(record.number),
    status: toNullableString(record.status),
    dueDate: toNullableDate(record.due_date),
    invoicedDate: toNullableDate(record.invoiced_date),
    approvedDate: toNullableDate(record.approved_date),
    value: toNullableFloat(record.value),
    procoreCreatedAt: toNullableDate(record.created_at),
    procoreUpdatedAt: toNullableDate(record.updated_at),
    procoreDeletedAt: toNullableDate(record.deleted_at),
  };
}

function extractLineItemColumns(
  record: ProcoreChangeOrderLineItem,
  companyId: string | undefined,
  projectId: string,
  changeOrderId: string
) {
  const wbs = asObject(record.wbs_code ?? record.cost_code ?? {});
  const costCodeObj = asObject(record.cost_code ?? {});
  const costTypeObj = asObject(record.line_item_type ?? record.cost_type ?? {});

  return {
    procoreId: toNullableString(record.id),
    procoreCompanyId: toNullableString(companyId),
    procoreProjectId: toNullableString(projectId),
    procoreChangeOrderId: toNullableString(changeOrderId),
    description: toNullableString(record.description),
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

async function ensureLineItemUnpackedTable() {
  if (lineItemUnpackedTableReady) return lineItemUnpackedTableReady;
  lineItemUnpackedTableReady = (async () => {
    return;
  })();
  return lineItemUnpackedTableReady;
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

async function persistLineItemUnpackedFields(lineItemId: string, record: ProcoreChangeOrderLineItem) {
  await ensureLineItemUnpackedTable();
  for (const [k, v] of Object.entries(record)) {
    const c = classifyValue(v);
    await prisma.$executeRawUnsafe(
      `
        INSERT INTO commitment_change_order_line_item_unpacked_fields
          (line_item_id, field_path, value_type, value_text, value_number, value_boolean, value_json, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
        ON CONFLICT (line_item_id, field_path) DO UPDATE SET
          value_type = EXCLUDED.value_type,
          value_text = EXCLUDED.value_text,
          value_number = EXCLUDED.value_number,
          value_boolean = EXCLUDED.value_boolean,
          value_json = EXCLUDED.value_json,
          updated_at = NOW()
      `,
      lineItemId, k, c.valueType, c.valueText, c.valueNumber, c.valueBoolean, c.valueJson
    );
  }
}


export async function persistChangeOrderLineItems(
  changeOrder: ProcoreChangeOrder,
  lineItems: ProcoreChangeOrderLineItem[],
  params: PersistParams
) {
  const { companyId, projectId } = params;
  const linkedProjectResult = await resolveProcoreLegacyProject({ ...params, companyId: params.companyId, source: "procore_cco_sync" });
  const linkedProjectId = linkedProjectResult.project?.id ?? null;
  const projectCreated = linkedProjectResult.created;
  const projectIdentity = { status: linkedProjectResult.status, reason: linkedProjectResult.reason };
  let projectLinkConflicts = 0;

  // Upsert the change order itself
  const rawCoId = toNullableString(asObject(changeOrder).id);
  if (!rawCoId) return { saved: 0, skipped: lineItems.length, linkedProjectId, projectCreated, changeOrderDbId: "", projectIdentity, projectLinkConflicts };

  const coUid = `cco_${rawCoId}_${projectId}`;
  const coCols = extractChangeOrderColumns(changeOrder, companyId, projectId);
  const existingCo = await prisma.commitmentChangeOrder.findFirst({
    where: { procoreId: rawCoId, procoreProjectId: projectId },
    select: { id: true, projectId: true, jobKey: true },
  });
  const coProjectLink = selectProcoreSourceProjectLink(existingCo, linkedProjectResult.project, "id");
  if (coProjectLink.conflict) projectLinkConflicts += 1;
  const coShared = {
    ...coCols,
    jobKey: coProjectLink.jobKey,
    projectId: coProjectLink.projectId,
    customFields: changeOrder as unknown as Prisma.InputJsonObject,
    updatedAt: new Date(),
  };

  let changeOrderDbId = coUid;
  if (existingCo) {
    await prisma.commitmentChangeOrder.update({
      where: { id: existingCo.id }, data: { ...coShared, ...coProjectLink.update },
    });
    changeOrderDbId = existingCo.id;
  } else {
    await prisma.commitmentChangeOrder.create({ data: { id: coUid, ...coShared } });
  }

  // Upsert each line item
  let saved = 0;
  let skipped = 0;

  for (const record of lineItems) {
    try {
      const rawId = toNullableString(asObject(record).id);
      if (!rawId) { skipped += 1; continue; }

      const uid = `ccoli_${rawId}_${projectId}`;
      const cols = extractLineItemColumns(record, companyId, projectId, rawCoId);
      const existing = await prisma.commitmentChangeOrderLineItem.findFirst({
        where: { procoreId: rawId, procoreProjectId: projectId },
        select: { id: true, projectId: true, jobKey: true },
      });
      const projectLink = selectProcoreSourceProjectLink(existing, linkedProjectResult.project, "id");
      if (projectLink.conflict) projectLinkConflicts += 1;
      const sharedFields = {
        ...cols,
        jobKey: projectLink.jobKey,
        projectId: projectLink.projectId,
        changeOrderId: changeOrderDbId,
        customFields: record as unknown as Prisma.InputJsonObject,
        updatedAt: new Date(),
      };

      let finalId = uid;
      if (existing) {
        await prisma.commitmentChangeOrderLineItem.update({
          where: { id: existing.id }, data: { ...sharedFields, ...projectLink.update },
        });
        finalId = existing.id;
      } else {
        await prisma.commitmentChangeOrderLineItem.create({ data: { id: uid, ...sharedFields } });
      }

      await persistLineItemUnpackedFields(finalId, record);
      saved += 1;
    } catch (err) {
      console.error(`[CCOLineItems] persist error:`, err);
      skipped += 1;
    }
  }

  reportProcoreSourceProjectLinkConflicts("change-order-details", params, projectLinkConflicts);
  return { saved, skipped, linkedProjectId, projectCreated, changeOrderDbId, projectIdentity, projectLinkConflicts };
}
