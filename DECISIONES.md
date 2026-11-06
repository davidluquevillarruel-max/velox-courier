# Registro de decisiones técnicas — Velox Courier

> Documento vivo. Cada decisión explica **qué se decidió**, **por qué**, y **qué la revierte**.
> Sirve también como contexto de arranque para Claude Code: si se copia a `CLAUDE.md`
> en la raíz del repo, la herramienta lo lee automáticamente al iniciar.
>
> Última actualización: 6 de noviembre de 2026

---

## Estado del proyecto

| Fase | Qué | Estado |
| --- | --- | --- |
| **1** | Infraestructura y despliegue (servidor, BD, SSL, dominio) | Completada |
| **2** | Autenticación y autorización server-side | Completada |
| **3** | Módulo de fotos (Cloudflare R2) | Completada — R2 activo en producción (27/10/2026) |
| **4** | Rotación de contraseñas + limpieza periódica + web institucional | Pendiente (la herramienta de reseteo ya está en producción, 29/10/2026) |

**El sistema está en producción y es seguro para repartir accesos.**
URL: `https://sistema.veloxcourierperu.com`

---

## Datos del servidor (producción)

| Elemento | Valor |
| --- | --- |
| Proveedor | DigitalOcean (Droplet `velox-prod`) |
| IP pública | `143.198.186.224` |
| Acceso | `ssh velox@143.198.186.224` (clave SSH) |
| SO | Ubuntu 22.04 LTS |
| BD | SQL Server 2022 Express, base `velox_courier` |
| App | Node 20 + PM2 (proceso `velox`) en `~/velox-courier/server` |
| Proxy | Nginx a 127.0.0.1:3000 |
| Repo | privado, con deploy key SSH de solo lectura |
| Usuarios SQL | `velox_user` (el de la app, **sin** permisos de `ALTER`) y `sa` (migraciones, backups y scripts de limpieza). Las contraseñas de `root`, `sa` y `velox` se resetearon en octubre de 2026; las guarda el usuario, **nunca** en el repo. |

### Flujo de actualización

```
# En la PC (desarrollo)
git add -A && git commit -m "..." && git push

# En el servidor (produccion)
cd ~/velox-courier && git pull && pm2 restart velox
```

**Los cambios de esquema de BD NO viajan por git.** Se aplican a mano en el servidor con
`sqlcmd` o con scripts de migracion versionados.

---

## REGLA CRÍTICA: la BD de producción es intocable desde la PC

Desde que el sistema tenga usuarios reales, las órdenes, pagos y estados ocurren **en el
servidor**. Reglas:

1. **Nunca** restaurar un `.bak` de la PC encima del servidor: borra los datos reales.
2. Para traer datos frescos a la PC, el backup va **del servidor hacia la PC**, no al revés.
3. La PC (`DESKTOP-E9N76IK`) es **desarrollo**; el servidor es **producción**. Son dos bases
   distintas que no se sincronizan.

> Excepción temporal (mientras NADIE use el sistema): se puede sobrescribir libremente.
> Esta excepción termina el día que se reparta la primera URL a una tienda o motorizado.

---

## D-001 · Servidor: Ubuntu 22.04 en DigitalOcean (no Windows)

**Estado:** Implementado.

**Premisa descartada.** El plan inicial asumía Windows porque "SQL Server solo corre en
Windows". Falso desde 2017: SQL Server 2022 corre en Ubuntu, RHEL y SUSE, y Express es gratis
también en Linux. Además, **DigitalOcean no vende Windows** ni admite imágenes Windows, así que
el plan original era directamente imposible de comprar.

**Decisión.** Droplet **Ubuntu 22.04 LTS**, Basic Regular, 2 vCPU / 4 GB / 80 GB SSD, NYC1.

- **22.04 y no 24.04:** SQL Server 2022 solo soporta hasta 22.04. En 24.04 `mssql-server` no instala.
- **4 GB y no 2 GB:** SQL Server pide 2 GB minimo + Express reserva hasta 1410 MB; con 2 GB no
  queda aire para Node y el SO.
- **NYC1:** DigitalOcean no tiene datacenter en Sudamérica; NY es lo más cercano a Lima (~80-100 ms).

---

## D-002 · Base de datos: SQL Server 2022 Express (no migrar a PostgreSQL)

**Estado:** Implementado. El `.bak` se restauró tal cual, sin cambios de código.

**Por qué no migrar.** El límite de Express (10 GB/base) no se roza: la BD crece ~480 MB/año y
con depuración a 12 meses se estabiliza bajo 1 GB. Migrar exigía reescribir 6 rutas, 5 vistas y
4 procedures, con riesgo en los cálculos de caja. Ahorro real de migrar: ~$6/mes. No compensa.

**Local:** 16.0.1000.6 (RTM). **Producción:** 16.0.4262.2 (CU25). Misma versión mayor, el `.bak`
restaura sin conversión.

**Ajuste aplicado:** `memory.memorylimitmb = 2560` (si no, SQL Server tomaría el 80 % de la RAM).

**Para proyectos NUEVOS:** PostgreSQL es mejor default (sin techo, gratis a escala). Cambia un
solo paquete: `mssql` a `pg`. Node y VS Code no cambian.

---

## D-003 · Fotos: Cloudflare R2, no Cloudinary (Fase 3, completada)

**Estado actual (27 de octubre de 2026): R2 activo en local y en producción.** Bucket
`velox-fotos`, las 5 variables `R2_*` en el `.env` de cada máquina, CORS configurado para los
dos orígenes. En producción, confirmado que las fotos suben a `pub-b64e...r2.dev/productos/`.
El modo prueba de abajo queda solo como respaldo si falta alguna variable.

**Regla permanente (27 de octubre de 2026): un solo pipeline de fotos, siempre R2.** Todo punto
de foto nuevo reusa el mismo camino que la foto del producto y la evidencia de pago: la cola de
`js/cola-fotos.js` (`encolarFoto`, IndexedDB + reintentos + `idSubida`), la URL firmada de
`server/r2.js` y el registro de la URL en `ordenes_fotos`. Una clase de foto nueva es solo un
`tipo` nuevo en `TIPOS_FOTO` (y revisar `puedeVerFotoOrden()`). No se crean mecanismos de
almacenamiento, tablas, columnas ni rutas de subida aparte, ni fotos en base64, en disco o en
otro servicio. **Por qué:** así todas las fotos heredan sin trabajo extra la tolerancia a señal
mala, la deduplicación, el indicador de la cola y el control de acceso, y hay un solo lugar donde
buscarlas. Detalle en `CLAUDE.md` → "Fotos: un solo pipeline, siempre R2".

**Historia:** Código implementado (server/r2.js, rutas POST /api/ordenes/:id/evidencia/presigned
y PATCH /api/ordenes/:id/medio-pago, tabla `ordenes_fotos`, subida y compresión en el modal
"Actualizar orden"). **Falta crear el bucket R2 y sus credenciales** — hasta entonces, esas
rutas responden un error claro en vez de fallar. Variables que hay que agregar a `server/.env`
cuando el bucket esté listo: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_BUCKET`, `R2_PUBLIC_URL`. También hay que configurar CORS en el bucket para aceptar PUT
desde `http://localhost:3000` y `https://sistema.veloxcourierperu.com`.

**Modo prueba mientras no exista el bucket:** `server/almacenamiento-local.js` guarda las
fotos en `server/uploads_local/` (gitignored) y se sirven por
`GET /api/ordenes/:id/foto/:fotoId` validando sesión. Es una desviación consciente del
diseño de abajo (acá el archivo SÍ pasa por el servidor) para poder probar el flujo
completo. El código prefiere R2 en cuanto `r2Habilitado()` da true; las fotos guardadas
en modo prueba quedan como URLs locales y **no se migran solas**.

**Dos clases de foto**, distinguidas por `ordenes_fotos.tipo`: `foto_producto` (la que se
toma al crear la orden, flujo rápido con cámara) y `evidencia_medio_pago` (la que exigen
los medios de pago "pago tienda" y "pago Velox").

**Captura:** `getUserMedia` con vista en vivo, que funciona igual en PC (webcam) y celular
(cámara trasera). Antes se usaba `<input capture="environment">`, pero las PC ignoran ese
atributo y siempre abrían el explorador de archivos. `getUserMedia` exige HTTPS o
localhost: si se entra desde el celular por `http://IP:3000` el navegador la bloquea, y
ahí sí cae al input con `capture`, que en celular abre la cámara nativa.

**Volumen real:** 4-5 fotos x 500 pedidos/día = ~2,250/día = ~810,000 almacenadas (retención 12 meses).

**Cloudinary NO sirve:** su plan Free son 25 créditos/mes (1 crédito = 1 GB storage O 1 GB
bandwidth O 1000 transformaciones), y el storage es acumulativo. Con este volumen consume
~305 créditos/mes, requiere plan Advanced (**$224/mes**). Además, al pasarse suspende la cuenta.

**Cloudflare R2:** storage $0.015/GB-mes (10 GB gratis), operaciones dentro del free tier,
**egress siempre gratis** (clave con 200 tiendas mirando fotos). Costo estimado: **~$2.90/mes**.
R2 es ~77x más barato.

**Arquitectura (sin cambios respecto al diseño original):** celular a R2 directo (presigned PUT,
S3-compatible), devuelve URL, la API guarda la URL en tabla `ordenes_fotos`. El servidor nunca
toca la foto.

**Requisito no negociable:** comprimir en el cliente antes de subir (`canvas.toBlob()`, ~1280px,
calidad 0.7 = ~250 KB). Sin compresión, cualquier proveedor sale caro.

**Cómo se suben hoy:** ya no se suben al momento de elegirlas, sino por la cola de fotos
del celular, con reintentos (ver D-008). El camino a R2 (presigned PUT directo) no cambió.

---

## D-004 · Autenticación server-side — COMPLETADA

**Estado:** Implementado y desplegado en producción (17/07/2026).

**Problema que había.** El sistema no tenía autorización en el servidor. Todas las rutas eran
públicas; el login solo guardaba el usuario en `localStorage` y los permisos se aplicaban
ocultando divs. Cualquiera con la URL podía leer la caja de todas las tiendas o cambiar la
contraseña del admin desde la consola del navegador.

**Lo implementado:**

1. **`server/middleware/auth.js`** — JWT en cookie `httpOnly`. El token solo guarda el `uid`;
   rol/tienda/motorizado/activo se leen de la BD en CADA petición (desactivar un usuario lo
   deja fuera al instante).
2. **6 rutas protegidas** (`auth, ordenes, tiendas, motorizados, tarifas, caja`) con
   `requireAuth` + `requireRol`.
3. **Filtrado por rol server-side:** una tienda solo ve sus órdenes, un motorizado las suyas.
   El alcance sale de la sesión, no de parámetros del cliente.
4. **Caja** restringida por completo a `admin` / `operador`.
5. **Freno a fuerza bruta:** 10 intentos por IP cada 15 min.
6. **`PATCH /password`:** admin puede resetear; los demás solo la propia y con contraseña actual.
7. **Frontend:** `login.js` valida sesión contra `/auth/me`; interceptor global de `fetch` en
   `utils.js` (manda cookie + redirige a login en 401); `cerrarSesion()` llama a `/auth/logout`.
8. **CORS restringido** a `localhost:3000` y `sistema.veloxcourierperu.com`.
9. **Clave de eliminación** sacada del cliente (era `AlexVelox2026!` hardcodeada en
   `validators.js`). Ahora se confirma escribiendo el nombre del registro; la seguridad real la
   da `requireRol('admin')` en el backend.
10. **Usuario de BD dedicado** `velox_app` (db_datareader + db_datawriter + EXECUTE), en vez de
    `SA`. Si se filtrara, el daño queda contenido a `velox_courier`.

**Hashing:** PBKDF2, 100k iteraciones, SHA-512, salt de 16 bytes. Correcto, no se tocó.

**Lo que NO se subió nunca al repo:** `server/.env` (bloqueado por `.gitignore`), con
`DB_PASSWORD` (de `velox_app`) y `JWT_SECRET`. El `JWT_SECRET` de producción es distinto al de la PC.

---

## D-005 · Bug de decimales — CORREGIDO

`sql.Decimal` sin precisión usa `(18,0)`, o sea 0 decimales. Un delivery de `S/ 7.50` se guardaba
como `8`. Corregido a **`sql.Decimal(10,2)`** en todos los `.input()` de montos de `ordenes.js`,
`tarifas.js` y `caja.js`. Aplica solo a registros nuevos; los ya guardados no se tocaron.

---

## D-006 · Usuarios: 108 reales, no 177

**Estado:** Verificado. No es un error de la restauración.

La BD tiene **1 admin + 18 motorizados + 89 tiendas = 108** usuarios (confirmado idéntico en
local y producción). Los archivos `credenciales_tiendas.md` (160 filas) y
`credenciales_motorizados.md` NO reflejan la BD: se generaron desde la lista de tiendas, no de
los usuarios creados. **Están desactualizados y deben borrarse al rotar contraseñas.**

Hay 236 tiendas en la tabla pero solo 89 con usuario de acceso. Desde el 29/10/2026 (en
producción) los accesos se crean desde la página "Tiendas" ("Crear accesos faltantes" / "Crear
acceso"), con contraseña aleatoria mostrada una sola vez; el botón viejo de contraseña de fórmula
se borró.

---

## D-007 · Rotación de contraseñas (Fase 4, pendiente)

**Estado:** Pendiente, ya NO urgente.

Las 108 contraseñas se derivan del nombre (`AlizzeVelox2026!`) y la del SA está en el historial
de git. **Deben rotarse**, pero el riesgo bajó mucho tras la Fase 2: las rutas ya no se exponen
(todo pide sesión) y hay freno a fuerza bruta.

**Cuándo hacerlo:** cuando el cliente decida a qué tiendas dar acceso (no vale la pena rotar 108
si solo 30 van a usar el sistema). Al hacerlo: contraseñas aleatorias, no derivadas del nombre;
entregar una sola vez y forzar cambio en el primer login; borrar los `.md` de credenciales.

**Además rotar:** la contraseña del `SA` de SQL Server (se escribió en un chat).

**Herramienta lista (29/10/2026, en producción, commit `7cba834`):** "Resetear contraseñas" en
Tiendas y en Usuarios (solo admin, por fila o en masa) pone a cada usuario una contraseña
aleatoria de 12 caracteres y la muestra una sola vez con Copiar / CSV. Para la Fase 4 alcanza con
elegir las tiendas que van a usar el sistema y resetearlas. Falta todavía:
- **Sacar el secreto de `server/db.js`** (`DB_PASSWORD || 'Velox2026!'`): sin valor por defecto, y
  rotar esa contraseña en el servidor porque está en el historial de git.
- Opcional: que el reseteo corte las sesiones abiertas (hoy siguen hasta 12 h); necesita migración.
- "Forzar cambio en el primer login" no está hecho (también necesitaría una columna nueva).

---

## D-008 · Cola de subida de fotos (señal inestable en la calle)

**Estado:** Implementado en local (octubre 2026), sin probar todavía en el navegador. Requiere
la migración `velox_agregar_id_subida.sql` (pendiente en producción).

**Problema.** El motorizado saca la foto en la calle, con señal que va y viene. Antes la foto
se subía una sola vez: si fallaba, se perdía (foto del producto) o el motorizado no podía
guardar la orden (evidencia del medio de pago, que además exigía estar subida antes de
guardar).

**Decisión: guardar primero en el teléfono, subir después** (`js/cola-fotos.js`).

- La foto se guarda en **IndexedDB** (nativo del navegador, sin librerías) antes de cualquier
  intento de red, y se sube de a una, en segundo plano. Se guarda como `ArrayBuffer`, no
  `Blob`, porque algunos Safari viejos no guardan Blobs en IndexedDB. Si IndexedDB falla
  (ej. incógnito), queda en memoria y se avisa que no se cierre la app.
- **Cuándo reintenta:** al encolar, al volver la conexión (`online`), al volver la app a
  primer plano (`visibilitychange`), al reabrir Velox, y con esperas de 5 s, 15 s, 30 s,
  60 s y luego cada 2 min. Cada pedido tiene tiempo máximo (30 s / 90 s) para no quedar
  colgado con señal mala. No se confía en `navigator.onLine` para decidir: manda el
  resultado del intento.
- **Errores:** 401 pausa la cola hasta el próximo login; 400/403/404/409/413/415 dejan la
  foto "con error" sin reintento automático (se reintenta o descarta a mano desde el
  indicador); todo lo demás se trata como falta de señal.
- **Sin duplicados:** cada foto lleva un `idSubida` (UUID) generado en el teléfono. Columna
  `ordenes_fotos.id_subida` con índice único filtrado: si un reintento llega después de que la
  foto ya se guardó (la respuesta se perdió), el servidor devuelve la existente (200) en vez
  de insertar otra. Con R2, el nombre del objeto sale de ese id, así los reintentos pisan el
  mismo archivo en vez de dejar huérfanos.
- **R2 o modo prueba sin cambiar código:** la URL firmada se pide en cada intento (vencen a
  los 5 min, no se guardan); con 503 (R2 sin configurar) la foto va al disco local.
- **Evidencia pendiente (decisión del usuario):** `PATCH /medio-pago` ya no exige la foto al
  guardar "Pago tienda" / "Pago Velox". La pantalla pide que la foto esté *tomada* (en
  memoria, ya subida o en la cola del teléfono), no subida. Mientras no llegue, la orden
  figura con `evidencia_pendiente = 1` (calculado en SQL, sin columna nueva) y las listas lo
  marcan. La evidencia entra a la cola recién cuando los PATCH de la orden salieron bien, para
  no subir fotos de un medio de pago que no se guardó.
- **Indicador visible** (`js/indicador-fotos.js`): pastilla fija con las fotos que faltan
  subir, panel con "Reintentar ahora" y "Descartar".

**Límites aceptados.** Con la pantalla bloqueada o el navegador cerrado el JavaScript no
corre: la foto queda guardada y sale cuando la app vuelve a estar activa, no antes. Guardar o
crear la orden sigue necesitando señal en ese momento (lo que se encola es la foto, no la
orden: encolar órdenes completas trae duplicados y conflictos).

**Descartado por ahora: Background Sync** (service worker). Solo existe en Chrome Android,
el navegador decide cuándo correrlo y agrega otra capa; queda como mejora opcional.

---

## D-009 · Fecha de reparto: la Caja y las listas van por el día de entrega, no por el de creación

**Estado:** Implementado (23 de octubre de 2026) y en producción: migración
`velox_agregar_fecha_reparto.sql` aplicada en el servidor + `git pull` (confirmado por el
usuario el 27 de octubre de 2026). En el mismo deploy se limpiaron las órdenes de producción y
se importaron las 274 reales del 20/10/2026 (ids 1–274).

**Problema.** Todo el sistema agrupaba por `ordenes.fecha` (el día en que se creó la orden),
salvo la página Motorizados. Una orden creada el 20, reprogramada y entregada el 21 cobraba en
el 20: el día de la Caja no coincidía con el día en que pasó la plata, y podía caer en un día ya
marcado pagado.

**Decisión: una sola "fecha de reparto"** = `ISNULL(fecha_asignacion, fecha)`, como columna
calculada `PERSISTED` con índice (la regla vive en un solo lugar en vez de repetirse en ~15
consultas). Asignada → el día de reparto elegido; sin asignar → el de creación. `fecha` queda
como dato histórico y no se toca. La usan "Todos los pedidos", Motorizados, toda la Caja
(incluido el prepago, por decisión del usuario), Clientes y el dashboard.

- **Elegir el día al asignar** (`PATCH /asignar`, `fechaReparto`, solo gestores): desde la
  creación hasta hoy + 7 (se permiten días pasados, para cargar tarde un reparto ya hecho). Sin
  fecha se conserva la que tenía: pasar una orden a otro motorizado ya no la mueve a hoy.
- **Días ya pagados en la Caja: se bloquea** mover (de día o de motorizado) una orden que suma en
  la Caja si el día de origen o de destino ya está pagado para esa tienda o motorizado. No se
  bloquea lo que no suma (reprogramadas, en proceso), porque no cambia ningún monto pagado.
- **Descartado: repetir `ISNULL(...)` en cada consulta** (sin migración). Era más rápido de
  subir, pero cualquier cambio de la regla habría que acordarse de hacerlo en todos lados.

**Límites aceptados.** El bloqueo de días pagados se revisa antes del UPDATE, no en la misma
transacción (dos gestores al mismo instante podrían colarlo; es improbable). Cambiar el
*estado* de una orden en un día ya pagado sigue sin bloquearse, como antes (no es parte de este
cambio). Al confirmar la devolución de una reprogramada vuelve a su día de creación hasta que se
reasigne, como pidió el usuario: el día del intento fallido no guarda rastro de ella.

---

## D-010 · Asignar rápido por la foto sin descuadrar la Caja (y "Subir imagen" en las cámaras)

**Estado:** Implementado el 3 de noviembre de 2026 (commits `6d1a986` y `0347988`). Sin
migración. En producción desde el 3 de noviembre de 2026 (`git pull` + `pm2 restart velox`,
confirmado por el usuario; último commit `7996d0e`).

**Problema.** Cuando llegan muchos pedidos de golpe se cargan con la ráfaga ⚡: cada foto crea una
orden con su tienda y el resto de los datos (cliente, distrito, monto) se completa después en
"Pendiente". Hasta ahora esas órdenes **no se podían asignar** hasta completarlas, aunque los
motorizados se guían por cómo se ve el paquete y podrían salir antes. Además, si la cámara del
teléfono falla, no había forma de cargar una foto que ya está en la galería.

**Decisión 1: una orden pendiente se puede asignar con tienda real + foto.**
- "Asignable" = no pendiente (como siempre, con o sin foto) **o** pendiente con tienda real
  (no el comodín `SIN DEFINIR`) y foto del producto. La regla vive en un solo lugar
  (`SQL_ASIGNABLE` en `server/routes/ordenes.js`) y la usan la lista de Asignación, el filtro del
  motorizado (`filtroAsignacion`, para que vea y se autoasigne las mismas) y `PATCH /asignar`.
- **Asignar no la completa:** la marca `datos_pendientes` depende solo de los datos, no del
  motorizado. Sigue en "Pendiente" (con "Asignada a X", para completar primero las que ya están
  en ruta) y con "Por completar" hasta que la oficina carga los datos.
- **"Autoasignar todos" no las reparte:** sin distrito no hay zona; se asignan a mano, por la foto.

**Decisión 2: una orden pendiente no se puede cerrar** (entregada, ausente, cancelada,
reprogramada, no entregada) hasta completar sus datos: `/resolver` y `/estado` responden 400.
**Por qué:** el delivery y el pago al motorizado salen de la tarifa del distrito, y el cobrado lo
carga la oficina. Una orden de ráfaga sin completar tiene todo en 0 y método "sin cobro": si se
cerrara así, la Caja de ese día contaría ceros (la tienda no pagaría el delivery, el motorizado no
cobraría, una contraentrega no figuraría y ni siquiera se preguntaría cómo se cobró), y al
completarla después los montos cambiarían en un día que quizás ya está pagado (ni
`completar-datos` ni `/completo` revisan días pagados). Así, la orden sale a la calle enseguida
pero no entra a la Caja hasta tener sus datos. El motorizado la ve en "Mis entregas de hoy" sin
EMPEZAR ("Faltan datos: la oficina los está completando"); al completarse, el botón aparece solo.
- **Descartado: dejar cerrarla y completar después.** Habría obligado a definir cómo se registra
  el cobro sin monto y a recalcular la Caja de días ya pagados.

**Decisión 3: "Subir imagen" en todas las cámaras.** Además de "Tomar foto": la cámara azul
("Nueva orden"), la ráfaga (varias imágenes de la galería de una vez, cada una crea su orden con
la tienda de la ráfaga) y, desde el 2/11, todas las fotos de "Mis entregas de hoy". Mismo
pipeline de siempre (compresión → cola `js/cola-fotos.js` → R2 en segundo plano), sin nada nuevo
de almacenamiento (ver D-003 y D-008). Si la cámara en vivo no abre, el visor queda abierto con
un aviso y las dos opciones, en vez de cerrarse.

**Límites aceptados.** Una orden pendiente asignada no tiene dirección ni teléfono hasta que la
oficina los completa: el motorizado depende de que se carguen mientras está en ruta. Las órdenes
de la cámara azul (distrito `SIN DEFINIR` pero no pendientes) se siguen pudiendo cerrar como
antes: no son parte de este cambio.

---

## D-011 · Foto del pago en "Marcar pagado" de Caja Tienda (liquidaciones)

**Estado:** HECHO en producción desde el 4 de noviembre de 2026 (confirmado por el usuario;
cambio en `5d9e9c0`, último commit `e07d53e`). Migración
`velox_agregar_fotos_pago_tienda.sql` aplicada con `sa` en local y en producción, antes del
`git pull`.

**Problema.** "Marcar pagado" liquida en un solo acto varios días de una tienda, y no quedaba
ninguna prueba de que el pago se hizo (voucher, Yape, efectivo). `caja_pagos_tiendas` guarda una
fila por día, así que no había dónde colgar las fotos de *ese* acto.

**Decisión.**
- **Liquidación como entidad propia:** tabla `caja_liquidaciones_tiendas` (tienda, período
  filtrado, días, totales, fecha de pago en Lima, quién, `fotos_declaradas`). Cada día liquidado
  apunta a ella (`caja_pagos_tiendas.id_liquidacion`). Las fotos van en
  `caja_liquidaciones_tiendas_fotos` (url + `id_subida` con índice único filtrado, como
  `ordenes_fotos`).
- **Mismo pipeline de fotos (D-003, D-008):** la cola de `js/cola-fotos.js` acepta un destino
  opcional (`encolarFotoPagoTienda`) y sube por las mismas tres rutas (URL firmada → PUT a R2 →
  registrar; disco en modo prueba) colgadas de `/caja/tiendas/liquidaciones/:id/` en vez de
  `/ordenes/:id/`. Carpeta R2 `pagos-tienda/liquidacion-<id>/`. Reintentos, `idSubida`,
  indicador y retomar al volver la señal: lo de siempre.
- **Orden del flujo:** foto (mín. 1, hasta 5) → confirmación de días + monto → `POST /pagar`
  (crea la liquidación; necesita señal) → recién ahí las fotos entran a la cola. La liquidación
  no espera la subida; mientras falten, el historial dice "N fotos por subir".
- `/pagar` ahora es una transacción con bloqueo por día: si otro usuario liquidó un día en el
  medio, se deshace todo y responde 409 (antes pisaba el pago).

**Por qué una tabla aparte y no `ordenes_fotos`:** la regla de fotos pide "un tipo nuevo en
`ordenes_fotos`", pero `id_orden` es obligatorio (FK a `ordenes`) y un pago no es de ninguna
orden. Colgarlo de una orden cualquiera de la tienda mezclaría las fotos con las del producto y
se rompería si esa orden se edita. Excepción acordada con el usuario el 4/11; el almacenamiento
y la subida siguen siendo los únicos que hay (R2 + cola).

**Límites aceptados.** Los días pagados antes de esto no tienen liquidación ni fotos. Las fotos
solo las ven los gestores (todo `/caja` es admin/operador).

---

## D-012 · Las cajas leen de un solo motor; la Caja de motorizados cuenta solo lo que pasó por sus manos

**Estado:** HECHO en producción desde el 6 de noviembre de 2026 (confirmado por el usuario; cambios en
`b50d396`, `933e6e4`, `9178ac6`, último commit `03f23a0`). Migración
`velox_agregar_fotos_pago_moto.sql` aplicada en local y en producción, antes del `git pull`.

**Problema.** Caja Tienda ya tenía su regla (D-011 y la reescritura del 4/11), pero Liquidez, Caja
real y Motorizados seguían con la vieja y no coincidían. Con los datos locales, Liquidez daba un
"líquido neto" de −3178.40: restaba la plata del producto sin haberla sumado nunca. La ganancia real
es 741.50. A los motos se les contaba toda la plata cobrada, incluso los pedidos con Pago tienda
(S/ 1097) que nunca pasaron por sus manos.

**Decisión.**
- **Un solo motor** (`server/caja-motor.js`), una función por pedido de la que leen las cajas. Sin
  sesión ni roles, para que lo usen después las vistas de la tienda y del moto.
- **Saldo del moto = solo la plata que pasó por sus manos.** Efectivo y Yape al moto (el Yape llega a
  su celular y lo rinde completo). Pago Velox fue directo a Velox; Pago tienda, a la tienda.
- **El moto cobra en los tres estados cobrables** (entregado, ausente, devolución): en los tres hizo
  el viaje, igual que a la tienda se le cobra el delivery.
- **Vías = cómo pagó el cliente.** Efectivo moto, Yape moto, Pago Velox (depósito) y prepago según su
  método. Pago tienda no cuenta. Lo que las tiendas le pagan a Velox al liquidar no entra, porque
  sería doble conteo.
- **Lo ya pagado se respeta.** Los días pagados muestran el saldo guardado; si los pedidos de hoy
  dan otra cosa, "Difiere de lo pagado". La regla nueva solo aplica a lo pendiente. Esto también
  cambió Caja Tienda, que guardaba el monto pero lo recalculaba al mostrarlo.
- **Caja real va por fecha de pago**, porque es cuándo cambió de mano la plata; Pago Velox y prepagos
  no tienen otra fecha que la de reparto. Liquidez queda teórica, en vivo y por fecha de reparto.
- **Foto obligatoria al liquidar al moto** (1 a 5), con la misma estructura y pipeline que D-011.
  Segunda excepción acordada a "un tipo nuevo en `ordenes_fotos`", por el mismo motivo: un pago no
  es de una orden. `monto_efectivo` y `monto_yape` se guardan en la liquidación, para que las vías de
  Caja real no dependan de órdenes que se editen después.
- **Control de cuadre:** saldo motos + saldo tiendas + Pago Velox + prepagos = delivery − pago a
  motos. Orden por orden siempre cierra, así que no prueba el cálculo: detecta lo que se pierde al
  armar las cajas (filtros, JOIN, cobrables sin moto). Es en vivo; los montos guardados no entran.

**Decisiones del camino.**
- **Días con órdenes en proceso no se liquidan al moto.** Si se liquidaran, `/resolver` le rechazaría
  cerrarlas y la Caja no tiene "desmarcar". La confirmación avisa cuáles quedan afuera.
- **Devolución tardía no se bloquea por el día pagado del moto.** Un cancelado suele volver a la
  tienda días después de liquidarlo; bloquearlo lo dejaría trabado para siempre. Lo pagado no cambia,
  el día queda "Difiere" y ese viaje se resuelve a mano. El bloqueo por el día de la tienda sigue.
- **Prepagos de órdenes no cobrables** (en proceso, canceladas): esa plata entró, cuentan en Caja
  real en línea aparte, fuera del cuadre.
- **Días viejos del moto en Caja real:** su `monto_cobrado` ya incluía Pago Velox (regla vieja), así
  que ese Pago Velox no se vuelve a sumar por pedido; y como no guardaron la vía, van "sin desglose".

**Descartado: guardar el detalle por pedido de cada liquidación.** Mostraría los días pagados tal
cual se pagaron, pero es mucha más estructura. Lo guardado es por día; el detalle es en vivo y avisa
si difiere.

**Límites aceptados.** `/estado`, `/completo` y `/medio-pago` no bloquean por día pagado (lo pagado no
cambia y queda "Difiere"). Las fechas de pago viejas de motos, en UTC, no se corrigieron. "Marcar
pagado" de tiendas sigue liquidando días con órdenes en proceso. Clientes / Tiendas sigue con la regla
vieja.

---

## D-013 · El motorizado solo ve sus órdenes; las sin asignar, solo en Asignación

**Estado:** HECHO en producción desde el 6 de noviembre de 2026 (confirmado por el usuario; cambio en
`727186d`, último commit `03f23a0`). Sin migración.

**Problema.** `filtroPorRol()` le sumaba al motorizado las órdenes sin asignar para que pudiera
autoasignarse, pero ese filtro lo usan todos sus listados: aparecían en "Mis entregas de hoy" con
EMPEZAR, contaban en Evidencias y podía abrirlas por id. Venía desde `1170378` (septiembre), no del
cambio de autoasignar del 3/11, que solo tocó qué órdenes con datos pendientes entraban.

**Decisión.** Dos filtros, porque son dos preguntas distintas:
- `filtroPorRol()`: el motorizado ve solo `id_motorizado = él`, tomado de la sesión. Lo usan
  `GET /ordenes` y `GET /ordenes/:id`.
- `filtroAsignacion()`: las suyas + las sin asignar asignables, nunca las de otro. Solo lo usa
  `GET /ordenes/para-asignacion`, que alimenta la pantalla Asignación. La tienda recibe 403.

**Descartado: filtrar las sin asignar en cada pantalla.** El servidor las seguiría mandando, y el
alcance por rol tiene que resolverse en el servidor.

**Efecto aceptado.** En su gestión ve todas sus órdenes, aunque les falten datos y no tengan foto;
antes esas quedaban ocultas. No se pueden cerrar con datos pendientes, y salen con "Faltan datos".
Los motorizados con la pestaña vieja abierta ven Asignación sin pendientes hasta que recargan.

---

## D-014 · Estado `anulado`: override del admin que cuenta cero, sin borrar la orden

**Estado:** Implementado en local el 6 de noviembre de 2026; falta que el usuario lo pruebe y el
deploy. Migración `velox_agregar_estado_anulado.sql` aplicada solo en local.

**Problema.** No había forma de sacar de circulación una orden cargada por error sin borrarla ni
dejarla sumando en las cajas.

**Decisión.**
- **Solo el admin**, validado en el servidor, y **desde cualquier estado**: incluso entregada, con
  datos pendientes o con el día pagado. Se guarda directo, sin pedir ningún campo. Solo cambia el
  estado, para que la orden quede como prueba de cómo estaba.
- **Cuenta cero en todas las cajas.** No está entre los cobrables, y en Caja real su prepago tampoco
  cuenta, aunque esa plata haya entrado: queda como registro en "Todos los pedidos" y el reembolso es
  manual (decisión del usuario, 6/11).
- **Sale de todo lo operativo:** Asignación, vista del motorizado, tienda y Clientes, "Pendiente",
  devoluciones y Evidencias. Solo se ve en "Todos los pedidos", con la etiqueta "Anulado".
- **No bloquea por lo ya pagado:** el monto guardado no cambia, el día queda "Difiere de lo pagado" y
  el recupero es manual.
- **Se puede volver atrás,** solo el admin, desde "Actualizar orden" (decisión del usuario, 6/11). No
  recuerda el estado anterior: el admin elige a cuál vuelve. Volver atrás pasa por las validaciones
  de siempre del formulario y por la regla de que una orden con datos pendientes no se cierra.

**Decisiones del camino.**
- **La tienda tampoco ve sus anuladas.** "Todos los pedidos" no existe para ese rol, así que para ella
  la orden desaparece de Clientes.
- **Los gestores tampoco la ven en el detalle de un motorizado**, para que coincida con su caja.
- **Una anulada no entra al circuito de devoluciones, ni para el admin:** primero hay que cambiarle el
  estado.
- **Una foto que ya estaba en la cola termina de subir:** rechazarla la dejaría "con error" en el
  teléfono del motorizado, y sirve como registro.

**Límites aceptados.** Si el motorizado tiene la pantalla abierta al anularse la orden, se entera al
intentar cerrarla o en el próximo refresco. Mientras la orden siga anulada, los cambios del formulario
que no sean el estado no se guardan.

---

## Costos de operación

| Concepto | Mensual |
| --- | --- |
| Droplet (2 vCPU / 4 GB) | $24.00 |
| IGV Perú 18 % (DigitalOcean, desde 01/06/2026) | $4.32 |
| Dominio Namecheap ($6.99/año) | $0.58 |
| Ubuntu + SQL Server Express + SSL + Node + PM2 + Nginx | $0.00 |
| Cloudflare R2 (activo desde oct-2026; estimado con volumen pleno) | ~$2.90 |
| **Total con fotos** | **~$31.80** |

- Facturación por hora, tope 672 h/mes, un mes de 31 días cuesta igual que uno de 28.
- Pospago: se cobra el día 1 por el mes anterior. Sin prepago ni permanencia.
- Con RUC cargado en DO se quita el IGV (útil al traspasar al cliente).

**Traspaso al cliente:** como es pospago, no se pierde "mes pagado". Opción recomendada:
cambiar email + tarjeta de la cuenta DO por los del cliente (mismo Droplet, misma IP, sin
downtime). El dominio se traspasa aparte en Namecheap.

---

## Pendientes varios

- [ ] **Namecheap AUTO-RENEW:** está activado; en jul-2027 cobra a precio de lista (no los $6.99
      con cupón). Revisar según se prefiera.
- [ ] **2FA en Namecheap:** activar (la cuenta controla el dominio).
- [ ] **Cambiar contraseña del admin** desde el propio sistema (ahora que el flujo es seguro).
- [ ] **Monitoreo:** alertas de DigitalOcean por RAM > 85 % y disco > 80 %.
- [ ] **Caja:** las 3 cajas (D-012) y el fix del motorizado (D-013) ya están en producción.
      Clientes / Tiendas sigue con la regla
      vieja; las vistas de la tienda y del moto, próximo paso. Detalle en `CLAUDE.md` → "Pendiente".
- [x] **Rediseño de la vista del motorizado** ("Mis entregas de hoy": botón EMPEZAR + flujo
      de entrega con fotos por el pipeline único de D-003). **Desplegado en producción** el
      28–29/10/2026 junto con las fotos de devolución y la foto del pago con Efectivo +
      "Subir imagen" desde la galería (último commit `a0b71c8`; migración
      `velox_agregar_motivo_no_entrega.sql` aplicada en el servidor). Falta probarlo a fondo
      en el celular real; etapa 2 opcional: cerrar la orden sin señal.
- [x] **Catálogo de tiendas y usuarios de acceso.** **Desplegado en producción** el 29/10/2026
      (último commit `7cba834`, sin migración): página "Tiendas" (alta, edición, desactivar /
      reactivar), crear accesos y resetear contraseñas (por fila o en masa, contraseña
      aleatoria mostrada una vez), filtro de activos en selecciones y servidor, y "Mostrar
      inactivos" en los filtros de las tablas.
- [ ] **Fase 4:** rotar las 89 contraseñas de fórmula de las tiendas (con "Resetear
      contraseñas") y sacar el secreto de `server/db.js`. Ver D-007.
- [ ] **Opcional:** cortar las sesiones abiertas al resetear una contraseña (necesita
      migración). Ver D-007.
