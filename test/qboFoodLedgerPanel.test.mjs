import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import * as food from '../src/lib/qboFoodTotal.ts';
const js=ts.transpileModule(fs.readFileSync('src/app/accounting/direct-cost-bills/FoodTotalInput.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const mod={exports:{}};const imports={'react':React,'react/jsx-runtime':jsx,'@/lib/qboFoodTotal':food};vm.runInNewContext(js,{exports:mod.exports,require:id=>imports[id]});
test('Food ledger shows prior expenses and cumulative total with a blank new-expense input',()=>{
 const html=renderToStaticMarkup(jsx.jsx(mod.exports.default,{companyId:'1',projectId:'2',month:'2026-09',saved:{amount:'95.86',revision:2},entries:[{id:'1',spentOn:'2026-09-10',note:'Lunch',amount:'85.86'},{id:'2',spentOn:'2026-09-22',note:'Coffee',amount:'10.00'}],logCount:1,disabled:false,onBusy(){},onComplete(){}}));
 assert.match(html,/Add Food expense/);assert.match(html,/New Food expense/);assert.match(html,/Running total/);assert.match(html,/Lunch/);assert.match(html,/Coffee/);assert.match(html,/\$95\.86/);assert.match(html,/\$85\.86/);assert.doesNotMatch(html,/value="95\.86"/);assert.doesNotMatch(html,/Save Food total/);
});
