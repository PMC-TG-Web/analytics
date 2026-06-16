import { NextRequest, NextResponse } from 'next/server';
import { comparePmcProjectsToLegacy, PMC_COMPANY_ID } from '@/lib/pmcProjects';

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const companyId = String(req.nextUrl.searchParams.get('companyId') || PMC_COMPANY_ID).trim();

  try {
    const comparison = await comparePmcProjectsToLegacy(companyId);
    return NextResponse.json({ ok: true, ...comparison });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('PMC project comparison failed:', error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
