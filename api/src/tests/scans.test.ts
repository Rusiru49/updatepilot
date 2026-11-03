import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../app";
import { prisma } from "../db";
import { createUser, login, resetDb } from "./helpers";

type UserAgent = Awaited<ReturnType<typeof login>>;
type ScannedApp = {
  displayName: string;
  localId: string;
  packageId: string | null;
  installedVersion: string;
  availableVersion: string | null;
  source: string | null;
  matchStatus: "MATCHED" | "UNMATCHED" | "UNSUPPORTED";
  versionUncertain: boolean;
};

const scanned = (displayName: string, localId: string, installedVersion: string, extra: Partial<ScannedApp> = {}): ScannedApp => ({
  displayName,
  localId,
  packageId: null,
  installedVersion,
  availableVersion: null,
  source: null,
  matchStatus: "UNMATCHED",
  versionUncertain: false,
  ...extra,
});

const winget = (name: string, id: string, version: string, available: string | null = null) =>
  scanned(name, id, version, { packageId: id, availableVersion: available, source: "winget", matchStatus: "MATCHED" });

const FIRST_SCAN = [
  winget("Git", "Git.Git", "2.56.0.2", "2.56.0.4"),
  winget("VLC media player", "VideoLAN.VLC", "3.0.24"),
  scanned("Google Chrome", String.raw`ARP\Machine\X86\Google Chrome`, "156.0.8078.79"),
  scanned("Paint", "MSIX\\Microsoft.Paint_11…", "11.2605.81.0", { matchStatus: "UNSUPPORTED" }),
];

describe("Scan jobs: dashboard → agent → results", () => {
  let asAlice: UserAgent;
  let asBob: UserAgent;
  let token = "";
  let deviceId = "";

  const agentPost = (path: string, body: unknown = {}) =>
    request(app).post(`/api/v1/agent${path}`).set("Authorization", `Bearer ${token}`).send(body as object);

  const appsOf = async () =>
    (await asAlice.get(`/api/v1/applications?deviceId=${deviceId}&pageSize=100`).expect(200)).body;

  async function startAndClaim() {
    const start = await asAlice.post(`/api/v1/devices/${deviceId}/scans`).expect(202);
    const next = await agentPost("/jobs/next").expect(200);
    assert.equal(next.body.job.id, start.body.scanJobId);
    return start.body.scanJobId as string;
  }

  before(async () => {
    await resetDb();
    await createUser("alice@test.com");
    await createUser("bob@test.com");
    asAlice = await login("alice@test.com");
    asBob = await login("bob@test.com");

    const code = (await asAlice.post("/api/v1/devices/pairing-codes").expect(201)).body.code;
    const paired = await request(app)
      .post("/api/v1/agent/pair")
      .send({ code, deviceName: "REAL-PC", agentVersion: "0.1.0" })
      .expect(201);
    token = paired.body.agentToken;
    deviceId = paired.body.deviceId;
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it("the agent gets 204 when there is no work", async () => {
    await agentPost("/jobs/next").expect(204);
  });

  it("a user can start one scan at a time", async () => {
    const first = await asAlice.post(`/api/v1/devices/${deviceId}/scans`).expect(202);
    assert.equal(first.body.state, "QUEUED");

    const second = await asAlice.post(`/api/v1/devices/${deviceId}/scans`).expect(409);
    assert.equal(second.body.error.code, "SCAN_IN_PROGRESS");
    assert.equal(second.body.error.details.scanJobId, first.body.scanJobId);
  });

  it("other users can't scan this device or see its scans", async () => {
    await asBob.post(`/api/v1/devices/${deviceId}/scans`).expect(404);
    const job = await prisma.scanJob.findFirstOrThrow({ where: { deviceId } });
    await asBob.get(`/api/v1/scans/${job.id}`).expect(404);
  });

  it("the agent picks up the scan, sends results, and the apps appear", async () => {
    const next = await agentPost("/jobs/next").expect(200);
    assert.equal(next.body.job.type, "scan");
    const scanId = next.body.job.id;
    assert.equal((await asAlice.get(`/api/v1/scans/${scanId}`).expect(200)).body.state, "RUNNING");

    await agentPost(`/scans/${scanId}/results`, { apps: FIRST_SCAN, durationMs: 1000 }).expect(204);

    const scan = await asAlice.get(`/api/v1/scans/${scanId}`).expect(200);
    assert.equal(scan.body.state, "SUCCEEDED");
    assert.equal(scan.body.appsFound, 4);

    const apps = await appsOf();
    assert.equal(apps.total, 4);
    const status = Object.fromEntries(
      apps.items.map((a: { displayName: string; updateStatus: string }) => [a.displayName, a.updateStatus]),
    );
    assert.deepEqual(status, {
      Git: "update_available",
      "VLC media player": "up_to_date",
      "Google Chrome": "unsupported",
      Paint: "unsupported",
    });

    const dash = await asAlice.get("/api/v1/dashboard").expect(200);
    assert.equal(dash.body.device.deviceName, "REAL-PC");
    assert.deepEqual(dash.body.totals, { applications: 4, updatesAvailable: 1, upToDate: 1, unsupported: 2 });
    assert.equal(dash.body.activeScan, null);
  });

  it("results can't be sent twice for the same scan", async () => {
    const job = await prisma.scanJob.findFirstOrThrow({ where: { deviceId, state: "SUCCEEDED" } });
    const res = await agentPost(`/scans/${job.id}/results`, { apps: FIRST_SCAN }).expect(409);
    assert.equal(res.body.error.code, "JOB_NOT_RUNNING");
  });

  it("a second scan updates versions, keeps history and hides removed apps", async () => {
    const gitBefore = (await appsOf()).items.find((a: { displayName: string }) => a.displayName === "Git");

    const scanId = await startAndClaim();
    await agentPost(`/scans/${scanId}/results`, { apps: [winget("Git", "Git.Git", "2.56.0.4")] }).expect(204);

    const apps = await appsOf();
    assert.equal(apps.total, 1); // VLC, Chrome and Paint were not found this time
    const git = apps.items[0];
    assert.equal(git.id, gitBefore.id); // same app row, not a new one
    assert.equal(git.installedVersion, "2.56.0.4");
    assert.equal(git.updateStatus, "up_to_date");

    const details = await asAlice.get(`/api/v1/applications/${git.id}`).expect(200);
    assert.deepEqual(
      details.body.versionHistory.map((v: { version: string }) => v.version),
      ["2.56.0.4", "2.56.0.2"],
    );
  });

  it("the server re-checks package Ids instead of trusting the agent", async () => {
    const scanId = await startAndClaim();
    const evil = scanned("Evil", "Evil.App", "1.0", {
      packageId: "Evil.App & del C:\\",
      source: "winget",
      matchStatus: "MATCHED",
    });
    await agentPost(`/scans/${scanId}/results`, { apps: [winget("Git", "Git.Git", "2.56.0.4"), evil] }).expect(204);

    const row = await prisma.application.findFirstOrThrow({ where: { deviceId, localId: "Evil.App" } });
    assert.equal(row.packageId, null);
    assert.equal(row.matchStatus, "UNMATCHED");
  });

  it("rejects invalid results, and records a failed scan", async () => {
    const scanId = await startAndClaim();
    await agentPost(`/scans/${scanId}/results`, { apps: [{ displayName: "" }] }).expect(400);

    await agentPost(`/scans/${scanId}/fail`, { error: "winget was not found" }).expect(204);
    const scan = await asAlice.get(`/api/v1/scans/${scanId}`).expect(200);
    assert.equal(scan.body.state, "FAILED");
    assert.equal(scan.body.errorSummary, "winget was not found");
  });

  it("an offline device can't start a scan", async () => {
    await prisma.device.update({
      where: { id: deviceId },
      data: { lastSeenAt: new Date(Date.now() - 10 * 60 * 1000) },
    });
    const res = await asAlice.post(`/api/v1/devices/${deviceId}/scans`).expect(503);
    assert.equal(res.body.error.code, "AGENT_OFFLINE");
  });
});