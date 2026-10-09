import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

test('individual bill update runs automatic screed setup through the durable worker', {skip:process.env.QBO_BATCH_BROWSER_TEST!=='1',timeout:90_000}, async()=>{
 const require=createRequire(import.meta.url);
 const esbuild=require(process.env.QBO_BATCH_TEST_ESBUILD||path.join(process.env.APPDATA,'npm/node_modules/netlify-cli/node_modules/esbuild/lib/main.js'));
 const entry=`import React from 'react';import{createRoot}from'react-dom/client';import Page from ${JSON.stringify(path.resolve('src/app/accounting/direct-cost-bills/page.tsx'))};createRoot(document.getElementById('root')).render(<Page/>);`;
 const built=await esbuild.build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},write:false,bundle:true,platform:'browser',format:'iife',jsx:'automatic',alias:{'@':path.resolve('src')},define:{'process.env.NODE_ENV':'"test"'}});
 const server=http.createServer((req,res)=>{res.setHeader('content-type',req.url==='/bundle.js'?'application/javascript':'text/html');res.end(req.url==='/bundle.js'?built.outputFiles[0].text:'<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;let browser;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();const posts=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
  let blocked=false;
  const issue='QBO product mapping for Somero SRS4 (boom screed) needs the .LS suffix. Run Set up products to refresh the assignment.';
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();
   if(!url.pathname.startsWith('/api/'))return route.continue();
   if(url.pathname.endsWith('/batch')){
    if(route.request().method()==='POST'){posts.push(route.request().postDataJSON());return route.fulfill({status:202,json:{month:'2026-06',message:'Monthly update started.'}});}
    return route.fulfill({json:{enabled:true,run:null,activeMonth:null,projects:[{procoreProjectId:'10',projectName:'Example'}],maxProjects:100}});
   }
   if(url.pathname.endsWith('/sync'))return route.fulfill({json:{status:'waiting'}});
   if(url.searchParams.get('view')==='queue')return route.fulfill({json:{generatedAt:new Date().toISOString(),totalProjects:1,nextCursor:null,rows:[{projectId:'10',projectName:'Example',projectNumber:'2601',status:'update',setupRequired:true,billNumber:'Example 001',gross:'100',previousGross:100,laborHours:'0',itemCount:1,lastPosted:null,reasons:[]}]}});
   if(!url.searchParams.has('projectId'))return route.fulfill({json:{companyId:'1'}});
   return route.fulfill({json:{companyId:'1',projectId:'10',projectName:'Example',projectNumber:'2601',month:'2026-06',vendorName:'Example',total:'100',issues:blocked?['Invalid Procore assignment']:[],ruleItems:[],catalogMappingItems:[],food:{saved:null,entries:[],logCount:0},labor:{rows:[],combinedHours:'0',combinedPricedHours:'0',combinedUnpricedHours:'0'},excluded:{},lines:[{lineKey:'screed',sourceType:'productivity',description:'Somero SRS4',quantity:'1',unitCost:'100',amount:'100',uom:'ea',costCode:'03-300-20-30',costType:'Equipment',sourceLogs:[]}],review:{connected:true,billId:'20',billNumber:'Example 001',action:'update',canPost:false,fingerprint:null,issues:[issue],products:{screed:'2601-03-300-20-30.E'},offsets:null,qboPrices:{}}}});
  });
  await page.goto(origin);await page.getByLabel('Month',{exact:true}).fill('2026-06');
  await page.getByRole('button',{name:'Review Example',exact:true}).click();
  const update=page.getByRole('button',{name:'Update bill in QBO',exact:true});
  await update.waitFor();assert.equal(await update.isDisabled(),false);
  assert.equal(await page.getByRole('alert').count(),0);
  await update.click();await page.getByText('Monthly update started.',{exact:true}).waitFor();
  assert.equal(posts.length,1);assert.deepEqual(posts[0].projectIds,['10']);assert.equal(posts[0].month,'2026-06');assert.equal(posts[0].companyId,'1');assert.match(posts[0].requestKey,/^[a-f0-9-]{36}$/);
  blocked=true;await page.reload();await page.getByLabel('Month',{exact:true}).fill('2026-06');await page.getByRole('button',{name:'Review Example',exact:true}).click();await update.waitFor();assert.equal(await update.isDisabled(),true);assert.deepEqual(errors,[]);
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
