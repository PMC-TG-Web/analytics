/*
  Warnings:

  - You are about to drop the column `allocations` on the `Schedule` table. All the data in the column will be lost.
  - You are about to drop the column `longTermData` on the `Schedule` table. All the data in the column will be lost.
  - You are about to drop the column `shortTermData` on the `Schedule` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Schedule" DROP COLUMN "allocations",
DROP COLUMN "longTermData",
DROP COLUMN "shortTermData";
