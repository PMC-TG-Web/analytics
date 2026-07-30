ALTER TABLE "productivity_project_reviews"
    ADD COLUMN "completion_notice_status" TEXT NOT NULL DEFAULT 'not_needed',
    ADD COLUMN "completion_notice_sent_at" TIMESTAMPTZ(6),
    ADD COLUMN "completion_notice_id" TEXT,
    ADD COLUMN "completion_notice_error" TEXT;

CREATE INDEX "productivity_project_reviews_company_id_completion_notice_status_idx"
    ON "productivity_project_reviews"("company_id", "completion_notice_status");
