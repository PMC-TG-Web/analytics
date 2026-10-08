import type { PrismaClient, AppLoginSession } from '@prisma/client';
import { APP_SESSION_ABSOLUTE_SECONDS, APP_SESSION_IDLE_SECONDS } from './appSignInPolicy.ts';
import { createAppSessionToken, hashAppSessionToken, isAppSessionToken, encryptAppCredential, decryptAppCredential } from './appSessionCrypto.ts';

export type ProcoreIdentity = { id: string; email: string; name: string | null; companyIds: string[] };
export type LoginTokens = { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
type SessionDatabase = Pick<PrismaClient, 'appLoginSession' | 'user'>;
type Provider = {
  refresh: (token: string) => Promise<LoginTokens>;
  identify: (token: string) => Promise<ProcoreIdentity>;
};

export function appSessionIsLive(session: AppLoginSession, companyId: string, now: Date) {
  return !session.revokedAt && session.companyId === companyId
    && session.idleExpiresAt > now && session.absoluteExpiresAt > now;
}

export function createAppSessionService(db: SessionDatabase, provider: Provider, companyId: string, clock = () => new Date()) {
  async function approved(email: string) {
    const user = await db.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { isActive: true } });
    // User is the existing application-access source of truth. Company membership alone grants nothing.
    return user?.isActive === true;
  }

  function matchesIdentity(identity: ProcoreIdentity, email?: string, id?: string) {
    return Boolean(identity.id) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.email)
      && identity.companyIds.includes(companyId)
      && (!email || identity.email.toLowerCase() === email) && (!id || identity.id === id);
  }

  return {
    async create(identity: ProcoreIdentity, tokens: LoginTokens) {
      const email = identity.email.trim().toLowerCase();
      if (!matchesIdentity(identity) || !await approved(email)) throw new Error('PROCORE_APP_ACCESS_DENIED');
      if (!tokens.access_token || !(tokens.expires_in > 0)) throw new Error('Invalid Procore token response.');
      const token = createAppSessionToken();
      const tokenHash = hashAppSessionToken(token);
      const now = clock();
      const session = await db.appLoginSession.create({ data: {
        tokenHash, email, procoreUserId: identity.id, companyId, displayName: identity.name,
        createdAt: now, lastSeenAt: now,
        idleExpiresAt: new Date(now.getTime() + APP_SESSION_IDLE_SECONDS * 1000),
        absoluteExpiresAt: new Date(now.getTime() + APP_SESSION_ABSOLUTE_SECONDS * 1000),
        accessToken: encryptAppCredential(tokens.access_token, tokenHash),
        refreshToken: tokens.refresh_token ? encryptAppCredential(tokens.refresh_token, tokenHash) : null,
        accessExpiresAt: new Date(now.getTime() + tokens.expires_in * 1000), scope: tokens.scope || null,
      } });
      return { token, session };
    },

    async revoke(token: string | undefined) {
      if (!isAppSessionToken(token)) return;
      await db.appLoginSession.updateMany({ where: { tokenHash: hashAppSessionToken(token), revokedAt: null }, data: { revokedAt: clock() } });
    },

    async resolve(token: string | undefined, renew = false) {
      if (!isAppSessionToken(token)) return null;
      const tokenHash = hashAppSessionToken(token);
      let session = await db.appLoginSession.findUnique({ where: { tokenHash } });
      const now = clock();
      if (!session || !appSessionIsLive(session, companyId, now)) return null;
      if (!await approved(session.email)) {
        await db.appLoginSession.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: now } });
        return null;
      }
      if (renew && now.getTime() - session.lastSeenAt.getTime() >= 5 * 60_000) {
        const touched = await db.appLoginSession.updateMany({
          where: { tokenHash, revokedAt: null, idleExpiresAt: { gt: now }, absoluteExpiresAt: { gt: now } },
          data: { lastSeenAt: now, idleExpiresAt: new Date(Math.min(now.getTime() + APP_SESSION_IDLE_SECONDS * 1000, session.absoluteExpiresAt.getTime())) },
        });
        if (!touched.count) return null;
      }
      if (renew && !session.credentialsInvalid && session.accessExpiresAt.getTime() <= now.getTime() + 120_000) {
        if (!session.refreshToken) {
          await db.appLoginSession.updateMany({ where: { tokenHash }, data: { credentialsInvalid: true } });
        } else if (!session.refreshStartedAt) {
          // Durable compare-and-set prevents concurrent requests from spending the same rotating refresh token.
          const claim = await db.appLoginSession.updateMany({
            where: { tokenHash, revokedAt: null, refreshStartedAt: null, accessExpiresAt: session.accessExpiresAt, credentialsInvalid: false },
            data: { refreshStartedAt: now },
          });
          if (claim.count) {
            try {
              const tokens = await provider.refresh(decryptAppCredential(session.refreshToken, tokenHash));
              if (!tokens.access_token || !tokens.refresh_token || !(tokens.expires_in > 0)) throw new Error('Invalid refreshed tokens.');
              const identity = await provider.identify(tokens.access_token);
              if (!matchesIdentity(identity, session.email, session.procoreUserId)) {
                await db.appLoginSession.updateMany({ where: { tokenHash }, data: { revokedAt: clock() } });
                return null;
              }
              await db.appLoginSession.updateMany({ where: { tokenHash, revokedAt: null, refreshStartedAt: now }, data: {
                accessToken: encryptAppCredential(tokens.access_token, tokenHash),
                refreshToken: encryptAppCredential(tokens.refresh_token, tokenHash),
                accessExpiresAt: new Date(clock().getTime() + tokens.expires_in * 1000),
                scope: tokens.scope || session.scope, refreshStartedAt: null,
              } });
            } catch (error) {
              const status = (error as { status?: number }).status;
              if (status === 400 || status === 401 || status === 403) {
                await db.appLoginSession.updateMany({ where: { tokenHash }, data: { revokedAt: clock() } });
                return null;
              }
              // A lost token response may already have rotated the credential. Never blindly replay it.
              // Keep the app's saved-data session available; live Procore tools can explicitly reconnect.
              await db.appLoginSession.updateMany({ where: { tokenHash }, data: { credentialsInvalid: true } });
            }
          }
        }
        session = await db.appLoginSession.findUnique({ where: { tokenHash } });
        if (!session || !appSessionIsLive(session, companyId, clock())) return null;
      }
      return {
        user: { email: session.email, name: session.displayName, sub: `procore|${session.procoreUserId}` },
        absoluteExpiresAt: session.absoluteExpiresAt,
        accessExpiresAt: session.accessExpiresAt,
        accessToken: session.accessExpiresAt > clock() ? decryptAppCredential(session.accessToken, tokenHash) : null,
        companyId: session.companyId, scope: session.scope,
        needsReconnect: session.credentialsInvalid || (!session.refreshToken && session.accessExpiresAt <= clock())
          || Boolean(session.refreshStartedAt && clock().getTime() - session.refreshStartedAt.getTime() > 60_000),
      };
    },
  };
}
