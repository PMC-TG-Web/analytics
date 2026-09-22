import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const js=ts.transpileModule(fs.readFileSync('src/app/accounting/direct-cost-bills/CatalogMappingPanel.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const mod={exports:{}};const imports={'react':React,'react/jsx-runtime':jsx};vm.runInNewContext(js,{exports:mod.exports,require:id=>imports[id]});
test('pricing confirmation displays the reason beside the item and distinguishes QBO setup',()=>{
 const html=renderToStaticMarkup(jsx.jsx(mod.exports.default,{companyId:'1',projectId:'2',items:[{lineItemId:'3',description:'Chairs',costCode:'03-200-30-20',uom:'ea',issue:'Chairs: Catalog cost code differs from the PO.',catalogName:null,manual:false}],disabled:false,onBusy(){},onComplete(){}}));
 assert.match(html,/Confirm pricing source/); assert.match(html,/Catalog cost code differs from the PO/); assert.match(html,/QBO product setup is handled separately/); assert.doesNotMatch(html,/Choose catalog item|Cost Catalog mappings/);
});