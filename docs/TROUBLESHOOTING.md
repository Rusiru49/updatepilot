# UpdatePilot Troubleshooting

Find your problem below. Each entry gives the **cause** and the **fix**. Many of these were found while testing UpdatePilot on real computers.

**Before anything else, check that all three parts are running:**

1. **PostgreSQL** (database): Windows Services → `postgresql-x64-18` → **Running**
2. **API**: its window shows it is listening on port 4000
3. **Dashboard** (web): its window shows `Ready`

---

## Dashboard and server

### The dashboard says "The UpdatePilot server isn't responding" or "Can't reach the server"
- **Cause:** the API isn't running.
- **Fix:** start it (`npm start` in `api`, or `start-updatepilot.cmd`). Check its window for errors (see the next item).

### API window: `P1001: Can't reach database server at localhost:5432`
- **Cause:** PostgreSQL isn't running. This happens after a restart, or **after updating PostgreSQL**, because the installer stops the service.
- **Fix:**
  1. Press **Win + R** → `services.msc` → find **postgresql-x64-18** → right-click → **Start**.
  2. Set **Startup type** to **Automatic** so it starts with Windows.
  3. Start the API again.
- **If it still fails while PostgreSQL is running:** in `api/.env`, change `localhost` to `127.0.0.1` in `DATABASE_URL`.

### Web window: `Failed to proxy http://localhost:4000/... ECONNREFUSED`
- **Cause:** the dashboard is running, but the API isn't.
- **Fix:** start the API (see above).

### "Too many attempts. Try again later." when signing in
- **Cause:** a security limit of 20 sign-in attempts per 15 minutes.
- **Fix:** wait 15 minutes and try again.

### "This request was blocked for your security. Refresh the page and try again."
- **Cause:** the page's security token (CSRF) is missing or out of date, for example after the server restarted.
- **Fix:** refresh the page (**F5**) and try again.

### The page signs me out or shows the login page
- **Cause:** the session expired or was logged out, or the server's database was reset.
- **Fix:** sign in again.

---

## Pairing

### "This pairing code is invalid or has expired"
- **Cause:** codes work **once** and expire after **10 minutes**.
- **Fix:** generate a new code in **Settings & agent** and pair again straight away.

### "Already paired as "…". To pair again, run Uninstall.cmd first…"
- **Cause:** this computer already has a saved agent key.
- **Fix:**
  - **To check what it's paired with:** run **Status.cmd**. If the server and key are OK, you don't need to pair again; just run **Start Agent.cmd**.
  - **To pair again:** run **Uninstall.cmd**, then **Pair.cmd** with a new code. Revoke the old entry in Settings if it's still listed.

### "The server address must start with https://…"
- **Cause:** for security, the agent never sends its key over an unencrypted connection, except to `localhost` on the same computer.
- **Fix:** use the server's `https://` address. If the dashboard runs on this computer, press **Enter** to use `http://localhost:4000`.
- **Testing only:** on a trusted network, a developer can allow `http://` by running `set UPDATEPILOT_ALLOW_HTTP=1` in the **same Command Prompt window** before `Pair.cmd` and `Start Agent.cmd`. The agent shows a warning. Never use this on public networks.

### "Could not connect… Is the UpdatePilot server running?"
- **Cause:** the agent can't reach the server.
- **Fix:**
  1. Check the API is running.
  2. Check the **address**. A computer's IP address can change when it reconnects or moves to another network (check with `ipconfig`).
  3. If the server is on another computer, make sure both are on the same network and its firewall allows port 4000.
  4. To test the connection, open `http://<server>:4000/api/v1/health` in a browser. It should show `{"status":"ok"}`.

### My computer doesn't appear in the dashboard after pairing
- **Cause:** it was paired from a **different account**. Each account only sees its own computers.
- **Fix:** sign in with the account that created the pairing code. Or run **Uninstall.cmd** and pair again from the account you want.

### Status.cmd says "Key: REJECTED (revoked?)"
- **Cause:** the computer was revoked in Settings, or its key is no longer valid.
- **Fix:** run **Pair.cmd** with a new code. The agent deletes a rejected key automatically.

---

## Agent

### The dashboard shows the computer as **Offline**
- **Cause:** the agent isn't running, the computer is asleep or off, or it lost its network connection. A computer shows Offline after about 2 minutes without contact.
- **Fix:** start the agent with **Start Agent.cmd**. If the network dropped, it reconnects by itself, usually within a minute.

### The agent window shows "Server problem… Retrying in … s"
- **Cause:** the server is temporarily unreachable.
- **Fix:** usually nothing; the agent keeps retrying and reconnects by itself. If it continues, check the server (see *Dashboard and server*).

### After signing in to Windows, the auto-start window shows the "https://" error
- **Cause:** auto-start never uses test mode, so it refuses `http://` addresses other than localhost. This is correct.
- **Fix:** use an `https://` server address for real use, or start the agent manually in test mode during testing. Turn auto-start off with **Disable Auto-start.cmd**.

### Windows shows a security warning when opening a `.cmd` file
- **Cause:** the zip was downloaded or emailed, so Windows marks its files as untrusted.
- **Fix:** delete the extracted folder, right-click the zip → **Properties** → tick **Unblock** → **OK**, and extract it again.

### Windows blocks a program built from the source code (Smart App Control / Application Control)
- **Cause:** Windows blocks unsigned programs.
- **Fix:** use the packaged agent. It runs on the signed `node.exe` and doesn't need any new program.

---

## Scanning

### "WinGet is not installed on this computer…"
- **Cause:** WinGet (App Installer) is missing.
- **Fix:** open the **Microsoft Store**, search **App Installer**, and install or update it. Check with `winget --version`, then **Scan now** again.

### The first scan is very slow, or fails with a time limit
- **Cause:** on first use, WinGet downloads and prepares its catalogue, which can take several minutes. Scans are limited to 5 minutes.
- **Fix:** wait and click **Scan now** again; the next scan is much faster. Make sure the computer has internet access.

### Scan failed: "The agent was stopped / restarted / stopped responding"
- **Cause:** the agent was closed or restarted, or the computer went to sleep or lost its network during the scan.
- **Fix:** start the agent and click **Scan now** again.

### "A scan is already running"
- **Cause:** only one scan runs at a time per computer.
- **Fix:** wait for it to finish. The page follows the running scan automatically.

### An app shows as **Unmatched**, **Unsupported** or **Unknown**
- **Cause:** WinGet can't identify the app (*Unmatched*); it's a Microsoft Store or system app (*Unsupported*); or its version can't be compared reliably (*Unknown*).
- **Fix:** UpdatePilot can't update these safely. Update them through the app itself, the Microsoft Store or Windows Update.

---

## Updates

### The update says the version didn't change ("Some apps finish updating only after they are closed")
- **Cause:** the installer reported success, but the app was **still open**. This is common for Microsoft Store (MSIX) apps such as Windows Terminal. UpdatePilot checks the real version, so it reports this honestly as failed.
- **Fix:** **close the app**, then click **Try again** or run a new scan.

### "Restart required"
- **Cause:** Windows needs to restart to finish the update.
- **Fix:** save your work, restart the computer, start the agent, then click **Scan now** to confirm the new version.

### The update failed with an exit code (for example "cancelled" or "access denied")
- **Cause:** the installer stopped. The message explains the code; common causes are a declined **administrator prompt**, the app being open, or no internet connection.
- **Fix:** do what the message says (for example accept the administrator prompt **on the computer being updated**), then click **Try again**.

### The update stays on "Waiting for the agent…"
- **Cause:** the agent is offline.
- **Fix:** start the agent; it picks up the update straight away. If the agent stays offline, the job closes automatically after a while, and you can try again later.

### "The agent restarted / was stopped while this job was running"
- **Cause:** the agent was closed or restarted during the update.
- **Fix:** the update may or may not have been installed. If the agent restarted, a check scan runs automatically; otherwise click **Scan now** to see the real installed version.

### "This confirmation has expired"
- **Cause:** a confirmation is valid for 5 minutes.
- **Fix:** click **Refresh confirmation**, check the details again and confirm.

### "An update is already running on this computer"
- **Cause:** only one update runs at a time per computer.
- **Fix:** wait for it to finish (watch it on the **Updates** page), then start the next one.

---

## Developers

### `npm run seed` says "Refusing to run the seed in production"
- **Cause:** the seed deletes all data, so it is blocked when `NODE_ENV=production`.
- **Fix:** run it only in development, and never on a database you need to keep.

### Tests fail with "refuses to reset" or touch the wrong database
- **Cause:** the API tests only run against a database whose name contains `_test`.
- **Fix:** set `DATABASE_URL` in `api/.env.test` to a test database (for example `updatepilot_test`) and run `npm run test:db` once.

### Don't update UpdatePilot's own dependencies from UpdatePilot
Updating **Node.js, Git, App Installer (WinGet) or PostgreSQL** from UpdatePilot on the computer that runs it can stop the agent, WinGet or the API in the middle of the job. Update them manually with UpdatePilot stopped.

---

## Still stuck?

Collect this information and send it to the developer:

1. A screenshot of the message in the dashboard
2. The text in the **agent window**
3. The output of **Status.cmd**
4. The text in the **API window** (server side)
5. What you did just before the problem