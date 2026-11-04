import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../app";
import { prisma } from "../db";
import { sha256 } from "../lib/auth";
import { createUserWithApps, login, resetDb } from "./helpers";

describe("Update preview", () => {
  // Alpha Editor: 1.0.0 → 2.0.0 (update)   Beta Browser: up to date   Gamma Tool: unsupported
  let alice: Awaited<ReturnType<typeof createUserWithApps>>;
  let bob: Awaited<ReturnType<typeof createUserWithApps>>;
  let asAlice: Awaited<ReturnType<typeof login>>;

  const preview = (appId: string) => asAlice.post(`/api/v1/updates/${appId}/preview`);

  before(async () => {
    await resetDb();
    alice = await createUserWithApps("alice@test.com", ["Alpha Editor", "Beta Browser", "Gamma Tool"]);
    bob = await createUserWithApps("bob@test.com", ["Bob App", "Bob Tool"]);
    asAlice = await login("alice@test.com");
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it("requires login", async () => {
    await request(app).post(`/api/v1/updates/${alice.apps[0].id}/preview`).expect(401);
  });

  it("previews a real update and stores only a hash of the one-time token", async () => {
    const res = await preview(alice.apps[0].id).expect(200);
    assert.equal(res.body.fromVersion, "1.0.0");
    assert.equal(res.body.targetVersion, "2.0.0");
    assert.equal(res.body.application.packageId, alice.apps[0].packageId);
    assert.ok(res.body.previewToken.startsWith("upp_"));

    const stored = await prisma.updatePreview.findUnique({ where: { tokenHash: sha256(res.body.previewToken) } });
    assert.ok(stored);
    assert.equal(stored.usedAt, null);
    assert.ok(stored.expiresAt.getTime() - Date.now() <= 5 * 60 * 1000);
    assert.equal(await prisma.updatePreview.findUnique({ where: { tokenHash: res.body.previewToken } }), null);
  });

  it("warns about a major version upgrade", async () => {
    const res = await preview(alice.apps[0].id).expect(200);
    assert.ok(res.body.warnings.some((w: string) => w.includes("major version upgrade (1 → 2)")));
  });

  it("keeps only one active preview per app", async () => {
    await preview(alice.apps[0].id).expect(200);
    await preview(alice.apps[0].id).expect(200);
    const active = await prisma.updatePreview.count({ where: { applicationId: alice.apps[0].id, usedAt: null } });
    assert.equal(active, 1);
  });

  it("returns 404 for another user's app", async () => {
    await preview(bob.apps[0].id).expect(404);
  });

  it("refuses apps that aren't trusted WinGet packages", async () => {
    const res = await preview(alice.apps[2].id).expect(422);
    assert.equal(res.body.error.code, "UPDATE_NOT_SUPPORTED");
  });

  it("refuses apps that are already up to date", async () => {
    const res = await preview(alice.apps[1].id).expect(409);
    assert.equal(res.body.error.code, "ALREADY_UP_TO_DATE");
  });

  it("uses real version comparison: 1.10 is NOT older than 1.9", async () => {
    const beta = alice.apps[1];
    await prisma.application.update({ where: { id: beta.id }, data: { installedVersion: "1.10.0" } });
    await prisma.releaseMetadata.create({
      data: { packageId: beta.packageId!, version: "1.9.0", source: "winget", fetchedAt: new Date(Date.now() + 1000) },
    });

    const list = await asAlice.get("/api/v1/applications?search=Beta").expect(200);
    assert.equal(list.body.items[0].updateStatus, "up_to_date");
    await preview(beta.id).expect(409);
  });

  it("refuses apps whose version can't be compared", async () => {
    const beta = alice.apps[1];
    await prisma.application.update({ where: { id: beta.id }, data: { versionUncertain: true } });
    const res = await preview(beta.id).expect(422);
    assert.equal(res.body.error.code, "VERSION_UNKNOWN");
  });

  it("refuses while an update for the app is already running", async () => {
    await prisma.updateJob.create({
      data: {
        applicationId: alice.apps[0].id,
        deviceId: alice.device.id,
        requestedById: alice.user.id,
        fromVersion: "1.0.0",
        targetVersion: "2.0.0",
        state: "QUEUED",
        idempotencyKey: "test-running-update",
      },
    });
    const res = await preview(alice.apps[0].id).expect(409);
    assert.equal(res.body.error.code, "UPDATE_IN_PROGRESS");
  });
});