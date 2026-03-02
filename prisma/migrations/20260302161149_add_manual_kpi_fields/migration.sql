-- AlterTable
ALTER TABLE "KPIEntry" ADD COLUMN     "estimatesActualHours" DOUBLE PRECISION,
ADD COLUMN     "gpActualPercent" DOUBLE PRECISION,
ADD COLUMN     "profitActualPercent" DOUBLE PRECISION,
ADD COLUMN     "revenueActual" DOUBLE PRECISION,
ADD COLUMN     "revenueActualHours" DOUBLE PRECISION,
ADD COLUMN     "salesActualHours" DOUBLE PRECISION,
ADD COLUMN     "subActualHours" DOUBLE PRECISION,
ADD COLUMN     "subsAllowance" DOUBLE PRECISION;
