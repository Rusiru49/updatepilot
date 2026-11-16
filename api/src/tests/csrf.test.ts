import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../app";
import { prisma } from "../db";
import { createUser, PASSWORD, resetDb } from "./helpers";

// Logs in WITHOUT setting the CSRF header automatically, so we can test it
async function rawLogin(email: string) {
  const agent = request.agent(app);
  const res = await agent.post("/api/v1/auth/login").send({ email, password: PASSWORD }).expect(200);
  return { agent, csrfToken: res.body.csrfToken as string };
}

describe("CSRF protection", () => {
  before(async () => {
    await resetDb();
    await createUser("alice@test.com");
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it("login and /auth/me give the page a CSRF token", async () => {
    const { agent, csrfToken } = await rawLogin("alice@test.com");
    assert.ok(csrfToken && csrfToken.length >= 32);
    const me = await agent.get("/api/v1/auth/me").expect(200);
    assert.equal(me.body.csrfToken, csrfToken);
  });

  it("reading data (GET) works without the token", async () => {
    const { agent } = await rawLogin("alice@test.com");
    await agent.get("/api/v1/devices").expect(200);
  });

  it("a change without the token is blocked with 403", async () => {
    const { agent } = await rawLogin("alice@test.com");
    const res = await agent.post("/api/v1/devices/pairing-codes").expect(403);
    assert.equal(res.body.error.code, "CSRF_FAILED");
  });

  it("a change with a wrong token is blocked", async () => {
    const { agent } = await rawLogin("alice@test.com");
    await agent.post("/api/v1/devices/pairing-codes").set("X-CSRF-Token", "wrong-token").expect(403);
  });

  it("a change with the right token works", async () => {
    const { agent, csrfToken } = await rawLogin("alice@test.com");
    await agent.post("/api/v1/devices/pairing-codes").set("X-CSRF-Token", csrfToken).expect(201);
  });

  it("each login session has its own token, which doesn't work for another session", async () => {
    const a = await rawLogin("alice@test.com");
    const b = await rawLogin("alice@test.com");
    assert.notEqual(a.csrfToken, b.csrfToken);
    await b.agent.post("/api/v1/devices/pairing-codes").set("X-CSRF-Token", a.csrfToken).expect(403);
  });

  it("not logged in is still 401 (not 403)", async () => {
    await request(app).post("/api/v1/devices/pairing-codes").expect(401);
  });

  it("old sessions without a token get one automatically", async () => {
    const { agent } = await rawLogin("alice@test.com");
    await prisma.session.updateMany({ data: { csrfToken: "" } }); // pretend it's an old session
    const me = await agent.get("/api/v1/auth/me").expect(200);
    assert.ok(me.body.csrfToken.length >= 32);
    await agent.post("/api/v1/devices/pairing-codes").set("X-CSRF-Token", me.body.csrfToken).expect(201);
  });
});