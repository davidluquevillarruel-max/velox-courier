-- ============================================================
--  VELOX COURIER — Actualizar datos: Tiendas, Motorizados, Distritos
--  Ejecutar en SSMS con velox_courier seleccionada
-- ============================================================
USE velox_courier;
GO

-- ============================================================
-- 1) AGREGAR COLUMNA YAPE A TIENDAS (si no existe)
-- ============================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.tiendas') AND name = 'yape'
)
BEGIN
    ALTER TABLE tiendas ADD yape NVARCHAR(20) NULL;
    PRINT 'Columna yape agregada a tiendas';
END
GO

-- ============================================================
-- 2) AGREGAR COLUMNA YAPE A MOTORIZADOS (si no existe)
-- ============================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.motorizados') AND name = 'yape'
)
BEGIN
    ALTER TABLE motorizados ADD yape NVARCHAR(20) NULL;
    PRINT 'Columna yape agregada a motorizados';
END
GO

-- ============================================================
-- 3) ACTUALIZAR TELÉFONOS Y YAPE DE TIENDAS
-- ============================================================
UPDATE tiendas SET telefono = '994064713', yape = '994064713' WHERE nombre = 'AC PRODUCTS STORE';
UPDATE tiendas SET telefono = '929670029', yape = '929670029' WHERE nombre = 'ADDIR';
UPDATE tiendas SET telefono = '992938722', yape = '992938722' WHERE nombre = 'ADELAIDA';
UPDATE tiendas SET telefono = '913032844', yape = '913032844' WHERE nombre = 'ADLER';
UPDATE tiendas SET telefono = '926188472', yape = '926188472' WHERE nombre = 'AELE';
UPDATE tiendas SET telefono = '954572949', yape = '954572949' WHERE nombre = 'ALEA MODA';
UPDATE tiendas SET telefono = '977711334', yape = '977711334' WHERE nombre = 'ALIZE';
UPDATE tiendas SET telefono = '955532991', yape = '955532991' WHERE nombre = 'ALTHANA';
UPDATE tiendas SET telefono = '980696386', yape = '980696386' WHERE nombre = 'AMATE';
UPDATE tiendas SET telefono = '934211882', yape = '934211882' WHERE nombre = 'AMIRE';
UPDATE tiendas SET telefono = '977646884', yape = '977646884' WHERE nombre = 'ANHELI';
UPDATE tiendas SET telefono = '984117784', yape = '984117784' WHERE nombre = 'ARACELI';
UPDATE tiendas SET telefono = '986452857', yape = '986452857' WHERE nombre = 'ARETA';
UPDATE tiendas SET telefono = '958056680', yape = '958056680' WHERE nombre = 'ATLANTIS';
UPDATE tiendas SET telefono = '931323717', yape = '931323717' WHERE nombre = 'AYJ';
UPDATE tiendas SET telefono = '980644537', yape = '980644537' WHERE nombre = 'BABY GYS';
UPDATE tiendas SET telefono = '942329775', yape = '942329775' WHERE nombre = 'BABY KOALYS';
UPDATE tiendas SET telefono = '986616562', yape = '986616562' WHERE nombre = 'BABY MADYFA';
UPDATE tiendas SET telefono = '916383312', yape = '916383312' WHERE nombre = 'BABY ROOM';
UPDATE tiendas SET telefono = '930200230', yape = '930200230' WHERE nombre = 'BANATY';
UPDATE tiendas SET telefono = '901806106', yape = '901806106' WHERE nombre = 'BANDIDI';
UPDATE tiendas SET telefono = '938107122', yape = '938107122' WHERE nombre = 'BERNABE';
UPDATE tiendas SET telefono = '935138589', yape = '935138589' WHERE nombre = 'BLACK SNAKE';
UPDATE tiendas SET telefono = '991040024', yape = '991040024' WHERE nombre = 'BODY SECRET';
UPDATE tiendas SET telefono = '925599037', yape = '925599037' WHERE nombre = 'BOHO CHIC';
UPDATE tiendas SET telefono = '903529981', yape = '903529981' WHERE nombre = 'BOXS7N';
UPDATE tiendas SET telefono = '901742812', yape = '901742812' WHERE nombre = 'CARMEN STORE';
UPDATE tiendas SET telefono = '910281887', yape = '910281887' WHERE nombre = 'CARTERAS';
UPDATE tiendas SET telefono = '976375515', yape = '976375515' WHERE nombre = 'CECIL';
UPDATE tiendas SET telefono = '955058552', yape = '955058552' WHERE nombre = 'CHINOTA';
UPDATE tiendas SET telefono = '943268593', yape = '943268593' WHERE nombre = 'CIOSNI';
UPDATE tiendas SET telefono = '926909150', yape = '926909150' WHERE nombre = 'CLOT SHOP';
UPDATE tiendas SET telefono = '961871172', yape = '961871172' WHERE nombre = 'CONFECCIONES RODRIGUEZ';
UPDATE tiendas SET telefono = '947369479', yape = '947369479' WHERE nombre = 'CONFECCIONES ROUSE';
UPDATE tiendas SET telefono = '970605559', yape = '970605559' WHERE nombre = 'CREACIONES ANGELA';
UPDATE tiendas SET telefono = '924021914', yape = '924021914' WHERE nombre = 'CREACIONES JULISSA';
UPDATE tiendas SET telefono = '965794267', yape = '965794267' WHERE nombre = 'CREFER KIDS';
UPDATE tiendas SET telefono = '940451395', yape = '940451395' WHERE nombre = 'D FERGIE';
UPDATE tiendas SET telefono = '951597474', yape = '951597474' WHERE nombre = 'DAESCA';
UPDATE tiendas SET telefono = '901768909', yape = '901768909' WHERE nombre = 'DANUS';
UPDATE tiendas SET telefono = '929589222', yape = '929589222' WHERE nombre = 'DANY';
UPDATE tiendas SET telefono = '972795053', yape = '972795053' WHERE nombre = 'DANZIRE';
UPDATE tiendas SET telefono = '916031960', yape = '916031960' WHERE nombre = 'DASMEROO';
UPDATE tiendas SET telefono = '904829008', yape = '904829008' WHERE nombre = 'DENINA JEANS';
UPDATE tiendas SET telefono = '934431903', yape = '934431903' WHERE nombre = 'DIEGO SANAME';
UPDATE tiendas SET telefono = '920795100', yape = '920795100' WHERE nombre = 'DIONEZKA';
UPDATE tiendas SET telefono = '952987572', yape = '952987572' WHERE nombre = 'DISFRACES OHANA';
UPDATE tiendas SET telefono = '993089169', yape = '993089169' WHERE nombre = 'DJESUS';
UPDATE tiendas SET telefono = '986933535', yape = '986933535' WHERE nombre = 'DMB JEANS';
UPDATE tiendas SET telefono = '981759857', yape = '981759857' WHERE nombre = 'DON PRIME';
UPDATE tiendas SET telefono = '933192843', yape = '933192843' WHERE nombre = 'DOVALINA';
UPDATE tiendas SET telefono = '926960915', yape = '926960915' WHERE nombre = 'DULCE MAKY';
UPDATE tiendas SET telefono = '947223949', yape = '947223949' WHERE nombre = 'ECOVALIN';
UPDATE tiendas SET telefono = '993888514', yape = '993888514' WHERE nombre = 'ELITE WEARFORTHE';
UPDATE tiendas SET telefono = '994948368', yape = '994948368' WHERE nombre = 'ENOLAH';
UPDATE tiendas SET telefono = '926707431', yape = '926707431' WHERE nombre = 'ES LUJO';
UPDATE tiendas SET telefono = '978213196', yape = '978213196' WHERE nombre = 'ESMERALDA';
UPDATE tiendas SET telefono = '955986258', yape = '955986258' WHERE nombre = 'EUREKA';
UPDATE tiendas SET telefono = '983124856', yape = '983124856' WHERE nombre = 'EXPLICIT';
UPDATE tiendas SET telefono = '988471355', yape = '988471355' WHERE nombre = 'FAMBRIL';
UPDATE tiendas SET telefono = '975082311', yape = '975082311' WHERE nombre = 'FITBELLA';
UPDATE tiendas SET telefono = '958509673', yape = '958509673' WHERE nombre = 'FITNEES SPORT';
UPDATE tiendas SET telefono = '902307995', yape = '902307995' WHERE nombre = 'FLACAS';
UPDATE tiendas SET telefono = '970127111', yape = '970127111' WHERE nombre = 'FLAVIANA';
UPDATE tiendas SET telefono = '960371150', yape = '960371150' WHERE nombre = 'FLORECA';
UPDATE tiendas SET telefono = '913753457', yape = '913753457' WHERE nombre = 'FLOWER';
UPDATE tiendas SET telefono = '921051455', yape = '921051455' WHERE nombre = 'FRAGANCIA';
UPDATE tiendas SET telefono = '985556827', yape = '985556827' WHERE nombre = 'GABRIEL';
UPDATE tiendas SET telefono = '960664277', yape = '960664277' WHERE nombre = 'GABY';
UPDATE tiendas SET telefono = '996123871', yape = '996123871' WHERE nombre = 'GARRAS';
UPDATE tiendas SET telefono = '910508229', yape = '910508229' WHERE nombre = 'GÉNESIS';
UPDATE tiendas SET telefono = '934311788', yape = '934311788' WHERE nombre = 'GIRL PERU';
UPDATE tiendas SET telefono = '977441827', yape = '977441827' WHERE nombre = 'GIULIA MODA';
UPDATE tiendas SET telefono = '961432067', yape = '961432067' WHERE nombre = 'GYN';
UPDATE tiendas SET telefono = '906063309', yape = '906063309' WHERE nombre = 'GYO';
UPDATE tiendas SET telefono = '930555051', yape = '930555051' WHERE nombre = 'HEVAL';
UPDATE tiendas SET telefono = '934982924', yape = '934982924' WHERE nombre = 'HND';
UPDATE tiendas SET telefono = '929325557', yape = '929325557' WHERE nombre = 'HYT';
UPDATE tiendas SET telefono = '983017145', yape = '983017145' WHERE nombre = 'IMPERIUN';
UPDATE tiendas SET telefono = '908867141', yape = '908867141' WHERE nombre = 'INDUSTRIAL AURA';
UPDATE tiendas SET telefono = '944796651', yape = '944796651' WHERE nombre = 'IRENIA';
UPDATE tiendas SET telefono = '927499084', yape = '927499084' WHERE nombre = 'ISABELLA MERINO';
UPDATE tiendas SET telefono = '941133461', yape = '941133461' WHERE nombre = 'JACKI STORE';
UPDATE tiendas SET telefono = '982156657', yape = '982156657' WHERE nombre = 'JHORDI';
UPDATE tiendas SET telefono = '941133461', yape = '941133461' WHERE nombre = 'JORGE';
UPDATE tiendas SET telefono = '930791960', yape = '930791960' WHERE nombre = 'JOSHE KIDS';
UPDATE tiendas SET telefono = '960766372', yape = '960766372' WHERE nombre = 'JOTA H';
UPDATE tiendas SET telefono = '965350870', yape = '965350870' WHERE nombre = 'JUGUETERIA SAEMI';
UPDATE tiendas SET telefono = '956067180', yape = '956067180' WHERE nombre = 'JUST FOUR YOU';
UPDATE tiendas SET telefono = '941810800', yape = '941810800' WHERE nombre = 'KAMINI';
UPDATE tiendas SET telefono = '992078576', yape = '992078576' WHERE nombre = 'KAROL';
UPDATE tiendas SET telefono = '901127348', yape = '901127348' WHERE nombre = 'KATY';
UPDATE tiendas SET telefono = '957746049', yape = '957746049' WHERE nombre = 'KAWAI JAPON';
UPDATE tiendas SET telefono = '982533089', yape = '982533089' WHERE nombre = 'KEIDES SPORT';
UPDATE tiendas SET telefono = '973520113', yape = '973520113' WHERE nombre = 'KEYAL';
UPDATE tiendas SET telefono = '951008439', yape = '951008439' WHERE nombre = 'KLAAR';
UPDATE tiendas SET telefono = '969469987', yape = '969469987' WHERE nombre = 'KLER';
UPDATE tiendas SET telefono = '927155969', yape = '927155969' WHERE nombre = 'KMB';
UPDATE tiendas SET telefono = '993671932', yape = '993671932' WHERE nombre = 'KONY KIDS';
UPDATE tiendas SET telefono = '908858834', yape = '908858834' WHERE nombre = 'LADY LU';
UPDATE tiendas SET telefono = '902266311', yape = '902266311' WHERE nombre = 'LAURELVIS';
UPDATE tiendas SET telefono = '936257125', yape = '936257125' WHERE nombre = 'LE GYM';
UPDATE tiendas SET telefono = '910504748', yape = '910504748' WHERE nombre = 'LENCERÍA DARIEL';
UPDATE tiendas SET telefono = '921405023', yape = '921405023' WHERE nombre = 'LEXXIO';
UPDATE tiendas SET telefono = '970683054', yape = '970683054' WHERE nombre = 'LIBERTY';
UPDATE tiendas SET telefono = '903136051', yape = '903136051' WHERE nombre = 'LOVEBOO';
UPDATE tiendas SET telefono = '991408879', yape = '991408879' WHERE nombre = 'LÚ';
UPDATE tiendas SET telefono = '930429324', yape = '930429324' WHERE nombre = 'LUIS MENDOZA';
UPDATE tiendas SET telefono = '914036192', yape = '914036192' WHERE nombre = 'LUISA';
UPDATE tiendas SET telefono = '951162916', yape = '951162916' WHERE nombre = 'LUNE Y SOLEIL';
UPDATE tiendas SET telefono = '915954798', yape = '915954798' WHERE nombre = 'LUPO';
UPDATE tiendas SET telefono = '964305717', yape = '964305717' WHERE nombre = 'MACHIS';
UPDATE tiendas SET telefono = '910775998', yape = '910775998' WHERE nombre = 'MADELLY';
UPDATE tiendas SET telefono = '967814100', yape = '967814100' WHERE nombre = 'MAEL';
UPDATE tiendas SET telefono = '942095037', yape = '942095037' WHERE nombre = 'MARCIAL';
UPDATE tiendas SET telefono = '914511150', yape = '914511150' WHERE nombre = 'MARIA GARCIA';
UPDATE tiendas SET telefono = '983012564', yape = '983012564' WHERE nombre = 'MARIANA IMPORT';
UPDATE tiendas SET telefono = '924850721', yape = '924850721' WHERE nombre = 'MARICIELO';
UPDATE tiendas SET telefono = '955305570', yape = '955305570' WHERE nombre = 'MATICA';
UPDATE tiendas SET telefono = '954198004', yape = '954198004' WHERE nombre = 'MATIZ';
UPDATE tiendas SET telefono = '931429828', yape = '931429828' WHERE nombre = 'MEIKE';
UPDATE tiendas SET telefono = '920428037', yape = '920428037' WHERE nombre = 'MEN LAB';
UPDATE tiendas SET telefono = '956665561', yape = '956665561' WHERE nombre = 'MIA';
UPDATE tiendas SET telefono = '913592719', yape = '913592719' WHERE nombre = 'MIEL CANELA';
UPDATE tiendas SET telefono = '938255054', yape = '938255054' WHERE nombre = 'MILAN';
UPDATE tiendas SET telefono = '912987491', yape = '912987491' WHERE nombre = 'MIZO';
UPDATE tiendas SET telefono = '919548520', yape = '919548520' WHERE nombre = 'MODA LIBRE';
UPDATE tiendas SET telefono = '977993266', yape = '977993266' WHERE nombre = 'MODA VALENTINA';
UPDATE tiendas SET telefono = '901958813', yape = '901958813' WHERE nombre = 'MOKA PET';
UPDATE tiendas SET telefono = '967984491', yape = '967984491' WHERE nombre = 'MORA CLUB';
UPDATE tiendas SET telefono = '992389169', yape = '992389169' WHERE nombre = 'MORESSA';
UPDATE tiendas SET telefono = '912223402', yape = '912223402' WHERE nombre = 'MULTISERVICIOS FER';
UPDATE tiendas SET telefono = '919753295', yape = '919753295' WHERE nombre = 'MUNASKAY';
UPDATE tiendas SET telefono = '934500607', yape = '934500607' WHERE nombre = 'MURWARI';
UPDATE tiendas SET telefono = '924264261', yape = '924264261' WHERE nombre = 'NAINE';
UPDATE tiendas SET telefono = '930756297', yape = '930756297' WHERE nombre = 'NAIR';
UPDATE tiendas SET telefono = '945494023', yape = '945494023' WHERE nombre = 'NANDO KICK';
UPDATE tiendas SET telefono = '980722343', yape = '980722343' WHERE nombre = 'NEKICHIC';
UPDATE tiendas SET telefono = '920344336', yape = '920344336' WHERE nombre = 'NENA';
UPDATE tiendas SET telefono = '960605121', yape = '960605121' WHERE nombre = 'NENAH';
UPDATE tiendas SET telefono = '926762682', yape = '926762682' WHERE nombre = 'NEW SUPPORT';
UPDATE tiendas SET telefono = '994449947', yape = '994449947' WHERE nombre = 'NICO NICOLS';
UPDATE tiendas SET telefono = '972128533', yape = '972128533' WHERE nombre = 'NICOLE';
UPDATE tiendas SET telefono = '940754804', yape = '940754804' WHERE nombre = 'NOEMI NATURA';
UPDATE tiendas SET telefono = '917942578', yape = '917942578' WHERE nombre = 'NYOR TEXTIL';
UPDATE tiendas SET telefono = '908842331', yape = '908842331' WHERE nombre = 'NYV';
UPDATE tiendas SET telefono = '935591526', yape = '935591526' WHERE nombre = 'ORBAU';
UPDATE tiendas SET telefono = '918928213', yape = '918928213' WHERE nombre = 'OUTLET ROSE';
UPDATE tiendas SET telefono = '921286923', yape = '921286923' WHERE nombre = 'PANDAS SHOP';
UPDATE tiendas SET telefono = '929377411', yape = '929377411' WHERE nombre = 'PAREY';
UPDATE tiendas SET telefono = '955305570', yape = '955305570' WHERE nombre = 'PERFUMERIA';
UPDATE tiendas SET telefono = '951517865', yape = '951517865' WHERE nombre = 'PERLA DE PLATA';
UPDATE tiendas SET telefono = '929017613', yape = '929017613' WHERE nombre = 'QUE REGALOS';
UPDATE tiendas SET telefono = '953738552', yape = '953738552' WHERE nombre = 'QUEENA';
UPDATE tiendas SET telefono = '928328316', yape = '928328316' WHERE nombre = 'RARITY';
UPDATE tiendas SET telefono = '900180900', yape = '900180900' WHERE nombre = 'RENUEVATE';
UPDATE tiendas SET telefono = '907975173', yape = '907975173' WHERE nombre = 'RM SHOP';
UPDATE tiendas SET telefono = '976950006', yape = '976950006' WHERE nombre = 'ROUS TORRES';
UPDATE tiendas SET telefono = '977703009', yape = '977703009' WHERE nombre = 'RYJ';
UPDATE tiendas SET telefono = '994944533', yape = '994944533' WHERE nombre = 'SALMOS';
UPDATE tiendas SET telefono = '942727742', yape = '942727742' WHERE nombre = 'SANDALIAS LUK';
UPDATE tiendas SET telefono = '904892830', yape = '904892830' WHERE nombre = 'SANTS SEVEN';
UPDATE tiendas SET telefono = '986333094', yape = '986333094' WHERE nombre = 'SARIX';
UPDATE tiendas SET telefono = '932256556', yape = '932256556' WHERE nombre = 'SCRAPITOS';
UPDATE tiendas SET telefono = '987007196', yape = '987007196' WHERE nombre = 'SEGORA STORE';
UPDATE tiendas SET telefono = '928658492', yape = '928658492' WHERE nombre = 'SENSUAL SOULS';
UPDATE tiendas SET telefono = '933598212', yape = '933598212' WHERE nombre = 'SMITH KIDS';
UPDATE tiendas SET telefono = '932463447', yape = '932463447' WHERE nombre = 'SAONA';
UPDATE tiendas SET telefono = '906739232', yape = '906739232' WHERE nombre = 'SPIRELLE';
UPDATE tiendas SET telefono = '991855428', yape = '991855428' WHERE nombre = 'STREETWEAR';
UPDATE tiendas SET telefono = '968267313', yape = '968267313' WHERE nombre = 'SUMACK';
UPDATE tiendas SET telefono = '901661686', yape = '901661686' WHERE nombre = 'SUMAQ';
UPDATE tiendas SET telefono = '977424576', yape = '977424576' WHERE nombre = 'TAMMY';
UPDATE tiendas SET telefono = '918489771', yape = '918489771' WHERE nombre = 'TIMUY';
UPDATE tiendas SET telefono = '929547064', yape = '929547064' WHERE nombre = 'TODO EN UNO';
UPDATE tiendas SET telefono = '967206294', yape = '967206294' WHERE nombre = 'TOP JADE';
UPDATE tiendas SET telefono = '946419619', yape = '946419619' WHERE nombre = 'TOP SHOP';
UPDATE tiendas SET telefono = '940146393', yape = '940146393' WHERE nombre = 'TUMI SOF';
UPDATE tiendas SET telefono = '947105822', yape = '947105822' WHERE nombre = 'UGS';
UPDATE tiendas SET telefono = '948576932', yape = '948576932' WHERE nombre = 'UH.OH';
UPDATE tiendas SET telefono = '916433204', yape = '916433204' WHERE nombre = 'VELOX';
UPDATE tiendas SET telefono = '994691691', yape = '994691691' WHERE nombre = 'VENTURO';
UPDATE tiendas SET telefono = '961331744', yape = '961331744' WHERE nombre = 'VERDE PURO';
UPDATE tiendas SET telefono = '977141672', yape = '977141672' WHERE nombre = 'VERONICA';
UPDATE tiendas SET telefono = '955775532', yape = '955775532' WHERE nombre = 'VIDA DIVINA';
UPDATE tiendas SET telefono = '904755503', yape = '904755503' WHERE nombre = 'VIVA MODA';
UPDATE tiendas SET telefono = '930110498', yape = '930110498' WHERE nombre = 'YAN SPORT';
UPDATE tiendas SET telefono = '957162018', yape = '957162018' WHERE nombre = 'YOLI';
UPDATE tiendas SET telefono = '918805951', yape = '918805951' WHERE nombre = 'YOMAR';
UPDATE tiendas SET telefono = '907292717', yape = '907292717' WHERE nombre = 'YULI SPORT';
UPDATE tiendas SET telefono = '960169760', yape = '960169760' WHERE nombre = 'YURIKO';
UPDATE tiendas SET telefono = '928790546', yape = '928790546' WHERE nombre = 'ZAAZ';
UPDATE tiendas SET telefono = '993086248', yape = '993086248' WHERE nombre = 'ZASSY';
UPDATE tiendas SET telefono = '994221051', yape = '994221051' WHERE nombre = 'ZTOP';
GO
PRINT 'Teléfonos y yape de tiendas actualizados';
GO

-- ============================================================
-- 4) ACTUALIZAR TELÉFONOS Y YAPE DE MOTORIZADOS
-- ============================================================
UPDATE motorizados SET yape = telefono WHERE telefono IS NOT NULL AND telefono != '';
GO
PRINT 'Yape de motorizados actualizado (igual que teléfono)';
GO

-- ============================================================
-- 5) ACTUALIZAR PRECIOS DE DISTRITOS EXISTENTES
-- ============================================================
UPDATE distritos SET precio_delivery = 8,  pago_motorizado = 5  WHERE nombre = 'AGENCIA';
UPDATE distritos SET precio_delivery = 8,  pago_motorizado = 5  WHERE nombre = 'EL AGUSTINO';
UPDATE distritos SET precio_delivery = 22, pago_motorizado = 18 WHERE nombre = 'ANCON';
UPDATE distritos SET precio_delivery = 8,  pago_motorizado = 5  WHERE nombre = 'ATE';
UPDATE distritos SET precio_delivery = 8,  pago_motorizado = 5  WHERE nombre = 'BARRANCO';
UPDATE distritos SET precio_delivery = 8,  pago_motorizado = 5  WHERE nombre = 'BREÑA';
UPDATE distritos SET precio_delivery = 8,  pago_motorizado = 5  WHERE nombre = 'CALLAO';
UPDATE distritos SET precio_delivery = 12, pago_motorizado = 8  WHERE nombre = 'CARABAYLLO';
UPDATE distritos SET precio_delivery = 8,  pago_motorizado = 5  WHERE nombre = 'CDO DE LIMA';
UPDATE distritos SET precio_delivery = 8,  pago_motorizado = 5  WHERE nombre = 'CHORRILLOS';
UPDATE distritos SET precio_delivery = 12, pago_motorizado = 8  WHERE nombre = 'COMAS';
UPDATE distritos SET precio_delivery = 8,  pago_motorizado = 5  WHERE nombre = 'INDEPENDENCIA';
UPDATE distritos SET precio_delivery = 8,  pago_motorizado = 5  WHERE nombre = 'JESÚS MARÍA';
UPDATE distritos SET precio_delivery = 8,  pago_motorizado = 5  WHERE nombre = 'LA MOLINA';
UPDATE distritos SET precio_delivery = 8,  pago_motorizado = 5  WHERE nombre = 'LA VICTORIA';
UPDATE distritos SET precio_delivery = 8,  pago_motorizado = 5  WHERE nombre = 'LIMA';
UPDATE distritos SET precio_delivery = 8,  pago_motorizado = 5  WHERE nombre = 'LINCE';
UPDATE distritos SET precio_delivery = 8,  pago_motorizado = 5  WHERE nombre = 'LOS OLIVOS';
UPDATE distritos SET precio_delivery = 18, pago_motorizado = NULL WHERE nombre = 'LURIGANCHO - CHOSICA';
UPDATE distritos SET precio_delivery = 12, pago_motorizado = 8  WHERE nombre = 'LURIGANCHO CAMPOY';
UPDATE distritos SET precio_delivery = 12, pago_motorizado = 8  WHERE nombre = 'LURÍN';
UPDATE distritos SET precio_delivery = 8,  pago_motorizado = 5  WHERE nombre = 'MAGDALENA DEL MAR';
UPDATE distritos SET precio_delivery = 18, pago_motorizado = NULL WHERE nombre = 'MANCHAY';
UPDATE distritos SET precio_delivery = 8,  pago_motorizado = 5  WHERE nombre = 'MIRAFLORES';
UPDATE distritos SET precio_delivery = 8,  pago_motorizado = 5  WHERE nombre = 'PUEBLO LIBRE';
UPDATE distritos SET precio_delivery = 8,  pago_motorizado = 5  WHERE nombre = 'RÍMAC';
UPDATE distritos SET precio_delivery = 8,  pago_motorizado = 5  WHERE nombre = 'SAN BORJA';
UPDATE distritos SET precio_delivery = 8,  pago_motorizado = 5  WHERE nombre = 'SAN ISIDRO';
UPDATE distritos SET precio_delivery = 8,  pago_motorizado = 5  WHERE nombre = 'SAN LUIS';
UPDATE distritos SET precio_delivery = 8,  pago_motorizado = 5  WHERE nombre = 'SAN MIGUEL';
UPDATE distritos SET precio_delivery = 8,  pago_motorizado = 5  WHERE nombre = 'SANTA ANITA';
UPDATE distritos SET precio_delivery = 8,  pago_motorizado = 5  WHERE nombre = 'SAN JUAN DE LURIGANCHO';
UPDATE distritos SET precio_delivery = 8,  pago_motorizado = 5  WHERE nombre = 'SAN JUAN DE MIRAFLORES';
UPDATE distritos SET precio_delivery = 8,  pago_motorizado = 5  WHERE nombre = 'SAN MARTÍN DE PORRES';
UPDATE distritos SET precio_delivery = 8,  pago_motorizado = 5  WHERE nombre = 'SANTIAGO DE SURCO';
UPDATE distritos SET precio_delivery = 8,  pago_motorizado = 5  WHERE nombre = 'VILLA EL SALVADOR';
UPDATE distritos SET precio_delivery = 12, pago_motorizado = 8  WHERE nombre = 'VMT JOSE GALVEZ';
UPDATE distritos SET precio_delivery = 8,  pago_motorizado = 5  WHERE nombre = 'VILLA MARÍA DEL TRIUNFO';
UPDATE distritos SET precio_delivery = 30, pago_motorizado = NULL WHERE nombre = 'CIENEGUILLA';
UPDATE distritos SET precio_delivery = 22, pago_motorizado = NULL WHERE nombre = 'JICAMARCA';
UPDATE distritos SET precio_delivery = 50, pago_motorizado = NULL WHERE nombre = 'PUNTA HERMOSA';
UPDATE distritos SET precio_delivery = 17, pago_motorizado = NULL WHERE nombre = 'HUACHIPA';
UPDATE distritos SET precio_delivery = 12, pago_motorizado = 8  WHERE nombre = 'OQUENDO';
UPDATE distritos SET precio_delivery = 15, pago_motorizado = 10 WHERE nombre = 'MARQUES';
UPDATE distritos SET precio_delivery = 8,  pago_motorizado = 5  WHERE nombre = 'CHOSICA';
UPDATE distritos SET precio_delivery = 15, pago_motorizado = 10 WHERE nombre = 'PUENTE PIEDRA - ZAPALLAL';
UPDATE distritos SET precio_delivery = 20, pago_motorizado = 18 WHERE nombre = 'LOMAS DE CARABAYLLO';
UPDATE distritos SET precio_delivery = 8,  pago_motorizado = 5  WHERE nombre = 'ATE - VITARTE';
UPDATE distritos SET precio_delivery = 12, pago_motorizado = 8  WHERE nombre = 'ATE - SALAMANCA';
GO
PRINT 'Precios de distritos existentes actualizados';
GO

-- ============================================================
-- 6) INSERTAR DISTRITOS NUEVOS (los que no existen aún)
--    Zona 6 = Otros, se puede ajustar después desde el sistema
-- ============================================================
-- Primero verificamos qué zona usar para los nuevos (usamos id 6 = Otros como default)
INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'ATE - SANTA CLARA', 6, 12, 8
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'ATE - SANTA CLARA');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'ATE - HUACHIPA', 6, 17, 12
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'ATE - HUACHIPA');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'PUENTE PIEDRA - ENSENADA', 6, 12, 10
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'PUENTE PIEDRA - ENSENADA');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'FLORES', 6, 8, 5
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'FLORES');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'INTABUS', 6, 8, 5
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'INTABUS');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'LA PERLA', 4, 8, 5
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'LA PERLA');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'LURIGANCHO - CHOSICA', 6, 18, NULL
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'LURIGANCHO - CHOSICA');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'MANCHAY', 2, 18, NULL
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'MANCHAY');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'MARVISUR', 2, 8, 5
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'MARVISUR');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'CARABAYLLO - PUENTE', 6, 15, NULL
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'CARABAYLLO - PUENTE');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'SHALOM', 6, 8, 5
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'SHALOM');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'SJL MARISCAL', 6, 12, NULL
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'SJL MARISCAL');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'SJL MONTE NEGRO', 6, 15, NULL
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'SJL MONTE NEGRO');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'CIENEGUILLA', 6, 30, NULL
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'CIENEGUILLA');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'JICAMARCA', 6, 22, NULL
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'JICAMARCA');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'PUNTA HERMOSA', 2, 50, NULL
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'PUNTA HERMOSA');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'HUACHIPA', 6, 17, NULL
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'HUACHIPA');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'OQUENDO', 4, 12, 8
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'OQUENDO');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'MARQUES', 6, 15, 10
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'MARQUES');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'CRUZERO EXPRESS', 6, 8, 5
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'CRUZERO EXPRESS');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'GM INTERNACIONAL', 6, 8, 5
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'GM INTERNACIONAL');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'SJL JICAMARCA', 6, 15, NULL
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'SJL JICAMARCA');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'CHOSICA', 6, 8, 5
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'CHOSICA');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'PUENTE PIEDRA - ZAPALLAL', 6, 15, 10
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'PUENTE PIEDRA - ZAPALLAL');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'LOMAS DE CARABAYLLO', 6, 20, 18
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'LOMAS DE CARABAYLLO');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'SJL HUASCAR', 6, 12, NULL
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'SJL HUASCAR');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'RECOJO', 6, 8, 5
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'RECOJO');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'ATE - VITARTE', 6, 8, 5
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'ATE - VITARTE');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'ATE - GLORIA GRANDE', 6, 15, NULL
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'ATE - GLORIA GRANDE');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'SJL BAYOBAR', 6, 12, 8
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'SJL BAYOBAR');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'CARMEN DE LA LEGUA', 4, 8, 5
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'CARMEN DE LA LEGUA');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'CHIMBOTE EXPRES', 6, 8, 5
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'CHIMBOTE EXPRES');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'TARAPOTO COURIER', 6, 8, 5
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'TARAPOTO COURIER');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'TRANSPORTE CRUZ DEL NORTE', 6, 8, 5
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'TRANSPORTE CRUZ DEL NORTE');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'VMT JOSE GALVEZ', 2, 12, 8
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'VMT JOSE GALVEZ');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'LURIGANCHO CAMPOY', 6, 12, 8
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'LURIGANCHO CAMPOY');

INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
SELECT N'LURÍN', 2, 12, 8
WHERE NOT EXISTS (SELECT 1 FROM distritos WHERE nombre = N'LURÍN');
GO
PRINT 'Distritos nuevos insertados correctamente';
GO

-- ============================================================
-- VERIFICACIÓN FINAL
-- ============================================================
SELECT 'TIENDAS con teléfono' AS resumen, COUNT(*) AS total
FROM tiendas WHERE telefono IS NOT NULL AND telefono != ''
UNION ALL
SELECT 'TIENDAS con yape', COUNT(*) FROM tiendas WHERE yape IS NOT NULL
UNION ALL
SELECT 'MOTORIZADOS con yape', COUNT(*) FROM motorizados WHERE yape IS NOT NULL
UNION ALL
SELECT 'DISTRITOS total', COUNT(*) FROM distritos WHERE activo = 1;
GO
