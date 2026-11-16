# SDS UZ INC — Dispatch CRM (frontend)

React + Vite front end. The server lives in [`../backend`](../backend/README.md)
(NestJS + PostgreSQL + Prisma); its README has setup steps, the API reference and all
access rules.

## Run locally with the backend

1. Start the backend (see `../backend/README.md`: `docker compose up -d`, `npm run db:migrate`,
   `npm run db:seed`, `npm run start:dev`).
2. Start the frontend:

   ```bash
   npm install
   npm run dev
   ```

3. Open `http://127.0.0.1:5173/`. Requests to `/api` are proxied to `http://127.0.0.1:3000`
   (override with `API_PROXY_TARGET`). Sign in with the seed accounts from `backend/.env`.

## Production build

```bash
npm run build            # dist/ — calls same-origin /api
```

Serve `dist/` and proxy `/api` to the backend, or build with
`VITE_API_URL=https://api.example.com/api` and add the frontend origin to the backend's `CORS_ORIGINS`.

## Browser-only demo (no server)

`VITE_DEMO=1 npm run build` produces the static demo used for the Vercel showcase
(`vercel.json`). It keeps data only in the visitor's browser (`localStorage`), contains the demo
passwords in its JavaScript and has **no** server-side security — never use it for real data.
Demo accounts: `admin@sds.local` / `Admin2026!`, `dispatcher@sds.local` / `Dispatch2026!`.

## Tests

`npm test` checks the browser demo adapter in `src/api.js`. Server behaviour is covered by
`npm test` in `../backend`.
