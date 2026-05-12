export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || 'Unknown database error');
}

export function isTransientDatabaseConnectionError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();

  if (message.includes("can't reach database server")) return true;
  if (message.includes("connection")) return true;
  if (message.includes('cannot fetch data from service')) return true;
  if (message.includes('fetch failed')) return true;
  if (message.includes('data proxy')) return true;
  if (message.includes('accelerate')) return true;
  if (message.includes("timeout")) return true;
  if (message.includes("timed out")) return true;
  if (message.includes("econnreset")) return true;
  if (message.includes("econnrefused")) return true;
  if (message.includes("too many connections")) return true;

  return false;
}

export function shouldFallbackToEmptyRead(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();

  // Transient connectivity issues should degrade read paths to empty payloads.
  if (isTransientDatabaseConnectionError(error)) return true;

  // Prisma known request errors for missing table/column.
  if (message.includes('p2021') || message.includes('p2022')) return true;
  if (message.includes('p1001') || message.includes('p1008') || message.includes('p1017')) return true;
  if (message.includes('prismaclientinitializationerror')) return true;
  if (message.includes('environment variable not found: database_url')) return true;
  if (message.includes('invalid `prisma.')) return true;

  // Postgres errors surfaced through Prisma for schema drift or restricted DDL.
  if (message.includes('does not exist')) return true;
  if (message.includes('relation') && message.includes('not found')) return true;
  if (message.includes('permission denied')) return true;
  if (message.includes('must be owner of relation')) return true;
  if (message.includes('insufficient privilege')) return true;

  return false;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withDatabaseRetry<T>(
  operation: () => Promise<T>,
  options?: {
    retries?: number;
    delayMs?: number;
  }
): Promise<T> {
  const retries = options?.retries ?? 2;
  const delayMs = options?.delayMs ?? 250;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt >= retries || !isTransientDatabaseConnectionError(error)) {
        throw error;
      }

      await delay(delayMs * (attempt + 1));
    }
  }

  throw lastError;
}
