# Registro de decisiones técnicas — Velox Courier

> Documento vivo. Cada decisión explica **qué se decidió**, **por qué**, y **qué la revierte**.
> Sirve también como contexto de arranque para Claude Code: si se copia a `CLAUDE.md`
> en la raíz del repo, la herramienta lo lee automáticamente al iniciar.
>
> Última actualización: 27 de octubre de 2026

---

## Estado del proyecto

| Fase | Qué | Estado |
| --- | --- | --- |
| **1** | Infraestructura y despliegue (servidor, BD, SSL, dominio) | Completada |
| **2** | Autenticación y autorización server-side | Completada |
| **3** | Módulo de fotos (Cloudflare R2) | Completada — R2 activo en producción (27/10/2026) |
| **4** | Rotación de contraseñas + limpieza periódica + web institucional | Pendiente |

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

Hay 236 tiendas en la tabla pero solo 89 con usuario de acceso. El sistema ya tiene el botón
"Crear usuarios para todas las tiendas" para las que falten (usar después de la Fase 4).

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
- [ ] **Caja:** seguir revisándola con la fecha de reparto y los datos reales. Dos bugs
      anotados: el prepago en el detalle de la tienda, y `GETDATE()` (UTC) en los dos "Marcar
      pagado", que después de las 19:00 de Lima registra `fecha_pago` con el día siguiente.
      Detalle en `CLAUDE.md` → "Pendiente".
- [ ] **Rediseño de la vista del motorizado** (botón EMPEZAR + flujo de entrega con fotos, que
      debe usar el pipeline único de fotos de D-003). Solo se habló, no se empezó.
