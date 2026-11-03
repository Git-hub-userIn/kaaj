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
  limit = (process.env.NODE_ENV !== 'production' && process.env.APP_MODE === 'test') ? 50000 : 300,
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
  // Routes handled independently (public health, shares, WebSocket auth handler)
  if (c.req.path === '/health' || c.req.path.startsWith('/shared/') || c.req.path.startsWith('/sync/ws')) {
    return await next();
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const authHeader = c.req.header('Authorization');
  const queryToken = c.req.query('token');
  const token = (authHeader ? authHeader.replace(/^Bearer\s+/i, '') : queryToken)?.trim();

  let resolvedUserId: string | null = null;

  if (!isProduction && token) {
    if (token.startsWith('exp:')) {
      const parts = token.split(':');
      if (parts.length >= 3) {
        const expMs = Number(parts[1]);
        const uid = parts.slice(2).join(':');
        if (Number.isFinite(expMs) && Date.now() < expMs) {
          resolvedUserId = uid;
        }
      }
    } else if (token.startsWith('user:')) {
      resolvedUserId = token.slice(5).trim();
    } else if (token.startsWith('token-user-')) {
      resolvedUserId = token.replace('token-', '').trim();
    } else if (token === DEV_TOKEN || token === 'kaaj-local-dev-token' || token === 'dev-secret-token') {
      resolvedUserId = 'dev-owner-user';
    }
  }

  // Visual assets in non-production allow fallback to dev user when requested without auth headers (e.g. browser <img> tags)
  if (!resolvedUserId && !isProduction && (c.req.path.startsWith('/assets/') || c.req.path.startsWith('/covers/'))) {
    resolvedUserId = 'dev-owner-user';
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
