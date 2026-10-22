/* ============================================================
   limpiar_ordenes.sql — Borra TODAS las órdenes y lo que depende
   de ellas, y reinicia el identity de ordenes (el próximo id es 1).

   NO toca: tiendas, motorizados, usuarios, distritos, zonas,
   tarifas (viven en distritos) ni origenes.

   ⚠️ Es destructivo. Antes: BACKUP DATABASE. Correr con un usuario
   que pueda hacer DBCC CHECKIDENT (velox_user no puede), p. ej.:
     sqlcmd -S <servidor> -E -C -b -d velox_courier -i limpiar_ordenes.sql

   Las fotos (R2 o server/uploads_local/) NO se borran desde acá:
   solo sus filas en ordenes_fotos. Los archivos quedan huérfanos.
   ============================================================ */
SET NOCOUNT ON;
SET XACT_ABORT ON;
/* sqlcmd arranca con QUOTED_IDENTIFIER en OFF, y los índices
   filtrados de ordenes (id_creacion) lo exigen en ON para borrar */
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

BEGIN TRANSACTION;

  /* Hijas: ordenes_fotos apunta a ordenes por FK. Las dos de caja no
     tienen FK a ordenes, pero guardan qué días ya se pagaron: sin
     órdenes quedan sin sentido. */
  DELETE FROM ordenes_fotos;
  DELETE FROM caja_pagos_motorizados;
  DELETE FROM caja_pagos_tiendas;

  /* ordenes se apunta a sí misma (reprogramado_de): se corta antes */
  UPDATE ordenes SET reprogramado_de = NULL WHERE reprogramado_de IS NOT NULL;
  DELETE FROM ordenes;

  /* Con la tabla ya usada, RESEED 0 hace que el próximo id sea 1 */
  DBCC CHECKIDENT ('ordenes', RESEED, 0) WITH NO_INFOMSGS;

COMMIT TRANSACTION;

SELECT
  (SELECT COUNT(*) FROM ordenes)                AS ordenes,
  (SELECT COUNT(*) FROM ordenes_fotos)          AS ordenes_fotos,
  (SELECT COUNT(*) FROM caja_pagos_motorizados) AS caja_pagos_motorizados,
  (SELECT COUNT(*) FROM caja_pagos_tiendas)     AS caja_pagos_tiendas;
