ALTER TABLE "productivity_project_reviews"
    ADD COLUMN "bid_board_id" TEXT,
    ADD COLUMN "bid_board_status" TEXT,
    ADD COLUMN "cooldown_started_at" TIMESTAMPTZ(6),
    ADD COLUMN "review_eligible_at" TIMESTAMPTZ(6),
    ADD COLUMN "reminder_status" TEXT NOT NULL DEFAULT 'not_scheduled',
    ADD COLUMN "reminder_sent_at" TIMESTAMPTZ(6),
    ADD COLUMN "reminder_id" TEXT,
    ADD COLUMN "reminder_error" TEXT;

CREATE INDEX "productivity_project_reviews_company_id_reminder_status_review_eligible_at_idx"
    ON "productivity_project_reviews"("company_id", "reminder_status", "review_eligible_at");
