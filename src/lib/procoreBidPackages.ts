import { prisma } from '@/lib/prisma';

type JsonObject = Record<string, unknown>;

function normalizeTimestamp(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export async function ensureBidPackagesTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS bidpackages (
      id BIGSERIAL PRIMARY KEY,
      company_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      bid_package_id TEXT NOT NULL,
      name TEXT NULL,
      status TEXT NULL,
      source_created_at TIMESTAMPTZ NULL,
      payload JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(company_id, project_id, bid_package_id)
    )
  `);

  await prisma.$executeRawUnsafe('ALTER TABLE bidpackages ADD COLUMN IF NOT EXISTS status TEXT NULL');
  await prisma.$executeRawUnsafe('ALTER TABLE bidpackages ADD COLUMN IF NOT EXISTS source_created_at TIMESTAMPTZ NULL');

  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS idx_bidpackages_company ON bidpackages(company_id)'
  );
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS idx_bidpackages_project ON bidpackages(project_id)'
  );
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS idx_bidpackages_bid_package_id ON bidpackages(bid_package_id)'
  );
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS idx_bidpackages_synced_at ON bidpackages(synced_at DESC)'
  );
}

export async function upsertBidPackage(params: {
  companyId: string;
  projectId: string;
  bidPackageId: string;
  name?: string | null;
  status?: string | null;
  sourceCreatedAt?: string | Date | null;
  payload: JsonObject;
}) {
  const {
    companyId,
    projectId,
    bidPackageId,
    name,
    status,
    sourceCreatedAt,
    payload,
  } = params;

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO bidpackages (
        company_id,
        project_id,
        bid_package_id,
        name,
        status,
        source_created_at,
        payload,
        synced_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::jsonb, NOW(), NOW())
      ON CONFLICT (company_id, project_id, bid_package_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        status = EXCLUDED.status,
        source_created_at = EXCLUDED.source_created_at,
        payload = EXCLUDED.payload,
        synced_at = NOW(),
        updated_at = NOW()
    `,
    companyId,
    projectId,
    bidPackageId,
    name ?? null,
    status ?? null,
    normalizeTimestamp(sourceCreatedAt),
    JSON.stringify(payload)
  );
}
