import { test, expect } from '@playwright/test';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATE_FILE = path.resolve(__dirname, '.test-db-state.json');

const API_BASE = 'http://localhost:3001';
const MOCK_PORT = 3456;

const TEST_RSA_PUBLIC_PEM = `-----BEGIN RSA PUBLIC KEY-----
MIIBCgKCAQEA4qUmPd4iUBRXseaw8UljTzkq7yuCkYZ+YzjmHohS1ftONLba9Jpj
uoESqdnmIhrOSVaEih4ZWJR9UR8VgLGjm27WoY4T7inpml6rtFPAUW2f4eek/cbc
0r7EpnIr3jITxg7pjQ5vrlNfNgvSnii5ATJ6WDzWeC3b4/1jnjn72Qg/11B097gk
CT0degVRN7x7MKgxGJWHvGExQHK9VbbejnP1mSefc+bZy9WlHaeAvhWPaFM43X4j
V83CW3jrHf5oA0rx4ANcPlC9jAQx4Uwo2mMJDtgJ0cMemgLfIZ/Gnz2C8KIbvN0O
6Op6JjlZPYhmH2TAZ1pMlvmqIcOSl7Kr9QIDAQAB
-----END RSA PUBLIC KEY-----`;

const TEST_RSA_PRIVATE_PEM = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA4qUmPd4iUBRXseaw8UljTzkq7yuCkYZ+YzjmHohS1ftONLba
9JpjuoESqdnmIhrOSVaEih4ZWJR9UR8VgLGjm27WoY4T7inpml6rtFPAUW2f4eek
/cbc0r7EpnIr3jITxg7pjQ5vrlNfNgvSnii5ATJ6WDzWeC3b4/1jnjn72Qg/11B0
97gkCT0degVRN7x7MKgxGJWHvGExQHK9VbbejnP1mSefc+bZy9WlHaeAvhWPaFM4
3X4jV83CW3jrHf5oA0rx4ANcPlC9jAQx4Uwo2mMJDtgJ0cMemgLfIZ/Gnz2C8KIb
vN0O6Op6JjlZPYhmH2TAZ1pMlvmqIcOSl7Kr9QIDAQABAoIBABvcIS9Jtv4RAhak
POvsEYETjeuIdaxd0/tuaxsltskG8z4XnCKlN80dQKYQWvGmSeVJ9VDlEkiJOD5Y
i9QeAfaBUXDafiiwjj6jlIe+I83eo+CpEOcBIvPk71dmgW32yed2vc7RD3lmVjXW
jjVS3CsBgXiHQfXT7UvBQhWZGxQ6bAqX8VCMi16yw367XLSDjMtWVBmpJMGooHXI
8ftqAHus2OawCUZXOF0IHiuOLy1LHg9GqNaoCtNrpTGV0obAnN/gz5iXBF1zSKFL
5v9hvSxpp4M671atGpP9DfHIycjHFpTTzCOBWSKZPf4iMRVSU2Sbx2zmTn4f7GNR
YNm4hqECgYEA/+3ZT8SVVIGdSOpCJmQ1D6+YMS3E80wS1CV7A61WuWA+CFupQbyD
SpaMlGJzmDpUs7edcf6SYlXtchVhsMCtjush3Wxil/eY/D02PCSmIS3FeYUwWXbJ
sP0GQC8v/P6jTegn5FmIUifRTeuATzsIlG/HiHSZnREKs0RkAKf+QesCgYEA4rU5
PtxCt8jDmw9q1/RQuJF80uuqPis9xaPypfG3+07V8K/c7/HYCJclHleqCLCtbkym
xjGDuwzbNasstMDe142vEh6CGlCkv+QkYrFwf7meMtijy0Bk7G89Iac6SbRnYijx
KSx/zq2zuFMfQrdlW4HhecUQqEOh2w083RZNcZ8CgYEA8Nn6JSOwFTNVvgUX8+Fi
PjzWUZHtQ7pYDean+jHq59I3Ds6UXxT1ygAclJiCiMR8ahVmypz1Ti3no/GTWjA6
JcIKwML7lmChTOCeZcNnxNm6ej5p3gf4j+PPOiAuXT2Wmf7da/0GWaq3Q0laGzZH
QMphUX3KAxLCqyq1ohh3I7kCgYANzklxKYqqlIBM9hBknE06ICoA0jco2AtH+Oby
8hhpJnDi2mLS/eBRDZtGEMKbCt9U4zgYw7Uo8+x5hTYQv9oSOF+b892qapTN1r/c
fr/CF3Sp1gWLgB1lRJTtcria+nB9Ss782efilzNlmzJBJtf2TZ+Egdq01IGLzG+T
ayNGMwKBgDkDX8T6zREdmgkxr2LVRcX+MRxc7zs3uNnmHK6P4ck67q/lkcWBPKTc
vgT1tIc79fhz8GrIRnli/Xnw7V5v1t+45TMfcCltGkr7Cpw1mFAJ6aFIzGxzGYI3
ViSfyWZKwG04W3p3vWbfdcNj4AwcSO/v2jfdcuvXSmAGYAt4PH1K
-----END RSA PRIVATE KEY-----`;

const publicKey = crypto.createPublicKey(TEST_RSA_PUBLIC_PEM);
const privateKey = crypto.createPrivateKey(TEST_RSA_PRIVATE_PEM);
const publicJwk = publicKey.export({ format: 'jwk' });

let mockServer: http.Server | null = null;
let customMockSub: string | null = null;
let lastTokenRequestBody: Record<string, string> | null = null;

function setMockCustomSub(sub: string | null): void {
  customMockSub = sub;
}

function base64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

function createSignedJwt(header: object, payload: object, privKey: crypto.KeyObject): string {
  const encHeader = base64url(JSON.stringify(header));
  const encPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encHeader}.${encPayload}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = signer.sign(privKey);
  return `${signingInput}.${base64url(signature)}`;
}

// Start in-test mock server for Google OAuth token and JWKS endpoints
async function startMockGoogleServer(): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://127.0.0.1:${MOCK_PORT}`);

      // Handle GET /certs: return public JWKS
      if (req.method === 'GET' && url.pathname === '/certs') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            keys: [
              {
                ...publicJwk,
                kid: 'test-key-id',
                alg: 'RS256',
                use: 'sig',
              },
            ],
          })
        );
        return;
      }

      // Handle POST /token: validate parameters and return signed ID token
      if (req.method === 'POST' && url.pathname === '/token') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          let params: Record<string, string> = {};
          if (req.headers['content-type']?.includes('application/json')) {
            try {
              params = JSON.parse(body);
            } catch {}
          } else {
            const usp = new URLSearchParams(body);
            params = Object.fromEntries(usp.entries());
          }

          lastTokenRequestBody = params;

          // Validate required request parameters
          if (
            !params.code ||
            !params.client_id ||
            !params.client_secret ||
            !params.redirect_uri ||
            !params.code_verifier
          ) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error: 'invalid_request',
                error_description: 'Missing required OAuth parameters.',
              })
            );
            return;
          }

          const nowSec = Math.floor(Date.now() / 1000);
          const sub = customMockSub || 'google-sub-12345';
          const header = { alg: 'RS256', kid: 'test-key-id', typ: 'JWT' };
          const payload = {
            iss: 'https://accounts.google.com',
            aud: 'test-google-client-id',
            sub,
            email: 'testuser@example.com',
            name: 'Test User',
            picture: 'https://example.com/photo.jpg',
            exp: nowSec + 3600,
            iat: nowSec,
          };

          const signedIdToken = createSignedJwt(header, payload, privateKey);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              access_token: 'fake-access-token',
              id_token: signedIdToken,
              refresh_token: 'fake-refresh-token',
              token_type: 'Bearer',
              expires_in: 3600,
            })
          );
        });
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    });

    server.listen(MOCK_PORT, '127.0.0.1', () => {
      resolve(server);
    });

    server.on('error', (err) => {
      reject(err);
    });
  });
}

// Connect to test PostgreSQL database
async function getDbClient(): Promise<pg.Client> {
  let connStr = process.env.TEST_DB_URL || process.env.DATABASE_URL;
  if (fs.existsSync(STATE_FILE)) {
    try {
      const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (state.testDbUrl) connStr = state.testDbUrl;
    } catch {}
  }
  if (!connStr) {
    throw new Error('Database connection URL not found in test environment.');
  }
  const client = new Client({ connectionString: connStr });
  await client.connect();
  return client;
}

test.describe('Google Auth and Session Lifecycle E2E Suite', () => {
  let db: pg.Client;

  test.beforeAll(async () => {
    // Start mock Google endpoint server
    mockServer = await startMockGoogleServer();

    // Connect to test database and clean test user data
    db = await getDbClient();
    await db.query('DELETE FROM "User" WHERE "googleSub" = $1', ['google-sub-12345']);
  });

  test.afterAll(async () => {
    // Clean test user data
    if (db) {
      await db.query('DELETE FROM "User" WHERE "googleSub" = $1', ['google-sub-12345']).catch(() => {});
      await db.end().catch(() => {});
    }

    // Stop mock server
    if (mockServer) {
      await new Promise<void>((resolve) => mockServer!.close(() => resolve()));
    }
  });

  test.beforeEach(() => {
    setMockCustomSub('google-sub-12345');
    lastTokenRequestBody = null;
  });

  test('1. Callback with good code creates user and session', async ({ request }) => {
    // 1a. Call /auth/google to initiate OAuth flow and receive PKCE cookies
    const initRes = await request.get(`${API_BASE}/auth/google`, { maxRedirects: 0 });
    expect(initRes.status()).toBe(302);

    const location = initRes.headers()['location'];
    expect(location).toBeTruthy();
    const url = new URL(location!);
    const state = url.searchParams.get('state');
    expect(state).toBeTruthy();

    // 1b. Call callback endpoint with matching state and valid code
    const callbackRes = await request.get(
      `${API_BASE}/auth/google/callback?code=good-code&state=${state}`,
      { maxRedirects: 0 }
    );
    expect(callbackRes.status()).toBe(302);
    expect(callbackRes.headers()['location']).toBe('http://localhost:3000');

    // 1c. Verify session cookie is set
    const setCookies = callbackRes.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie');
    const sessionCookieHeader = setCookies.find((h) => h.value.includes('kaaj_session='));
    expect(sessionCookieHeader).toBeDefined();

    // 1d. Verify mock server received token exchange parameters
    expect(lastTokenRequestBody).not.toBeNull();
    expect(lastTokenRequestBody?.code).toBe('good-code');
    expect(lastTokenRequestBody?.client_id).toBe('test-google-client-id');
    expect(lastTokenRequestBody?.client_secret).toBe('test-google-client-secret');
    expect(lastTokenRequestBody?.code_verifier).toBeTruthy();

    // 1e. Verify user record in database
    const userRes = await db.query('SELECT * FROM "User" WHERE "googleSub" = $1', ['google-sub-12345']);
    expect(userRes.rows.length).toBe(1);
    const user = userRes.rows[0];
    expect(user.email).toBe('testuser@example.com');
    expect(user.name).toBe('Test User');
    expect(user.picture).toBe('https://example.com/photo.jpg');

    // 1f. Verify session record in database
    const sessionRes = await db.query('SELECT * FROM "Session" WHERE "userId" = $1', [user.id]);
    expect(sessionRes.rows.length).toBeGreaterThanOrEqual(1);
  });

  test('2. Bad state is rejected with 400 Bad Request', async ({ playwright }) => {
    const freshContext = await playwright.request.newContext();
    try {
      // Send callback request with invalid state
      const badRes = await freshContext.get(
        `${API_BASE}/auth/google/callback?code=some-code&state=wrong-state`
      );
      expect(badRes.status()).toBe(400);
    } finally {
      await freshContext.dispose();
    }
  });

  test('3. /auth/me returns profile with valid session cookie', async ({ request }) => {
    // 3a. Complete login flow to obtain session cookie
    const initRes = await request.get(`${API_BASE}/auth/google`, { maxRedirects: 0 });
    const state = new URL(initRes.headers()['location']!).searchParams.get('state');
    const callbackRes = await request.get(
      `${API_BASE}/auth/google/callback?code=good-code&state=${state}`,
      { maxRedirects: 0 }
    );
    expect(callbackRes.status()).toBe(302);

    // 3b. Request profile with session cookie automatically sent by context
    const meRes = await request.get(`${API_BASE}/auth/me`);
    expect(meRes.status()).toBe(200);

    const profile = await meRes.json();
    expect(profile.email).toBe('testuser@example.com');
    expect(profile.name).toBe('Test User');
    expect(profile.picture).toBe('https://example.com/photo.jpg');
    expect(profile.id).toBeTruthy();
  });

  test('4. Protected route returns 401 without cookie; HTML Accept gives 302 to /login', async ({ playwright, page }) => {
    const unauthContext = await playwright.request.newContext();
    try {
      // 4a. API call without cookie gives 401 JSON
      const catRes = await unauthContext.get(`${API_BASE}/categories`);
      expect(catRes.status()).toBe(401);
      const catJson = await catRes.json();
      expect(catJson).toEqual({ error: 'Unauthorized' });

      // 4b. Request auth profile endpoint without credentials gives 401 JSON
      const meRes = await unauthContext.get(`${API_BASE}/auth/me`);
      expect(meRes.status()).toBe(401);
      const meJson = await meRes.json();
      expect(meJson).toEqual({ error: 'Unauthorized' });

      // 4c. HTML Accept without cookie gives 302 to /login
      const htmlRes = await unauthContext.get(`${API_BASE}/categories`, {
        headers: { Accept: 'text/html,application/xhtml+xml' },
        maxRedirects: 0,
      });
      expect(htmlRes.status()).toBe(302);
      expect(htmlRes.headers()['location']).toBe('http://localhost:3000/login');

      // 4d. Frontend navigates to /login on unauthenticated page visit
      await page.goto('http://localhost:3000/');
      await page.waitForFunction(() => window.location.pathname === '/login');
      expect(page.url()).toContain('/login');
      await expect(page.getByText('Sign in with Google')).toBeVisible();
    } finally {
      await unauthContext.dispose();
    }
  });

  test('5. Logout deletes session and subsequent /auth/me returns 401', async ({ request }) => {
    // 5a. Log in to establish an active session
    const initRes = await request.get(`${API_BASE}/auth/google`, { maxRedirects: 0 });
    const state = new URL(initRes.headers()['location']!).searchParams.get('state');
    const callbackRes = await request.get(
      `${API_BASE}/auth/google/callback?code=good-code&state=${state}`,
      { maxRedirects: 0 }
    );
    expect(callbackRes.status()).toBe(302);

    // 5b. Extract session ID from Set-Cookie header
    const setCookies = callbackRes.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie');
    const sessionHeader = setCookies.find((h) => h.value.includes('kaaj_session='));
    expect(sessionHeader).toBeDefined();
    const sessionIdMatch = sessionHeader!.value.match(/kaaj_session=([^;]+)/);
    const sessionId = sessionIdMatch ? sessionIdMatch[1] : '';
    expect(sessionId).toBeTruthy();

    // 5c. Confirm session exists in database
    const sessionBefore = await db.query('SELECT * FROM "Session" WHERE "id" = $1', [sessionId]);
    expect(sessionBefore.rows.length).toBe(1);

    // 5d. Send logout request
    const logoutRes = await request.post(`${API_BASE}/auth/logout`);
    expect(logoutRes.status()).toBe(204);

    // 5e. Verify session was deleted from database
    const sessionAfter = await db.query('SELECT * FROM "Session" WHERE "id" = $1', [sessionId]);
    expect(sessionAfter.rows.length).toBe(0);

    // 5f. Subsequent profile request returns 401 Unauthorized
    const meRes = await request.get(`${API_BASE}/auth/me`);
    expect(meRes.status()).toBe(401);
  });

  test('6. Second login with same googleSub does not duplicate user', async ({ request }) => {
    setMockCustomSub('google-sub-12345');

    // 6a. Perform initial login
    const initRes1 = await request.get(`${API_BASE}/auth/google`, { maxRedirects: 0 });
    const state1 = new URL(initRes1.headers()['location']!).searchParams.get('state');
    const cbRes1 = await request.get(
      `${API_BASE}/auth/google/callback?code=code-1&state=${state1}`,
      { maxRedirects: 0 }
    );
    expect(cbRes1.status()).toBe(302);

    const usersAfterFirst = await db.query('SELECT * FROM "User" WHERE "googleSub" = $1', ['google-sub-12345']);
    expect(usersAfterFirst.rows.length).toBe(1);
    const originalUserId = usersAfterFirst.rows[0].id;

    // 6b. Perform second login with the same googleSub
    const initRes2 = await request.get(`${API_BASE}/auth/google`, { maxRedirects: 0 });
    const state2 = new URL(initRes2.headers()['location']!).searchParams.get('state');
    const cbRes2 = await request.get(
      `${API_BASE}/auth/google/callback?code=code-2&state=${state2}`,
      { maxRedirects: 0 }
    );
    expect(cbRes2.status()).toBe(302);

    // 6c. Verify database still contains exactly one user record
    const usersAfterSecond = await db.query('SELECT * FROM "User" WHERE "googleSub" = $1', ['google-sub-12345']);
    expect(usersAfterSecond.rows.length).toBe(1);
    expect(usersAfterSecond.rows[0].id).toBe(originalUserId);

    // 6d. Verify new session was created for this user
    const sessions = await db.query('SELECT * FROM "Session" WHERE "userId" = $1', [originalUserId]);
    expect(sessions.rows.length).toBeGreaterThanOrEqual(1);

    // 6e. Verify /auth/me returns the consistent user ID
    const meRes = await request.get(`${API_BASE}/auth/me`);
    expect(meRes.status()).toBe(200);
    const me = await meRes.json();
    expect(me.id).toBe(originalUserId);
  });
});
