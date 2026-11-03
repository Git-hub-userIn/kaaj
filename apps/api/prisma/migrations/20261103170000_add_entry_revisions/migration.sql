-- DropIndex
DROP INDEX IF EXISTS "Chunk_entryId_order_key";

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "EntryRevision" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT 'dev-owner-user',
    "entryId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "doc" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntryRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EntryRevision_userId_idx" ON "EntryRevision"("userId");

-- CreateIndex
CREATE INDEX "EntryRevision_entryId_idx" ON "EntryRevision"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "EntryRevision_entryId_version_key" ON "EntryRevision"("entryId", "version");

-- AddForeignKey
ALTER TABLE "EntryRevision" ADD CONSTRAINT "EntryRevision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntryRevision" ADD CONSTRAINT "EntryRevision_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
