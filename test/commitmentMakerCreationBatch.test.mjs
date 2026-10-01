import assert from 'node:assert/strict';
import test from 'node:test';
import { commitmentMakerCreationBatch, CommitmentMakerBatchPending } from '../src/lib/commitmentMakerCreationBatch.ts';
import { readFileSync } from 'node:fs';
test('creation yields between operations after fifteen seconds', () => {
 let now = 0;
 const check = commitmentMakerCreationBatch(true, () => now);
 check(); now = 14999; check(); now = 15000;
 assert.throws(check, CommitmentMakerBatchPending);
 const legacy = commitmentMakerCreationBatch(false, () => now);
 now += 60000; legacy();
});
test('route checkpoints accepted lines and completed POs before advertising continuation', () => {
 const route = readFileSync('src/app/api/procore/commitments-live/maker/route.ts', 'utf8');
 assert.match(route, /checkpoint.ownedLineItems = \[...ownedLineItems\]/);
 assert.match(route, /checkpoint.completedResult = result/);
 assert.match(route, /results.push\(completed\);[\s\S]*?continue;/);
 assert.match(route, /failure.continuing === true\) && failure.outcomeUnknown !== true \? "retryable"/);
 assert.match(route, /for \(const line of missingLines\) \{\s+checkCreationBatch\(\)/);
});


test('the actual creation loop resumes a multi-PO import without duplicate writes', async () => {
 const ts = (await import('typescript')).default;
 const { commitmentMakerLineCreatePayload } = await import('../src/lib/procore/commitmentMaker.ts');
 const route = readFileSync('src/app/api/procore/commitments-live/maker/route.ts', 'utf8');
 const block = route.slice(route.indexOf('  const checkCreationBatch ='), route.indexOf('  let taskError =', route.indexOf('  const checkCreationBatch =')));
 const js = ts.transpileModule('async function run(){' + block + ';return {results,failure,estimateTargets};}', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
 const contracts = [], storedLines = new Map();
 let clock = 0, saved = [], postCount = 0, nextId = 0;
 const groups = ['A', 'B'].map(name => ({ name, fingerprint: name, number: '', existingContractId: '', action: 'create',
  lineItems: Array.from({length: 18}, (_, i) => ({ description: name + i, costCode: '03-300-20-10', costType: 'L', wbsCodeId: 'wbs', quantity: 1, unitCost: 0, subtotalOverride: null, uom: 'hours' })) }));
 const dependencies = {
  usePrimaryEstimate: true, companyId: 'company', projectId: 'project', importFingerprint: 'same', estimateCombinations: [],
  sourceChangeOrder: null, changeOrderClaim: null, accessToken: 'test', target: 'new_purchase_order', userEmail: 'test', effectiveFileName: 'estimate', selectedSheetName: 'estimate', sourceEstimate: {},
  COMMITMENT_MAKER_VENDOR_NAME: 'Vendor',
  commitmentMakerCreationBatch: enabled => commitmentMakerCreationBatch(enabled, () => clock), CommitmentMakerBatchPending,
  CommitmentMakerRateLimitError: class extends Error {}, ProcoreMutationOutcomeUnknownError: class extends Error {},
  claimPrimaryEstimateImport: async () => ({}), savePrimaryEstimateImport: async (_, targets) => { saved = structuredClone(targets); },
  findExistingByFingerprint: () => null, purchaseOrderCommitments: records => records,
  planNextPurchaseOrderNumbers: numbers => [String(numbers.length + 1)], originDataFor: x => x,
  readId: x => String(x.id || ''), readText: x => String(x || ''), unwrapData: x => x,
  procoreJson: async ({ method, path, body }) => {
   clock += 1000;
   if (method === 'POST' && !path.endsWith('line_items')) {
    const po = { ...body, id: 'po' + ++nextId }; contracts.push(po); storedLines.set(po.id, []);
    return { ok: true, payload: po };
   }
   const id = path.split('/commitment_contracts/')[1].split('/')[0];
   if (method === 'POST') { postCount++; const line = { ...body, id: 'line' + ++nextId }; storedLines.get(id).push(line); return { ok: true, payload: line }; }
   contracts.find(po => po.id === id).status = 'Approved'; return { ok: true, payload: {} };
  },
  fetchContractLineItems: async ({ contractId }) => { clock += 1000; return storedLines.get(contractId); },
  auditedCommitmentLinesById: owned => owned,
  commitmentLineMatches: (line, actual) => line.description === actual.description,
  commitmentLineMatchesPayload: (payload, actual) => payload.description === actual.description,
  commitmentLinePayloadMatchesPlanned: (payload, line) => payload.description === line.description,
  commitmentMakerLineCreatePayload, writeAudit: async () => true,
 };
 let result, rounds = 0;
 do {
  const state = { targets: structuredClone(saved), status: 'retryable' };
  const plan = { vendor: { id: 'vendor' }, groups: groups.map(group => ({ ...group,
   existingContractId: saved.find(t => t.name === group.name)?.id || '', number: saved.find(t => t.name === group.name)?.number || '' })) };
  const deps = { ...dependencies, plan, estimateImportState: state, liveCommitments: structuredClone(contracts) };
  result = await new Function(...Object.keys(deps), js + ';return run();')(...Object.values(deps));
  if (result.failure) assert.equal(result.failure.continuing, true);
  rounds++;
 } while (result.failure && rounds < 20);
 assert.ok(rounds > 1 && rounds < 20);
 assert.equal(result.failure, null);
 assert.equal(contracts.length, 2);
 assert.equal(postCount, 36);
 assert.equal(saved.filter(t => t.completedResult?.success).length, 2);
 assert.equal(result.results.length, 2);
});
