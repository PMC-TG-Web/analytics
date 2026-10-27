import { prisma } from '@/lib/prisma';
import { createAppSessionService } from '@/lib/appSessionService';
import { getProcoreSignInIdentity, refreshProcoreSignInToken, prepareProcoreSignIn } from '@/lib/procore';

export const appSessions = createAppSessionService(prisma, {
  identify: getProcoreSignInIdentity,
  refresh: refreshProcoreSignInToken,
  prepareRefresh: prepareProcoreSignIn,
}, process.env.PROCORE_COMPANY_ID?.trim() || '598134325805519');
