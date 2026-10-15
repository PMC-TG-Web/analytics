-- Additive public-data tables only. No business records or external systems are modified.
CREATE TABLE "market_series_snapshots" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "points" JSONB NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL,
  "message" TEXT,
  "checked_at" TIMESTAMPTZ(6) NOT NULL,
  "last_success_at" TIMESTAMPTZ(6)
);
CREATE TABLE "market_sync_leases" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "token" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL
);
