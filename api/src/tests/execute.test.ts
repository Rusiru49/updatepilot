import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import request from "supertest";
import app from "../app";
import { prisma } from "../db";
import { sha256 } from "../lib/auth";
import { createUserWithApps, login, resetDb } from "./helpers";

type UserAgent = Awaited<ReturnType<typeof login>>;

describe("Running updates: execute → agent → verified result", () => {
  // Alpha Editor: 1.0.0 → 2.0.0 (update)   Beta Browser: up to date   Gamma Tool: unsupported
  let alice: Awaited<ReturnType<typeof createUserWithApps>>;
  let asAlice: UserAgent;
  let asBob: UserAgent;
  let alphaId = "";
  let agentToken = "";

  const newKey = () => crypto.randomUUID();

  async function previewToken(appId = alphaId) {
    const res = await asAlice.post(`/api/v1/updates/${appId}/preview`).expect(200);
    return res.body.previewToken as string;
  }

  function execute(token: string, key = newKey(), appId = alphaId, as: UserAgent = asAlice) {
    return as.post(`/api/v1/updates/${appId}/execute`).set("Idempotency-Key", key).send({ previewToken: token, confirm: true });
  }

  const agentPost = (path: string, body: unknown = {}) =>
    request(app).post(`/api/v1/agent${path}`).set("Authorization", `Bearer ${agentToken}`).send(body as object);

  async function setOnline(online = true) {
    await prisma.device.update({
      where: { id: alice.device.id },
      data: { lastSeenAt: online ? new Date() : new Date(Date.now() - 10 * 60 * 1000) },
    });
  }

  // Put Alpha back to 1.0.0 with no running updates
  async function resetAlpha() {
    await prisma.updateJob.updateMany({
      where: { deviceId: alice.device.id, state: { in: ["QUEUED", "SENT_TO_AGENT", "RUNNING", "VERIFYING"] } },
      data: { state: "CANCELLED" },
    });
    await prisma.application.update({ where: { id: alphaId }, data: { installedVersion: "1.0.0" } });
    await setOnline();
  }

  async function startAndClaim() {
    await resetAlpha();
    const res = await execute(await previewToken()).expect(202);
    const next = await agentPost("/jobs/next").expect(200);
    assert.equal(next.body.job.id, res.body.updateJobId);
    return res.body.updateJobId as string;
  }

  const getJob = (id: string) => asAlice.get(`/api/v1/updates/jobs/${id}`).expect(200);

  before(async () => {
    await resetDb();
    alice = await createUserWithApps("alice@test.com", ["Alpha Editor", "Beta Browser", "Gamma Tool"]);
    await createUserWithApps("bob@test.com", ["Bob App", "Bob Tool"]);
    asAlice = await login("alice@test.com");
    asBob = await login("bob@test.com");
    alphaId = alice.apps[0].id;

    // An agent key for Alice's computer
    agentToken = `upa_${crypto.randomBytes(32).toString("base64url")}`;
    await prisma.agentCredential.create({ data: { deviceId: alice.device.id, credentialHash: sha256(agentToken) } });
    await setOnline();
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it("needs a valid preview token and an Idempotency-Key", async () => {
    const token = await previewToken();
    await asAlice.post(`/api/v1/updates/${alphaId}/execute`).send({ previewToken: token, confirm: true }).expect(400);
    await execute("not-a-token").expect(400);
    const res = await execute(`upp_${"x".repeat(32)}`).expect(400);
    assert.equal(res.body.error.code, "INVALID_PREVIEW");
  });

  it("won't start while the agent is offline, and keeps the confirmation usable", async () => {
    await resetAlpha();
    const token = await previewToken();
    await setOnline(false);
    const offline = await execute(token).expect(503);
    assert.equal(offline.body.error.code, "AGENT_OFFLINE");

    await setOnline();
    await execute(token).expect(202); // the same token still works
  });

  it("a confirmation works once; the same request twice returns the same job", async () => {
    await resetAlpha();
    const token = await previewToken();
    const key = newKey();

    const first = await execute(token, key).expect(202);
    const again = await execute(token, key).expect(202);
    assert.equal(again.body.updateJobId, first.body.updateJobId); // double-click → one update

    const reused = await execute(token).expect(410);
    assert.equal(reused.body.error.code, "PREVIEW_EXPIRED");

    const preview = await prisma.updatePreview.findUniqueOrThrow({ where: { tokenHash: sha256(token) } });
    assert.ok(preview.usedAt);
  });

  it("rejects an expired confirmation", async () => {
    await resetAlpha();
    const token = await previewToken();
    await prisma.updatePreview.update({ where: { tokenHash: sha256(token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await execute(token).expect(410);
  });

  it("rejects it if the app changed after the user reviewed it", async () => {
    await resetAlpha();
    const token = await previewToken();
    await prisma.application.update({ where: { id: alphaId }, data: { installedVersion: "1.5.0" } });
    const res = await execute(token).expect(409);
    assert.equal(res.body.error.code, "VERSION_CHANGED");
  });

  it("other users can't use the confirmation or see the update", async () => {
    await resetAlpha();
    const token = await previewToken();
    await execute(token, newKey(), alphaId, asBob).expect(400);

    const res = await execute(token).expect(202);
    await asBob.get(`/api/v1/updates/jobs/${res.body.updateJobId}`).expect(404);
  });

  it("the agent gets exactly the approved package and version", async () => {
    await resetAlpha();
    const started = await execute(await previewToken()).expect(202);
    const next = await agentPost("/jobs/next").expect(200);

    assert.deepEqual(next.body.job, {
      id: started.body.updateJobId,
      type: "update",
      packageId: alice.apps[0].packageId,
      fromVersion: "1.0.0",
      targetVersion: "2.0.0",
    });
    assert.equal((await getJob(started.body.updateJobId)).body.state, "RUNNING");
  });

  it("a verified update succeeds and the app becomes up to date", async () => {
    const jobId = await startAndClaim();
    await agentPost(`/updates/${jobId}/progress`, { state: "VERIFYING" }).expect(204);
    assert.equal((await getJob(jobId)).body.state, "VERIFYING");

    const res = await agentPost(`/updates/${jobId}/result`, {
      exitCode: 0,
      restartRequired: false,
      verifiedVersion: "2.0.0",
      error: null,
    }).expect(200);
    assert.equal(res.body.state, "SUCCEEDED");

    const job = (await getJob(jobId)).body;
    assert.equal(job.verificationResult, "VERIFIED");
    assert.equal(job.verifiedVersion, "2.0.0");

    const list = await asAlice.get("/api/v1/applications?search=Alpha").expect(200);
    assert.equal(list.body.items[0].installedVersion, "2.0.0");
    assert.equal(list.body.items[0].updateStatus, "up_to_date");

    // A result can't be sent twice
    await agentPost(`/updates/${jobId}/result`, { exitCode: 0, restartRequired: false, verifiedVersion: "2.0.0", error: null }).expect(409);
  });

  it("installer says OK but the version didn't change → FAILED (mismatch)", async () => {
    const jobId = await startAndClaim();
    const res = await agentPost(`/updates/${jobId}/result`, {
      exitCode: 0,
      restartRequired: false,
      verifiedVersion: "1.0.0",
      error: null,
    }).expect(200);
    assert.equal(res.body.state, "FAILED");

    const job = (await getJob(jobId)).body;
    assert.equal(job.verificationResult, "MISMATCH");
    assert.match(job.errorMessage, /reported success/);
  });

  it("records restart-required", async () => {
    const jobId = await startAndClaim();
    const res = await agentPost(`/updates/${jobId}/result`, {
      exitCode: 3010,
      restartRequired: true,
      verifiedVersion: "1.0.0",
      error: null,
    }).expect(200);
    assert.equal(res.body.state, "RESTART_REQUIRED");
    assert.equal((await getJob(jobId)).body.verificationResult, "PENDING");
  });

  it("records a failed installer with its message", async () => {
    const jobId = await startAndClaim();
    await agentPost(`/updates/${jobId}/result`, {
      exitCode: 1603,
      restartRequired: false,
      verifiedVersion: "1.0.0",
      error: "The installer failed (often because the app is running). Close the app and try again",
    }).expect(200);

    const job = (await getJob(jobId)).body;
    assert.equal(job.state, "FAILED");
    assert.equal(job.exitCode, 1603);
    assert.match(job.errorMessage, /Close the app/);
  });

  it("only one update at a time on a computer", async () => {
    await resetAlpha();
    await execute(await previewToken()).expect(202); // Alpha is queued

    // Make Beta updatable too, then try to start it
    const beta = alice.apps[1];
    await prisma.releaseMetadata.create({
      data: { packageId: beta.packageId!, version: "1.1.0", source: "winget", fetchedAt: new Date(Date.now() + 1000) },
    });
    const res = await execute(await previewToken(beta.id), newKey(), beta.id).expect(409);
    assert.equal(res.body.error.code, "DEVICE_BUSY");
  });
});