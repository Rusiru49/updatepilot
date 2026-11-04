import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compareVersions, isNewer, majorVersion } from "../lib/version";

describe("compareVersions", () => {
  it("compares numbers, not text (1.10 > 1.9)", () => {
    assert.equal(compareVersions("1.10", "1.9"), 1);
    assert.equal(compareVersions("1.9", "1.10"), -1);
    assert.equal(compareVersions("3.0.24", "3.0.23"), 1);
  });

  it("treats missing parts as zero (1.0 == 1.0.0)", () => {
    assert.equal(compareVersions("1.0", "1.0.0"), 0);
    assert.equal(compareVersions("2.56.0.2", "2.56.0.2"), 0);
    assert.equal(compareVersions("1.0.0.1", "1.0"), 1);
  });

  it("handles real WinGet versions from the development PC", () => {
    assert.equal(compareVersions("2.56.0.4", "2.56.0.2"), 1); // Git
    assert.equal(compareVersions("26276.513.5241.9675", "26260.1717.5229.7049"), 1); // Teams
    assert.equal(compareVersions("14.51.36247.0", "14.50.35719.0"), 1); // Visual C++
    assert.equal(compareVersions("1.29.380", "1.29.379.0"), 1); // App Installer
    assert.equal(compareVersions("26.13.0", "24.22.1"), 1); // Node.js
    assert.equal(compareVersions("24.004.20219", "24.003.20112"), 1); // Acrobat (leading zeros)
    assert.equal(compareVersions("18.6-5", "18.6-4"), 1); // PostgreSQL build suffix
  });

  it("puts pre-releases before the release", () => {
    assert.equal(compareVersions("1.0.0", "1.0.0-beta"), 1);
    assert.equal(compareVersions("1.0.0-beta", "1.0.0"), -1);
    assert.equal(compareVersions("1.0.0-rc.1", "1.0.0-beta.2"), 1);
    assert.equal(compareVersions("1.0.0-beta.2", "1.0.0-beta.10"), -1);
  });

  it("accepts a leading v", () => {
    assert.equal(compareVersions("v2.0", "1.9"), 1);
  });

  it("refuses to guess for uncertain versions", () => {
    assert.equal(compareVersions("> 3.14.7", "3.14.8"), null);
    assert.equal(compareVersions("3.0", "< 2.0"), null);
    assert.equal(compareVersions("Unknown", "1.0"), null);
    assert.equal(compareVersions("", "1.0"), null);
    assert.equal(compareVersions("latest", "1.0"), null);
  });
});

describe("isNewer and majorVersion", () => {
  it("isNewer is true only when really newer", () => {
    assert.equal(isNewer("3.0.24", "3.0.23"), true);
    assert.equal(isNewer("3.0.23", "3.0.23"), false);
    assert.equal(isNewer("3.0.22", "3.0.23"), false); // never "update" to an older version
    assert.equal(isNewer("> 1.8.10", "1.8.10"), null);
  });

  it("finds the major version", () => {
    assert.equal(majorVersion("24.22.1"), 24);
    assert.equal(majorVersion("> 3.14.7"), null);
  });
});