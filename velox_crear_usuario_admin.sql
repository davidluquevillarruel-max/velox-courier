-- ============================================================
--  VELOX COURIER — Crear usuario administrador
--  Ejecutar en SSMS con velox_courier seleccionada
--
--  Credenciales por defecto:
--    Email:    admin@velox.pe
--    Password: Velox2026!
--  (puedes cambiarlas luego desde el sistema o re-ejecutando
--   este script con un nuevo hash)
-- ============================================================
USE velox_courier;
GO

-- Limpiar si ya existe
DELETE FROM usuarios WHERE email = N'admin@velox.pe';
GO

INSERT INTO usuarios (nombre, email, password_hash, rol, activo)
VALUES (
  N'Administrador',
  N'admin@velox.pe',
  N'05834e6af07770760ee717b114ab95a1:3ae21cad1b1300df80fe778b66af6512ec5db1405e3f8eb1916e68fb040e3a1246a2c5955870863a830dd94b6d342b84182d955b8f88a550fb33ef970d76966e',
  N'admin',
  1
);
GO

PRINT N'Usuario admin creado correctamente.';
PRINT N'Email: admin@velox.pe';
PRINT N'Password: Velox2026!';
GO
