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

---

## 7. User Isolation Architecture

### 7.1 Database Schema Additions
Every persistent entity attaches a `userId` foreign key referencing the `User` table:
1. **User**: `id` (PK, string), `email` (unique), `name`, `createdAt`, `updatedAt`.
2. **Category**: `userId` (FK -> User.id, indexed).
3. **Entry**: `userId` (FK -> User.id, indexed).
4. **Chunk**: `userId` (FK -> User.id, indexed). Composite PK is `(userId, entryId, id)`.
5. **EntryManifest**: `userId` (FK -> User.id, indexed). Unique constraint on `(userId, entryId)`.
6. **AssetMeta**: `userId` (FK -> User.id, indexed). Unique constraint on `(userId, id)`.
7. **MaintenanceState**: `userId` (FK -> User.id, PK or indexed).
8. **JobLease**: `userId` (FK -> User.id, composite PK `(userId, name)`).
9. **EntryRevision**: `id` (PK, string), `userId` (FK -> User.id, indexed), `entryId` (FK -> Entry.id, indexed), `version` (Int), `title` (String), `manifest` (Json), `doc` (Json?), `createdAt` (DateTime). Unique constraint on `(entryId, version)`.

### 7.2 Data Migration and Backfill
The migration creates the default user `dev-owner-user` (`email: dev@kaaj.local`).
All existing records backfill with `userId = 'dev-owner-user'` before applying `NOT NULL` constraints.

---

## 8. Prisma Client Extension vs. PostgreSQL Row Level Security (RLS)

### 8.1 Architectural Selection: Prisma Client Extension
User isolation uses a scoped Prisma client created via `forUser(userId)`:
1. **Implementation**: The extension hooks into `query.$allModels.$allOperations`.
2. **Read Injections**: Automatically injects `{ userId }` into query `where` clauses (`findFirst`, `findMany`, `count`, `aggregate`).
3. **Write Injections**: Automatically injects `{ userId }` into mutation `data` objects (`create`, `createMany`, `update`, `upsert`, `delete`).
4. **Primary Key Mapping**: Translates single-record lookups to `findFirst({ where: { id, userId } })`.
5. **Encapsulation**: The base `PrismaClient` is not exported from `apps/api/src/db/client.ts`. Services only receive scoped clients.

### 8.2 Why Prisma Client Extension Instead of PostgreSQL RLS
1. **Connection Pooling**: PostgreSQL connection pooling (`pg.Pool`) reuses physical TCP connections. Setting session configuration (`SET LOCAL app.current_user_id`) requires transaction wrapping on every single read query.
2. **Portability & Type Safety**: Prisma Client Extensions execute directly in TypeScript with complete type safety.
3. **Future Hardening**: We will add PostgreSQL RLS as defense-in-depth in a later hardening phase.

### 8.3 Raw SQL Isolation in Hot Paths
Raw SQL statements in `apps/api/src/db/hot-paths.ts` require an explicit `userId` parameter:
- `hotPathVersionCheckedUpdateEntry(prisma, { userId, id, ... })`: Adds `WHERE id = $1 AND userId = $2 AND version = $3`.
- `hotPathSaveChunkedEntry(prisma, { userId, entryId, ... })`: Verifies entry ownership with `WHERE id = $1 AND userId = $2 FOR UPDATE`. Writes chunks and manifest with `userId`.
- `JobLeaseManager`: Scopes leases by `userId` and `leaseName`.
- `queryRowForUpdate(prisma, tableName, id, userId)`: Adds `WHERE id = $1 AND userId = $2 FOR UPDATE`.

---

## 9. Soft-Delete and Trash Lifecycle Architecture

### 9.1 Deletion Semantics
1. **Soft Deletion**: Calling delete on an entry sets `deletedAt = NOW()`.
2. **Filtering**: Active queries filter with `WHERE "deletedAt" IS NULL`.
3. **Trash Retention**: Soft-deleted entries remain in trash for a 30-day retention window.
4. **Permanent Purge**: Purging an entry deletes chunks, manifest, and revision snapshots with cascade deletion:
   - Foreign key constraints on `Entry.id` declare `ON DELETE CASCADE` for `Chunk`, `EntryManifest`, and `EntryRevision`.
   - Deleting the `Entry` row permanently purges all associated chunks and revisions in a single transaction.
5. **Scoped Purge**: All purge queries strictly filter by `userId` to enforce isolation.
