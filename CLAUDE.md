# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Velox Courier — internal management system for a courier/delivery company in Lima, Peru. Vanilla JS SPA frontend + Express/SQL Server REST API backend. No build step, no framework, no bundler — everything is served as static files by the same Express process that serves the API.

**The system is live in production** with real stores and delivery riders (motorizados) using it daily. See "Production rules" below before touching anything database- or deploy-related.

## Running it locally

```bash
cd server
npm install
node server.js          # or: npm run dev  (nodemon, auto-restart)
```

Then open `http://localhost:3000/login.html` (do NOT open `index.html` directly via a file:// URL or Live Server — the frontend depends on the API being same-origin). On Windows, `iniciar_velox.bat` does the `cd` + `node server.js` + opens the browser for you.

Requires `server/.env` (gitignored, not committed) with at least:
```
DB_SERVER=<your SQL Server instance name>
DB_DATABASE=velox_courier
DB_PORT=1433
DB_USER=...
DB_PASSWORD=...
JWT_SECRET=<32+ char random string>
PORT=3000
```
`JWT_SECRET` under 32 chars throws at request time (`server/middleware/auth.js`). Local DB is SQL Server 2022 (RTM), restored from `velox_sqlserver.sql` / `BASE_DATOS_VELOX_COMPLETA.sql` — see `INSTRUCCIONES.md` for the full SSMS setup.

There is no test suite, linter, or build/compile step in this repo.

## Architecture

**Backend (`server/`)** — Express app, one file per resource under `server/routes/`: `auth`, `ordenes` (orders), `motorizados` (riders), `tiendas` (stores), `tarifas` (rates), `caja` (cash register). `server/db.js` exposes a lazily-created singleton `mssql` connection pool via `getPool()`. Every route does raw parameterized SQL through `mssql` — no ORM.

**Auth model:** JWT lives in an `httpOnly` cookie (`velox_token`, `server/middleware/auth.js`), and it only carries the user `id`. On *every* request, `requireAuth` re-reads role/`activo`/`id_tienda`/`id_motorizado` from the `usuarios` table — so deactivating a user cuts them off immediately without waiting for token expiry. `requireRol(...roles)` gates specific routes/methods after `requireAuth`.

**Row-level scoping happens server-side, not client-side.** Each protected route (see `filtroPorRol()` in `server/routes/ordenes.js` for the canonical pattern) builds its `WHERE` clause from `req.usuario.rol`/`id_tienda`/`id_motorizado` — a `tienda` role only ever sees its own store's orders, a `motorizado` only its own deliveries. The scope comes from the session, never from client-supplied params/query strings. Follow this pattern for any new protected endpoint; don't trust an `id_tienda`/`id_motorizado` passed in the request body/query for filtering.

Roles: `admin`, `operador`, `visor`, `tienda`, `motorizado`. `GESTORES = ['admin', 'operador']` is the "can write operational data" group, redefined per route file as needed.

**Money columns must be `sql.Decimal(10,2)`.** A bare `sql.Decimal` defaults to `(18,0)` — zero decimals — and silently rounds amounts (see D-005 in `DECISIONES.md`).

**Frontend (root + `js/` + `pages/` + `css/`)** — no framework, no bundler, plain `<script>` tags loaded in dependency order from `index.html` (order matters — see the comment block above the `<script>` tags there). It's a client-routed SPA within a single page shell:
- `index.html` is the shell (sidebar nav + `#main-content` container) and guards on `localStorage.velox_usuario` before rendering.
- `js/navigation.js`'s `showPage(id)` fetches `pages/<id>.html`, injects it into `#main-content`, and calls that page's `init<Name>()` function (defined in the matching `js/<name>.js`). Adding a new page means: add a `pages/x.html` fragment, a `js/x.js` with an `initX()`, a nav item in `index.html`, an entry in the `showPage` init dispatch, and a `<script>` tag.
- `js/navigation.js` also does client-side role-based nav hiding (which sidebar items show per role) — this is a UX convenience only; the real enforcement is server-side per above. Don't rely on hiding a nav item as a security boundary.
- `js/utils.js` installs a global `fetch` interceptor: adds `credentials: 'include'` to every call and redirects to `login.html` on any `401`. Because of this, any new fetch call anywhere in the frontend automatically sends the session cookie and self-heals on session expiry — no per-call boilerplate needed.
- Session identity for UI purposes (name/role display, nav hiding) is cached in `localStorage.velox_usuario`; this is *not* the source of truth for authorization, just a display cache synced from `/api/auth/me`.

**CORS** is locked to `http://localhost:3000` and `https://sistema.veloxcourierperu.com` (`server/server.js`). Adding a new frontend origin means updating `ORIGENES_PERMITIDOS` there.

## Production rules (read before DB or deploy work)

- Production runs on a DigitalOcean droplet (Ubuntu 22.04, SQL Server 2022 Express, Node + PM2 + Nginx) at `sistema.veloxcourierperu.com`. Full details, costs, and the deploy flow (`git push` locally → `git pull && pm2 restart velox` on the server) are in `DECISIONES.md`.
- **Never restore a local `.bak` over the production database.** Local (`DESKTOP-ERVF8UO`) and production are separate databases that do not sync; backups only flow production → local, never the reverse.
- **Database schema changes do not travel through git.** They're applied by hand on the server (`sqlcmd` or versioned migration scripts). A migration file added to this repo does not get run automatically anywhere.
- `DECISIONES.md` is the living decision log (why SQL Server over Postgres, why R2 over Cloudinary, the auth rewrite, the D-005 decimal bug, etc.) — check it for the reasoning behind non-obvious architectural choices before proposing to change them.
- `credenciales_tiendas.md` / `credenciales_motorizados.md` are gitignored and known stale (documented in `DECISIONES.md` D-006) — don't treat them as a source of truth for who has access.

## Reglas de trabajo

### Idioma

- Responder siempre en español: explicaciones, resúmenes y comentarios dentro del código van en español.
- Código nuevo: usar nombres en inglés cuando sea natural, pero **respetar los nombres que ya existen en el proyecto** aunque estén en español (ej. `hacerLogin`, `cerrarSesion`, `requireRol`). No renombrar código existente al inglés.
- Los mensajes visibles de la interfaz (los que ve el usuario final) van en español.

### Cómo trabajar

1. Antes de cambiar código, explicar QUÉ se va a cambiar y POR QUÉ, y esperar el OK del usuario. No hacer cambios grandes sin confirmar primero.
2. Se trabaja en local, en la PC del usuario. El usuario prueba cada cambio antes de subirlo al servidor — no asumir que algo funciona hasta que lo confirme.
3. Al terminar un cambio, decir exactamente cómo probarlo: qué comando correr y qué revisar en el navegador.
4. Mantener el estilo del código existente. No introducir frameworks, librerías ni dependencias nuevas sin preguntar antes y explicar por qué.
5. Tareas grandes que tocan varios archivos: trabajarlas por partes, un archivo a la vez, esperando el OK antes de pasar al siguiente (así, si se corta la sesión, cada parte queda completa). Excepción: si un cambio requiere tocar dos archivos para que el sistema no quede roto a medias (ej. una ruta del backend y su llamada en el frontend, o una variable CSS y el archivo donde se usa), hacerlos juntos, pero avisar que van en pareja y por qué.

### CSS y estilos

- Si aparecen colores o fuentes hardcodeados sueltos en el HTML, o valores repetidos que deberían ser variables, avisar — pero no cambiarlos sin el OK del usuario.
- Respetar el archivo y la estructura de CSS que ya existe en el proyecto (`css/base.css`, `css/layout.css`, `css/components.css`, `css/tables.css`, `css/charts.css`, `css/detalle.css`, `css/detalle-ADICION.css`, `css/responsive.css`). No crear un sistema de estilos nuevo en paralelo sin preguntar antes.

### Reglas que no se rompen

- **Nunca** tocar la base de datos de producción desde aquí. Los cambios de esquema (`ALTER TABLE`, tablas nuevas) se aplican aparte en el servidor. Generar el script `.sql` de migración, **no** ejecutarlo contra producción.
- **Nunca** subir al repositorio `server/.env`, `node_modules` ni archivos de credenciales — ya están en `.gitignore`, respetarlo.
- No reintroducir secretos hardcodeados en el código: contraseñas, tokens ni claves.
- El hashing de contraseñas (PBKDF2 en `routes/auth.js`) está correcto: no tocarlo.

### Despliegue (contexto — no ejecutar)

El despliegue lo hace el usuario manualmente: `git push` desde la PC, y en el servidor `git pull` + `pm2 restart velox` (ver "Production rules" arriba para el detalle completo). No hay acceso al servidor de producción desde aquí — nunca intentar desplegar ni conectarse a él.
