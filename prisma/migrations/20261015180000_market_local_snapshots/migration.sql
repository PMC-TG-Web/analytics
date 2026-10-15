CREATE TABLE "market_local_snapshots" (
    "id" TEXT NOT NULL,
    "data" JSONB,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "checked_at" TIMESTAMPTZ(6) NOT NULL,
    "last_success_at" TIMESTAMPTZ(6),
    CONSTRAINT "market_local_snapshots_pkey" PRIMARY KEY ("id")
);
