import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

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

async function resolveLinkedProject(params: PersistCommitmentContractsParams) {
  const { companyId, projectId, projectName, projectNumber, createProjectIfMissing } = params;
  const matchers: Prisma.ProjectWhereInput[] = [
    { customFields: { path: ["procoreProjectId"], equals: projectId } },
    { customFields: { path: ["procoreId"], equals: projectId } },
    { projectNumber: projectId },
  ];
  if (projectNumber) matchers.push({ projectNumber });
  if (projectName && projectNumber) matchers.push({ projectName, projectNumber });
  else if (projectName) matchers.push({ projectName });

  const existing = await prisma.project.findFirst({ where: { OR: matchers }, select: { id: true } });
  if (existing) return { linkedProjectId: existing.id, projectCreated: false };
  if (!createProjectIfMissing) return { linkedProjectId: null, projectCreated: false };

  const created = await prisma.project.create({
    data: {
      projectNumber: projectNumber || projectId,
      projectName: projectName || `Procore Project ${projectId}`,
      customFields: { procoreProjectId: projectId, procoreCompanyId: companyId || null, source: "procore_commitment_contracts_sync" },
    },
    select: { id: true },
  });
  return { linkedProjectId: created.id, projectCreated: true };
}

async function ensureUnpackedFieldsTable() {
  if (unpackedFieldsTableReady) return unpackedFieldsTableReady;

  unpackedFieldsTableReady = (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS commitment_contract_unpacked_fields (
        id BIGSERIAL PRIMARY KEY,
        contract_id TEXT NOT NULL,
        field_path TEXT NOT NULL,
        value_type TEXT NOT NULL,
        value_text TEXT NULL,
        value_number DOUBLE PRECISION NULL,
        value_boolean BOOLEAN NULL,
        value_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (contract_id, field_path),
        CONSTRAINT fk_commitment_unpacked_contract
          FOREIGN KEY (contract_id)
          REFERENCES "CommitmentContract"(id)
          ON DELETE CASCADE
      )
    `);
    await prisma.$executeRawUnsafe(
      "CREATE INDEX IF NOT EXISTS idx_cc_unpacked_field_path ON commitment_contract_unpacked_fields(field_path)"
    );
    await prisma.$executeRawUnsafe(
      "CREATE INDEX IF NOT EXISTS idx_cc_unpacked_value_text ON commitment_contract_unpacked_fields(value_text)"
    );
    await prisma.$executeRawUnsafe(
      "CREATE INDEX IF NOT EXISTS idx_cc_unpacked_value_number ON commitment_contract_unpacked_fields(value_number)"
    );
    await prisma.$executeRawUnsafe(
      "CREATE INDEX IF NOT EXISTS idx_cc_unpacked_value_boolean ON commitment_contract_unpacked_fields(value_boolean)"
    );
    await prisma.$executeRawUnsafe(
      "CREATE INDEX IF NOT EXISTS idx_cc_unpacked_path_text ON commitment_contract_unpacked_fields(field_path, value_text)"
    );
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
  const { linkedProjectId, projectCreated } = await resolveLinkedProject(params);
  let saved = 0;
  let skipped = 0;

  for (const record of records) {
    try {
      const rawId = toNullableString(asObject(record).id);
      if (!rawId) { skipped += 1; continue; }

      const uid = `cc_${rawId}_${projectId}`;
      const cols = extractPayloadColumns(record, companyId, projectId);
      const jsonFields = unpackJsonFields(record);

      const sharedFields = {
        ...cols,
        jobKey: linkedProjectId || undefined,
        projectId: linkedProjectId || undefined,
        customFields: record as unknown as Prisma.InputJsonObject,
        updatedAt: new Date(),
      };

      const existing = await prisma.commitmentContract.findFirst({
        where: { procoreId: cols.procoreId ?? undefined, procoreProjectId: projectId },
        select: { id: true },
      });

      let finalId = uid;
      if (existing) {
        await prisma.commitmentContract.update({ where: { id: existing.id }, data: sharedFields });
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

  return { saved, skipped, linkedProjectId, projectCreated };
}
