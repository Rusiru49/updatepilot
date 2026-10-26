# UpdatePilot

Software Update Intelligence & Management Platform (Windows-first MVP).

## Structure
- `web/` – Next.js + TypeScript + Tailwind frontend (http://localhost:3000)
- `api/` – Node.js + Express + TypeScript backend (http://localhost:4000)

## Run locally
Frontend: `cd web` → `npm install` → `npm run dev`
Backend:  `cd api` → `npm install` → `npm run dev`
Health check: http://localhost:4000/api/v1/health

## Note
The frontend runs in Webpack mode (`next dev --webpack`) because Windows
Application Control blocks the Turbopack native bindings on this machine.