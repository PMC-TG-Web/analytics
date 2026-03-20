import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CommitmentContract" (
      id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
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
      "approvalLetterDate" TIMESTAMPTZ,
      "signedContractDate" TIMESTAMPTZ,
      notes TEXT,
      "procoreCreatedAt" TIMESTAMPTZ,
      "procoreUpdatedAt" TIMESTAMPTZ,
      "procoreDeletedAt" TIMESTAMPTZ,
      "customFields" JSONB,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT "CommitmentContract_pkey" PRIMARY KEY (id)
    )
  `);
  console.log("CommitmentContract table created (or already exists)");

  const indexes = [
    `CREATE INDEX IF NOT EXISTS "CommitmentContract_jobKey_idx" ON "CommitmentContract"("jobKey")`,
    `CREATE INDEX IF NOT EXISTS "CommitmentContract_projectId_idx" ON "CommitmentContract"("projectId")`,
    `CREATE INDEX IF NOT EXISTS "CommitmentContract_procoreId_idx" ON "CommitmentContract"("procoreId")`,
    `CREATE INDEX IF NOT EXISTS "CommitmentContract_number_idx" ON "CommitmentContract"(number)`,
    `CREATE INDEX IF NOT EXISTS "CommitmentContract_status_idx" ON "CommitmentContract"(status)`,
    `CREATE INDEX IF NOT EXISTS "CommitmentContract_vendorId_idx" ON "CommitmentContract"("vendorId")`,
  ];
  for (const sql of indexes) await prisma.$executeRawUnsafe(sql);
  console.log("Indexes created");

  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'CommitmentContract_projectId_fkey'
          AND table_name = 'CommitmentContract'
      ) THEN
        ALTER TABLE "CommitmentContract"
          ADD CONSTRAINT "CommitmentContract_projectId_fkey"
          FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON DELETE SET NULL;
      END IF;
    END$$
  `);
  console.log("FK constraint ensured");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
