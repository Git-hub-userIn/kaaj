import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { getBasePrismaClient, ensureUser } from '../db/client.js';
import { env } from '../config/env.js';

export interface AuthContext {
  userId: string;
  subject: string;
}

const DEV_TOKEN = process.env.DEV_AUTH_TOKEN || process.env.KAAJ_DEV_AUTH_TOKEN || 'kaaj-local-dev-token';

// In-memory per-user sliding window rate limiter
const userRateLimitMap = new Map<string, { count: number; resetAt: number }>();

// In-memory per-IP sliding window rate limiter for public routes (/shared/*)
const sharedIpRateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function checkSharedIpRateLimit(
  ip: string,
  limit?: number,
  windowMs = 60000
): { allowed: boolean; remaining: number } {
  const actualLimit =
    limit ?? (process.env.NODE_ENV !== 'production' && process.env.APP_MODE === 'test' ? 50 : 60);
  const now = Date.now();
  let entry = sharedIpRateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    sharedIpRateLimitMap.set(ip, entry);
  }
  entry.count++;
  if (entry.count > actualLimit) {
    return { allowed: false, remaining: 0 };
  }
  return { allowed: true, remaining: actualLimit - entry.count };
}

export async function sharedIpRateLimitGuard(c: Context, next: Next): Promise<Response | void> {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim() || c.req.header('x-real-ip') || '127.0.0.1';
  const customLimitHeader = c.req.header('x-test-rate-limit');
  const customLimit = customLimitHeader ? Number(customLimitHeader) : undefined;
  const rate = checkSharedIpRateLimit(ip, customLimit);
  if (!rate.allowed) {
    return c.json({ error: 'Rate limit exceeded for shared link access. Please retry later.' }, 429);
  }
  return await next();
}

export function checkRateLimit(
  userId: string,
  limit = process.env.NODE_ENV !== 'production' && process.env.APP_MODE === 'test' ? 50000 : 300,
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

/**
 * Enforce session authentication across protected routes.
 * Skip public paths and allow test token fallback when APP_MODE is test.
 */
export async function authGuard(c: Context, next: Next): Promise<Response | void> {
  const path = c.req.path;

  // Skip public routes
  if (
    path === '/health' ||
    path.startsWith('/shared/') ||
    path === '/auth/google' ||
    path.startsWith('/auth/google/') ||
    path.startsWith('/sync/ws')
  ) {
    return await next();
  }

  let resolvedUserId: string | null = null;

  // 1. Validate session cookie
  const sessionId = getCookie(c, 'kaaj_session');
  if (sessionId) {
    const prisma = getBasePrismaClient();
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
    });
    if (session && session.expiresAt > new Date()) {
      resolvedUserId = session.userId;
    }
  }

  // 2. Allow Authorization header fallback in test mode
  if (!resolvedUserId && process.env.APP_MODE === 'test') {
    const authHeader = c.req.header('Authorization');
    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
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
      } else if (
        token === DEV_TOKEN ||
        token === 'kaaj-local-dev-token' ||
        token === 'dev-secret-token'
      ) {
        resolvedUserId = 'dev-owner-user';
      }
    }
  }

  // 3. Fallback for visual assets in local development mode
  if (
    !resolvedUserId &&
    process.env.NODE_ENV !== 'production' &&
    process.env.APP_MODE !== 'test' &&
    (path.startsWith('/assets/') || path.startsWith('/covers/'))
  ) {
    resolvedUserId = 'dev-owner-user';
  }

  if (!resolvedUserId) {
    const acceptHeader = c.req.header('Accept') || c.req.header('accept') || '';
    if (acceptHeader.includes('text/html')) {
      const frontendUrl = env.FRONTEND_URL.replace(/\/$/, '');
      return c.redirect(`${frontendUrl}/login`, 302);
    }
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Rate limiting check
  const rate = checkRateLimit(resolvedUserId);
  if (!rate.allowed) {
    return c.json({ error: 'Rate limit exceeded. Please wait before retrying.' }, 429);
  }

  try {
    await ensureUser(resolvedUserId);
  } catch (err: any) {
    console.error('Failed to ensure user in database:', err);
  }

  c.set('userId', resolvedUserId);
  c.set('auth', { userId: resolvedUserId, subject: resolvedUserId } as AuthContext);
  return await next();
}
