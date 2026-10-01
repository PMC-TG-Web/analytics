import { prisma } from './prisma';
import { Prisma } from '@prisma/client';
import { loadQboDirectCosts } from './loadQboDirectCosts';
export async function saveQboBillLineRule(input: {companyId:string;projectId:string;month:string;lineKey:string;sourceSignature:string;revision:number;ignored:boolean;unitCost:string|null;reason:string}, actor:string) {
 if (![input.companyId,input.projectId].every(id=>/^\d+$/.test(id)) || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(input.month) || !Number.isInteger(input.revision) || input.revision<0 || typeof input.ignored!=='boolean' || typeof input.reason!=='string' || input.reason.length>500 || !actor?.trim()) throw new Error('Invalid project line setting.');
 if (input.unitCost!==null && (typeof input.unitCost!=='string' || !/^\d{1,10}(\.\d{1,8})?$/.test(input.unitCost) || Number(input.unitCost)<=0)) throw new Error('Enter a positive unit price or leave it blank for catalog pricing.');
 if ((input.ignored || input.unitCost!==null) && !input.reason.trim()) throw new Error('Enter a reason for this project setting.');
 const draft=await loadQboDirectCosts(input.companyId,input.projectId,input.month);
 const candidates=draft.ruleItems.filter(item=>item.lineKey===input.lineKey);
 const source=candidates[0];
 if(candidates.length!==1 || source.sourceSignature!==input.sourceSignature || source.revision!==input.revision) throw new Error('This line or its setting changed. Reopen the project review.');
 if(input.unitCost!==null && !source.allowPrice) throw new Error('Project price overrides are available for purchase lines only.');
 const key={companyId:input.companyId,projectId:input.projectId,lineKey:input.lineKey};
 const data={description:source.description,sourceSignature:source.sourceSignature,ignored:input.ignored,unitCost:input.unitCost===null?null:new Prisma.Decimal(input.unitCost),reason:input.reason.trim(),updatedBy:actor};
 try { await prisma.$transaction(async tx=>{
   if(input.revision===0) await tx.qboBillLineRule.create({data:{...key,...data}});
   else {const result=await tx.qboBillLineRule.updateMany({where:{...key,revision:input.revision},data:{...data,revision:{increment:1}}});if(result.count!==1) throw new Error('Another operator changed this setting. Reopen the review.');}
   await tx.qboBillLineRuleRevision.create({data:{...key,revision:input.revision+1,rule:{...data,unitCost:input.unitCost}}});
 }); } catch(e) { if((e as {code?:string}).code==='P2002') throw new Error('Another operator saved this setting. Reopen the review.');throw e; }
 return {saved:true};
}
