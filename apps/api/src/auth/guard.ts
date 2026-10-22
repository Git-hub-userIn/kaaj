import type { Context, Next } from 'hono';

export interface AuthContext {
  subject: string;
}

const DEV_TOKEN = process.env.KAAJ_DEV_AUTH_TOKEN || 'kaaj-local-dev-token';

export async function authGuard(c: Context, next: Next): Promise<Response | void> {
  const isProduction = process.env.NODE_ENV === 'production';
  const authHeader = c.req.header('Authorization');

  if (!isProduction) {
    // In local development, accept fixed dev token or default subject
    const token = authHeader?.replace('Bearer ', '');
    if (!token || token === DEV_TOKEN) {
      c.set('auth', { subject: 'dev-owner-user' } as AuthContext);
      return await next();
    }
  }

  // Seam for production verification (Cloudflare Access or OIDC)
  return c.text('Unauthorized', 401);
}
