import type { Context, Next } from 'hono';
import { ensureUser } from '../db/client.js';

export interface AuthContext {
  userId: string;
  subject: string;
}

const DEV_TOKEN = process.env.DEV_AUTH_TOKEN || process.env.KAAJ_DEV_AUTH_TOKEN || 'kaaj-local-dev-token';

// In-memory per-user sliding window rate limiter
const userRateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(
  userId: string,
  limit = 300,
  windowMs = 60000
): { allowed: boolean; remaining: number } {
  const now = Date.now();
  let entry = userRateLimitMap.get(userId);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    userRateLimitMap.set(userId, entry);
  }
  entry.count++;
  if (entry.count > limit) {
    return { allowed: false, remaining: 0 };
  }
  return { allowed: true, remaining: limit - entry.count };
}

export async function authGuard(c: Context, next: Next): Promise<Response | void> {
  // Routes handled independently (public shares, WebSocket auth handler)
  if (c.req.path.startsWith('/shared/') || c.req.path.startsWith('/sync/ws')) {
    return await next();
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const authHeader = c.req.header('Authorization');
  const queryToken = c.req.query('token');
  const token = (authHeader ? authHeader.replace(/^Bearer\s+/i, '') : queryToken)?.trim();

  let resolvedUserId: string | null = null;

  if (!isProduction && token) {
    if (token.startsWith('user:')) {
      resolvedUserId = token.slice(5).trim();
    } else if (token.startsWith('token-user-')) {
      resolvedUserId = token.replace('token-', '').trim();
    } else if (token === DEV_TOKEN || token === 'kaaj-local-dev-token' || token === 'dev-secret-token') {
      resolvedUserId = 'dev-owner-user';
    }
  }

  if (!resolvedUserId) {
    return c.text('Unauthorized', 401);
  }

  // Rate limiting check
  const rate = checkRateLimit(resolvedUserId);
  if (!rate.allowed) {
    return c.json({ error: 'Rate limit exceeded. Please wait before retrying.' }, 429);
  }

  try {
    await ensureUser(resolvedUserId);
  } catch (err: any) {
    console.error('Failed to ensure user existence in database:', err);
  }

  c.set('userId', resolvedUserId);
  c.set('auth', { userId: resolvedUserId, subject: resolvedUserId } as AuthContext);
  return await next();
}
