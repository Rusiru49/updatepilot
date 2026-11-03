import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../app";
import { prisma } from "../db";
import { sha256 } from "../lib/auth";
import { normalizeCode } from "../lib/devices";
import { createUser, createUserWithApps, login, resetDb } from "./helpers";

type Agent = Awaited<ReturnType<typeof login>>;

describe("Agent pairing and authentication", () => {
  let asAlice: Agent;
  let bob: Awaited<ReturnType<typeof createUserWithApps>>;

  before(async () => {
    await resetDb();
    await createUser("alice@test.com");
    bob = await createUserWithApps("bob@test.com", ["Bob App", "Bob Tool"]);
    asAlice = await login("alice@test.com");
  });

  after(async () => {
    await prisma.$disconnect();
  });

  async function newCode() {
    const res = await asAlice.post("/api/v1/devices/pairing-codes").expect(201);
    return res.body.code as string;
  }

  function pair(code: string, deviceName = "TEST-PC") {
    return request(app).post("/api/v1/agent/pair").send({ code, deviceName, agentVersion: "0.1.0" });
  }

  it("only logged-in users can create pairing codes", async () => {
    await request(app).post("/api/v1/devices/pairing-codes").expect(401);
    const code = await newCode();
    assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });

  it("pairs with a valid code and stores only a hash of the agent key", async () => {
    const res = await pair(await newCode()).expect(201);
    const token: string = res.body.agentToken;
    assert.ok(token.startsWith("upa_"));

    assert.ok(await prisma.agentCredential.findUnique({ where: { credentialHash: sha256(token) } }));
    assert.equal(await prisma.agentCredential.findUnique({ where: { credentialHash: token } }), null);
  });

  it("a pairing code works only once", async () => {
    const code = await newCode();
    await pair(code).expect(201);
    const second = await pair(code).expect(400);
    assert.equal(second.body.error.code, "INVALID_PAIRING_CODE");
  });

  it("rejects an expired code", async () => {
    const code = await newCode();
    await prisma.pairingCode.update({
      where: { codeHash: sha256(normalizeCode(code)) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await pair(code).expect(400);
  });

  it("accepts the code in lowercase and without the dash", async () => {
    const code = await newCode();
    await pair(code.toLowerCase().replace("-", "")).expect(201);
  });

  it("heartbeat needs a valid agent key and marks the device online", async () => {
    const res = await pair(await newCode(), "HEARTBEAT-PC").expect(201);
    const token = res.body.agentToken;

    await request(app).post("/api/v1/agent/heartbeat").expect(401);
    await request(app)
      .post("/api/v1/agent/heartbeat")
      .set("Authorization", "Bearer upa_wrongwrongwrongwrongwrong")
      .expect(401);
    await request(app).post("/api/v1/agent/heartbeat").set("Authorization", `Bearer ${token}`).expect(204);

    const devices = await asAlice.get("/api/v1/devices").expect(200);
    const d = devices.body.items.find((x: { deviceName: string }) => x.deviceName === "HEARTBEAT-PC");
    assert.equal(d.status, "ONLINE");
  });

  it("an agent key cannot be used to access user data", async () => {
    const res = await pair(await newCode()).expect(201);
    await request(app)
      .get("/api/v1/applications")
      .set("Authorization", `Bearer ${res.body.agentToken}`)
      .expect(401);
  });

  it("a user cannot revoke another user's device", async () => {
    await asAlice.delete(`/api/v1/devices/${bob.device.id}/credentials`).expect(404);
  });

  it("revoking a device locks its agent out immediately", async () => {
    const res = await pair(await newCode(), "REVOKE-ME").expect(201);
    const auth = `Bearer ${res.body.agentToken}`;
    await request(app).post("/api/v1/agent/heartbeat").set("Authorization", auth).expect(204);

    await asAlice.delete(`/api/v1/devices/${res.body.deviceId}/credentials`).expect(204);
    await request(app).post("/api/v1/agent/heartbeat").set("Authorization", auth).expect(401);

    const devices = await asAlice.get("/api/v1/devices").expect(200);
    const d = devices.body.items.find((x: { id: string }) => x.id === res.body.deviceId);
    assert.equal(d.status, "REVOKED");
  });
});