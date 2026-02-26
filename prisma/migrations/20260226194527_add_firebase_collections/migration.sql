-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "projectNumber" TEXT,
    "projectName" TEXT NOT NULL,
    "customer" TEXT,
    "status" TEXT,
    "sales" DOUBLE PRECISION,
    "cost" DOUBLE PRECISION,
    "hours" DOUBLE PRECISION,
    "laborSales" DOUBLE PRECISION,
    "laborCost" DOUBLE PRECISION,
    "dateUpdated" TIMESTAMP(3),
    "dateCreated" TIMESTAMP(3),
    "projectArchived" BOOLEAN DEFAULT false,
    "estimator" TEXT,
    "projectManager" TEXT,
    "customFields" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectScope" (
    "id" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "projectId" TEXT,
    "scopeOfWork" TEXT NOT NULL,
    "startDate" TEXT,
    "endDate" TEXT,
    "hours" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "projectId" TEXT,
    "customer" TEXT,
    "projectNumber" TEXT,
    "projectName" TEXT,
    "status" TEXT,
    "totalHours" DOUBLE PRECISION,
    "allocations" JSONB DEFAULT '{}',
    "shortTermData" JSONB,
    "longTermData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActiveSchedule" (
    "id" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "projectId" TEXT,
    "scopeOfWork" TEXT NOT NULL,
    "date" VARCHAR(10) NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,
    "foreman" TEXT,
    "manpower" INTEGER,
    "source" TEXT NOT NULL,
    "lastModified" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActiveSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScopeTracking" (
    "id" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "projectId" TEXT,
    "scopeOfWork" TEXT NOT NULL,
    "totalHours" DOUBLE PRECISION NOT NULL,
    "scheduledHours" DOUBLE PRECISION NOT NULL,
    "unscheduledHours" DOUBLE PRECISION NOT NULL,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScopeTracking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductivityLog" (
    "id" TEXT NOT NULL,
    "jobKey" TEXT,
    "projectId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "foreman" TEXT,
    "crew" TEXT,
    "hours" DOUBLE PRECISION,
    "scopeOfWork" TEXT,
    "notes" TEXT,
    "customFields" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductivitySummary" (
    "id" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "projectId" TEXT,
    "totalHours" DOUBLE PRECISION NOT NULL,
    "averageDaily" DOUBLE PRECISION,
    "dates" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductivitySummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardSummary" (
    "id" TEXT NOT NULL DEFAULT 'summary',
    "totalSales" DOUBLE PRECISION NOT NULL,
    "totalCost" DOUBLE PRECISION NOT NULL,
    "totalHours" DOUBLE PRECISION NOT NULL,
    "statusGroups" JSONB NOT NULL,
    "contractors" JSONB NOT NULL,
    "pmcGroupHours" JSONB NOT NULL,
    "laborBreakdown" JSONB,
    "lastUpdated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DashboardSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Project_projectNumber_idx" ON "Project"("projectNumber");

-- CreateIndex
CREATE INDEX "Project_projectName_idx" ON "Project"("projectName");

-- CreateIndex
CREATE INDEX "Project_customer_idx" ON "Project"("customer");

-- CreateIndex
CREATE INDEX "Project_status_idx" ON "Project"("status");

-- CreateIndex
CREATE INDEX "Project_projectArchived_idx" ON "Project"("projectArchived");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectScope_jobKey_key" ON "ProjectScope"("jobKey");

-- CreateIndex
CREATE INDEX "ProjectScope_jobKey_idx" ON "ProjectScope"("jobKey");

-- CreateIndex
CREATE INDEX "ProjectScope_projectId_idx" ON "ProjectScope"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Schedule_jobKey_key" ON "Schedule"("jobKey");

-- CreateIndex
CREATE INDEX "Schedule_jobKey_idx" ON "Schedule"("jobKey");

-- CreateIndex
CREATE INDEX "Schedule_projectId_idx" ON "Schedule"("projectId");

-- CreateIndex
CREATE INDEX "ActiveSchedule_jobKey_idx" ON "ActiveSchedule"("jobKey");

-- CreateIndex
CREATE INDEX "ActiveSchedule_projectId_idx" ON "ActiveSchedule"("projectId");

-- CreateIndex
CREATE INDEX "ActiveSchedule_date_idx" ON "ActiveSchedule"("date");

-- CreateIndex
CREATE UNIQUE INDEX "ActiveSchedule_jobKey_scopeOfWork_date_key" ON "ActiveSchedule"("jobKey", "scopeOfWork", "date");

-- CreateIndex
CREATE INDEX "ScopeTracking_jobKey_idx" ON "ScopeTracking"("jobKey");

-- CreateIndex
CREATE INDEX "ScopeTracking_projectId_idx" ON "ScopeTracking"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ScopeTracking_jobKey_scopeOfWork_key" ON "ScopeTracking"("jobKey", "scopeOfWork");

-- CreateIndex
CREATE INDEX "ProductivityLog_jobKey_idx" ON "ProductivityLog"("jobKey");

-- CreateIndex
CREATE INDEX "ProductivityLog_projectId_idx" ON "ProductivityLog"("projectId");

-- CreateIndex
CREATE INDEX "ProductivityLog_date_idx" ON "ProductivityLog"("date");

-- CreateIndex
CREATE UNIQUE INDEX "ProductivitySummary_jobKey_key" ON "ProductivitySummary"("jobKey");

-- CreateIndex
CREATE INDEX "ProductivitySummary_jobKey_idx" ON "ProductivitySummary"("jobKey");

-- CreateIndex
CREATE INDEX "ProductivitySummary_projectId_idx" ON "ProductivitySummary"("projectId");

-- CreateIndex
CREATE INDEX "DashboardSummary_id_idx" ON "DashboardSummary"("id");

-- AddForeignKey
ALTER TABLE "ProjectScope" ADD CONSTRAINT "ProjectScope_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActiveSchedule" ADD CONSTRAINT "ActiveSchedule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScopeTracking" ADD CONSTRAINT "ScopeTracking_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductivityLog" ADD CONSTRAINT "ProductivityLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductivitySummary" ADD CONSTRAINT "ProductivitySummary_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
