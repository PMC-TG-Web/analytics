CREATE TABLE "procore_commitment_estimate_caches" (
  "company_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "fetched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "procore_commitment_estimate_caches_pkey" PRIMARY KEY ("company_id", "project_id")
);

-- One base-estimate application per project, including partial and uncertain writes.
CREATE TABLE "commitment_maker_estimate_imports" (
  "company_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "combinations" JSONB NOT NULL DEFAULT '[]',
  "targets" JSONB NOT NULL DEFAULT '[]',
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commitment_maker_estimate_imports_pkey" PRIMARY KEY ("company_id", "project_id")
);
