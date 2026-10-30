import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import request from "supertest";
import app from "../app";
import { prisma } from "../db";
import { createUser, login, PASSWORD, resetDb } from "./helpers";

function getCookies(res: request.Response): string[] {
  return (res.headers["set-cookie"] as unknown as string[] | undefined) ?? [];
}

function getSessionToken(res: request.Response) {
  const cookie = getCookies(res).find((c) => c.startsWith("up_session="));
  return cookie?.split(";")[0].split("=")[1];
}

describe("Auth API", () => {
  before(async () => {
    await resetDb();
    await createUser("existing@test.com");
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it("GET /health returns ok", async () => {
    const res = await request(app).get("/api/v1/health").expect(200);
    assert.equal(res.body.status, "ok");
  });

  it("registers a user, sets a secure cookie and never returns the password hash", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "New@Test.com", password: PASSWORD, displayName: "New User" })
      .expect(201);

    assert.equal(res.body.user.email, "new@test.com"); // email is normalised
    assert.equal(res.body.user.passwordHash, undefined);

    const cookie = getCookies(res).join("; ");
    assert.match(cookie, /up_session=/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
  });

  it("rejects a duplicate email with 409", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "existing@test.com", password: PASSWORD, displayName: "Copy" })
      .expect(409);
    assert.equal(res.body.error.code, "EMAIL_TAKEN");
  });

  it("rejects a weak password with 400 and a field error", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ email: "weak@test.com", password: "123", displayName: "Weak" })
      .expect(400);
    assert.equal(res.body.error.code, "VALIDATION_ERROR");
    assert.ok(res.body.error.details.some((d: { field: string }) => d.field === "password"));
  });

  it("stores passwords as bcrypt hashes, not plain text", async () => {
    const user = await prisma.user.findUnique({ where: { email: "existing@test.com" } });
    assert.ok(user);
    assert.ok(user.passwordHash.startsWith("$2"));
    assert.notEqual(user.passwordHash, PASSWORD);
  });

  it("gives the same 401 for a wrong password and an unknown email", async () => {
    const wrong = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "existing@test.com", password: "Wrong@123" })
      .expect(401);
    const unknown = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "nobody@test.com", password: "Wrong@123" })
      .expect(401);
    assert.equal(wrong.body.error.code, "INVALID_CREDENTIALS");
    assert.deepEqual(wrong.body, unknown.body); // doesn't reveal which emails exist
  });

  it("protects /auth/me", async () => {
    await request(app).get("/api/v1/auth/me").expect(401);
    const agent = await login("existing@test.com");
    const res = await agent.get("/api/v1/auth/me").expect(200);
    assert.equal(res.body.user.email, "existing@test.com");
  });

  it("stores only a SHA-256 hash of the session token", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "existing@test.com", password: PASSWORD })
      .expect(200);
    const token = getSessionToken(res);
    assert.ok(token);

    const hash = crypto.createHash("sha256").update(token).digest("hex");
    assert.ok(await prisma.session.findUnique({ where: { tokenHash: hash } }));
    assert.equal(await prisma.session.findUnique({ where: { tokenHash: token } }), null);
  });

  it("logout ends the session immediately", async () => {
    const agent = await login("existing@test.com");
    await agent.post("/api/v1/auth/logout").expect(204);
    await agent.get("/api/v1/auth/me").expect(401);
  });

  // Keep this test LAST — it uses up the login limit
  it("rate-limits repeated login attempts with 429", async () => {
    let lastStatus = 0;
    for (let i = 0; i < 25; i++) {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "existing@test.com", password: "Wrong@123" });
      lastStatus = res.status;
      if (lastStatus === 429) break;
    }
    assert.equal(lastStatus, 429);
  });
});