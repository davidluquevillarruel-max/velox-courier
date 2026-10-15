# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Velox Courier — internal management system for a courier/delivery company in Lima, Peru. Vanilla JS SPA frontend + Express/SQL Server REST API backend. No build step, no framework, no bundler — everything is served as static files by the same Express process that serves the API.

**The system is live in production** with real stores and delivery riders (motorizados) using it daily. See "Production rules" below before touching anything database- or deploy-related.

## Estado actual

Última actualización: 15 de octubre de 2026.

- **Flujo rápido con foto (Pedidos)** — un botón de cámara al lado de "Agregar orden"
  abre la cámara del dispositivo con `getUserMedia` (sirve en PC y celular) y, con la
  foto tomada, abre "Nueva orden" ya adjunta. En ese modo solo se piden tienda,
  destinatario y teléfono: el distrito queda en el comodín `SIN DEFINIR` para
  completarlo después desde "Actualizar orden". El modal tiene un único ícono de cámara
  con marca roja (sin foto) o verde (con foto) que abre la vista previa.
- **Fotos: MODO PRUEBA.** El código de R2 está completo pero **el bucket todavía no
  existe**, así que las fotos se guardan en `server/uploads_local/` (gitignored) y se
  sirven por `GET /api/ordenes/:id/foto/:fotoId` validando sesión. El código prefiere R2
  solo cuando las 5 variables `R2_*` estén en el `.env` (ver `server/r2.js` y
  `server/almacenamiento-local.js`). Las fotos guardadas en modo prueba **no se migran
  solas** a R2. En `ordenes_fotos` las dos clases de foto se distinguen por la columna
  `tipo`: `foto_producto` (al crear la orden) y `evidencia_medio_pago`.
- **Cola de fotos (señal inestable)** — `js/cola-fotos.js`: la foto se guarda primero en
  el teléfono (IndexedDB) y se sube en segundo plano, de a una, con reintentos (5 s → 2 min),
  y también al volver la conexión (`online`), al volver la app a primer plano y al reabrir
  Velox. Con la pantalla bloqueada o el navegador cerrado **no** sube (el JS no corre):
  queda guardada y sale cuando la app vuelve a estar activa. Cada foto lleva un `idSubida`
  (UUID) y el servidor no la duplica si llega dos veces (columna `ordenes_fotos.id_subida`).
  Funciona igual con R2 o en modo prueba (pide URL firmada en cada intento; con 503 va al
  disco). 401 pausa la cola hasta el próximo login; 403/404/409 marcan la foto "con error"
  sin reintento automático. Eventos `velox:cola-fotos` y `velox:foto-subida` en `window`.
  Ya la usa la foto del producto (`js/pedidos.js`). **Probado solo con `node --check`,
  todavía no en el navegador.**
- **Evidencia pendiente** — `PATCH /:id/medio-pago` ya no exige la foto al guardar
  `pago-tienda`/`pago-empresa` (puede llegar después por la cola); `SELECT_ORDEN` devuelve
  `evidencia_pendiente` = 1 mientras falte. Las URLs de R2 que se registran se validan contra
  el bucket y la orden (`esUrlDeOrden` en `server/r2.js`).
- **Medio de pago** — concepto separado de "método de pago": `metodo_pago` es
  `sin-cobro`/`contraentrega` (se define al crear) y `medio_pago` es cómo entró la plata
  (`yape-motorizado`, `efectivo-motorizado`, `pago-tienda`, `pago-empresa`). Los dos
  últimos exigen evidencia fotográfica. `pago-empresa` se muestra como "Pago Velox" pero
  se llama distinto por dentro para no confundirlo con la columna `pago_velox`, que es
  otra cosa (el prepago de la tienda en oficina).
- **Concurrencia** — control optimista con `row_version`: los 4 endpoints que usa
  "Actualizar orden" aceptan un `ifVersion` opcional y responden 409 con los datos
  frescos si otro usuario guardó primero, en vez de pisarlo. El modal corta la secuencia
  y avisa sin guardar nada a medias.
- **Multiusuario** — las listas se refrescan solas cada 8 s (Asignación cada 10 s)
  repintando solo el `<tbody>`, nunca la página entera: los filtros de cada usuario son
  locales a su navegador y no se pisan entre sí. Helper compartido
  `iniciarRefrescoAutomatico()` en `js/utils.js`.
- **Rol motorizado** — en "Actualizar orden" tiene bloqueados los montos y el motorizado
  asignado, no ve "Pago del delivery en oficina", y las condiciones especiales son solo
  lectura. El bloqueo real es server-side (`/completo` y `/estado` ignoran esos campos si
  quien llama es motorizado), no solo visual.

**Pendiente:**
- Cola de fotos, parte 4: que la evidencia del medio de pago (`js/motorizados.js`) pase por
  la cola. Hoy sigue subiendo directo y solo a R2 (en modo prueba falla con 503), y la
  pantalla todavía exige la foto antes de guardar.
- Cola de fotos, parte 5: indicador visible de "fotos pendientes" con "Reintentar ahora"
  (`index.html` + `css/components.css`), y mostrar `evidencia_pendiente` en las listas.
- Probar en el navegador las partes 1–3 (subida con/sin señal, sin duplicados).
- **Siguiente:** ícono de la foto del producto para el rol tienda. El servidor ya le deja
  ver la foto de SUS órdenes (`puedeVerFotoOrden` en `server/routes/ordenes.js`), pero
  ninguna página que ve la tienda la muestra todavía (el ícono solo está en "Todos los
  pedidos" y en "Actualizar orden"). Candidata: la vista de Clientes.
- El visor sigue recibiendo 403 al abrir fotos aunque ve todas las órdenes en las listas
  (se dejó así a propósito; revisar si algún día debe verlas).
- Más adelante, opcional: Background Sync (service worker; solo Chrome Android).
- Crear el bucket R2 con sus credenciales, y aplicar las 4 migraciones en producción (ver
  "Migraciones pendientes de aplicar en producción").

## Running it locally

The project lives at `D:\courier-velox` on the dev PC `DESKTOP-E9N76IK`.

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
`JWT_SECRET` under 32 chars throws at request time (`server/middleware/auth.js`). Local DB is **SQL Server 2025**, on the dev PC `DESKTOP-E9N76IK` (production is still SQL Server 2022 — the two versions differ, see "Production rules"). It is restored from `velox_sqlserver.sql` / `BASE_DATOS_VELOX_COMPLETA.sql` — see `INSTRUCCIONES.md` for the full SSMS setup (that file still mentions the old PC name).

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
- **Never restore a local `.bak` over the production database.** Local (`DESKTOP-E9N76IK`, SQL Server 2025) and production (SQL Server 2022) are separate databases that do not sync; backups only flow production → local, never the reverse.
- **Never generate a local `.bak` to restore on the server.** A backup taken on SQL Server 2025 cannot be restored on SQL Server 2022 (backups don't restore to an older version), so it would fail outright — and even if the versions matched, it would overwrite real production data. The only way DB changes reach production is by hand-applied `ALTER TABLE` / migration `.sql` scripts.
- **Database schema changes do not travel through git.** They're applied by hand on the server (`sqlcmd` or versioned migration scripts). A migration file added to this repo does not get run automatically anywhere. Production changes go **only** as `ALTER TABLE` scripts (never as a `.bak`, see above). Note that `velox_agregar_*.sql` migration scripts are gitignored, so they exist only on the dev PC.
- `DECISIONES.md` is the living decision log (why SQL Server over Postgres, why R2 over Cloudinary, the auth rewrite, the D-005 decimal bug, etc.) — check it for the reasoning behind non-obvious architectural choices before proposing to change them.
- `credenciales_tiendas.md` / `credenciales_motorizados.md` are gitignored and known stale (documented in `DECISIONES.md` D-006) — don't treat them as a source of truth for who has access.

## Migraciones pendientes de aplicar en producción

Estos 4 scripts ya están aplicados y verificados en local (`DESKTOP-E9N76IK`), pero
**todavía no se corrieron en el servidor**. Como los `velox_agregar_*.sql` están
gitignored, no viajan con `git push`: hay que copiarlos al servidor y correrlos a mano
con `sqlcmd`, **en este orden**.

| # | Script | Qué hace |
| --- | --- | --- |
| 1 | `velox_agregar_medio_pago.sql` | Columna `medio_pago` en `ordenes`; restringe `metodo_pago` a `sin-cobro`/`contraentrega` (elimina Plin y POS migrando los datos viejos); crea la tabla `ordenes_fotos`. |
| 2 | `velox_agregar_concurrencia.sql` | Columna `row_version` (`ROWVERSION`) en `ordenes`, para el control de concurrencia optimista. |
| 3 | `velox_agregar_distrito_sin_definir.sql` | Distrito comodín `SIN DEFINIR` (tarifa 0, inactivo) que usan las órdenes del flujo rápido con foto. |
| 4 | `velox_agregar_id_subida.sql` | Columna `id_subida` (UUID, índice único filtrado) en `ordenes_fotos`, para que los reintentos de la cola de fotos no dupliquen. Requiere la 1. |

Qué pasa si falta cada uno:

- **Sin el 1**, el backend falla en cuanto alguien abre o guarda una orden (`SELECT_ORDEN`
  consulta `medio_pago` y `ordenes_fotos`).
- **Sin el 2**, el sistema funciona igual (el chequeo de versión es opcional y compatible
  hacia atrás), pero dos usuarios editando la misma orden se siguen pisando en silencio.
- **Sin el 3**, el flujo rápido con foto devuelve un error que lo dice explícitamente.
- **Sin el 4**, fallan las rutas de subida de fotos (`/foto/local`, `/foto/registrar`
  consultan `id_subida`). El resto del sistema funciona.

Cuando se apliquen en el servidor, borrar la fila correspondiente de esta tabla.

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
- **Nunca** generar un `.bak` local para restaurarlo en el servidor: la BD local es SQL Server 2025 y producción es SQL Server 2022, y un backup de una versión nueva no se puede restaurar en una más vieja. Los cambios de BD en producción van **solo** con scripts `ALTER TABLE` / migración.
- **Nunca** subir al repositorio `server/.env`, `node_modules` ni archivos de credenciales — ya están en `.gitignore`, respetarlo.
- No reintroducir secretos hardcodeados en el código: contraseñas, tokens ni claves.
- El hashing de contraseñas (PBKDF2 en `routes/auth.js`) está correcto: no tocarlo.

### Despliegue (contexto — no ejecutar)

El despliegue lo hace el usuario manualmente: `git push` desde la PC, y en el servidor `git pull` + `pm2 restart velox` (ver "Production rules" arriba para el detalle completo). No hay acceso al servidor de producción desde aquí — nunca intentar desplegar ni conectarse a él.
