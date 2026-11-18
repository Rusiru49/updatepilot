// Puts everything a user needs into release/UpdatePilotAgent and zips it
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const OUT = join("release", "UpdatePilotAgent");

if (!existsSync("dist/agent.mjs") || !existsSync("dist/cli.mjs")) {
  console.error("Run the build first (npm run build).");
  process.exit(1);
}

rmSync("release", { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// 1. The official, signed Node runtime this PC already uses (so no Node install is needed)
copyFileSync(process.execPath, join(OUT, "node.exe"));

// 2. The bundled agent
copyFileSync("dist/agent.mjs", join(OUT, "agent.mjs"));
copyFileSync("dist/cli.mjs", join(OUT, "cli.mjs"));

// 3. Double-click scripts (Windows needs CRLF line endings in .cmd files)
const STARTUP = String.raw`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\UpdatePilot Agent.cmd`;

const files = {
  "Pair.cmd": String.raw`@echo off
title UpdatePilot - Pair this computer
cd /d "%~dp0"
echo In UpdatePilot, open Settings ^& agent and click "Generate pairing code".
echo.
set "UPDATEPILOT_SERVER=http://localhost:4000"
set /p UPDATEPILOT_SERVER=Server address [press Enter for http://localhost:4000]:
set /p CODE=Enter the pairing code:
"%~dp0node.exe" "%~dp0cli.mjs" pair %CODE%
echo.
pause`,

  "Start Agent.cmd": String.raw`@echo off
title UpdatePilot Agent
cd /d "%~dp0"
echo UpdatePilot agent - keep this window open. Press Ctrl+C to stop.
echo.
"%~dp0node.exe" "%~dp0agent.mjs"
echo.
pause`,

  "Status.cmd": String.raw`@echo off
cd /d "%~dp0"
"%~dp0node.exe" "%~dp0cli.mjs" status
echo.
pause`,

  "Enable Auto-start.cmd": String.raw`@echo off
> "${STARTUP}" echo @echo off
>> "${STARTUP}" echo start "UpdatePilot Agent" /min "%~dp0Start Agent.cmd"
echo The UpdatePilot agent will now start (minimised) when you sign in to Windows.
echo Run "Disable Auto-start.cmd" to turn this off.
echo.
pause`,

  "Disable Auto-start.cmd": String.raw`@echo off
del "${STARTUP}" 2>nul
echo Auto-start is off.
echo.
pause`,

  "Uninstall.cmd": String.raw`@echo off
echo This removes UpdatePilot from Windows startup and deletes this computer's saved agent key.
echo Also revoke this computer in UpdatePilot: Settings ^& agent ^> Revoke.
echo.
choice /m "Continue"
if errorlevel 2 exit /b
del "${STARTUP}" 2>nul
"%~dp0node.exe" "%~dp0cli.mjs" unpair
echo.
echo Done. You can now delete this folder.
pause`,

  "README.txt": `UpdatePilot Agent ${version}
=========================

The agent lets the UpdatePilot dashboard scan this computer's apps and install
updates that YOU confirm. It never installs anything without your confirmation.

First time
1. In the UpdatePilot dashboard: Settings & agent > Generate pairing code.
2. Double-click "Pair.cmd" and type the code.
3. Double-click "Start Agent.cmd". Keep the window open while you use UpdatePilot.

Optional
- "Enable Auto-start.cmd": start the agent automatically when you sign in.
- "Status.cmd": check whether this computer is paired.

Stop the agent: press Ctrl+C in its window, or close the window.

Remove: run "Uninstall.cmd", revoke the computer in Settings, then delete this folder.

Requirements: Windows 10/11 with WinGet (App Installer from the Microsoft Store).
Your agent key is stored in %LOCALAPPDATA%\\UpdatePilot\\agent.json.
`,
};

for (const [name, text] of Object.entries(files)) {
  writeFileSync(join(OUT, name), text.replace(/\r?\n/g, "\r\n"));
}

// 4. Zip it with Windows' own tar (supports .zip)
const zipName = `UpdatePilotAgent-${version}.zip`;
const tar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
const zip = spawnSync(tar, ["-a", "-c", "-f", zipName, "UpdatePilotAgent"], { cwd: "release", stdio: "inherit" });

console.log(`\nPackage folder: ${OUT}`);
console.log(zip.status === 0 ? `Zip file:       release\\${zipName}` : "Zip failed (the folder is still usable).");