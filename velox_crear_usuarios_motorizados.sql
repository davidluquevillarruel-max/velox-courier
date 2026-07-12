-- ============================================================
--  VELOX COURIER — Agregar rol 'motorizado' + vincular usuarios
--  Ejecutar en SSMS con velox_courier seleccionada
-- ============================================================
USE velox_courier;
GO

-- 1) Agregar columna id_motorizado a usuarios (vínculo 1 a 1 con motorizados)
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.usuarios') AND name = 'id_motorizado'
)
BEGIN
    ALTER TABLE usuarios ADD id_motorizado INT NULL
        CONSTRAINT fk_usuarios_motorizado FOREIGN KEY REFERENCES motorizados(id);
END
GO

-- 2) Actualizar el CHECK de rol para incluir 'motorizado'
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chk_usuarios_rol')
BEGIN
    ALTER TABLE usuarios DROP CONSTRAINT chk_usuarios_rol;
END
GO
ALTER TABLE usuarios ADD CONSTRAINT chk_usuarios_rol
    CHECK (rol IN (N'admin',N'operador',N'visor',N'motorizado'));
GO

-- 3) Crear un usuario por cada motorizado activo
--    Email:    [nombre-sin-espacios]@velox.pe
--    Password: [NOMBREsinespacios]Velox2026!

DELETE FROM usuarios WHERE email = N'alex@velox.pe';
INSERT INTO usuarios (nombre, email, password_hash, rol, activo, id_motorizado)
SELECT N'ALEX', N'alex@velox.pe', N'ff83c84fc350ae379818cfef519cff23:5acf90cf9b354e313bb7032720dc212032e5efdae45baa260f41f0072e9709a8d06d40000e626b527932632ff4e8432e53ce3e57cf7ac7b57fd5e09386be24c0', N'motorizado', 1, m.id
FROM motorizados m WHERE m.nombre = N'ALEX';
GO

DELETE FROM usuarios WHERE email = N'andre@velox.pe';
INSERT INTO usuarios (nombre, email, password_hash, rol, activo, id_motorizado)
SELECT N'ANDRE', N'andre@velox.pe', N'660b2d6f0e161cf6d7a6b0c9340bad78:2aebe1fd278df575b80d1929fa1533866423b07287a61c238907021e79310a4ac6d7c2ba9a313651e2052905d50c2b426808493f45555c108df9b8d0138303b0', N'motorizado', 1, m.id
FROM motorizados m WHERE m.nombre = N'ANDRE';
GO

DELETE FROM usuarios WHERE email = N'daniela@velox.pe';
INSERT INTO usuarios (nombre, email, password_hash, rol, activo, id_motorizado)
SELECT N'DANIELA', N'daniela@velox.pe', N'f9f0b00b4d2e8d17fef8f228bc2c1807:cc10de50c7aab6ff9804a505bff1b41e106f3fc0b8f5c41d3fa4689215b58eadf7d0218e109d9062c1f4ef713f51ba6e8d27cc17f7f6df72a25a081ad8e9cced', N'motorizado', 1, m.id
FROM motorizados m WHERE m.nombre = N'DANIELA';
GO

DELETE FROM usuarios WHERE email = N'dany@velox.pe';
INSERT INTO usuarios (nombre, email, password_hash, rol, activo, id_motorizado)
SELECT N'DANY', N'dany@velox.pe', N'938f8fb9a21d42c873b398dc56485860:a4b4114f1b939d24ab5a8a0b52073a7f30bb70478d379201525f456d613b6c94845358099c92cc487b5f583fc0f57168194207ea3757be706bb0bc14e7c69ad3', N'motorizado', 1, m.id
FROM motorizados m WHERE m.nombre = N'DANY';
GO

DELETE FROM usuarios WHERE email = N'diego@velox.pe';
INSERT INTO usuarios (nombre, email, password_hash, rol, activo, id_motorizado)
SELECT N'DIEGO', N'diego@velox.pe', N'1d1c562441d2c51c53b1cd05f06d6f42:0989ca419f881d8b0dede6ca4bd03e962fe4ebdd498fc90dcd6e8fe101293f7723dbee3e2476e4098be243f4faab8aeb2a034925a3c12a4207acc593cf8b01f2', N'motorizado', 1, m.id
FROM motorizados m WHERE m.nombre = N'DIEGO';
GO

DELETE FROM usuarios WHERE email = N'expres@velox.pe';
INSERT INTO usuarios (nombre, email, password_hash, rol, activo, id_motorizado)
SELECT N'Expres', N'expres@velox.pe', N'17143c8e35ceb5de9732db26c3dc3029:46dde5e775a67b4472e1588f4e3de8466aab85fbc40842f57bd2ca4398ec9f48e82fe7c75bdf0a5215ad83e3770d4d222b743206423f8c952bfe1108c4208766', N'motorizado', 1, m.id
FROM motorizados m WHERE m.nombre = N'Expres';
GO

DELETE FROM usuarios WHERE email = N'henrry@velox.pe';
INSERT INTO usuarios (nombre, email, password_hash, rol, activo, id_motorizado)
SELECT N'HENRRY', N'henrry@velox.pe', N'7f1f62aeac34aa6114d1a1ca116d899f:925f959ab2e83367fa77cbcababeb6d0e4fd3f55b49e9b58cf07aa6e03f83b1fb040360313f59f163374d8670c88b1ecfded0734396c69656e2b8ab0be708ac9', N'motorizado', 1, m.id
FROM motorizados m WHERE m.nombre = N'HENRRY';
GO

DELETE FROM usuarios WHERE email = N'jeanpier@velox.pe';
INSERT INTO usuarios (nombre, email, password_hash, rol, activo, id_motorizado)
SELECT N'JEANPIER', N'jeanpier@velox.pe', N'c3ee58ee9c49178c7f53bfd2a46a5ee2:d9463354810501d06330157c98af0e56989b8e74dfd139e95f9f8373f3e31060232176ee751c6d48a2c085adc34ce6fe3d549c6e374b3760cfbedde861f8d2a8', N'motorizado', 1, m.id
FROM motorizados m WHERE m.nombre = N'JEANPIER';
GO

DELETE FROM usuarios WHERE email = N'jose@velox.pe';
INSERT INTO usuarios (nombre, email, password_hash, rol, activo, id_motorizado)
SELECT N'JOSE', N'jose@velox.pe', N'a92582951bc08ce551ac0010b788f97f:2c1e76adfaf6dce7ac906403db7ef9a2639f2b6160051fae899b83cd24029c39068041b974ff76e890414e1b00291f36dbaf0777399730bf931176960590ce45', N'motorizado', 1, m.id
FROM motorizados m WHERE m.nombre = N'JOSE';
GO

DELETE FROM usuarios WHERE email = N'joseanampa@velox.pe';
INSERT INTO usuarios (nombre, email, password_hash, rol, activo, id_motorizado)
SELECT N'JOSE ANAMPA', N'joseanampa@velox.pe', N'fcfb078135d7ef1b5a8d5dd0a0b10215:cd1d937cf4df0e7a9ccc84927c7ab888381199ee19d90aba4822d8e593651cee0f0b51cc02ab1ef9ebbcfdfd756952ec7267ff30d5de1dc8669a5108573a61e7', N'motorizado', 1, m.id
FROM motorizados m WHERE m.nombre = N'JOSE ANAMPA';
GO

DELETE FROM usuarios WHERE email = N'josefelix@velox.pe';
INSERT INTO usuarios (nombre, email, password_hash, rol, activo, id_motorizado)
SELECT N'JOSE FELIX', N'josefelix@velox.pe', N'2c2b4f0d52c51b099cdc851817f6e728:3353d590b0fd1e737e0ca7f5225551a73fd4a79ca44461b65af3bb326c86a76c8d67c4335528270ef0b68d64029c09dc0dea6ccec2ee4d59742f083b6d9ba721', N'motorizado', 1, m.id
FROM motorizados m WHERE m.nombre = N'JOSE FELIX';
GO

DELETE FROM usuarios WHERE email = N'josepalacios@velox.pe';
INSERT INTO usuarios (nombre, email, password_hash, rol, activo, id_motorizado)
SELECT N'JOSE PALACIOS', N'josepalacios@velox.pe', N'92d6327750c2fae005294e3cf6e10a45:576dca64c469ee382a3a1da66e0f7a8939f349f21705ea32d5a3a5d06e4a78663d3aa9e8041432512287ae21ebdb393ebd8bc202350e099e6aec17cc6d696ea7', N'motorizado', 1, m.id
FROM motorizados m WHERE m.nombre = N'JOSE PALACIOS';
GO

DELETE FROM usuarios WHERE email = N'kevin@velox.pe';
INSERT INTO usuarios (nombre, email, password_hash, rol, activo, id_motorizado)
SELECT N'KEVIN', N'kevin@velox.pe', N'd807138ec1fdd4a7cd98c37256b17368:dd963c28e2ca0bb2bdcc22fe73b0c159e0c0b3228a1fbb7c33ee90931bd272b88b3cdbac13449686128a2be5b0aee19a7f74a6c8b739b9bd631a8f0a2e282a6e', N'motorizado', 1, m.id
FROM motorizados m WHERE m.nombre = N'KEVIN';
GO

DELETE FROM usuarios WHERE email = N'leandro@velox.pe';
INSERT INTO usuarios (nombre, email, password_hash, rol, activo, id_motorizado)
SELECT N'LEANDRO', N'leandro@velox.pe', N'444c1d6147342543219fb32eaca96ac6:4cd90329bea71cbb4993d744dcdf821c23543e359fa5ec0831635dc03b23cf26c86f0f3e65bbef5efe3cc029e030a331f45d6039af47e50e9463706f98e67c2f', N'motorizado', 1, m.id
FROM motorizados m WHERE m.nombre = N'LEANDRO';
GO

DELETE FROM usuarios WHERE email = N'luispalacios@velox.pe';
INSERT INTO usuarios (nombre, email, password_hash, rol, activo, id_motorizado)
SELECT N'LUIS PALACIOS', N'luispalacios@velox.pe', N'2b754d013b7badcdc00e13c87f2df637:a1a7e964298773d2922533b132319bd83bdbfd8520397d4fb6cca6d7c4a747f825e4005a9b07f5caa656549493cc85371d8c70f2b5d556f891ed8ec1d8ae7757', N'motorizado', 1, m.id
FROM motorizados m WHERE m.nombre = N'LUIS PALACIOS';
GO

DELETE FROM usuarios WHERE email = N'miguel@velox.pe';
INSERT INTO usuarios (nombre, email, password_hash, rol, activo, id_motorizado)
SELECT N'MIGUEL', N'miguel@velox.pe', N'547d7904db34344e6e16058f9251272f:a91a2d64fcb3891ea89d327c4a8b9b2be38c33c7c2dbeb7cf75f8fd488da225c8a82d16a9f817e7301f1a7ba8130df3d7c504b2be794c219669b3b64b855d06a', N'motorizado', 1, m.id
FROM motorizados m WHERE m.nombre = N'MIGUEL';
GO

DELETE FROM usuarios WHERE email = N'yordi@velox.pe';
INSERT INTO usuarios (nombre, email, password_hash, rol, activo, id_motorizado)
SELECT N'YORDI', N'yordi@velox.pe', N'0844f0f721eef03c54dd1cbf145b556c:f6f68c57b79288b22933c9d3c4cd1f825945b733d84b6438dc6486a1176c14aed3115542d7ce8cd77d83a6c2af29e32ca6064ff222090e3b4a14de6609e1ac20', N'motorizado', 1, m.id
FROM motorizados m WHERE m.nombre = N'YORDI';
GO

PRINT N'Usuarios de motorizados creados correctamente.';
PRINT N'Contraseña para todos: [NOMBRE_SIN_ESPACIOS]Velox2026!';
GO

-- Verificación
SELECT u.id, u.nombre, u.email, u.rol, u.id_motorizado, m.nombre AS motorizado_vinculado
FROM usuarios u
LEFT JOIN motorizados m ON m.id = u.id_motorizado
WHERE u.rol = 'motorizado'
ORDER BY u.nombre;
GO