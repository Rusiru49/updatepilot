import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PACKAGE_ID_RE,
  parseExport,
  parseTable,
  restoreCutOffIds,
  summarize,
  toApps,
  type InstalledApp,
} from "../winget";

// Real lines copied from `winget list` on the development PC (spacing matters!)
const REAL_LIST = String.raw`Name                                                     Id                                                       Version              Available     Source
-----------------------------------------------------------------------------------------------------------------------------------------------------------
Adobe Acrobat (64-bit)                                   Adobe.Acrobat.Reader.64-bit                              26.002.22031                       winget
Adobe Acrobat Reader                                     MSIX\AdobeAcrobatReaderCoreApp_26.0.0.1_x64__33qsgwvbcw… 26.0.0.1
App Installer                                            Microsoft.AppInstaller                                   1.29.379.0           1.29.380      winget
Google Chrome                                            ARP\Machine\X86\Google Chrome                            156.0.8078.79
HWiNFO® 64                                               REALiX.HWiNFO                                            8.54                               winget
Microsoft .Net Native Runtime Package 2.2                Microsoft.DotNet.Native.Runtime                          2.2.28604.0                        winget
Microsoft .Net Native Runtime Package 2.2                Microsoft.DotNet.Native.Runtime                          2.2.28604.0                        winget
Microsoft Edge                                           Microsoft.Edge                                           156.0.4314.50        156.0.4314.56 winget
Microsoft Edge                                           MSIX\Microsoft.MicrosoftEdge.Stable_152.0.4191.66_neutr… 152.0.4191.66
Microsoft Visual C++ v14 Redistributable (x64) - 14.50.… Microsoft.VCRedist.2015+.x64                             14.50.35719.0        14.51.36247.0 winget
Microsoft Windows Application Compatibility Fix Database ARP\Machine\X64\{22221111-1111-1111-1111-111111111111}.… Unknown
Python Launcher                                          Python.Launcher                                          > 3.14.7                           winget
WinRAR 7.23 (64-bit)                                     RARLab.WinRAR                                            7.23.0                             winget`;

const apps = toApps(parseTable(REAL_LIST));
const find = (localId: string) => apps.find((a) => a.localId === localId);

describe("winget list parser (real output)", () => {
  it("reads every row and removes exact duplicates", () => {
    // 13 data rows, one of them is a duplicate (.NET Native Runtime x86/x64)
    assert.equal(apps.length, 12);
  });

  it("trusts a winget package and reads its available version", () => {
    const edge = find("Microsoft.Edge");
    assert.equal(edge?.matchStatus, "MATCHED");
    assert.equal(edge?.packageId, "Microsoft.Edge");
    assert.equal(edge?.installedVersion, "156.0.4314.50");
    assert.equal(edge?.availableVersion, "156.0.4314.56");
  });

  it("marks normal installs WinGet couldn't match (ARP) as UNMATCHED, with no package Id", () => {
    const chrome = find(String.raw`ARP\Machine\X86\Google Chrome`);
    assert.equal(chrome?.matchStatus, "UNMATCHED");
    assert.equal(chrome?.packageId, null);
  });

  it("marks Store/system apps (MSIX) as UNSUPPORTED and never trusts cut-off Ids", () => {
    const msix = apps.find((a) => a.displayName === "Adobe Acrobat Reader");
    assert.equal(msix?.matchStatus, "UNSUPPORTED");
    assert.equal(msix?.packageId, null);
    assert.ok(msix?.localId.endsWith("…"));
  });

  it("keeps both entries when the same app comes from two sources", () => {
    const edges = apps.filter((a) => a.displayName === "Microsoft Edge");
    assert.equal(edges.length, 2);
    assert.deepEqual(edges.map((e) => e.matchStatus).sort(), ["MATCHED", "UNSUPPORTED"]);
  });

  it("flags unusual versions instead of treating them as numbers", () => {
    assert.equal(find("Python.Launcher")?.installedVersion, "> 3.14.7");
    assert.equal(find("Python.Launcher")?.versionUncertain, true);
    const unknown = apps.find((a) => a.installedVersion === "Unknown");
    assert.equal(unknown?.versionUncertain, true);
    assert.equal(find("Git.Git")?.versionUncertain ?? false, false);
  });

  it("handles special characters, '+' in Ids and cut-off names", () => {
    assert.equal(find("REALiX.HWiNFO")?.displayName, "HWiNFO® 64");
    const vc = find("Microsoft.VCRedist.2015+.x64");
    assert.equal(vc?.matchStatus, "MATCHED");
    assert.equal(vc?.availableVersion, "14.51.36247.0");
  });

  it("counts the summary correctly", () => {
    assert.deepEqual(summarize(apps), { total: 12, matched: 8, unmatched: 2, unsupported: 2, updatesAvailable: 3 });
  });
});

describe("winget output edge cases", () => {
  it("ignores the spinner and Windows line endings before the table", () => {
    const withSpinner = "\r   - \r   \\ \r   | \r" + REAL_LIST.replace(/\n/g, "\r\n");
    assert.equal(toApps(parseTable(withSpinner)).length, 12);
  });

  it("works when there is no Available column (nothing to update)", () => {
    const table = [
      "Name          Id             Version  Source",
      "--------------------------------------------",
      "Git           Git.Git        2.56.0.3 winget",
      "Notepad++     Notepad++.Notepad++ 8.7 winget",
    ].join("\n");
    // second row is badly aligned on purpose: it must not crash
    const rows = parseTable(table);
    assert.equal(rows[0].id, "Git.Git");
    assert.equal(rows[0].available, null);
    assert.equal(rows[0].source, "winget");
  });

  it("stops at the footer of `winget upgrade`", () => {
    const table = [
      "Name   Id       Version  Available Source",
      "-----------------------------------------",
      "Git    Git.Git  2.56.0.2 2.56.0.3  winget",
      "1 upgrades available.",
    ].join("\n");
    assert.equal(parseTable(table).length, 1);
  });

  it("fails clearly when there is no table", () => {
    assert.throws(() => parseTable("No installed package found matching input criteria."), /table header/);
  });
});

describe("safety rules", () => {
  it("only accepts real-looking package Ids (blocks command injection)", () => {
    for (const ok of ["Git.Git", "Notepad++.Notepad++", "Microsoft.VCRedist.2015+.x64", "7zip.7zip", "Adobe.Acrobat.Reader.64-bit"]) {
      assert.ok(PACKAGE_ID_RE.test(ok), ok);
    }
    for (const bad of ["Git.Git & del C:\\", "Git.Git; shutdown", "a b", "--force", "$(calc)", ""]) {
      assert.ok(!PACKAGE_ID_RE.test(bad), bad);
    }
  });

  it("restores a cut-off Id only when exactly one exported package matches", () => {
    const cut: InstalledApp = {
      displayName: "Some Long App",
      localId: "Contoso.SomeVeryLongApplicationNa…",
      packageId: null,
      installedVersion: "1.2.3",
      availableVersion: null,
      source: "winget",
      matchStatus: "UNMATCHED",
      versionUncertain: false,
    };

    const exported = parseExport(
      JSON.stringify({
        Sources: [
          {
            SourceDetails: { Name: "winget" },
            Packages: [
              { PackageIdentifier: "Contoso.SomeVeryLongApplicationName", Version: "1.2.3" },
              { PackageIdentifier: "Git.Git", Version: "2.56.0.2" },
            ],
          },
        ],
      }),
    );
    const [fixed] = restoreCutOffIds([cut], exported);
    assert.equal(fixed.packageId, "Contoso.SomeVeryLongApplicationName");
    assert.equal(fixed.matchStatus, "MATCHED");

    // Two possible matches → don't guess
    const ambiguous = [...exported, { id: "Contoso.SomeVeryLongApplicationNameBeta", version: "1.2.3" }];
    const [notFixed] = restoreCutOffIds([cut], ambiguous);
    assert.equal(notFixed.packageId, null);
    assert.equal(notFixed.matchStatus, "UNMATCHED");
  });
});