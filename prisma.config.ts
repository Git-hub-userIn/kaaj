import 'dotenv/config';
import { defineConfig } from 'prisma/config';

function resolveDatabaseUrl(): string {
  const base = process.env.DATABASE_URL;
  if (!base) return '';
  try {
    const url = new URL(base);
    if (url.pathname === '/' || url.pathname === '/postgres') {
      url.pathname = '/kaaj_dev';
    }
    return url.toString();
  } catch {
    return base;
  }
}

export default defineConfig({
  schema: 'apps/api/prisma/schema.prisma',
  migrations: {
    path: 'apps/api/prisma/migrations',
  },
  datasource: {
    url: resolveDatabaseUrl(),
  },
});
