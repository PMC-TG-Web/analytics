import { NextResponse } from 'next/server';
import { withApiAuthRequired } from '@auth0/nextjs-auth0';

const handler = withApiAuthRequired(async function getMe(req) {
  const session = (req as any).auth;

  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  return NextResponse.json({
    email: session.user.email,
    name: session.user.name || session.user.nickname || null,
  });
});

export const GET = handler;
