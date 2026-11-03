-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "localId" TEXT,
ADD COLUMN     "removedAt" TIMESTAMP(3),
ADD COLUMN     "versionUncertain" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "applications_deviceId_localId_idx" ON "applications"("deviceId", "localId");
