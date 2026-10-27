# Kaaj Database Architecture: PostgreSQL and Prisma ORM 7

This document records database configurations, architecture, facts, and procedures for Kaaj.

---

## 1. Environment and Detected Versions

- **Host Operating System**: Microsoft Windows x64 (Native installation, no Docker).
- **PostgreSQL Host**: `localhost:5432` (Windows service `postgresql-x64-17`).
- **Detected PostgreSQL Version (`SELECT version()` Output)**:
  ```text
  PostgreSQL 17.7 on x86_64-windows, compiled by msvc-19.44.35219, 64-bit
  ```

---

## 2. Pinned Package Versions

All Prisma ORM 7 packages are pinned to exact versions without caret (`^`) or tilde (`~`):

```json
{
  "dependencies": {
    "@prisma/adapter-pg": "7.10.1",
    "@prisma/client": "7.10.1",
    "@prisma/client-runtime-utils": "7.10.1",
    "pg": "8.13.3",
    "dotenv": "17.4.2"
  },
  "devDependencies": {
    "prisma": "7.10.1",
    "@types/pg": "8.11.11"
  }
}
```

> [!NOTE]
> **Prisma ORM 7 (Stable). Upgrade only on purpose.**
> Pinned to `7.10.1`. Do not upgrade without thorough verification.

---

## 3. Pivot Decision: Why Prisma ORM 7 Instead of Prisma ORM 8 RC

During early testing of Prisma ORM 8 (`8.0.0-rc.20` through `8.0.0-rc.28`), the CLI dependency `@prisma/composer-cli` attempted to install heavy cloud orchestration tooling (`alchemy-2.0.0-beta.78.tgz`, ~0.9 GB / ~200 cloud packages) which hung indefinitely on Windows under Bun's package solver ([Issue prisma/prisma-cli#318](https://github.com/prisma/prisma-cli/issues/318)). Because Prisma 8 is still a Release Candidate with unsettled packaging on Windows, the project pivoted to the latest stable release: **Prisma ORM 7 (7.10.1)**.

### Upgrade Path to Prisma ORM 8
When Prisma ORM 8 reaches General Availability (GA) and resolves standalone CLI installation on Windows:
1. Review the official [Migrate from Prisma ORM 7 to Prisma ORM 8 Guide](https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-8).
2. Verify that `bun add prisma@8.x` resolves in less than 30 seconds without installing `@prisma/composer-cli` or cloud runner tarballs.
3. Verify that `prisma contract emit` and `plan-from-state` migrations run cleanly on native Windows without hangs.

---

## 4. Verified Prisma ORM 7 Architecture Facts

Facts below are verified against official Prisma ORM 7 documentation:

1. **Schema & Config Split (`schema.prisma` + `prisma.config.ts`)**:
   - In Prisma ORM 7, the `url` property is removed from `schema.prisma`. Datasource URLs are configured in `prisma.config.ts` via `defineConfig({ datasource: { url: env('DATABASE_URL') } })`.
   - Documentation: [Prisma 7 Config & Datasource](https://pris.ly/d/config-datasource) and [Prisma 7 Client Config](https://pris.ly/d/prisma7-client-config).
2. **Driver Adapters (`@prisma/adapter-pg`)**:
   - Direct database connections use the PostgreSQL driver adapter `@prisma/adapter-pg`.
   - `PrismaPg` accepts direct pool configuration `{ connectionString, max, idleTimeoutMillis, connectionTimeoutMillis }` or an existing `pg.Pool`.
   - Driver adapters are General Availability (GA) in Prisma 7. The preview flag `previewFeatures = ["driverAdapters"]` is no longer required.
3. **Client Generation & Output Directory**:
   - Specifying an explicit `output = "../src/generated/client"` ensures that monorepo packages and CLI scripts import the identical generated client without Bun workspace hoisting conflicts.
4. **Migrations (`prisma migrate dev` & `prisma migrate deploy`)**:
   - `prisma migrate dev --name <slug>` generates SQL DDL migration files under `apps/api/prisma/migrations/<timestamp>_<slug>/migration.sql`.
   - `prisma migrate deploy` applies pending migrations atomically in CI or non-interactive environments.
5. **Transactions & Raw Queries**:
   - Complex ACID operations use `prisma.$transaction(async (tx) => ...)`.
   - Raw queries use `tx.$queryRaw<T>` and `tx.$executeRaw` using tagged template literals which sanitize SQL injection parameters.
6. **Prisma Studio**:
   - Prisma Studio is fully supported in Prisma 7 via `prisma studio --url <url>` on port 5555. pgAdmin 4 remains available as an alternative native Windows management console.

---

## 5. Hot Paths Implementation (`apps/api/src/db/hot-paths.ts`)

Hot paths bypass standard ORM overhead using raw SQL inside transactions:
1. **Version-Checked Update**: Atomic SQL `UPDATE "Entry" ... WHERE id = $1 AND version = $2`. Returns 409 Conflict if zero rows match due to concurrent edit.
2. **Chunk + Manifest + Entry Weight in ONE Transaction**:
   - Order: Pessimistic lock `FOR UPDATE` on `"Entry"`, version pre-condition check, upsert Chunks with canonical SHA-256 hashes, delete orphaned Chunks, upsert `EntryManifest`, update `Entry` weight and version bump.
   - Isolation Level: `READ COMMITTED` with `FOR UPDATE` guarantees complete serialization between writers on the same entry.
3. **Durable Job Lease (`JobLease`)**:
   - Avoids session-level advisory locks which starve connection pools (`pg.Pool`).
   - Uses a durable table row with monotonic fencing token (`token = token + 1`), lease holder ID, and expiration timestamp (`expiresAt`), plus automated heartbeat renewal.
4. **Row-Locking Helper**: `queryRowForUpdate` helper for critical read-modify-write sequences.

---

## 6. Database Operations and Scripts

All database connection strings derive from `.env` (`DATABASE_URL`). Passwords are never logged or exposed.

- `bun run db:create`: Creates database `kaaj_dev` if it does not already exist.
- `bun run db:migrate`: Applies migrations to `kaaj_dev`.
- `bun run db:reset --yes`: Drops, recreates, migrates, and seeds `kaaj_dev`. Refuses databases without `kaaj` prefix.
- `bun run db:seed`: Seeds small dataset (2 categories, 3 entries, 1 image < 100 KB). Refuses non-empty DB unless `--force`.
- `bun run db:seed:big`: Seeds large dataset (8 categories, 250 entries, three 50,000-word documents). Refuses non-empty DB unless `--force`.
- `bun run db:studio`: Starts Prisma Studio on localhost:5555.
- `bun run db:import-files`: Migrates old file store (`data/db-store.json`) into PostgreSQL with pre-import backup and strict canonical JSON verification per entry.
