import { NextRequest, NextResponse } from 'next/server';
import { getRequestUserEmail } from '@/lib/requestUser';
import { validateCsrfRequest } from '@/lib/csrfProtection';
import { saveQboBillLineRule } from '@/lib/saveQboBillLineRule';
export const dynamic='force-dynamic';
export async function POST(request:NextRequest) {
 const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
 if(!validateCsrfRequest({method:request.method,requestUrl:request.url,origin:request.headers.get('origin'),referer:request.headers.get('referer')}).allowed) return json({error:'A same-origin request is required.'},403);
 const actor=await getRequestUserEmail(request);if(!actor) return json({error:'Sign in before changing project line settings.'},401);
 try {const raw=await request.text();if(raw.length>3000) return json({error:'Invalid request.'},400);const input=JSON.parse(raw);if(input?.companyId!==process.env.PROCORE_COMPANY_ID) return json({error:'Invalid company.'},400);return json(await saveQboBillLineRule(input,actor));}
 catch(e){return json({error:e instanceof Error?e.message:'Unable to save the project setting.'},409);}
}
