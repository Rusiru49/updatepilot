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

    // CHECK: use the same pair body, status and token field as in your agent.test.ts
    const paired = await request(app)
      .post("/api/v1/agent/pair")
      .send({ code: pc.body.code, deviceName: "Test PC", hostname: "TEST-PC", osVersion: "Windows 11" })
      .expect(201);
    token = paired.body.token;

    const bob = await prisma.user.findUniqueOrThrow({ where: { email: "bob@test.com" } });
    deviceId = (await prisma.device.findFirstOrThrow({ where: { userId: bob.id } })).id;
  });

  beforeEach(async () => {
    await prisma.scanJob.deleteMany({ where: { deviceId } });
    await prisma.device.update({ where: { id: deviceId }, data: { lastSeenAt: new Date() } }); // CHECK
  });

  after(async () => {
    await prisma.$disconnect();
  });

  const runningScan = () => prisma.scanJob.create({ data: { deviceId, status: "RUNNING" } });
  const reload = (id: string) => prisma.scanJob.findUniqueOrThrow({ where: { id } });

  it("agent restart closes its running scan straight away", async () => {
    const scan = await runningScan();
    await request(app).post("/api/v1/agent/hello").set("Authorization", `Bearer ${token}`).expect(200);
    const after = await reload(scan.id);
    assert.equal(after.status, "FAILED");
    assert.match(after.errorSummary ?? "", /restarted/);
  });

  it("agent restart leaves queued scans alone (the agent will pick them up)", async () => {
    const scan = await prisma.scanJob.create({ data: { deviceId, status: "QUEUED" } });
    await request(app).post("/api/v1/agent/hello").set("Authorization", `Bearer ${token}`).expect(200);
    assert.equal((await reload(scan.id)).status, "QUEUED");
  });

  it("agent stop (Ctrl+C) closes its running scan", async () => {
    const scan = await runningScan();
    await request(app).post("/api/v1/agent/goodbye").set("Authorization", `Bearer ${token}`).expect(204);
    const after = await reload(scan.id);
    assert.equal(after.status, "FAILED");
    assert.match(after.errorSummary ?? "", /stopped/);
  });

  it("no heartbeat for 3+ minutes closes the job", async () => {
    const scan = await runningScan();
    await prisma.device.update({
      where: { id: deviceId },
      data: { lastSeenAt: new Date(Date.now() - 10 * 60 * 1000) }, // CHECK
    });
    assert.equal(await failJobsOfLostAgents(), 1);
    const after = await reload(scan.id);
    assert.equal(after.status, "FAILED");
    assert.match(after.errorSummary ?? "", /stopped responding/);
  });

  it("a recent heartbeat keeps a long job running", async () => {
    const scan = await runningScan();
    assert.equal(await failJobsOfLostAgents(), 0);
    assert.equal((await reload(scan.id)).status, "RUNNING");
  });

  it("hello and goodbye need the agent key", async () => {
    await request(app).post("/api/v1/agent/hello").expect(401);
    await request(app).post("/api/v1/agent/goodbye").expect(401);
  });
});