/* ============================================================
   revisar_dias_pagados_fecha_reparto.sql — SOLO LECTURA
   Correr en producción ANTES de subir el cambio "fecha de reparto"
   (velox_agregar_fecha_reparto.sql + el código). No modifica nada:
   funciona con o sin la columna fecha_reparto (usa
   ISNULL(fecha_asignacion, fecha), que es lo mismo).

   Con el cambio, la Caja deja de agrupar por la fecha de CREACIÓN
   (ordenes.fecha) y pasa a agrupar por la fecha de REPARTO. Las
   órdenes asignadas otro día que el de su creación se cambian de día,
   y si alguno de esos días ya está marcado "pagado", el total que se
   ve en la Caja dejaría de coincidir con lo que se pagó.

   Resultado 1: órdenes que SUMAN en la Caja y cambian de día.
   Resultado 2: días pagados afectados (tienda / motorizado), con el
                monto pagado guardado y el que se vería después.
   Si los dos vienen vacíos, se puede subir sin sorpresas en la Caja.
     sqlcmd -S <servidor> -d velox_courier -I -W -i revisar_dias_pagados_fecha_reparto.sql
   ============================================================ */
SET NOCOUNT ON;

/* 1. Órdenes que cambian de día y suman en la Caja (mismas
      condiciones que server/routes/caja.js) */
SELECT o.id, o.codigo, t.nombre AS tienda, m.nombre AS motorizado, o.estado, o.pago_velox,
       CONVERT(varchar, o.fecha, 23)                              AS dia_hoy_creacion,
       CONVERT(varchar, ISNULL(o.fecha_asignacion, o.fecha), 23)  AS dia_nuevo_reparto,
       cpt.pagado AS tienda_pagado_dia_hoy,  cpt2.pagado AS tienda_pagado_dia_nuevo,
       cpm.pagado AS moto_pagado_dia_hoy,    cpm2.pagado AS moto_pagado_dia_nuevo
FROM ordenes o
JOIN tiendas t ON t.id = o.id_tienda
LEFT JOIN motorizados m ON m.id = o.id_motorizado
LEFT JOIN caja_pagos_tiendas cpt      ON cpt.id_tienda  = o.id_tienda AND cpt.fecha_ciclo  = o.fecha
LEFT JOIN caja_pagos_tiendas cpt2     ON cpt2.id_tienda = o.id_tienda AND cpt2.fecha_ciclo = ISNULL(o.fecha_asignacion, o.fecha)
LEFT JOIN caja_pagos_motorizados cpm  ON cpm.id_motorizado  = o.id_motorizado AND cpm.fecha_dia  = o.fecha
LEFT JOIN caja_pagos_motorizados cpm2 ON cpm2.id_motorizado = o.id_motorizado AND cpm2.fecha_dia = ISNULL(o.fecha_asignacion, o.fecha)
WHERE o.fecha_asignacion IS NOT NULL
  AND o.fecha_asignacion <> o.fecha
  AND (o.estado IN ('entregado', 'ausente') OR (o.estado = 'cancelado' AND o.pago_velox = 'PAGADO'))
  AND (cpt.pagado = 1 OR cpt2.pagado = 1 OR cpm.pagado = 1 OR cpm2.pagado = 1)
ORDER BY o.fecha, t.nombre, o.id;

/* 2a. Tiendas: días pagados cuyo monto cambiaría */
WITH antes AS (
  SELECT id_tienda, fecha AS dia,
    SUM(CASE WHEN estado IN ('entregado','ausente') AND pago_velox <> 'PAGADO' THEN delivery_base + monto_adicional ELSE 0 END) AS cobrable,
    SUM(CASE WHEN estado IN ('entregado','ausente') THEN monto_cobrado
             WHEN estado = 'cancelado' AND pago_velox = 'PAGADO' THEN delivery_base + monto_adicional + monto_cobrado ELSE 0 END) AS cobrado
  FROM ordenes GROUP BY id_tienda, fecha
), despues AS (
  SELECT id_tienda, ISNULL(fecha_asignacion, fecha) AS dia,
    SUM(CASE WHEN estado IN ('entregado','ausente') AND pago_velox <> 'PAGADO' THEN delivery_base + monto_adicional ELSE 0 END) AS cobrable,
    SUM(CASE WHEN estado IN ('entregado','ausente') THEN monto_cobrado
             WHEN estado = 'cancelado' AND pago_velox = 'PAGADO' THEN delivery_base + monto_adicional + monto_cobrado ELSE 0 END) AS cobrado
  FROM ordenes GROUP BY id_tienda, ISNULL(fecha_asignacion, fecha)
)
SELECT t.nombre AS tienda, CONVERT(varchar, cp.fecha_ciclo, 23) AS dia_pagado,
       cp.monto_cobrar, cp.monto_devolver,
       ISNULL(a.cobrable, 0) - ISNULL(a.cobrado, 0) AS saldo_hoy,
       ISNULL(d.cobrable, 0) - ISNULL(d.cobrado, 0) AS saldo_despues
FROM caja_pagos_tiendas cp
JOIN tiendas t ON t.id = cp.id_tienda
LEFT JOIN antes   a ON a.id_tienda = cp.id_tienda AND a.dia = cp.fecha_ciclo
LEFT JOIN despues d ON d.id_tienda = cp.id_tienda AND d.dia = cp.fecha_ciclo
WHERE cp.pagado = 1
  AND (ISNULL(a.cobrable, 0) <> ISNULL(d.cobrable, 0) OR ISNULL(a.cobrado, 0) <> ISNULL(d.cobrado, 0))
ORDER BY cp.fecha_ciclo, t.nombre;

/* 2b. Motorizados: días pagados cuyo monto cambiaría */
WITH antes AS (
  SELECT id_motorizado, fecha AS dia,
    SUM(CASE WHEN estado IN ('entregado','ausente') THEN pago_moto_base + pago_moto_adicional ELSE 0 END) AS pago_moto,
    SUM(CASE WHEN estado IN ('entregado','ausente') THEN monto_cobrado ELSE 0 END) AS cobrado
  FROM ordenes WHERE id_motorizado IS NOT NULL GROUP BY id_motorizado, fecha
), despues AS (
  SELECT id_motorizado, ISNULL(fecha_asignacion, fecha) AS dia,
    SUM(CASE WHEN estado IN ('entregado','ausente') THEN pago_moto_base + pago_moto_adicional ELSE 0 END) AS pago_moto,
    SUM(CASE WHEN estado IN ('entregado','ausente') THEN monto_cobrado ELSE 0 END) AS cobrado
  FROM ordenes WHERE id_motorizado IS NOT NULL GROUP BY id_motorizado, ISNULL(fecha_asignacion, fecha)
)
SELECT m.nombre AS motorizado, CONVERT(varchar, cm.fecha_dia, 23) AS dia_pagado,
       cm.monto_a_pagar AS pagado_guardado, cm.monto_cobrado AS cobrado_guardado,
       ISNULL(a.pago_moto, 0) AS pago_hoy, ISNULL(d.pago_moto, 0) AS pago_despues,
       ISNULL(a.cobrado, 0)   AS cobrado_hoy, ISNULL(d.cobrado, 0) AS cobrado_despues
FROM caja_pagos_motorizados cm
JOIN motorizados m ON m.id = cm.id_motorizado
LEFT JOIN antes   a ON a.id_motorizado = cm.id_motorizado AND a.dia = cm.fecha_dia
LEFT JOIN despues d ON d.id_motorizado = cm.id_motorizado AND d.dia = cm.fecha_dia
WHERE cm.pagado = 1
  AND (ISNULL(a.pago_moto, 0) <> ISNULL(d.pago_moto, 0) OR ISNULL(a.cobrado, 0) <> ISNULL(d.cobrado, 0))
ORDER BY cm.fecha_dia, m.nombre;

/* 3. Resumen */
SELECT
  (SELECT COUNT(*) FROM ordenes WHERE fecha_asignacion IS NOT NULL AND fecha_asignacion <> fecha) AS ordenes_que_cambian_de_dia,
  (SELECT COUNT(*) FROM ordenes WHERE fecha_asignacion IS NOT NULL AND fecha_asignacion <> fecha
     AND (estado IN ('entregado','ausente') OR (estado = 'cancelado' AND pago_velox = 'PAGADO'))) AS de_esas_suman_en_caja,
  (SELECT COUNT(*) FROM caja_pagos_tiendas WHERE pagado = 1)     AS dias_pagados_tiendas,
  (SELECT COUNT(*) FROM caja_pagos_motorizados WHERE pagado = 1) AS dias_pagados_motorizados;
