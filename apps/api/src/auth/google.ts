import crypto from 'node:crypto';
import { env } from '../config/env.js';

export interface GoogleJwk {
  kty: string;
  alg?: string;
  use?: string;
  kid: string;
  n: string;
  e: string;
  [key: string]: any;
}

export interface GoogleJwksResponse {
  keys: GoogleJwk[];
}

export interface GoogleIdTokenPayload {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
  iss: string;
  aud: string;
  exp: number;
  [key: string]: any;
}

export interface GoogleTokensResponse {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

let cachedJwks: GoogleJwk[] = [];
let jwksCachedAt = 0;
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Fetch Google public keys (JWKS) from GOOGLE_JWKS_URL.
 * Cache retrieved keys in memory for performance.
 */
export async function fetchJwks(forceRefresh = false): Promise<GoogleJwk[]> {
  const now = Date.now();
  if (!forceRefresh && cachedJwks.length > 0 && now - jwksCachedAt < JWKS_CACHE_TTL_MS) {
    return cachedJwks;
  }

  const response = await fetch(env.GOOGLE_JWKS_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch Google JWKS: HTTP ${response.status}`);
  }

  const data = (await response.json()) as GoogleJwksResponse;
  if (!data || !Array.isArray(data.keys)) {
    throw new Error('Invalid JWKS response structure: missing keys array.');
  }

  cachedJwks = data.keys;
  jwksCachedAt = now;
  return cachedJwks;
}

/**
 * Verify RSA-SHA256 signature and claims of a Google ID token.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdTokenPayload> {
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid ID token: expected 3 parts separated by dots.');
  }

  const [rawHeader, rawPayload, rawSignature] = parts;

  let header: { alg?: string; kid?: string };
  let payload: GoogleIdTokenPayload;
  try {
    header = JSON.parse(Buffer.from(rawHeader, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(rawPayload, 'base64url').toString('utf8'));
  } catch (err: any) {
    throw new Error(`Failed to parse ID token JSON: ${err.message}`);
  }

  if (header.alg !== 'RS256') {
    throw new Error(`Unsupported token algorithm: ${header.alg}`);
  }

  let keys = await fetchJwks();
  let matchingKey = keys.find((key) => key.kid === header.kid);

  if (!matchingKey) {
    // Refresh cache once if key id is not present
    keys = await fetchJwks(true);
    matchingKey = keys.find((key) => key.kid === header.kid);
  }

  if (!matchingKey) {
    throw new Error(`Public key with kid "${header.kid}" not found in JWKS.`);
  }

  const publicKey = crypto.createPublicKey({ key: matchingKey as any, format: 'jwk' });
  const signedContent = Buffer.from(`${rawHeader}.${rawPayload}`, 'utf8');
  const signature = Buffer.from(rawSignature, 'base64url');

  const isValidSignature = crypto
    .createVerify('RSA-SHA256')
    .update(signedContent)
    .verify(publicKey, signature);

  if (!isValidSignature) {
    throw new Error('ID token cryptographic signature verification failed.');
  }

  if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
    throw new Error(`Invalid token issuer: ${payload.iss}`);
  }

  if (payload.aud !== env.GOOGLE_CLIENT_ID) {
    throw new Error(`Invalid token audience: ${payload.aud}`);
  }

  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) {
    throw new Error('ID token has expired.');
  }

  if (!payload.sub || !payload.email) {
    throw new Error('ID token payload missing required sub or email claims.');
  }

  return payload;
}

/**
 * Exchange authorization code for tokens using PKCE verifier.
 */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string
): Promise<GoogleTokensResponse> {
  const body = new URLSearchParams({
    code,
    code_verifier: codeVerifier,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    grant_type: 'authorization_code',
  });

  const response = await fetch(env.GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorDetails = await response.text();
    throw new Error(`Token exchange failed with HTTP ${response.status}: ${errorDetails}`);
  }

  const data = (await response.json()) as GoogleTokensResponse;
  if (!data.id_token) {
    throw new Error('Token exchange response missing id_token.');
  }

  return data;
}

/**
 * Generate PKCE code verifier and code challenge.
 */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * Construct Google OAuth 2.0 authorization URL.
 */
export function buildGoogleAuthUrl(options: {
  state: string;
  codeChallenge: string;
  promptConsent?: boolean;
}): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', env.GOOGLE_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile https://www.googleapis.com/auth/drive.file');
  url.searchParams.set('state', options.state);
  url.searchParams.set('code_challenge', options.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('access_type', 'offline');
  if (options.promptConsent) {
    url.searchParams.set('prompt', 'consent');
  }
  return url.toString();
}
