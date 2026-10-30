import request from "supertest";
import app from "../app";
import { prisma } from "../db";
import { hashPassword } from "../lib/auth";

export const PASSWORD = "Test@12345";

// Wipes the database — but ONLY if it's a *_test database (protects your real data)
export async function resetDb() {
  if (!process.env.DATABASE_URL?.includes("_test")) {
    throw new Error("Refusing to reset: DATABASE_URL is not a *_test database. Run tests with `npm test`.");
  }
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
}

export async function createUser(email: string, displayName = "Test User") {
  return prisma.user.create({
    data: { email, displayName, passwordHash: await hashPassword(PASSWORD), settings: { create: {} } },
  });
}

// A user with one device and some apps:
//   1st app → update available (1.0.0 → 2.0.0)
//   middle apps → up to date
//   last app → unsupported (no package)
// Plus one scan and one FAILED update attempt on the 1st app.
export async function createUserWithApps(email: string, appNames: string[]) {
  const user = await createUser(email);
  const device = await prisma.device.create({
    data: { userId: user.id, deviceName: `${email}-PC`, status: "OFFLINE" },
  });

  const apps = [];
  for (const [i, name] of appNames.entries()) {
    const isLast = i === appNames.length - 1;
    const packageId = isLast ? null : `Test.${name.replace(/\s/g, "")}.${user.id.slice(0, 8)}`;
    apps.push(
      await prisma.application.create({
        data: {
          deviceId: device.id,
          displayName: name,
          installedVersion: "1.0.0",
          packageId,
          source: packageId ? "winget" : null,
          matchStatus: packageId ? "MATCHED" : "UNSUPPORTED",
        },
      }),
    );
  }

  const matched = apps.filter((a) => a.packageId);
  await prisma.releaseMetadata.createMany({
    data: matched.map((a, i) => ({ packageId: a.packageId!, version: i === 0 ? "2.0.0" : "1.0.0", source: "winget" })),
  });

  await prisma.scanJob.create({
    data: {
      deviceId: device.id,
      requestedById: user.id,
      state: "SUCCEEDED",
      appsFound: apps.length,
      startedAt: new Date(),
      finishedAt: new Date(),
    },
  });

  await prisma.updateJob.create({
    data: {
      applicationId: apps[0].id,
      deviceId: device.id,
      requestedById: user.id,
      fromVersion: "0.9.0",
      targetVersion: "1.0.0",
      state: "FAILED",
      idempotencyKey: `test-${user.id}`,
      exitCode: 1603,
      verificationResult: "NOT_CHECKED",
    },
  });

  return { user, device, apps };
}

// Logs in and returns a client that keeps the session cookie
export async function login(email: string, password = PASSWORD) {
  const agent = request.agent(app);
  await agent.post("/api/v1/auth/login").send({ email, password }).expect(200);
  return agent;
}