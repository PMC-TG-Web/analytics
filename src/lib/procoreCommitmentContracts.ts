import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveProcoreLegacyProject } from "@/lib/procoreLegacyProjectIdentity";
import { selectProcoreSourceProjectLink, reportProcoreSourceProjectLinkConflicts } from "@/lib/procoreSourceProjectLink";

export type ProcoreCommitmentContract = Record<string, unknown>;
type MutableJsonObject = Record<string, Prisma.InputJsonValue>;

type PersistCommitmentContractsParams = {
  companyId?: string;
  projectId: string;
  projectName?: string;
  projectNumber?: string;
  createProjectIfMissing?: boolean;
};

let unpackedFieldsTableReady: Promise<void> | null = null;

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

function extractPayloadColumns(record: ProcoreCommitmentContract, companyId: string | undefined, projectId: string) {
  const vendor = record.vendor && typeof record.vendor === "object"
    ? (record.vendor as Record<string, unknown>)
    : null;

  return {
    procoreId: toNullableString(record.id),
    procoreCompanyId: toNullableString(companyId),
    procoreProjectId: toNullableString(projectId),
    title: toNullableString(record.title),
    number: toNullableString(record.number),
    status: toNullableString(record.status),
    vendorId: vendor ? toNullableString(vendor.id) : null,
    vendorName: vendor ? toNullableString(vendor.name) : null,
    value: toNullableFloat(record.value),
    originalValue: toNullableFloat(record.original_value ?? record.original_contract_value),
    startDate: toNullableDate(record.start_date),
    completionDate: toNullableDate(record.completion_date),
    approvalLetterDate: toNullableDate(record.approval_letter_date),
    signedContractDate: toNullableDate(record.signed_contract_received_date),
    notes: toNullableString(record.notes),
    procoreCreatedAt: toNullableDate(record.created_at),
    procoreUpdatedAt: toNullableDate(record.updated_at),
    procoreDeletedAt: toNullableDate(record.deleted_at),
  };
}

function unpackJsonFields(payload: Record<string, unknown>): Prisma.InputJsonObject {
  const out: MutableJsonObject = {};
  function walk(value: unknown, path: string) {
    if (path) out[path] = asJsonValue(value);
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, path ? `${path}[${i}]` : `[${i}]`));
    } else {
      for (const [k, v] of Object.entries(value as Record<string, unknown>))
        walk(v, path ? `${path}.${k}` : k);
    }
  }
  walk(payload, "");
  return out as Prisma.InputJsonObject;
}


async function ensureUnpackedFieldsTable() {
  if (unpackedFieldsTableReady) return unpackedFieldsTableReady;

  unpackedFieldsTableReady = (async () => {
    return;
  })();

  return unpackedFieldsTableReady;
}

async function persistUnpackedFields(contractId: string, record: ProcoreCommitmentContract) {
  await ensureUnpackedFieldsTable();

  const rows = Object.entries(record).map(([k, v]) => {
    function classifyValue(value: unknown): { valueType: string; valueText: string | null; valueNumber: number | null; valueBoolean: boolean | null; valueJson: Prisma.InputJsonValue } {
      if (value === null || value === undefined) {
        return { valueType: "null", valueText: null, valueNumber: null, valueBoolean: null, valueJson: null };
      }
      if (typeof value === "string") {
        return { valueType: "string", valueText: value, valueNumber: null, valueBoolean: null, valueJson: value };
      }
      if (typeof value === "number") {
        return { valueType: "number", valueText: null, valueNumber: value, valueBoolean: null, valueJson: value };
      }
      if (typeof value === "boolean") {
        return { valueType: "boolean", valueText: null, valueNumber: null, valueBoolean: value, valueJson: value };
      }
      return { valueType: "object", valueText: null, valueNumber: null, valueBoolean: null, valueJson: asJsonValue(value) };
    }
    const classified = classifyValue(v);
    return {
      field_path: k,
      value_type: classified.valueType,
      value_text: classified.valueText,
      value_number: classified.valueNumber,
      value_boolean: classified.valueBoolean,
      value_json: classified.valueJson,
    };
  });

  await prisma.$executeRawUnsafe(
    "DELETE FROM commitment_contract_unpacked_fields WHERE contract_id = $1",
    contractId
  );

  if (!rows.length) return;

  for (const row of rows) {
    const jsonStr = row.value_json === null || row.value_json === undefined
      ? 'null'
      : typeof row.value_json === 'string' || typeof row.value_json === 'number' || typeof row.value_json === 'boolean'
        ? JSON.stringify(row.value_json)
        : JSON.stringify(row.value_json);

    await prisma.$executeRawUnsafe(
      `
        INSERT INTO commitment_contract_unpacked_fields
          (contract_id, field_path, value_type, value_text, value_number, value_boolean, value_json, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
        ON CONFLICT (contract_id, field_path) DO UPDATE SET
          value_type = EXCLUDED.value_type,
          value_text = EXCLUDED.value_text,
          value_number = EXCLUDED.value_number,
          value_boolean = EXCLUDED.value_boolean,
          value_json = EXCLUDED.value_json,
          updated_at = NOW()
      `,
      contractId,
      row.field_path,
      row.value_type,
      row.value_text,
      row.value_number,
      row.value_boolean,
      jsonStr
    );
  }
}

export async function persistCommitmentContracts(
  records: ProcoreCommitmentContract[],
  params: PersistCommitmentContractsParams
) {
  const { companyId, projectId } = params;
  const linkedProjectResult = await resolveProcoreLegacyProject({ ...params, companyId: params.companyId, source: "procore_commitment_contracts_sync" });
  const linkedProjectId = linkedProjectResult.project?.id ?? null;
  const projectCreated = linkedProjectResult.created;
  let saved = 0;
  let skipped = 0;
  let projectLinkConflicts = 0;

  for (const record of records) {
    try {
      const rawId = toNullableString(asObject(record).id);
      if (!rawId) { skipped += 1; continue; }

      const uid = `cc_${rawId}_${projectId}`;
      const cols = extractPayloadColumns(record, companyId, projectId);
      const jsonFields = unpackJsonFields(record);
      const existing = await prisma.commitmentContract.findFirst({
        where: { procoreId: cols.procoreId ?? undefined, procoreProjectId: projectId },
        select: { id: true, projectId: true, jobKey: true },
      });
      const projectLink = selectProcoreSourceProjectLink(existing, linkedProjectResult.project, "id");
      if (projectLink.conflict) projectLinkConflicts += 1;

      const sharedFields = {
        ...cols,
        jobKey: projectLink.jobKey,
        projectId: projectLink.projectId,
        customFields: record as unknown as Prisma.InputJsonObject,
        updatedAt: new Date(),
      };

      let finalId = uid;
      if (existing) {
        await prisma.commitmentContract.update({
          where: { id: existing.id }, data: { ...sharedFields, ...projectLink.update },
        });
        finalId = existing.id;
      } else {
        await prisma.commitmentContract.create({ data: { id: uid, ...sharedFields } });
      }

      // Persist unpacked custom fields to companion table
      await persistUnpackedFields(finalId, record);
      saved += 1;
    } catch (err) {
      console.error(`[CommitmentContracts] persistCommitmentContracts error:`, err);
      skipped += 1;
    }
  }

  reportProcoreSourceProjectLinkConflicts("commitments", params, projectLinkConflicts);
  return {
    saved, skipped, linkedProjectId, projectCreated, projectLinkConflicts,
    projectIdentity: { status: linkedProjectResult.status, reason: linkedProjectResult.reason },
  };
}
