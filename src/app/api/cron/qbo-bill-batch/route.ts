import { NextRequest, NextResponse } from 'next/server';
import { runQboBillBatchTick } from '@/lib/runQboBillBatch';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  const secret = process.env.PROCORE_SYNC_SECRET || process.env.SYNC_SECRET;
  if (!secret || request.headers.get('x-sync-secret') !== secret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { return NextResponse.json(await runQboBillBatchTick(), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return NextResponse.json({ error: 'Batch step interrupted. Saved progress will be checked before resuming.' }, { status: 503 }); }
}
