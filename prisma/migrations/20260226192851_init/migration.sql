-- CreateTable
CREATE TABLE "KPIEntry" (
    "id" TEXT NOT NULL,
    "entryKey" TEXT NOT NULL,
    "year" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "monthName" TEXT NOT NULL,
    "bidSubmittedSales" DOUBLE PRECISION,
    "scheduledSales" DOUBLE PRECISION,
    "subs" DOUBLE PRECISION,
    "estimates" DOUBLE PRECISION,
    "grossProfit" DOUBLE PRECISION,
    "cost" DOUBLE PRECISION,
    "bidSubmittedHours" DOUBLE PRECISION,
    "scheduledHours" DOUBLE PRECISION,
    "leadtimes" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByEmail" TEXT,
    "updatedByEmail" TEXT,

    CONSTRAINT "KPIEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "changes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KPIEntry_entryKey_key" ON "KPIEntry"("entryKey");

-- CreateIndex
CREATE INDEX "KPIEntry_year_month_idx" ON "KPIEntry"("year", "month");

-- CreateIndex
CREATE INDEX "KPIEntry_entryKey_idx" ON "KPIEntry"("entryKey");

-- CreateIndex
CREATE INDEX "AuditLog_entityId_idx" ON "AuditLog"("entityId");

-- CreateIndex
CREATE INDEX "AuditLog_userEmail_idx" ON "AuditLog"("userEmail");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
