# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Velox Courier — internal management system for a courier/delivery company in Lima, Peru. Vanilla JS SPA frontend + Express/SQL Server REST API backend. No build step, no framework, no bundler — everything is served as static files by the same Express process that serves the API.

**The system is live in production** with real stores and delivery riders (motorizados) using it daily. See "Production rules" below before touching anything database- or deploy-related.

## Estado actual

Última actualización: 23 de octubre de 2026.

- **Resumen de la sesión del 22–23 de octubre de 2026 — todo en local, commiteado, SIN push.
  Producción intacta.** El detalle de cada punto está más abajo.
  - Limpieza de las órdenes de ejemplo + import de las **274 órdenes reales del 20/10/2026**
    (241 entregado, 28 reprogramado, 5 cancelado; todas con fecha de reparto 20/10).
  - Botón **Descargar Excel / CSV** en "Todos los pedidos".
  - **Fecha de reparto**: Pedidos, la vista del motorizado y la Caja trabajan por el día de
    reparto, no por el de creación. De paso se arregló el bug UTC de la copia de "ausente".
  - Etiqueta **"Por cobrar"** (antes "Cobrado") en los campos donde se carga el monto ("Nueva
    orden", "Actualizar orden", ventana "Pendiente") y en sus mensajes de error (frontend y
    `PATCH /completar-datos`). En la Caja, Motorizados, Clientes y el dashboard sigue "Cobrado":
    ahí es plata ya cobrada (solo entregadas / ausentes). "Total por cobrar" de la Caja es otra
    cosa (lo que la tienda le debe a Velox) y no se tocó.
  - Scripts en `server/scripts/`: `limpiar_ordenes.sql`, `importar-ordenes-excel.js`,
    `leer-xlsx.js`, `revisar_dias_pagados_fecha_reparto.sql`. Migración nueva (gitignored, solo
    en la PC): `velox_agregar_fecha_reparto.sql`.
  - Backups locales en la carpeta `Backup` de SQL Server:
    `velox_courier_antes_import_20261022.bak` y `velox_courier_antes_fecha_reparto_20261023.bak`.
  - **Para subir todo a producción** ver "Pendiente" → "Subir a producción".

- **R2 (Cloudflare): configurado y funcionando EN LOCAL; en producción sigue el modo prueba.**
  Cuenta R2 creada, bucket `velox-fotos`, las 5 variables `R2_*` puestas en el `server/.env`
  local (nunca en el repo), URL pública `pub-b64e...r2.dev`. CORS del bucket configurado para
  `http://localhost:3000` y `https://sistema.veloxcourierperu.com` (métodos PUT y GET,
  encabezado `content-type`: el navegador sube directo a R2 desde `js/cola-fotos.js`).
  Probado el 21 de octubre de 2026: las fotos (incluida la ráfaga) suben a R2, se ven con su
  URL pública y quedan registradas en `ordenes_fotos` con la URL de R2, sin duplicados.
  Ojo: el servidor usa R2 apenas las 5 variables tienen **cualquier** valor; si una falta o
  está vacía, vuelve al modo prueba (`uploads_local/`). Pasos para producción en "Pendiente".

- **Fecha de reparto (23 de octubre de 2026, en local, sin subir; ver D-009 en `DECISIONES.md`).**
  La fecha que manda es el día en que la orden sale a entregar, no el de creación: **entrega del
  día = cobro del día**. Columna calculada `ordenes.fecha_reparto = ISNULL(fecha_asignacion,
  fecha)` (migración `velox_agregar_fecha_reparto.sql`, ver abajo). La usan "Todos los
  pedidos" (`GET /ordenes?fecha=`), la página Motorizados, **toda la Caja** (tiendas,
  motorizados, liquidez, caja real incluido el prepago, y los dos "Marcar pagado"), Clientes y
  el dashboard. `ordenes.fecha` (creación) no cambia: queda como dato histórico, se muestra en
  gris ("creada el …") y es la columna FECHA DE CREACION del export/import. Sin asignar, la
  orden se ve en su día de creación.
  - `PATCH /asignar` acepta `fechaReparto` (solo gestores): entre el día de creación y hoy + 7
    (`DIAS_REPARTO_ADELANTE`). Sin fecha: conserva la que tenía; si no tenía, hoy (Lima). El
    motorizado que se autoasigna siempre queda con hoy. **Pasar una orden a otro motorizado ya
    no la mueve de día** (antes iba a hoy): para reprogramarla se elige la fecha.
  - **Días ya pagados:** si la orden suma en la Caja (entregado / ausente, o cancelado
    pre-pagado) y cambia de día o de motorizado, y el día de origen o destino ya está pagado
    para su tienda o su motorizado, `/asignar` responde 400 (`diaPagado: true`) con el motivo.
    Las reprogramadas / en proceso no suman, se mueven siempre. La Caja no tiene "desmarcar".
  - Pantallas: selector "Fecha de reparto" en Asignación (para asignar pendientes y
    autoasignar; "Reasignar" conserva el día) y campo en "Actualizar orden" (oculto para el
    motorizado). En ese modal `/asignar` ahora va **primero**, así un rechazo no deja nada
    guardado a medias.
  - La copia que crea "ausente" al confirmar la devolución usa la fecha de Lima (antes
    `GETDATE()` del servidor, que en UTC daba el día siguiente después de las 19:00).
  - Con los datos importados: el 20/10 pasa de 231 a 274 órdenes (las 43 creadas del 13 al 19
    se repartieron el 20) y los días 13–19 quedan vacíos.
  - **Antes de subir:** correr en producción `server/scripts/revisar_dias_pagados_fecha_reparto.sql`
    (solo lectura): lista las órdenes que cambiarían de día en días ya pagados y cómo cambiaría
    el monto de cada uno. Si sale vacío, se puede subir sin sorpresas en la Caja.

- **Descargar Excel / CSV en "Todos los pedidos" (23 de octubre de 2026, commit `55613a7`, en
  local, sin subir).** `js/exportar-pedidos.js` exporta solo las filas **visibles** de la tabla
  (cada `<tr>` lleva `data-id`; se cruzan con `_ordenesCache`), así respeta la fecha y todos los
  filtros. Mismas 15 columnas y orden que el Excel de importación, para poder reimportarlo
  (probado ida y vuelta). Sin librerías: el `.xlsx` es un zip sin comprimir armado a mano
  (fecha como fecha real `dd/mm/yyyy`); el CSV va con BOM UTF-8 y **separado por `;`**, porque
  en Windows es-PE el separador de listas es `;` y con comas Excel lo abre en una sola columna.
  REPROGRAMADOS PARA HOY = "SI" si las observaciones dicen "Reprogramado para hoy" o si
  `fecha_asignacion` > `fecha`; por eso `SELECT_ORDEN` ahora devuelve `fecha_asignacion`. Al
  subirlo: `git pull` + `pm2 restart velox`, sin migración.

- **Importación de órdenes desde Excel (22 de octubre de 2026, commit `c15090d`).** En local se
  borraron las órdenes de ejemplo y se cargó el día real 20/10/2026 desde
  `D:\subir sist velox.xlsx` (274 órdenes: 241 entregado, 28 reprogramado, 5 cancelado). Backup
  previo en la carpeta `Backup` de SQL Server: `velox_courier_antes_import_20261022.bak`. Tres
  scripts en `server/scripts/`:
  - `limpiar_ordenes.sql` — borra `ordenes_fotos`, `caja_pagos_motorizados`,
    `caja_pagos_tiendas` y `ordenes`, y reinicia el identity (la próxima orden es la id 1). No
    toca tiendas, motorizados, usuarios, distritos, zonas ni orígenes. Las fotos (R2 o
    `uploads_local/`) quedan huérfanas: solo se borran sus filas.
  - `importar-ordenes-excel.js` — sin flags solo valida (nombres que no existen + filas raras) y
    no escribe nada. Con `--insertar --fecha-asignacion=YYYY-MM-DD` crea las tiendas,
    motorizados y distritos que falten e inserta todo en **una transacción** (todo o nada).
    Resuelve los ids por nombre al correr (sin mayúsculas, tildes ni espacios de más), así que
    sirve igual en el servidor. Los montos salen como en el sistema: delivery y pago al moto con
    la tarifa del distrito, valor del producto = cobrado − (delivery + adicional), mínimo 0.
    El pago al moto es la tarifa del distrito + el adicional del Excel (negativos incluidos).
    "Expres LIMA" y "Expres AGENCIA" son motorizados reales (en local: id 25 y 26; el "Expres"
    id 6 es otro y no se usa); si faltan se crean como cualquier otro, solo con nombre e
    inicial. Un distrito nuevo solo se crea si tiene su tarifa en `DISTRITOS_NUEVOS`; se niega
    a importar si ya hay órdenes de ese día (salvo `--forzar`).
  - `leer-xlsx.js` — lector de `.xlsx` sin dependencias (el `.xlsx` es un zip con XML).

  **Antes de correrlos en el servidor (lo hace el usuario):**
  1. `limpiar_ordenes.sql` borra **TODAS** las órdenes de producción, no solo las de un día, y
     también los pagos de caja ya marcados. Hacer backup del servidor antes y confirmar que es
     lo que se quiere.
  2. Verificar que la columna `ordenes.fecha_asignacion` exista antes de importar (ya se
     verificó aplicada en producción): sin ella el INSERT falla.
  3. `velox_user` no alcanza para el backup ni para `DBCC CHECKIDENT`: correr el `.sql` con un
     usuario con más permisos. Con `sqlcmd`, el script ya pone `QUOTED_IDENTIFIER ON` (sin eso
     el DELETE falla por el índice filtrado de `id_creacion`).
  4. Correr primero el import sin flags y revisar la validación antes de `--insertar`.

- **En local, sin subir: el motorizado ve sus órdenes el día en que se le asignaron.** Columna
  nueva `ordenes.fecha_asignacion` (migración ya aplicada en producción, ver abajo), la llena `/asignar`. La
  página Motorizados (resumen, tarjetas y detalle, para todos los roles) la usa. Desde el
  cambio "Fecha de reparto" (arriba) también la usan la Caja y el resto de las pantallas, vía
  `ordenes.fecha_reparto`: el pendiente de que la Caja agrupaba por `ordenes.fecha` quedó resuelto.
- **En local, sin subir: reprogramadas y no entregadas vuelven a Asignación.** Al confirmar la
  devolución (`PATCH /:id/devolver`) pasan a `en-proceso` **sin motorizado** y con
  `fecha_asignacion` vacía (vuelven a verse en su día de creación); al reasignarlas, `/asignar`
  les pone el día elegido (o hoy). Depende de la
  migración `velox_agregar_fecha_asignacion.sql`. "Pendiente devolución" y "Devolución Tienda"
  ahora refrescan suave (sin "Cargando..." y sin repintar si nada cambió).

- **En local, sin subir (20 de octubre de 2026): ráfaga con tienda + "Pendiente" con
  destinatario/distrito/cobrado.** No necesita migración (todas las columnas ya existen).
  Commits `aad7979` (parte 1) y el siguiente (parte 2). Falta que el usuario lo pruebe en local.
  - **⚡ ahora pide primero la tienda** (modal `#rafaga-tienda-overlay` en `pages/pedidos.html`,
    mismo buscador que "Nueva orden"); recién después abre la cámara. Una tienda por ráfaga;
    la cámara la muestra arriba del contador. La tienda viaja guardada con cada foto en la
    cola (`item.rafaga.tienda`) y `POST /rafaga` la usa; si no viene (fotos viejas en cola) o
    ya no es válida, usa la tienda comodín. "Terminar" abre la ventana "Pendiente" (todas).
  - **`CAMPOS_PENDIENTES` = destinatario, distrito, cobrado.** "Tienda distinta del comodín"
    es un chequeo **fijo** (`tieneTiendaReal`), fuera de la lista: las pendientes viejas con
    tienda `SIN DEFINIR` llegan con `falta_tienda` y solo esas filas muestran el buscador de
    tienda. El cobrado es obligatorio en la ventana (0 vale); en la base no se puede
    distinguir de "sin llenar", así que su chequeo es siempre verdadero.
  - **Al guardar la fila (`PATCH /:id/completar-datos`) el servidor completa (afecta la Caja):**
    delivery y pago al moto con la tarifa del distrito; método `contraentrega` si cobrado > 0
    o `sin-cobro` si es 0; valor del producto = cobrado − (delivery + adicional), mínimo 0.
  - El teléfono ya no se pide en "Pendiente" (se completa en "Actualizar orden").

- **Deploy completado (20 de octubre de 2026): foto en ráfaga + botón "Pendiente" (Pedidos)
  — en producción.** Migración `velox_agregar_rafaga.sql` aplicada en el servidor y código
  subido (commit `72fccef`). Verificado funcionando en `sistema.veloxcourierperu.com`.
  Para cuando llegan muchos pedidos de golpe.
  - **Botón ⚡ amarillo** (`.btn-rafaga`, al lado de la cámara azul): la cámara queda abierta y
    cada "Capturar" crea una orden **sin datos**, con tienda y distrito comodín `SIN DEFINIR`.
    La foto va a la cola (`encolarFotoRafaga` en `js/cola-fotos.js`): la cola primero crea la
    orden (`POST /api/ordenes/rafaga`) y después sube la foto, así que el ritmo de la cámara
    no depende de la señal. Sin señal, las fotos esperan en el teléfono y las órdenes se crean
    en orden al volver. No duplica: cada foto lleva un `idCreacion` (UUID, columna
    `ordenes.id_creacion` con índice único). Fecha/hora = las de la foto.
  - **Marca de "pendiente"**: columna propia `ordenes.datos_pendientes` (nace en 1 solo en la
    ráfaga). **No** se detecta por la tienda comodín, que solo ocupa el lugar (`id_tienda` es
    NOT NULL). Qué campos hay que completar lo define `CAMPOS_PENDIENTES` en
    `server/routes/ordenes.js` (en producción: tienda, destinatario, teléfono; en local
    ya cambió, ver arriba); la marca se apaga en
    `recalcularDatosPendientes()` cuando están todos, ya sea desde "Pendiente" o desde
    "Actualizar orden". El usuario avisó que esos campos pueden cambiar (quizás 2, o distrito en
    vez de tienda): para sacar uno basta con quitarlo de la lista; para uno nuevo, sumarlo
    también a `CHEQUEOS_DATOS_PENDIENTES`, a `PATCH /:id/completar-datos` y a
    `_CAMPOS_PENDIENTES_FORM` en `js/ordenes-pendientes.js`.
  - **Botón "Pendiente"** (`js/ordenes-pendientes.js`): gris si no hay pendientes, ámbar con
    el total si hay (refresco cada 8 s + evento de la cola). La ventana lista las pendientes de
    cualquier fecha con su foto y los campos al costado, "Guardar" por fila
    (`PATCH /:id/completar-datos`, con `ifVersion`). Endpoints: `GET /pendientes-datos` y
    `GET /pendientes-datos/total`. Solo admin/operador.
  - En "Todos los pedidos" se ven con la marca "Por completar". **No** aparecen en
    Asignación, el motorizado no las ve (`filtroPorRol`) y `/asignar` las rechaza. La tienda
    comodín no se lista en `GET /tiendas` ni se puede editar.
  - `POST /` y `/rafaga` reintentan si dos órdenes calculan el mismo código `C-xxxx` a la vez
    (`insertarConCodigoNuevo`).

- **Deploy anterior (16 de octubre de 2026).** Todo lo de esta sección (salvo la ráfaga, de arriba) está en
  producción (`sistema.veloxcourierperu.com`): el código bajó con `git pull`, las 4
  migraciones (`medio_pago`, `concurrencia`, `distrito_sin_definir`, `id_subida`) están
  aplicadas en el servidor, se corrió `npm install` (SDK de AWS para R2) y la app corre sin
  errores. Antes se probó en local y funciona. Lo que **falta** es probar a fondo las
  fotos **con corte de señal** (ver "Pendiente").

- **Flujo rápido con foto (Pedidos)** — un botón de cámara al lado de "Agregar orden"
  abre la cámara del dispositivo con `getUserMedia` (sirve en PC y celular) y, con la
  foto tomada, abre "Nueva orden" ya adjunta. En ese modo solo se piden tienda,
  destinatario y teléfono: el distrito queda en el comodín `SIN DEFINIR` para
  completarlo después desde "Actualizar orden". El modal tiene un único ícono de cámara
  con marca roja (sin foto) o verde (con foto) que abre la vista previa.
- **Fotos: MODO PRUEBA en producción** (en local ya se usa R2, ver arriba). Mientras el
  `.env` del servidor no tenga las variables `R2_*`, las fotos se guardan en
  `server/uploads_local/` (gitignored; en producción, en el disco del servidor) y se
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
  La usan la foto del producto (`js/pedidos.js`) y la evidencia del medio de pago
  (`js/motorizados.js`): la evidencia se comprime al elegirla y entra a la cola recién
  cuando los PATCH de "Actualizar orden" salieron bien; para guardar basta con que la foto
  esté tomada (en memoria, ya subida, o en la cola de ese teléfono). Guardar la orden sí
  sigue necesitando señal en ese momento. **Probado en local con señal normal; falta
  probarlo a fondo con corte de señal.** Indicador visible en `js/indicador-fotos.js`: pastilla fija
  abajo a la izquierda (ámbar = por subir, rojo = con error), oculta si la cola está vacía;
  al tocarla, panel con la lista, "Reintentar ahora" y "Descartar" para las con error.
- **Evidencia pendiente** — `PATCH /:id/medio-pago` ya no exige la foto al guardar
  `pago-tienda`/`pago-empresa` (puede llegar después por la cola); `SELECT_ORDEN` devuelve
  `evidencia_pendiente` = 1 mientras falte. Las URLs de R2 que se registran se validan contra
  el bucket y la orden (`esUrlDeOrden` en `server/r2.js`).
- **Foto del producto, dónde se ve** — ícono de cámara en "Todos los pedidos", en el detalle
  de la tienda en Clientes (lo ve la tienda, solo de sus órdenes) y vista previa en
  "Actualizar orden". El ícono es `_iconoFotoProducto()` en `js/pedidos.js`. La ruta que
  sirve la foto local decide quién la ve con `puedeVerFotoOrden()`: la tienda solo la del
  producto y solo de su `id_tienda` (de la sesión); el visor, ninguna.
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
- **Subir a producción lo de la sesión del 22–23/10** (lo hace el usuario en el servidor, en
  este orden):
  1. **Backup** de la base de producción.
  2. Correr `server/scripts/revisar_dias_pagados_fecha_reparto.sql` (solo lectura) y revisar el
     resultado. Como en el paso 6 se borran todas las órdenes y los pagos de caja, sirve sobre
     todo para saber qué había antes de borrar.
  3. Verificar que exista `ordenes.fecha_asignacion` (la migración ya está aplicada en
     producción; solo confirmarlo).
  4. Copiar y correr `velox_agregar_fecha_reparto.sql` con `sqlcmd -I` y un usuario con
     permisos de `ALTER` (**no** `velox_user`, que no los tiene).
  5. `git pull` + `pm2 restart velox`.
  6. Repetir la limpieza + import de las 274 órdenes: `limpiar_ordenes.sql` (borra **todas** las
     órdenes, sus fotos registradas y los pagos de caja; usuario con permisos, no `velox_user`),
     después `node scripts/importar-ordenes-excel.js "<excel>"` sin flags para revisar la
     validación, y recién ahí con `--insertar --fecha-asignacion=2026-10-20`. Hay que copiar el
     Excel al servidor.
- **Seguir revisando la Caja** (con la fecha de reparto ya aplicada).
- **Activar R2 en producción** (lo hace el usuario en el servidor; el borrado de órdenes y de
  `ordenes_fotos` del paso 1 ya lo cubre `limpiar_ordenes.sql` de arriba):
  1. Checklist de limpieza en el servidor: borrar las órdenes de prueba, sus registros en
     `ordenes_fotos` y la carpeta `server/uploads_local/`. Las fotos de modo prueba **no se
     migran** a R2.
  2. Poner las 5 variables `R2_*` en el `.env` del **servidor** y `pm2 restart velox`.
  3. Probar que una foto suba a R2 desde producción (que su URL empiece con
     `pub-b64e...r2.dev/productos/`).
  4. Hay 3 fotos de prueba en el bucket (`productos/orden-0/`) que se pueden borrar.
- Opcional, más adelante: conectar un dominio propio (`fotos.veloxcourierperu.com`) al bucket
  en vez de la URL `r2.dev`, que tiene límite de velocidad; después cambiar `R2_PUBLIC_URL`.
- **Función grande pendiente: rediseño de la vista del motorizado** (botón EMPEZAR + flujo de
  entrega con fotos). Solo se habló, no se empezó.
- Probar a fondo la cola de fotos **con corte de señal**, ahora desde el celular real
  contra producción: que la foto quede en la cola sin señal y suba sola al volver, sin
  duplicados; evidencia de pago que entra a la cola y la marca de "evidencia pendiente" que
  se apaga al subir; indicador y panel (Reintentar/Descartar) con fotos atascadas; reabrir
  Velox con fotos en cola. Incluye la ráfaga: fotos tomadas sin señal que crean sus
  órdenes en orden al volver, sin duplicados.
- El visor sigue recibiendo 403 al abrir fotos aunque ve todas las órdenes en las listas
  (se dejó así a propósito; revisar si algún día debe verlas).
- Más adelante, opcional: Background Sync (service worker; solo Chrome Android).

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

- `velox_agregar_fecha_reparto.sql` — columna calculada `ordenes.fecha_reparto =
  ISNULL(fecha_asignacion, fecha)` (PERSISTED) + índice `ix_ordenes_fecha_reparto`. No toca
  datos. Aplicada en local el 23 de octubre de 2026. **Correrla en el servidor antes del
  `git pull`** (con `sqlcmd -I`): sin la columna fallan `GET /ordenes`, la Caja y `/asignar`.
  Antes, correr la consulta `server/scripts/revisar_dias_pagados_fecha_reparto.sql`.

`velox_agregar_fecha_asignacion.sql` (columna `ordenes.fecha_asignacion`, DATE NULL, que llena
`PATCH /:id/asignar`; la página Motorizados filtra por `ISNULL(fecha_asignacion, fecha)`) se
aplicó en local el 20 de octubre de 2026 y ya está aplicada en producción (confirmado por el
usuario el 22 de octubre de 2026). `velox_agregar_rafaga.sql` (tienda comodín `SIN DEFINIR`, columnas `ordenes.datos_pendientes`
y `ordenes.id_creacion`) se aplicó en el servidor el 20 de octubre de 2026. Las 4 anteriores
(`velox_agregar_medio_pago.sql`, `velox_agregar_concurrencia.sql`,
`velox_agregar_distrito_sin_definir.sql`, `velox_agregar_id_subida.sql`) se aplicaron el 16
de octubre de 2026.

Cuando haya una migración nueva, anotarla acá hasta que se aplique en el servidor. Como los
`velox_agregar_*.sql` están gitignored, no viajan con `git push`: hay que copiarlos al
servidor y correrlos a mano con `sqlcmd`, **antes** del `git pull`.

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
