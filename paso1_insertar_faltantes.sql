-- ============================================================
-- PASO 1: Insertar tiendas, motorizados y distritos faltantes
-- Ejecutar ANTES del script de órdenes
-- ============================================================
USE velox_courier;
GO

-- ════════════════════════════════════════════
-- TIENDAS NUEVAS (las que no están en la BD)
-- ════════════════════════════════════════════
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT '2BLEA','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='2BLEA');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'AIDE','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='AIDE');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'AILANY','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='AILANY');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'ALMOD','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='ALMOD');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'BARUMA','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='BARUMA');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'BEAUTY','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='BEAUTY');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'BELLA ALE','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='BELLA ALE');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'CONCETTO','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='CONCETTO');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'DAYAMODA','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='DAYAMODA');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'DEILY259','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='DEILY259');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'ESTILO Y BELLEZA','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='ESTILO Y BELLEZA');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'EXPLICITY','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='EXPLICITY');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'FAJAS ADHARA','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='FAJAS ADHARA');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'FERNANDO','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='FERNANDO');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'GALERIA YUYI','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='GALERIA YUYI');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'GIO','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='GIO');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'GLORI MAR','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='GLORI MAR');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'HECTOR','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='HECTOR');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'ISABEL TALAVERA','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='ISABEL TALAVERA');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'JOLY','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='JOLY');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'JOSE','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='JOSE');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'KAWAASH','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='KAWAASH');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'KLEIDES','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='KLEIDES');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'LIBERTY','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='LIBERTY');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'LUZ','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='LUZ');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'MACSHI','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='MACSHI');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'MATIS','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='MATIS');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'MC COUTURE','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='MC COUTURE');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'MERCH PERU','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='MERCH PERU');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'ORBAU','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='ORBAU');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'PAKY','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='PAKY');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'PANDAS','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='PANDAS');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'PAU','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='PAU');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'PINPOYO CREACIONES','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='PINPOYO CREACIONES');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'QM','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='QM');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'SHORY','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='SHORY');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'SOANA','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='SOANA');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'TAWAKI','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='TAWAKI');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'TEXTILERIA','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='TEXTILERIA');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'TODO HOGAR','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='TODO HOGAR');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'VELVET LOVE','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='VELVET LOVE');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'VERIFICAR','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='VERIFICAR');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'VESTIKE','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='VESTIKE');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'WONDER','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='WONDER');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'XHIKAS LINE','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='XHIKAS LINE');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'YENIFER','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='YENIFER');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'GéNESIS','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='GéNESIS');
-- Tiendas con nombre ligeramente diferente al que puede estar en BD
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'D FERGIE','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='D FERGIE');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'ES LUJO','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='ES LUJO');
INSERT INTO tiendas (nombre, ciclo_pago, activa) SELECT 'INDUSTRIAL AURA','semanal',1 WHERE NOT EXISTS (SELECT 1 FROM tiendas WHERE nombre='INDUSTRIAL AURA');
GO
PRINT 'Tiendas nuevas insertadas';
GO

-- ════════════════════════════════════════════
-- MOTORIZADOS NUEVOS
-- ════════════════════════════════════════════
INSERT INTO motorizados (nombre, iniciales, color_avatar, activo)
SELECT 'AMIEL','AM','av-blue',1 WHERE NOT EXISTS (SELECT 1 FROM motorizados WHERE nombre='AMIEL');

INSERT INTO motorizados (nombre, iniciales, color_avatar, activo)
SELECT 'GREGORIO','GR','av-teal',1 WHERE NOT EXISTS (SELECT 1 FROM motorizados WHERE nombre='GREGORIO');

INSERT INTO motorizados (nombre, iniciales, color_avatar, activo)
SELECT 'JOSE FELIX','JF','av-purple',1 WHERE NOT EXISTS (SELECT 1 FROM motorizados WHERE nombre='JOSE FELIX');

INSERT INTO motorizados (nombre, iniciales, color_avatar, activo)
SELECT 'JUAN','JU','av-amber',1 WHERE NOT EXISTS (SELECT 1 FROM motorizados WHERE nombre='JUAN');

INSERT INTO motorizados (nombre, iniciales, color_avatar, activo)
SELECT 'MOISES','MO','av-blue',1 WHERE NOT EXISTS (SELECT 1 FROM motorizados WHERE nombre='MOISES');
GO
PRINT 'Motorizados nuevos insertados';
GO

-- ════════════════════════════════════════════
-- DISTRITOS FALTANTES
-- ════════════════════════════════════════════
INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT 'PUENTE PIEDRA', 6, 15, 10 WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre='PUENTE PIEDRA');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT 'VENTANILLA', 4, 12, 8 WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre='VENTANILLA');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT 'SAN LUIS', 3, 8, 5 WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre='SAN LUIS');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT 'SURQUILLO', 3, 8, 5 WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre='SURQUILLO');
GO
PRINT 'Distritos faltantes insertados';
GO

-- ════════════════════════════════════════════
-- VERIFICACION FINAL
-- ════════════════════════════════════════════
SELECT 'TIENDAS TOTAL' AS resumen, COUNT(*) AS total FROM tiendas
UNION ALL
SELECT 'MOTORIZADOS TOTAL', COUNT(*) FROM motorizados
UNION ALL
SELECT 'DISTRITOS TOTAL', COUNT(*) FROM distritos;
GO
