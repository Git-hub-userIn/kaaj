import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { getBasePrismaClient } from '../db/client.js';
import { encryptToken } from './crypto.js';
import {
  buildGoogleAuthUrl,
  exchangeCodeForTokens,
  generatePkce,
  verifyGoogleIdToken,
} from './google.js';

export const authRouter = new Hono<{
  Variables: {
    userId?: string;
  };
}>();

/**
 * Initiate Google OAuth 2.0 flow with PKCE.
 */
authRouter.get('/google', async (c) => {
  const isProduction = process.env.NODE_ENV === 'production';
  let hasStoredRefreshToken = false;

  const sessionId = getCookie(c, 'kaaj_session');
  if (sessionId) {
    const prisma = getBasePrismaClient();
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });
    if (session && session.expiresAt > new Date() && session.user.encryptedRefreshToken) {
      hasStoredRefreshToken = true;
    }
  }

  const promptConsent = !hasStoredRefreshToken;
  const state = crypto.randomBytes(16).toString('hex');
  const { verifier, challenge } = generatePkce();

  setCookie(c, 'kaaj_oauth_state', state, {
    httpOnly: true,
    maxAge: 600,
    path: '/',
    secure: isProduction,
    sameSite: 'Lax',
  });

  setCookie(c, 'kaaj_oauth_verifier', verifier, {
    httpOnly: true,
    maxAge: 600,
    path: '/',
    secure: isProduction,
    sameSite: 'Lax',
  });

  const authUrl = buildGoogleAuthUrl({
    state,
    codeChallenge: challenge,
    promptConsent,
  });

  return c.redirect(authUrl);
});

/**
 * Handle Google OAuth 2.0 authorization callback.
 */
authRouter.get('/google/callback', async (c) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const code = c.req.query('code');
  const state = c.req.query('state');
  const savedState = getCookie(c, 'kaaj_oauth_state');
  const verifier = getCookie(c, 'kaaj_oauth_verifier');

  deleteCookie(c, 'kaaj_oauth_state', { path: '/' });
  deleteCookie(c, 'kaaj_oauth_verifier', { path: '/' });

  if (!code || !state || !savedState || state !== savedState || !verifier) {
    return c.text('Invalid OAuth state or missing parameters.', 400);
  }

  try {
    const tokens = await exchangeCodeForTokens(code, verifier);
    const idPayload = await verifyGoogleIdToken(tokens.id_token);

    const prisma = getBasePrismaClient();

    let user = await prisma.user.findUnique({
      where: { googleSub: idPayload.sub },
    });

    if (!user) {
      user = await prisma.user.findUnique({
        where: { email: idPayload.email },
      });
    }

    const encryptedRefreshToken = tokens.refresh_token
      ? encryptToken(tokens.refresh_token)
      : undefined;

    if (user) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          googleSub: idPayload.sub,
          email: idPayload.email,
          name: idPayload.name ?? user.name,
          picture: idPayload.picture ?? user.picture,
          ...(encryptedRefreshToken ? { encryptedRefreshToken } : {}),
        },
      });
    } else {
      user = await prisma.user.create({
        data: {
          googleSub: idPayload.sub,
          email: idPayload.email,
          name: idPayload.name ?? null,
          picture: idPayload.picture ?? null,
          encryptedRefreshToken: encryptedRefreshToken ?? null,
        },
      });
    }

    // Clean up expired sessions
    await prisma.session.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });

    // Create a new session
    const sessionId = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

    await prisma.session.create({
      data: {
        id: sessionId,
        userId: user.id,
        expiresAt,
      },
    });

    setCookie(c, 'kaaj_session', sessionId, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: isProduction,
      path: '/',
      expires: expiresAt,
    });

    return c.redirect(env.FRONTEND_URL);
  } catch (err: any) {
    console.error('Google OAuth callback error:', err);
    return c.text(`Authentication failed: ${err.message}`, 400);
  }
});

/**
 * Log out user and destroy server session.
 */
authRouter.post('/logout', async (c) => {
  const sessionId = getCookie(c, 'kaaj_session');
  if (sessionId) {
    const prisma = getBasePrismaClient();
    await prisma.session.deleteMany({
      where: { id: sessionId },
    });
  }

  deleteCookie(c, 'kaaj_session', { path: '/' });
  return c.body(null, 204);
});

/**
 * Return profile of authenticated user.
 */
authRouter.get('/me', async (c) => {
  const sessionId = getCookie(c, 'kaaj_session');
  let user: { id: string; email: string; name: string | null; picture: string | null } | null = null;

  if (sessionId) {
    const prisma = getBasePrismaClient();
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { user: true },
    });
    if (session && session.expiresAt > new Date()) {
      user = {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        picture: session.user.picture,
      };
    }
  }

  if (!user && process.env.APP_MODE === 'test') {
    const contextUserId = c.get('userId');
    if (contextUserId && typeof contextUserId === 'string') {
      const prisma = getBasePrismaClient();
      const dbUser = await prisma.user.findUnique({
        where: { id: contextUserId },
      });
      if (dbUser) {
        user = {
          id: dbUser.id,
          email: dbUser.email,
          name: dbUser.name,
          picture: dbUser.picture,
        };
      }
    }
  }

  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  return c.json(user, 200);
});
