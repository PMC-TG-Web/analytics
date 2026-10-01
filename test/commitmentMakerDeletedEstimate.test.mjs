import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const module = { exports: {} };
new Function('require', 'module', 'exports', ts.transpileModule(readFileSync('src/lib/procoreCommitmentMakerEstimateImport.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(id => {
 if (id === 'node:crypto') return {};
 if (id === '@/lib/prisma') return { prisma: {} };
 if (id === '@/lib/procore/commitmentMakerEstimate') return { PrimaryEstimateError: Error, estimateRecord: value => value && typeof value === 'object' ? value : {} };
 throw new Error(id);
}, module, module.exports);
const { verifyDeletedEstimateTargets, primaryEstimateImportBlock } = module.exports;
const state = { status: 'completed', fingerprint: 'original', combinations: [], targets: [{ id: '123', name: 'Combined', number: 'PO-002' }] };
test('completed imports unlock only after list absence and exact NOT_FOUND for every PO', async () => {
 let details = 0;
 const checks = { listIds: async () => [], isNotFound: async () => { details++; return true; } };
 assert.equal(await verifyDeletedEstimateTargets(state, checks), true);
 assert.equal(details, 1);
 assert.equal(await verifyDeletedEstimateTargets(state, { ...checks, listIds: async () => ['123'] }), false);
 assert.equal(details, 1);
 assert.equal(await verifyDeletedEstimateTargets(state, { ...checks, isNotFound: async () => false }), false);
 await assert.rejects(verifyDeletedEstimateTargets(state, { ...checks, listIds: async () => { throw new Error('403'); } }), /403/);
 assert.equal(await verifyDeletedEstimateTargets({ ...state, targets: [...state.targets, { id: '456' }] }, { ...checks, isNotFound: async id => id === '123' }), false);
 for (const status of ['running', 'retryable', 'uncertain']) assert.equal(await verifyDeletedEstimateTargets({ ...state, status }, checks), false);
 assert.equal(await verifyDeletedEstimateTargets({ ...state, targets: [] }, checks), false);
 assert.equal(await verifyDeletedEstimateTargets({ ...state, fingerprint: 'legacy-workbook' }, checks), false);
 assert.equal(primaryEstimateImportBlock({ ...state, status: 'deleted' }, 'changed'), null);
 assert.match(primaryEstimateImportBlock(state, 'original'), /into PO-002/);
 assert.doesNotMatch(primaryEstimateImportBlock(state, 'original'), /PO PO/);
});
test('a released import is rechecked so restored POs still block recreation', async () => {
 assert.equal(await verifyDeletedEstimateTargets({ ...state, status: 'deleted' }, { listIds: async () => ['123'], isNotFound: async () => true }), false);
});


test('historical change-order audits never block a base-estimate import', () => {
 const { isBaseEstimateAudit } = module.exports;
 assert.equal(isBaseEstimateAudit({ sheetName: 'Approved Change Order', fileName: 'Procore CO 001', success: true }), false);
 assert.equal(isBaseEstimateAudit({ sourceChangeOrder: { packageId: '123' } }), false);
 assert.equal(isBaseEstimateAudit({ sourceType: 'approved_change_order' }), false);
 assert.equal(isBaseEstimateAudit({ sheetName: 'Estimate', group: 'Slabs' }), true);
 assert.equal(isBaseEstimateAudit({ sheetName: 'Primary Estimate', sourceEstimate: { proposalId: '123' } }), true);
 assert.equal(isBaseEstimateAudit({ group: 'CO named workbook group' }), true);
});
