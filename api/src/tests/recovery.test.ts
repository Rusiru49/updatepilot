import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../app";
import { prisma } from "../db";
import { failJobsOfLostAgents } from "../lib/recovery";
import { createUser, login, resetDb } from "./helpers";

describe("Interrupted jobs", () => {
  let token: string;
  let deviceId: string;

  before(async () => {
    await resetDb();
    await createUser("bob@test.com");
    const user = await login("bob@test.com");
    const pc = await user.post("/api/v1/devices/pairing-codes").expect(201);

    const paired = await request(app)
      .post("/api/v1/agent/pair")
      .send({ code: pc.body.code, deviceName: "Test PC", hostname: "TEST-PC", osVersion: "Windows 11" })
      .expect(201);
    token = paired.body.agentToken ?? paired.body.token;
    assert.ok(token, "pairing should return an agent key");

    const bob = await prisma.user.findUniqueOrThrow({ where: { email: "bob@test.com" } });
    deviceId = (await prisma.device.findFirstOrThrow({ where: { userId: bob.id } })).id;
  });

  beforeEach(async () => {
    // Start every test with no scans and a fresh heartbeat
    await prisma.scanJob.deleteMany({ where: { deviceId } });
    await prisma.device.update({ where: { id: deviceId }, data: { lastSeenAt: new Date() } });
  });

  after(async () => {
    await prisma.$disconnect();
  });

  const runningScan = () => prisma.scanJob.create({ data: { deviceId, state: "RUNNING" } });
  const reload = (id: string) => prisma.scanJob.findUniqueOrThrow({ where: { id } });
  const hello = () => request(app).post("/api/v1/agent/hello").set("Authorization", `Bearer ${token}`);
  const goodbye = () => request(app).post("/api/v1/agent/goodbye").set("Authorization", `Bearer ${token}`);

  it("agent restart closes its running scan straight away", async () => {
    const scan = await runningScan();
    const res = await hello().expect(200);
    assert.equal(res.body.closed.scans, 1);

    const updated = await reload(scan.id);
    assert.equal(updated.state, "FAILED");
    assert.match(updated.errorSummary ?? "", /restarted/);
    assert.ok(updated.finishedAt);
  });

  it("agent restart leaves queued scans alone (the agent will pick them up)", async () => {
    const scan = await prisma.scanJob.create({ data: { deviceId, state: "QUEUED" } });
    await hello().expect(200);
    assert.equal((await reload(scan.id)).state, "QUEUED");
  });

  it("agent stop (Ctrl+C) closes its running scan", async () => {
    const scan = await runningScan();
    await goodbye().expect(204);

    const updated = await reload(scan.id);
    assert.equal(updated.state, "FAILED");
    assert.match(updated.errorSummary ?? "", /stopped/);
  });

  it("no heartbeat for 3+ minutes closes the job", async () => {
    const scan = await runningScan();
    await prisma.device.update({
      where: { id: deviceId },
      data: { lastSeenAt: new Date(Date.now() - 10 * 60 * 1000) }, // last seen 10 minutes ago
    });

    assert.equal(await failJobsOfLostAgents(), 1);
    const updated = await reload(scan.id);
    assert.equal(updated.state, "FAILED");
    assert.match(updated.errorSummary ?? "", /stopped responding/);
  });

  it("a recent heartbeat keeps a long job running", async () => {
    const scan = await runningScan();
    assert.equal(await failJobsOfLostAgents(), 0);
    assert.equal((await reload(scan.id)).state, "RUNNING");
  });

  it("hello and goodbye need the agent key", async () => {
    await request(app).post("/api/v1/agent/hello").expect(401);
    await request(app).post("/api/v1/agent/goodbye").expect(401);
  });
});