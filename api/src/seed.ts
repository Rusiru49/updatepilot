import { prisma } from "./db";
import { hashPassword } from "./lib/auth";

// ── Helpers ──
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ago = (days: number, hours = 0) => new Date(Date.now() - days * DAY - hours * HOUR);

type SampleApp = {
  displayName: string;
  publisher: string | null;
  installedVersion: string;
  packageId: string | null;
  available?: string; // newer version, if one exists
  previousVersion?: string; // version before an earlier update
  updatedDaysAgo?: number; // when that earlier update happened
  matchStatus?: "MATCHED" | "UNMATCHED" | "UNSUPPORTED";
  changelogUrl?: string;
};

type SampleUpdate = {
  app: string;
  from: string;
  to: string;
  state: "SUCCEEDED" | "FAILED" | "RESTART_REQUIRED" | "CANCELLED";
  days: number;
  hours?: number;
  exitCode: number | null;
  verified: "VERIFIED" | "PENDING" | "NOT_CHECKED";
  error?: string;
};

// ── SAMPLE applications (not real scan results) ──
const apps: SampleApp[] = [
  { displayName: "Google Chrome", publisher: "Google LLC", installedVersion: "129.0.6668.90", packageId: "Google.Chrome", available: "130.0.6723.70", changelogUrl: "https://chromereleases.googleblog.com/" },
  { displayName: "Visual Studio Code", publisher: "Microsoft", installedVersion: "1.93.1", packageId: "Microsoft.VisualStudioCode", available: "1.94.2", changelogUrl: "https://code.visualstudio.com/updates" },
  { displayName: "Zoom Workplace", publisher: "Zoom", installedVersion: "6.1.10", packageId: "Zoom.Zoom", available: "6.2.3" },
  { displayName: "VLC media player", publisher: "VideoLAN", installedVersion: "3.0.21", packageId: "VideoLAN.VLC", changelogUrl: "https://www.videolan.org/vlc/releases/" },
  { displayName: "7-Zip", publisher: "Igor Pavlov", installedVersion: "24.08", packageId: "7zip.7zip", previousVersion: "24.07", updatedDaysAgo: 4 },
  { displayName: "Node.js", publisher: "OpenJS Foundation", installedVersion: "20.17.0", packageId: "OpenJS.NodeJS.LTS", available: "20.18.0", previousVersion: "20.16.0", updatedDaysAgo: 2, changelogUrl: "https://nodejs.org/en/blog/release" },
  { displayName: "Git", publisher: "The Git Project", installedVersion: "2.46.2", packageId: "Git.Git", previousVersion: "2.46.1", updatedDaysAgo: 5, changelogUrl: "https://github.com/git-for-windows/git/releases" },
  { displayName: "Mozilla Firefox", publisher: "Mozilla", installedVersion: "131.0.2", packageId: "Mozilla.Firefox", available: "132.0", changelogUrl: "https://www.mozilla.org/firefox/releases/" },
  { displayName: "Microsoft Edge", publisher: "Microsoft", installedVersion: "130.0.2849.56", packageId: "Microsoft.Edge", previousVersion: "129.0.2792.89", updatedDaysAgo: 4 },
  { displayName: "Python 3.12", publisher: "Python Software Foundation", installedVersion: "3.12.6", packageId: "Python.Python.3.12", available: "3.12.7", changelogUrl: "https://www.python.org/downloads/" },
  { displayName: "Notepad++", publisher: "Notepad++ Team", installedVersion: "8.6.9", packageId: "Notepad++.Notepad++", available: "8.7", changelogUrl: "https://notepad-plus-plus.org/news/" },
  { displayName: "Spotify", publisher: "Spotify AB", installedVersion: "1.2.48.405", packageId: "Spotify.Spotify" },
  { displayName: "Postman", publisher: "Postman", installedVersion: "11.14.0", packageId: "Postman.Postman", available: "11.18.0", changelogUrl: "https://www.postman.com/release-notes/postman-app/" },
  { displayName: "Docker Desktop", publisher: "Docker Inc.", installedVersion: "4.34.2", packageId: "Docker.DockerDesktop", available: "4.35.0", changelogUrl: "https://docs.docker.com/desktop/release-notes/" },
  { displayName: "PuTTY", publisher: "Simon Tatham", installedVersion: "0.81", packageId: "PuTTY.PuTTY" },
  { displayName: "Adobe Acrobat Reader", publisher: "Adobe", installedVersion: "24.003.20112", packageId: "Adobe.Acrobat.Reader.64-bit", available: "24.004.20219" },
  { displayName: "Discord", publisher: "Discord Inc.", installedVersion: "1.0.9166", packageId: "Discord.Discord" },
  { displayName: "WhatsApp", publisher: "WhatsApp Inc.", installedVersion: "2.2438.6.0", packageId: null, matchStatus: "UNMATCHED" },
  { displayName: "Lab Tool (custom)", publisher: null, installedVersion: "2.1.0", packageId: null, matchStatus: "UNSUPPORTED" },
  { displayName: "Company VPN Client", publisher: "Internal IT", installedVersion: "5.2.1", packageId: null, matchStatus: "UNSUPPORTED" },
];

// ── SAMPLE update attempts ──
const updates: SampleUpdate[] = [
  { app: "Git", from: "2.46.1", to: "2.46.2", state: "SUCCEEDED", days: 5, exitCode: 0, verified: "VERIFIED" },
  { app: "7-Zip", from: "24.07", to: "24.08", state: "SUCCEEDED", days: 4, exitCode: 0, verified: "VERIFIED" },
  { app: "Microsoft Edge", from: "129.0.2792.89", to: "130.0.2849.56", state: "SUCCEEDED", days: 4, hours: 3, exitCode: 0, verified: "VERIFIED" },
  { app: "Node.js", from: "20.16.0", to: "20.17.0", state: "RESTART_REQUIRED", days: 2, exitCode: 3010, verified: "PENDING", error: "Installed, but Windows needs a restart to finish (exit code 3010)" },
  { app: "Docker Desktop", from: "4.34.2", to: "4.35.0", state: "FAILED", days: 2, hours: 4, exitCode: 740, verified: "NOT_CHECKED", error: "Administrator approval was declined (exit code 740)" },
  { app: "Zoom Workplace", from: "6.1.10", to: "6.2.3", state: "FAILED", days: 1, exitCode: 1603, verified: "NOT_CHECKED", error: "Installer returned exit code 1603 (the app may be running)" },
  { app: "Mozilla Firefox", from: "131.0.2", to: "132.0", state: "CANCELLED", days: 0, hours: 5, exitCode: null, verified: "NOT_CHECKED", error: "Cancelled by the user before it started" },
];

const UPDATE_EVENT: Record<SampleUpdate["state"], string> = {
  SUCCEEDED: "update.succeeded",
  FAILED: "update.failed",
  RESTART_REQUIRED: "update.restart_required",
  CANCELLED: "update.cancelled",
};

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
      passwordHash: await hashPassword("Demo@12345"),
      displayName: "Demo User (sample)",
      createdAt: ago(10, 2),
      settings: { create: {} },
    },
  });

  // Scans: 10, 6 and 3 days ago, and 2 hours ago
  const scanTimes = [ago(10), ago(6), ago(3), ago(0, 2)];
  const lastScanAt = scanTimes[scanTimes.length - 1];

  const device = await prisma.device.create({
    data: {
      userId: user.id,
      deviceName: "SAMPLE-LAPTOP",
      osVersion: "Windows 11 23H2",
      agentVersion: "0.0.0-sample",
      status: "OFFLINE",
      lastSeenAt: lastScanAt,
      createdAt: ago(10, 1),
    },
  });

  const scans = [];
  for (const finishedAt of scanTimes) {
    const startedAt = new Date(finishedAt.getTime() - 90_000); // scans take ~90 s
    scans.push(
      await prisma.scanJob.create({
        data: {
          deviceId: device.id,
          requestedById: user.id,
          state: "SUCCEEDED",
          appsFound: apps.length,
          createdAt: startedAt,
          startedAt,
          finishedAt,
        },
      }),
    );
  }

  // Applications + the version seen in each scan
  const appIds = new Map<string, string>();
  for (const a of apps) {
    const app = await prisma.application.create({
      data: {
        deviceId: device.id,
        displayName: a.displayName,
        publisher: a.publisher,
        installedVersion: a.installedVersion,
        packageId: a.packageId,
        source: a.packageId ? "winget" : null,
        matchStatus: a.matchStatus ?? (a.packageId ? "MATCHED" : "UNSUPPORTED"),
        firstSeenAt: scanTimes[0],
        lastSeenAt: lastScanAt,
      },
    });
    appIds.set(a.displayName, app.id);

    for (const scan of scans) {
      const updatedAt = a.updatedDaysAgo !== undefined ? ago(a.updatedDaysAgo) : null;
      const version =
        a.previousVersion && updatedAt && scan.finishedAt! < updatedAt ? a.previousVersion : a.installedVersion;
      await prisma.appSnapshot.create({
        data: { scanJobId: scan.id, applicationId: app.id, version, recordedAt: scan.finishedAt! },
      });
    }
  }

  // Newest known version for every matched app
  await prisma.releaseMetadata.createMany({
    data: apps
      .filter((a) => a.packageId)
      .map((a) => ({
        packageId: a.packageId!,
        version: a.available ?? a.installedVersion,
        source: "winget",
        channel: "stable",
        releaseDate: ago(7),
        changelogUrl: a.changelogUrl ?? null,
        fetchedAt: lastScanAt,
      })),
  });

  // Update attempts
  for (const [i, u] of updates.entries()) {
    const applicationId = appIds.get(u.app)!;
    const createdAt = ago(u.days, u.hours ?? 0);
    const finishedAt = u.state === "CANCELLED" ? createdAt : new Date(createdAt.getTime() + 75_000);

    await prisma.updateJob.create({
      data: {
        applicationId,
        deviceId: device.id,
        requestedById: user.id,
        fromVersion: u.from,
        targetVersion: u.to,
        state: u.state,
        idempotencyKey: `seed-update-${i + 1}`,
        exitCode: u.exitCode,
        verifiedVersion: u.state === "SUCCEEDED" ? u.to : null,
        verificationResult: u.verified,
        errorMessage: u.error ?? null,
        createdAt,
        confirmedAt: createdAt,
        startedAt: u.state === "CANCELLED" ? null : createdAt,
        finishedAt,
      },
    });

    await prisma.auditEvent.create({
      data: {
        actorUserId: user.id,
        deviceId: device.id,
        eventType: UPDATE_EVENT[u.state],
        targetType: "application",
        targetId: applicationId,
        metadata: { app: u.app, from: u.from, to: u.to },
        createdAt: finishedAt,
      },
    });
  }

  // Activity for scans + a note that this is sample data
  await prisma.auditEvent.createMany({
    data: [
      ...scans.map((s) => ({
        actorUserId: user.id,
        deviceId: device.id,
        eventType: "scan.completed",
        targetType: "scan",
        targetId: s.id,
        createdAt: s.finishedAt!,
      })),
      {
        actorUserId: user.id,
        deviceId: device.id,
        eventType: "seed.sample_data_created",
        metadata: { note: "Sample data - not real scan results" },
        createdAt: ago(10, 2),
      },
    ],
  });

  console.log(
    `Done: 1 user, 1 device, ${apps.length} applications, ${scans.length} scans, ${updates.length} update attempts (SAMPLE data)`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());