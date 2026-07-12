-- ============================================================
--  VELOX COURIER — Agregar teléfono adicional del destinatario
--  Ejecutar en SSMS con velox_courier seleccionada
-- ============================================================
USE velox_courier;
GO

-- Solo se agrega si la columna no existe aún (evita error si se ejecuta 2 veces)
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.ordenes')
    AND name = 'dest_telefono_2'
)
BEGIN
    ALTER TABLE ordenes
    ADD dest_telefono_2 NVARCHAR(20) NULL;
END
GO

PRINT N'Columna dest_telefono_2 agregada correctamente (o ya existía).';
GO
