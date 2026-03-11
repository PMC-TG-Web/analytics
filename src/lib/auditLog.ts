import { promises as fs } from 'fs';
import path from 'path';
import { auth0 } from '@/lib/auth0';
import type { NextRequest } from 'next/server';

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'sync'
  | 'admin'
  | 'seed';

export async function logAuditEvent(
  request: NextRequest,
  event: {
    action: AuditAction;
    resource: string;
    target?: string;
    details?: Record<string, unknown>;
  }
) {
  try {
    const session = await auth0.getSession(request);
    const timestamp = new Date().toISOString();
    const user = session?.user;
    const url = new URL(request.url);
    const forwardedFor = request.headers.get('x-forwarded-for');
    const clientIp = forwardedFor?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')?.trim()
      || request.headers.get('cf-connecting-ip')?.trim()
      || 'unknown-client';

    const entry = {
      timestamp,
      action: event.action,
      resource: event.resource,
      target: event.target ?? null,
      path: url.pathname,
      method: request.method,
      user: {
        email: user?.email ?? null,
        name: user?.name ?? null,
        sub: user?.sub ?? null,
      },
      clientIp,
      details: event.details ?? {},
    };

    console.log('[AUDIT]', JSON.stringify(entry));

    const logsDir = path.join(process.cwd(), 'logs');
    const logPath = path.join(logsDir, 'audit.log');
    await fs.mkdir(logsDir, { recursive: true });
    await fs.appendFile(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (error) {
    console.error('Failed to write audit log:', error);
  }
}
