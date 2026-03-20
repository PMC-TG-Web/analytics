import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Ensuring bid support tables...");

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS procore_project_feed (
      id BIGSERIAL PRIMARY KEY,
      company_id TEXT NOT NULL,
      sync_source TEXT NOT NULL,
      external_id TEXT NOT NULL,
      procore_id TEXT NULL,
      project_number TEXT NULL,
      project_name TEXT NOT NULL,
      status TEXT NULL,
      customer TEXT NULL,
      customer_source TEXT NULL,
      office_name TEXT NULL,
      city TEXT NULL,
      state_code TEXT NULL,
      country_code TEXT NULL,
      stage_name TEXT NULL,
      due_date TIMESTAMPTZ NULL,
      created_on TIMESTAMPTZ NULL,
      source_id TEXT NULL,
      source_name TEXT NULL,
      source_created_by TEXT NULL,
      source_created_at TIMESTAMPTZ NULL,
      last_modified_at TIMESTAMPTZ NULL,
      estimated_value DOUBLE PRECISION NULL,
      linked_project_id TEXT NULL,
      match_confidence TEXT NULL,
      matched_at TIMESTAMPTZ NULL,
      soft_deleted BOOLEAN NOT NULL DEFAULT FALSE,
      payload JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log("- procore_project_feed ready");

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS bidpackages (
      id BIGSERIAL PRIMARY KEY,
      company_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      bid_package_id TEXT NOT NULL,
      name TEXT NULL,
      status TEXT NULL,
      source_created_at TIMESTAMPTZ NULL,
      payload JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(company_id, project_id, bid_package_id)
    )
  `);
  console.log("- bidpackages ready");

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS bidforms (
      id BIGSERIAL PRIMARY KEY,
      company_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      bid_package_id TEXT NOT NULL,
      bid_form_id TEXT NOT NULL,
      name TEXT NULL,
      status TEXT NULL,
      created_by TEXT NULL,
      source_created_at TIMESTAMPTZ NULL,
      payload JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(company_id, project_id, bid_package_id, bid_form_id)
    )
  `);
  console.log("- bidforms ready");

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
