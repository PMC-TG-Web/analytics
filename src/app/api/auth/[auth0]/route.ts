import { NextRequest } from 'next/server';
import { createAuth0Client } from '@/lib/auth0';

export async function GET(request: NextRequest) {
  const auth0 = createAuth0Client(request.nextUrl.origin);
  return auth0.middleware(request);
}

export async function POST(request: NextRequest) {
  const auth0 = createAuth0Client(request.nextUrl.origin);
  return auth0.middleware(request);
}
