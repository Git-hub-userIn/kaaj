import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env if not loaded yet
if (!process.env.GOOGLE_CLIENT_ID && !process.env.TOKEN_ENC_KEY) {
  const envCandidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '.env'),
    path.resolve(__dirname, '../../../../.env'),
    path.resolve(__dirname, '../../../.env'),
  ];
  for (const candidate of envCandidates) {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      if (process.env.TOKEN_ENC_KEY || process.env.GOOGLE_CLIENT_ID) {
        break;
      }
    }
  }
}

export const envSchema = z.object({
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().url(),
  TOKEN_ENC_KEY: z.string().min(16),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  GOOGLE_TOKEN_URL: z.string().url().default('https://oauth2.googleapis.com/token'),
  GOOGLE_JWKS_URL: z.string().url().default('https://www.googleapis.com/oauth2/v3/certs'),
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validate and return current environment configuration.
 */
export function getEnv(): Env {
  return envSchema.parse({
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    TOKEN_ENC_KEY: process.env.TOKEN_ENC_KEY,
    SESSION_TTL_DAYS: process.env.SESSION_TTL_DAYS,
    GOOGLE_TOKEN_URL: process.env.GOOGLE_TOKEN_URL || undefined,
    GOOGLE_JWKS_URL: process.env.GOOGLE_JWKS_URL || undefined,
    FRONTEND_URL: process.env.FRONTEND_URL || undefined,
  });
}

// Validate configuration at server startup
getEnv();

/**
 * Exported environment object.
 * Proxies property access to support test runtime overrides.
 */
export const env: Env = new Proxy({} as Env, {
  get(_target, prop: string) {
    const current = getEnv();
    return (current as any)[prop];
  },
});
