CREATE TABLE "subcontract_allocation_drafts" (
  "company_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "source_fingerprint" TEXT NOT NULL,
  "source" JSONB NOT NULL,
  "changes" JSONB NOT NULL,
  "updated_by" TEXT NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("company_id", "project_id")
);
CREATE TABLE "subcontract_allocation_revisions" (
  "company_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "source_fingerprint" TEXT NOT NULL,
  "source" JSONB NOT NULL,
  "changes" JSONB NOT NULL,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("company_id", "project_id", "revision")
);
