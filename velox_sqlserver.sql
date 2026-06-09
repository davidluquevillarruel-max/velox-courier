-- ============================================================
--  VELOX COURIER — Base de datos SQL Server
--  Compatible con SQL Server 2016+ / SSMS
--  Ejecutar en orden, sección por sección
-- ============================================================

-- ────────────────────────────────────────────────────────────
--  PASO 1: Crear la base de datos
--  Ejecuta esto primero, luego selecciona la BD y continúa
-- ────────────────────────────────────────────────────────────
CREATE DATABASE velox_courier
    COLLATE Modern_Spanish_CI_AI;
GO

USE velox_courier;
GO

-- ============================================================
--  TABLA 1: zonas
-- ============================================================
CREATE TABLE zonas (
    id        INT IDENTITY(1,1) PRIMARY KEY,
    nombre    NVARCHAR(50)  NOT NULL,
    activa    BIT           NOT NULL DEFAULT 1,
    creado_en DATETIME2     NOT NULL DEFAULT GETDATE(),
    CONSTRAINT uq_zonas_nombre UNIQUE (nombre)
);
GO

INSERT INTO zonas (nombre) VALUES
    (N'Norte/Este'),
    (N'Sur'),
    (N'Centro'),
    (N'Callao'),
    (N'Agencia'),
    (N'Otros');
GO

-- ============================================================
--  TABLA 2: distritos  (tarifario)
-- ============================================================
CREATE TABLE distritos (
    id                INT IDENTITY(1,1) PRIMARY KEY,
    nombre            NVARCHAR(100) NOT NULL,
    id_zona           INT           NOT NULL,
    precio_delivery   DECIMAL(8,2)  NOT NULL DEFAULT 0.00,
    pago_motorizado   DECIMAL(8,2)  NOT NULL DEFAULT 0.00,
    activo            BIT           NOT NULL DEFAULT 1,
    actualizado_en    DATETIME2     NOT NULL DEFAULT GETDATE(),
    creado_en         DATETIME2     NOT NULL DEFAULT GETDATE(),
    CONSTRAINT fk_distritos_zona FOREIGN KEY (id_zona)
        REFERENCES zonas(id),
    CONSTRAINT uq_distritos_nombre UNIQUE (nombre)
);
GO

-- Trigger para actualizar actualizado_en automáticamente
CREATE TRIGGER trg_distritos_update
ON distritos AFTER UPDATE AS
    UPDATE distritos SET actualizado_en = GETDATE()
    WHERE id IN (SELECT id FROM inserted);
GO

-- ============================================================
--  TABLA 3: origenes
-- ============================================================
CREATE TABLE origenes (
    id        INT IDENTITY(1,1) PRIMARY KEY,
    nombre    NVARCHAR(100) NOT NULL,
    direccion NVARCHAR(200),
    activo    BIT           NOT NULL DEFAULT 1,
    creado_en DATETIME2     NOT NULL DEFAULT GETDATE(),
    CONSTRAINT uq_origenes_nombre UNIQUE (nombre)
);
GO

INSERT INTO origenes (nombre) VALUES
    (N'GAMARRA'),
    (N'LIMA'),
    (N'CHORRILLOS');
GO

-- ============================================================
--  TABLA 4: tiendas  (clientes)
-- ============================================================
CREATE TABLE tiendas (
    id             INT IDENTITY(1,1) PRIMARY KEY,
    nombre         NVARCHAR(150) NOT NULL,
    ruc            NVARCHAR(11),
    contacto       NVARCHAR(150),
    telefono       NVARCHAR(20),
    direccion      NVARCHAR(250),
    ciclo_pago     NVARCHAR(20)  NOT NULL DEFAULT N'semanal'
                   CONSTRAINT chk_tiendas_ciclo
                   CHECK (ciclo_pago IN (N'diario',N'semanal',N'quincenal',N'mensual')),
    activa         BIT           NOT NULL DEFAULT 1,
    observaciones  NVARCHAR(MAX),
    creado_en      DATETIME2     NOT NULL DEFAULT GETDATE(),
    actualizado_en DATETIME2     NOT NULL DEFAULT GETDATE(),
    CONSTRAINT uq_tiendas_nombre UNIQUE (nombre)
);
GO

CREATE TRIGGER trg_tiendas_update
ON tiendas AFTER UPDATE AS
    UPDATE tiendas SET actualizado_en = GETDATE()
    WHERE id IN (SELECT id FROM inserted);
GO

CREATE INDEX idx_tiendas_activa ON tiendas(activa);
CREATE INDEX idx_tiendas_nombre ON tiendas(nombre);
GO

-- ============================================================
--  TABLA 5: motorizados
-- ============================================================
CREATE TABLE motorizados (
    id             INT IDENTITY(1,1) PRIMARY KEY,
    nombre         NVARCHAR(100) NOT NULL,
    iniciales      NVARCHAR(3),
    id_zona        INT,
    telefono       NVARCHAR(20),
    dni            NVARCHAR(8),
    placa          NVARCHAR(10),
    referencia     NVARCHAR(200),
    color_avatar   NVARCHAR(20)  NOT NULL DEFAULT N'av-blue'
                   CONSTRAINT chk_motos_color
                   CHECK (color_avatar IN (N'av-blue',N'av-teal',N'av-purple',N'av-amber')),
    activo         BIT           NOT NULL DEFAULT 1,
    fecha_ingreso  DATE          NOT NULL DEFAULT CAST(GETDATE() AS DATE),
    creado_en      DATETIME2     NOT NULL DEFAULT GETDATE(),
    actualizado_en DATETIME2     NOT NULL DEFAULT GETDATE(),
    CONSTRAINT fk_motorizados_zona FOREIGN KEY (id_zona)
        REFERENCES zonas(id),
    CONSTRAINT uq_motorizados_nombre UNIQUE (nombre)
);
GO

CREATE TRIGGER trg_motorizados_update
ON motorizados AFTER UPDATE AS
    UPDATE motorizados SET actualizado_en = GETDATE()
    WHERE id IN (SELECT id FROM inserted);
GO

CREATE INDEX idx_motorizados_activo ON motorizados(activo);
GO

-- ============================================================
--  TABLA 6: ordenes  (tabla central)
-- ============================================================
CREATE TABLE ordenes (
    id                  BIGINT IDENTITY(1,1) PRIMARY KEY,
    codigo              NVARCHAR(20)  NOT NULL,
    fecha               DATE          NOT NULL,
    hora_asignacion     TIME,
    id_tienda           INT           NOT NULL,
    id_origen           INT           NOT NULL,
    id_distrito         INT           NOT NULL,
    id_motorizado       INT,
    -- Destinatario
    dest_nombre         NVARCHAR(150),
    dest_telefono       NVARCHAR(20),
    dest_direccion      NVARCHAR(250),
    -- Estado y método
    estado              NVARCHAR(20)  NOT NULL DEFAULT N'en-proceso'
                        CONSTRAINT chk_ordenes_estado
                        CHECK (estado IN (
                            N'en-proceso',N'entregado',N'no-entregado',
                            N'ausente',N'reprogramado',N'cancelado',
                            N'cambio',N'devolucion',N'recojo'
                        )),
    metodo_pago         NVARCHAR(20)  DEFAULT N''
                        CONSTRAINT chk_ordenes_metodo
                        CHECK (metodo_pago IN (
                            N'efectivo',N'yape',N'plin',N'pos',
                            N'pago-tienda',N'sin-cobro',N''
                        )),
    pago_velox          NVARCHAR(20)  DEFAULT N''
                        CONSTRAINT chk_ordenes_pago_velox
                        CHECK (pago_velox IN (N'PAGADO',N'PENDIENTE',N'')),
    -- Montos delivery
    delivery_base       DECIMAL(8,2)  NOT NULL DEFAULT 0.00,
    monto_adicional     DECIMAL(8,2)  NOT NULL DEFAULT 0.00,
    monto_cobrado       DECIMAL(8,2)  NOT NULL DEFAULT 0.00,
    monto_producto      DECIMAL(8,2)  NOT NULL DEFAULT 0.00,
    -- Pago motorizado
    pago_moto_base      DECIMAL(8,2)  NOT NULL DEFAULT 0.00,
    pago_moto_adicional DECIMAL(8,2)  NOT NULL DEFAULT 0.00,
    -- Flags
    producto_especial   BIT           NOT NULL DEFAULT 0,
    observaciones       NVARCHAR(MAX),
    reprogramado_de     BIGINT,
    -- Auditoría
    creado_en           DATETIME2     NOT NULL DEFAULT GETDATE(),
    actualizado_en      DATETIME2     NOT NULL DEFAULT GETDATE(),
    -- Columnas calculadas (equivalente a GENERATED ALWAYS en MySQL)
    delivery_total      AS (delivery_base + monto_adicional),
    pago_moto_total     AS (pago_moto_base + pago_moto_adicional),
    -- FK
    CONSTRAINT fk_ordenes_tienda     FOREIGN KEY (id_tienda)
        REFERENCES tiendas(id),
    CONSTRAINT fk_ordenes_origen     FOREIGN KEY (id_origen)
        REFERENCES origenes(id),
    CONSTRAINT fk_ordenes_distrito   FOREIGN KEY (id_distrito)
        REFERENCES distritos(id),
    CONSTRAINT fk_ordenes_motorizado FOREIGN KEY (id_motorizado)
        REFERENCES motorizados(id),
    CONSTRAINT fk_ordenes_reprog     FOREIGN KEY (reprogramado_de)
        REFERENCES ordenes(id),
    CONSTRAINT uq_ordenes_codigo     UNIQUE (codigo)
);
GO

CREATE TRIGGER trg_ordenes_update
ON ordenes AFTER UPDATE AS
    UPDATE ordenes SET actualizado_en = GETDATE()
    WHERE id IN (SELECT id FROM inserted);
GO

-- Índices clave para rendimiento
CREATE INDEX idx_ordenes_fecha        ON ordenes(fecha);
CREATE INDEX idx_ordenes_estado       ON ordenes(estado);
CREATE INDEX idx_ordenes_tienda       ON ordenes(id_tienda);
CREATE INDEX idx_ordenes_motorizado   ON ordenes(id_motorizado);
CREATE INDEX idx_ordenes_fecha_moto   ON ordenes(fecha, id_motorizado);
CREATE INDEX idx_ordenes_fecha_tienda ON ordenes(fecha, id_tienda);
CREATE INDEX idx_ordenes_estado_fecha ON ordenes(estado, fecha);
GO

-- ============================================================
--  TABLA 7: caja_pagos_tiendas
-- ============================================================
CREATE TABLE caja_pagos_tiendas (
    id             BIGINT IDENTITY(1,1) PRIMARY KEY,
    id_tienda      INT           NOT NULL,
    fecha_ciclo    DATE          NOT NULL,
    monto_cobrar   DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    monto_devolver DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    pagado         BIT           NOT NULL DEFAULT 0,
    fecha_pago     DATETIME2,
    observaciones  NVARCHAR(MAX),
    creado_en      DATETIME2     NOT NULL DEFAULT GETDATE(),
    CONSTRAINT fk_caja_tiendas FOREIGN KEY (id_tienda)
        REFERENCES tiendas(id),
    CONSTRAINT uq_caja_tienda_fecha UNIQUE (id_tienda, fecha_ciclo)
);
GO

CREATE INDEX idx_caja_tienda_fecha  ON caja_pagos_tiendas(fecha_ciclo);
CREATE INDEX idx_caja_tienda_pagado ON caja_pagos_tiendas(pagado);
GO

-- ============================================================
--  TABLA 8: caja_pagos_motorizados
-- ============================================================
CREATE TABLE caja_pagos_motorizados (
    id              BIGINT IDENTITY(1,1) PRIMARY KEY,
    id_motorizado   INT           NOT NULL,
    fecha_dia       DATE          NOT NULL,
    total_entregas  INT           NOT NULL DEFAULT 0,
    monto_a_pagar   DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    monto_cobrado   DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    adelantos       DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    saldo_dia       AS (monto_cobrado - monto_a_pagar - adelantos),
    pagado          BIT           NOT NULL DEFAULT 0,
    fecha_pago      DATETIME2,
    observaciones   NVARCHAR(MAX),
    creado_en       DATETIME2     NOT NULL DEFAULT GETDATE(),
    CONSTRAINT fk_caja_motos FOREIGN KEY (id_motorizado)
        REFERENCES motorizados(id),
    CONSTRAINT uq_caja_moto_fecha UNIQUE (id_motorizado, fecha_dia)
);
GO

CREATE INDEX idx_caja_moto_fecha  ON caja_pagos_motorizados(fecha_dia);
CREATE INDEX idx_caja_moto_pagado ON caja_pagos_motorizados(pagado);
GO

-- ============================================================
--  TABLA 9: usuarios
-- ============================================================
CREATE TABLE usuarios (
    id            INT IDENTITY(1,1) PRIMARY KEY,
    nombre        NVARCHAR(100) NOT NULL,
    email         NVARCHAR(150) NOT NULL,
    password_hash NVARCHAR(255) NOT NULL,
    rol           NVARCHAR(20)  NOT NULL DEFAULT N'operador'
                  CONSTRAINT chk_usuarios_rol
                  CHECK (rol IN (N'admin',N'operador',N'visor')),
    activo        BIT           NOT NULL DEFAULT 1,
    ultimo_acceso DATETIME2,
    creado_en     DATETIME2     NOT NULL DEFAULT GETDATE(),
    CONSTRAINT uq_usuarios_email UNIQUE (email)
);
GO

-- ============================================================
--  VISTAS
-- ============================================================

-- Vista 1: órdenes con toda la info
CREATE OR ALTER VIEW v_ordenes_completas AS
SELECT
    o.id,
    o.codigo,
    o.fecha,
    o.hora_asignacion,
    t.nombre                AS tienda,
    ori.nombre              AS origen,
    d.nombre                AS distrito,
    z.nombre                AS zona,
    m.nombre                AS motorizado,
    o.dest_nombre,
    o.dest_telefono,
    o.dest_direccion,
    o.estado,
    o.metodo_pago,
    o.pago_velox,
    o.delivery_base,
    o.monto_adicional,
    o.delivery_total,
    o.monto_cobrado,
    o.monto_producto,
    o.pago_moto_base,
    o.pago_moto_adicional,
    o.pago_moto_total,
    o.producto_especial,
    o.observaciones,
    o.reprogramado_de,
    o.creado_en,
    o.actualizado_en
FROM ordenes o
JOIN tiendas    t   ON t.id   = o.id_tienda
JOIN origenes   ori ON ori.id = o.id_origen
JOIN distritos  d   ON d.id   = o.id_distrito
JOIN zonas      z   ON z.id   = d.id_zona
LEFT JOIN motorizados m ON m.id = o.id_motorizado;
GO

-- Vista 2: tarifario
CREATE OR ALTER VIEW v_tarifario AS
SELECT
    d.id,
    d.nombre       AS distrito,
    z.nombre       AS zona,
    d.precio_delivery,
    d.pago_motorizado,
    (d.precio_delivery - d.pago_motorizado) AS margen,
    d.activo,
    d.actualizado_en
FROM distritos d
JOIN zonas z ON z.id = d.id_zona;
GO

-- Vista 3: resumen diario por motorizado
CREATE OR ALTER VIEW v_resumen_moto_dia AS
SELECT
    o.fecha,
    m.id                                            AS id_motorizado,
    m.nombre                                        AS motorizado,
    z.nombre                                        AS zona,
    COUNT(*)                                        AS total,
    SUM(CASE WHEN o.estado='entregado'    THEN 1 ELSE 0 END) AS entregados,
    SUM(CASE WHEN o.estado='no-entregado' THEN 1 ELSE 0 END) AS no_entregados,
    SUM(CASE WHEN o.estado='ausente'      THEN 1 ELSE 0 END) AS ausentes,
    SUM(CASE WHEN o.estado='reprogramado' THEN 1 ELSE 0 END) AS reprogramados,
    SUM(CASE WHEN o.estado='cancelado'    THEN 1 ELSE 0 END) AS cancelados,
    ROUND(
        CAST(SUM(CASE WHEN o.estado='entregado' THEN 1 ELSE 0 END) AS FLOAT) /
        NULLIF(SUM(CASE WHEN o.estado IN ('entregado','no-entregado') THEN 1 ELSE 0 END),0) * 100
    , 1)                                            AS tasa_entrega,
    SUM(o.pago_moto_total)                          AS pago_total_moto,
    SUM(o.monto_cobrado)                            AS total_cobrado,
    SUM(o.delivery_total)                           AS delivery_generado
FROM ordenes o
JOIN motorizados m ON m.id = o.id_motorizado
JOIN distritos   d ON d.id = o.id_distrito
JOIN zonas       z ON z.id = d.id_zona
WHERE o.id_motorizado IS NOT NULL
GROUP BY o.fecha, m.id, m.nombre, z.nombre;
GO

-- Vista 4: resumen diario por tienda
CREATE OR ALTER VIEW v_resumen_tienda_dia AS
SELECT
    o.fecha,
    t.id                                            AS id_tienda,
    t.nombre                                        AS tienda,
    t.ciclo_pago,
    COUNT(*)                                        AS total,
    SUM(CASE WHEN o.estado='entregado'    THEN 1 ELSE 0 END) AS entregados,
    SUM(CASE WHEN o.estado='no-entregado' THEN 1 ELSE 0 END) AS no_entregados,
    SUM(CASE WHEN o.estado='reprogramado' THEN 1 ELSE 0 END) AS reprogramados,
    SUM(CASE WHEN o.estado IN ('entregado','no-entregado')
             THEN o.delivery_total ELSE 0 END)      AS delivery_cobrable,
    SUM(o.monto_cobrado)                            AS monto_cobrado,
    SUM(o.monto_producto)                           AS producto_a_devolver,
    SUM(CASE WHEN o.estado IN ('entregado','no-entregado')
             THEN o.delivery_total ELSE 0 END)
    - SUM(o.monto_producto)                         AS saldo_neto
FROM ordenes o
JOIN tiendas t ON t.id = o.id_tienda
GROUP BY o.fecha, t.id, t.nombre, t.ciclo_pago;
GO

-- Vista 5: liquidez diaria
CREATE OR ALTER VIEW v_liquidez_diaria AS
SELECT
    o.fecha,
    COUNT(*)                                        AS pedidos,
    SUM(CASE WHEN o.estado IN ('entregado','no-entregado')
             THEN o.delivery_total ELSE 0 END)      AS bruto,
    SUM(o.pago_moto_total)                          AS pago_motorizados,
    SUM(o.monto_producto)                           AS devoluciones,
    SUM(CASE WHEN o.estado IN ('entregado','no-entregado')
             THEN o.delivery_total ELSE 0 END)
    - SUM(o.pago_moto_total)
    - SUM(o.monto_producto)                         AS liquido_neto
FROM ordenes o
GROUP BY o.fecha;
GO

-- ============================================================
--  STORED PROCEDURES
-- ============================================================

-- SP 1: Registrar/actualizar saldo de tienda por fecha
CREATE OR ALTER PROCEDURE sp_registrar_pago_tienda
    @p_id_tienda   INT,
    @p_fecha_ciclo DATE
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @v_cobrar   DECIMAL(10,2);
    DECLARE @v_devolver DECIMAL(10,2);

    SELECT
        @v_cobrar   = SUM(CASE WHEN estado IN ('entregado','no-entregado')
                               THEN delivery_total ELSE 0 END),
        @v_devolver = SUM(monto_producto)
    FROM ordenes
    WHERE id_tienda = @p_id_tienda AND fecha = @p_fecha_ciclo;

    SET @v_cobrar   = ISNULL(@v_cobrar,   0);
    SET @v_devolver = ISNULL(@v_devolver, 0);

    IF EXISTS (SELECT 1 FROM caja_pagos_tiendas
               WHERE id_tienda = @p_id_tienda AND fecha_ciclo = @p_fecha_ciclo)
        UPDATE caja_pagos_tiendas
        SET    monto_cobrar   = @v_cobrar,
               monto_devolver = @v_devolver
        WHERE  id_tienda  = @p_id_tienda
        AND    fecha_ciclo = @p_fecha_ciclo;
    ELSE
        INSERT INTO caja_pagos_tiendas (id_tienda, fecha_ciclo, monto_cobrar, monto_devolver)
        VALUES (@p_id_tienda, @p_fecha_ciclo, @v_cobrar, @v_devolver);
END;
GO

-- SP 2: Marcar pago de tienda como realizado
CREATE OR ALTER PROCEDURE sp_marcar_pago_tienda
    @p_id_tienda   INT,
    @p_fecha_ciclo DATE
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE caja_pagos_tiendas
    SET    pagado     = 1,
           fecha_pago = GETDATE()
    WHERE  id_tienda  = @p_id_tienda
    AND    fecha_ciclo = @p_fecha_ciclo;
END;
GO

-- SP 3: Liquidar día de un motorizado
CREATE OR ALTER PROCEDURE sp_liquidar_moto_dia
    @p_id_motorizado INT,
    @p_fecha_dia     DATE
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @v_entregas  INT;
    DECLARE @v_pago_moto DECIMAL(10,2);
    DECLARE @v_cobrado   DECIMAL(10,2);

    SELECT
        @v_entregas  = SUM(CASE WHEN estado='entregado' THEN 1 ELSE 0 END),
        @v_pago_moto = SUM(pago_moto_total),
        @v_cobrado   = SUM(monto_cobrado)
    FROM ordenes
    WHERE id_motorizado = @p_id_motorizado AND fecha = @p_fecha_dia;

    IF EXISTS (SELECT 1 FROM caja_pagos_motorizados
               WHERE id_motorizado = @p_id_motorizado AND fecha_dia = @p_fecha_dia)
        UPDATE caja_pagos_motorizados
        SET    total_entregas = ISNULL(@v_entregas,0),
               monto_a_pagar  = ISNULL(@v_pago_moto,0),
               monto_cobrado  = ISNULL(@v_cobrado,0),
               pagado         = 1,
               fecha_pago     = GETDATE()
        WHERE  id_motorizado = @p_id_motorizado AND fecha_dia = @p_fecha_dia;
    ELSE
        INSERT INTO caja_pagos_motorizados
            (id_motorizado, fecha_dia, total_entregas, monto_a_pagar, monto_cobrado, pagado, fecha_pago)
        VALUES
            (@p_id_motorizado, @p_fecha_dia,
             ISNULL(@v_entregas,0), ISNULL(@v_pago_moto,0), ISNULL(@v_cobrado,0), 1, GETDATE());
END;
GO

-- SP 4: Reprogramar orden al día siguiente
CREATE OR ALTER PROCEDURE sp_reprogramar_orden
    @p_id_original BIGINT,
    @p_fecha_nueva DATE,
    @p_nuevo_codigo NVARCHAR(20) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @v_max_num INT;

    SELECT @v_max_num = MAX(CAST(SUBSTRING(codigo, 3, LEN(codigo)) AS INT))
    FROM ordenes WHERE codigo LIKE 'C-%';

    SET @p_nuevo_codigo = N'C-' + CAST(@v_max_num + 1 AS NVARCHAR);

    INSERT INTO ordenes (
        codigo, fecha, id_tienda, id_origen, id_distrito,
        dest_nombre, dest_telefono, dest_direccion,
        estado, delivery_base, monto_adicional,
        pago_moto_base, pago_moto_adicional,
        producto_especial, observaciones, reprogramado_de
    )
    SELECT
        @p_nuevo_codigo, @p_fecha_nueva, id_tienda, id_origen, id_distrito,
        dest_nombre, dest_telefono, dest_direccion,
        N'en-proceso', delivery_base, monto_adicional,
        pago_moto_base, pago_moto_adicional,
        producto_especial,
        N'Reprogramado de ' + codigo,
        @p_id_original
    FROM ordenes WHERE id = @p_id_original;

    UPDATE ordenes SET estado = N'reprogramado' WHERE id = @p_id_original;
END;
GO

PRINT N'Base de datos Velox Courier creada exitosamente.';
GO
