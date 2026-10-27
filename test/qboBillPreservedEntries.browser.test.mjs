import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import {chromium} from 'playwright-core';

test('bill review shows retained QBO entry instead of the differing Procore quantity', {skip:process.env.QBO_BATCH_BROWSER_TEST!=='1',timeout:90_000},async()=>{
 const require=createRequire(import.meta.url);
 const esbuild=require(process.env.QBO_BATCH_TEST_ESBUILD||path.join(process.env.APPDATA,'npm/node_modules/netlify-cli/node_modules/esbuild/lib/main.js'));
 const entry=`import React from 'react';import{createRoot}from'react-dom/client';import Page from ${JSON.stringify(path.resolve('src/app/accounting/direct-cost-bills/page.tsx'))};createRoot(document.getElementById('root')).render(<Page/>);`;
 const built=await esbuild.build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},write:false,bundle:true,platform:'browser',format:'iife',jsx:'automatic',alias:{'@':path.resolve('src')},define:{'process.env.NODE_ENV':'"test"'}});
 const server=http.createServer((req,res)=>{res.setHeader('content-type',req.url==='/bundle.js'?'application/javascript':'text/html');res.end(req.url==='/bundle.js'?built.outputFiles[0].text:'<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;let browser;
 try {
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();const errors=[],writes=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();
   if(!url.pathname.startsWith('/api/'))return route.continue();
   if(route.request().method()!=='GET'){writes.push(url.pathname);return route.fulfill({json:{status:'waiting'}});}
   if(url.pathname.endsWith('/batch'))return route.fulfill({json:{enabled:true,run:null,activeMonth:null,projects:[],maxProjects:100}});
   if(url.searchParams.get('view')==='queue')return route.fulfill({json:{generatedAt:new Date().toISOString(),totalProjects:1,nextCursor:null,rows:[{projectId:'10',projectName:'Example',projectNumber:'2601',status:'update',billNumber:'Example 001',gross:'0',previousGross:100,laborHours:'0',itemCount:1,reasons:[]}]}});
   if(!url.searchParams.has('projectId'))return route.fulfill({json:{companyId:'1'}});
   return route.fulfill({json:{companyId:'1',projectId:'10',projectName:'Example',projectNumber:'2601',month:'2026-10',vendorName:'Example',total:'0',issues:[],ruleItems:[],catalogMappingItems:[],food:{saved:null,entries:[],logCount:0},labor:{rows:[],combinedHours:'0',combinedPricedHours:'0',combinedUnpricedHours:'0'},excluded:{},lines:[{lineKey:'screed',sourceType:'productivity',description:'Somero SRS4',quantity:'10',unitCost:'100',amount:'1000',uom:'hr',costCode:'03-300-20-30',costType:'Equipment',sourceLogs:[]}],review:{connected:true,billId:'20',billNumber:'Example 001',action:'update',canPost:false,fingerprint:null,issues:[],products:{screed:'2601-03-300-20-30.LS'},offsets:null,qboPrices:{},itemGroups:[],qboEntryPreservedKeys:['screed'],preservedEntries:[{id:'7',description:'QBO manual screed charge',quantity:'3',unitCost:'200',amount:'600',product:'QBO product',className:'Screeding:SRS4',kind:'item'},{id:'8',description:'QBO offset',quantity:null,unitCost:null,amount:'-600',product:'Direct Costs -',className:'Screeding:SRS4',kind:'offset'}]}}});
  });
  await page.goto(origin);await page.getByRole('button',{name:'Review Example',exact:true}).click();
  await page.getByRole('heading',{name:'Kept as entered in QBO',exact:true}).waitFor();
  const retained=page.getByRole('heading',{name:'Kept as entered in QBO',exact:true}).locator('xpath=../..');
  const row=retained.getByRole('row').filter({hasText:'QBO manual screed charge'});
  assert.equal(await row.getByRole('cell').nth(2).innerText(),'3');assert.equal(await row.getByRole('cell').nth(3).innerText(),'$200.00');assert.equal(await row.getByRole('cell').nth(4).innerText(),'$600.00');
  const automatic=page.getByRole('heading',{name:'Item details',exact:true}).locator('xpath=../..');
  assert.equal(await automatic.locator('tbody tr').count(),0,'Procore quantity must not appear as an automatic replacement');
  assert.deepEqual(errors,[]);assert.equal(writes.filter(url=>!url.endsWith('/sync')).length,0,'Opening a review cannot save bills');
 } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
