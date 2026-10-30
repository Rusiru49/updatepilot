import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../app";
import { prisma } from "../db";
import { createUser, createUserWithApps, login, resetDb } from "./helpers";

type AppRow = { displayName: string; updateStatus: string };

describe("Data APIs: applications, dashboard, devices, history", () => {
  let alice: Awaited<ReturnType<typeof createUserWithApps>>;
  let bob: Awaited<ReturnType<typeof createUserWithApps>>;
  let asAlice: Awaited<ReturnType<typeof login>>;

  before(async () => {
    await resetDb();
    alice = await createUserWithApps("alice@test.com", ["Alpha Editor", "Beta Browser", "Gamma Tool"]);
    bob = await createUserWithApps("bob@test.com", ["Bob App One", "Bob App Two"]);
    asAlice = await login("alice@test.com");
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it("requires login for every data endpoint", async () => {
    for (const path of ["/applications", "/dashboard", "/devices", "/history"]) {
      await request(app).get(`/api/v1${path}`).expect(401);
    }
  });

  it("lists only the user's own applications", async () => {
    const res = await asAlice.get("/api/v1/applications").expect(200);
    assert.equal(res.body.total, 3);
    const names = res.body.items.map((a: AppRow) => a.displayName);
    assert.ok(!names.some((n: string) => n.startsWith("Bob")));
  });

  it("searches case-insensitively", async () => {
    const res = await asAlice.get("/api/v1/applications?search=ALPHA").expect(200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.items[0].displayName, "Alpha Editor");
  });

  it("paginates", async () => {
    const page1 = await asAlice.get("/api/v1/applications?pageSize=2&page=1").expect(200);
    const page2 = await asAlice.get("/api/v1/applications?pageSize=2&page=2").expect(200);
    assert.equal(page1.body.items.length, 2);
    assert.equal(page2.body.items.length, 1);
    assert.equal(page1.body.total, 3);
  });

  it("sorts", async () => {
    const res = await asAlice.get("/api/v1/applications?sort=displayName&order=desc").expect(200);
    assert.equal(res.body.items[0].displayName, "Gamma Tool");
  });

  it("rejects invalid query values with 400", async () => {
    await asAlice.get("/api/v1/applications?pageSize=500").expect(400);
    await asAlice.get("/api/v1/applications?sort=passwordHash").expect(400);
  });

  it("works out the update status of each app", async () => {
    const res = await asAlice.get("/api/v1/applications").expect(200);
    const status = Object.fromEntries(res.body.items.map((a: AppRow) => [a.displayName, a.updateStatus]));
    assert.deepEqual(status, {
      "Alpha Editor": "update_available",
      "Beta Browser": "up_to_date",
      "Gamma Tool": "unsupported",
    });
  });

  it("shows details for the user's own app", async () => {
    const res = await asAlice.get(`/api/v1/applications/${alice.apps[0].id}`).expect(200);
    assert.equal(res.body.application.displayName, "Alpha Editor");
    assert.equal(res.body.latestRelease.version, "2.0.0");
    assert.equal(res.body.updateHistory.length, 1);
  });

  it("returns 404 (not 403) for another user's app, so nothing leaks", async () => {
    const res = await asAlice.get(`/api/v1/applications/${bob.apps[0].id}`).expect(404);
    assert.equal(res.body.error.code, "NOT_FOUND");
  });

  it("returns 400 for an invalid app id", async () => {
    await asAlice.get("/api/v1/applications/abc").expect(400);
  });

  it("dashboard totals are correct", async () => {
    const res = await asAlice.get("/api/v1/dashboard").expect(200);
    assert.deepEqual(res.body.totals, { applications: 3, updatesAvailable: 1, upToDate: 1, unsupported: 1 });
    assert.equal(res.body.device.deviceName, "alice@test.com-PC");
  });

  it("devices only include the user's own", async () => {
    const res = await asAlice.get("/api/v1/devices").expect(200);
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].applicationCount, 3);
  });

  it("history is the user's own and can be filtered", async () => {
    const all = await asAlice.get("/api/v1/history").expect(200);
    assert.equal(all.body.total, 2); // 1 scan + 1 update

    const failed = await asAlice.get("/api/v1/history?state=FAILED").expect(200);
    assert.equal(failed.body.total, 1);
    assert.equal(failed.body.items[0].target, "Alpha Editor");

    const scans = await asAlice.get("/api/v1/history?type=scan").expect(200);
    assert.equal(scans.body.total, 1);
  });

  it("dashboard shows the empty state for a user with no devices", async () => {
    await createUser("carol@test.com");
    const asCarol = await login("carol@test.com");
    const res = await asCarol.get("/api/v1/dashboard").expect(200);
    assert.equal(res.body.device, null);
    assert.equal(res.body.totals.applications, 0);
  });

  it("returns 404 for unknown routes", async () => {
    const res = await request(app).get("/api/v1/does-not-exist").expect(404);
    assert.equal(res.body.error.code, "NOT_FOUND");
  });
});