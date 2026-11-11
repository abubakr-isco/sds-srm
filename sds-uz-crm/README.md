# SDS UZ INC — Dispatch CRM

React + Vite front end. The former external database client and server
integration have been removed. No remote data was deleted or migrated.

## Local preview

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173/` and sign in with:

- Dispatcher: `dispatcher@sds.local` / `Dispatch2026!`
- Administrator: `admin@sds.local` / `Admin2026!`

These accounts are **development-only browser previews**. The preview starts
with empty loads, drivers, notes, and activity. Changes are saved only in this
browser's localStorage (`sds_crm_preview_v1`) and may appear in other tabs of
the same browser after the five-second refresh. They are not shared across
devices and provide no server-side security. Do not use the preview for live
business data. The admin's Invite button cannot send email until a server is
connected. In the local preview, Employees → "Create account" adds an admin
or dispatcher with a temporary password (preview only).

## Future server contract

Production builds call same-origin `/api` endpoints. The front-end adapter is
in `src/api.js`; the user interface and data shapes remain in `src/App.jsx`.
Implement these endpoints before deploying the multi-user CRM:

- `POST /api/auth/login` with `{email,password}` →
  `{access_token,refresh_token,user:{id,email}}`
- `POST /api/auth/refresh` with `{refresh_token}` → new tokens
- `GET /api/records/:table?select=*&...` → array of rows
- `POST /api/records/:table` → `[createdRow]`
- `PATCH /api/records/:table?id=eq.ID` → array of changed rows
- `DELETE /api/records/:table?id=eq.ID` → array of deleted rows
- `POST /api/staff/manage` with `{action:'invite'|'update', ...}`
- `POST /api/account/update` with `{avatar_url?, email?, new_password?, current_password?}`
  → `{profile}`. Any signed-in user may change only their own avatar, login
  email and password; `current_password` is required for email/password
  changes. When a dispatcher changes their password, the server must deliver
  the new password to administrators (an `admin_notices` row of kind
  `password_changed`, and/or an email). Email changes create an
  `email_changed` notice.

Supported tables: `staff_profiles`, `loads`, `drivers`, `settings`,
`calendar_notes`, `custom_cities`, `activity_log`, `load_history`, and
`admin_notices` (admin-only read/delete; staff_profiles also needs `avatar_url`). The
front-end field mappings show the required columns. The server must validate
tokens, enforce admin/dispatcher permissions on **every** endpoint, prevent
self-assigned administrator roles, protect the last active administrator,
restrict dispatcher loads to assigned or unassigned pool, restrict dispatcher
drivers to rows where `drivers.dispatcher_id` is the dispatcher (only admins
may set or change `dispatcher_id`; it must be an active dispatcher), reject
loads whose `driver_id` is not the dispatcher's own driver (and, for admins,
a driver belonging to a different dispatcher than `assigned_to`),
allow a dispatcher to transfer their own load to another active dispatcher
only by changing `assigned_to` and clearing `driver_id` (no other fields),
reject `delivery_date` earlier than `pickup_date`, reject a new or changed
dispatcher `delivery_date` earlier than today in the company's time zone, and write load
history atomically with changes. Browser checks in the preview are not a
substitute for server authorization.

The original archive did not contain a database schema or export. To preserve
existing records when moving to a new server, obtain the current schema and a
data export from the owner before migration. This repository does not include
or modify any real CRM records.

