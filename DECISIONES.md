# Registro de decisiones técnicas — Velox Courier

> Documento vivo. Cada decisión explica **qué se decidió**, **por qué**, y **qué la revierte**.
> Sirve también como contexto de arranque para Claude Code: si se copia a `CLAUDE.md`
> en la raíz del repo, la herramienta lo lee automáticamente al iniciar.
>
> Última actualización: 17 de julio de 2026

---

## Estado del proyecto

| Fase | Qué | Estado |
| --- | --- | --- |
| **1** | Infraestructura y despliegue (servidor, BD, SSL, dominio) | Completada |
| **2** | Autenticación y autorización server-side | Completada |
| **3** | Módulo de fotos (Cloudflare R2) | Pendiente |
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
3. La PC (`DESKTOP-ERVF8UO`) es **desarrollo**; el servidor es **producción**. Son dos bases
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

## D-003 · Fotos: Cloudflare R2, no Cloudinary (Fase 3, pendiente)

**Estado:** Decidido, sin implementar.

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

## Costos de operación

| Concepto | Mensual |
| --- | --- |
| Droplet (2 vCPU / 4 GB) | $24.00 |
| IGV Perú 18 % (DigitalOcean, desde 01/06/2026) | $4.32 |
| Dominio Namecheap ($6.99/año) | $0.58 |
| Ubuntu + SQL Server Express + SSL + Node + PM2 + Nginx | $0.00 |
| **Total actual** | **~$28.90** |
| Cloudflare R2 (Fase 3) | ~$2.90 |
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
