import { defineConfig, devices } from '@playwright/test';
import net from 'node:net';

async function assertPortFree(port: number, serviceName: string): Promise<void> {
  const isBusy = await new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(300);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      resolve(false);
    });
    socket.connect(port, '127.0.0.1');
  });

  if (isBusy) {
    throw new Error(
      `[PORT_GUARD] Port ${port} (${serviceName}) is already in use. Fresh process required. Terminate the existing process first.`
    );
  }
}

// Guard: verify API (3001) and Web (3000) ports are free before spawning fresh servers
if (!process.env.PLAYWRIGHT_PORTS_CHECKED && process.env.TEST_WORKER_INDEX === undefined) {
  process.env.PLAYWRIGHT_PORTS_CHECKED = '1';
  await assertPortFree(3001, 'API Server');
  await assertPortFree(3000, 'Web Server');
}

export default defineConfig({
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  testDir: './',
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'bun apps/api/src/index.ts',
      cwd: '../',
      port: 3001,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        APP_MODE: 'test',
        BACKUP_DRIVE_FOLDER_NAME: 'Kaaj-test',
        TOKEN_ENC_KEY: 'test-token-encryption-key-32-chars-long!',
        SESSION_TTL_DAYS: '30',
        GOOGLE_CLIENT_ID: 'test-google-client-id',
        GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
        GOOGLE_REDIRECT_URI: 'http://localhost:3001/auth/google/callback',
        FRONTEND_URL: 'http://localhost:3000',
        GOOGLE_TOKEN_URL: process.env.GOOGLE_TOKEN_URL || 'http://127.0.0.1:3456/token',
        GOOGLE_JWKS_URL: process.env.GOOGLE_JWKS_URL || 'http://127.0.0.1:3456/certs',
      },
    },
    {
      command: 'bun run --filter @kaaj/web dev --port 3000',
      cwd: '../',
      port: 3000,
      reuseExistingServer: false,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        APP_MODE: 'test',
        BACKUP_DRIVE_FOLDER_NAME: 'Kaaj-test',
        TOKEN_ENC_KEY: 'test-token-encryption-key-32-chars-long!',
        SESSION_TTL_DAYS: '30',
        GOOGLE_CLIENT_ID: 'test-google-client-id',
        GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
        GOOGLE_REDIRECT_URI: 'http://localhost:3001/auth/google/callback',
        FRONTEND_URL: 'http://localhost:3000',
        GOOGLE_TOKEN_URL: process.env.GOOGLE_TOKEN_URL || 'http://127.0.0.1:3456/token',
        GOOGLE_JWKS_URL: process.env.GOOGLE_JWKS_URL || 'http://127.0.0.1:3456/certs',
      },
    },
  ],
});
