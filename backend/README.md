# SDS UZ CRM — Backend

REST API for the dispatch CRM in `../sds-uz-crm`. Stack: **TypeScript, NestJS 11, PostgreSQL 16, Prisma 6**.

The API keeps the contract the frontend already used (`/api/auth/*`, `/api/records/:table`,
`/api/staff/manage`, `/api/account/update`, `/api/dev/test-data`), so the UI and its user flows are unchanged.
All permissions and business rules that used to run only in the browser preview are enforced here.

## Quick start (local development)

Requirements: Node.js ≥ 20.12, Docker (or any PostgreSQL 14+).

```bash
cd backend
cp .env.example .env                # then set JWT_SECRET: openssl rand -base64 48
docker compose up -d                # PostgreSQL on localhost:5432 (also creates sds_crm_test)
npm install
npm run db:migrate                  # apply migrations (prisma migrate deploy)
npm run db:seed                     # demo accounts from .env + sample data (refuses NODE_ENV=production)
npm run start:dev                   # API on http://localhost:3000/api
```

Frontend (in another terminal):

```bash
cd sds-uz-crm
npm install
npm run dev                         # http://127.0.0.1:5173 — /api is proxied to http://127.0.0.1:3000
```

Sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` or `SEED_DISPATCHER_EMAIL` / `SEED_DISPATCHER_PASSWORD`
from `.env` (the example file uses `admin@sds.local` / `Admin2026!` and `dispatcher@sds.local` / `Dispatch2026!`).
Test dispatchers `aziz@`, `bekzod@`, `dilnoza@sds.local` use `TEST_DATA_PASSWORD`.

To change the schema later: edit `prisma/schema.prisma`, then `npm run db:migrate:dev -- --name <change>`.

## Production

### With Docker (one server)

`docker-compose.prod.yml` in the repo root runs PostgreSQL, applies migrations, starts the API, serves the
frontend with nginx (which proxies `/api` to the API, so there is one origin and no CORS setup), and puts
Caddy in front for HTTPS with an automatic Let's Encrypt certificate.

1. DNS: add an A record for the site (for `srm.sdsuz-inc.com`: host `srm`, value = the server's IPv4).
2. On the server (Docker installed, ports 80 and 443 open):

```bash
git clone https://github.com/abubakr-isco/sds-srm.git && cd sds-srm
cp .env.production.example .env.production      # set POSTGRES_PASSWORD, JWT_SECRET, SITE_DOMAIN
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# First administrator (once):
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm \
  -e ADMIN_EMAIL=you@company.com -e ADMIN_FULL_NAME="Your Name" -e ADMIN_PASSWORD='<12+ chars>' \
  migrate npm run create-admin
```

To release a new version: `git pull`, then the same `up -d --build`; migrations run before the API starts.
Back up the database with
`docker compose -f docker-compose.prod.yml --env-file .env.production exec db pg_dump -U sds sds_crm > backup.sql`.

**Server that already runs nginx (current production, srm.sdsuz-inc.com):** copy the project to the server and
run `sudo bash deploy/server-setup.sh`. It installs Docker if needed, creates `.env.production` with random
secrets on first run (root-only), starts the stack on `127.0.0.1:8081`, adds one nginx site from
`deploy/nginx-srm*.conf` (checked with `nginx -t`) and gets the certificate with `certbot --webroot`. Run it again
for each release; it keeps the database and secrets. On an empty server use `--profile caddy` instead.

Note: `sds-uz-crm/vercel.json` builds the browser-only demo (`VITE_DEMO=1`, data in localStorage). It is not
the production app.

### Without Docker

```bash
NODE_ENV=production npm ci && npm run build
npm run db:migrate
ADMIN_EMAIL=you@company.com ADMIN_FULL_NAME="Your Name" ADMIN_PASSWORD='<12+ chars>' npm run create-admin
npm start
```

- There is **no** fixed admin password in production: the demo seed refuses to run, and the first administrator
  is created with `create-admin` from environment variables (the password is never printed).
- `ENABLE_TEST_DATA` is ignored when `NODE_ENV=production` (the endpoint answers 404).
- Serve the frontend build and the API from one origin (reverse proxy `/api` → this service), or build the
  frontend with `VITE_API_URL=https://api.example.com/api` and list the frontend origin in `CORS_ORIGINS`.
- Behind a reverse proxy set `TRUST_PROXY=true` (or the number of proxies, e.g. `2` for Caddy + nginx) so the
  per-IP sign-in limit sees real client IPs.
- Run behind HTTPS. Secrets live only in environment variables; `.env` is git-ignored.

## Environment variables

See [`.env.example`](.env.example). Required: `DATABASE_URL`, `JWT_SECRET` (≥ 32 chars).
Optional: `PORT`, `ACCESS_TOKEN_TTL_SECONDS` (3600), `REFRESH_TOKEN_TTL_DAYS` (30), `CORS_ORIGINS`,
`COMPANY_TIMEZONE` (America/Chicago), `LOGIN_MAX_FAILED_ATTEMPTS` (5), `LOGIN_LOCK_MINUTES` (15),
`AUTH_RATE_LIMIT_PER_MINUTE` (20), `TRUST_PROXY`, `ENABLE_TEST_DATA`, `TEST_DATA_PASSWORD`, `SEED_*`.

## Checks

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # ESLint (typescript-eslint)
npm run build         # compile to dist/
npm test              # e2e tests against TEST_DATABASE_URL (database name must end in _test)
```

`npm test` applies migrations to the test database and truncates its tables between tests. Default
`TEST_DATABASE_URL` is `postgresql://sds:sds_local_password@localhost:5432/sds_crm_test` (created by docker compose).

## Data model

| Table | Purpose / key rules |
|---|---|
| `users` | Employees (`staff_profiles` in the API). Unique lowercase email, scrypt `password_hash`, role `admin`/`dispatcher`, `is_active`, own fee `full_pct`/`partial_pct` (numeric(5,2), 0–100, null = company %), lockout counters. |
| `sessions` | Refresh-token sessions; only SHA-256 of the token is stored. Revoked on logout, deactivation, password reset. |
| `settings` | Single row (`id = 1`, CHECK): company fee %, display name, logo, theme. |
| `drivers` | Trucks/drivers; `dispatcher_id` → users (SET NULL). |
| `loads` | `load_number` unique; `total` numeric(12,2) ≥ 0; `status` enum; `delivery_date ≥ pickup_date` (CHECK); partial ⇔ `parent_load_number` (CHECK) → `loads.load_number` (ON UPDATE CASCADE, ON DELETE RESTRICT); `driver_id` → drivers (SET NULL); `assigned_to` → users. Indexed by dispatcher, driver, status, dates. |
| `load_history` | Audit of every load INSERT/UPDATE/DELETE with old/new row (JSONB), written in the same transaction. |
| `calendar_notes`, `custom_cities`, `activity_log`, `admin_notices` | As used by the Calendar, city picker, notification bell, and Employees page. |

Migrations: `prisma/migrations/` (CHECK constraints are in the SQL of the initial migration).

## API

Base path `/api`. JSON in and out. All routes except `/auth/login`, `/auth/refresh` and `/health` need
`Authorization: Bearer <access_token>`.

**Error format** (every error):

```json
{ "statusCode": 422, "error": "INVALID_STATUS_TRANSITION", "message": "Status cannot change from delivered to available.", "path": "/api/records/loads", "timestamp": "2026-11-16T18:00:00.000Z" }
```

Statuses: 400 validation, 401 not signed in / bad credentials / expired session, 403 not allowed,
404 not found or not visible to you, 405 operation not supported on the resource, 409 duplicate or still
referenced, 413 body too large, 422 business rule, 429 too many attempts.

### Auth

| Method & path | Body | Response |
|---|---|---|
| `POST /auth/login` | `{email, password}` | `{access_token, refresh_token, token_type, expires_in, user:{id,email}}` |
| `POST /auth/refresh` | `{refresh_token}` | new `{access_token, refresh_token, …}` — the old refresh token stops working |
| `POST /auth/logout` | — | 204; revokes the current session |
| `GET /health` | — | `{status:"ok"}` |

Brute-force protection: after `LOGIN_MAX_FAILED_ATTEMPTS` wrong passwords the account is locked for
`LOGIN_LOCK_MINUTES` (429 `ACCOUNT_LOCKED`); `/auth/*` is also limited per IP (`AUTH_RATE_LIMIT_PER_MINUTE`).
Every request re-checks that the session is open and the account active, so deactivation is immediate.

### Records — `/records/:table`

| Method | Meaning | Response |
|---|---|---|
| `GET /records/:table?…` | list | array of rows; with `limit`, header `X-Total-Count` |
| `POST /records/:table` | create (body = row) | 201, `[row]` |
| `PATCH /records/:table?id=eq.ID` or `?id=in.(A,B)` | update (body = changed fields) | `[rows]`; multi-row updates are all-or-nothing |
| `DELETE /records/:table?id=eq.ID` or `?id=in.(A,B)` | delete | `[deleted rows]` |

Query parameters: `col=eq.V`, `neq.V`, `in.(a,b)`, `is.null`, `gte.`/`lte.`/`gt.`/`lt.` (dates/numbers),
`ilike.*text*` (text columns), `order=col.asc|desc[,col2.desc]`, `limit` (1–1000), `offset`, `select=*`.
Only whitelisted columns can be filtered/sorted. PATCH/DELETE require an `id` filter.

| Table | Read | Write |
|---|---|---|
| `loads` | admin: all; dispatcher: own + unassigned pool | see rules below |
| `drivers` | admin: all; dispatcher: own | dispatcher: own only, cannot change `dispatcher_id`; admin: any (`dispatcher_id` must be an active dispatcher). Delete clears the truck from its loads (with history). |
| `settings` | everyone | PATCH `?id=eq.1` admin only |
| `staff_profiles` | admin: all; dispatcher: active colleagues (fee % only for self) | read-only here (405) |
| `calendar_notes` | everyone | create: everyone (author = you); delete: author or admin |
| `custom_cities` | everyone | create: everyone; delete: admin |
| `activity_log` | admin: all; dispatcher: own | create only (append-only); user is taken from the token |
| `load_history` | admin: all; dispatcher: loads they can see | read-only |
| `admin_notices` | admin | delete (dismiss): admin |

**Load rules** (all on the server):
- Dispatchers create loads only assigned to themselves; edit/claim loads that are theirs or in the pool
  (the load stays/becomes theirs); hand their own load to another active dispatcher by changing only
  `assigned_to` and clearing `driver_id`.
- `assigned_to` must be an active dispatcher. A load's truck must belong to the load's dispatcher
  (dispatchers: only their own drivers; admins: not another dispatcher's driver).
- `delivery_date ≥ pickup_date`; dispatchers cannot set a new delivery date before today in `COMPANY_TIMEZONE`.
- Status transitions: `available → pickedup | delivered`, `pickedup → available | delivered`, `delivered → pickedup`.
- A partial load needs an existing full parent (visible to you); partials cannot be parents. A load with
  partials cannot be deleted alone (409) — delete the partials first or together.
- `total` is exact (`numeric(12,2)`, ≤ 2 decimals, returned as a string such as `"1234.50"`).
- Every change is written to `load_history` in the same transaction (rows are locked with `FOR UPDATE`).

### Staff — `POST /staff/manage` (admin only)

- `{action:"invite", email, full_name, role, password}` — creates an account with a temporary password.
- `{action:"update", user_id, full_name, role, is_active, full_pct?, partial_pct?, new_password?}` — edit an
  employee; `full_pct`/`partial_pct` 0–100 or null/"" (= company %); `new_password` resets their password and
  signs them out. The last active administrator cannot be demoted or deactivated (422 `LAST_ADMIN`).
  Deactivation signs the employee out everywhere.

### Account — `POST /account/update` (any signed-in user, own account only)

`{avatar_url?, email?, new_password?, current_password?}` → `{profile}`. Changing email or password needs
`current_password` (401 otherwise). Email changes create an `email_changed` notice; a dispatcher's password
change creates a `password_changed` notice for administrators **without the password**. Other sessions are
signed out after a password change.

### Development — `POST /dev/test-data` (admin, only when `ENABLE_TEST_DATA=true`, never in production)

`{action:"fill"}` adds sample dispatchers, drivers, loads (`TEST-…`), notes; `{action:"clear"}` removes them.
Only rows flagged `is_test` are touched.

## Assumptions and decisions

- **Roles** come from the existing UI: `admin` and `dispatcher`.
- **Admins no longer receive a dispatcher's new password.** The former preview stored it in plain text for the
  admin; that contradicts secure password storage. Admins get a notice that the password changed and can set a
  new one for any employee (Employees → New password). The browser demo (`VITE_DEMO=1`) still behaves as before.
- **Invites** require a temporary password set by the admin (no e-mail server exists in the project).
- **Status transitions** above were inferred from the UI (inline status select and "Mark delivered"); going
  from Delivered straight back to Available is refused.
- **Company time zone** for "today" defaults to `America/Chicago`; change `COMPANY_TIMEZONE` if needed.
- **Deactivating a dispatcher** does not move their loads; an admin reassigns them, as before.
- The original project had no database dump; nothing was migrated from an older system.
