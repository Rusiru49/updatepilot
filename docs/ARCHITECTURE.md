# UpdatePilot Architecture

How UpdatePilot is built as of version 1.0, and what changed since the Week 1 design.

---

## 1. Overview

```
 ┌────────────────────┐        ┌────────────────────────┐        ┌──────────────────────┐
 │  Browser           │  /api  │  Web (Next.js, :3000)  │  proxy │  API (Express, :4000)│
 │  dashboard UI      │ ─────▶ │  pages + rewrite       │ ─────▶ │  auth, jobs, rules   │
 └────────────────────┘        └────────────────────────┘        └──────────┬───────────┘
                                                                             │ Prisma
                                                                  ┌──────────▼───────────┐
                                                                  │  PostgreSQL          │
                                                                  └──────────────────────┘
 ┌──────────────────────────────┐   HTTPS + Bearer key (polls every 5 s)        ▲
 │  Windows agent (user's PC)   │ ─────────────────────────────────────────────┘
 │  node.exe + agent.mjs        │
 │  └─ winget list / export / upgrade
 └──────────────────────────────┘
```

| Part | Technology | Responsibility |
|---|---|---|
| **Web** | Next.js 16 (App Router, Webpack), React 19, TypeScript, Tailwind CSS 3 | Pages, forms, progress dialogs. Calls the API through a same-origin rewrite (`/api/*` → `:4000`), so the session cookie stays first-party. |
| **API** | Node.js, Express 5, TypeScript (tsx), zod, Prisma 7 | Authentication, ownership checks, job queue, the trust rules and **the final decision on every result** |
| **Database** | PostgreSQL 18 | Users, computers, apps, jobs, history, audit |
| **Agent** | Node.js + TypeScript, bundled with esbuild; shipped with signed `node.exe` | Runs WinGet on the user's computer; never accepts incoming connections |

---

## 2. Main flows

### 2.1 Pairing
1. A signed-in user clicks **Generate pairing code**. The API stores a **hash** of an 8-character code (10 minutes, single use).
2. On the computer, `Pair.cmd` sends the code with the computer name and Windows version to `POST /agent/pair`.
3. The API claims the code atomically, creates the **Device** and an **AgentCredential** (hash of a new `upa_…` key), and returns the key **once**.
4. The agent saves the key in `%LOCALAPPDATA%\UpdatePilot\agent.json`.

### 2.2 Scan
1. The user clicks **Scan now** → `POST /devices/:id/scans` creates a **ScanJob** (`QUEUED`). Only one active scan per computer is allowed, and only while it is online.
2. The agent's poll (`POST /agent/jobs/next`, every 5 s; also its heartbeat) claims the job atomically (`RUNNING`).
3. The agent runs `winget list` (and `winget export` for cut-off IDs), parses the table using the column positions from the header, and marks each app **MATCHED / UNMATCHED / UNSUPPORTED**.
4. It uploads the results (`/agent/scans/:id/results`, retried if the API is briefly down).
5. The API re-checks trust, updates **Application** rows (matched by a local ID), writes **AppSnapshot** history, stores **ReleaseMetadata**, and marks apps that disappeared as removed.
6. The dashboard polls `GET /scans/:id` and refreshes when the scan is done.

### 2.3 Update
1. **Preview:** `POST /updates/:id/preview` checks ownership, trust, a really newer version, and no running update. It returns the details and warnings, plus a one-time **UpdatePreview** token (`upp_…`, 5 minutes, hashed).
2. **Execute:** `POST /updates/:id/execute` with the token and an **Idempotency-Key** creates an **UpdateJob** (`QUEUED`). A repeated request returns the same job; one update runs per computer.
3. **Agent:** claims it (`RUNNING`), re-validates the package ID and version, and runs:
   `winget upgrade --id <Id> --exact --version <v> --source winget --silent --accept-package-agreements --accept-source-agreements` (`shell: false`).
4. **Verify:** the agent reports `VERIFYING`, rescans the app up to 3 times, 10 s apart, and sends the exit code and the verified version.
5. **Decide:** the API sets the final state:
   - **SUCCEEDED** if the verified version reached the target
   - **RESTART_REQUIRED** if a restart is needed
   - **FAILED** otherwise, including "installer said OK but the version didn't change"

   It also writes audit and history entries.

### 2.4 Recovery (interrupted jobs)

| Situation | What happens |
|---|---|
| Agent starts | `POST /agent/hello`: the API closes any jobs that agent had picked up; if an update was interrupted, a check scan is queued |
| Agent stopped (Ctrl+C / window closed) | `POST /agent/goodbye`: its running jobs are closed straight away |
| Agent disappears (sleep, crash, network) | A background check every 30 s closes running jobs after **3 minutes** without a heartbeat |
| API briefly down | The agent retries result uploads (5 s → 15 s → 30 s → 60 s → 60 s) |
| Anything else stuck | Time limits: scan 10 min; update 10 min queued, 20 min running |

---

## 3. Data model

PostgreSQL via Prisma, 14 tables.

| Table | Purpose | Key fields |
|---|---|---|
| **User** | Account | email (unique), passwordHash, displayName |
| **UserSettings** | Preferences | userId |
| **Session** | Sign-in session | tokenHash (unique), csrfToken, expiresAt |
| **Device** | A paired computer | userId, deviceName, osVersion, agentVersion, status, pairedAt, lastSeenAt |
| **AgentCredential** | The agent's key | deviceId, credentialHash, revoked/expiry |
| **PairingCode** | One-time pairing code | codeHash (unique), userId, expiresAt, usedAt |
| **Application** | An installed app | deviceId, localId, displayName, publisher, installedVersion, packageId, source, matchStatus, versionUncertain, removedAt |
| **AppSnapshot** | Version history per scan | applicationId, scanJobId, version |
| **ReleaseMetadata** | Known versions per package | packageId + version + source (unique) |
| **ScanJob** | A scan | deviceId, requestedById, state, appsFound, startedAt, finishedAt, errorSummary |
| **UpdatePreview** | One-time confirmation | tokenHash, applicationId, targetVersion, expiresAt |
| **UpdateJob** | An update | deviceId, applicationId, packageId, fromVersion, targetVersion, state, exitCode, verifiedVersion, errorMessage, startedAt, finishedAt |
| **SecurityFinding** | Advisories (reserved for Security insights) | packageId, advisory ID, severity, affected range, source |
| **AuditEvent** | Who did what | actorUserId, deviceId, eventType, target, metadata, timestamp |

**Job states (`JobState`):** `QUEUED → SENT_TO_AGENT → RUNNING → (VERIFYING) → SUCCEEDED | FAILED | RESTART_REQUIRED | CANCELLED`

---

## 4. API

Base path `/api/v1`. All errors use `{ "error": { "code", "message", "details" } }`.

| Area | Endpoints | Auth |
|---|---|---|
| Health | `GET /health` | none |
| Auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | session cookie |
| Dashboard | `GET /dashboard` | session + CSRF for changes |
| Devices | `GET /devices`, `POST /devices/pairing-codes`, `POST /devices/:id/scans`, `DELETE /devices/:id/credentials` | session + CSRF |
| Scans | `GET /scans/:id` | session |
| Applications | `GET /applications`, `GET /applications/:id` | session |
| Updates | `GET /updates`, `POST /updates/:id/preview`, `POST /updates/:id/execute`, `GET /updates/jobs/:id` | session + CSRF |
| History | `GET /history` | session |
| Agent | `POST /agent/pair` (code), then with a Bearer key: `heartbeat`, `me`, `hello`, `goodbye`, `jobs/next`, `scans/:id/results`, `scans/:id/fail`, `updates/:id/progress`, `updates/:id/result` | Bearer agent key |

---

## 5. Key rules

- **Trust rule:** an app can be updated only if its source is `winget`, its package ID is complete (not cut off with "…") and matches `^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$`. MSIX apps are *unsupported*, and unmatched installs are *unmatched*.
- **Version comparison:** numeric parts are compared as numbers (`1.10 > 1.9`); missing parts count as 0 (`1.0 = 1.0.0`); pre-releases come before releases; unclear versions (`< x`, `> x`, `Unknown`) are never compared. The same code is used by the API and the agent.
- **Major upgrade warning:** the first number increases (ignoring year-style numbers of 1000 or more).
- **Online:** a heartbeat within the last 2 minutes.

---

## 6. Repository layout

```
updatepilot/
├─ api/        Express API: src/routes, src/lib, src/middleware, src/tests, prisma/
├─ web/        Next.js dashboard: src/app (pages), src/components, src/lib
├─ agent/      Windows agent: src (index, cli, winget, http, lifecycle, version), scripts (build, package)
├─ docs/       USER_GUIDE, TROUBLESHOOTING, SECURITY_AND_PRIVACY, ARCHITECTURE
├─ start-updatepilot.cmd   one-click production start
└─ README.md
```

---

## 7. Changes since the Week 1 design

| Week 1 design | Final implementation | Why |
|---|---|---|
| `POST /devices/pair` | `POST /devices/pairing-codes` (dashboard) + `POST /agent/pair` (agent) | The user creates a code; the agent exchanges it for its own key |
| `GET /jobs/:id` | `GET /scans/:id` and `GET /updates/jobs/:id` | Scans and updates have different data |
| `GET /security/findings` | Not implemented; honest Security insights page | No reliable free source for WinGet packages |
| Core entities | Added **Session**, **PairingCode** and **UpdatePreview** tables | Secure sessions, one-time pairing and one-time confirmations |
| Application | Added `localId`, `versionUncertain`, `removedAt` | Reliable matching between scans, no version guessing, history kept for removed apps |
| UpdateJob | Added `packageId` | The exact approved package travels with the job |
| Session | Added `csrfToken` | CSRF protection (Week 5) |
| Agent endpoints | Added `hello`, `goodbye` | Interrupted jobs close within seconds (Week 5) |
| Agent delivery | Portable zip with signed `node.exe` | Unsigned executables are blocked by Smart App Control |
| Web tooling | Webpack mode, Tailwind CSS 3 | Native Turbopack / Tailwind 4 engines blocked by Application Control on the development PC |