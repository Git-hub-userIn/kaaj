-- CreateTable
CREATE TABLE "ShareLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT 'dev-owner-user',
    "entryId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_token_key" ON "ShareLink"("token");

-- CreateIndex
CREATE INDEX "ShareLink_token_idx" ON "ShareLink"("token");

-- CreateIndex
CREATE INDEX "ShareLink_userId_idx" ON "ShareLink"("userId");

-- CreateIndex
CREATE INDEX "ShareLink_entryId_idx" ON "ShareLink"("entryId");

-- AddForeignKey
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
