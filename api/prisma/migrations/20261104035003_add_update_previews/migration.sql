-- CreateTable
CREATE TABLE "update_previews" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "packageId" TEXT NOT NULL,
    "fromVersion" TEXT NOT NULL,
    "targetVersion" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "update_previews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "update_previews_tokenHash_key" ON "update_previews"("tokenHash");

-- CreateIndex
CREATE INDEX "update_previews_applicationId_idx" ON "update_previews"("applicationId");

-- AddForeignKey
ALTER TABLE "update_previews" ADD CONSTRAINT "update_previews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "update_previews" ADD CONSTRAINT "update_previews_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
