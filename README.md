# UpdatePilot

UpdatePilot is a Windows-first software update intelligence and management MVP. The current work establishes the backend data model and API foundation; the frontend is still the default Next.js starter page.

## Project structure

- `web/` — Next.js 16, React 19, TypeScript, and Tailwind CSS frontend
- `api/` — Express 5 API written in TypeScript, using Prisma 7 and PostgreSQL

## Current implementation

### API

- `GET /api/v1/health` — API health check
- Authentication:
  - `POST /api/v1/auth/register`
  - `POST /api/v1/auth/login`
  - `POST /api/v1/auth/logout`
  - `GET /api/v1/auth/me`
- Authenticated inventory and activity endpoints:
  - `GET /api/v1/dashboard`
  - `GET /api/v1/devices`
  - `GET /api/v1/applications` — filtering, search, sorting, and pagination
  - `GET /api/v1/applications/:id` — application details, version/update history, and security findings
  - `GET /api/v1/history` — paginated scan and update history with filters
- Registration and login validate inputs, use bcrypt password hashes, and issue HTTP-only session cookies. Login and registration are rate-limited.
- User, device, application, scan/update job, release metadata, security finding, audit event, and session models are defined in Prisma, with migrations in `api/prisma/migrations`.
- The sample-data seed creates a demo account, a sample Windows device, inventory, and example scan/update history.

### Not implemented yet

- The web page is still the unmodified Next.js starter screen; application screens and API integration have not been built.
- There is no Windows agent or live device pairing, scanning, package catalog synchronization, or update execution yet. The API currently exposes read endpoints for persisted inventory and history, rather than triggering those operations.

## Run locally

Requirements: Node.js/npm and a PostgreSQL database.

1. Configure the API database connection. Create `api/.env` with:

   ```env
   DATABASE_URL="<your PostgreSQL connection string>"
   ```

2. Install API dependencies and prepare the database:

   ```powershell
   cd api
   npm install
   npx prisma generate
   npx prisma migrate deploy
   ```

3. In `api/`, start the API:

   ```powershell
   npm run dev
   ```

   The API listens on `http://localhost:4000`. `WEB_ORIGIN` can optionally be set in `api/.env` to change the allowed frontend origin; it defaults to `http://localhost:3000`.

4. In a separate terminal, install and start the frontend:

   ```powershell
   cd web
   npm install
   npm run dev
   ```

   Open `http://localhost:3000`. The frontend runs in Webpack mode (`next dev --webpack`) because Windows Application Control blocks the Turbopack native bindings on the development machine.

Check the API at [http://localhost:4000/api/v1/health](http://localhost:4000/api/v1/health).

## Sample data

To load the development sample account and records, run from `api/`:

```powershell
npm run seed
```

The sample login is `demo@updatepilot.local` / `Demo@12345`. **The seed script deletes existing users, devices, and most inventory/history records before inserting the samples. Do not run it against a database containing data you need to keep.** Sample inventory and history are illustrative, not results from a real device scan.
