# UpdatePilot

UpdatePilot is a Windows-first software update intelligence and management MVP. A web dashboard works together with a small Windows agent installed on the user's computer: the agent discovers installed applications with **Windows Package Manager (WinGet)**, the dashboard shows which apps have newer versions, and supported updates run **only after the user reviews and confirms them**. Every update is verified by a fresh scan before it is reported as successful.

**Status:** Week 5 complete (testing, security and UX polish). Milestones M1–M3 are achieved: real scan data (about 100 apps on the development PC) and real verified updates (for example VLC 3.0.23 → 3.0.24 and CrystalDiskInfo 9.9.3 → 9.9.4).

## Project structure

| Folder | What it is | Stack |
|---|---|---|
| `web/` | Dashboard (browser) | Next.js 16 (App Router, Webpack mode), React 19, TypeScript, Tailwind CSS 3, lucide-react |
| `api/` | Backend API | Node.js, Express 5, TypeScript (tsx), zod, Prisma 7, PostgreSQL |
| `agent/` | Windows agent (runs on the user's PC) | Node.js, TypeScript, WinGet |

```
Browser (web, :3000) ──/api rewrite──▶ API (:4000) ◀──HTTPS/Bearer key── Windows agent ──▶ winget
                                           │
                                       PostgreSQL
```

The web app calls the API through a Next.js rewrite (`/api/*` → `http://localhost:4000/api/*`), so the session cookie stays same-origin. The agent never accepts incoming connections: it polls the API for work every 5 seconds.

## Features

### Web dashboard
- **Accounts:** register, log in and log out, with HTTP-only session cookies.
- **Overview:** app counts (up to date, updates available, unknown), last scan, agent status, recent activity and a **Scan now** button with live progress.
- **Applications:** search, sorting, pagination and filters. The details page shows installed and available versions, package Id, source, version history and update attempts.
- **Updates:** a list of apps with a newer trusted version, with major-upgrade and Store-app warnings. **Review → Confirm → Progress** dialog: Queued → Installing → Verifying → Done, with a clear result and **Try again** after a failure.
- **History:** scan and update events with filters and outcomes.
- **Settings & agent:** generate a pairing code (with countdown), see device status, revoke a device, and switch the theme (light or dark).
- **Security insights:** an honest explanation page (see Known limitations).
- **Accessible and responsive:** keyboard navigation, visible focus, skip link, screen-reader labels and announcements, reduced-motion support, and layouts checked from 375 px phones to 1920 px screens.

### Windows agent
- **Secure pairing** with a one-time code from the dashboard.
- **Scans** with `winget list` (plus `winget export` to recover cut-off package Ids). It reads the table columns from the header each time, removes duplicates, and marks each app:
  - **trusted:** a WinGet package with a complete, valid Id
  - **unmatched:** a normal install that WinGet can't match (ARP)
  - **unsupported:** a Store or system (MSIX) app
- **Updates** with one fixed command:
  `winget upgrade --id <Id> --exact --version <version> --source winget --silent --accept-package-agreements --accept-source-agreements`
  It runs without a shell, and both the package Id and the version are validated by the agent as well as the server.
- **Verification:** after the installer finishes, the agent rescans the app (up to 3 times, 10 seconds apart). The **server** decides the result: succeeded, failed (version didn't change), or restart required.
- **Resilience:**
  - a heartbeat every 30 seconds during long jobs
  - it retries sending results if the API is briefly down
  - it tells the server when it starts ("hello") and stops ("goodbye"), so interrupted jobs close within seconds
  - it exits and deletes its key if the key is revoked

### API endpoints (`/api/v1`)

| Area | Endpoints |
|---|---|
| Health | `GET /health` |
| Auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` |
| Dashboard | `GET /dashboard` |
| Devices | `GET /devices`, `POST /devices/pairing-codes`, `POST /devices/:id/scans`, `DELETE /devices/:id/credentials` |
| Scans | `GET /scans/:id` |
| Applications | `GET /applications` (search, filter, sort, paginate), `GET /applications/:id` |
| Updates | `GET /updates`, `POST /updates/:id/preview`, `POST /updates/:id/execute` (needs a one-time preview token and an `Idempotency-Key`), `GET /updates/jobs/:id` |
| History | `GET /history` |
| Agent (Bearer key) | `POST /agent/pair`, `POST /agent/heartbeat`, `GET /agent/me`, `POST /agent/hello`, `POST /agent/goodbye`, `POST /agent/jobs/next`, `POST /agent/scans/:id/results`, `POST /agent/scans/:id/fail`, `POST /agent/updates/:id/progress`, `POST /agent/updates/:id/result` |

Errors use one format: `{ "error": { "code": "...", "message": "...", "details": ... } }`.

## Security

UpdatePilot was reviewed against 12 threats (T1–T12) in Week 5. The main protections:

- **Command injection (T1):** strict package-Id and version patterns on the server and the agent; winget runs with a fixed argument list and no shell.
- **Agent identity (T2, T3):**
  - single-use pairing codes (8 characters, 10 minutes)
  - a per-device agent key, stored on the server only as a SHA-256 hash
  - instant revocation
  - the agent refuses unencrypted server addresses (https only, except localhost)
- **Tampered jobs or results (T4):** the agent validates every job, and the server re-checks package trust and validates all results.
- **Other users' data (T5):** every query is limited to the user's own devices; other users' items return 404, not 403.
- **CSRF (T6):** `SameSite=Lax` cookies plus a per-session CSRF token in the `X-CSRF-Token` header, compared in constant time.
- **Session theft (T7):** HTTP-only cookies, hashed session tokens, the CSRF token kept in memory only, and security headers (`nosniff`, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `Referrer-Policy`).
- **False success (T8):** the result is decided by the server from a verification rescan, never by the installer alone.
- **Replay and double updates (T9):** a one-time, 5-minute preview token, an Idempotency-Key, and one update per computer at a time.
- **Brute force (T10):** rate limits (login/register 20 per 15 minutes, pairing 10 per 15 minutes), bcrypt (cost 12), and the same error for a wrong password and an unknown email.
- **Leaks (T11):** password and token hashes are never returned, there are no stack traces in responses, and `X-Powered-By` is hidden.
- **Denial of service (T12):** JSON body limits (100 kB, agent 2 MB), job timeouts and lost-agent recovery.

## Run locally

**Requirements:**
- Windows 10/11 with **WinGet** (App Installer)
- **Node.js** (LTS) and npm
- **PostgreSQL** (developed on version 18)

### 1. API
Create `api/.env`:
```env
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/updatepilot"
WEB_ORIGIN="http://localhost:3000"   # optional, this is the default
```
Then:
```powershell
cd api
npm install
npx prisma generate
npx prisma migrate deploy
npm run dev
```
The API listens on `http://localhost:4000`. Check [http://localhost:4000/api/v1/health](http://localhost:4000/api/v1/health).

### 2. Web app
In a second terminal:
```powershell
cd web
npm install
npm run dev
```
Open `http://localhost:3000` and create an account. The frontend runs in Webpack mode (`next dev --webpack`) because Windows Application Control blocks the Turbopack native bindings on the development machine.

### 3. Windows agent
1. In the dashboard, go to **Settings & agent** and click **Generate pairing code**.
2. In a third terminal:
   ```powershell
   cd agent
   npm install
   npm run pair -- ABCD-EFGH
   npm run dev
   ```
   Use your own code in place of `ABCD-EFGH`.
3. The device shows **Online**. Click **Scan now** on the Overview page.

The agent key is saved in `%LOCALAPPDATA%\UpdatePilot\agent.json`. Press **Ctrl+C** to stop the agent; it tells the server before exiting.

**Safety while testing updates:** don't update **Node.js**, **Git** or **App Installer** from UpdatePilot on the development PC, because the agent and WinGet depend on them. Use apps such as VLC or CrystalDiskInfo.

## Tests

| Part | Command | What runs |
|---|---|---|
| API | `cd api` → `npm test` | Type-check plus **101 tests**: auth, CSRF, data access, pairing, scans, updates, recovery, security |
| Agent | `cd agent` → `npm test` | Type-check plus **25 tests**: WinGet parser, command safety, exit codes, version comparison, server-address safety |
| Web | `cd web` → `npm run lint` | ESLint, including accessibility rules |

API tests use a **separate database**. Create `api/.env.test` with a `DATABASE_URL` whose database name contains `_test` (for example `updatepilot_test`), then prepare it once:
```powershell
cd api
npm run test:db
```
The test helper refuses to reset any database whose name doesn't contain `_test`.

## Sample data

To load the development sample account and records, run from `api/`:
```powershell
npm run seed
```
The sample login is `demo@updatepilot.local` / `Demo@12345` (shown on the login page in development only).

**The seed script deletes existing users, devices and most inventory and history records before inserting the samples. Do not run it against a database containing data you need to keep.** Sample data is illustrative, not the result of a real scan.

## Known limitations

- **Store / MSIX apps that are open** (for example Windows Terminal) may report success but only finish updating after they are closed. UpdatePilot verifies the version, reports this as failed, and tells the user to close the app and try again.
- **Only trusted WinGet packages can be updated.** Apps WinGet can't match are shown as *unmatched*, and Store or system apps as *unsupported*.
- **Administrator prompts** must be answered on the computer itself.
- **The agent key is stored unencrypted** in the user's own profile. It can be revoked instantly in Settings. Planned: Windows DPAPI encryption.
- **Development uses `http://localhost`.** Production needs HTTPS, which also turns on the secure cookie flag.
- **No full Content-Security-Policy** for web pages yet (framing is blocked).
- **Security insights are not available yet.** No free source reliably matches WinGet packages to vulnerabilities, and UpdatePilot does not guess. Planned: verified advisories from the NIST National Vulnerability Database for common apps.
- **Expired sessions, pairing codes and previews** remain in the database. They are rejected on use. Planned: a daily cleanup job.
- The dashboard focuses on **one computer** (the most recently active one).

## Roadmap (Week 6)

- Package the agent and test on a clean Windows machine
- Fix defects found during clean-machine testing
- User guide, troubleshooting guide and final documentation
- Demo preparation
- Planned improvements: DPAPI key encryption, verified Security insights (NVD), and a cleanup job