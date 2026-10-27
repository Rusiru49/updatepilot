import { prisma } from "./db";
import { hashPassword } from "./lib/auth";

async function main() {
  console.log("Seeding SAMPLE data...");

  // Clear old data (development only). Order matters because of foreign keys.
  await prisma.auditEvent.deleteMany();
  await prisma.appSnapshot.deleteMany();
  await prisma.updateJob.deleteMany();
  await prisma.scanJob.deleteMany();
  await prisma.application.deleteMany();
  await prisma.agentCredential.deleteMany();
  await prisma.device.deleteMany();
  await prisma.userSettings.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.releaseMetadata.deleteMany();

  const user = await prisma.user.create({
    data: {
      email: "demo@updatepilot.local",
      passwordHash: await hashPassword("Demo@12345"), // replaced when login is built
      displayName: "Demo User (sample)",
      settings: { create: {} },
    },
  });

  const device = await prisma.device.create({
    data: {
      userId: user.id,
      deviceName: "SAMPLE-LAPTOP",
      osVersion: "Windows 11 23H2",
      agentVersion: "0.0.0-sample",
      status: "OFFLINE",
    },
  });

  const apps = [
    { displayName: "Google Chrome", publisher: "Google LLC", installedVersion: "129.0.6668.90", packageId: "Google.Chrome" },
    { displayName: "Visual Studio Code", publisher: "Microsoft", installedVersion: "1.93.1", packageId: "Microsoft.VisualStudioCode" },
    { displayName: "Zoom Workplace", publisher: "Zoom", installedVersion: "6.1.10", packageId: "Zoom.Zoom" },
    { displayName: "VLC media player", publisher: "VideoLAN", installedVersion: "3.0.21", packageId: "VideoLAN.VLC" },
    { displayName: "7-Zip", publisher: "Igor Pavlov", installedVersion: "24.08", packageId: "7zip.7zip" },
    { displayName: "Node.js", publisher: "OpenJS Foundation", installedVersion: "20.17.0", packageId: "OpenJS.NodeJS.LTS" },
    { displayName: "Git", publisher: "The Git Project", installedVersion: "2.46.2", packageId: "Git.Git" },
    { displayName: "Lab Tool (custom)", publisher: null, installedVersion: "2.1.0", packageId: null },
  ];

  const scan = await prisma.scanJob.create({
    data: {
      deviceId: device.id,
      requestedById: user.id,
      state: "SUCCEEDED",
      appsFound: apps.length,
      startedAt: new Date(),
      finishedAt: new Date(),
    },
  });

  const created = new Map<string, string>();
  for (const a of apps) {
    const app = await prisma.application.create({
      data: {
        deviceId: device.id,
        ...a,
        source: a.packageId ? "winget" : null,
        matchStatus: a.packageId ? "MATCHED" : "UNSUPPORTED",
      },
    });
    created.set(a.displayName, app.id);
    await prisma.appSnapshot.create({
      data: { scanJobId: scan.id, applicationId: app.id, version: a.installedVersion },
    });
  }

  // Sample update attempts: one success, one failure
  await prisma.updateJob.createMany({
    data: [
      {
        applicationId: created.get("7-Zip")!,
        deviceId: device.id,
        requestedById: user.id,
        fromVersion: "24.07",
        targetVersion: "24.08",
        state: "SUCCEEDED",
        idempotencyKey: "seed-update-1",
        exitCode: 0,
        verifiedVersion: "24.08",
        verificationResult: "VERIFIED",
        confirmedAt: new Date(),
        startedAt: new Date(),
        finishedAt: new Date(),
      },
      {
        applicationId: created.get("Zoom Workplace")!,
        deviceId: device.id,
        requestedById: user.id,
        fromVersion: "6.1.10",
        targetVersion: "6.2.3",
        state: "FAILED",
        idempotencyKey: "seed-update-2",
        exitCode: 1603,
        verificationResult: "NOT_CHECKED",
        errorMessage: "Installer returned exit code 1603 (the app may be running)",
        confirmedAt: new Date(),
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    ],
  });

  const releases: [string, string][] = [
    ["Google.Chrome", "130.0.6723.70"],
    ["Microsoft.VisualStudioCode", "1.94.2"],
    ["Zoom.Zoom", "6.2.3"],
    ["VideoLAN.VLC", "3.0.21"],
    ["7zip.7zip", "24.08"],
    ["OpenJS.NodeJS.LTS", "20.18.0"],
    ["Git.Git", "2.46.2"],
  ];
  await prisma.releaseMetadata.createMany({
    data: releases.map(([packageId, version]) => ({ packageId, version, source: "winget", channel: "stable" })),
  });

  await prisma.auditEvent.create({
    data: {
      actorUserId: user.id,
      deviceId: device.id,
      eventType: "seed.sample_data_created",
      metadata: { note: "Sample data - not real scan results" },
    },
  });

  console.log(`Done: 1 user, 1 device, ${apps.length} applications (SAMPLE data)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());