import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../app";
import { prisma } from "../db";
import { createUser, login, PASSWORD, resetDb } from "./helpers";

const NEW_PASSWORD = "New@Pass123";

describe("Profile and password", () => {
  before(async () => {
    await resetDb();
    await createUser("pat@test.com");
    await createUser("sam@test.com");
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it("updates the display name", async () => {
    const agent = await login("pat@test.com");
    const res = await agent.patch("/api/v1/auth/me").send({ displayName: "  Pat Perera  " }).expect(200);
    assert.equal(res.body.user.displayName, "Pat Perera");
    const me = await agent.get("/api/v1/auth/me").expect(200);
    assert.equal(me.body.user.displayName, "Pat Perera");
    assert.equal(me.body.user.passwordHash, undefined);
  });

  it("rejects an empty or too long name", async () => {
    const agent = await login("pat@test.com");
    await agent.patch("/api/v1/auth/me").send({ displayName: "   " }).expect(400);
    await agent.patch("/api/v1/auth/me").send({ displayName: "x".repeat(51) }).expect(400);
  });

  it("needs the CSRF token and a login", async () => {
    const noCsrf = request.agent(app);
    await noCsrf.post("/api/v1/auth/login").send({ email: "pat@test.com", password: PASSWORD }).expect(200);
    await noCsrf.patch("/api/v1/auth/me").send({ displayName: "Hacker" }).expect(403);
    await request(app).patch("/api/v1/auth/me").send({ displayName: "Hacker" }).expect(401);
  });

  it("refuses a wrong current password and keeps the old one", async () => {
    const agent = await login("sam@test.com");
    const res = await agent
      .post("/api/v1/auth/change-password")
      .send({ currentPassword: "Wrong@123", newPassword: NEW_PASSWORD })
      .expect(400);
    assert.equal(res.body.error.code, "WRONG_PASSWORD");
    await request(app).post("/api/v1/auth/login").send({ email: "sam@test.com", password: PASSWORD }).expect(200);
  });

  it("changes the password, keeps this session and signs out the others", async () => {
    const here = await login("sam@test.com");
    const elsewhere = await login("sam@test.com");

    const res = await here
      .post("/api/v1/auth/change-password")
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
      .expect(200);
    assert.ok(res.body.otherSessionsEnded >= 1);

    await here.get("/api/v1/auth/me").expect(200); // still signed in here
    await elsewhere.get("/api/v1/auth/me").expect(401); // signed out elsewhere

    await request(app).post("/api/v1/auth/login").send({ email: "sam@test.com", password: PASSWORD }).expect(401);
    await request(app).post("/api/v1/auth/login").send({ email: "sam@test.com", password: NEW_PASSWORD }).expect(200);
  });
});