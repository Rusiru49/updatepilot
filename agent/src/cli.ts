import { AGENT_VERSION, CREDENTIALS_FILE, SERVER_URL, deviceName, osVersion } from "./config";
import { ApiError, NetworkError, request } from "./http";
import { clearCredentials, loadCredentials, saveCredentials } from "./store";
import { scanInstalledApps, summarize, WingetError } from "./winget";

const [command, ...args] = process.argv.slice(2);

// npm run pair -- K7QM-4R2X   (add --force to replace an existing pairing)
async function pair() {
  const code = args.find((a) => !a.startsWith("--"))?.trim();
  const force = args.includes("--force");

  if (!code) {
    console.error("Usage: npm run pair -- <PAIRING-CODE>");
    process.exit(1);
  }
  if (!/^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/.test(code)) {
    console.error("That doesn't look like a pairing code (example: K7QM-4R2X).");
    process.exit(1);
  }

  const existing = loadCredentials();
  if (existing && !force) {
    console.error(`Already paired as "${existing.deviceName}". Run "npm run unpair" first, or add --force.`);
    process.exit(1);
  }

  const name = deviceName();
  console.log(`Pairing "${name}" with ${SERVER_URL} ...`);

  const res = await request<{ deviceId: string; deviceName: string; agentToken: string }>(SERVER_URL, "/agent/pair", {
    method: "POST",
    body: { code, deviceName: name, osVersion: osVersion(), agentVersion: AGENT_VERSION },
  });

  saveCredentials({
    serverUrl: SERVER_URL,
    deviceId: res.deviceId,
    deviceName: res.deviceName,
    agentToken: res.agentToken,
    pairedAt: new Date().toISOString(),
  });

  console.log(`OK: paired as "${res.deviceName}".`);
  console.log(`Key saved to ${CREDENTIALS_FILE} (never share this file).`);
  console.log("Start the agent with: npm start");
}

// npm run status
async function status() {
  const c = loadCredentials();
  if (!c) {
    console.log("Not paired. Run: npm run pair -- <PAIRING-CODE>");
    return;
  }

  console.log(`Device:   ${c.deviceName}`);
  console.log(`Server:   ${c.serverUrl}`);
  console.log(`Paired:   ${new Date(c.pairedAt).toLocaleString()}`);
  console.log(`Key file: ${CREDENTIALS_FILE}`);

  try {
    await request(c.serverUrl, "/agent/me", { token: c.agentToken });
    console.log("Key:      OK, accepted by the server");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      console.log("Key:      REJECTED (revoked?) - pair again");
    } else {
      console.log(`Key:      could not check - ${(err as Error).message}`);
    }
  }
}

// npm run unpair
function unpair() {
  clearCredentials();
  console.log("Local key deleted.");
  console.log("To also remove this device from your account, click Revoke in Settings & agent.");
}

// npm run scan   (add -- --json to see every app)
async function scan() {
  console.log("Scanning installed apps with winget... (this can take up to a minute)");
  const { apps, durationMs } = await scanInstalledApps();

  if (args.includes("--json")) {
    console.log(JSON.stringify(apps, null, 2));
    return;
  }

  const s = summarize(apps);
  console.log("");
  console.log(`Found ${s.total} apps in ${(durationMs / 1000).toFixed(1)} s`);
  console.log(`  Matched (trusted WinGet package): ${s.matched}`);
  console.log(`  Unmatched (no trusted package):   ${s.unmatched}`);
  console.log(`  Unsupported (Store/system apps):  ${s.unsupported}`);
  console.log(`  Updates available:                ${s.updatesAvailable}`);
  console.log("");

  for (const a of apps.filter((x) => x.matchStatus === "MATCHED" && x.availableVersion)) {
    console.log(`  ${a.displayName.slice(0, 40).padEnd(40)} ${a.installedVersion.padEnd(16)} -> ${a.availableVersion}`);
  }

  console.log("");
  console.log("This was a local test only - nothing was sent to the server.");
}

const commands: Record<string, () => unknown> = { pair, status, unpair, scan };
const run = commands[command ?? ""];

if (!run) {
  console.error("Commands: pair <CODE> | status | unpair | scan");
  process.exit(1);
}

Promise.resolve(run()).catch((err) => {
  if (err instanceof ApiError) console.error(`ERROR: ${err.message} (${err.code})`);
  else if (err instanceof NetworkError) console.error(`ERROR: ${err.message}. Is the UpdatePilot server running?`);
  else if (err instanceof WingetError) console.error(`ERROR: ${err.message}`);
  else console.error("ERROR: unexpected problem:", err);
  process.exit(1);
});