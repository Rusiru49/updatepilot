# UpdatePilot Security and Privacy

This document describes what UpdatePilot stores, how it protects users and their computers, the results of the Week 5 security review, and the known risks.

---

## 1. Safety principles

1. **Nothing is installed without the user's confirmation.** Each confirmation covers one app and one exact version.
2. **Only trusted WinGet packages are updated,** using one fixed command. No other commands can be run.
3. **The result is verified.** After every update the agent rescans the app, and the **server** decides the outcome; the installer's own report is not trusted.
4. **Least data.** Only what is needed to show and update software is collected.
5. **Each account sees only its own computers.**

---

## 2. Data

### 2.1 What is stored

| Data | Where | Why |
|---|---|---|
| Name, email, **password hash** (bcrypt, cost 12) | Server database | Sign-in |
| Session token **hash** (SHA-256) and CSRF token | Server database | Keep the user signed in safely |
| Computer name, Windows version, agent version, last seen time | Server database | Show the computer and its status |
| Agent key **hash** (SHA-256) | Server database | Recognise the agent |
| Agent key (plain) | The user's computer: `%LOCALAPPDATA%\UpdatePilot\agent.json` | The agent proves who it is |
| Installed apps: name, publisher, version, package ID, source, match status | Server database | Inventory and update detection |
| Scan and update jobs: times, states, versions, exit codes, short error messages | Server database | Progress, history and troubleshooting |
| Audit events: who did what, on which computer, when | Server database | Accountability |
| Pairing codes and update confirmations (**hashes only**, short-lived) | Server database | One-time pairing and confirmation |

### 2.2 What is NOT collected
UpdatePilot does **not** collect:
- personal files or documents
- passwords other than the user's own UpdatePilot password (stored only as a hash)
- browsing history
- running processes, keystrokes or screenshots
- anything about other people's computers

The agent only runs `winget list`, `winget export` and the confirmed `winget upgrade` command.

### 2.3 Secrets are never shown or logged
- Password, session token, agent key and confirmation-token **hashes are never returned** by the API.
- The agent key is shown **once**, at pairing, and only to the agent.
- Error responses never include stack traces or internal details.

### 2.4 Retention
- Data is kept until the user's account or computer is removed by an administrator.
- **Revoking a computer** stops its agent immediately and deletes the key on that computer.
- Expired sessions, pairing codes and confirmations are rejected when used, but are not yet deleted automatically (planned: a daily cleanup job).
- The development **seed script deletes all data**. It refuses to run in production.

---

## 3. Security review (threat model T1–T12)

Reviewed in Week 5. Each threat has a protection and an automated test or manual check.

| # | Threat | Protection | Proven by |
|---|---|---|---|
| **T1** | **Command injection:** a malicious package ID or version runs extra commands | Strict package-ID and version patterns on the **server and the agent**; winget runs with a fixed argument list and `shell: false` | Agent test "refuses unsafe package Ids and versions"; server test "re-checks package Ids" |
| **T2** | **Agent spoofing:** a fake program pretends to be a computer | Single-use pairing codes (10 minutes) that only a signed-in user can create; a per-device key required on every agent call | Pairing tests (single use, expiry, key required) |
| **T3** | **Stolen agent key** | Only its hash is stored on the server; instant revocation; the agent deletes a rejected key; an agent key can't read user data; https required beyond localhost | "revoking a device locks its agent out", "agent key cannot access user data", server-address tests |
| **T4** | **Tampered jobs or results** | The agent validates every job (ID format, type, package and version); the server re-checks trust and validates results; results can't be sent twice | "server re-checks package Ids", "results can't be sent twice" |
| **T5** | **Access to another user's data (IDOR)** | Every query is limited to the user's own computers; other users' items return **404, not 403** | "returns 404 for another user's app", "other users can't scan this device" |
| **T6** | **CSRF:** another website makes changes with the user's sign-in | `SameSite=Lax` cookie **plus** a per-session CSRF token in the `X-CSRF-Token` header, compared in constant time | 8 CSRF tests; manual curl check (403 without the token) |
| **T7** | **Session theft / XSS** | `HttpOnly` cookie (`Secure` in production); hashed session tokens; React escapes output; CSRF token kept in memory only; security headers | Cookie and header tests |
| **T8** | **False success** | The server decides the result from a verification rescan; a version mismatch is reported as failed | "installer says OK but the version didn't change → FAILED"; real Windows Terminal case |
| **T9** | **Replay / double update** | One-time confirmation token (5 minutes, hashed, single use); Idempotency-Key; one update per computer at a time; rejected if the app changed after review | "a confirmation works once", "only one update at a time" |
| **T10** | **Brute force** | Rate limits (sign-in 20 / 15 min, pairing 10 / 15 min); bcrypt; the same error for a wrong password and an unknown email | "rate-limits repeated login attempts" |
| **T11** | **Information leaks** | No hashes or tokens in responses; no stack traces; `X-Powered-By` hidden | Security tests (headers, leaks) |
| **T12** | **Denial of service** | JSON body limits (100 kB; agent 2 MB); rate limits; one scan and one update per computer; job timeouts; lost-agent recovery | "rejects a huge request body with 413", recovery tests |

**Automated tests:** 101 API tests and 25+ agent tests, run with a type-check before every test run.

### Security headers
- **API:** `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`.
- **Web:** `nosniff`, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `Referrer-Policy: strict-origin-when-cross-origin`, a restrictive `Permissions-Policy`.

### Key settings

| Setting | Value |
|---|---|
| Session cookie | `up_session`, HttpOnly, SameSite=Lax, Secure in production |
| Pairing code | 8 characters (no 0/O/1/I), single use, 10 minutes, stored as a hash |
| Agent key | `upa_…`, random 32 bytes, stored on the server as a SHA-256 hash |
| Update confirmation | `upp_…`, single use, 5 minutes, stored as a hash |
| Lost agent | Running jobs closed after 3 minutes without a heartbeat |
| Job time limits | Scan 10 minutes; update 10 minutes in the queue, 20 minutes running |

---

## 4. Accepted risks

Known limits, accepted on purpose for this MVP, each with a reason and a plan.

| Risk | Why it is accepted now | Plan |
|---|---|---|
| The agent key is stored **unencrypted** on the computer | It's in the user's own profile folder, can be revoked instantly, and only its hash is on the server | Encrypt it with Windows **DPAPI** |
| The release runs on `http://localhost` | Traffic stays on the computer; the cookie becomes `Secure` in production, and the agent refuses `http://` beyond localhost | Use **HTTPS** for any real deployment |
| Test-only `UPDATEPILOT_ALLOW_HTTP=1` switch | Needed to test a second computer on a local network; off by default, shows a warning, never used by auto-start | Remove, or keep for development only, once HTTPS is set up |
| No full Content-Security-Policy for web pages | Framing is blocked and React escapes output; Next.js uses inline scripts | Add a nonce-based CSP |
| Packages come from the public WinGet community repository | Exact package ID, `--source winget`, the exact approved version, and verification by rescan | Same trust as using WinGet directly |
| Expired records stay in the database | They are rejected on use | Daily cleanup job |
| No account deletion from the dashboard | Out of the MVP scope | Add self-service account and data deletion |

---

## 5. Production checklist

Before running UpdatePilot anywhere other than a single development computer:

- [ ] Serve the dashboard and API over **HTTPS** with a valid certificate
- [ ] Run the API with `NODE_ENV=production` (`npm start`); never run the seed
- [ ] Use a strong, unique PostgreSQL password; don't expose port 5432 to the network
- [ ] Keep `api/.env` out of Git and readable only by the server account
- [ ] Set `WEB_ORIGIN` to the real dashboard address
- [ ] Back up the database regularly
- [ ] Open only the needed ports in the firewall, and remove any test rules
- [ ] Don't set `UPDATEPILOT_ALLOW_HTTP` on user computers
- [ ] Run `npm audit --omit=dev` in `api`, `web` and `agent`, and keep dependencies updated (with UpdatePilot stopped)

---

## 6. Reporting a problem

If you find a security problem, don't post it publicly. Contact the project owner directly, with steps to reproduce it.