CREATE TABLE "productivity_project_reviews" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "project_number" TEXT,
    "project_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "reviewed_at" TIMESTAMPTZ(6),
    "reviewed_by_email" TEXT,
    "notification_email" TEXT,
    "notification_status" TEXT NOT NULL DEFAULT 'not_sent',
    "notification_id" TEXT,
    "notification_error" TEXT,
    "weighted_completion" DECIMAL(7,6),
    "completion_snapshot" JSONB,
    "completion_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "productivity_project_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "productivity_project_reviews_company_id_project_id_key"
    ON "productivity_project_reviews"("company_id", "project_id");

CREATE INDEX "productivity_project_reviews_company_id_status_idx"
    ON "productivity_project_reviews"("company_id", "status");

CREATE INDEX "productivity_project_reviews_reviewed_at_idx"
    ON "productivity_project_reviews"("reviewed_at" DESC);
