# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Velox Courier — internal management system for a courier/delivery company in Lima, Peru. Vanilla JS SPA frontend + Express/SQL Server REST API backend. No build step, no framework, no bundler — everything is served as static files by the same Express process that serves the API.

**The system is live in production** with real stores and delivery riders (motorizados) using it daily. See "Production rules" below before touching anything database- or deploy-related.

## Estado actual

Última actualización: 10 de noviembre de 2026.

- **Reglas de trabajo nuevas (10 de noviembre de 2026).** Actualizar este `CLAUDE.md` al terminar
  cada parte sin que lo pidan, y commit en local sin push (ver "Cómo trabajar", puntos 6 y 7).
  `server/scripts/limpiar_ordenes.sql` quedó marcado OBSOLETO: el vigente es `limpiar_ordenes_y_caja.sql`.

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
    masivo viejo de contraseña de fórmula (nombre + `Velox2026!`): los 89 usuarios de tienda que ya
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
    COMPLETAR / OTROS / DETALLE. Al cerrar una orden abre directo la siguiente ("← Lista" para
    volver); lo llenado queda en memoria por orden mientras no se cierre.
  - **COMPLETAR** (entregado): foto de entrega siempre; foto del cambio si la orden tiene
    condición especial (reemplaza "Recibido": con esa foto, "Actualizar orden" ya no lo pide); en
    contraentrega, cómo se cobró y foto del pago con cualquier medio, efectivo incluido
    (`_ENT_MEDIOS_CON_FOTO`; en "Actualizar orden" sigue pidiéndose solo con Pago tienda / Pago
    Velox).
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
  - "Actualizar orden" tiene un bloque "Fotos del motorizado" (cada foto en su grupo + el motivo
    del último intento). `GET /ordenes/:id` devuelve `fotos` (todas las que ese rol puede ver;
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
  encabezado `content-type`: el navegador sube directo a R2 desde `js/cola-fotos.js`).
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
  (probado ida y vuelta). Sin librerías: el `.xlsx` es un zip sin comprimir armado a mano
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
- **El cuadre de las cajas** se revisa con `node scripts/verificar-cuadre-cajas.js` (desde `server/`).
- **Importador de Excel:** `server/scripts/importar-ordenes-excel.js` todavía arranca en 1000. Con la
  base vacía, sus órdenes saldrían desde C-1001, y las siguientes seguirían desde ahí. Cambiarlo antes
  de importar.
- **Fotos huérfanas en R2:** la limpieza del 7/11 borró las filas, no los archivos del bucket.
- **Clientes / Tiendas sigue con la regla vieja** (`server/routes/tiendas.js:119`: entregado /
  ausente). Quedó fuera de las 3 cajas.
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
  - Rotar las **89 contraseñas de fórmula** de los usuarios de tienda (nombre + `Velox2026!`): ya
    se puede con Tiendas → "Resetear contraseñas" (en masa, buscador vacío → Todas) y entregar el
    CSV. Conviene hacerlo cuando se decida a qué tiendas se les da acceso.
  - **Sacar el secreto de `server/db.js`:** tiene `process.env.DB_PASSWORD || 'Velox2026!'` como
    respaldo. Quitar el valor por defecto (que falle claro si falta la variable) y, como esa
    contraseña quedó en el historial de git, rotarla en el servidor. Rotar también la del `sa`.
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
