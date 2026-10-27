import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { pageLookupResponse } from '@/lib/pageLookupResponse';
import { loadCertificationEmployees } from '@/lib/pageLookupData';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return pageLookupResponse(request, 'certifications', () => loadCertificationEmployees(prisma));
}
