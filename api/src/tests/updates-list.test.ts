import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../app";
import { prisma } from "../db";
import { createUserWithApps, login, resetDb } from "./helpers";

type Item = { displayName: string; activeJob: { state: string } | null; lastAttempt: { state: string } | null };

describe("Available updates list", () => {
  // Alpha Editor: 1.0.0 → 2.0.0 (update, with a FAILED attempt)   Beta: up to date   Gamma: unsupported
  let alice: Awaited<ReturnType<typeof createUserWithApps>>;
  let asAlice: Awaited<ReturnType<typeof login>>;

  const list = async () => (await asAlice.get("/api/v1/updates").expect(200)).body;
  const names = (body: { items: Item[] }) => body.items.map((i) => i.displayName);

  before(async () => {
    await resetDb();
    alice = await createUserWithApps("alice@test.com", ["Alpha Editor", "Beta Browser", "Gamma Tool"]);
    await createUserWithApps("bob@test.com", ["Bob App", "Bob Tool"]);
    asAlice = await login("alice@test.com");
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it("requires login", async () => {
    await request(app).get("/api/v1/updates").expect(401);
  });

  it("lists only apps with a really newer version, and never other users' apps", async () => {
    const body = await list();
    assert.deepEqual(names(body), ["Alpha Editor"]);
    assert.equal(body.total, 1);

    const item = body.items[0];
    assert.equal(item.installedVersion, "1.0.0");
    assert.equal(item.availableVersion, "2.0.0");
    assert.equal(item.majorUpgrade, true);
    assert.equal(item.device.deviceName, "alice@test.com-PC");
  });

  it("shows the last attempt and a running update", async () => {
    let item: Item = (await list()).items[0];
    assert.equal(item.lastAttempt?.state, "FAILED"); // from the test helper
    assert.equal(item.activeJob, null);

    await prisma.updateJob.create({
      data: {
        applicationId: alice.apps[0].id,
        deviceId: alice.device.id,
        requestedById: alice.user.id,
        fromVersion: "1.0.0",
        targetVersion: "2.0.0",
        state: "RUNNING",
        idempotencyKey: "list-test-running",
      },
    });
    item = (await list()).items[0];
    assert.equal(item.activeJob?.state, "RUNNING");

    await prisma.updateJob.updateMany({ where: { idempotencyKey: "list-test-running" }, data: { state: "CANCELLED" } });
  });

  it("has no 100-app limit", async () => {
    await prisma.application.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({
        deviceId: alice.device.id,
        displayName: `Filler ${String(i).padStart(3, "0")}`,
        localId: `Filler.${i}`,
        installedVersion: "1.0.0",
        matchStatus: "UNMATCHED" as const,
      })),
    });
    await prisma.application.create({
      data: {
        deviceId: alice.device.id,
        displayName: "Zulu Tool",
        localId: "Zulu.Tool",
        packageId: "Zulu.Tool",
        source: "winget",
        installedVersion: "5.0",
        matchStatus: "MATCHED",
      },
    });
    await prisma.releaseMetadata.create({ data: { packageId: "Zulu.Tool", version: "5.1", source: "winget" } });

    const body = await list();
    assert.ok(names(body).includes("Zulu Tool")); // alphabetically last, after 120+ other apps
    assert.equal(body.total, 2);
  });

  it("hides apps on revoked computers", async () => {
    await prisma.device.update({ where: { id: alice.device.id }, data: { status: "REVOKED" } });
    assert.equal((await list()).total, 0);
    await prisma.device.update({ where: { id: alice.device.id }, data: { status: "OFFLINE" } });
  });

  it("lists recent finished updates", async () => {
    const body = await list();
    assert.ok(body.recent.some((r: { displayName: string; state: string }) => r.displayName === "Alpha Editor" && r.state === "FAILED"));
  });

  it("warns before updating a Store-style app", async () => {
    const terminal = await prisma.application.create({
      data: {
        deviceId: alice.device.id,
        displayName: "Windows Terminal",
        localId: "Microsoft.WindowsTerminal",
        packageId: "Microsoft.WindowsTerminal",
        source: "winget",
        installedVersion: "1.24.12741.0",
        matchStatus: "MATCHED",
      },
    });
    await prisma.releaseMetadata.create({
      data: { packageId: "Microsoft.WindowsTerminal", version: "1.25.2733.0", source: "winget" },
    });

    const res = await asAlice.post(`/api/v1/updates/${terminal.id}/preview`).expect(200);
    assert.ok(res.body.warnings.some((w: string) => w.includes("Microsoft Store-style app")));
  });
});