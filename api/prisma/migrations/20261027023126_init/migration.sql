-- CreateEnum
CREATE TYPE "Theme" AS ENUM ('LIGHT', 'DARK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('ONLINE', 'OFFLINE', 'REVOKED');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('MATCHED', 'UNMATCHED', 'UNSUPPORTED');

-- CreateEnum
CREATE TYPE "JobState" AS ENUM ('QUEUED', 'SENT_TO_AGENT', 'RUNNING', 'VERIFYING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'RESTART_REQUIRED');

-- CreateEnum
CREATE TYPE "VerificationResult" AS ENUM ('PENDING', 'VERIFIED', 'MISMATCH', 'NOT_CHECKED');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'UNKNOWN');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "userId" UUID NOT NULL,
    "theme" "Theme" NOT NULL DEFAULT 'SYSTEM',
    "autoScanEnabled" BOOLEAN NOT NULL DEFAULT true,
    "scanIntervalHours" INTEGER NOT NULL DEFAULT 24,
    "requireConfirmation" BOOLEAN NOT NULL DEFAULT true,
    "notificationsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "retentionDays" INTEGER NOT NULL DEFAULT 90,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deviceName" TEXT NOT NULL,
    "osVersion" TEXT,
    "agentVersion" TEXT,
    "status" "DeviceStatus" NOT NULL DEFAULT 'OFFLINE',
    "lastSeenAt" TIMESTAMP(3),
    "pairedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_credentials" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "credentialHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "rotatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "agent_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "displayName" TEXT NOT NULL,
    "publisher" TEXT,
    "installedVersion" TEXT,
    "packageId" TEXT,
    "source" TEXT,
    "matchStatus" "MatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_jobs" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "requestedById" UUID,
    "state" "JobState" NOT NULL DEFAULT 'QUEUED',
    "appsFound" INTEGER,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_snapshots" (
    "id" UUID NOT NULL,
    "scanJobId" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "update_jobs" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "requestedById" UUID,
    "fromVersion" TEXT NOT NULL,
    "targetVersion" TEXT NOT NULL,
    "state" "JobState" NOT NULL DEFAULT 'QUEUED',
    "idempotencyKey" TEXT NOT NULL,
    "exitCode" INTEGER,
    "verifiedVersion" TEXT,
    "verificationResult" "VerificationResult" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "update_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "release_metadata" (
    "id" UUID NOT NULL,
    "packageId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "channel" TEXT,
    "releaseDate" DATE,
    "changelogUrl" TEXT,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "release_metadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_findings" (
    "id" UUID NOT NULL,
    "packageId" TEXT NOT NULL,
    "advisoryId" TEXT NOT NULL,
    "severity" "Severity" NOT NULL DEFAULT 'UNKNOWN',
    "affectedRange" TEXT,
    "source" TEXT NOT NULL,
    "lastVerifiedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "security_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "actorUserId" UUID,
    "deviceId" UUID,
    "eventType" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "devices_userId_idx" ON "devices"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_credentials_credentialHash_key" ON "agent_credentials"("credentialHash");

-- CreateIndex
CREATE INDEX "agent_credentials_deviceId_idx" ON "agent_credentials"("deviceId");

-- CreateIndex
CREATE INDEX "applications_deviceId_idx" ON "applications"("deviceId");

-- CreateIndex
CREATE INDEX "applications_packageId_idx" ON "applications"("packageId");

-- CreateIndex
CREATE INDEX "scan_jobs_deviceId_createdAt_idx" ON "scan_jobs"("deviceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "app_snapshots_scanJobId_applicationId_key" ON "app_snapshots"("scanJobId", "applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "update_jobs_idempotencyKey_key" ON "update_jobs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "update_jobs_deviceId_createdAt_idx" ON "update_jobs"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "release_metadata_packageId_idx" ON "release_metadata"("packageId");

-- CreateIndex
CREATE UNIQUE INDEX "release_metadata_packageId_version_source_key" ON "release_metadata"("packageId", "version", "source");

-- CreateIndex
CREATE INDEX "security_findings_packageId_idx" ON "security_findings"("packageId");

-- CreateIndex
CREATE UNIQUE INDEX "security_findings_packageId_advisoryId_key" ON "security_findings"("packageId", "advisoryId");

-- CreateIndex
CREATE INDEX "audit_events_createdAt_idx" ON "audit_events"("createdAt");

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_jobs" ADD CONSTRAINT "scan_jobs_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_jobs" ADD CONSTRAINT "scan_jobs_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_snapshots" ADD CONSTRAINT "app_snapshots_scanJobId_fkey" FOREIGN KEY ("scanJobId") REFERENCES "scan_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_snapshots" ADD CONSTRAINT "app_snapshots_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "update_jobs" ADD CONSTRAINT "update_jobs_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "update_jobs" ADD CONSTRAINT "update_jobs_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "update_jobs" ADD CONSTRAINT "update_jobs_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
