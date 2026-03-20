import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Creating Purchase Order Contract tables...");

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PurchaseOrderContract" (
      id TEXT PRIMARY KEY,
      "jobKey" TEXT,
      "projectId" TEXT,
      "procoreId" TEXT,
      "procoreCompanyId" TEXT,
      "procoreProjectId" TEXT,
      title TEXT,
      number TEXT,
      status TEXT,
      "vendorId" TEXT,
      "vendorName" TEXT,
      value DOUBLE PRECISION,
      "originalValue" DOUBLE PRECISION,
      "startDate" TIMESTAMPTZ,
      "completionDate" TIMESTAMPTZ,
      "customFields" JSONB,
      "procoreCreatedAt" TIMESTAMPTZ,
      "procoreUpdatedAt" TIMESTAMPTZ,
      "procoreDeletedAt" TIMESTAMPTZ,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PurchaseOrderLineItemContractDetail" (
      id TEXT PRIMARY KEY,
      "jobKey" TEXT,
      "projectId" TEXT,
      "purchaseOrderContractId" TEXT,
      "procoreId" TEXT,
      "procoreCompanyId" TEXT,
      "procoreProjectId" TEXT,
      "procorePurchaseOrderContractId" TEXT,
      description TEXT,
      quantity DOUBLE PRECISION,
      "unitCost" DOUBLE PRECISION,
      "totalAmount" DOUBLE PRECISION,
      uom TEXT,
      position INTEGER,
      "wbsCode" TEXT,
      "costCode" TEXT,
      "costType" TEXT,
      "customFields" JSONB,
      "procoreCreatedAt" TIMESTAMPTZ,
      "procoreUpdatedAt" TIMESTAMPTZ,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS purchase_order_line_item_contract_detail_unpacked_fields (
      id BIGSERIAL PRIMARY KEY,
      detail_id TEXT NOT NULL,
      field_path TEXT NOT NULL,
      value_type TEXT NOT NULL,
      value_text TEXT,
      value_number DOUBLE PRECISION,
      value_boolean BOOLEAN,
      value_json JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (detail_id, field_path)
    )
  `);

  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_poc_project') THEN
        ALTER TABLE "PurchaseOrderContract"
        ADD CONSTRAINT fk_poc_project
        FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pold_project') THEN
        ALTER TABLE "PurchaseOrderLineItemContractDetail"
        ADD CONSTRAINT fk_pold_project
        FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pold_contract') THEN
        ALTER TABLE "PurchaseOrderLineItemContractDetail"
        ADD CONSTRAINT fk_pold_contract
        FOREIGN KEY ("purchaseOrderContractId") REFERENCES "PurchaseOrderContract"(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pold_unpacked_detail') THEN
        ALTER TABLE purchase_order_line_item_contract_detail_unpacked_fields
        ADD CONSTRAINT fk_pold_unpacked_detail
        FOREIGN KEY (detail_id) REFERENCES "PurchaseOrderLineItemContractDetail"(id) ON DELETE CASCADE;
      END IF;
    END $$;
  `);

  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_poc_job_key ON "PurchaseOrderContract"("jobKey")`,
    `CREATE INDEX IF NOT EXISTS idx_poc_project_id ON "PurchaseOrderContract"("projectId")`,
    `CREATE INDEX IF NOT EXISTS idx_poc_procore_id ON "PurchaseOrderContract"("procoreId")`,
    `CREATE INDEX IF NOT EXISTS idx_poc_number ON "PurchaseOrderContract"(number)`,
    `CREATE INDEX IF NOT EXISTS idx_poc_status ON "PurchaseOrderContract"(status)`,
    `CREATE INDEX IF NOT EXISTS idx_poc_vendor_id ON "PurchaseOrderContract"("vendorId")`,
    `CREATE INDEX IF NOT EXISTS idx_pold_job_key ON "PurchaseOrderLineItemContractDetail"("jobKey")`,
    `CREATE INDEX IF NOT EXISTS idx_pold_project_id ON "PurchaseOrderLineItemContractDetail"("projectId")`,
    `CREATE INDEX IF NOT EXISTS idx_pold_contract_id ON "PurchaseOrderLineItemContractDetail"("purchaseOrderContractId")`,
    `CREATE INDEX IF NOT EXISTS idx_pold_procore_id ON "PurchaseOrderLineItemContractDetail"("procoreId")`,
    `CREATE INDEX IF NOT EXISTS idx_pold_contract_procore_id ON "PurchaseOrderLineItemContractDetail"("procorePurchaseOrderContractId")`,
    `CREATE INDEX IF NOT EXISTS idx_pold_cost_code ON "PurchaseOrderLineItemContractDetail"("costCode")`,
    `CREATE INDEX IF NOT EXISTS idx_pold_uf_field_path ON purchase_order_line_item_contract_detail_unpacked_fields(field_path)`,
    `CREATE INDEX IF NOT EXISTS idx_pold_uf_value_text ON purchase_order_line_item_contract_detail_unpacked_fields(value_text)`,
    `CREATE INDEX IF NOT EXISTS idx_pold_uf_value_number ON purchase_order_line_item_contract_detail_unpacked_fields(value_number)`,
    `CREATE INDEX IF NOT EXISTS idx_pold_uf_value_boolean ON purchase_order_line_item_contract_detail_unpacked_fields(value_boolean)`,
    `CREATE INDEX IF NOT EXISTS idx_pold_uf_path_text ON purchase_order_line_item_contract_detail_unpacked_fields(field_path, value_text)`,
  ];

  for (const sql of indexes) {
    await prisma.$executeRawUnsafe(sql);
  }

  console.log("Purchase Order Contract tables created.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
