# UpdatePilot User Guide

UpdatePilot shows which apps on your Windows computer have newer versions and lets you update them safely. It **never installs anything without your confirmation**, and it checks every update with a fresh scan before calling it successful.

UpdatePilot has two parts:

| Part | Where it runs | What it does |
|---|---|---|
| **Dashboard** | Your web browser | Shows your apps, available updates and history; this is where you confirm updates |
| **Agent** | The Windows computer you want to manage | Scans installed apps with Windows Package Manager (WinGet) and runs the updates you confirm |

> Setting up the server (API, database and dashboard) is covered in the project README. This guide assumes the dashboard is already running.

---

## 1. Requirements

- Windows 10 or 11
- **WinGet**, which comes with **App Installer** from the Microsoft Store. To check, open Command Prompt and type `winget --version`.
- The **UpdatePilot Agent** zip file (`UpdatePilotAgent-<version>.zip`)
- An UpdatePilot account

---

## 2. Create an account and sign in

1. Open the dashboard in your browser (for example `http://localhost:3000`).
2. Click **Create an account**, then enter your name, email and a password. The page shows the password rules.
3. You are signed in and taken to the **Overview** page.

Next time, sign in with your email and password. **Log out** is at the top right.

---

## 3. Install and pair the agent

Pairing connects a computer to **your** account. Each computer belongs to the account that created its pairing code, so pair from the account you will use.

### 3.1 Extract the agent
1. Right-click the zip file → **Properties**. If you see **Unblock**, tick it and click **OK**. This stops Windows warning about every file.
2. Right-click the zip → **Extract All…** → choose a folder you will keep (for example `Documents\UpdatePilotAgent`).

The folder contains:

| File | Use |
|---|---|
| `Pair.cmd` | Pair this computer (first time) |
| `Start Agent.cmd` | Start the agent |
| `Status.cmd` | Check whether this computer is paired |
| `Enable Auto-start.cmd` / `Disable Auto-start.cmd` | Start the agent automatically when you sign in to Windows |
| `Uninstall.cmd` | Remove the agent's key and auto-start |
| `node.exe`, `agent.mjs`, `cli.mjs` | The agent itself; don't move or delete these |

### 3.2 Get a pairing code
In the dashboard, go to **Settings & agent** and click **Generate pairing code**. The code (for example `K7QM-4R2X`) works **once** and expires after **10 minutes**.

### 3.3 Pair
1. Double-click **Pair.cmd**.
2. **Server address:** press **Enter** if the dashboard runs on this same computer (`http://localhost:4000`). Otherwise type the address you were given (it must start with `https://`).
3. **Pairing code:** type the code from the dashboard.
4. You should see **OK: paired as "\<computer name\>"**.

### 3.4 Start the agent
Double-click **Start Agent.cmd**. A window opens and shows **Connected … waiting for work**.

**Keep this window open** while you use UpdatePilot. In the dashboard, your computer now shows as **Online**.

**Optional:** double-click **Enable Auto-start.cmd** so the agent starts (minimised) every time you sign in to Windows.

---

## 4. Overview and scanning

The **Overview** page shows:
- how many apps are **up to date**, have an **update available**, or are **unknown**
- when the last scan ran, and whether the agent is online
- your recent activity

Click **Scan now** to check the computer again. The page shows *Waiting for the agent…*, then *Scanning…*, then **Scan complete: N apps found**. The **first scan can take a few minutes** while WinGet prepares its catalogue; later scans usually take under a minute.

If the button is disabled and says the agent is offline, start the agent on that computer (section 3.4).

---

## 5. Applications

The **Applications** page lists every app found on the computer. You can **search**, **sort** by clicking a column, and change **rows per page**.

| Status | Meaning |
|---|---|
| **Up to date** | No newer version is known |
| **Update available** | WinGet has a newer version, and UpdatePilot can install it |
| **Unknown** | The installed version can't be compared reliably, so UpdatePilot does not guess |
| **Unmatched** | A normal install that WinGet can't identify, so UpdatePilot can't update it |
| **Unsupported** | A Microsoft Store or Windows system app; update it through the Store or Windows Update |

Click an app to see its details: installed and available versions, package ID, source, version history and past update attempts.

---

## 6. Updating an app

You can start an update from the **Updates** page (all available updates) or from an app's details page.

1. Click **Review** (or **Update to x.y**).
2. Check the details:
   - application
   - package ID
   - version (**from → to**)
   - source (WinGet)
   - **computer**: make sure it is the right one
   - any **warnings**, such as a major version change, an app that should be closed first, or a Windows administrator prompt
3. Click **Confirm update**. The confirmation is valid for 5 minutes; if it expires, click **Refresh confirmation**.
4. Watch the progress: **Queued → Installing → Verifying → Done**.
5. If Windows asks *"Do you want to allow this app to make changes?"*, answer **on the computer being updated**.

You can **close the dialog** at any time; the update keeps running, and the Updates page shows its progress.

### Results

| Result | What it means | What to do |
|---|---|---|
| ✅ **Updated and verified** | The new version was installed and confirmed by a rescan | Nothing |
| ❌ **Didn't complete** | The installer failed, or the version didn't change. The reason is shown (for example "close the app first") | Fix the reason shown, then click **Try again** |
| ⚠️ **Restart required** | Windows needs a restart to finish | Save your work, restart, start the agent, then **Scan now** to confirm |

**Tip:** close an app before updating it. Some apps, especially Microsoft Store apps, only finish updating after they are closed.

Only **one update runs at a time** on each computer.

---

## 7. History

The **History** page lists every scan and update with its date, result and details. Use the filters to show only scans, only updates, or only failures.

---

## 8. Settings & agent

- **Connected devices:** each paired computer with its status (Online/Offline), Windows version, agent version, last seen time and number of apps.
- **Revoke device:** disconnects a computer immediately. Its agent stops working and deletes its key. Use this if a computer is lost, sold or no longer used.
- **Generate pairing code:** pair a new computer (section 3).
- **Appearance:** light or dark theme.
- **Privacy:** what UpdatePilot stores (see section 11).

---

## 9. Security insights

This page explains why vulnerability information is **not shown yet**: UpdatePilot only shows a security finding when it can be verified for the exact app and version, and free sources don't yet match Windows (WinGet) apps reliably. Until then, the safest step is to keep apps up to date.

---

## 10. Stopping, auto-start and uninstalling

| To… | Do this |
|---|---|
| **Stop the agent** | Press **Ctrl+C** in its window (or close the window). The dashboard is told straight away. |
| **Start it again** | Double-click **Start Agent.cmd** |
| **Start automatically** | **Enable Auto-start.cmd** (turn off with **Disable Auto-start.cmd**) |
| **Remove UpdatePilot from a computer** | 1. Run **Uninstall.cmd** and answer **Y**. 2. In the dashboard, go to Settings & agent and click **Revoke device**. 3. Delete the agent folder. |

---

## 11. Privacy and safety

- UpdatePilot stores **only software names, versions, package IDs and job results** for your computers, plus your account details.
- It **does not** collect personal files, passwords, documents or browsing history.
- Your password is stored only as a secure hash. The agent's key is stored on the server only as a hash, and on the computer in `%LOCALAPPDATA%\UpdatePilot\agent.json`. **Never share this file.**
- Each account sees **only its own computers**.
- Updates run **only after you confirm them**. Each confirmation is for one app and one exact version, and every result is verified by a rescan.

---

## 12. Keyboard and accessibility

- Every action works with the keyboard: **Tab** / **Shift+Tab** to move, **Enter** or **Space** to activate, **Esc** to close a dialog.
- Press **Tab** once on any page to show **Skip to main content**.
- Screen readers announce scan and update progress.
- The dashboard works on screens from phones to large monitors, in light or dark theme, and respects the Windows "reduce animations" setting.

---

Having a problem? See **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)**.