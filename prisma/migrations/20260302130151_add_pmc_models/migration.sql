/*
  Warnings:

  - You are about to drop the column `scopeOfWork` on the `ProjectScope` table. All the data in the column will be lost.
  - Added the required column `title` to the `ProjectScope` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "ProjectScope_jobKey_key";

-- AlterTable
ALTER TABLE "ProjectScope" DROP COLUMN "scopeOfWork",
ADD COLUMN     "description" TEXT,
ADD COLUMN     "manpower" DOUBLE PRECISION,
ADD COLUMN     "tasks" JSONB,
ADD COLUMN     "title" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "jobTitle" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "customFields" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobTitle" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobTitle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "date" VARCHAR(10) NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isPaid" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeOffRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "employeeName" TEXT,
    "dates" JSONB NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeOffRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrewTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "members" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrewTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandbookSignoff" (
    "id" TEXT NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "displayName" TEXT,
    "userAgent" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HandbookSignoff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimatingConstant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'General',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstimatingConstant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RebarConstant" (
    "id" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "spacing" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RebarConstant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certification" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "issueDate" TEXT NOT NULL,
    "expirationDate" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Certification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Available',
    "hourlyRate" DOUBLE PRECISION,
    "dailyRate" DOUBLE PRECISION,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentAssignment" (
    "id" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "projectId" TEXT,
    "scopeId" TEXT,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingSubmission" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "hasBooklet" BOOLEAN,
    "hasHandbook" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Status" (
    "id" TEXT NOT NULL,
    "customer" TEXT,
    "projectNumber" TEXT,
    "projectName" TEXT,
    "status" TEXT,
    "testProject" BOOLEAN,
    "active" BOOLEAN,
    "dateCreatedRaw" TEXT,
    "estimator" TEXT,
    "projectStage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Estimate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "estimatedHours" DOUBLE PRECISION,
    "estimatedCost" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "createdByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Estimate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PMCGroup" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PMCGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostitemPMCMapping" (
    "id" TEXT NOT NULL,
    "costitem" TEXT NOT NULL,
    "pmcGroupId" TEXT,
    "pmcGroupCode" TEXT,
    "mappedByEmail" TEXT,
    "source" TEXT NOT NULL DEFAULT 'seed',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostitemPMCMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PMCBreakdownCache" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "pmcBreakdown" JSONB NOT NULL DEFAULT '{}',
    "pmcGroupBreakdown" JSONB NOT NULL DEFAULT '{}',
    "totalHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastCalculated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PMCBreakdownCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Employee_email_key" ON "Employee"("email");

-- CreateIndex
CREATE INDEX "Employee_jobTitle_idx" ON "Employee"("jobTitle");

-- CreateIndex
CREATE INDEX "Employee_isActive_idx" ON "Employee"("isActive");

-- CreateIndex
CREATE INDEX "Employee_firstName_lastName_idx" ON "Employee"("firstName", "lastName");

-- CreateIndex
CREATE INDEX "Employee_isActive_firstName_lastName_idx" ON "Employee"("isActive", "firstName", "lastName");

-- CreateIndex
CREATE UNIQUE INDEX "JobTitle_title_key" ON "JobTitle"("title");

-- CreateIndex
CREATE INDEX "JobTitle_title_idx" ON "JobTitle"("title");

-- CreateIndex
CREATE INDEX "Holiday_date_idx" ON "Holiday"("date");

-- CreateIndex
CREATE INDEX "TimeOffRequest_employeeId_idx" ON "TimeOffRequest"("employeeId");

-- CreateIndex
CREATE INDEX "TimeOffRequest_status_idx" ON "TimeOffRequest"("status");

-- CreateIndex
CREATE INDEX "CrewTemplate_name_idx" ON "CrewTemplate"("name");

-- CreateIndex
CREATE UNIQUE INDEX "HandbookSignoff_email_key" ON "HandbookSignoff"("email");

-- CreateIndex
CREATE INDEX "HandbookSignoff_email_idx" ON "HandbookSignoff"("email");

-- CreateIndex
CREATE UNIQUE INDEX "EstimatingConstant_name_key" ON "EstimatingConstant"("name");

-- CreateIndex
CREATE INDEX "EstimatingConstant_category_idx" ON "EstimatingConstant"("category");

-- CreateIndex
CREATE INDEX "RebarConstant_size_idx" ON "RebarConstant"("size");

-- CreateIndex
CREATE INDEX "Certification_employeeId_idx" ON "Certification"("employeeId");

-- CreateIndex
CREATE INDEX "Certification_expirationDate_idx" ON "Certification"("expirationDate");

-- CreateIndex
CREATE INDEX "Certification_employeeId_expirationDate_idx" ON "Certification"("employeeId", "expirationDate");

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_serialNumber_key" ON "Equipment"("serialNumber");

-- CreateIndex
CREATE INDEX "Equipment_type_idx" ON "Equipment"("type");

-- CreateIndex
CREATE INDEX "Equipment_status_idx" ON "Equipment"("status");

-- CreateIndex
CREATE INDEX "Equipment_name_idx" ON "Equipment"("name");

-- CreateIndex
CREATE INDEX "Equipment_type_name_idx" ON "Equipment"("type", "name");

-- CreateIndex
CREATE INDEX "EquipmentAssignment_equipmentId_idx" ON "EquipmentAssignment"("equipmentId");

-- CreateIndex
CREATE INDEX "EquipmentAssignment_projectId_idx" ON "EquipmentAssignment"("projectId");

-- CreateIndex
CREATE INDEX "EquipmentAssignment_startDate_idx" ON "EquipmentAssignment"("startDate");

-- CreateIndex
CREATE INDEX "OnboardingSubmission_email_idx" ON "OnboardingSubmission"("email");

-- CreateIndex
CREATE INDEX "OnboardingSubmission_submittedAt_idx" ON "OnboardingSubmission"("submittedAt");

-- CreateIndex
CREATE INDEX "OnboardingSubmission_email_submittedAt_idx" ON "OnboardingSubmission"("email", "submittedAt");

-- CreateIndex
CREATE INDEX "Status_customer_idx" ON "Status"("customer");

-- CreateIndex
CREATE INDEX "Status_projectNumber_idx" ON "Status"("projectNumber");

-- CreateIndex
CREATE INDEX "Status_projectName_idx" ON "Status"("projectName");

-- CreateIndex
CREATE INDEX "Status_status_idx" ON "Status"("status");

-- CreateIndex
CREATE INDEX "Status_active_idx" ON "Status"("active");

-- CreateIndex
CREATE INDEX "Status_testProject_idx" ON "Status"("testProject");

-- CreateIndex
CREATE INDEX "Status_customer_projectName_idx" ON "Status"("customer", "projectName");

-- CreateIndex
CREATE INDEX "Status_status_active_idx" ON "Status"("status", "active");

-- CreateIndex
CREATE INDEX "Estimate_projectId_idx" ON "Estimate"("projectId");

-- CreateIndex
CREATE INDEX "Estimate_status_idx" ON "Estimate"("status");

-- CreateIndex
CREATE INDEX "PMCGroup_code_idx" ON "PMCGroup"("code");

-- CreateIndex
CREATE INDEX "PMCGroup_isActive_idx" ON "PMCGroup"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PMCGroup_code_key" ON "PMCGroup"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CostitemPMCMapping_costitem_key" ON "CostitemPMCMapping"("costitem");

-- CreateIndex
CREATE INDEX "CostitemPMCMapping_costitem_idx" ON "CostitemPMCMapping"("costitem");

-- CreateIndex
CREATE INDEX "CostitemPMCMapping_pmcGroupId_idx" ON "CostitemPMCMapping"("pmcGroupId");

-- CreateIndex
CREATE INDEX "CostitemPMCMapping_pmcGroupCode_idx" ON "CostitemPMCMapping"("pmcGroupCode");

-- CreateIndex
CREATE INDEX "CostitemPMCMapping_source_idx" ON "CostitemPMCMapping"("source");

-- CreateIndex
CREATE UNIQUE INDEX "PMCBreakdownCache_projectId_key" ON "PMCBreakdownCache"("projectId");

-- CreateIndex
CREATE INDEX "PMCBreakdownCache_projectId_idx" ON "PMCBreakdownCache"("projectId");

-- CreateIndex
CREATE INDEX "Project_projectArchived_status_idx" ON "Project"("projectArchived", "status");

-- CreateIndex
CREATE INDEX "Schedule_customer_idx" ON "Schedule"("customer");

-- CreateIndex
CREATE INDEX "Schedule_projectNumber_idx" ON "Schedule"("projectNumber");

-- CreateIndex
CREATE INDEX "Schedule_status_idx" ON "Schedule"("status");

-- AddForeignKey
ALTER TABLE "Certification" ADD CONSTRAINT "Certification_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostitemPMCMapping" ADD CONSTRAINT "CostitemPMCMapping_pmcGroupId_fkey" FOREIGN KEY ("pmcGroupId") REFERENCES "PMCGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PMCBreakdownCache" ADD CONSTRAINT "PMCBreakdownCache_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
