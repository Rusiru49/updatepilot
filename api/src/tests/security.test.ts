import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../app";
import { prisma } from "../db";
import { createUser, login, PASSWORD, resetDb } from "./helpers";

describe("Security hardening", () => {
  before(async () => {
    await resetDb();
    await createUser("sec@test.com");
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it("hides the framework and sends safe headers (T7, T11)", async () => {
    const res = await request(app).get("/api/v1/health").expect(200);
    assert.equal(res.headers["x-powered-by"], undefined);
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(res.headers["x-frame-options"], "DENY");
    assert.match(res.headers["content-security-policy"], /frame-ancestors 'none'/);
    assert.equal(res.headers["cache-control"], "no-store");
  });

  it("the session cookie can't be read by scripts and isn't sent by other sites (T6, T7)", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "sec@test.com", password: PASSWORD })
      .expect(200);
    const cookie = String(res.headers["set-cookie"]);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
  });

  it("rejects a huge request body with 413 instead of crashing (T12)", async () => {
    const huge = { email: "x".repeat(200_000) + "@test.com", password: PASSWORD };
    const res = await request(app).post("/api/v1/auth/login").send(huge);
    assert.equal(res.status, 413);
  });

  it("error responses never include stack traces or internal details (T11)", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .send("{ not json")
      .expect(400);
    const text = JSON.stringify(res.body);
    assert.doesNotMatch(text, /at .*\.ts|node_modules|stack/i);
  });

  it("no response about the user ever includes a password hash or token hash (T11)", async () => {
    const agent = await login("sec@test.com");
    const me = await agent.get("/api/v1/auth/me").expect(200);
    const text = JSON.stringify(me.body);
    assert.doesNotMatch(text, /passwordHash|tokenHash|\$2[aby]\$/);
  });
});