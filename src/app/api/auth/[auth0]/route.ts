import { auth0 } from '@/lib/auth0';

export const GET = (req: Request) => auth0.middleware(req);
export const POST = (req: Request) => auth0.middleware(req);
