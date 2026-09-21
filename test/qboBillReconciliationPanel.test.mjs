import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
const js = ts.transpileModule(fs.readFileSync('src/app/accounting/direct-cost-bills/BillReconciliation.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function render(opened, changed) {
 const states = [opened, false, { manuallyChanged: changed, billNumber: 'Example 001', current: { rows: [], total: 0, note: '' }, proposed: { rows: [], total: 0, note: 'New catalog note' } }, '', false];
 const mod = { exports: {} }; let index = 0;
 vm.runInNewContext(js, { exports: mod.exports, require: id => id === 'react' ? { useState: () => [states[index++], () => {}] } : jsx });
 return renderToStaticMarkup(jsx.jsx(mod.exports.default, { companyId: '1', projectId: '2', month: '2026-09', disabled: false, onBusy() {}, async onComplete() {} }));
}
test('opening an existing bill starts with a neutral check action', () => {
 const html = render(false, false); assert.match(html, /Check QBO bill/); assert.doesNotMatch(html, /Reconciliation needed|Confirm reconciliation/);
});
test('unchanged QBO bills show no reconciliation needed and no confirmation', () => {
 const html = render(true, false); assert.match(html, /No reconciliation needed/); assert.doesNotMatch(html, /Confirm reconciliation|type="checkbox"/);
});
test('changed QBO bills explain the conflict and offer explicit confirmation', () => {
 const html = render(true, true); assert.match(html, /Reconciliation needed/); assert.match(html, /QBO reports that this bill changed/); assert.match(html, /Confirm reconciliation/); assert.match(html, /type="checkbox"/);
});
