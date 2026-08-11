# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Single-tenant "cuenta corriente" (customer debt ledger) app in Spanish: register customers, record debts and payments, view a running balance, and export PDFs. Two independent npm projects in one repo:

- **root** — Express + Prisma API against PostgreSQL / Supabase (`deudas-server`)
- **`client/`** — React 18 + Vite + Tailwind SPA (`deudas-client`)

The database was migrated from MySQL (Hostinger) to PostgreSQL (Supabase, `sa-east-1`) in August 2026; the app itself still runs on Hostinger. See "Migración" below — the old MySQL database is still alive as a fallback and must not be deleted without the owner's say-so.

There is no test suite and no linter configured. Don't invent commands for either.

## Commands

Backend (from repo root):

```bash
npm install                       # runs `prisma generate` via postinstall
npm run dev                       # nodemon src/app.js -> http://localhost:4000
npx prisma migrate dev --name X   # create + apply a migration
npx prisma generate               # regenerate client after schema.prisma edits
```

Frontend (from `client/`):

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # emits client/dist/, uploaded to static hosting
```

`prisma/migrations/` does not exist — the schema has been managed out-of-band (`prisma db push`). The first `migrate dev` will want to baseline; check with the user before running it against the production database in `.env`.

## Migración MySQL → Supabase (agosto 2026)

The cutover is done, but the rollback path is deliberately still in place. Three Prisma schemas coexist:

| Archivo | Motor | Cliente generado | Rol |
| --- | --- | --- | --- |
| `prisma/schema.prisma` | postgresql | `@prisma/client` | **el que usa la app** |
| `prisma/schema.mysql.prisma` | mysql | `.prisma/client-mysql` | lee la base vieja, solo para verificar |
| `prisma/schema.postgres.prisma` | postgresql | `.prisma/client-pg` | usado por el import |

```bash
node scripts/export-datos.js          # MySQL -> backups/backup-<ts>.json + .sql
node scripts/import-supabase.js       # backup -> Supabase (idempotente: vacía y recarga)
node scripts/verificar-migracion.js   # compara ambas bases campo por campo; exit 1 si difieren
```

Requires `DATABASE_URL_MYSQL` and `DATABASE_URL_PG` in `.env` alongside `DATABASE_URL`.

Puntos que costaron y no hay que re-descubrir:

- **Usar el Session pooler de Supabase**, no la "Direct connection": la directa es IPv6-only y Hostinger es IPv4. Host `aws-0-sa-east-1.pooler.supabase.com:5432`, usuario `postgres.<ref>`.
- Los IDs tienen huecos (borrados previos). El import los conserva y después corre `setval` sobre las secuencias — sin eso el primer alta nueva colisiona.
- Los importes se serializan a **string** en el backup, no a `Number`, para no perder precisión al pasar por JSON.
- `GET /api/_diag/supabase` es un endpoint **temporal** que comprueba la salida al puerto 5432 desde el servidor. Borrar cuando ya no haga falta.

Cuando el período de prueba termine, se pueden borrar: los dos schemas extra, `scripts/`, el endpoint de diagnóstico y las variables `DATABASE_URL_MYSQL` / `DATABASE_URL_PG`.

## Architecture

### Data model and the balance convention

Two Prisma models: `Customer` and `CustomerMovement` (see [prisma/schema.prisma](prisma/schema.prisma)).

The single most important convention: **`type: "DEBIT"` increases what the customer owes, `type: "CREDIT"` (a payment) decreases it.** Balance is derived, never stored — `calcularSaldo()` in [src/routes/clientesCc.js](src/routes/clientesCc.js) folds a customer's movements at read time and the `GET /api/clientes-cc` response overwrites `currentAccountBalance` with that computed value.

The `Customer.currentAccountBalance` column exists in the schema but **is never written to**. Do not read it directly from Prisma and do not start persisting it without deciding which representation wins; today the derived value is the source of truth.

A payment with both cash and transfer amounts creates **two separate CREDIT movements**, distinguished by `method` (`"EFECTIVO"` / `"TRANSFERENCIA"`). Editing a payment (`PUT /movimientos/:id`) picks which body field to use based on the existing movement's `method`, so a movement can never change payment method — only its amount.

`type` and `method` are plain `String` columns, not enums; nothing validates them at the DB level.

### API surface

All routes live in one router mounted at `/api/clientes-cc`:

| Route | Purpose |
| --- | --- |
| `GET /` | customers + computed balance |
| `POST /` | create customer |
| `DELETE /:id` | deletes the customer's movements first, then the customer (no cascade in schema) |
| `GET /:id/movimientos` | movements, newest first |
| `POST /:id/deuda` | create a DEBIT |
| `POST /:id/pago` | create 1–2 CREDITs |
| `PUT /movimientos/:id`, `DELETE /movimientos/:id` | edit / delete a movement |

Route paths, request-body field names (`efectivo`, `transferencia`, `monto`) and error messages are Spanish; Prisma model and field names are English. Keep that split when adding code.

[src/db.js](src/db.js) exports a shared `PrismaClient` but nothing imports it — the router instantiates its own. If you add routers, import `src/db.js` rather than creating more clients.

### Frontend

Effectively one screen: [client/src/features/DeudasClientesPanel.jsx](client/src/features/DeudasClientesPanel.jsx) (~1100 lines) holds all state, all API calls, and both jsPDF exports (`exportarPDF` = account statement, `exportarFacturaX` = per-movement non-fiscal "Factura X"). [App.jsx](client/src/App.jsx) is just a wrapper.

Because the balance only arrives on the customer-list endpoint, any mutation must call `loadClients()` (and usually `loadMovimientos()`) to refresh it — there is no client-side recomputation.

Money inputs are formatted/parsed as digit strings via `formatNumberInput` / `parseMonto`; always run user input through `parseMonto` before sending it, and use `fmt` (`es-AR` locale) for display.

[client/src/api.js](client/src/api.js) appends `/api` to `VITE_API_URL`, so that env var must be the **origin only** (no trailing `/api`).

## Deployment constraints (Hostinger)

Several recent commits exist purely to keep the app alive on Hostinger's Passenger Node runtime. Respect these or you will reintroduce a 503:

- **The backend must stay CommonJS.** `package.json` has no `"type": "module"` and `src/*.js` use `require`/`module.exports`. Passenger crashed on ESM. Don't convert.
- **`app.listen()` must be reached synchronously at module load** — no async wrapper around startup in [src/app.js](src/app.js).
- `binaryTargets` in `schema.prisma` includes the `rhel-openssl-*` variants for CloudLinux. Keep them.
- [boot.js](boot.js) (the `npm start` entry, a crash-reporting fallback server) is still written in ESM and therefore **fails under the current CommonJS setup**. Passenger boots `src/app.js` directly. Either port `boot.js` to `require` or ignore it; do not "fix" it by adding `"type": "module"`.
- The `Dockerfile` targets the older Koyeb deployment and is not the current path to production.

CORS is an allowlist in `src/app.js`: `FRONTEND_URL` from env plus hardcoded Hostinger and localhost origins. New frontend domains must be added there.

`README.txt` is stale — it describes a `server/` directory from before the backend was moved to the repo root.

## Environment

Backend `.env`: `DATABASE_URL` (PostgreSQL/Supabase), `PORT` (default 4000), `FRONTEND_URL`, más `DATABASE_URL_MYSQL` y `DATABASE_URL_PG` que solo usan los scripts de migración.
Client `client/.env`: `VITE_API_URL` (defaults to `http://localhost:4000` when unset).

`.env` files hold live production database credentials and are gitignored.
