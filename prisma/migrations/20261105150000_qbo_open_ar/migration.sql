CREATE TABLE "qbo_open_ar_snapshots" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "realm_id" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "source_hash" TEXT NOT NULL,
    "source_generated_at" TIMESTAMPTZ(6) NOT NULL,
    "as_of_date" DATE NOT NULL,
    "payload" JSONB NOT NULL,
    "imported_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "qbo_open_ar_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "qbo_open_ar_snapshots_source_hash_key" ON "qbo_open_ar_snapshots"("source_hash");
CREATE INDEX "qbo_open_ar_snapshots_company_id_source_generated_at_idx" ON "qbo_open_ar_snapshots"("company_id", "source_generated_at" DESC);
