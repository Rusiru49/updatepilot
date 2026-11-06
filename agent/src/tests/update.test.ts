import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { describeExitCode, formatExitCode } from "../exitCodes";
import { buildUpgradeArgs, lastMessage, VERSION_RE } from "../winget";

describe("winget upgrade command", () => {
  it("builds one fixed command with exactly the approved package and version", () => {
    assert.deepEqual(buildUpgradeArgs("VideoLAN.VLC", "3.0.24"), [
      "upgrade",
      "--id", "VideoLAN.VLC",
      "--exact",
      "--version", "3.0.24",
      "--source", "winget",
      "--silent",
      "--accept-package-agreements",
      "--accept-source-agreements",
    ]);
  });

  it("refuses unsafe package Ids and versions (command injection)", () => {
    assert.throws(() => buildUpgradeArgs("VideoLAN.VLC & del C:\\", "3.0.24"), /invalid package Id/);
    assert.throws(() => buildUpgradeArgs("--force", "3.0.24"), /invalid package Id/);
    assert.throws(() => buildUpgradeArgs("VideoLAN.VLC", "3.0.24; shutdown"), /invalid version/);
    assert.throws(() => buildUpgradeArgs("VideoLAN.VLC", "--all"), /invalid version/);
    assert.throws(() => buildUpgradeArgs("VideoLAN.VLC", "> 3.0"), /invalid version/);
  });

  it("accepts real versions from the development PC", () => {
    for (const v of ["3.0.24", "26276.513.5241.9675", "14.51.36247.0", "18.6-5", "1.29.380"]) {
      assert.ok(VERSION_RE.test(v), v);
    }
  });

  it("keeps only meaningful words from winget's output", () => {
    const out = "\r  - \r  ██████████  2.10 MB / 40.0 MB\nFound VLC media player [VideoLAN.VLC]\nInstaller failed with exit code: 1603\n";
    assert.equal(lastMessage(out), "Found VLC media player [VideoLAN.VLC] Installer failed with exit code: 1603");
  });
});

describe("exit codes", () => {
  it("success, restart and common failures", () => {
    assert.equal(describeExitCode(0).outcome, "ok");
    assert.equal(describeExitCode(3010).outcome, "restart");
    assert.equal(describeExitCode(1603).outcome, "failed");
    assert.match(describeExitCode(1603).message, /Close the app/);
    assert.match(describeExitCode(1223).message, /administrator approval/);
  });

  it("understands WinGet codes whether they arrive signed or unsigned", () => {
    const unsigned = 0x8a150101;
    const signed = unsigned | 0; // how Node may report it
    assert.ok(signed < 0);
    assert.equal(describeExitCode(signed).message, describeExitCode(unsigned).message);
    assert.match(describeExitCode(signed).message, /app is running/);
    assert.equal(formatExitCode(signed), "0x8A150101");
    assert.equal(formatExitCode(1603), "1603");
  });

  it("unknown codes still give a clear message", () => {
    assert.equal(describeExitCode(12345).outcome, "failed");
    assert.match(describeExitCode(12345).message, /exit code 12345/);
    assert.equal(describeExitCode(null).outcome, "failed");
  });

    it("recognises a Store (MSIX) app that is still open", () => {
    assert.match(describeExitCode(0x80073d02 | 0).message, /app is open/);
    assert.equal(formatExitCode(0x80073d02 | 0), "0x80073D02");
  });
});