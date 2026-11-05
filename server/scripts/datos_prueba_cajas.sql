/* ============================================================
   server/scripts/datos_prueba_cajas.sql
   Datos de prueba de la Caja. SOLO PARA LA PC LOCAL: se niega a
   correr en otro servidor.

   Crea, en una transacción (todo o nada):
   · tienda "PRUEBA CAJA" y motorizado "PRUEBA CAJA", inactivos para
     que no aparezcan en las selecciones;
   · órdenes PRB-01 a PRB-18 del 1 al 5/10/2026, antes de los datos
     reales, así no se mezclan;
   · días ya pagados el 2, 3 y 4/10.
   No toca ninguna fila que ya exista. Los códigos PRB-* no afectan la
   numeración C-xxxx, que solo mira los que empiezan con "C-".

   Antes de correrlo, backup (carpeta Backup de SQL Server):
     sqlcmd -S DESKTOP-E9N76IK -U sa -Q "BACKUP DATABASE velox_courier TO DISK='velox_courier_antes_pruebas_cajas_20261105.bak' WITH INIT"

   Para correrlo:
     sqlcmd -S DESKTOP-E9N76IK -U sa -I -f 65001 -i server\scripts\datos_prueba_cajas.sql

   Para sacarlo: borrar_datos_prueba_cajas.sql

   Todas las órdenes: delivery 10, pago al moto 6.
   Resultado esperado en Caja Tienda, filtro del 01/10 al 04/10 (el 5/10
   queda afuera a propósito):
     Pendientes: 11 pedidos · delivery 110 · retenido 260 · saldo −180
     Pagados:     2 pedidos · delivery  20 · retenido 100 · saldo  −15
                  "Difiere de lo pagado" el 2/10 y el 4/10
     Todos:      13 pedidos · delivery 130 · retenido 360 · saldo −195
   Cuadre del 01/10 al 04/10 (verificar-cuadre-cajas.js):
     202 − 260 + 80 + 30 = 52 = 130 − 78
   Caja de motorizados, moto PRUEBA CAJA, filtro del 01/10 al 05/10:
     Pendientes: 12 pedidos · efectivo 170 · yape 50 · pago 72 · saldo 148
                 el 5/10 no se liquida (orden en proceso): liquidable 114
     Pagados:     2 pedidos · saldo guardado 94 · "Difiere" el 3/10
   ============================================================ */
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;

IF @@SERVERNAME <> N'DESKTOP-E9N76IK'
BEGIN
  RAISERROR('Este script es solo para la PC local.', 16, 1);
  RETURN;
END
IF EXISTS (SELECT 1 FROM ordenes WHERE codigo LIKE N'PRB-%')
   OR EXISTS (SELECT 1 FROM tiendas WHERE nombre = N'PRUEBA CAJA')
   OR EXISTS (SELECT 1 FROM motorizados WHERE nombre = N'PRUEBA CAJA')
BEGIN
  RAISERROR('Ya hay datos de prueba: corré primero borrar_datos_prueba_cajas.sql.', 16, 1);
  RETURN;
END

BEGIN TRANSACTION;

DECLARE @ahora DATETIME2 = SYSDATETIME();
DECLARE @tienda INT, @moto INT;
DECLARE @origen INT = (SELECT TOP 1 id FROM origenes ORDER BY id);
DECLARE @distrito INT = (SELECT TOP 1 id FROM distritos WHERE nombre <> N'SIN DEFINIR' ORDER BY id);

INSERT INTO tiendas (nombre, ciclo_pago, activa, creado_en, actualizado_en)
VALUES (N'PRUEBA CAJA', N'diario', 0, @ahora, @ahora);
SET @tienda = SCOPE_IDENTITY();

INSERT INTO motorizados (nombre, iniciales, color_avatar, activo, fecha_ingreso, creado_en, actualizado_en)
VALUES (N'PRUEBA CAJA', N'PC', N'av-blue', 0, '2026-10-01', @ahora, @ahora);
SET @moto = SCOPE_IDENTITY();

INSERT INTO ordenes
  (codigo, fecha, fecha_asignacion, id_tienda, id_origen, id_distrito, id_motorizado, dest_nombre,
   estado, metodo_pago, medio_pago, pago_velox, pago_velox_metodo,
   delivery_base, monto_adicional, monto_cobrado, monto_producto,
   pago_moto_base, pago_moto_adicional, producto_especial,
   devuelto, devuelto_tienda, datos_pendientes, creado_en, actualizado_en)
SELECT v.codigo, v.dia, v.dia, @tienda, @origen, @distrito, @moto, v.caso,
       v.estado, v.metodo, v.medio, v.velox, v.velox_metodo,
       10, 0, v.cobrado, CASE WHEN v.cobrado > 10 THEN v.cobrado - 10 ELSE 0 END,
       6, 0, 0,
       0, 0, 0, @ahora, @ahora
FROM (VALUES
  /* 1/10: día pendiente */
  (N'PRB-01', '2026-10-01', N'Efectivo moto 100',      N'entregado',    N'contraentrega', N'efectivo-motorizado', N'PENDIENTE', NULL,        100.00),
  (N'PRB-02', '2026-10-01', N'Yape moto 50',           N'entregado',    N'contraentrega', N'yape-motorizado',     N'PENDIENTE', NULL,         50.00),
  (N'PRB-03', '2026-10-01', N'Pago Velox 80',          N'entregado',    N'contraentrega', N'pago-empresa',        N'PENDIENTE', NULL,         80.00),
  (N'PRB-04', '2026-10-01', N'Pago tienda 60',         N'entregado',    N'contraentrega', N'pago-tienda',         N'PENDIENTE', NULL,         60.00),
  (N'PRB-05', '2026-10-01', N'Medio por definir 40',   N'entregado',    N'contraentrega', NULL,                   N'PENDIENTE', NULL,         40.00),
  (N'PRB-06', '2026-10-01', N'Sin cobro',              N'entregado',    N'sin-cobro',     NULL,                   N'PENDIENTE', NULL,          0.00),
  (N'PRB-07', '2026-10-01', N'Prepago efectivo',       N'entregado',    N'sin-cobro',     NULL,                   N'PAGADO',    N'efectivo',   0.00),
  (N'PRB-08', '2026-10-01', N'Prepago yape + efectivo 30', N'entregado', N'contraentrega', N'efectivo-motorizado', N'PAGADO',    N'yape',      30.00),
  (N'PRB-09', '2026-10-01', N'Prepago sin método',     N'entregado',    N'sin-cobro',     NULL,                   N'PAGADO',    NULL,          0.00),
  (N'PRB-10', '2026-10-01', N'Ausente con cobro 70',   N'ausente',      N'contraentrega', N'yape-motorizado',     N'PENDIENTE', NULL,         70.00),
  (N'PRB-11', '2026-10-01', N'Devolución',             N'devolucion',   N'sin-cobro',     NULL,                   N'PENDIENTE', NULL,          0.00),
  /* 1/10: no cobrables, no tienen que sumar */
  (N'PRB-12', '2026-10-01', N'Cancelado prepagado',    N'cancelado',    N'contraentrega', NULL,                   N'PAGADO',    N'yape',      50.00),
  (N'PRB-13', '2026-10-01', N'En proceso prepagado',   N'en-proceso',   N'sin-cobro',     NULL,                   N'PAGADO',    N'yape',       0.00),
  (N'PRB-14', '2026-10-01', N'Reprogramado',           N'reprogramado', N'contraentrega', NULL,                   N'PENDIENTE', NULL,         50.00),
  /* 2/10: día pagado, con otro monto guardado (tiene que decir "Difiere") */
  (N'PRB-15', '2026-10-02', N'Día pagado: difiere',    N'entregado',    N'contraentrega', N'efectivo-motorizado', N'PENDIENTE', NULL,        100.00),
  /* 3/10: día pagado, coincide */
  (N'PRB-16', '2026-10-03', N'Día pagado: coincide',   N'entregado',    N'sin-cobro',     NULL,                   N'PENDIENTE', NULL,          0.00),
  /* 5/10: día pendiente con una orden en proceso: no se puede liquidar al moto */
  (N'PRB-17', '2026-10-05', N'Efectivo moto 40',       N'entregado',    N'contraentrega', N'efectivo-motorizado', N'PENDIENTE', NULL,         40.00),
  (N'PRB-18', '2026-10-05', N'En proceso',             N'en-proceso',   N'sin-cobro',     NULL,                   N'PENDIENTE', NULL,          0.00)
) AS v(codigo, dia, caso, estado, metodo, medio, velox, velox_metodo, cobrado);

/* La prepagada en proceso del 1/10 está sin asignar: así ese día sí se
   puede liquidar al moto */
UPDATE ordenes SET id_motorizado = NULL WHERE codigo = N'PRB-13';

/* Días ya pagados de la tienda (como los viejos: sin liquidación).
   El 4/10 no tiene órdenes: lo pagado no tiene que desaparecer. */
INSERT INTO caja_pagos_tiendas (id_tienda, fecha_ciclo, monto_cobrar, monto_devolver, pagado, fecha_pago, creado_en)
VALUES (@tienda, '2026-10-02',  0.00, 50.00, 1, '2026-10-05', @ahora),
       (@tienda, '2026-10-03', 10.00,  0.00, 1, '2026-10-05', @ahora),
       (@tienda, '2026-10-04', 25.00,  0.00, 1, '2026-10-05', @ahora);

/* Días ya pagados del moto. Coincide el 2/10 (100 − 6); difiere el 3/10 */
INSERT INTO caja_pagos_motorizados
  (id_motorizado, fecha_dia, total_entregas, monto_a_pagar, monto_cobrado, adelantos, pagado, fecha_pago, creado_en)
VALUES (@moto, '2026-10-02', 1, 6.00, 100.00, 0, 1, '2026-10-05', @ahora),
       (@moto, '2026-10-03', 1, 0.00,   0.00, 0, 1, '2026-10-05', @ahora);

COMMIT;
PRINT 'Datos de prueba creados.';
