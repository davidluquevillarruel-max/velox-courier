-- Ejecutar en SSMS para verificar estructura de caja_pagos_tiendas
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'caja_pagos_tiendas'
ORDER BY ORDINAL_POSITION;
