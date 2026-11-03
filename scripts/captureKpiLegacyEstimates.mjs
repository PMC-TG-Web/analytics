// Explicit one-time read, never a scheduled worker or connection fallback.
// Writes local evidence only. The shared app is selected only by --connection
// shared, matching the owner's verified cloner connection for the old instance.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import dotenv from 'dotenv';
import { parseLegacyEstimateLedger } from '../src/lib/kpiLegacyEstimateLedger.ts';
import { KPI_OLD_COMPANY } from '../src/lib/kpiWinRate.ts';

dotenv.config({ path: ['.env.local', '.env'], quiet: true });
const args = process.argv.slice(2);
const arg = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
if (!args.includes('--read-live') || arg('--connection') !== 'shared' || arg('--company') !== KPI_OLD_COMPANY || !arg('--ledger') || !arg('--out-dir')) {
  throw new Error('Usage: node scripts/captureKpiLegacyEstimates.mjs --read-live --connection shared --company <old-company-id> --ledger <reviewed-ledger-json> --out-dir <local-directory> [--limit <count>] [--retry-unavailable]');
}
const ledger = parseLegacyEstimateLedger(JSON.parse(fs.readFileSync(arg('--ledger'), 'utf8')));
const outDir = path.resolve(arg('--out-dir'));
fs.mkdirSync(outDir, { recursive: true });
const limit = arg('--limit') == null ? ledger.records.length : Number(arg('--limit'));
if (!Number.isInteger(limit) || limit < 1 || limit > ledger.records.length) throw new Error('Invalid capture limit.');
// This opt-in applies to this standalone process only, never .env or the app.
// makeRequest still enforces company headers, request leases and quota reserves.
process.env.PROCORE_LIVE_API_ENABLED = 'true';
if (process.env.DIRECT_DATABASE_URL) process.env.DATABASE_URL = process.env.DIRECT_DATABASE_URL;
const require = createRequire(import.meta.url);
const esbuild = require(process.env.KPI_CAPTURE_ESBUILD || path.join(process.env.APPDATA, 'npm/node_modules/netlify-cli/node_modules/esbuild/lib/main.js'));
const bundle = path.join(outDir, 'capture-runtime.cjs');
await esbuild.build({ stdin: { contents: `import {getClientCredentialsToken,makeRequest} from './src/lib/procore';import {withProcoreConnection} from './src/lib/procoreConnection';import {prisma} from './src/lib/prisma';import {captureLegacyPrimaryEstimate} from './src/lib/procoreLegacyEstimateCapture';export async function capture(id){return withProcoreConnection('shared',async()=>{const token=await getClientCredentialsToken();return captureLegacyPrimaryEstimate(id,p=>makeRequest(p,token,{method:'GET'},'${KPI_OLD_COMPANY}',[403,404]));});}export async function close(){await prisma.$disconnect();}`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', packages: 'external', outfile: bundle, logLevel: 'silent' });
const runtime = require(bundle);
const unavailable = new Set();
const failureFile = path.join(outDir, 'failures.jsonl');
if (!args.includes('--retry-unavailable') && fs.existsSync(failureFile)) {
  for (const text of fs.readFileSync(failureFile, 'utf8').split('\n').filter(Boolean)) {
    const row = JSON.parse(text);
    if (row.status === null && /^(Primary estimate has no saved line items|Old bid does not have one uniquely primary estimate)/.test(row.error)) unavailable.add(row.bidBoardId);
  }
}
let captured = 0, existing = 0, failed = 0, skippedUnavailable = 0;
try {
  for (const { snapshot } of ledger.records.slice(0, limit)) {
    const file = path.join(outDir, `${snapshot.bidBoardId}.json`);
    if (fs.existsSync(file)) { existing++; continue; }
    if (unavailable.has(snapshot.bidBoardId)) { skippedUnavailable++; continue; }
    try {
      const evidence = await runtime.capture(snapshot.bidBoardId);
      fs.writeFileSync(file, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
      captured++;
      console.log(JSON.stringify({ captured, existing, failed, bidBoardId: snapshot.bidBoardId, hours: evidence.hours, sales: evidence.sales, lineItems: evidence.lineItemCount }));
    } catch (error) {
      failed++;
      const status = Number(error.status || error.statusCode) || null;
      const failure = { bidBoardId: snapshot.bidBoardId, status, error: String(error.message || 'Capture failed').slice(0, 240) };
      fs.appendFileSync(path.join(outDir, 'failures.jsonl'), JSON.stringify(failure) + '\n');
      console.log(JSON.stringify(failure));
      // Provider access/quota failures require a later manual retry, not a burst
      // through another connection. Previously complete files remain intact.
      if (status === 401 || status === 403 || status === 429) { process.exitCode = 2; break; }
    }
  }
  const evidence = ledger.records.flatMap(({ snapshot }) => {
    const file = path.join(outDir, `${snapshot.bidBoardId}.json`);
    return fs.existsSync(file) ? [JSON.parse(fs.readFileSync(file, 'utf8'))] : [];
  });
  // Derived index; individual immutable evidence files are retained on resume.
  fs.writeFileSync(path.join(outDir, 'estimates.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ mode: 'read-only-capture', captured, existing, failed, skippedUnavailable, completeEvidence: evidence.length, records: ledger.records.length }));
} finally { await runtime.close(); }
