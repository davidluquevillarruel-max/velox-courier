/* ============================================================
   server/scripts/borrar_datos_prueba_cajas.sql
   Saca lo que creó datos_prueba_cajas.sql. SOLO PARA LA PC LOCAL.
   Únicamente toca la tienda y el motorizado "PRUEBA CAJA" y las
   órdenes PRB-*, en una transacción. Si alguien cargó fotos o
   liquidaciones de prueba, también se borran las de esa tienda.

     sqlcmd -S DESKTOP-E9N76IK -U sa -I -f 65001 -i server\scripts\borrar_datos_prueba_cajas.sql
   ============================================================ */
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;

IF @@SERVERNAME <> N'DESKTOP-E9N76IK'
BEGIN
  RAISERROR('Este script es solo para la PC local.', 16, 1);
  RETURN;
END

BEGIN TRANSACTION;

DECLARE @tienda INT = (SELECT id FROM tiendas WHERE nombre = N'PRUEBA CAJA');
DECLARE @moto INT = (SELECT id FROM motorizados WHERE nombre = N'PRUEBA CAJA');

DELETE f FROM ordenes_fotos f JOIN ordenes o ON o.id = f.id_orden WHERE o.codigo LIKE N'PRB-%';
DELETE FROM ordenes WHERE codigo LIKE N'PRB-%';

DELETE FROM caja_pagos_tiendas WHERE id_tienda = @tienda;
DELETE f FROM caja_liquidaciones_tiendas_fotos f
  JOIN caja_liquidaciones_tiendas l ON l.id = f.id_liquidacion WHERE l.id_tienda = @tienda;
DELETE FROM caja_liquidaciones_tiendas WHERE id_tienda = @tienda;
DELETE FROM caja_pagos_motorizados WHERE id_motorizado = @moto;
DELETE f FROM caja_liquidaciones_motorizados_fotos f
  JOIN caja_liquidaciones_motorizados l ON l.id = f.id_liquidacion WHERE l.id_motorizado = @moto;
DELETE FROM caja_liquidaciones_motorizados WHERE id_motorizado = @moto;

DELETE FROM tiendas WHERE id = @tienda;
DELETE FROM motorizados WHERE id = @moto;

COMMIT;
PRINT 'Datos de prueba borrados.';
