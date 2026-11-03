-- CreateTable User
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- Seed initial default user
INSERT INTO "User" ("id", "email", "name", "createdAt", "updatedAt")
VALUES ('dev-owner-user', 'dev@kaaj.local', 'Dev Owner', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Alter Category
ALTER TABLE "Category" ADD COLUMN "userId" TEXT NOT NULL DEFAULT 'dev-owner-user';
CREATE INDEX "Category_userId_idx" ON "Category"("userId");
ALTER TABLE "Category" ADD CONSTRAINT "Category_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Alter Entry
ALTER TABLE "Entry" ADD COLUMN "userId" TEXT NOT NULL DEFAULT 'dev-owner-user';
CREATE INDEX "Entry_userId_idx" ON "Entry"("userId");
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Alter EntryManifest
ALTER TABLE "EntryManifest" ADD COLUMN "userId" TEXT NOT NULL DEFAULT 'dev-owner-user';
CREATE INDEX "EntryManifest_userId_idx" ON "EntryManifest"("userId");
ALTER TABLE "EntryManifest" ADD CONSTRAINT "EntryManifest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Alter Chunk
ALTER TABLE "Chunk" ADD COLUMN "userId" TEXT NOT NULL DEFAULT 'dev-owner-user';
CREATE INDEX "Chunk_userId_idx" ON "Chunk"("userId");
ALTER TABLE "Chunk" ADD CONSTRAINT "Chunk_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Alter AssetMeta
ALTER TABLE "AssetMeta" ADD COLUMN "userId" TEXT NOT NULL DEFAULT 'dev-owner-user';
CREATE INDEX "AssetMeta_userId_idx" ON "AssetMeta"("userId");
ALTER TABLE "AssetMeta" ADD CONSTRAINT "AssetMeta_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Alter MaintenanceState
ALTER TABLE "MaintenanceState" ADD COLUMN "userId" TEXT NOT NULL DEFAULT 'dev-owner-user';
ALTER TABLE "MaintenanceState" DROP CONSTRAINT IF EXISTS "MaintenanceState_pkey";
ALTER TABLE "MaintenanceState" ADD CONSTRAINT "MaintenanceState_pkey" PRIMARY KEY ("userId", "id");
CREATE INDEX "MaintenanceState_userId_idx" ON "MaintenanceState"("userId");
ALTER TABLE "MaintenanceState" ADD CONSTRAINT "MaintenanceState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Alter JobLease
ALTER TABLE "JobLease" ADD COLUMN "userId" TEXT NOT NULL DEFAULT 'dev-owner-user';
ALTER TABLE "JobLease" DROP CONSTRAINT IF EXISTS "JobLease_pkey";
ALTER TABLE "JobLease" ADD CONSTRAINT "JobLease_pkey" PRIMARY KEY ("userId", "name");
CREATE INDEX "JobLease_userId_idx" ON "JobLease"("userId");
ALTER TABLE "JobLease" ADD CONSTRAINT "JobLease_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
