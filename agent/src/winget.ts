import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type MatchStatus = "MATCHED" | "UNMATCHED" | "UNSUPPORTED";

export type InstalledApp = {
  displayName: string;
  localId: string; // the Id exactly as winget printed it (may be ARP\..., MSIX\..., or cut off with "…")
  packageId: string | null; // only set when we TRUST it: winget source + complete, valid Id
  installedVersion: string;
  availableVersion: string | null;
  source: string | null;
  matchStatus: MatchStatus;
  versionUncertain: boolean; // "> 1.8.10", "< 2.0", "Unknown"
};

export type TableRow = { name: string; id: string; version: string; available: string | null; source: string | null };

export class WingetError extends Error {
  code: "NOT_FOUND" | "TIMEOUT" | "FAILED" | "PARSE_FAILED";
  constructor(code: WingetError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

const ELLIPSIS = "…";

// What a real WinGet package Id looks like: Git.Git, Notepad++.Notepad++, Microsoft.VCRedist.2015+.x64
// Only Ids that pass this check can ever be used for updates (Week 4) — protects against command injection.
export const PACKAGE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/;

const isCutOff = (value: string) => value.endsWith(ELLIPSIS) || value.endsWith("...");

/* ───────────── 1. Clean the raw output ───────────── */

// winget draws a spinner/progress bar using "\r" (carriage return) before the table.
// For every line keep only the last non-empty part after a "\r".
export function cleanLines(raw: string): string[] {
  return raw.split("\n").map((line) => {
    const parts = line.split("\r");
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i].trim() !== "") return parts[i].replace(/\s+$/, "");
    }
    return "";
  });
}

/* ───────────── 2. Read the fixed-width table ───────────── */

export function parseTable(raw: string): TableRow[] {
  const lines = cleanLines(raw);

  // The header is the line just above the "-----" separator
  const sep = lines.findIndex((l) => /^-{10,}$/.test(l.trim()));
  if (sep < 1) throw new Error("Couldn't find the table header in the winget output");

  // Each column starts where its header word starts (widths change every run!)
  const header = lines[sep - 1];
  const starts: number[] = [];
  const titles: string[] = [];
  for (const m of header.matchAll(/\S+/g)) {
    starts.push(m.index!);
    titles.push(m[0].toLowerCase());
  }

  // English headers by name; other languages by position
  const english = ["name", "id", "version"].every((t) => titles.includes(t));
  const positional =
    titles.length >= 5 ? ["name", "id", "version", "available", "source"] : ["name", "id", "version", "source"];
  const index = (key: string) => (english ? titles.indexOf(key) : positional.indexOf(key));
  const [iName, iId, iVersion, iAvailable, iSource] = ["name", "id", "version", "available", "source"].map(index);

  const rows: TableRow[] = [];
  for (const line of lines.slice(sep + 1)) {
    const cell = (i: number) =>
      i < 0 ? "" : line.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : undefined).trim();

    // In a real row, every column starts right after a space. A footer sentence like
    // "9 upgrades available." doesn't line up, so that's where the table ends.
    const aligned = starts.slice(1).every((s) => s >= line.length || line[s - 1] === " ");
    const id = cell(iId);
    if (line.trim() === "" || id === "" || !aligned) break;

    rows.push({
      name: cell(iName),
      id,
      version: cell(iVersion),
      available: cell(iAvailable) || null,
      source: cell(iSource) || null,
    });
  }
  return rows;
}

/* ───────────── 3. Turn rows into apps (with safety rules) ───────────── */

export function toApps(rows: TableRow[]): InstalledApp[] {
  const seen = new Set<string>();
  const apps: InstalledApp[] = [];

  for (const r of rows) {
    if (!r.name || !r.id || !r.version) continue;

    // The same Id + version can appear twice (x86 and x64 runtimes) — keep one
    const key = `${r.id}|${r.version}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const isMsix = /^MSIX\\/i.test(r.id); // Store / Windows system apps
    const isArp = /^ARP\\/i.test(r.id); // installed normally, but WinGet couldn't match it
    const trusted = r.source === "winget" && !isMsix && !isArp && !isCutOff(r.id) && PACKAGE_ID_RE.test(r.id);

    apps.push({
      displayName: r.name,
      localId: r.id,
      packageId: trusted ? r.id : null,
      installedVersion: r.version,
      availableVersion: r.available,
      source: r.source,
      matchStatus: trusted ? "MATCHED" : isMsix ? "UNSUPPORTED" : "UNMATCHED",
      versionUncertain: /^[<>]/.test(r.version) || /^unknown$/i.test(r.version),
    });
  }
  return apps;
}

/* ───────────── 4. Fix cut-off Ids using `winget export` (JSON, never cut off) ───────────── */

export type ExportedPackage = { id: string; version: string | null };

export function parseExport(json: string): ExportedPackage[] {
  const data = JSON.parse(json.replace(/^\uFEFF/, ""));
  const out: ExportedPackage[] = [];
  for (const source of data?.Sources ?? []) {
    if (source?.SourceDetails?.Name !== "winget") continue;
    for (const p of source.Packages ?? []) {
      if (typeof p?.PackageIdentifier === "string") {
        out.push({ id: p.PackageIdentifier, version: typeof p.Version === "string" ? p.Version : null });
      }
    }
  }
  return out;
}

export function restoreCutOffIds(apps: InstalledApp[], exported: ExportedPackage[]): InstalledApp[] {
  return apps.map((app) => {
    if (app.matchStatus === "MATCHED" || app.source !== "winget" || !isCutOff(app.localId)) return app;

    const prefix = app.localId.replace(/(…|\.\.\.)$/, "");
    const hits = exported.filter(
      (p) => p.id.startsWith(prefix) && (p.version === null || p.version === app.installedVersion),
    );
    // Only fix it if there is exactly ONE possible match — never guess
    if (hits.length !== 1 || !PACKAGE_ID_RE.test(hits[0].id)) return app;
    return { ...app, localId: hits[0].id, packageId: hits[0].id, matchStatus: "MATCHED" };
  });
}

/* ───────────── 5. Run winget (fixed commands only) ───────────── */

const WINGET_TIMEOUT_MS = 120_000;

// The ONLY winget commands this agent runs. The arguments are fixed here —
// nothing from the server or the network is ever added to them.
const COMMANDS = {
  list: () => ["list", "--accept-source-agreements"],
  export: (file: string) => ["export", "--output", file, "--include-versions", "--accept-source-agreements"],
};

function runWinget(args: string[]): Promise<{ stdout: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    // shell: false → arguments go straight to winget.exe, never through cmd.exe
    const child = spawn("winget", args, { windowsHide: true, shell: false });
    const chunks: Buffer[] = [];

    const timer = setTimeout(() => {
      child.kill();
      reject(new WingetError("TIMEOUT", "winget took longer than 2 minutes"));
    }, WINGET_TIMEOUT_MS);

    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.resume(); // ignore warnings, but don't let the pipe fill up

    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        err.code === "ENOENT"
          ? new WingetError("NOT_FOUND", "winget was not found. Install or update 'App Installer' from the Microsoft Store.")
          : new WingetError("FAILED", err.message),
      );
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout: Buffer.concat(chunks).toString("utf8"), exitCode: code ?? -1 });
    });
  });
}

export async function scanInstalledApps(): Promise<{ apps: InstalledApp[]; durationMs: number }> {
  const started = Date.now();
  const list = await runWinget(COMMANDS.list());

  let apps: InstalledApp[];
  try {
    apps = toApps(parseTable(list.stdout));
  } catch (err) {
    throw new WingetError("PARSE_FAILED", `${(err as Error).message} (winget exit code ${list.exitCode})`);
  }

  // Only if some winget Ids were cut off: ask `winget export` for the full Ids
  if (apps.some((a) => a.source === "winget" && isCutOff(a.localId))) {
    const file = path.join(os.tmpdir(), `updatepilot-export-${process.pid}-${Date.now()}.json`);
    try {
      await runWinget(COMMANDS.export(file));
      if (fs.existsSync(file)) apps = restoreCutOffIds(apps, parseExport(fs.readFileSync(file, "utf8")));
    } catch {
      // Optional step — if it fails, those apps simply stay "unmatched"
    } finally {
      fs.rmSync(file, { force: true });
    }
  }

  return { apps, durationMs: Date.now() - started };
}

export function summarize(apps: InstalledApp[]) {
  return {
    total: apps.length,
    matched: apps.filter((a) => a.matchStatus === "MATCHED").length,
    unmatched: apps.filter((a) => a.matchStatus === "UNMATCHED").length,
    unsupported: apps.filter((a) => a.matchStatus === "UNSUPPORTED").length,
    updatesAvailable: apps.filter((a) => a.matchStatus === "MATCHED" && a.availableVersion).length,
  };
}