/* ============================================================
   limpiar_ordenes_y_caja.sql
   Borra TODAS las órdenes, toda la Caja y lo que dependa de ellas.
   Reinicia sus identity: el próximo id de cada tabla es 1.

   ⚠️ DESTRUCTIVO. Corre en la base en la que lo abras. Antes: BACKUP
   DATABASE. Con la app parada (pm2 stop velox), para que nadie cargue
   nada en el medio.
     sqlcmd -S <servidor> -U sa -d velox_courier -I -b -f 65001 -i limpiar_ordenes_y_caja.sql

   QUÉ BORRA: dbo.ordenes + las tablas dbo.caja_* + toda tabla que
   dependa de ellas por FK, directa o indirectamente. Los dependientes
   salen del esquema (sys.foreign_keys) cada vez que corre: una tabla
   nueva con FK a estas entra sola. El orden de borrado también sale de
   las FK: primero las hijas.

   QUÉ NO TOCA: usuarios, tiendas, motorizados, distritos (incluye las
   tarifas), zonas, origenes, ni ninguna otra tabla fuera de lo de
   arriba. Si una de las protegidas apareciera como dependiente, el
   script se niega a seguir y no borra nada.

   SEGURIDAD: una sola transacción con XACT_ABORT ON. Antes de confirmar
   revisa que lo borrado quedó en 0 y que el resto de las tablas no
   cambió; si no, deshace todo. sqlcmd -b hace que un error dé código
   de salida distinto de 0.

   NO BORRA: los archivos de fotos (R2 o uploads_local): quedan huérfanos.
   ============================================================ */
SET NOCOUNT ON;
SET XACT_ABORT ON;
/* El índice filtrado de ordenes.id_creacion lo exige en ON para borrar */
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;

IF OBJECT_ID('dbo.ordenes', 'U') IS NULL
  THROW 50001, 'No existe dbo.ordenes: esta no es la base de Velox. No se hizo nada.', 1;

PRINT CONCAT('Servidor: ', @@SERVERNAME, ' | Base: ', DB_NAME());

DECLARE @protegidas TABLE (nombre SYSNAME PRIMARY KEY);
INSERT INTO @protegidas VALUES
  (N'usuarios'), (N'tiendas'), (N'motorizados'), (N'distritos'),
  (N'zonas'), (N'tarifas'), (N'origenes');

/* Tablas a vaciar: las raíces + todo lo que cuelgue de ellas por FK */
DECLARE @objetivo TABLE (id INT PRIMARY KEY, nombre SYSNAME NOT NULL, borrada BIT NOT NULL DEFAULT 0);
INSERT INTO @objetivo (id, nombre)
SELECT t.object_id, t.name FROM sys.tables t
WHERE t.schema_id = SCHEMA_ID('dbo') AND (t.name = N'ordenes' OR t.name LIKE N'caja[_]%');

DECLARE @filas INT = 1;
WHILE @filas > 0
BEGIN
  INSERT INTO @objetivo (id, nombre)
  SELECT DISTINCT fk.parent_object_id, OBJECT_NAME(fk.parent_object_id)
  FROM sys.foreign_keys fk
  JOIN @objetivo o ON o.id = fk.referenced_object_id
  WHERE NOT EXISTS (SELECT 1 FROM @objetivo x WHERE x.id = fk.parent_object_id);
  SET @filas = @@ROWCOUNT;
END

/* Una protegida no se vacía nunca, aunque dependa de una orden */
DECLARE @choque NVARCHAR(400) = NULL;
SELECT @choque = STRING_AGG(o.nombre, N', ')
FROM @objetivo o JOIN @protegidas p ON p.nombre = o.nombre;
IF @choque IS NOT NULL
BEGIN
  DECLARE @msgChoque NVARCHAR(600) = CONCAT(N'Estas tablas protegidas dependen de lo que se va a borrar: ', @choque, N'. No se hizo nada.');
  THROW 50002, @msgChoque, 1;
END

/* Foto de cuántas filas tiene cada tabla de la base antes de empezar */
DECLARE @conteos TABLE (tabla SYSNAME PRIMARY KEY, se_vacia BIT NOT NULL, antes BIGINT NULL, despues BIGINT NULL);
INSERT INTO @conteos (tabla, se_vacia)
SELECT t.name, CASE WHEN EXISTS (SELECT 1 FROM @objetivo o WHERE o.id = t.object_id) THEN 1 ELSE 0 END
FROM sys.tables t WHERE t.schema_id = SCHEMA_ID('dbo') AND t.is_ms_shipped = 0;

DECLARE @tabla SYSNAME, @idTabla INT, @sql NVARCHAR(MAX), @n BIGINT;

DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT tabla FROM @conteos;
OPEN c; FETCH NEXT FROM c INTO @tabla;
WHILE @@FETCH_STATUS = 0
BEGIN
  SET @sql = N'SELECT @n = COUNT_BIG(*) FROM dbo.' + QUOTENAME(@tabla);
  EXEC sp_executesql @sql, N'@n BIGINT OUTPUT', @n = @n OUTPUT;
  UPDATE @conteos SET antes = @n WHERE tabla = @tabla;
  FETCH NEXT FROM c INTO @tabla;
END
CLOSE c; DEALLOCATE c;

BEGIN TRANSACTION;

  /* De hijas a padres: se borra una tabla cuando ya no queda ninguna
     pendiente que la referencie. Si no hay ninguna posible, hay un ciclo. */
  WHILE EXISTS (SELECT 1 FROM @objetivo WHERE borrada = 0)
  BEGIN
    SET @idTabla = NULL;
    SELECT TOP 1 @idTabla = o.id, @tabla = o.nombre
    FROM @objetivo o
    WHERE o.borrada = 0
      AND NOT EXISTS (
        SELECT 1 FROM sys.foreign_keys fk
        JOIN @objetivo h ON h.id = fk.parent_object_id AND h.borrada = 0
        WHERE fk.referenced_object_id = o.id AND fk.parent_object_id <> o.id
      )
    ORDER BY o.nombre;

    IF @idTabla IS NULL
      THROW 50003, 'Hay un ciclo de FK entre las tablas a borrar. Se deshizo todo.', 1;

    /* Una FK a sí misma (ordenes.reprogramado_de) se corta antes */
    SET @sql = NULL;
    SELECT @sql = STRING_AGG(CAST(N'UPDATE dbo.' + QUOTENAME(@tabla) + N' SET ' + QUOTENAME(c.name) + N' = NULL WHERE ' + QUOTENAME(c.name) + N' IS NOT NULL;' AS NVARCHAR(MAX)), N' ')
    FROM sys.foreign_key_columns fkc
    JOIN sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
    WHERE fkc.parent_object_id = @idTabla AND fkc.referenced_object_id = @idTabla;
    IF @sql IS NOT NULL EXEC sp_executesql @sql;

    SET @sql = N'DELETE FROM dbo.' + QUOTENAME(@tabla) + N'; SET @n = @@ROWCOUNT;';
    EXEC sp_executesql @sql, N'@n BIGINT OUTPUT', @n = @n OUTPUT;
    PRINT CONCAT('Borradas ', @n, ' filas de ', @tabla);

    UPDATE @objetivo SET borrada = 1 WHERE id = @idTabla;
  END

  /* El próximo id de cada una vuelve a 1. Una tabla que nunca tuvo filas
     se saltea: con RESEED 0, su primer id sería 0 en vez de 1. */
  DECLARE r CURSOR LOCAL FAST_FORWARD FOR
    SELECT o.nombre FROM @objetivo o
    JOIN sys.identity_columns ic ON ic.object_id = o.id
    WHERE ic.last_value IS NOT NULL;
  OPEN r; FETCH NEXT FROM r INTO @tabla;
  WHILE @@FETCH_STATUS = 0
  BEGIN
    SET @sql = N'DBCC CHECKIDENT (''dbo.' + REPLACE(QUOTENAME(@tabla), N'''', N'''''') + N''', RESEED, 0) WITH NO_INFOMSGS;';
    EXEC sp_executesql @sql;
    FETCH NEXT FROM r INTO @tabla;
  END
  CLOSE r; DEALLOCATE r;

  /* Control final, todavía dentro de la transacción */
  DECLARE d CURSOR LOCAL FAST_FORWARD FOR SELECT tabla FROM @conteos;
  OPEN d; FETCH NEXT FROM d INTO @tabla;
  WHILE @@FETCH_STATUS = 0
  BEGIN
    SET @sql = N'SELECT @n = COUNT_BIG(*) FROM dbo.' + QUOTENAME(@tabla);
    EXEC sp_executesql @sql, N'@n BIGINT OUTPUT', @n = @n OUTPUT;
    UPDATE @conteos SET despues = @n WHERE tabla = @tabla;
    FETCH NEXT FROM d INTO @tabla;
  END
  CLOSE d; DEALLOCATE d;

  IF EXISTS (SELECT 1 FROM @conteos WHERE se_vacia = 1 AND despues <> 0)
    THROW 50004, 'Una tabla a vaciar no quedó en 0. Se deshizo todo.', 1;
  IF EXISTS (SELECT 1 FROM @conteos WHERE se_vacia = 0 AND despues <> antes)
    THROW 50005, 'Una tabla que no se debía tocar cambió. Se deshizo todo.', 1;

COMMIT TRANSACTION;

SELECT CASE se_vacia WHEN 1 THEN 'VACIADA' ELSE 'intacta' END AS resultado,
       tabla, antes, despues
FROM @conteos
ORDER BY se_vacia DESC, tabla;

PRINT 'Listo: transacción confirmada.';
