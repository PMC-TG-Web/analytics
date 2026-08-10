import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import {
  hashQboProfitabilitySource,
  normalizeQboProfitabilityPayload,
} from './lib/qboProfitabilityPayload.mjs';
import {
  buildEmbeddedDrillthroughProjects,
  mergeSnapshotSummary,
} from './lib/qboProfitabilityDrillthrough.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env.local'), quiet: true });
dotenv.config({ path: path.join(root, '.env'), quiet: true });

function parseFileArgument() {
  const argument = process.argv.slice(2).find((value) => value.startsWith('--file='));
  return argument ? argument.slice('--file='.length).trim() : '';
}

function isPermissionDeniedError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /permission denied/i.test(message) || /Code:\s*`42501`/i.test(message);
}

async function ensureQboDrillthroughTable(prisma) {
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS qbo_profitability_drillthrough_projects (
        id BIGSERIAL PRIMARY KEY,
        snapshot_id TEXT NOT NULL REFERENCES qbo_profitability_snapshots(id) ON DELETE CASCADE,
        qbo_customer_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'available',
        total NUMERIC(18,2),
        line_count INTEGER NOT NULL DEFAULT 0,
        project_name TEXT,
        fully_qualified_name TEXT,
        breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
        lines JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT qbo_profitability_drillthrough_snapshot_customer_key UNIQUE (snapshot_id, qbo_customer_id)
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_qbo_profitability_drillthrough_snapshot
      ON qbo_profitability_drillthrough_projects(snapshot_id)
    `);
    return true;
  } catch (error) {
    if (!isPermissionDeniedError(error)) {
      throw error;
    }

    // Constrained production roles may not have CREATE on schema public.
    // If the table already exists, continue with writes; otherwise skip drill-through persistence.
    try {
      await prisma.$queryRawUnsafe('SELECT 1 FROM qbo_profitability_drillthrough_projects LIMIT 1');
      return true;
    } catch {
      console.warn('Skipping QBO drill-through persistence: database role cannot create/access qbo_profitability_drillthrough_projects.');
      return false;
    }
  }
}

async function persistQboDrillthrough(prisma, snapshotId, qboCostDrillthrough) {
  const projects = Array.isArray(qboCostDrillthrough?.projects) ? qboCostDrillthrough.projects : [];
  if (!projects.length) return 0;

  const drillthroughReady = await ensureQboDrillthroughTable(prisma);
  if (!drillthroughReady) return 0;

  let savedCount = 0;
  for (const project of projects) {
    const qboCustomerId = String(project?.qboCustomerId || project?.qboCostDrillthroughKey || '').trim();
    if (!qboCustomerId) continue;

    const status = String(project?.status || 'available').trim() || 'available';
    const lineCount = Number.isFinite(Number(project?.lineCount)) ? Number(project.lineCount) : 0;
    const total = project?.total == null || project.total === '' ? null : Number(project.total);
    const breakdown = Array.isArray(project?.breakdown) ? project.breakdown : [];
    const lines = Array.isArray(project?.lines) ? project.lines : [];

    try {
      await prisma.$executeRawUnsafe(
        `
          INSERT INTO qbo_profitability_drillthrough_projects (
            snapshot_id,
            qbo_customer_id,
            status,
            total,
            line_count,
            project_name,
            fully_qualified_name,
            breakdown,
            lines,
            updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, now()
          )
          ON CONFLICT (snapshot_id, qbo_customer_id)
          DO UPDATE SET
            status = EXCLUDED.status,
            total = EXCLUDED.total,
            line_count = EXCLUDED.line_count,
            project_name = EXCLUDED.project_name,
            fully_qualified_name = EXCLUDED.fully_qualified_name,
            breakdown = EXCLUDED.breakdown,
            lines = EXCLUDED.lines,
            updated_at = now()
        `,
        snapshotId,
        qboCustomerId,
        status,
        Number.isFinite(total) ? total : null,
        Math.max(0, Math.trunc(lineCount)),
        project?.projectName == null ? null : String(project.projectName),
        project?.fullyQualifiedName == null ? null : String(project.fullyQualifiedName),
        JSON.stringify(breakdown),
        JSON.stringify(lines),
      );
    } catch (error) {
      if (!isPermissionDeniedError(error)) {
        throw error;
      }
      console.warn(`Skipping QBO drill-through upsert for customer ${qboCustomerId}: insufficient database permissions.`);
      return savedCount;
    }
    savedCount += 1;
  }

  return savedCount;
}

async function findLatestExport() {
  const reportDirectory = path.resolve(root, '..', 'QBO_1', 'reports');
  const candidates = (await readdir(reportDirectory))
    .filter((name) => /^project-profitability-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.json$/.test(name));
  if (!candidates.length) {
    throw new Error(`No QBO profitability export was found in ${reportDirectory}.`);
  }
  const withStats = await Promise.all(candidates.map(async (name) => ({
    path: path.join(reportDirectory, name),
    modifiedAt: (await stat(path.join(reportDirectory, name))).mtimeMs,
  })));
  withStats.sort((a, b) => b.modifiedAt - a.modifiedAt);
  return withStats[0].path;
}

async function main() {
  const explicitFile = parseFileArgument();
  const filePath = explicitFile ? path.resolve(process.cwd(), explicitFile) : await findLatestExport();
  const fileStats = await stat(filePath);
  if (fileStats.size > 50 * 1024 * 1024) {
    throw new Error('The profitability export exceeds the 50 MB import limit.');
  }
  const raw = await readFile(filePath, 'utf8');
  const sourceHash = hashQboProfitabilitySource(raw);
  const payload = normalizeQboProfitabilityPayload(JSON.parse(raw));
  const embeddedDrillthroughProjects = buildEmbeddedDrillthroughProjects(payload.qboCostDrillthrough);
  const prisma = new PrismaClient();

  try {
    const existing = await prisma.qboProfitabilitySnapshot.findUnique({
      where: { sourceHash },
      select: { id: true, importedAt: true, summary: true },
    });
    if (existing) {
      if (embeddedDrillthroughProjects) {
        await prisma.qboProfitabilitySnapshot.update({
          where: { id: existing.id },
          data: {
            summary: mergeSnapshotSummary(existing.summary, embeddedDrillthroughProjects),
          },
        });
      }

      const existingDrillthroughCount = await persistQboDrillthrough(prisma, existing.id, payload.qboCostDrillthrough);
      console.log(`This read-only snapshot was already imported at ${existing.importedAt.toISOString()}.`);
      if (existingDrillthroughCount > 0) {
        console.log(`Updated ${existingDrillthroughCount} QBO drill-through project records for snapshot ${existing.id}.`);
      } else if (embeddedDrillthroughProjects) {
        console.log('Stored QBO drill-through details in snapshot summary fallback.');
      }
      return;
    }

    const snapshot = await prisma.qboProfitabilitySnapshot.create({
      data: {
        sourceHash,
        sourceGeneratedAt: payload.generatedAt,
        startDate: payload.startDate,
        endDate: payload.endDate,
        accountingMethod: payload.accountingMethod,
        readOnly: true,
        summary: mergeSnapshotSummary(payload.summary, embeddedDrillthroughProjects),
        sourceCounts: payload.sourceCounts,
        rows: { create: payload.rows },
      },
      select: { id: true, importedAt: true, _count: { select: { rows: true } } },
    });

    const drillthroughSaved = await persistQboDrillthrough(prisma, snapshot.id, payload.qboCostDrillthrough);

    console.log(`Imported ${snapshot._count.rows} normalized profitability rows.`);
    if (drillthroughSaved > 0) {
      console.log(`Imported QBO drill-through details for ${drillthroughSaved} projects.`);
    } else if (embeddedDrillthroughProjects) {
      console.log('Stored QBO drill-through details in snapshot summary fallback.');
    }
    console.log(`Snapshot ID: ${snapshot.id}`);
    console.log(`Imported at: ${snapshot.importedAt.toISOString()}`);
    console.log('QuickBooks and Procore business records were not changed.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`QBO profitability import failed: ${error.message}`);
  process.exitCode = 1;
});
