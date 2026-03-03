-- CreateTable
CREATE TABLE "ScheduleAllocation" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "period" VARCHAR(10) NOT NULL,
    "periodType" TEXT NOT NULL DEFAULT 'month',
    "hours" DOUBLE PRECISION NOT NULL,
    "percent" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduleAllocation_scheduleId_idx" ON "ScheduleAllocation"("scheduleId");

-- CreateIndex
CREATE INDEX "ScheduleAllocation_period_idx" ON "ScheduleAllocation"("period");

-- CreateIndex
CREATE INDEX "ScheduleAllocation_periodType_idx" ON "ScheduleAllocation"("periodType");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleAllocation_scheduleId_period_key" ON "ScheduleAllocation"("scheduleId", "period");

-- AddForeignKey
ALTER TABLE "ScheduleAllocation" ADD CONSTRAINT "ScheduleAllocation_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
