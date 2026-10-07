import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { calculateWinRate, combineWinRateSources, parseWinRateBaseline, KPI_CURRENT_COMPANY, KPI_WIN_RATE_BASELINE_KEY, KPI_WIN_RATE_POLICY_KEY, type WinRatePolicy } from '@/lib/kpiWinRate';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const rawYear = request.nextUrl.searchParams.get('year');
  const year = rawYear ? Number(rawYear) : null;
  if (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2200)) {
    return NextResponse.json({ success: false, error: 'Invalid year.' }, { status: 400 });
  }
  try {
    const [bids, settings, savedHistory, syncStates] = await Promise.all([
      prisma.pmcBidBoardProject.findMany({ where: { companyId: KPI_CURRENT_COMPANY }, select: { companyId: true, bidBoardId: true, projectName: true, status: true, payload: true } }),
      prisma.estimatingConstant.findUnique({ where: { name: KPI_WIN_RATE_POLICY_KEY } }),
      prisma.estimatingConstant.findUnique({ where: { name: KPI_WIN_RATE_BASELINE_KEY } }),
      prisma.procoreSyncProjectState.findMany({ where: { companyId: KPI_CURRENT_COMPANY, dataset: 'nightly_bid_board_headers', projectId: '__company_bid_board__' }, select: { projectId: true, lastSuccessAt: true } }),
    ]);
    if (!settings || !savedHistory) {
      return NextResponse.json({ success: false, error: 'Win rate is waiting for saved history and the approved project grouping.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
    const policy = JSON.parse(settings.value) as WinRatePolicy;
    const baseline = parseWinRateBaseline(savedHistory.value);
    const data = calculateWinRate(combineWinRateSources(bids, baseline), policy, year);
    return NextResponse.json({ success: true, data, syncStates, baselineSavedAt: baseline.savedAt }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[KPI win rate] Database read failed', error instanceof Error ? error.name : 'Unknown error');
    return NextResponse.json({ success: false, error: 'Could not load win rate. Please retry.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
