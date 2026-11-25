# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Velox Courier — internal management system for a courier/delivery company in Lima, Peru. Vanilla JS SPA frontend + Express/SQL Server REST API backend. No build step, no framework, no bundler — everything is served as static files by the same Express process that serves the API.

**The system is live in production** with real stores and delivery riders (motorizados) using it daily. See "Production rules" below before touching anything database- or deploy-related.

## Estado actual

Última actualización: 25 de noviembre de 2026.

- **LOTE DEL 19 AL 25/11: SUBIDO a `origin/main` el 25/11, FALTA EL DEPLOY.** Último commit en
  producción: `bc30158`. **Sin migración.** Deploy: revisar que el `.env` del servidor tenga
  `DB_PASSWORD` (sin eso ya no arranca, D-028) → `git pull` → `pm2 restart velox` (toca el
  servidor) → abrir `https://sistema.veloxcourierperu.com/server/package.json` y ver 404. Motos y
  tiendas tienen que recargar la app. Nada del lote escribe en la base al arrancar. **Si el usuario
  ya desplegó parte del lote**, el `git pull` trae además el arreglo del encabezado del detalle de
  la tienda (`b138c92` lo había dejado vacío). Entra (detalle de cada uno más abajo y en
  `DECISIONES.md`, D-024 a D-029):
  - Cambios chicos del 19/11: ráfaga que vuelve a "Todos los pedidos" con confirmación (`783802a`,
    `4a09622`), "Por cobrar" en 0 (`b4dbf95`), chip "Sin asignar" (`b8e786b`), tabla de
    Motorizados en el celular (`742ef2b`).
  - "Gestión / Motorizado": lista, detalle, historial, WhatsApp y marca de enviado (`040aa95`,
    `16e1b62`, `2e2137a`; D-024).
  - Cambio 6, visor de imágenes (`37df5bb`; D-025). Cambio 7, nombre del panel por rol (`7981ac8`).
  - Cambios 8 y 8b, autogestión del moto y datos por rol (`d481b61`, `b138c92`); Cambio 9, tarifas
    y búsqueda por id (`fa7fb17`, `6d3ab30`); Cambio 10, recorte del margen (`b3a30a2`) (D-026, D-027).
  - Cambio 11, lista blanca de archivos y `db.js` sin contraseña (`17d9c1b`), y fuera del repo los
    scripts con contraseñas (`31b71ea`; D-028).
  - Subidos después, el mismo 25/11: el WhatsApp del reporte a las tiendas y el arreglo del
    encabezado (`b0b53cc`), y Clientes / Tiendas con el motor de la Caja (D-029).
- **WhatsApp del reporte a las tiendas, recuperado y rehecho (25/11, `b0b53cc`, subido el 25/11;
  va en el mismo deploy). Toca el servidor: hay que reiniciarlo. Sin migración.**
  `js/clientes.js`, `server/routes/caja.js`.
  - **La causa (bug de `b138c92`):** en el encabezado del detalle de la tienda quedó
    `… + botonesReporte… + _sesionEsTiendaCli() ? '' : (…Enviar resumen…) + '</div>' + …` sin
    paréntesis. El `+` va antes que `? :`, así que todo lo anterior era la condición (un texto, o sea
    verdadera) y la línea entera valía `''`: **para todos los roles** desaparecían el encabezado
    (nombre, Volver, botones del reporte, "Enviar resumen"), los 5 cuadros y el banner del saldo.
    Revisado el resto del lote: era el único ternario sin paréntesis dentro de una suma de textos.
    **Regla: un `cond ? a : b` dentro de una suma de textos va siempre entre paréntesis.**
  - **Ahora, igual que Gestión / Motorizado (D-024):** botón verde por tienda en la lista (columna
    WA) con el día del filtro, y "Enviar reporte dd/mm" en cada pestaña de día del detalle
    (`_cliBotonWA`); con un período (lista o detalle agrupado), apagado o con el aviso "el reporte es
    de un día". `enviarReporteTiendaWA(idTienda, fecha, btn)`: lee `GET /caja/tiendas/:id/reporte`
    (los números del motor, `calcularOrdenCaja`: los mismos de Caja → Tienda y de la imagen), arma el
    mensaje (`_cliMensajeWA`: cada orden con cliente, distrito, estado y su delivery / cobrado si
    cuenta en la Caja; totales del día: delivery, cobrado al cliente y saldo; liquidado si lo está; y
    la URL de la imagen). Sin imagen: el admin la genera antes (`_repGenerarYSubir`); el operador
    manda la que hay o recibe "lo tiene que generar un admin". La pestaña de WhatsApp se abre con el
    toque. Marca ✓ por tienda **y día** en este navegador (`localStorage` `velox_wa_tiendas`, 60
    días; reemplaza a `velox_wa_enviados`, que era solo "hoy"). La tienda no ve nada de esto.
    `GET /caja/tiendas/:id/reporte` pasó a admin **y operador** (como el de motos); generar sigue
    solo admin. Se borraron `_construirMensajeResumenTienda` (la regla vieja), `enviarResumenWP`,
    `enviarResumenRapidoWP` y la marca vieja.
  - **Probado el 25/11** (servidor en el 3001; admin, operador, tienda y moto de prueba, borrados; a
    "PRUEBA CAJA" se le puso un teléfono de prueba y se le sacó): 25 de 25 en la API, el reporte =
    Caja → Tienda pedido por pedido y en totales en 9 días de 6 tiendas (incluidos 2 días pagados, con
    su liquidado), permisos (admin y operador leen; tienda y moto 403; el operador no sube). A 375 px:
    lista con un día (activo) y con período (apagado), mensaje completo (14 órdenes, S/ 110 / 260 /
    −180, URL de la imagen), ✓ guardada por tienda y día; detalle con su encabezado de vuelta,
    "Enviar reporte" por pestaña, toque real; día sin imagen → el admin la genera (simulado, para no
    subir al bucket real); operador: con imagen manda, sin imagen avisa, no genera, cierra la pestaña
    y no marca; tienda sin WhatsApp (y con su encabezado de vuelta). El admin ve todo lo escondido a
    tienda y moto (Evidencias, Gestión con Delivery / Generar / Ver imagen / Actualizar, Actualizar
    orden con montos, Tarifas, Asignación libre) y las pruebas de API anteriores siguen (40, 8, 32,
    36). `window.open` se reemplazó solo en la prueba: falta ver que WhatsApp abra en un celular real.
  - Los cuadros y el banner de Clientes / Tiendas, que seguían con la regla vieja, pasaron al motor
    en el punto de abajo.
- **Clientes / Tiendas con el motor de la Caja (25/11, D-029; subido el 25/11 junto con el
  de arriba). Toca el servidor: hay que reiniciarlo. Sin migración.** `server/routes/tiendas.js`,
  `js/clientes.js`, `pages/clientes.html`.
  - **Servidor:** `GET /tiendas/resumen` (lista y KPIs) ya no suma con SQL la regla vieja
    (entregado / ausente, delivery − cobrado): trae las órdenes del período y las pasa por
    `calcularOrdenCaja`; devuelve por tienda los conteos de siempre + `delivery`, `retenido` y
    `saldo` (se fueron `por_cobrar` / `por_devolver`). `GET /tiendas/:id/ordenes` (detalle) devuelve
    en cada orden `caja = { cobrable, prepago, delivery, retenido, saldo, fecha_pago }` (`fecha_pago` =
    el día de esa orden ya se liquidó, de `caja_pagos_tiendas`). Se sacaron de esa respuesta
    `pago_velox`, `pago_velox_metodo` e `id_motorizado` (solo hacían falta para el cálculo).
  - **Navegador: no calcula plata.** Solo suma `o.caja` en céntimos (`_totalesCajaCli`) y pinta:
    fila de cada orden (delivery con "+adicional" / "prepagado", cobrado = lo que tiene Velox, saldo),
    bloque de cada día y del período (con "Día liquidado el dd/mm" / "N días liquidados"), totales
    generales, la lista y los KPIs (total a cobrar = suma de saldos positivos por tienda, a devolver =
    negativos). Se borraron `_calcularStatsTienda` (sin uso) y todos los `_ec` / `delivery_total` /
    `monto_cobrado` / `monto_producto` del archivo. "Cobrado" pasó a "Cobrado (lo tiene Velox)" y
    "Costo delivery" a "Delivery cobrable"; la tarjeta "Lógica de saldo" explica la regla nueva.
  - **Igual que el reporte, en vivo:** un día ya liquidado se muestra con lo que dan hoy sus
    pedidos y la marca de liquidado. La Caja muestra el saldo guardado y "difiere" si alguien editó
    una orden después del pago (ej. PRB-15, 02/10): solo en ese caso no coinciden.
  - **Probado el 25/11** (servidor en el 3001; usuarios de prueba borrados): 38 de 38 en la API con
    los mismos 9 días de 6 tiendas que el WhatsApp: lista = Caja (delivery, cobrado, saldo), detalle
    = Caja en totales y orden por orden, la marca de liquidado, 3 períodos (octubre de PRUEBA CAJA y
    de la tienda 64, y sep–nov) y la tienda = el admin en su fila y en la `caja` de cada orden, sin
    pago al moto. Siguen pasando 25 (WhatsApp), 40, 8, 32 y 36. A 375 px como admin y como tienda:
    lista del 01/10 − S/ 180, octubre − S/ 290, la pestaña del 01/10 S/ 110 / 260 / "se le debe S/
    180" (antes 100 / 430 / 330), cada orden con su saldo, "Día liquidado el 05 Oct 2026" en 02 y
    03/10, período con "2 días liquidados"; los mismos números para los dos roles, sin errores.
- **PENDIENTE — ROTAR CONTRASEÑAS** (quedaron en el historial de git, que se pudo bajar del sitio
  hasta este deploy): la de la base (`velox_user`, y `sa` si es la misma) en el servidor y su `.env`;
  la del admin si sigue siendo la del script de creación; las de tiendas y motos con la contraseña de
  fórmula (Tiendas / Usuarios → "Resetear contraseñas"). Detalle en el Cambio 11, abajo.
- **Scripts con contraseñas, fuera del repo** (25/11): `velox_crear_usuario_admin.sql` y
  `velox_crear_usuarios_motorizados.sql` se sacaron con `git rm --cached` (siguen en esta PC) y
  `.gitignore` ignora `velox_crear_usuario*.sql`. Ninguno corre al arrancar el servidor. Los demás
  `.sql` versionados no tienen contraseñas ni hashes (`velox_sqlserver.sql` solo define la columna).

- **Cambio 11 — el servidor ya no publica los archivos del proyecto (25 de noviembre de 2026,
  subido el 25/11, falta el deploy; sin migración). Toca el servidor: hay que reiniciarlo.**
  - **El problema:** `server.js` hacía `express.static` de la raíz del proyecto: sin login se bajaban
    `server/` (código, `db.js` con la contraseña de respaldo de la base), `.git/` (todo el
    repositorio con su historial), los `.md`, los `.sql`, `iniciar_velox.bat` y las fotos de
    `server/uploads_local/`. Solo `.env` daba 404.
  - **Ahora (lista blanca en `server.js`):** `CARPETAS_PUBLICAS = css, js, pages, img` (con
    `dotfiles: 'deny'`, sin índice de carpeta) y `PAGINAS_PUBLICAS = index.html, login.html`, más
    `/` → `index.html`. Todo lo demás, 404. No hay favicon, manifest ni otra carpeta que la app use
    (`video/` está vacía). **Una carpeta pública nueva se suma a esa lista.**
  - **`server/db.js`:** sin contraseña de respaldo. Si falta `DB_PASSWORD` en `.env`, avisa "Falta
    DB_PASSWORD en server/.env" y corta (`process.exit(1)`). **Antes del deploy: revisar que el
    `.env` del servidor tenga `DB_PASSWORD`**, si no, PM2 no levanta.
  - **Probado el 25/11** (3001): 28 pedidos sin sesión dan 404 (`/server/db.js`, `/.git/config`,
    `/.git/HEAD`, `/CLAUDE.md`, `/velox_sqlserver.sql`, `/package.json`, `/credenciales_tiendas.md`,
    `/server/.env`, `/.env`, `/node_modules/…`, `/server/uploads_local/` y variantes con `..`,
    `%2e%2e`, `%2f` y mayúsculas); `/`, `/index.html`, `/login.html`, css, js, pages, el logo y
    `/api/ping` dan 200. Login por el formulario; operador (11 páginas), moto (5) y tienda (3) sin
    ningún archivo fallido ni error. Las pruebas de API de los cambios 8 a 10 siguen pasando (36, 32,
    8, 40). `DB_PASSWORD` vacío → el aviso y salida 1.
  - **Secretos que quedaron en el historial de git (no se reescribió):** el commit inicial
    `b25d376` (9/6/2026) tenía `server/.env` y `.gitignore/.env` (`.gitignore` era una carpeta) con
    `DB_SERVER`, `DB_DATABASE`, `DB_PORT`, `DB_USER` y **`DB_PASSWORD` = la misma del respaldo de
    `db.js`**; `966cbd4` (12/7) tenía `credenciales_tiendas.md` (160 tiendas) y
    `credenciales_motorizados.md` (17 motos) con correo y contraseña de fórmula. Se sacaron en
    `6098508` (15/7), pero siguen en el historial. Los `.sql` versionados
    (`velox_crear_usuario_admin.sql`, `velox_crear_usuarios_motorizados.sql`) tienen la contraseña
    del admin y la fórmula en texto y sus hashes; `CLAUDE.md` / `DECISIONES.md` la nombran. **No**
    aparecen en ninguna versión: `JWT_SECRET`, claves de R2 ni otras contraseñas.
  - **PENDIENTE — rotar (lo hace el usuario):** la contraseña de la base (`velox_user`, y la de
    `sa` si es la misma) y ponerla en el `.env` del servidor; la del admin si sigue siendo la del
    `.sql`; las de tiendas y motos que sigan con la fórmula (Tiendas / Usuarios → "Resetear
    contraseñas"). Revisar si el repositorio de GitHub es público. `JWT_SECRET` y las claves de R2
    no hace falta rotarlas: no están en el historial y `server/.env` nunca se sirvió (daba 404).

- **Cambio 10 — ni la tienda ni el moto reciben con qué calcular el margen (25 de noviembre de 2026,
  subido el 25/11, falta el deploy; sin migración). Toca el servidor: hay que reiniciarlo.**
  - **Servidor, un solo lugar:** `server/middleware/recortar-por-rol.js` (montado en `server.js`
    antes de todas las rutas de `/api`) reemplaza `res.json` y le quita a TODA respuesta, a cualquier
    profundidad, los campos prohibidos del rol (`CAMPOS_PROHIBIDOS`): **motorizado** sin
    `delivery_base`, `delivery_total`, `monto_adicional`, `monto_producto` (cobrado − delivery lo
    delataría), `delivery` (el de `caja`), `precio_delivery`, `margen`; **tienda** sin
    `pago_moto_base / _adicional / _total`, `pago_moto`, `pago_motorizado`, `saldo_moto`, `margen`.
    Admin, operador y visor, sin tocar. Así cubre órdenes, detalle, Caja, reasignaciones y cualquier
    ruta nueva. **Un campo nuevo con plata de la tienda o del moto se suma a esa lista.**
  - **Pantallas:** Gestión / Motorizado del moto sin la columna Delivery y "Especial" = "Sí" sin el
    monto (`_renderTablaOrdenesDetalle(…, { sinDelivery })`). "Actualizar orden" del moto esconde
    Valor producto, Delivery base y Adicional (`#celda-producto-update`, `#fila-delivery-update`);
    los campos quedan vacíos en la página porque el guardado los lee, y `/completo` ya usaba los
    montos de la base para el moto (probado: guardar no cambia nada). Evidencias: el moto sin
    "Ingreso delivery", "Saldo por cobrar" ni la columna "Ingreso generado" (`_evSinDelivery`,
    `#th-ev-ingreso`); la tienda sin "Pago a motorizados". Imagen del moto: "Tu delivery del día"
    pasó a "Tu pago del día" (era su pago). La imagen de la tienda no tenía pago al moto. La
    exportación es solo de "Todos los pedidos" (gestores); notificaciones, 403 para los dos.
  - **Probado el 25/11** (servidor en el 3001; moto, tienda y operador de prueba, borrados): 40 de
    40 comparando campo por campo contra el operador (respuesta del rol = la del gestor menos los
    campos prohibidos, en `/motorizados/:id/ordenes`, `/ordenes`, `/ordenes/:id`, `/caja/…/dias`,
    `/reporte`, `/tiendas/:id/ordenes`, `/tiendas`…; ninguna clave prohibida en otras 12 rutas; el
    moto conserva su pago, lo cobrado y su deuda; la tienda, su delivery, adicional y producto) + 8,
    32 y 36 de los cambios 9, 8b y 8. A 375 px: Gestión del moto sin Delivery, "Actualizar orden" del
    moto guardado sin pisar montos (PRB-18 sigue con delivery 10 y pago 6), Evidencias de moto y
    tienda, el texto de la imagen del moto sin "delivery"; el operador ve todo igual.

- **Cambio 9 — tarifas por rol y búsqueda por id (25 de noviembre de 2026, dos commits, subidos el 25/11, falta el
  deploy; sin migración). Toca el servidor: hay que reiniciarlo.**
  - **Tarifas (`server/routes/tarifas.js`):** ni la tienda ni el moto tienen que poder calcular el
    margen de Velox (`precio_delivery − pago_motorizado`). `GET /tarifas`: gestores y visor, todo
    (`v_tarifario`); motorizado, solo `id, distrito, activo` (el combo de distrito de su "Actualizar
    orden"; sus montos están bloqueados y los fija el servidor); tienda, 403 (ninguna pantalla suya
    la lee: no tiene "Nueva orden"). `GET /tarifas/zonas`: gestores y visor; tienda y moto, 403.
    `onDistritoChangeUpdate` (`js/motorizados.js`) no toca los montos si el distrito viene sin
    precio (si no, quedaban en "NaN").
  - **Por id, no por nombre del usuario:** Asignación (`js/asignacion.js`) preselecciona al moto
    buscando `id_motorizado` en su lista; Evidencias (`js/charts.js`) toma su registro por id y usa
    ese nombre para filtrar; Clientes (`js/clientes.js`) muestra la tienda con `id == id_tienda`.
    Antes comparaban con `sesion.nombre`: si el usuario se llamaba distinto que su moto o su tienda,
    veían vacío. El servidor ya les mandaba solo lo suyo.
  - **Probado el 25/11** (servidor en el 3001; usuarios de prueba llamados "TST NOMBRE", distinto de
    su moto y su tienda, borrados): 8 de 8 en tarifas mirando la respuesta real (claves exactas del
    moto, sin precio / pago / margen, 403 de la tienda y de `/zonas`, el operador completo) + 32 y 36
    de los cambios 8b y 8 otra vez. A 375 px sin errores: moto con Asignación en su moto, Evidencias
    con sus 17 órdenes (antes 0) y Actualizar orden con los 62 distritos sin "NaN"; tienda con su fila
    en Clientes (antes "Sin tiendas registradas"), su detalle y Evidencias.
  - El margen que todavía salía de los datos de las órdenes se cerró en el Cambio 10 (arriba).

- **Cambio 8b — qué datos le llegan al moto y a la tienda (25 de noviembre de 2026, commit aparte,
  subido el 25/11, falta el deploy; sin migración). Toca el servidor: hay que reiniciarlo.**
  `server/routes/motorizados.js`, `server/routes/tiendas.js`, `js/reasignaciones.js`,
  `js/clientes.js`, `pages/clientes.html`.
  - **`GET /motorizados`:** el motorizado recibe SOLO su registro; la tienda, `[]` (Evidencias lo
    pide y con un 403 se rompería); gestores y visor, todos como siempre. **Nuevo `GET
    /motorizados/companeros`** (gestores y moto; tienda 403): activos, solo `id` y `nombre`, sin el
    propio moto. Lo usa la ventana "Reasignar" del moto (`js/reasignaciones.js`; la inicial del
    avatar se calcula con `_initiales`). Asignación del moto sigue con su propio registro (el combo
    está fijo en él).
  - **`GET /motorizados/:id/ordenes`:** la tienda, 403 (antes podía leer las órdenes de cualquier
    moto, con clientes de otras tiendas).
  - **`GET /tiendas`:** el motorizado recibe solo `id, nombre, activa` (antes RUC, contacto,
    teléfono, Yape y dirección de todas). `GET /tiendas/resumen`: motorizado 403 (antes veía la plata
    de todas las tiendas). `GET /tiendas/:id/ordenes`: motorizado 403 (`tiendaAutorizada`; antes
    podía leer las órdenes de cualquier tienda).
  - **Clientes / Tiendas, rol tienda:** sin la columna WA (`#th-wa-clientes`), su teléfono sin link a
    WhatsApp y sin "Enviar resumen" en el detalle.
  - **Revisado y sin cambios:** `/ordenes`, `/ordenes/:id`, `/para-asignacion`, `/fotos-export`
    (ya con `filtroPorRol`; a la tienda no le llegan campos personales del moto, solo su nombre),
    `/auth/usuarios` (cada uno el suyo), `/reasignaciones` (tienda 403), `/notificaciones` y la Caja
    (tienda 403).
  - **Tarifas y búsqueda por nombre:** resueltos en el Cambio 9 (el punto de arriba).
  - **Probado el 25/11** (servidor en el 3001; moto, tienda y operador de prueba, borrados): 32 de 32
    mirando la respuesta real (claves exactas de `/companeros` y `/tiendas` del moto, 403 en cada
    ruta cerrada, el operador igual que antes) y los 36 de la parte A otra vez. A 375 px sin errores:
    moto en Motorizados, Asignación, Evidencias, Reasignar (25 compañeros) y Actualizar orden;
    tienda en Clientes (9 columnas, sin WA), su detalle y Evidencias.

- **Cambio 8 — el motorizado ve "Gestión / Motorizado", solo lo suyo (25 de noviembre de 2026,
  subido el 25/11, falta el deploy; sin migración). Toca el servidor: hay que reiniciarlo.**
  `server/routes/caja.js`, `server/routes/motorizados.js`, `js/gestion-motos.js`,
  `js/motorizados.js`, `js/entregas-moto.js`, `js/navigation.js`, `js/reporte-tienda.js`,
  `js/reporte-moto.js`, `pages/gestion-motos.html`, `pages/motorizados.html`, `css/responsive.css`.
  - **Qué ve el moto:** el menú "Gestión / Motorizado" y, al entrar, directo a SU detalle (sin lista,
    chips, TOTALES, Exportar ni "← Volver"): pestañas de los últimos 7 días, filtros de período,
    cuadros (de `armarDiaMoto` / `sumarDiasMoto`, iguales a los del gestor) y sus órdenes **sin**
    Actualizar ni Reasignar (`_renderTablaOrdenesDetalle(ordenes, { sinAcciones: true })`, tabla con
    clase `sin-acciones` para que Fecha no quede fija). Reporte: solo "Ver imagen" (en el visor) si ya
    existe (`verReporteMotoHTML` → `_repBotonesHTML(…, soloVer)`); sin Generar, Copiar, WhatsApp ni la
    ✓ de enviado. Liquidado: solo "Día liquidado el dd/mm" (en un período, "x de n días
    liquidados"). El id sale de la sesión (`_gmIdMotoSesion`), pero eso es solo pantalla.
  - **Servidor (lo que manda):** `caja.js` ya no hace `requireRol('admin','operador')` para todo:
    `soloGestoresOMotoPropio` deja pasar a admin / operador y al motorizado **solo** en `GET
    /caja/motorizados/:id/dias` y `GET /caja/motorizados/:id/reporte` con `:id` = el suyo del token
    (`RUTAS_LECTURA_MOTO`, lista blanca: toda ruta nueva de la Caja queda cerrada para él). Otro id →
    403; cualquier otra ruta → 403 (`/gestion`, `/detalle`, `/reporte/subida`, pagar, liquidez…).
    Doble seguro: esas rutas toman el id de `idMotoDeRuta(req)` (el del token si es moto).
    `liquidadoParaRol` le manda al moto solo `{ fecha_pago }` (sin `saldo_pagado` ni `difiere`, y el
    período sin `difiere`). `GET /motorizados/:id/ordenes` ya daba 403 con otro id y ahora además usa
    el del token.
  - **Motorizados para el moto = "Mis entregas de hoy" + su tarjeta.** Se fueron el período, la tabla
    "Detalle de gestión por motorizado" y el panel con el historial (estaban repetidos), con su código:
    `_calcularStatsMoto`, `_renderTablaResumen`, `abrirDetalleMotoHistorial`, los filtros
    `…FiltroMotos`, `_filtroFechaMoto`, `_motoDetalleAbiertoId`. "Ver detalle" de la tarjeta →
    `abrirGestionMoto` para todos. Quedaron sin uso los estilos de `#tabla-motos-resumen` /
    `.moto-resumen-nombre` en `css/responsive.css` y, de antes, `renderDetalleMoto` /
    `pages/detalle-motorizado.html` (nadie llama `abrirDetalle`).
  - **Bug de antes arreglado:** en el detalle de Gestión / Motorizado los botones del reporte iban
    "diferidos" y nadie llamaba `hidratarReportes`: el admin no veía "Ver imagen" de un reporte ya
    generado. `_gmPintarDia` ahora lo llama.
  - **Probado el 25/11** (servidor en el 3001; moto, tienda y operador de prueba, borrados): 36 de 36
    en la API (lo suyo 200; mismos números que el gestor y cada día = su reporte; liquidado solo con
    fecha; 18 pedidos prohibidos con 403, incluido otro id, `01`, barra final, mayúsculas,
    `/gestion`, `/detalle`, subir reporte, pagar, Caja tiendas / liquidez / real y `/ordenes` de
    otro). A 375 px: menú, Motorizados sin historial, Ver detalle → su detalle, pestañas, "Día
    liquidado el 05 Oct 2026", "Ver imagen" en el visor, "Mes pasado" agrupado, la red sin
    `/gestion`. El operador, igual que antes.

- **Cambio 7 — nombre del panel según el rol (24 de noviembre de 2026, subido el 25/11, falta el deploy;
  solo frontend, sin servidor ni migración).** Arriba del menú: admin / operador / visor =
  "VeloxCourierAdmin", motorizado = "VeloxCourierMotorizado", tienda = "VeloxCourierTienda"; la
  pestaña sigue la misma regla ("Velox Courier - Motorizado"). `_aplicarNombrePanel()` en
  `js/navigation.js` (lee `velox_usuario`), corre al cargar el archivo y no en `DOMContentLoaded`,
  así no se ve "Admin" un instante; `#logo-name` en `index.html`. Lleva un `<wbr>` antes del rol:
  si no entra, pasa a dos líneas en vez de salirse del menú. En el celular (≤ 768 px) el menú pasó
  de 240 a 260 px (`css/responsive.css`) para que el nombre largo (167 px) entre en una línea.
  **Probado el 24/11** con usuarios de prueba (borrados): a 375 px el de motorizado en una línea,
  termina en x=235 dentro del menú de 260, la ✕ (x 14–54) no se mueve (tapa el ícono del logo,
  como antes); tienda y operador en una línea; títulos de pestaña correctos. **En PC (menú de 230
  px) y entre 769 y 1024 px (200 px) "VeloxCourierMotorizado" sale en dos líneas** ("VeloxCourier"
  / "Motorizado"), sin cortarse; Admin y Tienda, en una.

- **Cambio 6 — visor de imágenes dentro del sistema (24 de noviembre de 2026, subido el 25/11, falta el
  deploy; solo frontend, sin servidor ni migración: basta recargar la app).** Ninguna foto ni reporte
  abre otra pestaña: se abren encima de la pantalla y lo de atrás queda igual (un modal con datos
  escritos no pierde nada).
  - **Un solo componente:** `js/visor-imagen.js` (`<script>` después de `utils.js`) + estilos
    `.visor-*` al final de `css/components.css`. Título arriba ("Foto de entrega · #C-1412 · 1 de 3",
    "Reporte · ALEX · 19/11"), imagen con `object-fit: contain`, "Copiar URL" (→ "✓ URL copiada") y
    "Cerrar" abajo; ✕, Esc, tocar fuera de la imagen o el **botón atrás del celular** (al abrir hace
    `pushState` y al cerrar `history.back()`; `navigation.js` solo usa `replaceState`). Flechas ‹ ›,
    ← → en PC y deslizar en el celular (más de 50 px y sobre todo horizontal). Mientras carga,
    "Cargando…"; si no carga, mensaje (y "Copiar URL" igual anda). Copiar: `navigator.clipboard` →
    `execCommand('copy')` → si nada anda, muestra la URL seleccionable. Esc no cierra el modal de
    atrás (listener en captura). Hasta 768 px, botones de 48 px de alto a lo ancho.
  - **Cómo se usa (para un lugar nuevo):** poner `atributosVisor(url, titulo)` en el elemento
    (`data-visor-url` + `data-visor-titulo`); un listener en `document`, en captura, lo abre (el clic
    no llega a la fila / tarjeta de atrás) y sobrevive a los repintados de 8 s. Los que están dentro
    del mismo `[data-visor-grupo]` forman el juego de flechas (la misma URL cuenta una vez). Desde JS:
    `abrirVisorImagen([{url, titulo}], indice)`. Un `<a href>` sigue abriendo otra pestaña con
    Ctrl+clic.
  - **Dónde:** cámara de "Todos los pedidos" y del detalle de Clientes / Tiendas
    (`_iconoFotoProducto(url, codigo)`), foto de "Pendiente", miniatura de Asignación y de "Mis
    entregas de hoy" (`_miniaturaFotoAsig`), foto grande de EMPEZAR, tarjeta "X te quiere pasar una
    orden", fotos del pago de la Caja (tienda y moto, un grupo por pago: "Pago a tienda · <tienda> ·
    <fecha>"), y "Ver imagen" de los reportes (`_repBotonesHTML` recibe el nombre: Clientes /
    Tiendas, Caja → Motorizados, Gestión / Motorizado). En **Actualizar orden** todo el modal es un
    grupo: la cámara del producto, "Fotos de la orden", las de devolución y "ver foto" de la
    evidencia. Cada tipo tiene su título en `_GRUPOS_FOTOS_ORDEN` (`titulo`): **un tipo de foto
    nuevo lleva también su título ahí.**
  - **Se borraron** los 3 visores viejos: `verFotoProductoAsig` y `.asig-foto-grande`
    (Asignación), `verFotoPagoGrande` y `#caja-foto-grande` (Caja), y la vista previa chica de
    Actualizar orden (`verFotoEnSeccion`, `_vistaPreviaFotosHTML`, `toggleVistaPreviaFotoUpdate`).
    La vista previa de "Nueva orden" (foto recién tomada, sin URL todavía) sigue igual. No se tocaron
    WhatsApp ni la exportación. Caja → Tienda sigue sin "Ver imagen" del reporte (a pedido del
    usuario: alcanza con el de Clientes / Tiendas). Evidencias y Notificaciones del admin no tienen
    imágenes.
  - **Probado el 24/11** contra el servidor del usuario en el 3000 (es solo frontend; admin de
    prueba y órdenes TST-VI-1 / TST-VI-2 con 5 filas en `ordenes_fotos`, todo borrado). En PC: cámara
    de Todos los pedidos (misma página, título, `history.state`), Esc, atrás, "Copiar URL" con clic
    real (✓ URL copiada) y el respaldo de la URL seleccionable, Actualizar orden con ← →, "2 de 4",
    foto rota con su mensaje, tocar afuera → el modal sigue abierto con lo escrito y Esc no lo cierra.
    A 375 px: miniatura de Asignación (imagen de 367 px, botones de 172×48), deslizar (eventos
    táctiles sintéticos: izquierda, derecha y vertical que no cambia), flecha ›, reporte de tienda y
    de moto (PNG de prueba del 01/10 de "PRUEBA CAJA") y fotos del pago (HTML de `_liquidacionesHTML`
    con datos de prueba: en local no hay pagos liquidados). **Falta probarlo en un celular real**
    (atrás de Android, copiar, deslizar con el dedo).

- **Deploy del 14 de noviembre de 2026: HECHO en producción** (confirmado por el usuario: las dos
  migraciones OK con `sa`, `velox_agregar_asignada_en.sql` y después
  `velox_agregar_notificaciones_reasignaciones.sql`; `git pull` a `8a2cf5f`; `pm2 restart velox`;
  todo verificado). Entró todo lo del 10, 12 y 14 de noviembre: reportes en imagen (D-017),
  `asignada_en` (D-018), panel del moto con `caja-motor.js` (D-019) y notificaciones + reasignación
  (D-020).

- **Deploy del 18 de noviembre de 2026: HECHO en producción** (confirmado por el usuario:
  `velox_agregar_aviso_observacion.sql` con `sa`, terminó en OK; `git pull` a `bc30158`; `pm2
  restart velox`; logs limpios y verificado). Entró todo lo del 14/11 por la tarde y del 18/11:
  `b6967bf` (aviso que se cierra al guardar, D-020), `f00c168` (foto del pago solo con Pago Velox /
  Pago tienda, D-021), `711a08d` y `69b5b1e` (observaciones para el moto y su protección, D-022) y
  `48270a4` (aviso "X agregó una observación" + botón ✓, D-023). El detalle de cada uno, abajo.
  **Último commit en producción: `bc30158`.** No quedan migraciones pendientes.

- **Cambios chicos del 19/11 (subidos el 25/11, falta el deploy; van juntos en un solo deploy).**
  - **Ráfaga: "Terminar" ya no abre "Órdenes por completar"** (`js/pedidos.js`, `terminarRafaga`;
    sin servidor ni migración, commit `783802a`). Cierra la cámara y repinta "Todos los pedidos".
    Las órdenes siguen naciendo pendientes y se completan desde el botón "Pendiente" cuando se
    quiera; las que la cola crea después aparecen con el refresco de 8 s, y las fotos siguen
    subiendo en segundo plano con su indicador.
  - **Ráfaga: ventana de confirmación al terminar** (`js/pedidos.js` + `css/components.css`,
    `.rafaga-fin-*`; reemplaza al aviso "N fotos de <tienda>…"). Check verde, la tienda grande en
    mayúsculas y "12 órdenes creadas" (`_textoOrdenesRafaga`). El número es el de ESA ráfaga
    (`_rafagaTomadas`; `_rafagaIds` se vacía al abrir la cámara), leído antes de cerrarla, y no
    espera a la cola: si alguna todavía no se creó en el servidor, debajo, chico: "3 se terminan de
    crear en segundo plano". `_mostrarFinRafaga` la cierra sola a los 2 s o al tocarla; la lista
    ya se repintó detrás. Probado a 375 px (12 con 3 en camino, 1 en singular, tocar, 2 s).
    Commit `4a09622`.
  - **"Pendiente": "Por cobrar (S/)" viene con 0** (`js/ordenes-pendientes.js`, sin servidor ni
    migración). `value="0"` (ya no es un placeholder) y "· 0 si no se cobra" como ayuda chica al
    lado del título (`ayuda` opcional en `_CAMPOS_PENDIENTES_FORM`). Al entrar se selecciona todo:
    `onfocus` hace `select()` y se frena el primer `mouseup` (`_selTodo`), si no el navegador pone
    el cursor y queda "085". Vacío al guardar = 0. Algo que no es número (ej. "1-"; un
    `type=number` lo entrega como `''`) **no** se toma como 0: `validity.badInput` → "El monto por
    cobrar no es válido.". El servidor sigue igual: 0 = sin-cobro, > 0 = contraentrega. Probado a
    375 px: tocar + "85" = 85; 85 / 0 / vacío guardados = contraentrega 85 / sin-cobro 0 /
    sin-cobro 0, sin datos pendientes. Commit `b4dbf95`.
  - **"Todos los pedidos": chip "Sin asignar (N)"** (`pages/pedidos.html`, `js/filters.js`,
    `js/pedidos.js`, `js/exportar-pedidos.js`; sin servidor ni migración). Botón
    `#f-filtro-sin-asignar` con el estilo `.chip-tienda` de Clientes (azul con `.active`), estado en
    `aria-pressed`, `alternarFiltroSinAsignar()`. Cada fila lleva `data-sin-asignar="1"` si no tiene
    motorizado y no está anulada (`_filaOrdenPedido`); `filtrarTablaOrdenes` lo combina con "Y" con
    el resto (período, tienda, moto, estado, buscador, casillas) y la cuenta del chip son las sin
    asignar que pasan **los demás** filtros (lo que se vería al prenderlo). Sobrevive al refresco de
    8 s. **Los 4 indicadores de arriba NO cambian** con este filtro ni con ningún otro: cuentan todo
    el período (decisión del usuario, 19/11). Excel / CSV: bajan solo las filas visibles (como
    siempre) y el nombre lleva `sin-asignar`. Probado a 375 px con 4 órdenes TST-SA-* (2 sin moto,
    1 con moto, 1 anulada sin moto; borradas): 29 = lo que da la base, las con moto y la anulada
    fuera, + "Reprogramado" = 1, + "Anulado" = 0, prende / apaga, el total de arriba quieto.
    Commit `b8e786b`.
  - **Motorizados: tabla "Detalle de gestión por motorizado" en el celular** (`pages/motorizados.html`,
    `js/motorizados.js`, `css/responsive.css`; sin servidor ni migración). El problema: las 3
    columnas fijas a la derecha (`.col-cobrado-fijo`, `.col-totalmoto-fijo`, `.col-accion-moto-fijo`,
    350 px) no dejaban lugar a 375 px y aplastaban la de Motorizado ("Mc", medio avatar). Hasta 768
    px (`#tabla-motos-resumen`): esas 3 pasan a `position: static` y se deslizan con las demás;
    Motorizado queda fija con 150 px, `white-space: nowrap`, el nombre con "…"
    (`.moto-resumen-nombre`, `title` con el nombre entero) y una sombra más marcada; el aviso
    "Desliza la tabla…" y la barra gruesa reusan `.tabla-moto-aviso` / `.tabla-moto-wrap` del
    historial. El botón de la fila "Sin órdenes" ahora es el mismo "Ver detalle" azul de las demás
    (antes, un ojo gris; esto sí se ve también en PC). En PC, lo demás igual (columnas fijas a la
    derecha, sin aviso). Probado a 375 px con un moto de nombre largo y deuda − S/ 6.00 y otro sin
    órdenes (borrados): las 12 columnas se ven enteras al lado de la fija, lo deslizado pasa por
    debajo, botones de 97×28 en todas las filas; y a 1280 px como antes. Commit `742ef2b`. Desde
    el cambio de abajo esa tabla solo la ve el rol motorizado (su propia fila).
  - **Página nueva "Gestión / Motorizado" — "una página por pregunta"** (OK del usuario a la
    estructura, 19/11). **Toca el servidor:** hay que reiniciarlo. Sin migración.
    - **Qué va en cada una:** *Motorizados* = "quiénes son" (tarjetas, alta, edición, accesos).
      *Gestión / Motorizado* = "qué hicieron y cuánto" en UN día. Para los gestores,
      `renderMotorizados` esconde en Motorizados el período (`#motos-periodo`), la tabla
      (`#card-motos-resumen`) y el panel (`#panel-detalle-moto`), `_renderTablaResumen` no consulta,
      y el "Ver detalle" de la tarjeta llama `abrirGestionMoto(id)` (abre la página nueva ya en ese
      moto, en hoy). **El rol motorizado sigue igual** (período, su fila, su panel con historial).
    - **Servidor (`server/routes/caja.js`):** `armarDiaMoto(ordenes, pagado)` = la ÚNICA cuenta
      del día de un moto (resumen por estado, pedidos y totales con `calcularOrdenCaja`,
      `liquidado`). **Un período no tiene cuenta propia: es la suma de sus días**
      (`ordenesMotosPeriodo` trae las órdenes con su día, `diasPorMoto` arma cada día con
      `armarDiaMoto`, `sumarDiasMoto` suma en céntimos y cuenta días liquidados). Rutas:
      `GET /caja/motorizados/gestion?desde=&hasta=` (o `?fecha=`; sin fechas = todo) = la lista;
      `GET /caja/motorizados/:id/dias?hasta=` (últimos 7 días con órdenes hasta ese día) o
      `?desde=&hasta=` (un período) = el historial del detalle; `GET /caja/motorizados/:id/reporte`
      ya **no** es solo admin (admin y operador, por el `requireRol` del router); `/reporte/subida`
      sigue solo admin. `GET /motorizados/:id/ordenes` acepta también `desde` + `hasta`.
    - **Frontend:** `pages/gestion-motos.html` + `js/gestion-motos.js` (`initGestionMotos`; script
      después de `clientes.js`), menú `#nav-gestion-motos` debajo de Clientes / Tiendas, oculto y
      con `showPage` redirigido para quien no es admin / operador (`js/navigation.js`).
      **Igual que Clientes / Tiendas (cambio 5b):** filtros Hoy / Ayer / Por semana / Semana pasada
      / Por mes / Mes pasado / desde-hasta / Ver todos (semana y mes con los mismos
      `_rango…Cli` de Clientes), chips por moto con un período, Exportar (CSV con `;` y BOM de lo
      que se ve). Lista `#tabla-gestion-motos`: Motorizado, Teléfono (link a WhatsApp), **WA**,
      órdenes, entregados, no entregados, ausentes, efectivo, Yape, su pago, deuda, Liquidado (un
      día: Liquidado / Pendiente; período: "x de n días"), Ver detalle y fila TOTALES; refresco de
      8 s sin repintar si nada cambió; en el celular, Motorizado fijo (`css/responsive.css`).
    - **WhatsApp (`enviarReporteMotoWA`):** al teléfono del moto, con SU reporte en imagen (el de
      Caja → Motorizados): mensaje con el link + efectivo, Yape, entrega, su pago y neto (de
      `armarDiaMoto`). Si ese día todavía no tiene imagen, **la genera antes** (solo admin;
      `_repGenerarYSubir` de `js/reporte-tienda.js`, que ahora comparte con el botón "Generar
      reporte"); el **operador** manda la que ya existe y, si no hay, avisa "lo tiene que generar
      un admin" (no puede subir imágenes, como en la Caja). La pestaña de WhatsApp se abre con el
      toque (`window.open('')`) y después se le pone la URL: abrirla después de esperar al servidor
      la bloquea el celular. Solo con UN día elegido (con un período, el botón sale apagado).
      **Ojo, distinto de tiendas:** el WhatsApp de Clientes / Tiendas manda un **texto** armado en
      el navegador con la regla vieja, no la imagen, y no genera nada.
    - **"Enviado":** igual que tiendas, en **este navegador** (`localStorage` `velox_wa_motos`, sin
      tabla ni migración): no lo ve otro gestor ni otro teléfono. Va por moto **y día del
      reporte** (`id|fecha`, se guardan 60 días), se marca al mandar, se ve en la lista (columna
      WA), en el botón del día del detalle y en su pestaña. Tiendas no tiene desmarcar: acá
      tampoco.
    - **Detalle** (misma página, "← Volver"): pestañas con los últimos 7 días con órdenes hasta el
      día elegido (como el de una tienda; si ese día no tuvo, lo avisa), cada una con liquidado,
      "Generar reporte dd/mm" (`botonesReporteMotoHTML`, mismo archivo que la Caja; solo admin),
      "Enviar reporte dd/mm" con su marca, cuadros, resumen y la tabla de órdenes del panel
      (`_renderTablaOrdenesDetalle` con Actualizar y Reasignar). Filtro de período del detalle
      (semana / mes / desde-hasta, "Últimos 7 días" vuelve a las pestañas): vista agrupada con la
      suma de los días y las órdenes del período, sin reporte ni WhatsApp (son de un día). Desde la
      lista: un día → sus pestañas; un período → ese período agrupado (cuadra con la fila). El
      detalle no se refresca solo (consultaría R2): se repinta al guardar
      (`_refrescarTrasGuardarOrden` → `refrescarGestionMotos`) y con `velox:reasignaciones`.
    - **Diferencia a propósito:** en un día **ya liquidado** la Caja muestra el saldo guardado y
      esta página el de ahora (con el aviso "difiere"). En un día sin liquidar dan idéntico.
    - **Probado el 19/11** (servidor en el 3001; datos TST GM y operador / visor de prueba,
      borrados): 48 de 48 contra Caja → Motorizados en 6 días (hoy con efectivo, Yape, Pago tienda,
      Pago Velox, sin cobro, ausente, reprogramado, devolución, no entregado, en proceso y deuda
      negativa; y los días con datos reales de la base local), y detalle = lista. Permisos 9 de 9
      (operador ve lista y detalle, no sube; visor y moto 403). A 375 px: lista con las 10 columnas
      enteras al deslizar, detalle, Volver, mismo id de reporte que la Caja, "Ver detalle" de la
      tarjeta → página nueva en ese moto, operador sin botones del reporte, ALEX con Motorizados
      como siempre y sin el menú nuevo, visor sin menú y redirigido. **No se generó ninguna imagen**
      (el bucket de R2 es el real).
    - **Probado el 19/11, cambio 5b** (TST GM con días anteriores; borrados): 50 de 50 por día y
      172 de 172 por período (16–19/11, noviembre, octubre, sep–nov y "Ver todos") contra Caja →
      Motorizados, con lista = suma del historial y cada día del historial = su reporte. Permisos
      12 de 12 (`/dias`: operador sí, visor y moto 403). A 375 px: filtros, chips, Exportar, WA
      apagado con período, pestañas 19 ✓ / 18 / 16 con sus números y su reporte, período agrupado
      = suma de los 3 días. WhatsApp con la subida a R2 y `window.open` reemplazados **solo en la
      prueba**: admin sin imagen → la genera y manda link + montos al 51…; con imagen → usa la que
      hay; operador sin imagen → no genera, avisa, cierra la pestaña y no marca; la marca sobrevive
      al refresco. Falta probar con el celular real que WhatsApp abra (y una generación real).

- **Aviso "ALEX agregó una observación" para los gestores + botón ✓ (18 de noviembre de 2026, commit
  `48270a4`, probado por el usuario; D-023; HECHO en producción el 18/11). Migración
  `velox_agregar_aviso_observacion.sql` aplicada en local y en producción (antes del `git pull`).**
  **Toca el servidor:** hay que reiniciarlo. `server/avisos.js`,
  `server/routes/ordenes.js`, `server/routes/notificaciones.js`, `js/notificaciones.js`,
  `js/entregas-moto.js`, `css/components.css`.
  - **Migración:** `chk_notif_tipo` acepta `observacion` (antes el INSERT fallaba) y dos columnas
    NULL nuevas en `notificaciones`, solo para este tipo: `autor NVARCHAR(100)` (quién escribió la
    última nota) y `detalle NVARCHAR(300)` (su texto). Se guardan en el aviso y no se leen de
    `ordenes.observaciones` porque un gestor puede reescribir ese texto. Índices sin cambios.
  - **Nace** solo con la nota de un **motorizado**: `POST /ordenes/:id/observaciones` (EMPEZAR) y
    `obsAgregar` de su "Actualizar orden" (`/completo`), después de que la nota se guardó. Las notas
    de un gestor no generan aviso. `registrarAvisoObservacion(pool, idOrden, autor, texto)` en
    `server/avisos.js`: **uno por orden** (índice `ux_notif_orden_tipo_abierta`); si hay uno
    abierto, se ACTUALIZA (autor, detalle, `creada_en`, así sube arriba), si no se crea. Si dos
    notas llegan a la vez y el índice frena un INSERT (2601/2627), reintenta y actualiza. Nunca
    hace fallar la nota (solo log). `limpiarNotaObs()` en `ordenes.js` deja el texto en una línea.
  - **Se ve siempre** (informativo, como el de reasignación: `SQL_AVISO_VIGENTE`) y se cierra como
    los demás: "Abrir" no marca; **guardar la orden** lo marca para todos. Una nota nueva después de
    revisado crea un aviso nuevo.
  - **Pantalla:** tipo `observacion` en `_AVISO_TIPOS` (`aviso-azul`, `ti-message-2`):
    "**ALEX** agregó una observación · #C-1095 · **cliente**", debajo la última nota entre comillas
    (`.aviso-extracto`, cursiva azul, recortada a 140 con `_recortarAviso`) y distrito · hora.
    `GET /notificaciones` devuelve `autor` y `detalle`.
  - **EMPEZAR:** el "Agregar" pasó a un botón ✓ (`.entrega-obs-ok`, 46 px, ícono de 24 px; Enter
    sigue). El campo perdió la sangría de lupa de `search-box`.
  - **Probado el 18/11** (servidor en el 3001, TST-AO-* y un operador de prueba, borrados): 20 de
    20 en la API (nace con autor y texto, segunda nota = mismo aviso con la última y hora nueva,
    tres a la vez = un aviso, el operador lo ve, gestor no genera, moto desde "Actualizar orden"
    sí, abrir no marca, guardar marca para todos y guarda quién, "ya revisó", nota después de
    revisado = aviso nuevo, los otros tipos sin autor/detalle, moto 403 en `/notificaciones`). A
    375 px: ✓ guarda y cierra el campo, el aviso azul con el extracto, "Abrir" lleva al modal, la X
    no lo cierra, segunda nota actualiza el mismo aviso, Guardar lo cierra para admin y operador.
    Ojo: el navegador del panel tuvo la escala corrida y sus toques caían fuera del ✓ y del aviso;
    esos dos se tocaron con un clic de DOM (`element.click()`), el resto con el navegador.

- **Observaciones visibles para el motorizado; el moto solo AGREGA (14 de noviembre de 2026, commit
  `711a08d` y protección del gestor en `69b5b1e`, los dos probados por el usuario; D-022; sin
  migración; HECHO en producción el 18/11).** **Toca el servidor:** hay que reiniciarlo.
  `server/routes/ordenes.js`, `js/entregas-moto.js`, `js/motorizados.js`, `css/components.css`.
  - **Columna:** `ordenes.observaciones` ya es `NVARCHAR(MAX)` (local y los scripts base): no hizo
    falta agrandarla. Los topes son del código: `MAX_NOTA_OBS = 300` por nota y `MAX_OBS_TOTAL =
    4000` el texto completo (400 "llegaron al máximo: pedile a la oficina que las resuma"). El
    `maxlength="300"` de "Actualizar orden" del gestor pasó a 4000 (si no, al sumar notas el admin
    no podía guardar).
  - **EMPEZAR:** `_bloqueObsEnt` arriba del formulario de COMPLETAR / OTROS / DETALLE (y de esos
    botones): con texto, recuadro ámbar con ícono de nota (`.entrega-obs-texto`); vacías, solo
    "+ Agregar observación". Nunca bloquea completar. Campo + "Agregar" (o Enter) →
    **`POST /ordenes/:id/observaciones {texto}`** (nuevo; gestores o el moto dueño): suma al final
    `" // ALEX 14/11 15:20: texto"` (`notaObservacion`, hora de Lima con `ahoraEnLima`) dentro del
    mismo UPDATE (`SQL_OBS_MAS_NOTA`), así dos notas a la vez no se pisan. Sale de la línea de
    dirección/teléfono, donde estaba antes. Repinta solo `#entrega-obs`; lo escrito queda en el
    borrador (`obsNueva`) aunque se repinte la pantalla.
  - **"Actualizar orden":** gestor = `<textarea>` con el texto completo (como siempre, `obs`).
    Motorizado = lo que ya está de solo lectura + "Agregar observación (se suma al guardar)", que
    va como `obsAgregar` a `/completo`. **En el servidor, `/completo` ignora `obs` si viene de un
    motorizado** y solo suma `obsAgregar` al final: nunca reemplaza ni borra.
  - **Protección de las notas cuando guarda un gestor** (segunda parte, sin tocar `ifVersion`, la
    cola de fotos ni los otros PATCH): el modal guarda el texto al abrir
    (`_ordenActualizarObsOriginal`) y lo manda como `obsOriginal` junto con `obs`. En `/completo`:
    si `obs` = `obsOriginal` (sin contar espacios de los bordes) **no se toca la columna**, así
    sobreviven las notas que el moto sumó con el modal abierto; si cambió, el UPDATE lleva
    `AND ISNULL(observaciones, N'') = @obsOriginal` y, si la base ya tenía otro texto, **409
    `obsConflicto`** con el texto actual y no se guarda nada de `/completo` ("El motorizado agregó
    una nota mientras editabas"). El modal pone ese texto en el campo, muestra "Lo que habías
    escrito: …" y el próximo Guardar compara contra el texto nuevo. Ojo: `/asignar` ya corrió antes
    (como con cualquier error de `/completo`); al volver a guardar se manda igual. Sin `obsOriginal`
    (pantalla vieja sin recargar) se escribe como antes.
  - **Ojo, `ordenes` tiene un trigger** (`trg_ordenes_update`, pone `actualizado_en`): un UPDATE con
    `OUTPUT` sin `INTO` falla. Y `LEN()` de un `NVARCHAR(MAX)` es `BIGINT`, que `mssql` devuelve como
    **texto**: sumarlo sin `Number()` concatena.
  - **Probado el 14/11** (servidor en el 3001, TST-OB-*, borradas): 14 de 14 en la API (agrega con
    firma y hora de Lima, sin " // " si estaba vacío, vacío / > 300 / otro moto rechazados, dos a la
    vez, el moto que manda `obs` vacío o distinto no cambia nada, `obsAgregar` se suma, admin edita
    todo y pasa de 300, tope de 4000). A 375 px: recuadro y link, agregar, lo escrito sobrevive al
    repintar, modal del moto en solo lectura + agregar al guardar, admin edita y borra las notas,
    comillas y `<b>` se ven como texto. Protección: 20 de 20 en la API (sin cambio + nota del moto →
    la nota sigue y el teléfono se guarda; cambio + nota → 409 sin pisar nada; revisado → se
    escribe; espacios de más = sin cambio; pantalla vieja); a 375 px el caso del usuario (admin
    abre, moto agrega, admin cambia el teléfono y guarda → la nota sigue) y el conflicto con su aviso.
- **PENDIENTE (el usuario decidió NO arreglarlo por ahora, 14/11): el control de concurrencia (409)
  no funciona.** Cambiaría todos los guardados y no se quiere arriesgar lo que anda (sobre todo la
  cola de fotos). Las observaciones quedaron protegidas aparte (`obsOriginal`, arriba).
  `SELECT_ORDEN` y `conflictoDeVersion` hacen `CONVERT(varchar(20), o.row_version, 1)`, que con
  `rowversion` devuelve los 8 bytes crudos, no `0x…` (el estilo 1 solo vale para `binary`). Así
  `bufferDeVersion` descarta siempre la versión y ningún guardado con `ifVersion` da 409: el último
  pisa. Viene de `f47d676` (14/10). Probado en local (SQL Server 2025); en producción (2022) no se
  pudo mirar. Arreglo: `CONVERT(varchar(20), CAST(o.row_version AS binary(8)), 1)`. Al arreglarlo
  empiezan a salir 409 reales en todos los guardados con versión (efecto buscado, pero hay que
  probarlo entero, incluida la cola de fotos).

- **Foto del pago: Yape y Efectivo motorizado ya no la piden (14 de noviembre de 2026, commit
  `f00c168`, probado por el usuario; D-021; sin migración ni cambios en el servidor; HECHO en
  producción el 18/11).** Solo `js/entregas-moto.js`
  y `js/motorizados.js`. Con esos dos medios el moto tiene la plata y responde por ella: no hay foto.
  Pago tienda y Pago Velox (`pago-tienda`, `pago-empresa`) la siguen pidiendo como siempre.
  - **EMPEZAR → COMPLETAR:** `_ENT_MEDIOS_CON_FOTO` quedó en `['pago-tienda', 'pago-empresa']`. El
    lugar de la foto del pago aparece y desaparece según el medio elegido; con Yape / Efectivo no
    falta para completar y no se encola (aunque se hubiera tomado antes con otro medio).
  - **"Actualizar orden":** ya la pedía solo con esos dos (`_MEDIOS_PAGO[].evidencia`). Se cerró un
    hueco: si se elegía una foto con Pago tienda y después se pasaba a Yape / Efectivo, la foto se
    encolaba igual; ahora se descarta al guardar.
  - **Servidor:** ya no la exigía (`/resolver` y `/medio-pago` no piden foto; `evidencia_pendiente`
    solo es 1 con Pago tienda / Pago Velox). No se tocó. Las fotos de pago ya subidas no se borran:
    siguen en "Fotos de la orden".
  - **Probado el 14/11** (servidor en el 3001, órdenes TST-EV-*, borradas): 13 de 13 en la API y, a
    375 px como ALEX, la foto del pago aparece y desaparece al cambiar el medio en EMPEZAR y en
    "Actualizar orden"; completar con Yape sin foto del pago → entregado, sin evidencia pendiente y
    en la cola solo la foto de la entrega; foto de Pago tienda y cambio a Yape → no se encola.

- **Notificaciones del admin: el aviso se cierra al GUARDAR la orden, no al abrirla (14 de noviembre
  de 2026, commit `b6967bf`, probado por el usuario; sin migración; HECHO en producción el 18/11).**
  **Toca el servidor:** hay que
  reiniciarlo. `server/routes/notificaciones.js`, `js/notificaciones.js`, `js/motorizados.js`.
  - **"Abrir"** (`GET /notificaciones/:id`) solo lleva a Todos los pedidos con "Actualizar orden"
    abierto: **no marca nada**. Cerrar sin guardar (Cancelar o la X) deja el aviso en la campana.
    Si otro gestor ya la guardó (el panel tiene hasta 20 s de atraso), avisa "<nombre> ya revisó
    este aviso" y abre la orden igual.
  - **Guardar** (`guardarActualizarEstadoOrden`, después de que salieron bien los PATCH, aunque no
    haya cambiado nada) llama a `marcarAvisosOrdenRevisados(idOrden)` sin `await` →
    `POST /notificaciones/orden/:idOrden/revisar`: pone `revisada_en` + `id_usuario_revisa` en
    **todos** los avisos abiertos de esa orden (también los escondidos), para todos los gestores.
    Cuenta igual si el modal se abrió desde el aviso, desde la tabla o desde la Caja. Si esa llamada
    falla, la orden ya quedó guardada y el aviso sigue para la próxima. Solo gestores (el moto
    también guarda "Actualizar orden", pero no marca: 403 en el servidor y ni lo intenta).
  - Si el guardado no sale (validación, 409), no se marca: p. ej. Pago tienda sin foto de evidencia.
  - Un gestor que cambia la orden a no entregado o Pago tienda desde el modal crea el aviso y, al
    terminar ese mismo guardado, queda revisado: solo quedan en la campana los que causó otro.
  - **Compatibilidad:** el `POST /notificaciones/:id/revisar` viejo (una pantalla sin recargar)
    responde igual que el GET y **ya no marca**.
  - **Probado el 14/11** (servidor en el 3001, el del usuario no se tocó): 55 de 55 en la API
    (abrir no marca, el POST viejo no marca, el moto 403, guardar marca y desaparece para el
    operador, "ya revisó" con el nombre, quién quedó guardado). En el navegador a 375 px: abrir y
    cerrar con la X y con Cancelar → sigue; guardar sin cambios → desaparece y el contador baja;
    guardar desde la tabla → desaparece. Datos TST-RS-*, borrados.
  - D-020 en `DECISIONES.md` ya está actualizado con esta regla.

- **Notificaciones del admin + reasignar entre motorizados con aceptación (14 de noviembre de 2026,
  commits `46f46f8` y `935020f`; D-020; HECHO en producción, con la migración
  `velox_agregar_notificaciones_reasignaciones.sql`).** **Toca el servidor:** hay que reiniciarlo. Nuevos: `server/avisos.js`,
  `server/routes/notificaciones.js`, `server/routes/reasignaciones.js`, `js/notificaciones.js`,
  `js/reasignaciones.js`. Cambiados: `server/server.js`, `server/routes/ordenes.js`,
  `server/routes/motorizados.js`, `js/motorizados.js`, `js/entregas-moto.js`, `index.html`,
  `pages/detalle-motorizado.html`, `css/components.css`.
  - **Tablas nuevas:** `reasignaciones` (orden, `id_motorizado_de`, `id_motorizado_para`, `estado`
    pendiente / aceptada / rechazada / cancelada / vencida, `creada_en`, `vence_en`, `respondida_en`,
    `vista_por_origen_en`; índice único filtrado = **una sola pendiente por orden**) y
    `notificaciones` (`tipo` no_entregado / pago_tienda / reasignacion, orden, `id_reasignacion` solo en
    las de reasignación, `creada_en`, `revisada_en`, `id_usuario_revisa`; una abierta por orden y tipo).
    Horas de Lima (`ahoraLima()` de `server/avisos.js`, texto + `CONVERT(datetime2(0), …, 120)`).
  - **Notificaciones (admin y operador; el moto tiene las suyas, ver abajo):** botón al final del menú con contador rojo (cada 20 s; en el
    celular, punto rojo en la hamburguesa) y panel "Para revisar": No entregado (✕ rojo), Pago tienda
    (tienda ámbar), Reasignación aceptada (moto verde, "ALEX pasó #C-x a LUIS"). **Una fila compartida
    por todos los gestores:** "Abrir" lleva a Todos los pedidos con "Actualizar orden" abierto
    (`showPage('pedidos')` + `abrirActualizarEstadoOrden`); desde el 14/11 (segunda parte, arriba)
    el aviso se marca revisado para todos recién al **guardar** esa orden. El aviso **nace al PASAR** a no entregado o a entregado con Pago
    tienda: `/estado`, `/resolver` y `/medio-pago` leen el tipo antes (`tipoAvisoDeOrden`) y llaman
    `registrarAvisoSiNace` después (nunca hace fallar el guardado). Guardar de nuevo sin cambiar no
    crea otro. **Si la orden cambia antes de abrirlo, se esconde** (`SQL_AVISO_VIGENTE`, al listar; no
    se borra). Un endpoint nuevo que cambie estado o medio de pago tiene que hacer lo mismo.
  - **Reasignar (moto → moto):** el botón Reasignar de la tarjeta de "Mis entregas de hoy" y de la
    tabla del panel de Motorizados (solo órdenes `en-proceso`; un gestor lo pide en nombre del moto)
    abre la ventana con los motorizados activos → `POST /reasignaciones`. La orden **sigue con el que
    la envía** (borde punteado ámbar, "Esperando a X", "Cancelar reasignación") y la puede seguir
    trabajando. Al destino, arriba de su lista: campana con contador y "X te quiere pasar una orden"
    con la foto grande, "No" / "Sí, la acepto". Aceptar (transacción) pasa la orden solo si sigue en
    reparto y con el que la envió: `id_motorizado` nuevo, `asignada_en = ahora` (sale arriba),
    `fecha_asignacion` sin cambiar (D-009), y crea el aviso para los gestores. Rechazar: el origen ve
    "X no aceptó la orden" hasta tocar "Entendido". **Vence a medianoche de Lima** sin tarea
    programada: `cerrarReasignacionesViejas()` marca vencidas y cancela las que ya no valen (orden
    cerrada, pasada a otro, anulada) cada vez que se leen o antes de crear una.
  - **Notificaciones del MOTORIZADO (corrección del 14/11, sin migración):** el mismo botón del menú
    (debajo de Usuarios), **siempre visible** aunque esté en 0, con contador y punto rojo en la
    hamburguesa. Su panel sale de `GET /reasignaciones/mias` (`panelNotificacionesMotoHTML` en
    `js/reasignaciones.js`): "Para aceptar" (la misma tarjeta de arriba de la lista,
    `_tarjetaRecibidaRsg`, con No / Sí) y "Respuestas a lo que mandaste" ("X no aceptó la orden: sigue
    contigo" / "X aceptó la orden", cada una con "Entendido" → `POST /:id/visto`). Vacío: "No tenés
    notificaciones". `enviadasDe` ahora devuelve también `aceptadas` (las aceptadas sin
    `vista_por_origen_en`, que antes solo se usaba para las rechazadas) con código y cliente. El
    contador se repinta con cada lectura de `/mias` (evento `velox:reasignaciones-leidas`, también
    desde el refresco de 8 s de "Mis entregas de hoy") y lee de nuevo cada 20 s. El aviso de arriba
    de "Mis entregas de hoy" sigue. Probado a 375 px: ALEX con 2 respuestas → "Entendido" baja a 1;
    ANDRE rechaza desde el panel → "No tenés notificaciones", se va el punto rojo y el botón queda
    visible; el admin sin cambios. 49 de 49 en la API otra vez.
  - **Se fue el "Reasignar" directo del panel del motorizado:** abría la ventana de
    `pages/detalle-motorizado.html`, que no está en la página Motorizados, y por eso no hacía nada. Se
    borraron esa ventana y `abrirReasignarDetalle` / `confirmarReasignarDetalle`. La oficina sigue
    pasando órdenes directo desde Asignación.
  - Borrar un motorizado para siempre ahora revisa también `reasignaciones` (antes daría 500 por la FK).
  - **Probado el 14/11** con el servidor en el puerto 3001 (el del usuario no se tocó; para el CORS del
    3001 se lo levantó con un lanzador que agrega el origen solo en memoria, sin tocar `server.js`):
    49 de 49 en la API con ALEX, ANDRE, DANIELA, el admin y un operador de prueba (enviar, aceptar,
    rechazar, cancelar, vencer, orden cerrada mientras espera, avisos que nacen, "Abrir" que
    desaparece para todos, aviso escondido al corregir la orden, borrado de moto). En el navegador, a
    375 px: aceptar desde la tarjeta, enviar con la ventana, la espera, el rechazo, el panel del admin
    y "Abrir" hasta la orden. Datos TST-RS-*, borrados.

- **Panel del motorizado (página Motorizados) con la cuenta de la Caja (14 de noviembre de 2026,
  commit `486b6c3`; D-019; sin migración; HECHO en producción).** **Toca el servidor:** hay que
  reiniciarlo. `server/routes/motorizados.js`, `js/motorizados.js`, `pages/motorizados.html`.
  - **El bug:** el navegador sumaba el "por cobrar" (`monto_cobrado`) de toda orden entregada o
    **ausente**, sin mirar el medio, como si el moto lo hubiera cobrado. Ej. real en producción:
    #C-1310 (Luis Palacios, 13/11), ausente, salía Cobrado S/ 175.50 y Total moto S/ 170.50; lo mismo
    con Pago tienda y Pago Velox. Además no le pagaba la devolución. Estaba repetido en 4 lugares:
    `_calcularStatsMoto` (cuadros + resumen del panel y la tabla general de motos),
    `_renderTablaOrdenesDetalle` y el historial por día a página completa.
  - **Ahora:** `GET /motorizados/:id/ordenes` devuelve en cada orden `caja` (en soles), calculada
    con `calcularOrdenCaja()`: `en_mano_efectivo`, `en_mano_yape`, `en_mano`, `directo_velox`,
    `pago_moto`, `saldo_moto`, `delivery`, `cobrable`, `medio_por_definir`. El navegador solo suma
    (`_totalesCajaMoto`, en céntimos) y pinta: **no decide qué cobra**. Tabla: columna nueva "Medio
    de pago" (`_medioPagoMotoHTML`: "Por definir" solo si `medio_por_definir`, si no "—"),
    "Cobrado" = en mano con tag Efectivo / Yape (`_cobradoMotoHTML`; Pago tienda / Velox dicen
    "no pasó por el moto") y "Deuda moto" = en mano − su pago en vez de "Total moto"
    (`_deudaMotoHTML`: verde = debe a Velox, ámbar = Velox le debe, como la Caja). Cuadros: "Total
    cobrado" = efectivo + Yape, "Deuda moto" en vez de "Total moto"; el resumen dice "Debe a
    Velox / Velox le debe" con el desglose. La tabla general de motos también: su columna pasó a
    "Deuda moto".
  - **Probado el 14/11** con el servidor en el puerto 3001 (el del usuario, en el 3000, no se tocó)
    y el JS real cargado en Node: un 13/11 de prueba para Luis Palacios (órdenes TST-LP-*,
    borradas) que reproduce el caso, con ausente de S/ 175.50, Pago tienda, Pago Velox, efectivo,
    Yape, sin cobro, reprogramado y devolución, da efectivo 80 · Yape 50 · pago 49 · deuda 81, **igual
    a Caja → Motorizados** (antes daba "total moto" 501.50). Con los datos reales del 20/10:
    572 / 133 / 439, igual a la Caja. La #C-1310 real está solo en producción.
  - Diferencia que queda a propósito: en un día **ya liquidado**, la Caja muestra el saldo guardado
    y este panel el de los pedidos de hoy (si alguien editó la orden después, "Difiere").

- **Cambios del 12 de noviembre de 2026 (los 3 de abajo): HECHO en producción** en el deploy del
  14/11 (commits `223635a`, `01b0f09`, `063e0f4`; migración `velox_agregar_asignada_en.sql`
  aplicada antes del pull). Ver D-018 en `DECISIONES.md`.
- **"Mis entregas de hoy": tarjeta en tres columnas (12 de noviembre de 2026, commit `063e0f4`,
  probado por el usuario).** Solo `js/entregas-moto.js` + `css/components.css`, sin servidor ni
  migración. Foto del producto a la izquierda | datos en el medio | WhatsApp arriba y EMPEZAR (o el
  aviso "Faltan datos") abajo, a la derecha, del mismo ancho (`.entrega-item-acciones`, 128 px).
  La foto es la **misma miniatura de Asignación** (`_miniaturaFotoAsig` de `js/asignacion.js`:
  lazy, tocar la agranda con `verFotoProductoAsig`, ícono gris si no hay o no carga), a 88 px
  (`.entrega-item-foto`); hasta 400 px de ancho, 64 px y columna de botones de 100 px. El monto
  va en `.entrega-monto` (no se parte). El botón de WhatsApp tiene estilos inline
  (`_botonWhatsApp`, color `#25D366` fijo): para estirarlo y darle alto se pisó el padding con
  `!important` en `.entrega-item-whatsapp a`.
- **Listas del motorizado: la última asignada arriba (12 de noviembre de 2026, commit `01b0f09`,
  probado por el usuario; HECHO en producción el 14/11, con la migración
  `velox_agregar_asignada_en.sql`; D-018).** **Toca el servidor:** hay que reiniciarlo. `server/routes/ordenes.js`,
  `server/routes/motorizados.js`, `js/motorizados.js`, `js/entregas-moto.js`, `js/asignacion.js`.
  - **Columna nueva `ordenes.asignada_en DATETIME2(0) NULL`:** hora de LIMA en que se asignó la orden
    al motorizado actual. Hacía falta porque `fecha_asignacion` es `DATE` y `hora_asignacion`, **pese
    al nombre, es la hora de CREACIÓN** (la llena el `INSERT`; `/asignar` no la toca): no usarla para
    ordenar por asignación. Se guarda con `ahoraEnLima()` (texto + `CONVERT(datetime2(0), @x, 120)`:
    un `Date` de JS quedaría en UTC). `SELECT_ORDEN` la devuelve como `'YYYY-MM-DD HH:mm:ss'`.
  - **Quién la toca:** `/asignar` la pone en ahora al asignar o pasar a OTRO moto, la **conserva**
    si es el mismo moto (guardar "Actualizar orden" o cambiar solo la fecha no la sube) y la borra al
    desasignar; `/devolver` la borra cuando la orden vuelve a Asignación; `POST /ordenes` creada ya con
    motorizado nace con la hora. El import de Excel no la llena (quedan sin hora). No la usa la Caja.
  - **Orden:** día de reparto más reciente primero; dentro del día `asignada_en` DESC; las sin hora al
    final, por id DESC. En el servidor, `GET /motorizados/:id/ordenes` (historial de abajo) y
    `GET /ordenes/para-asignacion`; en el navegador, `_compararPorAsignacion` (en `js/motorizados.js`)
    para "Mis entregas de hoy" y "Órdenes asignadas al motorizado" de Asignación.
  - Probado el 12/11 contra la base local y la API (órdenes TST-AS-*, borradas): orden de 3
    asignaciones seguidas, hora de Lima, mismo moto conserva, pasar a otro moto sube arriba,
    desasignar y `/devolver` la vacían, `POST` con y sin moto, y la sin hora al final.
- **"Mis entregas de hoy": buscador (12 de noviembre de 2026, commit `223635a`, probado por el
  usuario en local).** Solo `js/entregas-moto.js` + `css/components.css` (`.entregas-hoy-buscar`,
  `.entregas-hoy-sin-resultado`), sin servidor ni migración. Arriba de la lista (solo si hay
  órdenes), filtra al escribir por cliente, distrito, tienda y código, sin tildes ni mayúsculas;
  cada palabra puede estar en cualquiera de los campos ("moda juan"). La cuenta pasa a "N de M".
  El buscador vive en un esqueleto que se arma una sola vez (`_esqueletoEntregasHoy`): el refresco
  de 8 s repinta solo `#ent-hoy-lista` y la cuenta, así no se pierde lo escrito ni el teclado.
- **Reporte del día de un MOTORIZADO como imagen (10 de noviembre de 2026, commits `c206fe7` y
  `3df4580`, probado por el usuario en local en Caja → Motorizados; HECHO en producción el 14/11,
  sin migración; ampliación de D-017 en `DECISIONES.md`).** El mismo mecanismo que el de tienda (abajo). **Toca el
  servidor:** hay que reiniciarlo. `js/reporte-moto.js` (nuevo, `<script>` después de
  `reporte-tienda.js`), `js/reporte-tienda.js`, `js/caja.js`, `index.html`,
  `server/routes/caja.js`, `server/r2.js`.
  - **Dónde:** en **Caja → Motorizados**, arriba del detalle que abre el ojito del moto
    (`_reporteMotoCajaHTML` en `js/caja.js`), solo admin: "Generar reporte dd/mm" + "Ver imagen" +
    "Copiar". Es de UN día: el del filtro si es uno solo (desde, o desde = hasta); sin filtro, hoy;
    con un rango de varios días dice "filtrá un solo día". (Primero estuvo en el panel de la página
    Motorizados; el usuario lo pidió en la Caja y se sacó de allá.) Como la Caja arma el HTML cada
    8 s y solo lo pinta si cambió, los botones van **diferidos** (`_repBotonesHTML(…, true)`) y
    `pintarMotosCaja` llama `hidratarReportes(tbody)` después de pintar: así no se consulta R2 en
    cada refresco.
  - **Datos:** `GET /caja/motorizados/:id/reporte?fecha=` (solo admin): todos los pedidos del moto
    ese día menos los anulados, con `calcularOrdenCaja()`. Por pedido: `efectivo` y `yape` (lo que
    pasó por sus manos), `directo_velox`, `pago_moto`. Totales: `efectivo`, `yape`, `a_entregar =
    efectivo + yape` (lo entrega COMPLETO), `pago_moto` ("Velox te paga", aparte) y `neto =
    a_entregar − pago_moto` (= `saldo_moto` del motor; probado: coincide con la Caja de
    motorizados). Pago Velox y Pago tienda no suman a lo que entrega. `liquidado` sale de
    `caja_pagos_motorizados` (`diasPagadosMoto`).
  - **Imagen:** "Cobró" = monto + tag Efectivo / Yape; "—" con nota en Pago a Velox, Pago tienda,
    Medio por definir y Sin cobro; "—" solo en ausente, reprogramado, etc. Totales: efectivo, Yape,
    "A ENTREGAR A VELOX" (ámbar), "VELOX TE PAGA" (verde) y la línea del neto.
  - **R2:** `POST /caja/motorizados/:id/reporte/subida` → `reportes-moto/<id>-<fecha>-<HMAC>.png`
    (etiqueta HMAC `velox-reporte-moto`). En `server/r2.js` los dos tipos están en `TIPOS_REPORTE`
    (`claveReporte(tipo, id, fecha)`, `generarUrlSubidaReporte(tipo, …)`, `infoReporte(tipo, …)`).
    **La etiqueta y la ruta de cada tipo no se cambian:** cambiarían las URLs ya mandadas. Probado
    que la de tienda quedó igual después del refactor.
  - **Frontend compartido:** en `reporte-tienda.js`, `_REP_TIPOS` registra cada tipo (`api` +
    `dibujar`) y `_repBotonesHTML(tipo, id, fecha, diferido)` arma los botones; `reporte-moto.js` registra
    `moto` y expone `botonesReporteMotoHTML`. Un reporte nuevo = registrar otro tipo.
  - Quedó un PNG de prueba de 1×1 en `reportes-moto/1046-2026-10-01-…png` (el moto "PRUEBA CAJA" de
    local); se pisa al generar ese reporte.
- **Reporte del día de una tienda como IMAGEN (10 de noviembre de 2026, commit `9e92546`, probado por
  el usuario en local; HECHO en producción el 14/11, sin migración; ver D-017 en
  `DECISIONES.md`).** El CORS del bucket ya permite `cache-control`
  (hecho por el usuario el 10/11). En el detalle de "Clientes / Tiendas", **solo admin**: "Generar
  reporte dd/mm" (el día de la primera pestaña, el mismo de "Enviar resumen", que no cambió) y, ya
  generado, "Ver imagen (hh:mm)" + "Copiar" (copia la URL). `js/reporte-tienda.js` (nuevo, `<script>`
  antes de `clientes.js`), `js/clientes.js`, `index.html`, `server/routes/caja.js`, `server/r2.js`.
  **Toca el servidor:** hay que reiniciarlo.
  - **Datos:** `GET /caja/tiendas/:id/reporte?fecha=` (solo admin): TODOS los pedidos del día menos
    los anulados, cada uno con `calcularOrdenCaja()` (los no cobrables, en 0), resumen por estado,
    totales (delivery, retenido = "cobrado al cliente, lo tiene Velox", saldo) y `liquidado` si el
    día ya se pagó (`fecha_pago`, `saldo_pagado`, `difiere`). Probado: el saldo coincide con la Caja.
  - **Imagen:** se dibuja a mano en un `<canvas>` del navegador (`dibujarReporteTienda`, 1080 px de
    ancho y alto según los pedidos), sin librerías ni trabajo en el servidor. La paleta va en el JS
    (`_REP_COLOR`): el canvas no lee variables CSS y la imagen sale igual con cualquier tema.
  - **R2:** `POST /caja/tiendas/:id/reporte/subida {fecha}` (solo admin) da un PUT firmado a
    `reportes/tienda-<id>/<fecha>-<firma>.png`. La firma es un HMAC de tienda + fecha con
    `JWT_SECRET`: **siempre la misma URL para esa tienda y día** (regenerar pisa el archivo), pero
    no se puede adivinar la de otra tienda. Sin tabla: "ya generado" y la hora salen de un `HEAD` a
    R2 (`infoReporte`). Se sube con `Cache-Control: no-cache, max-age=0`. Si se rota `JWT_SECRET`,
    los reportes ya enviados quedan en su URL vieja y los nuevos salen con otra.
  - **CORS del bucket (HECHO el 10/11):** permite `content-type` y `cache-control`, métodos PUT y
    GET, para `http://localhost:3000` y `https://sistema.veloxcourierperu.com`. Si alguien lo
    vuelve a dejar solo con `content-type`, el PUT del navegador falla y sale el aviso "revisá que
    el CORS del bucket permita cache-control".
  - Probado el 10/11 contra la base local y R2: permisos (operador 403), fecha/tienda inválidas, la
    misma URL al regenerar, `no-cache` guardado en R2 y el dibujo con datos reales (día normal y
    día liquidado). Quedó un PNG de prueba de 1×1 en `reportes/tienda-2280/2026-10-01-…png` (la
    tienda "PRUEBA CAJA" de local); se pisa al generar ese reporte.
- **Cambios del 10 de noviembre de 2026: los 4 de abajo, HECHOS en producción.** Confirmado por el
  usuario el 10/11 ("subido"): `git pull` + `pm2 restart velox`, sin migración. Último commit en
  producción: `a7938a0` (código hasta `2773762`). Los motorizados con la app abierta tienen que
  recargarla. Decisión de las fotos en D-016 de `DECISIONES.md`.
- **Reglas de trabajo nuevas (10 de noviembre de 2026).** Actualizar este `CLAUDE.md` al terminar
  cada parte sin que lo pidan, y commit en local sin push (ver "Cómo trabajar", puntos 6 y 7).
  `server/scripts/limpiar_ordenes.sql` quedó marcado OBSOLETO: el vigente es `limpiar_ordenes_y_caja.sql`.
- **"Mis entregas de hoy": al cerrar una orden vuelve a la lista (10 de noviembre de 2026, commit
  `b49cde5`, HECHO en producción).** Solo `js/entregas-moto.js`, sin migración ni cambios en el servidor. Antes
  `_irASiguienteEnt` abría sola la orden siguiente; ahora `_volverTrasCerrarEnt` cierra la pantalla
  sobrepuesta, saca la orden cerrada de la lista al instante (`_pintarEntregasHoy`, que pinta sin ir
  al servidor, así desaparece aunque no haya señal) y después la sincroniza. Igual en el 409
  `yaResuelta`. El motorizado elige la siguiente con EMPEZAR. Deploy: `git pull` + `pm2 restart
  velox` (o ni eso: es solo un `.js` estático; los motorizados recargan la app).
- **"Mis entregas de hoy": botón de WhatsApp en cada tarjeta (10 de noviembre de 2026, commit
  `8ecbe36`, HECHO en producción).** `js/entregas-moto.js` + `css/components.css` (`.entrega-item-whatsapp`), sin
  servidor ni migración. A la izquierda de EMPEZAR (o del aviso "Faltan datos"), el **mismo**
  `_botonWhatsApp()` de `js/motorizados.js` que usan admin y Pedidos: misma frase, "Adicional" si
  hay `dest_telefono_2`, "Sin teléfono" si no hay ninguno. No se duplicó la lógica: cambiar la
  frase allá la cambia en las tres vistas.
- **"Actualizar orden": todas las fotos de la orden (10 de noviembre de 2026, commit `5de0bb6`,
  HECHO en producción; D-016).** Incluye las de "Pendiente devolución"
  (`foto_devolucion`) y "Devolución Tienda" (`foto_devolucion_tienda`), solo para gestores. Solo `js/motorizados.js`, sin servidor ni migración: `GET /ordenes/:id` ya devolvía
  `fotos` con todos los tipos que el rol puede ver. El bloque "Fotos del motorizado" pasó a ser
  **"Fotos de la orden"** (`_seccionFotosOrdenHTML`, lista `_GRUPOS_FOTOS_ORDEN`): un grupo por
  tipo de `ordenes_fotos`, solo los que tienen fotos, en el orden del flujo (Producto, Entrega,
  Cambio, Pago, Reprogramado, Ausente, Cancelado, No entregado, Devolución, Devolución tienda) y
  un grupo "Otras" para un tipo que no esté en la lista. Mismo visor de siempre
  (`verFotoEnSeccion`). **Un tipo de foto nuevo se suma también a `_GRUPOS_FOTOS_ORDEN`**, con su
  nombre. El ícono grande de la foto del producto y los botones de devolución de la zona
  amarilla/verde siguen donde estaban.
- **Descargar Excel / CSV con las URLs de las fotos (10 de noviembre de 2026, commits `cd8b257` y
  `2773762`, probado por el usuario, también la descarga sin fotos; HECHO en producción; D-016).** `js/exportar-pedidos.js` + `server/routes/ordenes.js`, sin migración. **Toca el
  servidor:** hay que reiniciarlo. Después de las 15 columnas de siempre (sin cambios, el import
  las sigue leyendo por nombre e ignora las nuevas) van 11 de fotos (`_EXPORT_COLUMNAS_FOTOS`):
  una por tipo de `ordenes_fotos` ("Foto producto (URL)", "Foto entrega motorizado (URL)", "Foto
  cambio", "Foto evidencia de pago", los 4 "Foto intento …", "Foto devolución", "Foto devolución
  tienda") + "Fotos otros tipos (URL)" para un tipo que no esté en la lista. Varias del mismo
  tipo en una celda, separadas por `" | "`, en el orden en que se subieron. Las fotos salen de
  **`POST /ordenes/fotos-export {ids}`** (nuevo, antes de `GET /:id`): de a 1000 ids por consulta,
  tope **5000 por pedido** (el cuerpo JSON no puede pasar de 100 KB con `express.json()`), alcance
  por `filtroPorRol` y tipos por rol (`tiposFotoVisiblesExport`: gestores todos, motorizado sin
  devolución, tienda solo producto, visor ninguno). El frontend pide de a 2000 ids
  (`_EXPORT_IDS_POR_PEDIDO`) con 15 s máximo en total. **La descarga nunca se bloquea por las
  fotos:** si un pedido falla, tarda o el servidor no tiene la ruta, el archivo sale igual con
  esas celdas vacías y un aviso no bloqueante ("sin las URLs de las fotos" / "a N les faltan");
  una orden con un dato raro sale con lo básico (`_filaSegura`). **Un tipo de foto nuevo se suma
  también a `_EXPORT_COLUMNAS_FOTOS`.** El 10/11 el "No se pudieron traer las fotos" del usuario
  era el servidor local viejo (arrancado antes del commit `cd8b257`): la ruta no existía (404).

- **Limpieza de producción (7 de noviembre de 2026, HECHA).** Confirmado por el usuario: con backup
  previo, corrió `server/scripts/limpiar_ordenes_y_caja.sql`. Las órdenes y toda la Caja eran de
  simulación y quedaron en 0; usuarios, tiendas, motorizados, distritos, zonas y orígenes, intactos.
  Las cifras de órdenes de las notas de abajo (como las 274 del 20/10) son historia: **hoy producción
  arranca sin órdenes**, y los ids y la numeración vuelven a empezar. Ver D-015 en `DECISIONES.md`.
- **Número de orden desde C-1 (7 de noviembre de 2026, HECHO en producción).** Confirmado por el
  usuario. Commit `bc98079`. Con la tabla vacía el código empezaba en C-1001; ahora en C-1. Con órdenes
  sigue siendo el mayor + 1. Sale de `insertarConCodigoNuevo` y de la copia de `/devolver`, en
  `server/routes/ordenes.js`, no de la base: `ordenes.id` y el código son números distintos.
- **Cambios visuales del motorizado (7 de noviembre de 2026, HECHO en producción).** Confirmado por el
  usuario. Solo frontend, sin migración.
  - **"Mis entregas de hoy"** (`feb1061`): la tarjeta usa las clases `assign-*` de Asignación. Tienda,
    distrito, cliente y monto, grandes y en negrita; el código, chico y sin negrita.
  - **Tabla del historial** (`911fa2b`): el contenedor ya tenía `overflow-x: auto`; el problema era el
    espacio. Hasta 768 px, en `#tabla-ordenes-moto-detalle`, Código deja de estar fijo (Actualizar
    sigue fijo), la barra se ve más y un aviso indica que se puede deslizar.
  - **Los 8 cuadros del detalle** (`75b952b`, clase `.moto-kpis`): 2 columnas y sin ícono hasta 768 px.
    Entre 769 y unos 950 px siguen en 4 columnas y se cortan: se dejó así a pedido del usuario.

- **Estado `anulado` (HECHO en producción).** Confirmado por el usuario: migración
  `velox_agregar_estado_anulado.sql` aplicada, después `git pull` + `pm2 restart velox`, verificado.
  Último commit en producción: `c0f1312` (cambio en `43b6e5d`). Ver D-014 en `DECISIONES.md`. `server/caja-motor.js`, `server/routes/ordenes.js`, `motorizados.js`,
  `tiendas.js`, `js/motorizados.js`, `js/pedidos.js`, `js/charts.js`, `js/exportar-pedidos.js`,
  `pages/pedidos.html`, `css/components.css`.
  - **Solo el admin** anula y vuelve atrás, desde "Actualizar orden". `PATCH /estado` rechaza al resto
    con 403, y `soloAdminSiAnulada` frena a los demás en toda ruta que modifique una orden anulada.
    Las fotos no pasan por ese control: una que ya estaba en la cola termina de subir.
  - **Override:** desde cualquier estado, sin pedir datos y sin revisar días pagados. Solo cambia el
    estado; el resto de la orden (moto, montos, medio de pago) queda tal como estaba.
  - **Cuenta cero:** no está en `ESTADOS_COBRABLES`, `ordenesPrepagadas` la excluye de Caja real y un
    día pagado queda "Difiere de lo pagado". Fuera de Asignación (`SQL_ASIGNABLE`), del motorizado
    (`filtroPorRol`, también `GET /:id`, y `/motorizados/:id/ordenes`, también para gestores), de la
    tienda y Clientes, de "Pendiente", de las devoluciones y de Evidencias.
  - **Se ve en "Todos los pedidos"** con la etiqueta "Anulado" y su filtro, pero no cuenta en los
    indicadores. Al exportar sale `ANULADO`.

- **El motorizado solo ve sus órdenes (6 de noviembre de 2026, HECHO en producción).** Confirmado por
  el usuario: `git pull` + `pm2 restart velox`, logs OK. Último commit en producción: `03f23a0`
  (cambio en `727186d`). Ver D-013 en `DECISIONES.md`. Sin migración. `server/routes/ordenes.js`,
  `js/asignacion.js`. Los motorizados con la app abierta tienen que recargarla.
  `filtroPorRol()` exige `id_motorizado = él`: "Mis entregas de hoy", Evidencias, `GET /ordenes` y
  `GET /ordenes/:id` ya no traen las sin asignar. La pantalla Asignación lee de un endpoint propio,
  `GET /ordenes/para-asignacion` (`filtroAsignacion()`): las suyas + las sin asignar asignables,
  nunca las de otro. **Un listado nuevo del motorizado usa `filtroPorRol`, no `filtroAsignacion`.**

- **Las 3 cajas con un solo motor + Caja de motorizados rehecha (6 de noviembre de 2026, HECHO en
  producción).** Confirmado por el usuario: migración `velox_agregar_fotos_pago_moto.sql` aplicada,
  después `git pull` + `pm2 restart velox`, logs OK. Último commit en producción: `03f23a0` (cambios
  en `b50d396`, `933e6e4`, `9178ac6`). Ver D-012 en `DECISIONES.md`.
  - **Motor** `server/caja-motor.js`: `calcularOrdenCaja()` es la ÚNICA definición de la plata de
    una orden, en céntimos (delivery, retenido, plata en mano del moto, plata directa a Velox,
    pago al moto, prepago, saldos, vías). Sin sesión ni roles, para que después lo usen las vistas
    de la tienda y del moto (no construidas). `ordenesCaja()` trae las órdenes cobrables;
    `cuadreCaja()` es el control de cuadre; `sumaEnCajaTienda` / `sumaEnCajaMoto` (hoy iguales:
    entregado, ausente, devolución) los usa `ordenes.js`.
  - **Motorizados:** saldo = efectivo + Yape que pasaron por sus manos − su pago. Pago Velox y
    Pago tienda no suman. Cobra en entregado, ausente y devolución. Pantalla igual a Caja Tienda;
    "Marcar pagado" liquida el rango con foto obligatoria (1 a 5, `encolarFotoPagoMoto`, tablas
    `caja_liquidaciones_motorizados` y `_fotos`, carpeta R2 `pagos-moto/`), en transacción y con
    `fecha_pago` de Lima. **Los días con órdenes en proceso no se liquidan** (el moto ya no podría
    cerrarlas). Rutas de fotos: una sola fábrica, `rutasFotosLiquidacion()`, para tiendas y motos.
  - **Días pagados (tiendas y motos):** el saldo sale de lo guardado; si no coincide con lo que dan
    hoy los pedidos, "Difiere de lo pagado". Delivery, retenido y el detalle van en vivo, porque lo
    guardado es por día y solo tiene el saldo. Los días pagados con la regla vieja van a decir
    "Difiere" y es esperable.
  - **Liquidez:** teórica, en vivo, por fecha de reparto. Ganancia = delivery − pago a motos. Se
    fueron "Devoluciones", "Líquido neto" y "Caja teórica". Vías (efectivo, Yape, depósito) y línea
    de cuadre.
  - **Caja real:** lo liquidado por `fecha_pago` y con montos guardados; Pago Velox y prepagos por
    `fecha_reparto`. Prepagos no cobrables en línea aparte, fuera del cuadre. Días viejos del moto:
    vías "sin desglose" y su Pago Velox no se vuelve a sumar (ya estaba en su `monto_cobrado`).
  - **Vías:** efectivo moto → efectivo, Yape moto → Yape, Pago Velox → depósito, prepago según su
    método, Pago tienda no cuenta. Lo que pagan las tiendas al liquidar no se cuenta.
  - **Cuadre:** saldo motos + saldo tiendas + Pago Velox + prepagos = delivery − pago a motos.
    `node scripts/verificar-cuadre-cajas.js [--desde= --hasta=]` (solo lectura, desde `server/`).
  - **Devolución tardía:** `/devolver-tienda` no se bloquea por el día pagado del moto: lo pagado no
    cambia, el día queda "Difiere" y ese viaje se resuelve a mano.
  - **Dos bugs de producción corregidos:** `_soles` de `entregas-moto.js` pisaba la de Caja
    ("− S/ -50.00"; ahora `_solesCaja`), y `aplicarFiltroMotos` / `filtroRapidoMotos` /
    `limpiarFiltroMotos` de `motorizados.js` pisaban los de Caja (ahora `...MotosCaja`): el filtro
    de fechas de la Caja de motos no hacía nada. **Ojo: todo el JS va en globales y un nombre
    repetido pisa al otro sin avisar.**
  - **Probar en local:** `server/scripts/datos_prueba_cajas.sql` (tienda y moto "PRUEBA CAJA",
    órdenes PRB-*, se niega a correr fuera de esta PC) y `borrar_datos_prueba_cajas.sql`.

- **Foto del pago en "Marcar pagado" de Caja Tienda (4 de noviembre de 2026, HECHO en
  producción).** Confirmado por el usuario el 4 de noviembre de 2026: migración
  `velox_agregar_fotos_pago_tienda.sql` aplicada con `sa`, después `git pull` + `pm2 restart
  velox`, logs limpios. Último commit en producción: `e07d53e` (cambio en `5d9e9c0`). Ver D-011
  en `DECISIONES.md`. `server/routes/caja.js`, `server/r2.js`, `server/almacenamiento-local.js`,
  `js/cola-fotos.js`, `js/indicador-fotos.js`, `js/caja.js`, `pages/caja.html`. **Toca el
  servidor.**
  - "Marcar pagado" abre primero el paso de foto (Tomar foto con `pedirFoto` / Subir imagen,
    varias; mín. 1, hasta 5, quitar con la ×), después la confirmación de días + monto, después
    `POST /caja/tiendas/pagar` con `fotos` (1–5; sin eso, 400), que crea la liquidación
    (`caja_liquidaciones_tiendas`) y le cuelga los días (`caja_pagos_tiendas.id_liquidacion`).
    Recién con la liquidación creada las fotos entran a la cola (`encolarFotoPagoTienda`). Si
    el POST falla (sin señal, 409), la ventana sigue abierta con las fotos.
  - Subida: la cola de siempre con un destino opcional (`item.destino.base`): mismas tres rutas
    bajo `/api/caja/tiendas/liquidaciones/:id/` (`evidencia/presigned`, `foto/registrar`,
    `foto/local` + `GET foto/:fotoId`), carpeta R2 `pagos-tienda/liquidacion-<id>/`, tabla
    `caja_liquidaciones_tiendas_fotos`, tope 5, dedup por `idSubida`. En el indicador sale como
    "Pago a tienda · <tienda>".
  - Historial: con "Pagados" o "Todos", el detalle de la tienda lista "Pagos registrados"
    (fecha, días, monto, quién, "N fotos por subir") y "Ver fotos" abre las miniaturas (lazy);
    tocar agranda. Se refresca solo cuando llega una foto (`velox:foto-subida`).
  - `/pagar` ahora es transaccional con bloqueo por día: si otro usuario liquidó un día en el
    medio, 409 y no se pisa nada.

- **Caja Tienda rehecha (4 de noviembre de 2026, HECHO en producción).** Confirmado por el
  usuario el 4 de noviembre de 2026, en el mismo deploy que la foto del pago (último commit
  `e07d53e`; cambio en `18f2c5f`). Sin migración propia: usa
  las columnas que ya existían. `server/routes/caja.js`, `server/routes/ordenes.js`, `js/caja.js`,
  `pages/caja.html`, `js/pedidos.js`, `js/motorizados.js`. **Toca el servidor:** hay que reiniciarlo.
  Liquidez y la Caja de motorizados no se tocaron.
  - **Una sola función** `calcularCajaTienda()` (en céntimos) por pedido, en su `fecha_reparto`.
    Cobrables: `entregado`, `ausente`, `devolucion` (cancelado, reprogramado, no entregado y en
    proceso no suman). Delivery = `delivery_total`. Retenido = `monto_cobrado` solo si es
    entregado + contraentrega + `medio_pago` en Pago Velox (`pago-empresa`), Yape o efectivo al
    moto; con "Pago tienda" o medio por definir (NULL), 0. Postpago: saldo = delivery − retenido;
    prepago (`pago_velox = 'PAGADO'`): saldo = − retenido. > 0 nos debe, < 0 le debemos.
    Cambios contra la Caja anterior: el cancelado prepagado ya no da devolución; el ausente ya
    no resta lo cobrado; "Pago tienda" ya no cuenta como cobrado por Velox.
  - **Endpoints:** `GET /caja/tiendas?desde&hasta&estado=pendientes|pagados|todos` (resumen por
    tienda + KPIs, que miran siempre lo pendiente del período), `GET /caja/tiendas/:id/detalle`
    (por pedido + totales) y `POST /caja/tiendas/pagar {id_tienda, desde, hasta}` (liquida, en
    una transacción, todos los días pendientes de la tienda en el período; sigue siendo por día
    en `caja_pagos_tiendas`). Solo "desde" = ese único día. `fecha_pago` = hoy en Lima (arregla
    el bug de `GETDATE()` en tiendas; el de motorizados sigue, ver Pendiente).
  - **Pantalla:** 5 KPIs (por cobrar, por devolver, posición neta, al día, con saldo),
    Pendientes / Pagados / Todos + buscador, una fila por tienda (ciclo, pedidos, delivery,
    retenido, saldo grande verde/ámbar, estado, "Marcar pagado") y el ojito abre el detalle por
    pedido **inline** con totales, badges de estado, chip PAGADO / Pendiente (PAGADO = prepago o
    día liquidado) y "Editar orden" (el mismo modal "Actualizar orden"; avisa antes si el día ya
    está pagado). Refresco de 8 s sin repintar si nada cambió; el detalle abierto se mantiene.
  - **Devolución Tienda** deja la orden en estado `devolucion` (estado final, la Caja cobra su
    delivery), salvo que ya fuera entregado / ausente (ej. un cambio entregado). Si su día ya
    está pagado para la tienda, 400 (`diaPagado`). `sumaEnCajaTienda()` en `ordenes.js` ahora
    es entregado / ausente / devolución.

- **Asignar órdenes pendientes con foto + tienda (3 de noviembre de 2026, HECHO en
  producción).** Confirmado por el usuario el 3 de noviembre de 2026: `git pull` + `pm2 restart
  velox`, sin migración. Último commit en producción: `7996d0e` (cambio en `0347988`; ver D-010
  en `DECISIONES.md`). `server/routes/ordenes.js`, `js/asignacion.js`, `js/entregas-moto.js`,
  `js/ordenes-pendientes.js`, `css/components.css`. **Toca el servidor:** hay que reiniciarlo.
  - **Asignable** = no pendiente (como siempre, con o sin foto) **o** pendiente con tienda real
    y foto del producto (`SQL_ASIGNABLE`; `SELECT_ORDEN` devuelve `asignable`). Lo usan
    Asignación, `filtroAsignacion()` (el motorizado ve y se autoasigna las asignables) y
    `/asignar` (400 explicando si falta la tienda o la foto).
  - **Sigue pendiente después de asignarla:** la marca `datos_pendientes` no depende del
    motorizado; queda en "Pendiente" (con la marca "Asignada a X") y con "Por completar" hasta
    que se completan sus datos.
  - **No se puede cerrar con datos pendientes** (`ERROR_CIERRE_PENDIENTE`, 400 con
    `datosPendientes: true`): `/resolver` (ya estaba) y `/estado` cuando cambia a algo distinto
    de `en-proceso` (mandar el mismo estado pasa). `/completo` no cambia el estado; como
    "Actualizar orden" lo manda antes que `/estado`, completar los datos y cerrar en el mismo
    guardado funciona. Motivo: delivery, pago al moto y cobrado salen del distrito y del monto,
    que faltan; la Caja contaría ceros.
  - **"Autoasignar todos" no las reparte** (sin distrito no hay zona): se asignan a mano por la
    foto.
  - Pantallas: en Asignación, "Por completar", "Distrito por definir" (para todo distrito
    `SIN DEFINIR`, también el de la cámara azul) y "Cliente por completar", en ámbar. En "Mis
    entregas de hoy", en vez de EMPEZAR: "Faltan datos: la oficina los está completando", y
    "Por cobrar: por completar" en vez de "Sin cobro"; al completarse, el refresco de 8 s
    habilita EMPEZAR. Al cerrar una orden no se salta a una pendiente.

- **"Subir imagen" en las dos cámaras de "Todos los pedidos" (3 de noviembre de 2026, HECHO en
  producción).** Confirmado por el usuario el 3 de noviembre de 2026 (mismo deploy, último
  commit `7996d0e`; cambio en `6d1a986`). Sin migración ni cambios en el servidor
  (`js/pedidos.js`, `pages/pedidos.html`).
  - **Cámara azul** (y la de adentro de "Nueva orden"): el visor tiene "Capturar", "Subir
    imagen" y "Cancelar". La imagen de la galería sigue el mismo camino que la foto tomada
    (`onFotoProductoSeleccionada`: comprime, queda en memoria, abre "Nueva orden" en el flujo
    rápido; entra a la cola al guardar la orden). Input nuevo `f-orden-foto-galeria-rapida`.
  - **Ráfaga ⚡:** después de la tienda, el visor tiene "Capturar", "Subir imágenes" (varias de
    la galería, input `f-orden-fotos-rafaga-galeria` con `multiple`) y "Terminar". Cada imagen
    se cuenta al instante, se comprime de a una en el orden elegido y entra a la cola con
    `encolarFotoRafaga` y la tienda de esa ráfaga, igual que una foto capturada (la cola crea
    la orden y sube la foto). `_rafagaSesion` evita que las que terminan de prepararse después
    de "Terminar" toquen el contador o la tienda de la ráfaga siguiente.
  - **Si la cámara en vivo no abre** (permiso, cámara rota, http por IP), los dos visores ya no
    se cierran: ocultan el video, muestran un aviso y "Capturar" abre la cámara nativa
    (`_camaraSinVivo` / `_rafagaSinVivo`, el respaldo de antes). Si se cierra el visor mientras
    se pide el permiso, la cámara se apaga al llegar.

- **"Subir imagen" en todas las fotos del motorizado (2 de noviembre de 2026, HECHO en
  producción).** Confirmado por el usuario el 2 de noviembre de 2026: `git pull` + `pm2 restart
  velox`, sin migración. Último commit en producción: `036875a` (cambio en `d764f63`). En "Mis entregas de hoy"
  (`js/entregas-moto.js`, `_slotFotoEnt`) la foto de entrega, la del cambio y las de OTROS
  (reprogramado / ausente / cancelado) ahora tienen "Tomar foto" y "Subir imagen", como ya
  tenían el pago y DETALLE, por si la cámara falla. Se borró `_ENT_TIPOS_CON_GALERIA`. Mismo
  camino que antes: galería → compresión → borrador → cola → R2 después de `/resolver`.

- **Asignación con foto del producto (2 de noviembre de 2026, HECHO en producción).** Confirmado
  por el usuario el 2 de noviembre de 2026: `git pull` + `pm2 restart velox`, sin migración.
  Último commit en producción: `f5a39f4`. Commits `4894925`, `167c29e`, `16f4eca` (todo en
  `js/asignacion.js` y `css/components.css`).
  - En "Pedidos pendientes de asignación" y en "Órdenes asignadas al motorizado" cada orden
    muestra una miniatura de 64 px de su `foto_producto_url` (la que ya devuelve `GET /ordenes`,
    también al motorizado para las sin asignar), con `loading="lazy"` para gastar menos datos.
    Al tocarla se ve en grande (capa `#asig-foto-grande`, se cierra tocando o con Escape). Sin
    foto, o si no carga, un ícono gris. Es la foto completa de R2 (no hay miniaturas aparte).
  - Los dos paneles usan el mismo bloque de datos (`_datosOrdenAsig`): tienda, distrito y
    cliente grandes y en negrita; el código chico abajo con su etiqueta de estado. Las asignadas
    ahora muestran también el cliente. Los datos se escapan al armar el HTML.
  - El sondeo de 10 s ya no repinta un panel si nada cambió (firma guardada en el elemento),
    para que las miniaturas no parpadeen ni se vuelvan a pedir.

- **Deploy del 29/10 HECHO en producción** (confirmado por el usuario el 29 de octubre de
  2026). Sin migración: `git pull` + `pm2 restart velox`. Último commit en producción:
  `7cba834`. Quedan en producción (detalle más abajo):
  - Catálogo de tiendas + accesos con contraseña aleatoria + filtro de activos (`96044c3`).
  - Resetear contraseña de tiendas y motorizados, por fila y en masa (`7cba834`).

- **Deploy del 28/10 HECHO en producción** (confirmado por el usuario el 29 de octubre de
  2026). Migración `velox_agregar_motivo_no_entrega.sql` aplicada en el servidor con `sa`
  **antes** del pull; después `git pull` + `pm2 restart velox`. Último commit en producción:
  `a0b71c8`. Quedan en producción las 3 funciones nuevas (detalle más abajo):
  - Fotos de devolución (`234d539`).
  - Vista del motorizado "Mis entregas de hoy" (`2c77411`).
  - Foto del pago también con Efectivo + "Subir imagen" desde la galería (`a0b71c8`).

- **Catálogo de tiendas + accesos + filtro de activos (29 de octubre de 2026, en producción).** No
  necesitó migración.
  - **Página "Tiendas"** (`pages/tiendas.html`, `js/tiendas.js`; reemplaza en el menú a "Usuarios
    Tienda", que se borró): todas las tiendas sin filtro de fecha, buscador, filtros de estado y
    acceso, "Agregar tienda", editar, **Desactivar / Reactivar** (`PATCH /tiendas/:id/estado`) y
    "Crear acceso". El alta/edición salió de "Clientes / Tiendas", que queda como resumen de plata.
    Solo el nombre es obligatorio (antes RUC y correo, y ninguna tienda importada los tiene: no se
    podía editar ninguna); `POST`/`PUT /tiendas` responden 400 "Ya existe una tienda con ese
    nombre." (antes 500). `GET /tiendas` devuelve `tiene_usuario`.
  - **Accesos** (`js/accesos.js`, solo admin): "Crear accesos faltantes" en Tiendas y "Crear accesos
    de motorizados" en Usuarios. Lista las activas sin usuario (`GET /auth/tiendas-libres` /
    `motorizados-libres`, por el vínculo, no por el correo), con casillas; crea con el mismo
    `POST /auth/usuarios`, correo armado con el nombre (número si está tomado) y **contraseña
    aleatoria** de 12 caracteres, mostrada **una sola vez** con Copiar y Descargar CSV. Se borró el
    masivo viejo de contraseña de fórmula (nombre + un sufijo común): los 89 usuarios de tienda que ya
    existen la siguen teniendo (Fase 4: se arregla con el reseteo, abajo).
    `POST /auth/usuarios` ahora rechaza un segundo usuario para la misma tienda.
  - **Resetear contraseña** (solo admin, mismo `js/accesos.js`: `abrirResetearAccesos` →
    `resetearAccesos`): botón "Resetear contraseña" en cada tienda con acceso (Tiendas) y en cada
    usuario de tienda o motorizado (Usuarios; no en admin/operador/visor), y "Resetear contraseñas"
    en masa en las dos páginas (lista con casillas, nada marcado al abrir, buscador; en Usuarios
    respeta el filtro de rol). Pide confirmación avisando que la anterior deja de funcionar; pone
    una aleatoria de 12 con `PATCH /auth/usuarios/:id/password` (no toca correo, estado ni
    vínculo) y la muestra una sola vez con Copiar / CSV. Las sesiones ya abiertas siguen hasta
    que vence su token (12 h): el JWT no depende de la contraseña.
  - **Usuarios:** filtro por rol + buscador, vínculo con la tienda, y el rol tienda entra a ver su
    usuario (como el motorizado) para cambiar su contraseña. "Cambiar contraseña" ahora pide la
    actual a quien no es admin (antes no la mandaba y el servidor la exigía) y el servidor responde
    400, no 401, si está mal (el 401 mandaba al login).
  - **Activos:** las selecciones (crear orden, ráfaga, Pendiente, asignar) ya eran solo activos; se
    completó el combo de tienda de "Actualizar orden" (activas + la que la orden ya tiene). En el
    servidor, `POST /ordenes` rechaza tienda o motorizado inactivo (y uno que no existe),
    `/asignar` rechaza motorizado inactivo salvo que la orden ya fuera suya (antes un nombre
    desconocido la desasignaba sin avisar) y `/completo` rechaza **pasar** a una tienda inactiva.
    Los filtros de tienda/motorizado de Pedidos, Pendiente devolución y Devolución Tienda tienen la
    casilla **"Mostrar inactivos"** (`opcionesFiltroTiendas` / `opcionesFiltroMotorizados` en
    `js/pedidos.js`). El filtro de tienda de Asignación sigue solo con activas.

- **Deploy de la sesión del 22–23/10 HECHO en producción** (confirmado por el usuario el 27 de
  octubre de 2026). `main` está pusheado y en el servidor se hizo `git pull` + `pm2 restart
  velox`, así que todo lo commiteado hasta `a5ec7ab` está en producción (fecha de
  asignación/reparto, reprogramadas que vuelven a Asignación, ráfaga con tienda,
  export, "Por cobrar").
  - Migración `velox_agregar_fecha_reparto.sql` aplicada en el servidor.
  - Limpieza + import corridos en producción: quedaron las **274 órdenes del 20/10** (241
    entregado, 28 reprogramado, 5 cancelado, ids 1–274). El import creó 22 tiendas, 4
    motorizados (DAVID, FERNANDO, Expres AGENCIA, Expres LIMA) y el distrito
    LURIGANCHO - CHOSICA. Los ids de producción no tienen por qué coincidir con los de local.
  - **R2 activo en producción** (ver abajo).
  - Se resetearon las contraseñas de `root`, `sa` y `velox` del servidor (las tiene anotadas el
    usuario; **nunca** en el repo). `velox_user` sigue sin permisos de `ALTER`: las migraciones y los scripts de
    limpieza se corren con `sa`.

- **Resumen de la sesión del 22–23 de octubre de 2026** (ya en producción, ver arriba). El
  detalle de cada punto está más abajo.
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
  - Scripts en `server/scripts/`: `limpiar_ordenes_y_caja.sql` (del 7/11, ver abajo), `importar-ordenes-excel.js`,
    `leer-xlsx.js`, `revisar_dias_pagados_fecha_reparto.sql`. Migración (gitignored, solo
    en la PC): `velox_agregar_fecha_reparto.sql`, ya aplicada en producción.
  - Backups locales en la carpeta `Backup` de SQL Server:
    `velox_courier_antes_import_20261022.bak` y `velox_courier_antes_fecha_reparto_20261023.bak`.

- **Vista del motorizado: "Mis entregas de hoy" (28 de octubre de 2026, en producción).** Usa la
  columna `ordenes.motivo_no_entrega NVARCHAR(300) NULL` (migración
  `velox_agregar_motivo_no_entrega.sql`, aplicada en local y en producción). Todo en `js/entregas-moto.js`
  (estilos al final de `css/components.css`).
  - Arriba de la página Motorizados, solo para el rol motorizado: sus órdenes de **hoy** (siempre
    hoy, sin importar el filtro de fecha) en `en-proceso`, con un botón EMPEZAR grande. Se
    refresca cada 8 s; la orden cerrada desaparece. La tabla de abajo no cambió.
  - EMPEZAR abre una pantalla sobrepuesta: foto del producto, datos (tienda, distrito, por
    cobrar / cliente, método de pago, condición especial), dirección y teléfono, y abajo
    COMPLETAR / OTROS / DETALLE. Al cerrar una orden **vuelve a la lista** (desde el 10/11; antes
    abría sola la siguiente) y el motorizado elige la próxima con EMPEZAR ("← Lista" vuelve sin
    cerrar); lo llenado queda en memoria por orden mientras no se cierre.
  - **COMPLETAR** (entregado): foto de entrega siempre; foto del cambio si la orden tiene
    condición especial (reemplaza "Recibido": con esa foto, "Actualizar orden" ya no lo pide); en
    contraentrega, cómo se cobró y foto del pago **solo con Pago tienda / Pago Velox**
    (`_ENT_MEDIOS_CON_FOTO`; desde el 14/11, igual que "Actualizar orden": ver la nota de esa fecha
    arriba. Hasta entonces la pedía con los 4 medios, efectivo incluido).
    **OTROS**: reprogramado / ausente / cancelado, cada uno con su foto y un comentario opcional.
    **DETALLE** (no entregado): motivo de una lista (no contesta, dirección errada, cliente no
    tenía el dinero, rechazó el producto, otro + texto) y de 1 a 3 fotos.
  - **Todas** las fotos de esta vista (entrega, cambio, pago, OTROS y DETALLE) tienen dos
    botones: "Tomar foto" (cámara) y "Subir imagen" (galería: captura del Yape, voucher, o
    cualquier foto si la cámara falla; `subirImagenEntrega`). La imagen se comprime igual que la
    foto y sigue el mismo camino (borrador → cola → R2). Hasta el 2/11 entrega, cambio y OTROS
    eran solo cámara (ver la nota de esa fecha arriba).
  - Cerrar es un solo pedido nuevo, `PATCH /ordenes/:id/resolver` (un UPDATE: estado, medio de
    pago, motivo). Solo órdenes `en-proceso` con motorizado (409 `yaResuelta` si ya se cerró),
    con `ifVersion`, y revisa que el día no esté pagado en la Caja (`bloqueoPorResolverEnDiaPagado`;
    se extrajeron `tiendaConDiaPagado` / `motoConDiaPagado` de `bloqueoPorDiaPagado`). Necesita
    señal en ese momento (encolarlo sin señal quedó para una etapa 2); sin señal, la pantalla
    avisa y conserva las fotos.
  - Fotos: van a la cola recién cuando `/resolver` respondió bien. Tipos nuevos `foto_entrega`
    (`entregas/`), `foto_cambio` (`cambios/`), `foto_reprogramado`, `foto_ausente`,
    `foto_cancelado` y `foto_no_entregado` (`intentos/`); la del pago es la
    `evidencia_medio_pago` de siempre. Tope de seguridad de 10 por tipo y por orden
    (`MAX_FOTOS_MOTORIZADO_POR_TIPO`, en `rechazoPorTipoFoto`). Las ven los gestores y el
    motorizado de la orden; la tienda no.
  - "Actualizar orden" tiene un bloque con las fotos (cada una en su grupo + el motivo del último
    intento); desde el 10/11 se llama "Fotos de la orden" y muestra todos los tipos (ver arriba). `GET /ordenes/:id` devuelve `fotos` (todas las que ese rol puede ver;
    reemplaza a `fotos_devolucion`) y `SELECT_ORDEN` devuelve `motivo_no_entrega`.

- **Fotos de devolución (28 de octubre de 2026, en producción).** No necesita
  migración. "Confirmar devolución" (columna de la tabla en Pedidos / Pendiente devolución, y el
  botón amarillo de "Actualizar orden") y "Devuelto" de Devolución Tienda piden **primero** una
  foto (`pedirFoto()` en `js/camara-foto.js`: cámara → vista previa → "Usar foto y confirmar";
  reemplaza al `confirm()`), después hacen la acción de siempre y recién ahí la foto entra a la
  cola (`encolarFoto`). Si el PATCH falla, la foto se guarda en memoria para el reintento.
  - Tipos nuevos en `ordenes_fotos`: `foto_devolucion` (una por vuelta a la oficina, tope
    `MAX_FOTOS_DEVOLUCION = 5`) y `foto_devolucion_tienda`. Carpetas R2 `devoluciones/` y
    `devoluciones-tienda/` (`CARPETAS` en `server/r2.js`). Solo las suben y las ven los gestores
    (`rechazoFotoDevolucion`, `puedeVerFotoOrden`).
  - **Tope de 5 = tope de fotos, no de reprogramaciones:** con 5 fotos ya no se pide foto (aviso
    con `confirm()`) y la devolución se confirma igual; `devuelto` sigue contando. El servidor
    rechaza la sexta con 409 en `presigned`/`registrar`/`local`, salvo el reintento de una foto
    ya registrada (mismo `idSubida`).
  - Se ven en "Actualizar orden": en la zona amarilla al lado del botón y en la verde ("Producto
    devuelto — confirmado"), como botones 1…5 / "Tienda" que cargan la foto al tocarlos. Vienen
    en `GET /ordenes/:id` (`fotos_devolucion`, solo para gestores); `SELECT_ORDEN` devuelve
    `fotos_devolucion_total`.

- **R2 (Cloudflare): ACTIVO en local y en producción.** En producción se pusieron las 5
  variables `R2_*` en el `.env` del servidor + `pm2 restart velox`; confirmado por el usuario
  (27 de octubre de 2026) que las fotos suben a `pub-b64e...r2.dev/productos/`. El modo prueba
  (`uploads_local/`) ya no se usa en ningún lado, salvo que falte alguna variable.
  Cuenta R2 creada, bucket `velox-fotos`, las 5 variables `R2_*` en el `server/.env` de cada
  máquina (nunca en el repo), URL pública `pub-b64e...r2.dev`. CORS del bucket configurado para
  `http://localhost:3000` y `https://sistema.veloxcourierperu.com` (métodos PUT y GET,
  encabezados `content-type` y, desde el 10/11, `cache-control` para el reporte en imagen: el
  navegador sube directo a R2 desde `js/cola-fotos.js` y `js/reporte-tienda.js`).
  Probado el 21 de octubre de 2026: las fotos (incluida la ráfaga) suben a R2, se ven con su
  URL pública y quedan registradas en `ordenes_fotos` con la URL de R2, sin duplicados.
  Ojo: el servidor usa R2 apenas las 5 variables tienen **cualquier** valor; si una falta o
  está vacía, vuelve al modo prueba (`uploads_local/`).

- **Fecha de reparto (23 de octubre de 2026, en producción; ver D-009 en `DECISIONES.md`).**
  La fecha que manda es el día en que la orden sale a entregar, no el de creación: **entrega del
  día = cobro del día**. Columna calculada `ordenes.fecha_reparto = ISNULL(fecha_asignacion,
  fecha)` (migración `velox_agregar_fecha_reparto.sql`, aplicada en local y en producción). La usan "Todos los
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
  - `server/scripts/revisar_dias_pagados_fecha_reparto.sql` (solo lectura) lista las órdenes
    que cambiarían de día en días ya pagados. Se usó antes de subir; queda por si hace falta.

- **Descargar Excel / CSV en "Todos los pedidos" (23 de octubre de 2026, commit `55613a7`, en
  producción).** `js/exportar-pedidos.js` exporta solo las filas **visibles** de la tabla
  (cada `<tr>` lleva `data-id`; se cruzan con `_ordenesCache`), así respeta la fecha y todos los
  filtros. Mismas 15 columnas y orden que el Excel de importación, para poder reimportarlo
  (probado ida y vuelta); desde el 10/11, después van 11 columnas de URLs de fotos (ver arriba). Sin librerías: el `.xlsx` es un zip sin comprimir armado a mano
  (fecha como fecha real `dd/mm/yyyy`); el CSV va con BOM UTF-8 y **separado por `;`**, porque
  en Windows es-PE el separador de listas es `;` y con comas Excel lo abre en una sola columna.
  REPROGRAMADOS PARA HOY = "SI" si las observaciones dicen "Reprogramado para hoy" o si
  `fecha_asignacion` > `fecha`; por eso `SELECT_ORDEN` ahora devuelve `fecha_asignacion`.

- **Importación de órdenes desde Excel (22 de octubre de 2026, commit `c15090d`).** En local se
  borraron las órdenes de ejemplo y se cargó el día real 20/10/2026 desde
  `D:\subir sist velox.xlsx` (274 órdenes: 241 entregado, 28 reprogramado, 5 cancelado). Backup
  previo en la carpeta `Backup` de SQL Server: `velox_courier_antes_import_20261022.bak`. Tres
  scripts en `server/scripts/`:
  - `limpiar_ordenes_y_caja.sql` (reemplaza al script de limpieza de ese momento) — vacía `ordenes`,
    las tablas `caja_*` y todo lo que dependa de ellas por FK, y reinicia sus identity. Los
    dependientes y el orden de borrado salen del esquema al correr. No toca tiendas, motorizados,
    usuarios, distritos, zonas ni orígenes. Las fotos (R2 o `uploads_local/`) quedan huérfanas: solo
    se borran sus filas.
  - `limpiar_ordenes.sql` — **OBSOLETO, no usar.** Se deja solo como referencia (lista fija de
    tablas, anterior a las liquidaciones). El script de limpieza vigente es `limpiar_ordenes_y_caja.sql`.
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

  **Ya corridos en producción.** Si se vuelven a usar en el servidor:
  `limpiar_ordenes_y_caja.sql` borra **TODAS** las órdenes y toda la Caja (backup antes, app parada
  con `pm2 stop velox` y sin fotos en cola en los teléfonos, porque los ids se reutilizan); se corre
  con `sa`, porque `velox_user` no alcanza para el backup ni para `DBCC CHECKIDENT`. El import se corre
  primero sin flags y se revisa la validación antes de `--insertar`.

- **En producción: el motorizado ve sus órdenes el día en que se le asignaron.** Columna
  nueva `ordenes.fecha_asignacion` (migración ya aplicada en producción, ver abajo), la llena `/asignar`. La
  página Motorizados (resumen, tarjetas y detalle, para todos los roles) la usa. Desde el
  cambio "Fecha de reparto" (arriba) también la usan la Caja y el resto de las pantallas, vía
  `ordenes.fecha_reparto`: el pendiente de que la Caja agrupaba por `ordenes.fecha` quedó resuelto.
- **En producción: reprogramadas y no entregadas vuelven a Asignación.** Al confirmar la
  devolución (`PATCH /:id/devolver`) pasan a `en-proceso` **sin motorizado** y con
  `fecha_asignacion` vacía (vuelven a verse en su día de creación); al reasignarlas, `/asignar`
  les pone el día elegido (o hoy). Depende de la
  migración `velox_agregar_fecha_asignacion.sql`. "Pendiente devolución" y "Devolución Tienda"
  ahora refrescan suave (sin "Cargando..." y sin repintar si nada cambió).

- **En producción (20 de octubre de 2026): ráfaga con tienda + "Pendiente" con
  destinatario/distrito/cobrado.** No necesita migración (todas las columnas ya existen).
  Commits `aad7979` (parte 1) y el siguiente (parte 2).
  - **⚡ ahora pide primero la tienda** (modal `#rafaga-tienda-overlay` en `pages/pedidos.html`,
    mismo buscador que "Nueva orden"); recién después abre la cámara. Una tienda por ráfaga;
    la cámara la muestra arriba del contador. La tienda viaja guardada con cada foto en la
    cola (`item.rafaga.tienda`) y `POST /rafaga` la usa; si no viene (fotos viejas en cola) o
    ya no es válida, usa la tienda comodín. "Terminar" vuelve a "Todos los pedidos" (desde el
    19/11; antes abría la ventana "Pendiente").
  - **`CAMPOS_PENDIENTES` = destinatario, distrito, cobrado.** "Tienda distinta del comodín"
    es un chequeo **fijo** (`tieneTiendaReal`), fuera de la lista: las pendientes viejas con
    tienda `SIN DEFINIR` llegan con `falta_tienda` y solo esas filas muestran el buscador de
    tienda. El cobrado viene con 0 en la ventana y vacío se guarda como 0 (desde el 19/11);
    en la base no se puede distinguir de "sin llenar", así que su chequeo es siempre verdadero.
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
    `server/routes/ordenes.js` (hoy: destinatario, distrito, cobrado; ver arriba); la marca se apaga en
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
  - En "Todos los pedidos" se ven con la marca "Por completar". Desde el 3/11 se pueden
    **asignar** apenas tienen tienda real + foto (ver la nota de esa fecha arriba); sin eso no
    aparecen en Asignación, el motorizado no las ve (`filtroAsignacion`) y `/asignar` las rechaza.
    Con datos pendientes **no se pueden cerrar**. La tienda comodín no se lista en
    `GET /tiendas` ni se puede editar.
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
- **Fotos: R2 activo en local y en producción (modo prueba como respaldo).** Si el `.env`
  no tiene las 5 variables `R2_*`, las fotos se guardan en
  `server/uploads_local/` (gitignored, en el disco de la máquina) y se
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
- **Control de concurrencia (409) roto** desde el 14/10: `row_version` no llega en hex y ningún
  `ifVersion` se compara (el último que guarda pisa). Decidido no arreglarlo por ahora (14/11);
  detalle y arreglo en la nota de arriba.
- **El cuadre de las cajas** se revisa con `node scripts/verificar-cuadre-cajas.js` (desde `server/`).
- **Importador de Excel:** `server/scripts/importar-ordenes-excel.js` todavía arranca en 1000. Con la
  base vacía, sus órdenes saldrían desde C-1001, y las siguientes seguirían desde ahí. Cambiarlo antes
  de importar.
- **Fotos huérfanas en R2:** la limpieza del 7/11 borró las filas, no los archivos del bucket.
- **Evidencias todavía calcula plata en el navegador con la regla vieja** (`js/charts.js`,
  `_EC_EV = entregado / ausente`): "Ingreso delivery", "Saldo por cobrar", "Pago a motorizados" y el
  detalle por moto. Lo ven gestores y tienda. Clientes / Tiendas y su WhatsApp ya usan el motor
  (25/11, D-029).
- **Vistas de la tienda y del moto para ver su propia caja:** próximo paso; el motor ya sirve,
  falta construirlas con el alcance por sesión (`filtroPorRol`).
- **"Marcar pagado" de tiendas sigue liquidando días con órdenes en proceso** (después no se pueden
  cerrar, `/resolver` lo rechaza). En motos ya se excluyen; decidir si se hace igual.
- `/estado`, `/completo` y `/medio-pago` siguen sin bloquear por día pagado: lo pagado no cambia y
  queda "Difiere de lo pagado".
- Borrar las 3 fotos de prueba del bucket (`productos/orden-0/`) y, si quedó, la carpeta
  `server/uploads_local/` del servidor (ya no se usa con R2 activo; las fotos de modo prueba
  **no se migran** a R2).
- Opcional, más adelante: conectar un dominio propio (`fotos.veloxcourierperu.com`) al bucket
  en vez de la URL `r2.dev`, que tiene límite de velocidad; después cambiar `R2_PUBLIC_URL`.
- **Fase 4 — rotación de contraseñas y secretos** (ver D-007 en `DECISIONES.md`):
  - Rotar las **89 contraseñas de fórmula** de los usuarios de tienda (nombre + un sufijo común): ya
    se puede con Tiendas → "Resetear contraseñas" (en masa, buscador vacío → Todas) y entregar el
    CSV. Conviene hacerlo cuando se decida a qué tiendas se les da acceso.
  - **`server/db.js` ya no tiene la contraseña de respaldo** (Cambio 11). Falta rotarla en el
    servidor, porque quedó en el historial de git y se pudo bajar del sitio. Rotar también la de `sa`.
- **Opcional — cortar las sesiones abiertas al resetear una contraseña.** Hoy el reseteo no
  cierra las sesiones ya abiertas (el JWT dura 12 h y no depende de la contraseña). Necesita
  **migración** (ej. columna `usuarios.sesion_version` que `requireAuth` compara con el token y
  que el reseteo incrementa).
- **Vista del motorizado (en producción, ver arriba):** probarla a fondo en el celular real
  (cámara, "Subir imagen" desde la galería, corte de señal). Etapa 2, opcional: encolar el
  "resolver" para que funcione sin señal.
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

- Production runs on a DigitalOcean droplet (Ubuntu 22.04, SQL Server 2022 Express, Node + PM2 + Nginx) at `sistema.veloxcourierperu.com`. Full details, costs, and the deploy flow (local commit → the user pushes → `git pull && pm2 restart velox` on the server) are in `DECISIONES.md`. Claude commits locally and never pushes unless the user asks.
- **Never restore a local `.bak` over the production database.** Local (`DESKTOP-E9N76IK`, SQL Server 2025) and production (SQL Server 2022) are separate databases that do not sync; backups only flow production → local, never the reverse.
- **Never generate a local `.bak` to restore on the server.** A backup taken on SQL Server 2025 cannot be restored on SQL Server 2022 (backups don't restore to an older version), so it would fail outright — and even if the versions matched, it would overwrite real production data. The only way DB changes reach production is by hand-applied `ALTER TABLE` / migration `.sql` scripts.
- **Database schema changes do not travel through git.** They're applied by hand on the server (`sqlcmd` or versioned migration scripts). A migration file added to this repo does not get run automatically anywhere. Production changes go **only** as `ALTER TABLE` scripts (never as a `.bak`, see above). Note that `velox_agregar_*.sql` migration scripts are gitignored, so they exist only on the dev PC.
- `DECISIONES.md` is the living decision log (why SQL Server over Postgres, why R2 over Cloudinary, the auth rewrite, the D-005 decimal bug, etc.) — check it for the reasoning behind non-obvious architectural choices before proposing to change them.
- `credenciales_tiendas.md` / `credenciales_motorizados.md` are gitignored and known stale (documented in `DECISIONES.md` D-006) — don't treat them as a source of truth for who has access.

## Migraciones pendientes de aplicar en producción

Ninguna por ahora.

`velox_agregar_aviso_observacion.sql` (`chk_notif_tipo` + `observacion` y columnas
`notificaciones.autor` / `detalle`, D-023) se aplicó en local y en producción el 18 de noviembre de
2026, con `sa` y antes del `git pull` a `bc30158` (confirmado por el usuario: terminó en OK).

`velox_agregar_asignada_en.sql` (columna `ordenes.asignada_en DATETIME2(0) NULL`, D-018) y
`velox_agregar_notificaciones_reasignaciones.sql` (tablas `reasignaciones` y `notificaciones`, D-020)
se aplicaron en local el 12 y el 14 de noviembre de 2026, y en producción el 14/11, en ese orden, con
`sa` y antes del `git pull` a `8a2cf5f` (confirmado por el usuario). Los dos scripts hacen `USE
velox_courier` y comprueban lo creado antes de decir OK (la primera versión de `asignada_en` imprimía
"creada" aunque el `ALTER` hubiera fallado, corrida en `master`): las migraciones nuevas, igual.

`velox_agregar_estado_anulado.sql` (agrega `anulado` a `chk_ordenes_estado`, D-014) se aplicó en local
el 6 de noviembre de 2026 y en producción antes del `git pull` a `c0f1312` (confirmado por el usuario).

`velox_agregar_fotos_pago_moto.sql` (foto del pago de la Caja de motorizados, D-012: tablas
`caja_liquidaciones_motorizados` y `caja_liquidaciones_motorizados_fotos` + columna
`caja_pagos_motorizados.id_liquidacion`) se aplicó en local el 5 de noviembre de 2026 y en producción
antes del `git pull` a `03f23a0` (confirmado por el usuario el 6 de noviembre de 2026).

`velox_agregar_fotos_pago_tienda.sql` (foto del pago de Caja Tienda, D-011: tablas
`caja_liquidaciones_tiendas` y `caja_liquidaciones_tiendas_fotos` + columna
`caja_pagos_tiendas.id_liquidacion`) se aplicó en local y en producción el 4 de noviembre de
2026, con `sa` y antes del `git pull` (confirmado por el usuario).

`velox_agregar_motivo_no_entrega.sql` (columna `ordenes.motivo_no_entrega NVARCHAR(300) NULL`,
para la vista del motorizado y `PATCH /ordenes/:id/resolver`) se aplicó en local el 28 de
octubre de 2026 y en producción después, con `sa` y antes del `git pull` (confirmado por el
usuario el 29 de octubre de 2026).

`velox_agregar_fecha_reparto.sql` (columna calculada `ordenes.fecha_reparto =
ISNULL(fecha_asignacion, fecha)` PERSISTED + índice `ix_ordenes_fecha_reparto`) se aplicó en
local el 23 de octubre de 2026 y en producción después (confirmado por el usuario el 27 de
octubre de 2026). `velox_agregar_fecha_asignacion.sql` (columna `ordenes.fecha_asignacion`, DATE NULL, que llena
`PATCH /:id/asignar`; la página Motorizados filtra por `ISNULL(fecha_asignacion, fecha)`) se
aplicó en local el 20 de octubre de 2026 y ya está aplicada en producción (confirmado por el
usuario el 22 de octubre de 2026). `velox_agregar_rafaga.sql` (tienda comodín `SIN DEFINIR`, columnas `ordenes.datos_pendientes`
y `ordenes.id_creacion`) se aplicó en el servidor el 20 de octubre de 2026. Las 4 anteriores
(`velox_agregar_medio_pago.sql`, `velox_agregar_concurrencia.sql`,
`velox_agregar_distrito_sin_definir.sql`, `velox_agregar_id_subida.sql`) se aplicaron el 16
de octubre de 2026.

Cuando haya una migración nueva, anotarla acá hasta que se aplique en el servidor. Como los
`velox_agregar_*.sql` están gitignored, no viajan con `git push`: hay que copiarlos al
servidor y correrlos a mano con `sqlcmd -I` y el usuario `sa` (`velox_user` no tiene
permisos de `ALTER`), **antes** del `git pull`.

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
6. **Al terminar cada parte, actualizar este `CLAUDE.md` sin que el usuario lo pida:** tablas o columnas nuevas, scripts, migraciones pendientes, decisiones tomadas y pendientes que quedan. Solo este archivo: `DECISIONES.md` se toca únicamente cuando el usuario lo pide.
7. **Commit en local, sin push, salvo que el usuario lo pida.** El usuario hace el `git push` y el deploy en el servidor (`git pull` + migraciones + `pm2 restart velox`). Commitear solo los archivos de la parte terminada, nunca con `git add -A`.

### CSS y estilos

- Si aparecen colores o fuentes hardcodeados sueltos en el HTML, o valores repetidos que deberían ser variables, avisar — pero no cambiarlos sin el OK del usuario.
- Respetar el archivo y la estructura de CSS que ya existe en el proyecto (`css/base.css`, `css/layout.css`, `css/components.css`, `css/tables.css`, `css/charts.css`, `css/detalle.css`, `css/detalle-ADICION.css`, `css/responsive.css`). No crear un sistema de estilos nuevo en paralelo sin preguntar antes.

### Reglas que no se rompen

- **Nunca** tocar la base de datos de producción desde aquí. Los cambios de esquema (`ALTER TABLE`, tablas nuevas) se aplican aparte en el servidor. Generar el script `.sql` de migración, **no** ejecutarlo contra producción.
- **Nunca** generar un `.bak` local para restaurarlo en el servidor: la BD local es SQL Server 2025 y producción es SQL Server 2022, y un backup de una versión nueva no se puede restaurar en una más vieja. Los cambios de BD en producción van **solo** con scripts `ALTER TABLE` / migración.
- **Nunca** subir al repositorio `server/.env`, `node_modules` ni archivos de credenciales — ya están en `.gitignore`, respetarlo.
- No reintroducir secretos hardcodeados en el código: contraseñas, tokens ni claves.
- El hashing de contraseñas (PBKDF2 en `routes/auth.js`) está correcto: no tocarlo.

### Fotos: un solo pipeline, siempre R2 (regla permanente)

**El usuario nunca espera a que la foto suba.** Capturar la foto y seguir trabajando es
instantáneo; la subida a R2 pasa en segundo plano por la cola. Todo punto de foto nuevo se
trabaja así:

- Se captura → se comprime (`comprimirImagenJPEG`) → `encolarFoto(...)` y el usuario sigue. El
  `await` de `encolarFoto` solo espera el guardado en IndexedDB (milisegundos), **nunca** la
  red: la subida arranca sin `await` dentro de `_colaAgregar`.
- La pantalla no muestra "Subiendo…" bloqueante, ni deshabilita botones, ni impide cerrar el
  modal o pasar a la siguiente orden mientras la foto sube. El estado de la subida lo muestra
  solo el indicador global (`js/indicador-fotos.js`). Si la pantalla necesita reaccionar cuando
  la foto llega (ej. refrescar un ícono), escucha `velox:foto-subida`, no espera.
- Si la foto tiene que estar asociada a una orden, la orden se crea/guarda primero (eso sí
  necesita señal) y la foto entra a la cola **después** de que ese guardado salió bien (como la
  evidencia en `js/motorizados.js`). Si la orden todavía no existe y tiene que poder crearse sin
  señal, seguir el modelo de la ráfaga (`encolarFotoRafaga`: la cola crea la orden y después
  sube la foto, con `idCreacion` para no duplicar).
- Para validar "hay foto" alcanza con que esté tomada (en memoria, ya subida o en la cola de ese
  teléfono); no exigir que ya esté en R2 (ver `evidencia_pendiente`).

R2 está activo en local y en producción y es el **almacenamiento oficial** de las fotos. Todo
punto de foto **nuevo**, en cualquier pantalla, reusa el **mismo** pipeline que ya usan la foto
del producto (`js/pedidos.js`) y la evidencia de pago (`js/motorizados.js`):

- **Frontend:** la cola de `js/cola-fotos.js` (`encolarFoto(ordenId, tipo, blob, codigoOrden)`):
  guarda en IndexedDB, sube en segundo plano con reintentos y sin duplicar (`idSubida`). Nada de
  `fetch` propio para subir la foto.
- **Backend:** la URL firmada a R2 de `server/r2.js` y el registro de la URL en `ordenes_fotos`
  (endpoints que ya usa la cola en `server/routes/ordenes.js`).
- **Una clase de foto nueva = un `tipo` nuevo** en `ordenes_fotos`: sumarlo a `TIPOS_FOTO` en
  `server/routes/ordenes.js` (y revisar quién puede verla en `puedeVerFotoOrden()`). No crear
  columnas, tablas ni rutas de subida aparte. **Única excepción acordada:** las fotos del pago de
  la Caja no son de una orden: van en `caja_liquidaciones_tiendas_fotos` (D-011) y
  `caja_liquidaciones_motorizados_fotos` (D-012), por la misma cola (destino opcional) y las mismas
  tres rutas bajo `/caja/tiendas/liquidaciones/:id/` y `/caja/motorizados/liquidaciones/:id/`.
- **Prohibido:** un mecanismo de almacenamiento nuevo, guardar fotos en otra tabla o columna,
  como base64 en la BD, en disco o en otro servicio. `server/almacenamiento-local.js` es solo el
  respaldo automático del mismo pipeline cuando faltan las variables `R2_*`; no se usa directo.

Así todas las fotos van a R2 automáticamente, con la misma cola, los mismos reintentos y el
mismo indicador (`js/indicador-fotos.js`).

### Despliegue (contexto — no ejecutar)

El despliegue lo hace el usuario manualmente: Claude deja los cambios commiteados en local (sin push, salvo que el usuario lo pida); el usuario hace `git push` desde la PC y, en el servidor, aplica las migraciones con `sa`, `git pull` y `pm2 restart velox` (ver "Production rules" arriba para el detalle completo). No hay acceso al servidor de producción desde aquí — nunca intentar desplegar ni conectarse a él.
