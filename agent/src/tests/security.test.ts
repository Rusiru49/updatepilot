import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkServerUrl } from "../http";

describe("server address safety", () => {
  it("allows https anywhere and http only for localhost", () => {
    assert.equal(checkServerUrl("https://updatepilot.example.com"), "https://updatepilot.example.com");
    assert.equal(checkServerUrl("http://localhost:4000"), "http://localhost:4000");
    assert.equal(checkServerUrl("http://127.0.0.1:4000/api/v1"), "http://127.0.0.1:4000");
  });

  it("refuses unencrypted addresses on the network and junk", () => {
    assert.throws(() => checkServerUrl("http://192.168.1.20:4000"), /https/);
    assert.throws(() => checkServerUrl("http://updatepilot.example.com"), /https/);
    assert.throws(() => checkServerUrl("ftp://localhost"), /https/);
    assert.throws(() => checkServerUrl("not a url"), /not a valid/);
  });

  it("allows http on the network only in test mode", () => {
    process.env.UPDATEPILOT_ALLOW_HTTP = "1";
    try {
      assert.equal(checkServerUrl("http://192.168.1.20:4000"), "http://192.168.1.20:4000");
    } finally {
      delete process.env.UPDATEPILOT_ALLOW_HTTP;
    }
    assert.throws(() => checkServerUrl("http://192.168.1.20:4000"), /https/);
  });
});