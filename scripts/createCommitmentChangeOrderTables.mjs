import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // CommitmentChangeOrder table
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CommitmentChangeOrder" (
      id TEXT NOT NULL PRIMARY KEY,
      "jobKey" TEXT,
      "projectId" TEXT,
      "procoreId" TEXT,
      "procoreCompanyId" TEXT,
      "procoreProjectId" TEXT,
      "procoreContractId" TEXT,
      title TEXT,
      number TEXT,
      status TEXT,
      "dueDate" TIMESTAMPTZ,
      "invoicedDate" TIMESTAMPTZ,
      "approvedDate" TIMESTAMPTZ,
      value DOUBLE PRECISION,
      "customFields" JSONB,
      "procoreCreatedAt" TIMESTAMPTZ,
      "procoreUpdatedAt" TIMESTAMPTZ,
      "procoreDeletedAt" TIMESTAMPTZ,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log("CommitmentChangeOrder table created (or already exists)");

  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_cco_job_key ON "CommitmentChangeOrder"("jobKey")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_cco_project_id ON "CommitmentChangeOrder"("projectId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_cco_procore_id ON "CommitmentChangeOrder"("procoreId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_cco_contract_id ON "CommitmentChangeOrder"("procoreContractId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_cco_number ON "CommitmentChangeOrder"(number)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_cco_status ON "CommitmentChangeOrder"(status)`);
  console.log("CommitmentChangeOrder indexes created");

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "CommitmentChangeOrder"
    ADD CONSTRAINT IF NOT EXISTS fk_cco_project
    FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON DELETE SET NULL
  `).catch(() => {});
  console.log("CommitmentChangeOrder FK ensured");

  // CommitmentChangeOrderLineItem table
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CommitmentChangeOrderLineItem" (
      id TEXT NOT NULL PRIMARY KEY,
      "jobKey" TEXT,
      "projectId" TEXT,
      "changeOrderId" TEXT,
      "procoreId" TEXT,
      "procoreCompanyId" TEXT,
      "procoreProjectId" TEXT,
      "procoreChangeOrderId" TEXT,
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
  console.log("CommitmentChangeOrderLineItem table created (or already exists)");

  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_ccoli_job_key ON "CommitmentChangeOrderLineItem"("jobKey")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_ccoli_project_id ON "CommitmentChangeOrderLineItem"("projectId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_ccoli_change_order_id ON "CommitmentChangeOrderLineItem"("changeOrderId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_ccoli_procore_id ON "CommitmentChangeOrderLineItem"("procoreId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_ccoli_procore_co_id ON "CommitmentChangeOrderLineItem"("procoreChangeOrderId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_ccoli_cost_code ON "CommitmentChangeOrderLineItem"("costCode")`);
  console.log("CommitmentChangeOrderLineItem indexes created");

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "CommitmentChangeOrderLineItem"
    ADD CONSTRAINT IF NOT EXISTS fk_ccoli_project
    FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON DELETE SET NULL
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "CommitmentChangeOrderLineItem"
    ADD CONSTRAINT IF NOT EXISTS fk_ccoli_change_order
    FOREIGN KEY ("changeOrderId") REFERENCES "CommitmentChangeOrder"(id) ON DELETE SET NULL
  `).catch(() => {});
  console.log("CommitmentChangeOrderLineItem FKs ensured");

  // Unpacked fields table for line items
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS commitment_change_order_line_item_unpacked_fields (
      id BIGSERIAL PRIMARY KEY,
      line_item_id TEXT NOT NULL,
      field_path TEXT NOT NULL,
      value_type TEXT NOT NULL,
      value_text TEXT,
      value_number DOUBLE PRECISION,
      value_boolean BOOLEAN,
      value_json JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (line_item_id, field_path),
      CONSTRAINT fk_ccoli_unpacked_line_item
        FOREIGN KEY (line_item_id)
        REFERENCES "CommitmentChangeOrderLineItem"(id)
        ON DELETE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_ccoli_unpacked_field_path ON commitment_change_order_line_item_unpacked_fields(field_path)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_ccoli_unpacked_value_text ON commitment_change_order_line_item_unpacked_fields(value_text)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_ccoli_unpacked_value_number ON commitment_change_order_line_item_unpacked_fields(value_number)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_ccoli_unpacked_value_boolean ON commitment_change_order_line_item_unpacked_fields(value_boolean)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_ccoli_unpacked_path_text ON commitment_change_order_line_item_unpacked_fields(field_path, value_text)`);
  console.log("commitment_change_order_line_item_unpacked_fields table + indexes created");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
