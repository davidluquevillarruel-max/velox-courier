# Registro de decisiones técnicas — Velox Courier

> Documento vivo. Cada decisión explica **qué se decidió**, **por qué**, y **qué la revierte**.
> Sirve también como contexto de arranque para Claude Code: si se copia a `CLAUDE.md`
> en la raíz del repo, la herramienta lo lee automáticamente al iniciar.
>
> Última actualización: 18 de noviembre de 2026

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
# En la PC (desarrollo) — Claude commitea en local, SIN push
git add <archivos de la parte> && git commit -m "..."

# En la PC — el push lo hace el usuario, cuando decide subir
git push

# En el servidor (produccion) — lo hace el usuario
# 1) migraciones nuevas, si las hay, con sa y ANTES del pull
# 2) codigo
cd ~/velox-courier && git pull && pm2 restart velox
```

**Regla (10 de noviembre de 2026):** Claude commitea en local y **no hace push** salvo que el
usuario lo pida. El push, las migraciones y el deploy los hace siempre el usuario.

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
9. **Clave de eliminación** sacada del cliente (era una clave fija hardcodeada en
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

Las 108 contraseñas se derivan del nombre (nombre + un sufijo común) y la del SA está en el historial
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
- ~~Sacar el secreto de `server/db.js`~~ **HECHO** (D-028, 25/11/2026): sin valor por defecto; si
  falta `DB_PASSWORD`, el servidor no arranca. **Falta rotar** esa contraseña en el servidor: está
  en el historial de git y se pudo bajar del sitio (D-028).
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
pagado" de tiendas sigue liquidando días con órdenes en proceso. Clientes / Tiendas seguía con la regla
vieja; pasó al motor el 25/11/2026 (D-029).

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

**Estado:** HECHO en producción (confirmado por el usuario; cambio en `43b6e5d`, último commit
`c0f1312`). Migración `velox_agregar_estado_anulado.sql` aplicada en local y en producción, antes del
`git pull`.

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

## D-015 · Limpieza de la simulación en producción y numeración desde C-1

**Estado:** HECHO en producción el 7 de noviembre de 2026 (confirmado por el usuario, con backup
previo). Cambio de numeración en `bc98079`, script en `47e52ff`. Sin migración.

**Problema.** Las órdenes y la Caja de producción eran de simulación, y había que arrancar de cero sin
perder usuarios, tiendas, motorizados ni tarifas. El script anterior ya no alcanzaba: era una lista
fija, escrita antes de las liquidaciones.

**Decisión.**
- **`limpiar_ordenes_y_caja.sql` descubre lo que borra:** `ordenes`, las tablas `caja_*` y sus
  dependientes por FK, directos o indirectos, y de ahí también sale el orden de borrado. Una tabla nueva
  con FK a estas entra sola. Si una tabla protegida apareciera como dependiente, no borra nada.
- **Todo o nada:** una transacción con `XACT_ABORT ON`, que antes de confirmar revisa que lo vaciado
  quedó en 0 y que el resto no cambió.
- **Se corre con la app parada y con `sa`.** Se probó en una copia local, no en la base de trabajo:
  falla provocada a mitad de camino, tablas nuevas con FK, tabla protegida dependiente.
- **C-1:** el código no sale de la base sino de `server/routes/ordenes.js` (`ISNULL(MAX(...), 0) + 1`),
  así que el script no podía reiniciarlo: se cambió el valor inicial en el código, de 1000 a 0.

**Límites aceptados.** Los archivos de fotos quedan huérfanos en R2. El importador de Excel sigue
arrancando en 1000 (ver `CLAUDE.md` → "Pendiente").

---

## D-016 · Todas las fotos de la orden, a la vista y en el export (sin bloquear la descarga)

**Estado:** HECHO en producción el 10 de noviembre de 2026 (confirmado por el usuario: `git pull` +
`pm2 restart velox`, sin migración). Commits `5de0bb6`, `cd8b257`, `2773762`; último commit en
producción `a7938a0`.

**Problema.** Cada foto se veía solo donde se tomó: en "Actualizar orden", la del producto y las del
motorizado; las de devolución, solo mientras la orden estaba en la zona de devolución. Y el Excel / CSV
de "Todos los pedidos" no tenía ninguna, aunque son la prueba de la entrega, del pago y de la
devolución.

**Decisión.**
- **Una sola fuente:** `ordenes_fotos`, agrupada por `tipo`. No se agregó ningún almacenamiento ni
  columna (D-003).
- **"Actualizar orden"** muestra el bloque "Fotos de la orden": un grupo por tipo, solo los que tienen
  fotos, en el orden del flujo, y un grupo "Otras" para un tipo que no esté en la lista. Usa el mismo
  visor de siempre. Los datos ya venían de `GET /ordenes/:id`.
- **Export:** a las 15 columnas de siempre se le suman al final 11 columnas de URLs, una por tipo más
  "otros tipos". Varias fotos del mismo tipo van en una celda, separadas por " | ". El importador lee
  sus columnas por nombre, así que un archivo exportado se sigue pudiendo reimportar.
- **Endpoint por lote `POST /ordenes/fotos-export`**, en vez de un pedido por orden. Las reglas de
  quién ve qué son las de `GET /:id` y `puedeVerFotoOrden`:
  - Alcance de órdenes por `filtroPorRol`.
  - Gestores: todas las fotos.
  - Motorizado: sin las de devolución.
  - Tienda: solo la del producto.
  - Visor: ninguna.
- **La descarga nunca se bloquea por las fotos** (pedido del usuario): si el endpoint falla, tarda más
  de 15 s o no existe (servidor sin reiniciar), el archivo sale igual, con esas celdas vacías y un
  aviso no bloqueante.

**Límites aceptados.**
- El cuerpo JSON no puede pasar de 100 KB (`express.json()`). Por eso el frontend pide de a 2000 ids y
  el servidor acepta hasta 5000 por pedido.
- Un tipo de foto nuevo se tiene que sumar a mano a `_GRUPOS_FOTOS_ORDEN` y a
  `_EXPORT_COLUMNAS_FOTOS`. Mientras tanto, sale en "Otras" / "otros tipos", sin perderse.

---

## D-017 · Reporte del día de una tienda como imagen: canvas en el navegador, URL fija con HMAC, sin tabla

**Estado:** HECHO en producción el 14 de noviembre de 2026 (confirmado por el usuario; commit
`9e92546`, y el del motorizado en `c206fe7` / `3df4580`; último commit `8a2cf5f`), sin migración.
El CORS del bucket permite `cache-control` (lo cambió el usuario el 10/11).

**Problema.** El resumen por WhatsApp de "Clientes / Tiendas" es solo texto. Hacía falta un reporte
del día prolijo, en imagen, con una URL para mandarle a la tienda.

**Decisión.**
- **Solo admin**, en el detalle de la tienda: "Generar reporte" y "Copiar" (la URL). El resumen en
  texto de WhatsApp no se tocó.
- **La plata sale del motor de la Caja** (`calcularOrdenCaja`, D-012), así que el saldo coincide con
  la Caja Tienda. Hay una ruta propia (`GET /caja/tiendas/:id/reporte`) que trae **todos** los
  pedidos del día, menos los anulados; los no cobrables salen con saldo 0. Si el día ya se liquidó,
  la imagen lo marca ("Día liquidado el dd/mm") y no parece una deuda pendiente.
- **La imagen se dibuja a mano en un `<canvas>` del navegador.** Se descartaron html2canvas (una
  dependencia nueva que se lleva mal con las variables CSS y la fuente de íconos) y generarla en el
  servidor (puppeteer o node-canvas: peso y CPU en el droplet). La paleta vive en el JS, para que la
  imagen salga igual con cualquier tema.
- **Nombre fijo en R2, firmado:** `reportes/tienda-<id>/<fecha>-<HMAC>.png`. La firma es un HMAC de
  tienda + fecha con `JWT_SECRET`. "Generar de nuevo" pisa el mismo archivo y la URL no cambia,
  pero nadie puede adivinar la URL de otra tienda cambiando el número.
- **Sin tabla.** La URL se recalcula, y "ya generado" y la hora salen de un `HEAD` a R2.
- **Cache-Control: no-cache** al subir, para que al regenerar no se vea la imagen vieja. Por eso el
  CORS del bucket tiene que permitir `cache-control`.

**Límites aceptados.**
- Si se rota `JWT_SECRET` (Fase 4), los reportes ya enviados siguen viéndose en su URL vieja, y los
  nuevos salen con otra URL.
- No hay auditoría de quién generó cada reporte. Si hiciera falta, se agrega una tabla sin cambiar
  la URL.
- La vista previa que WhatsApp ya guardó de un mensaje enviado no se actualiza; al abrir el link
  se ve la imagen nueva.
- El **texto** de "Enviar resumen" sigue con la regla vieja de saldo y puede no coincidir con la
  imagen (ver `CLAUDE.md` → "Pendiente").

**Ampliación: reporte del día del motorizado (10 de noviembre de 2026).** Probado por el usuario en
local y subido a `origin/main` (commits `c206fe7` y `3df4580`). Falta el deploy, el mismo que el
de tienda: `git pull` + `pm2 restart velox`, sin migración.
- **Mismo mecanismo, no uno nuevo.** Canvas, nombre firmado, `no-cache`, solo admin, sin tabla y
  marca de día liquidado (sale de `caja_pagos_motorizados`). El código se generalizó en lugar de
  copiarse: en el servidor, `TIPOS_REPORTE` en `server/r2.js` (etiqueta del HMAC + ruta por tipo);
  en el navegador, `_REP_TIPOS` en `js/reporte-tienda.js` (ruta de la API + función de dibujo).
  Un reporte de otra cosa = registrar un tipo más.
- **Archivo:** `reportes-moto/<id>-<fecha>-<HMAC>.png`, con su propia etiqueta de HMAC
  (`velox-reporte-moto`). **Ni la etiqueta ni la ruta de un tipo se cambian:** cambiarían las URLs
  ya mandadas. Se comprobó que la URL de la tienda quedó idéntica después del cambio.
- **La plata, desde el lado del moto:** el moto entrega **todo** lo que pasó por sus manos (efectivo
  + Yape = "A ENTREGAR A VELOX") y Velox le paga aparte ("VELOX TE PAGA" = su pago). El neto
  (entregar − su pago) es el `saldo_moto` del motor, así que coincide con la Caja de motorizados.
  Pago Velox y Pago tienda no suman a lo que entrega: salen con "—" y una nota.
- **Dónde:** en **Caja → Motorizados**, arriba del detalle del moto (al principio estuvo en la
  página Motorizados; el usuario lo prefirió en la Caja). Es de un día: el del filtro si es uno
  solo; sin filtro, hoy; con un rango, pide filtrar un día en vez de elegir uno por su cuenta.
  Como la Caja arma su HTML cada 8 s, los botones se arman sin consultar y se "hidratan"
  (`hidratarReportes`) solo cuando la lista se repinta: no se le pregunta a R2 en cada refresco.

---

## D-018 · Las listas del motorizado, por hora de asignación (columna `ordenes.asignada_en`)

**Estado:** HECHO en producción el 14 de noviembre de 2026 (confirmado por el usuario; commit
`01b0f09`, último commit `8a2cf5f`). Migración `velox_agregar_asignada_en.sql` aplicada con `sa`
antes del `git pull`. En el mismo deploy entraron el buscador de "Mis entregas de hoy" (`223635a`)
y la tarjeta con foto y botones apilados (`063e0f4`).

**Problema.** El motorizado quería ver arriba la última orden que le asignaron y abajo la primera,
en todas sus listas. No había ningún dato que dijera a qué hora se asignó una orden:
- `fecha_asignacion` es `DATE`: sirve para el día de reparto, no para ordenar dentro del día.
- `hora_asignacion`, pese al nombre, es la hora de **creación**: la llena el `INSERT` y `/asignar`
  no la toca.

**Decisión.** Columna nueva `ordenes.asignada_en DATETIME2(0) NULL` (decidido por el usuario).
- **Se descartó ordenar por id** (sin migración): ordena por creación y falla justo en los casos
  que importan, como una reprogramada que vuelve, una orden que pasa de un moto a otro, o una creada
  temprano y asignada tarde.
- **Hora de Lima**, no la del servidor (en UTC): va como texto y se convierte en el SQL. Un `Date` de
  JS la guardaría en UTC.
- **Cuándo cambia:**
  - Asignar o pasar a **otro** motorizado pone la hora actual.
  - Volver a asignar al **mismo** motorizado la conserva. "Actualizar orden" llama a `/asignar` en
    cada guardado; si la pisara, editar un teléfono subiría la orden arriba de todo.
  - Desasignar y `/devolver` (vuelve a Asignación) la borran.
  - Una orden creada ya con motorizado nace con la hora.
- **Orden:** día de reparto más reciente primero; dentro del día, la última asignada arriba; las
  sin hora, al final y por id. Se aplica en el historial del moto y en Asignación (servidor), y en
  "Mis entregas de hoy" y "Órdenes asignadas al motorizado" (navegador), con una sola función de
  orden compartida.
- **La Caja no la usa:** es solo para ordenar, no cambia ningún monto ni ningún día.

**Límites aceptados.**
- Las órdenes asignadas antes de la migración y las importadas por Excel no tienen hora: van al
  final de su día. Como la limpieza del 7/11 dejó producción sin órdenes, casi no hay.
- **El deploy tiene orden obligatorio:** sin la columna, el código nuevo da 500 en asignar,
  devolver, crear orden, Asignación y el historial del moto.
- La migración se corre a mano. La primera versión del script decía "creada" aunque el `ALTER`
  hubiera fallado: en local se corrió en `master` y no creó nada. Ahora hace `USE velox_courier` y
  comprueba la columna antes de decir OK; conviene que las migraciones nuevas hagan lo mismo.

---

## D-019 · El panel del motorizado lee la plata del motor de la Caja (`caja-motor.js`)

**Estado:** HECHO en producción el 14 de noviembre de 2026 (confirmado por el usuario; commit
`486b6c3`, último commit `8a2cf5f`), sin migración.

**Problema.** El panel del moto de la página Motorizados sumaba en el navegador el "por cobrar"
(`monto_cobrado`) de toda orden entregada o ausente, sin mirar el medio de pago, como si el moto lo
hubiera cobrado. Caso real en producción: #C-1310 (13/11), ausente, mostraba "Cobrado S/ 175.50" y
"Total moto S/ 170.50". Lo mismo pasaba con Pago tienda y Pago Velox, y no le pagaba la devolución.
La cuenta estaba repetida en 4 lugares del frontend y no coincidía con Caja → Motorizados (D-012).

**Decisión.**
- **El navegador no decide qué cobra el moto.** `GET /motorizados/:id/ordenes` devuelve en cada orden
  `caja`, calculada con `calcularOrdenCaja()`, la misma función de las 3 cajas. El navegador solo suma
  (en céntimos) y pinta.
- **"Deuda moto" reemplaza a "Total moto":** en mano (efectivo + Yape) − su pago, con los mismos
  colores que la Caja (verde = debe a Velox, ámbar = Velox le debe). "Cobrado" muestra solo lo que
  pasó por sus manos, con su tag; Pago tienda / Pago Velox dicen que no pasó por el moto. Columna
  nueva "Medio de pago" ("Por definir" solo si falta).
- Se descartó corregir la suma en el navegador: hubiera sido una quinta copia de la regla de D-012,
  que se desalinea con el próximo cambio.

**Límite aceptado.** En un día ya liquidado, la Caja muestra el saldo guardado y este panel el que
dan hoy los pedidos (si alguien editó una orden después, la Caja dice "Difiere").

---

## D-020 · Notificaciones compartidas y reasignación entre motorizados con aceptación

**Estado:** HECHO en producción el 14 de noviembre de 2026 (confirmado por el usuario; commits
`46f46f8` y `935020f`, último commit `8a2cf5f`). Migración
`velox_agregar_notificaciones_reasignaciones.sql` (tablas `notificaciones` y `reasignaciones`)
aplicada con `sa` antes del `git pull`, después de la de `asignada_en`. El ajuste "el aviso se
cierra al guardar, no al abrir" (`b6967bf`, sin migración) entró en el deploy del 18 de noviembre
de 2026 (último commit `bc30158`, confirmado por el usuario).

**Problema.**
- La oficina no se enteraba a tiempo de un "no entregado" ni de un "Pago tienda" (hay que revisar la
  evidencia): tenía que buscarlos en la tabla.
- Un moto que no llegaba a una entrega no tenía cómo pasársela a un compañero: lo hacía la oficina a
  mano. El botón "Reasignar" del panel del moto no hacía nada (su ventana estaba en otra página).

**Decisión: notificaciones (admin y operador).**
- **Una fila por aviso, compartida por todos los gestores.** Se descartó un aviso por usuario: dos
  personas revisarían lo mismo y nadie sabría si ya se vio.
- **Se cierra al GUARDAR la orden, no al abrirla** (cambio del 14/11, commit `b6967bf`, probado por
  el usuario; sin migración). "Abrir" solo lleva a "Actualizar orden" de esa orden: si se cierra sin
  guardar, el aviso sigue. Guardar (aunque no cambie nada, y venga de donde venga el modal: el aviso,
  la tabla, la Caja) marca revisados todos los avisos abiertos de esa orden para todos los gestores
  (`revisada_en`, `id_usuario_revisa`), sin que la pantalla espere esa llamada. Motivo: abrir no
  significa haber revisado; guardar sí. Si otro ya la guardó, sale "<nombre> ya revisó este aviso".
  El `POST /notificaciones/:id/revisar` viejo quedó por compatibilidad y ya no marca.
- **El aviso nace al PASAR** a no entregado o a entregado con Pago tienda (`/estado`, `/resolver` y
  `/medio-pago` leen el tipo antes y lo comparan después). Guardar de nuevo sin cambios no crea otro.
  Un endpoint nuevo que cambie estado o medio de pago tiene que hacer lo mismo.
- **Si la orden cambia antes de abrirlo, se esconde** (filtro al listar), no se borra.
- **Crear el aviso nunca hace fallar el guardado de la orden** (try/catch, queda en el log).

**Decisión: reasignación moto → moto.**
- **Con aceptación:** la orden sigue con el que la envía (y la puede seguir trabajando) hasta que el
  otro acepta. Se descartó pasarla directo: el destino podía no enterarse o no poder llevarla.
- **Una sola pendiente por orden** (índice único filtrado en la base, no solo en el código).
- **Aceptar es una transacción** que pasa la orden solo si sigue en reparto y con el que la envió;
  pone `asignada_en` = ahora (sale arriba, D-018) y **no cambia `fecha_asignacion`** (D-009: no mueve
  la Caja de día). Avisa a los gestores con un aviso informativo.
- **Vence a medianoche de Lima, sin tarea programada:** cada vez que se leen o antes de crear una,
  se marcan vencidas y se cancelan las que ya no valen (orden cerrada, pasada a otro, anulada). Así
  no hace falta un cron en el servidor.
- Un gestor puede pedirla en nombre del moto; la oficina sigue pasando órdenes directo desde
  Asignación.

**Decisión: el botón también para el motorizado.** El mismo "Notificaciones" del menú, **siempre
visible** (aunque esté en 0) para que lo encuentre, con sus pedidos para aceptar y las respuestas a lo
que mandó ("X aceptó" / "X no aceptó", con "Entendido"). Sale de las mismas rutas de reasignaciones,
sin migración extra (usa `vista_por_origen_en`).

**Límites aceptados.**
- Los avisos se ven por sondeo (cada 20 s), no en tiempo real.
- Borrar un motorizado para siempre se frena si tiene reasignaciones (FK).
- **Orden del deploy:** sin las tablas, cambiar estado o medio de pago sigue funcionando (el aviso
  falla solo), pero Notificaciones y Reasignar dan 500.

---

## D-021 · La foto del pago solo con Pago Velox y Pago tienda

**Estado:** HECHO en producción el 18 de noviembre de 2026 (confirmado por el usuario; commit
`f00c168` del 14/11, último commit `bc30158`). Sin migración ni cambios en el servidor.

**Problema.** En EMPEZAR → COMPLETAR se pedía foto del pago con los 4 medios, también con Yape y
Efectivo motorizado. "Actualizar orden" y el servidor ya la pedían solo con Pago tienda y Pago Velox:
las dos pantallas no coincidían.

**Decisión.**
- Con **Yape motorizado** o **Efectivo motorizado** no hay foto del pago ni se pide: la plata la tiene
  el moto y se hace responsable (la Caja ya se la cuenta como deuda, D-012).
- **Pago tienda** y **Pago Velox** (`pago-empresa`) la siguen pidiendo, como siempre (sigue
  pudiendo llegar después por la cola: `evidencia_pendiente`, D-008).
- La foto aparece y desaparece al cambiar el medio, en las dos pantallas. Una foto elegida con Pago
  tienda que después se pasa a Yape no se sube.
- Las fotos de pago ya subidas no se borran: se siguen viendo en "Fotos de la orden".

**Ojo:** la regla está escrita en 4 lugares (`_ENT_MEDIOS_CON_FOTO` en `js/entregas-moto.js`,
`_MEDIOS_PAGO[].evidencia` en `js/motorizados.js` y el `CASE` de `evidencia_pendiente` en
`server/routes/ordenes.js` y `motorizados.js`). Un medio nuevo se suma en los cuatro.

---

## D-022 · Observaciones para el motorizado: el moto solo agrega, el gestor no pisa sus notas

**Estado:** HECHO en producción el 18 de noviembre de 2026 (confirmado por el usuario; commits
`711a08d` y `69b5b1e` del 14/11, último commit `bc30158`). Sin migración: `ordenes.observaciones`
ya es `NVARCHAR(MAX)`.

**Problema.** El moto veía las observaciones en una línea chica, junto al teléfono, y no tenía cómo
dejar una nota para la oficina sin poder borrar lo que ya estaba.

**Decisión.**
- **Se ven en EMPEZAR** en un recuadro ámbar arriba de COMPLETAR / OTROS / DETALLE (y del formulario
  que abren, así se leen antes de "Completar entrega"). Vacías: solo "+ Agregar observación". Nunca
  bloquean completar.
- **El moto solo AGREGA, y lo controla el servidor.** `POST /ordenes/:id/observaciones` suma al final
  `" // ALEX 14/11 15:20: texto"` (nombre + hora de Lima) dentro del mismo UPDATE, así dos notas a la
  vez no se pisan. En "Actualizar orden" el moto ve lo que ya está en solo lectura y agrega
  (`obsAgregar`); `/completo` ignora el texto completo si viene de un motorizado.
- **Admin y operador editan el texto completo**, como antes (ahora hasta 4000 caracteres; antes la
  pantalla cortaba en 300 y con las notas no habrían podido guardar). Topes: 300 por nota, 4000 en
  total.
- **El gestor no pisa una nota que llegó con el modal abierto.** El modal manda también el texto que
  tenía al abrir (`obsOriginal`). Si no lo cambió, `/completo` no toca la columna. Si lo cambió y la
  base ya tiene otro texto, responde 409 "El motorizado agregó una nota mientras editabas", no guarda
  y muestra el texto actual para revisarlo.
- **Por qué esta protección y no el 409 general:** el control de versión de "Actualizar orden" no
  funciona (ver Pendientes varios). Arreglarlo cambia todos los guardados, y se decidió no arriesgar
  lo que anda (sobre todo la cola de fotos). Esta protección es la misma idea, pero solo sobre las
  observaciones.

**Límite aceptado:** si el aviso corta el guardado, el cambio de motorizado o de fecha (`/asignar`, que
va antes en la cadena) ya quedó guardado, como con cualquier error de `/completo`. Al volver a
guardar se manda igual.

---

## D-023 · Aviso a los gestores cuando el motorizado agrega una observación

**Estado:** HECHO en producción el 18 de noviembre de 2026 (confirmado por el usuario; commit
`48270a4`, último commit `bc30158`). Migración `velox_agregar_aviso_observacion.sql` aplicada con
`sa` en local y en producción (terminó en OK), antes del `git pull`.

**Problema.** Con D-022 el moto ya podía dejar notas, pero la oficina no se enteraba: había que abrir
la orden para verlas.

**Decisión.**
- **Un aviso nuevo en Notificaciones, tipo `observacion`** (ícono de mensaje azul): "ALEX agregó una
  observación · #C-1095 · cliente" y debajo un extracto de la nota. Lo genera solo la nota de un
  **motorizado** (desde EMPEZAR o desde su "Actualizar orden"); las de un gestor no.
- **Uno por orden.** Si el moto agrega varias notas antes de que alguien revise, se actualiza el mismo
  aviso con la última (y su hora, así sube arriba). Lo garantiza el índice único que ya existía (una
  abierta por orden y tipo), no solo el código; si dos notas llegan a la vez, el servidor reintenta
  actualizando.
- **Se cierra como los demás (D-020):** "Abrir" no lo marca; guardar la orden lo marca para todos.
  A diferencia de "no entregado" y "Pago tienda", no se esconde si la orden cambia: una observación
  sigue valiendo igual.
- **Quién y qué dijo se guardan en el aviso** (`notificaciones.autor` y `detalle`), aunque los otros
  avisos leen todo de la orden en vivo: el texto de `ordenes.observaciones` lo puede reescribir un
  gestor (D-022) y la nota podría ya no estar, o no ser la última.
- **Crear el aviso nunca hace fallar la nota** (queda en el log, como en D-020).
- En EMPEZAR, la nota se confirma con un botón ✓ grande (Enter también).

**Migración:** `chk_notif_tipo` acepta `observacion` y dos columnas NULL nuevas, `autor
NVARCHAR(100)` y `detalle NVARCHAR(300)`. **Orden del deploy:** sin la migración, la nota del moto se
guarda igual, pero no llega ningún aviso.

---

## D-024 · "Gestión / Motorizado": una página por pregunta, y un período es la suma de sus días

**Estado:** subido a `origin/main` el 25/11/2026, falta el deploy (commits `040aa95`, `16e1b62`,
`2e2137a`). Sin migración.

**Problema.** La página Motorizados mezclaba "quiénes son" (alta, edición, accesos) con "qué hicieron
y cuánto", y la plata del día de un moto se calculaba en varios lugares.

**Decisión.**
- **Motorizados = quiénes son; "Gestión / Motorizado" = qué hicieron y cuánto**, con los mismos
  filtros, chips, WhatsApp y detalle que Clientes / Tiendas.
- **Una sola cuenta del día de un moto:** `armarDiaMoto()` en `server/routes/caja.js` (sobre
  `calcularOrdenCaja`, D-012). **Un período no tiene cuenta propia: es la suma de sus días** (en
  céntimos). Así la lista, el detalle, el reporte en imagen y Caja → Motorizados no pueden dar distinto.
- **WhatsApp al moto con SU reporte en imagen** (D-017): si el día no tiene imagen, el admin la
  genera antes; el operador manda la que hay o avisa. La pestaña se abre con el toque (si se abre
  después de esperar al servidor, el celular la bloquea).
- **"Enviado" en el navegador** (`localStorage`, por moto y día), igual que tiendas: sin tabla.
- **Diferencia a propósito:** en un día liquidado, la Caja muestra el saldo guardado y esta página el
  de ahora (con "difiere").

## D-025 · Las imágenes se ven dentro del sistema, nunca en otra pestaña

**Estado:** subido el 25/11/2026, falta el deploy (`37df5bb`). Solo frontend.

**Decisión.** Un solo visor (`js/visor-imagen.js`) para todas las fotos y reportes: se abre encima,
lo de atrás no se pierde (un modal con datos escritos sigue igual), se cierra con ✕, Esc, tocando
afuera o el botón atrás del celular (`pushState`), con flechas / teclado / deslizar entre las fotos
de un mismo grupo, y "Copiar URL" con respaldo seleccionable. Se activa con atributos
(`data-visor-url`) y un listener global en captura, así sobrevive a los repintados y el clic no llega
a la fila de atrás. Se borraron los tres visores viejos. No se tocaron WhatsApp ni la exportación.

## D-026 · El motorizado ve su propia gestión; cada rol recibe solo lo suyo, por id

**Estado:** subido el 25/11/2026, falta el deploy (`d481b61`, `b138c92`, `6d3ab30`). Sin migración.

**Decisión.**
- **El moto entra a "Gestión / Motorizado" directo a SU detalle** (días, período, cuadros, órdenes),
  sin lista, WhatsApp, generar reporte ni acciones sobre las órdenes; del reporte, solo "Ver imagen".
  En Motorizados le quedan "Mis entregas de hoy" y su tarjeta (su historial repetido se sacó).
- **La Caja es lista blanca para el moto:** solo `GET /caja/motorizados/:id/dias` y `/reporte`, solo
  con su id del token (otro id o cualquier otra ruta, 403), y del liquidado solo la fecha (el monto y
  el "difiere" son control interno).
- **Cada rol recibe solo lo suyo del servidor**, no se filtra en la pantalla: el moto, solo su
  registro de `/motorizados` (para reasignar, `/motorizados/companeros` con id y nombre) y de las
  tiendas solo id y nombre; la tienda, nada de motos ni de otras tiendas; ninguno de los dos, órdenes
  de otros.
- **Las pantallas identifican al moto y a la tienda por `id_motorizado` / `id_tienda` de la sesión**,
  no por el nombre del usuario (si era distinto, veían vacío).
- **La tienda no ve WhatsApp** en Clientes / Tiendas ("Enviar resumen" es de Velox a la tienda).

## D-027 · Ni la tienda ni el motorizado pueden calcular el margen de Velox

**Estado:** subido el 25/11/2026, falta el deploy (`fa7fb17`, `b3a30a2`). Sin migración.

**Decisión.** Margen = lo que paga la tienda − lo que se le paga al moto. Ninguno de los dos recibe
la mitad que le falta:
- **Un filtro central** (`server/middleware/recortar-por-rol.js`) le saca a toda respuesta JSON de la
  API, a cualquier profundidad, los campos prohibidos del rol: al **moto** el delivery, el adicional y
  el valor del producto (cobrado − producto daría el delivery); a la **tienda** todo el pago al moto.
  Se eligió un filtro de salida y no ruta por ruta para que una ruta nueva quede cubierta sola. Un
  campo nuevo de plata se suma a `CAMPOS_PROHIBIDOS`.
- **Tarifas por rol:** el moto, solo distritos (sin precios); la tienda, 403 (ninguna pantalla suya
  las usa).
- Pantallas: sin la columna Delivery ni esos montos para el moto, sin "Pago a motorizados" para la
  tienda; la imagen del moto dice "Tu pago del día". Admin, operador y visor ven todo igual.

## D-029 · Clientes / Tiendas y su WhatsApp leen la plata del motor de la Caja

**Estado:** subido el 25/11/2026, falta el deploy (`b0b53cc` y `624077b`).
Sin migración.

**Problema.** Clientes / Tiendas calculaba la plata en el navegador (y `/tiendas/resumen` en SQL)
con la regla vieja: entregado / ausente, delivery − cobrado, sin mirar el medio de pago ni el
prepago. Su pantalla y su WhatsApp de texto podían no coincidir con Caja → Tienda ni con el
reporte en imagen (ej. un día: S/ 100 / 430 / "se le debe 330" contra S/ 110 / 260 / −180). Además,
en el lote anterior (`b138c92`) un `cond ? '' : …` sin paréntesis dentro de una suma de textos dejó
vacío el encabezado del detalle de la tienda para todos los roles, y con él el WhatsApp.

**Decisión.**
- **El navegador no calcula plata.** `/tiendas/resumen` y `/tiendas/:id/ordenes` pasan cada orden
  por `calcularOrdenCaja` (D-012) y devuelven delivery, cobrado (lo que tiene Velox), saldo y si el
  día está liquidado; la pantalla solo suma en céntimos y pinta. Así Clientes, la Caja, el reporte
  en imagen y el WhatsApp dicen lo mismo, para el admin y para la tienda.
- **En vivo, como el reporte:** un día ya liquidado se muestra con lo que dan hoy sus pedidos y la
  marca de liquidado; la Caja muestra el saldo guardado y "difiere" si se editó después del pago.
- **WhatsApp a la tienda igual que al moto (D-024):** por tienda y día, con cada orden, los totales del
  motor y la URL de la imagen del reporte; el admin la genera si falta, el operador manda la que hay;
  marca de enviado por tienda y día; apagado con un período. El JSON del reporte de tienda pasa a
  admin y operador; generar la imagen sigue siendo solo del admin. La tienda no lo ve.
- **Regla de código:** un `cond ? a : b` dentro de una suma de textos va siempre entre paréntesis.

**Queda:** Evidencias (`js/charts.js`) todavía calcula "Ingreso delivery", "Saldo por cobrar" y
"Pago a motorizados" en el navegador con la regla vieja.

## D-030 · Si ves la orden, ves todas sus fotos

**Estado:** subido el 25/11/2026 (`b053e95`), falta el deploy. Sin migración. Toca el servidor.

**Problema.** Las tablas de órdenes de Clientes / Tiendas y de Gestión / Motorizado no mostraban
fotos (solo la del producto en Clientes), y cada lugar del servidor tenía su propia regla de qué
fotos ve cada rol: la tienda solo la del producto, el visor ninguna, las de devolución solo los
gestores, y la exportación con otra lista más.

**Decisión.**
- **Una sola regla para todo el servidor:** si un rol puede ver la orden (`filtroPorRol`: la tienda,
  las de su tienda; el moto, las suyas; gestores y visor, todas), ve **todas** sus fotos, de
  cualquier tipo. La aplican las tablas nuevas, `puedeVerFotoOrden` (foto local),
  `POST /ordenes/fotos-export` y `GET /ordenes/:id`.
- **Las fotos viajan con la lista, en una consulta por pantalla** (`server/fotos-ordenes.js`): el
  mismo `WHERE` y los mismos parámetros (id del token) que la consulta de las órdenes. Así nunca
  puede haber una foto de una orden que ese rol no ve, ni una consulta por orden.
- **En pantalla, por columna:** Código = producto, Estado = las del intento / entrega / devolución
  (primero la del estado actual), Cobrado = la del pago. Un ícono por columna (con el número si hay
  varias) y, en el visor (D-025), las flechas recorren todas las fotos de la orden. La columna de
  cada tipo vive en `_GRUPOS_FOTOS_ORDEN`: un tipo nuevo se suma ahí.
- El recorte de campos de plata (D-027) no cambia.

## D-031 · La tienda entra a "Mi cuenta"; los cuadros entran en el celular

**Estado:** subido el 25/11/2026 (`b2f2019`, `99642c2`), falta el deploy. Solo frontend.

**Decisión.**
- **"Mi cuenta":** la tienda ya no pasa por la lista "Balance por tienda cliente" (una fila, o "Sin
  tiendas registradas"): entra directo a su detalle, como el moto a su Gestión (D-026). Sin la
  lista, los KPIs, Exportar ni "← Volver"; con la tarjeta "Lógica de saldo" abajo. Se llama "Mi
  cuenta" en el título y en el menú, porque para ella no hay "clientes" ni otras "tiendas". Sin
  órdenes, un mensaje claro y los filtros a mano. El id es solo pantalla: lo manda el token.
- **Cuadros en el celular, 2 columnas siempre:** varias páginas fijaban sus columnas en el HTML y le
  ganaban a la regla del celular (los cuadros se salían de pantalla). Hasta 768 px, una sola regla
  al final de `css/responsive.css` los deja en 2 columnas, con etiqueta y monto apilados. En PC y
  tablet, sin cambios.

## D-028 · El servidor publica solo el frontend; contraseñas fuera del código

**Estado:** subido el 25/11/2026, falta el deploy (`17d9c1b` y el commit que saca los scripts con
contraseñas). Sin migración. **Rotación de contraseñas: PENDIENTE.**

**Problema.** `server.js` servía toda la carpeta del proyecto: sin sesión se podían bajar el código
del servidor (con la contraseña de respaldo de la base en `db.js`), `.git/` (todo el repositorio con
su historial), los `.md`, los `.sql` y las fotos de `uploads_local/`.

**Decisión.**
- **Lista blanca:** solo `index.html`, `login.html`, `css/`, `js/`, `pages/` e `img/`; todo lo demás,
  404. Una carpeta pública nueva se suma a mano en `server.js`.
- **`db.js` sin contraseña de respaldo:** si falta `DB_PASSWORD`, el servidor avisa y no arranca.
- **Scripts con contraseñas fuera del repo** (`velox_crear_usuario*.sql`, en `.gitignore`): quedan
  solo en la PC. Ninguno corre al arrancar el servidor.
- **El historial no se reescribe.** Quedaron en él: `server/.env` y `.gitignore/.env` (commit
  inicial, con la contraseña de la base), los `.md` de credenciales de tiendas y motos (con la
  contraseña de fórmula) y los scripts de creación de usuarios. Por eso hay que **rotar**: la base,
  el admin y las tiendas / motos con la fórmula (ver "Pendientes varios"). `JWT_SECRET` y las claves
  de R2 nunca estuvieron en el repo.

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
- [ ] **Rotar contraseñas (D-028):** la de la base (`velox_user`) y la de `sa` (y el `.env` del
      servidor), la del admin si sigue siendo la del script de creación, y las de tiendas y motos
      con la contraseña de fórmula ("Resetear contraseñas").
- [ ] **Reiniciar el Droplet** por el aviso "System restart required" de Ubuntu, en un horario sin
      uso, revisando antes que PM2 y SQL Server vuelvan solos.
- [ ] **Log de producción:** errores viejos "Validation failed for parameter 'id'" en
      `PATCH /ordenes/:id/completo` y `/medio-pago` (probable id vacío desde la pantalla; detalle
      en `CLAUDE.md` → "Pendiente").
- [ ] **Evidencias** todavía calcula la plata en el navegador con la regla vieja (D-029).
- [ ] **Caja:** las 3 cajas (D-012) y el fix del motorizado (D-013) ya están en producción.
      Clientes / Tiendas ya usa el motor (D-029); Evidencias todavía no. El moto ya ve su propia
      gestión (D-026); la vista de la caja de la tienda, próximo paso. Detalle en `CLAUDE.md` → "Pendiente".
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
- [x] **Cambios del 10/11/2026: desplegados en producción** el mismo día (confirmado por el
      usuario; `git pull` + `pm2 restart velox`, sin migración, último commit `a7938a0`). Son
      cuatro cambios:
      - "Mis entregas de hoy" vuelve a la lista al cerrar una orden, en vez de abrir sola la
        siguiente.
      - Botón de WhatsApp en cada tarjeta del motorizado.
      - Todas las fotos en "Actualizar orden".
      - URLs de las fotos en el Excel / CSV, con descarga a prueba de fallos (D-016).

      Los motorizados con la app abierta tienen que recargarla.
- [x] **Deploy del 14/11/2026: HECHO en producción** (confirmado por el usuario; las dos
      migraciones con `sa`, `velox_agregar_asignada_en.sql` y después
      `velox_agregar_notificaciones_reasignaciones.sql`; `git pull` a `8a2cf5f`; `pm2 restart
      velox`; verificado). Entró todo lo pendiente:
      - Reportes del día en imagen, de tienda y de motorizado (D-017).
      - Cambios del 12/11: buscador de "Mis entregas de hoy", la última asignada arriba (D-018) y
        la tarjeta con foto.
      - Panel del motorizado con la cuenta de la Caja (D-019).
      - Notificaciones y reasignación entre motorizados (D-020).
- [x] **Deploy del 18/11/2026: HECHO en producción** (confirmado por el usuario;
      `velox_agregar_aviso_observacion.sql` con `sa`, terminó en OK; `git pull` a `bc30158`; `pm2
      restart velox`; logs limpios y verificado). Entró lo del 14/11 por la tarde y del 18/11:
      - El aviso que se cierra al guardar (D-020, `b6967bf`).
      - La foto del pago solo con Pago Velox / Pago tienda (D-021, `f00c168`).
      - Las observaciones para el moto con su protección (D-022, `711a08d`, `69b5b1e`).
      - El aviso "X agregó una observación" y el botón ✓ (D-023, `48270a4`).
- [ ] **Lote del 19 al 25/11/2026: subido a `origin/main` el 25/11, falta el deploy** (sin
      migración; `git pull` + `pm2 restart velox`; antes, revisar que el `.env` del servidor tenga
      `DB_PASSWORD`). Entra:
      - Ráfaga: "Terminar" vuelve a "Todos los pedidos" con una confirmación (tienda + órdenes
        creadas).
      - "Pendiente": "Por cobrar" viene en 0 y se selecciona al entrar.
      - Chip "Sin asignar (N)" en "Todos los pedidos".
      - Tabla de Motorizados legible en el celular.
      - "Gestión / Motorizado" con lista, detalle, historial, WhatsApp y marca de enviado (D-024).
      - Visor de imágenes (D-025).
      - Nombre del panel y título de la pestaña según el rol.
      - El moto ve su propia gestión; datos por rol y por id (D-026).
      - Margen: tarifas por rol y recorte de campos (D-027).
      - Lista blanca de archivos y `db.js` sin contraseña (D-028).
      - Subidos después, el mismo 25/11: el arreglo del encabezado del detalle de la tienda y el
        WhatsApp del reporte a las tiendas (`b0b53cc`), y Clientes / Tiendas con el motor (D-029).

      Los motorizados y las tiendas con la app abierta tienen que recargarla.
- [ ] **Control de concurrencia (409) roto desde el 14/10** (commit `f47d676`). `SELECT_ORDEN`
      devuelve la versión con `CONVERT(varchar(20), o.row_version, 1)`, que con `rowversion` da los
      bytes crudos y no `0x…`; `bufferDeVersion` la descarta y ningún guardado con `ifVersion` da
      409: el último que guarda pisa. Arreglo de una línea (`CAST(o.row_version AS binary(8))`),
      pero empezarían a salir 409 reales en todos los guardados. **Decidido no arreglarlo por ahora**
      (14/11) para no arriesgar lo que anda, sobre todo la cola de fotos. Las observaciones ya
      tienen su propia protección (D-022). Visto en local (SQL Server 2025); en producción, sin mirar.
- [ ] **PENDIENTE — rotar contraseñas (D-007, D-028):** la de la base (`velox_user`, y `sa` si es
      la misma) en el servidor y en su `.env`; la del admin si sigue siendo la del script de
      creación; y las de tiendas y motos que sigan con la contraseña de fórmula (Tiendas / Usuarios
      → "Resetear contraseñas"). Todas quedaron en el historial de git, que se pudo bajar del sitio
      hasta el deploy de D-028. `JWT_SECRET` y R2 no hace falta.
- [ ] **Opcional:** cortar las sesiones abiertas al resetear una contraseña (necesita
      migración). Ver D-007.
