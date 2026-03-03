-- CreateTable ScheduleAllocation
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

-- Add foreign key
ALTER TABLE "ScheduleAllocation" ADD CONSTRAINT "ScheduleAllocation_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create indexes
CREATE UNIQUE INDEX "ScheduleAllocation_scheduleId_period_key" ON "ScheduleAllocation"("scheduleId", "period");
CREATE INDEX "ScheduleAllocation_scheduleId_idx" ON "ScheduleAllocation"("scheduleId");
CREATE INDEX "ScheduleAllocation_period_idx" ON "ScheduleAllocation"("period");
CREATE INDEX "ScheduleAllocation_periodType_idx" ON "ScheduleAllocation"("periodType");

-- Drop JSON columns from Schedule table
ALTER TABLE "Schedule" DROP COLUMN IF EXISTS "allocations";
ALTER TABLE "Schedule" DROP COLUMN IF EXISTS "shortTermData";
ALTER TABLE "Schedule" DROP COLUMN IF EXISTS "longTermData";
