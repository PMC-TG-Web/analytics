import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  console.log('[HEALTH] Health check ping');
  return NextResponse.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log('[HEALTH] Echo test:', body);
    return NextResponse.json({ 
      status: 'ok',
      echoed: body,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return NextResponse.json({ 
      status: 'error',
      message: (error as Error).message
    }, { status: 400 });
  }
}
