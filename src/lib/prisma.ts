import { PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

const prismaClient =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: [{ emit: 'event', level: 'query' }, 'warn', 'error'],
  });

prismaClient.$on('query', (event) => {
  if (!event.query.includes('FROM "public"."Project"')) return;

  const normalizedQuery = event.query.replace(/\s+/g, ' ').trim();
  if (!normalizedQuery.toUpperCase().startsWith('SELECT')) return;

  console.log('[Prisma Project Query]', {
    query: normalizedQuery,
    params: event.params,
    durationMs: event.duration,
  });
});

export const prisma = prismaClient;

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

