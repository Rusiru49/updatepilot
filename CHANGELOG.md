# Changelog

## v1.0.0 (19 November 2026)

First release of UpdatePilot: a Windows-first software update intelligence and management MVP.

### Dashboard
- Accounts with secure sessions (HTTP-only cookies, CSRF protection)
- Overview: app counts, last scan, agent status, recent activity, **Scan now** with live progress
- Applications: search, sorting, pagination, filters and a details page with version and update history
- Updates: available updates with warnings; **Review → Confirm → Progress → Verified** dialog with **Try again**
- History of scans and updates
- Settings: pairing codes, device status, revoke, light and dark theme
- Honest Security insights page (no unverified claims)
- Accessible (keyboard, screen readers, visible focus, reduced motion) and responsive (375 px to 1920 px)

### Windows agent
- One-time-code pairing; per-device key stored only as a hash on the server
- Scans with WinGet: trusted, unmatched and unsupported apps; recovery of cut-off package IDs
- Updates with one fixed, validated `winget upgrade` command (no shell)
- Verification rescan; the server decides SUCCEEDED / FAILED / RESTART_REQUIRED
- Heartbeats, result-upload retries, hello/goodbye recovery, lost-agent detection
- Portable package: signed `node.exe`, bundled agent, Pair / Start / Status / Auto-start / Uninstall scripts

### Security
- Reviewed against 12 threats (T1–T12), each with a protection and a test
- Rate limits, bcrypt, hashed tokens, one-time confirmations, Idempotency-Key, security headers, https-only agent connections beyond localhost

### Quality
- 101 API tests and 25+ agent tests, with a type-check before every run
- Tested in production mode and on a second, clean Windows PC (a verified update: CPUID HWMonitor 1.56 → 1.68)
- Documentation: README, user guide, troubleshooting, security and privacy, architecture

### Known limitations
- Open Microsoft Store (MSIX) apps may only finish updating after they are closed (reported honestly as failed)
- Only trusted WinGet packages can be updated
- Agent key stored unencrypted in the user's profile (DPAPI planned)
- HTTPS required beyond localhost; no full Content-Security-Policy yet
- Security insights not available yet