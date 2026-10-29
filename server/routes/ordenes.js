/* ============================================================
   routes/ordenes.js — Endpoints de órdenes
   Protegido: requiere sesión. El alcance de los datos se decide
   con el rol de la SESIÓN, nunca con parámetros del cliente.
   ============================================================ */

const express = require('express');
const router  = express.Router();
const { getPool, sql } = require('../db');
const { requireAuth, requireRol } = require('../middleware/auth');
const { r2Habilitado, generarUrlSubidaEvidencia, esUrlDeOrden } = require('../r2');
const { guardarFoto, rutaArchivo, existeFoto } = require('../almacenamiento-local');

/* Todas las rutas de este archivo exigen sesión */
router.use(requireAuth);

/* Roles que pueden modificar datos operativos */
const GESTORES = ['admin', 'operador'];

/* "Cambio" y "Recojo" no son estados de progreso de la orden, son
   condiciones especiales aparte (ver condicion_especial) */
const CONDICIONES_ESPECIALES = ['cambio', 'recojo', 'escoge-talla'];

/* Cómo se pagó por adelantado en oficina (solo aplica si pago_velox = 'PAGADO') */
const PAGO_VELOX_METODOS = ['efectivo', 'yape'];

/* Medio de pago real (distinto de metodo_pago — ver
   velox_agregar_medio_pago.sql). "pago-tienda" y "pago-empresa"
   exigen evidencia fotográfica adjunta (puede llegar después, por la
   cola del celular — SELECT_ORDEN repite esta lista en SQL para
   calcular evidencia_pendiente). */
const MEDIOS_PAGO =['yape-motorizado', 'efectivo-motorizado', 'pago-tienda', 'pago-empresa'];
const MEDIOS_PAGO_CON_EVIDENCIA = ['pago-tienda', 'pago-empresa'];

/* Distrito comodín del flujo rápido con foto: la orden se crea sin
   distrito elegido y se completa después (ver
   velox_agregar_distrito_sin_definir.sql) */
const DISTRITO_SIN_DEFINIR = 'SIN DEFINIR';

/* ────────────────────────────────────────────────────────────
   FOTO EN RÁFAGA (ver velox_agregar_rafaga.sql)
   Cada foto crea una orden sin datos, con la tienda y el distrito
   comodín. Lo que la marca como "pendiente de completar" es la
   columna datos_pendientes (nace en 1), NO la tienda comodín: la
   tienda solo ocupa el lugar porque id_tienda es NOT NULL.

   Desde que la ráfaga pide la tienda antes de la cámara, la orden
   ya nace con su tienda. Igual, "tienda distinta del comodín" es un
   chequeo FIJO (fuera de la lista): las pendientes de antes de ese
   cambio, o las que se crearon con el comodín porque la tienda ya no
   era válida, siguen pidiendo la tienda (falta_tienda en
   GET /pendientes-datos).

   CAMPOS_PENDIENTES dice qué hay que completar para que la orden
   deje de estar pendiente. Para cambiarlos:
   · Sacar un campo → quitarlo de la lista (nada más).
   · Agregar uno nuevo → sumarlo a la lista, a
     CHEQUEOS_DATOS_PENDIENTES y a PATCH /:id/completar-datos.
   La ventana "Pendiente" del frontend arma sus campos con la
   lista que devuelve GET /pendientes-datos.
──────────────────────────────────────────────────────────── */
const TIENDA_SIN_DEFINIR = 'SIN DEFINIR';
const CAMPOS_PENDIENTES = ['destinatario', 'distrito', 'cobrado'];

const tieneTiendaReal = f => !!f.tienda && f.tienda !== TIENDA_SIN_DEFINIR;

/* f = fila con tienda y distrito (nombres), dest_nombre y dest_telefono */
const CHEQUEOS_DATOS_PENDIENTES = {
  tienda:       tieneTiendaReal,
  destinatario: f => !!(f.dest_nombre && f.dest_nombre.trim()),
  telefono:     f => !!(f.dest_telefono && f.dest_telefono.trim()),
  distrito:     f => !!f.distrito && f.distrito !== DISTRITO_SIN_DEFINIR,
  /* monto_cobrado es NOT NULL con 0 por defecto: en la base no se
     distingue "sin llenar" de "sin cobro" (0 es válido). Lo que lo
     hace obligatorio es PATCH /:id/completar-datos, que no guarda la
     fila sin el monto; desde "Actualizar orden" el campo siempre está
     a la vista y se guarda con el resto. */
  cobrado:      () => true,
};

/* Si la orden está pendiente y ya tiene todos los CAMPOS_PENDIENTES,
   le apaga la marca. Se llama después de cualquier guardado que
   pueda completar datos (la ventana "Pendiente" o "Actualizar
   orden"). Devuelve si la orden sigue pendiente. */
async function recalcularDatosPendientes(pool, ordenId) {
  const r = await pool.request()
    .input('id', sql.BigInt, ordenId)
    .query(`
      SELECT o.datos_pendientes, t.nombre AS tienda, d.nombre AS distrito,
             o.dest_nombre, o.dest_telefono
      FROM ordenes o
      JOIN tiendas   t ON t.id = o.id_tienda
      JOIN distritos d ON d.id = o.id_distrito
      WHERE o.id = @id
    `);
  const f = r.recordset[0];
  if (!f || !f.datos_pendientes) return false;

  const completa = tieneTiendaReal(f) && CAMPOS_PENDIENTES.every(c => CHEQUEOS_DATOS_PENDIENTES[c](f));
  if (!completa) return true;

  await pool.request()
    .input('id', sql.BigInt, ordenId)
    .query(`UPDATE ordenes SET datos_pendientes = 0 WHERE id = @id`);
  return false;
}

/* Fecha de hoy en Lima ('YYYY-MM-DD'). No se usa GETDATE(): el
   servidor de producción puede estar en UTC, y una asignación
   después de las 19:00 de Lima quedaría con el día siguiente. */
function hoyEnLima() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
}

/* 2601 / 2627 = clave duplicada; el mensaje trae el nombre del
   índice o restricción que chocó */
function esDuplicado(err, nombreIndice) {
  const numero = err && (err.number || (err.originalError && err.originalError.info && err.originalError.info.number));
  return (numero === 2601 || numero === 2627) && String(err.message || '').includes(nombreIndice);
}

/* El código sale de MAX+1: si dos personas crean una orden en el
   mismo instante pueden calcular el mismo, y uq_ordenes_codigo
   rechaza al segundo. En ese caso se recalcula y se reintenta (con
   ráfagas de 40 fotos es más probable que pase).
   insertar(codigo) hace el INSERT y devuelve el id nuevo. */
async function insertarConCodigoNuevo(pool, insertar) {
  for (let intento = 1; ; intento++) {
    const codRes = await pool.request().query(`
      SELECT ISNULL(MAX(CAST(SUBSTRING(codigo,3,LEN(codigo)) AS INT)),1000) + 1 AS siguiente
      FROM ordenes WHERE codigo LIKE 'C-%'
    `);
    const codigo = `C-${codRes.recordset[0].siguiente}`;
    try {
      return { id: await insertar(codigo), codigo };
    } catch (err) {
      if (intento < 3 && esDuplicado(err, 'uq_ordenes_codigo')) continue;
      throw err;
    }
  }
}

/* tipo en ordenes_fotos para la foto del producto tomada al crear la
   orden (la otra es 'evidencia_medio_pago') */
const TIPO_FOTO_PRODUCTO = 'foto_producto';
const TIPO_FOTO_EVIDENCIA = 'evidencia_medio_pago';
/* Fotos de devolución: la que se toma al confirmar que el producto
   volvió a la oficina (PATCH /:id/devolver; se acumulan hasta
   MAX_FOTOS_DEVOLUCION, una por vuelta) y la que se toma al
   devolverlo a la tienda (PATCH /:id/devolver-tienda, una sola).
   Solo las suben y las ven los gestores. */
const TIPO_FOTO_DEVOLUCION = 'foto_devolucion';
const TIPO_FOTO_DEVOLUCION_TIENDA = 'foto_devolucion_tienda';
const TIPOS_FOTO_DEVOLUCION = [TIPO_FOTO_DEVOLUCION, TIPO_FOTO_DEVOLUCION_TIENDA];
/* Fotos que toma el motorizado al resolver la orden desde su vista
   (js/entregas-moto.js, PATCH /:id/resolver): la de la entrega, la
   del producto que el cliente devolvió en un cambio / condición
   especial, y la de cada intento fallido (una por situación; en "no
   entregado" hasta 3). La del pago es la evidencia_medio_pago de
   siempre. Las ven los gestores y el motorizado de la orden. */
const TIPO_FOTO_ENTREGA      = 'foto_entrega';
const TIPO_FOTO_CAMBIO       = 'foto_cambio';
const TIPOS_FOTO_INTENTO     = ['foto_reprogramado', 'foto_ausente', 'foto_cancelado', 'foto_no_entregado'];
const TIPOS_FOTO_MOTORIZADO  = [TIPO_FOTO_ENTREGA, TIPO_FOTO_CAMBIO, ...TIPOS_FOTO_INTENTO];
const TIPOS_FOTO = [TIPO_FOTO_PRODUCTO, TIPO_FOTO_EVIDENCIA, ...TIPOS_FOTO_DEVOLUCION, ...TIPOS_FOTO_MOTORIZADO];
const MAX_FOTOS_DEVOLUCION = 5;
/* Tope de seguridad por tipo y por orden para las del motorizado: una
   orden puede salir varias veces (cada intento suma las suyas), esto
   solo frena un error que la llene de fotos. La pantalla pide 1 por
   situación (3 en "no entregado") en cada intento. */
const MAX_FOTOS_MOTORIZADO_POR_TIPO = 10;

/* Carpeta del bucket R2 para cada tipo (ver CARPETAS en server/r2.js) */
const CARPETA_POR_TIPO = {
  [TIPO_FOTO_PRODUCTO]:          'productos',
  [TIPO_FOTO_EVIDENCIA]:         'evidencias',
  [TIPO_FOTO_DEVOLUCION]:        'devoluciones',
  [TIPO_FOTO_DEVOLUCION_TIENDA]: 'devoluciones-tienda',
  [TIPO_FOTO_ENTREGA]:           'entregas',
  [TIPO_FOTO_CAMBIO]:            'cambios',
  ...Object.fromEntries(TIPOS_FOTO_INTENTO.map((t) => [t, 'intentos'])),
};

/* Id único que el celular le pone a cada foto de la cola (ver
   velox_agregar_id_subida.sql). Opcional: si no viene, la foto se
   guarda igual, solo que un reintento podría duplicarla. Devuelve
   el UUID en minúsculas, null si no vino, o false si vino mal. */
const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function leerIdSubida(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  return (typeof valor === 'string' && REGEX_UUID.test(valor)) ? valor.toLowerCase() : false;
}

/* ────────────────────────────────────────────────────────────
   Devuelve el filtro SQL según quién pregunta.
   · admin / operador / visor → ven todo
   · motorizado               → las suyas + las que no tienen a
     nadie asignado todavía (para poder autoasignarse en
     "Asignación"; nunca las de otro motorizado). Nunca ve las de
     ráfaga con datos pendientes: no hay nada que repartir todavía.
   · tienda                   → solo las de su tienda
   Se aplica en el servidor: el cliente no puede saltárselo.
──────────────────────────────────────────────────────────── */
function filtroPorRol(usuario, request) {
  if (usuario.rol === 'motorizado') {
    if (!usuario.id_motorizado) return { sql: 'AND 1 = 0' }; // sin vínculo: no ve nada
    request.input('scopeMoto', sql.Int, usuario.id_motorizado);
    return { sql: 'AND (o.id_motorizado = @scopeMoto OR o.id_motorizado IS NULL) AND o.datos_pendientes = 0' };
  }
  if (usuario.rol === 'tienda') {
    if (!usuario.id_tienda) return { sql: 'AND 1 = 0' };
    request.input('scopeTienda', sql.Int, usuario.id_tienda);
    return { sql: 'AND o.id_tienda = @scopeTienda' };
  }
  return { sql: '' };
}

/* Verifica que un motorizado solo toque órdenes suyas */
async function puedeTocarOrden(usuario, ordenId, pool) {
  if (GESTORES.includes(usuario.rol)) return true;
  if (usuario.rol !== 'motorizado' || !usuario.id_motorizado) return false;

  const r = await pool.request()
    .input('id', sql.BigInt, ordenId)
    .query('SELECT id_motorizado FROM ordenes WHERE id = @id');

  const fila = r.recordset[0];
  return !!fila && fila.id_motorizado === usuario.id_motorizado;
}

const SELECT_ORDEN = `
  SELECT
    o.id, o.codigo, CONVERT(varchar,o.fecha,23) AS fecha,
    CONVERT(varchar(20), o.row_version, 1) AS version,
    o.hora_asignacion,
    CONVERT(varchar, o.fecha_asignacion, 23) AS fecha_asignacion,
    /* Día que manda (lista, motorizado, Caja): fecha_asignacion o,
       sin asignar, la de creación (ver velox_agregar_fecha_reparto.sql) */
    CONVERT(varchar, o.fecha_reparto, 23) AS fecha_reparto,
    t.nombre  AS tienda,
    ori.nombre AS origen,
    d.nombre  AS distrito,
    z.nombre  AS zona,
    m.nombre  AS motorizado,
    o.dest_nombre, o.dest_telefono, o.dest_telefono_2, o.dest_direccion,
    o.estado, o.condicion_especial AS condicionEspecial, o.devuelto, o.devuelto_tienda, o.metodo_pago, o.medio_pago, o.pago_velox, o.pago_velox_metodo,
    (SELECT TOP 1 url FROM ordenes_fotos WHERE id_orden = o.id AND tipo = 'evidencia_medio_pago' ORDER BY subido_en DESC) AS evidencia_url,
    (SELECT TOP 1 url FROM ordenes_fotos WHERE id_orden = o.id AND tipo = 'foto_producto' ORDER BY subido_en DESC) AS foto_producto_url,
    /* Medio de pago que exige foto, pero la foto todavía no llegó
       (el motorizado guardó sin señal y sigue en la cola del celular) */
    CASE WHEN o.medio_pago IN ('pago-tienda', 'pago-empresa')
          AND NOT EXISTS (SELECT 1 FROM ordenes_fotos WHERE id_orden = o.id AND tipo = 'evidencia_medio_pago')
         THEN 1 ELSE 0 END AS evidencia_pendiente,
    /* Fotos de devolución ya registradas: con MAX_FOTOS_DEVOLUCION
       ya no se pide otra al confirmar (ver confirmarDevolucionOrden) */
    (SELECT COUNT(*) FROM ordenes_fotos WHERE id_orden = o.id AND tipo = 'foto_devolucion') AS fotos_devolucion_total,
    /* Orden de ráfaga a la que todavía le faltan datos ("Por completar") */
    o.datos_pendientes,
    o.delivery_base, o.monto_adicional, o.delivery_total,
    o.monto_cobrado, o.monto_producto,
    o.pago_moto_base, o.pago_moto_adicional, o.pago_moto_total,
    o.producto_especial, o.observaciones, o.reprogramado_de,
    /* Motivo del último intento fallido (vista del motorizado, ver
       velox_agregar_motivo_no_entrega.sql) */
    o.motivo_no_entrega
  FROM ordenes o
  JOIN tiendas    t   ON t.id   = o.id_tienda
  JOIN origenes   ori ON ori.id = o.id_origen
  JOIN distritos  d   ON d.id   = o.id_distrito
  JOIN zonas      z   ON z.id   = d.id_zona
  LEFT JOIN motorizados m ON m.id = o.id_motorizado
`;

/* ────────────────────────────────────────────────────────────
   CONTROL DE CONCURRENCIA OPTIMISTA (ver velox_agregar_concurrencia.sql)
   El cliente manda la "version" (row_version en hex) que tenía la
   orden cuando la abrió. Si para cuando llega el guardado esa versión
   ya cambió (alguien más la guardó primero), el UPDATE no toca nada
   y el servidor avisa con 409 + los datos frescos, en vez de pisar
   en silencio lo que el otro usuario ya guardó.

   Es opcional: si el cliente no manda "ifVersion", estas rutas se
   comportan exactamente igual que antes (sin este chequeo) — así
   no se rompe ningún llamador existente (Asignación, autoasignar,
   confirmar devolución, etc.) que todavía no lo usa.
──────────────────────────────────────────────────────────── */
/* { id, activo } del motorizado con ese nombre, o null si no existe */
async function motorizadoPorNombre(pool, nombre) {
  const r = await pool.request()
    .input('moto', sql.NVarChar, nombre)
    .query(`SELECT id, activo FROM motorizados WHERE nombre = @moto`);
  return r.recordset[0] || null;
}

function bufferDeVersion(hex) {
  if (!hex || typeof hex !== 'string') return null;
  const limpio = (hex.startsWith('0x') || hex.startsWith('0X')) ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]{16}$/.test(limpio)) return null;
  return Buffer.from(limpio, 'hex');
}

async function versionActualHex(pool, ordenId) {
  const r = await pool.request()
    .input('id', sql.BigInt, ordenId)
    .query(`SELECT CONVERT(varchar(20), row_version, 1) AS version FROM ordenes WHERE id = @id`);
  return r.recordset[0] ? r.recordset[0].version : null;
}

/* Se llama después de un UPDATE que filtró por versión y no tocó
   ninguna fila — devuelve la orden fresca para mostrar qué cambió. */
async function conflictoDeVersion(pool, ordenId) {
  const fresh = await pool.request()
    .input('id', sql.BigInt, ordenId)
    .query(`${SELECT_ORDEN} WHERE o.id = @id`);
  return fresh.recordset[0] || null;
}

/* ── GET /api/ordenes?fecha=YYYY-MM-DD ───────────────────────
   "fecha" es el día de REPARTO (fecha_reparto), no el de creación:
   una orden creada el 20 y asignada para el 21 sale el 21. */
router.get('/', async (req, res) => {
  try {
    const pool    = await getPool();
    const request = pool.request();
    const fecha   = req.query.fecha;

    let where = 'WHERE 1 = 1';
    if (fecha) {
      request.input('fecha', sql.Date, fecha);
      where += ' AND o.fecha_reparto = @fecha';
    }
    where += ' ' + filtroPorRol(req.usuario, request).sql;

    const result = await request.query(
      `${SELECT_ORDEN} ${where} ORDER BY o.fecha_reparto DESC, o.id DESC`
    );
    res.json(result.recordset);
  } catch (err) {
    console.error('GET /ordenes:', err.message);
    res.status(500).json({ error: 'Error al listar órdenes' });
  }
});

/* ── GET /api/ordenes/pendientes-datos (admin / operador) ────
   Órdenes de ráfaga a las que les faltan datos, de cualquier
   fecha, la más vieja primero (en el orden en que se tomaron las
   fotos). Devuelve también qué campos hay que completar, para que
   la ventana "Pendiente" los arme sin tenerlos repetidos.
   Va antes de GET /:id para que no la capture esa ruta. */
router.get('/pendientes-datos', requireRol(...GESTORES), async (req, res) => {
  try {
    const pool   = await getPool();
    const result = await pool.request().query(
      `${SELECT_ORDEN} WHERE o.datos_pendientes = 1 ORDER BY o.id`
    );
    /* falta_tienda: orden creada con la tienda comodín (ver arriba,
       chequeo fijo): solo esas filas muestran el buscador de tienda */
    const ordenes = result.recordset.map(o => ({ ...o, falta_tienda: !tieneTiendaReal(o) }));
    res.json({ campos: CAMPOS_PENDIENTES, ordenes });
  } catch (err) {
    console.error('GET /ordenes/pendientes-datos:', err.message);
    res.status(500).json({ error: 'Error al listar las órdenes pendientes' });
  }
});

/* Solo la cantidad: la consulta el botón "Pendiente" en cada
   refresco automático, sin traer las órdenes enteras */
router.get('/pendientes-datos/total', requireRol(...GESTORES), async (req, res) => {
  try {
    const pool   = await getPool();
    const result = await pool.request().query(
      `SELECT COUNT(*) AS total FROM ordenes WHERE datos_pendientes = 1`
    );
    res.json({ total: result.recordset[0].total });
  } catch (err) {
    console.error('GET /ordenes/pendientes-datos/total:', err.message);
    res.status(500).json({ error: 'Error al contar las órdenes pendientes' });
  }
});

/* ── GET /api/ordenes/:id ────────────────────────────────── */
router.get('/:id', async (req, res) => {
  try {
    const pool    = await getPool();
    const request = pool.request().input('id', sql.BigInt, req.params.id);

    let where = 'WHERE o.id = @id ' + filtroPorRol(req.usuario, request).sql;

    const result = await request.query(`${SELECT_ORDEN} ${where}`);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }
    const orden = result.recordset[0];

    /* Todas las fotos de la orden que ese rol puede ver, para la
       sección "Fotos" de "Actualizar orden" (mismas reglas que
       puedeVerFotoOrden): los gestores, todas; el motorizado (ya
       filtrado a sus órdenes por filtroPorRol), todas menos las de
       devolución de la oficina. La tienda y el visor no reciben la
       lista (la tienda ya tiene foto_producto_url). */
    const esGestor = GESTORES.includes(req.usuario.rol);
    if (esGestor || req.usuario.rol === 'motorizado') {
      const fotos = await pool.request()
        .input('id', sql.BigInt, req.params.id)
        .query(`SELECT id, tipo, url, CONVERT(varchar(16), subido_en, 120) AS subido_en
                FROM ordenes_fotos
                WHERE id_orden = @id AND url <> ''
                ORDER BY subido_en, id`);
      orden.fotos = fotos.recordset.filter((f) => esGestor || !TIPOS_FOTO_DEVOLUCION.includes(f.tipo));
    }
    res.json(orden);
  } catch (err) {
    console.error('GET /ordenes/:id:', err.message);
    res.status(500).json({ error: 'Error al obtener la orden' });
  }
});

/* ── POST /api/ordenes — Crear (admin / operador) ────────── */
router.post('/', requireRol(...GESTORES), async (req, res) => {
  try {
    const pool = await getPool();
    const o    = req.body;

    /* Flujo rápido (botón de cámara): si no se eligió distrito, la
       orden se guarda con el comodín "SIN DEFINIR" y se completa
       después desde "Actualizar orden" */
    const nombreDistrito = (o.distrito && String(o.distrito).trim()) || DISTRITO_SIN_DEFINIR;

    const lookups = await pool.request()
      .input('tienda',   sql.NVarChar, o.tienda)
      .input('origen',   sql.NVarChar, o.origen || 'GAMARRA')
      .input('distrito', sql.NVarChar, nombreDistrito)
      .query(`
        SELECT
          (SELECT id     FROM tiendas   WHERE nombre = @tienda)   AS id_tienda,
          (SELECT activa FROM tiendas   WHERE nombre = @tienda)   AS tienda_activa,
          (SELECT id     FROM origenes  WHERE nombre = @origen)   AS id_origen,
          (SELECT id     FROM distritos WHERE nombre = @distrito) AS id_distrito
      `);

    const { id_tienda, tienda_activa, id_origen, id_distrito } = lookups.recordset[0];

    if (!id_tienda)   return res.status(400).json({ error: `Tienda no encontrada: ${o.tienda}` });
    /* El comodín es solo para las órdenes de ráfaga (POST /rafaga) */
    if (o.tienda === TIENDA_SIN_DEFINIR) return res.status(400).json({ error: 'Elegí una tienda.' });
    /* Una tienda inactiva sigue en el catálogo (historial) pero no
       recibe órdenes nuevas */
    if (!tienda_activa) return res.status(400).json({ error: `La tienda ${o.tienda} está inactiva: reactívala en "Tiendas" para crearle órdenes.` });
    if (!id_origen)   return res.status(400).json({ error: `Origen no encontrado: ${o.origen}` });
    if (!id_distrito) {
      return res.status(400).json({
        error: nombreDistrito === DISTRITO_SIN_DEFINIR
          ? 'Falta el distrito "SIN DEFINIR" en la base: corré velox_agregar_distrito_sin_definir.sql.'
          : `Distrito no encontrado: ${nombreDistrito}`
      });
    }

    if (o.condicionEspecial && !CONDICIONES_ESPECIALES.includes(o.condicionEspecial)) {
      return res.status(400).json({ error: 'Condición especial no válida' });
    }

    let id_motorizado = null;
    if (o.motorizado) {
      const moto = await motorizadoPorNombre(pool, o.motorizado);
      if (!moto) return res.status(400).json({ error: `Motorizado no encontrado: ${o.motorizado}` });
      if (!moto.activo) return res.status(400).json({ error: `El motorizado ${o.motorizado} está inactivo.` });
      id_motorizado = moto.id;
    }

    const nueva = await insertarConCodigoNuevo(pool, async (codigo) => {
      const insertRes = await pool.request()
        .input('codigo',       sql.NVarChar,      codigo)
        .input('fecha',        sql.Date,          o.fecha)
        .input('hora',         sql.NVarChar,      o.horaAsig || null)
        .input('id_tienda',    sql.Int,           id_tienda)
        .input('id_origen',    sql.Int,           id_origen)
        .input('id_distrito',  sql.Int,           id_distrito)
        .input('id_moto',      sql.Int,           id_motorizado)
        .input('dest_nombre',  sql.NVarChar,      o.dest || '')
        .input('dest_tel',     sql.NVarChar,      o.telefDest || '')
        .input('dest_tel2',    sql.NVarChar,      o.telefDest2 || '')
        .input('dest_dir',     sql.NVarChar,      o.direccion || '')
        .input('estado',       sql.NVarChar,      'en-proceso')
        .input('condicion',    sql.NVarChar,      o.condicionEspecial || null)
        .input('pago_velox',   sql.NVarChar,      o.pagoVelox === 'pre-pagado' ? 'PAGADO' : 'PENDIENTE')
        .input('pago_velox_metodo', sql.NVarChar, (o.pagoVelox === 'pre-pagado' && PAGO_VELOX_METODOS.includes(o.pagoVeloxMetodo)) ? o.pagoVeloxMetodo : null)
        .input('metodo',       sql.NVarChar,      o.metodoPago || '')
        .input('delivery',     sql.Decimal(10,2), parseFloat(o.delivery) || 0)
        .input('adicional',    sql.Decimal(10,2), parseFloat(o.montoAdicional) || 0)
        .input('cobrado',      sql.Decimal(10,2), parseFloat(o.montoCobrado) || 0)
        .input('producto',     sql.Decimal(10,2), parseFloat(o.montoProducto) || 0)
        .input('pago_moto',    sql.Decimal(10,2), parseFloat(o.pagoMotoBase) || 0)
        .input('pago_moto_ad', sql.Decimal(10,2), parseFloat(o.pagoMotoAdic) || 0)
        .input('especial',     sql.Bit,           o.productoEspecial ? 1 : 0)
        .input('obs',          sql.NVarChar,      o.obs || '')
        .query(`
          INSERT INTO ordenes (
            codigo, fecha, hora_asignacion,
            id_tienda, id_origen, id_distrito, id_motorizado,
            dest_nombre, dest_telefono, dest_telefono_2, dest_direccion,
            estado, condicion_especial, pago_velox, pago_velox_metodo, metodo_pago,
            delivery_base, monto_adicional, monto_cobrado, monto_producto,
            pago_moto_base, pago_moto_adicional,
            producto_especial, observaciones
          ) VALUES (
            @codigo, @fecha, @hora,
            @id_tienda, @id_origen, @id_distrito, @id_moto,
            @dest_nombre, @dest_tel, @dest_tel2, @dest_dir,
            @estado, @condicion, @pago_velox, @pago_velox_metodo, @metodo,
            @delivery, @adicional, @cobrado, @producto,
            @pago_moto, @pago_moto_ad,
            @especial, @obs
          );
          SELECT SCOPE_IDENTITY() AS id;
        `);
      return insertRes.recordset[0].id;
    });

    res.status(201).json({ id: nueva.id, codigo: nueva.codigo });
  } catch (err) {
    console.error('POST /ordenes:', err.message);
    res.status(500).json({ error: 'Error al crear la orden' });
  }
});

/* ── POST /api/ordenes/rafaga — Foto en ráfaga (admin / operador)
   Crea una orden SIN datos para una foto tomada en serie, con la
   tienda elegida al empezar la ráfaga, distrito comodín
   "SIN DEFINIR" y datos_pendientes = 1. Si no viene tienda (fotos
   que quedaron en la cola de un celular con el flujo viejo) o la
   tienda ya no es válida (se desactivó entre la foto y la subida),
   la orden se crea igual con la tienda comodín, para no perder la
   foto: la ventana "Pendiente" pide la tienda en esas filas. La foto
   se sube después, por la cola (js/cola-fotos.js), con el id que
   devuelve esta ruta.

   No duplica: el celular manda un idCreacion (UUID) por foto. Si
   la orden ya se creó pero la respuesta se perdió por la señal, el
   reintento llega con el mismo id y se devuelve la orden que ya
   existe (200, existente: true) en vez de crear otra.

   fecha / hora son las del momento de la foto (las manda el
   celular): una foto tomada a las 23:58 que sube al otro día
   queda con la fecha en que se tomó. */
const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const REGEX_HORA  = /^\d{2}:\d{2}$/;

async function ordenPorIdCreacion(pool, idCreacion) {
  const r = await pool.request()
    .input('idCreacion', sql.UniqueIdentifier, idCreacion)
    .query(`SELECT id, codigo FROM ordenes WHERE id_creacion = @idCreacion`);
  return r.recordset[0] || null;
}

router.post('/rafaga', requireRol(...GESTORES), async (req, res) => {
  try {
    const pool = await getPool();
    const idCreacion = (typeof req.body.idCreacion === 'string' && REGEX_UUID.test(req.body.idCreacion))
      ? req.body.idCreacion.toLowerCase() : null;
    if (!idCreacion) return res.status(400).json({ error: 'Falta el identificador de la foto (idCreacion).' });

    const fecha = REGEX_FECHA.test(req.body.fecha || '') ? req.body.fecha : null;
    const hora  = REGEX_HORA.test(req.body.hora || '')   ? req.body.hora  : null;

    const yaExiste = await ordenPorIdCreacion(pool, idCreacion);
    if (yaExiste) return res.json({ id: yaExiste.id, codigo: yaExiste.codigo, existente: true });

    const tiendaPedida = typeof req.body.tienda === 'string' ? req.body.tienda.trim() : '';

    const lookups = await pool.request()
      .input('tienda',   sql.NVarChar, TIENDA_SIN_DEFINIR)
      .input('pedida',   sql.NVarChar, tiendaPedida)
      .input('origen',   sql.NVarChar, 'GAMARRA')
      .input('distrito', sql.NVarChar, DISTRITO_SIN_DEFINIR)
      .query(`
        SELECT
          (SELECT id FROM tiendas   WHERE nombre = @tienda)   AS id_comodin,
          (SELECT id FROM tiendas   WHERE nombre = @pedida AND activa = 1 AND nombre <> @tienda) AS id_pedida,
          (SELECT id FROM origenes  WHERE nombre = @origen)   AS id_origen,
          (SELECT id FROM distritos WHERE nombre = @distrito) AS id_distrito
      `);
    const { id_comodin, id_pedida, id_origen, id_distrito } = lookups.recordset[0];
    const id_tienda = id_pedida || id_comodin;
    if (!id_tienda)   return res.status(500).json({ error: 'Falta la tienda "SIN DEFINIR" en la base: corré velox_agregar_rafaga.sql.' });
    if (tiendaPedida && !id_pedida) {
      console.warn(`POST /ordenes/rafaga: tienda no válida "${tiendaPedida}", se usa el comodín`);
    }
    if (!id_distrito) return res.status(500).json({ error: 'Falta el distrito "SIN DEFINIR" en la base: corré velox_agregar_distrito_sin_definir.sql.' });
    if (!id_origen)   return res.status(500).json({ error: 'Origen no encontrado: GAMARRA' });

    try {
      const nueva = await insertarConCodigoNuevo(pool, async (codigo) => {
        const insertRes = await pool.request()
          .input('codigo',      sql.NVarChar,         codigo)
          .input('fecha',       sql.Date,             fecha)
          .input('hora',        sql.NVarChar,         hora)
          .input('id_tienda',   sql.Int,              id_tienda)
          .input('id_origen',   sql.Int,              id_origen)
          .input('id_distrito', sql.Int,              id_distrito)
          .input('idCreacion',  sql.UniqueIdentifier, idCreacion)
          .query(`
            INSERT INTO ordenes (
              codigo, fecha, hora_asignacion,
              id_tienda, id_origen, id_distrito, id_motorizado,
              dest_nombre, dest_telefono, dest_telefono_2, dest_direccion,
              estado, pago_velox, metodo_pago, observaciones,
              datos_pendientes, id_creacion
            ) VALUES (
              @codigo, ISNULL(@fecha, CAST(GETDATE() AS DATE)), @hora,
              @id_tienda, @id_origen, @id_distrito, NULL,
              '', '', '', '',
              'en-proceso', 'PENDIENTE', 'sin-cobro', '',
              1, @idCreacion
            );
            SELECT SCOPE_IDENTITY() AS id;
          `);
        return insertRes.recordset[0].id;
      });
      res.status(201).json({ id: nueva.id, codigo: nueva.codigo });
    } catch (err) {
      /* Dos reintentos de la misma foto llegaron a la vez: el segundo
         choca con el índice único y devuelve la que creó el primero */
      if (esDuplicado(err, 'ux_ordenes_id_creacion')) {
        const creada = await ordenPorIdCreacion(pool, idCreacion);
        if (creada) return res.json({ id: creada.id, codigo: creada.codigo, existente: true });
      }
      throw err;
    }
  } catch (err) {
    console.error('POST /ordenes/rafaga:', err.message);
    res.status(500).json({ error: 'Error al crear la orden de la foto' });
  }
});

/* ── PATCH /api/ordenes/:id/completar-datos (admin / operador)
   Ventana "Pendiente": completa los datos de una orden de ráfaga
   sin tocar nada más (por eso no se usa /completo, que pisa todos
   los campos). Los CAMPOS_PENDIENTES son obligatorios; los que no
   estén en la lista se guardan solo si vienen. La tienda es
   obligatoria solo si la orden todavía tiene la tienda comodín.

   Al guardar distrito y cobrado se completa solo lo que depende de
   ellos (afecta la Caja), con las mismas reglas que el formulario:
   · Distrito → delivery y pago al motorizado con la tarifa del
     distrito (como "Nueva orden", onDistritoChange en js/pedidos.js).
   · Cobrado → método de pago: contraentrega si es > 0, sin-cobro
     si es 0.
   · Valor del producto = cobrado − (delivery + adicional), nunca
     negativo (como "Actualizar orden", _recalcularValorProductoUpdate
     en js/motorizados.js).

   Si otro usuario ya la completó (o la cambió, con ifVersion)
   responde 409 con la orden fresca. */
const COBRADO_MAXIMO = 999999.99;  /* monto_cobrado es DECIMAL(8,2) */

router.patch('/:id/completar-datos', requireRol(...GESTORES), async (req, res) => {
  try {
    const pool = await getPool();
    const b    = req.body;
    const obligatorio = c => CAMPOS_PENDIENTES.includes(c);

    const actual = await pool.request()
      .input('id', sql.BigInt, req.params.id)
      .query(`
        SELECT t.nombre AS tienda
        FROM ordenes o
        JOIN tiendas t ON t.id = o.id_tienda
        WHERE o.id = @id
      `);
    if (!actual.recordset[0]) return res.status(404).json({ error: 'Orden no encontrada' });
    const faltaTienda = !tieneTiendaReal(actual.recordset[0]);

    const sets    = [];
    const request = pool.request().input('id', sql.BigInt, req.params.id);

    /* Tienda: tiene que existir, estar activa y no ser el comodín */
    const tienda = typeof b.tienda === 'string' ? b.tienda.trim() : '';
    if (tienda) {
      const tRes = await pool.request()
        .input('tienda', sql.NVarChar, tienda)
        .query(`SELECT id, activa FROM tiendas WHERE nombre = @tienda`);
      const t = tRes.recordset[0];
      if (!t || !t.activa || tienda === TIENDA_SIN_DEFINIR) {
        return res.status(400).json({ error: `Tienda no válida: ${tienda}` });
      }
      request.input('id_tienda', sql.Int, t.id);
      sets.push('id_tienda = @id_tienda');
    } else if (faltaTienda || obligatorio('tienda')) {
      return res.status(400).json({ error: 'La tienda es obligatoria.' });
    }

    /* Destinatario: mismo rango que el formulario (2 a 100 letras) */
    const dest = typeof b.dest === 'string' ? b.dest.trim() : '';
    if (dest) {
      if (dest.length < 2 || dest.length > 100) {
        return res.status(400).json({ error: 'El nombre del destinatario debe tener entre 2 y 100 caracteres.' });
      }
      request.input('dest_nombre', sql.NVarChar, dest);
      sets.push('dest_nombre = @dest_nombre');
    } else if (obligatorio('destinatario')) {
      return res.status(400).json({ error: 'El destinatario es obligatorio.' });
    }

    /* Teléfono: 9 dígitos, igual que js/validators.js */
    const telef = typeof b.telefDest === 'string' ? b.telefDest.replace(/[\s\-()]/g, '') : '';
    if (telef) {
      if (!/^[0-9]{9}$/.test(telef)) {
        return res.status(400).json({ error: 'El teléfono debe tener exactamente 9 dígitos.' });
      }
      request.input('dest_tel', sql.NVarChar, telef);
      sets.push('dest_telefono = @dest_tel');
    } else if (obligatorio('telefono')) {
      return res.status(400).json({ error: 'El teléfono es obligatorio.' });
    }

    /* Distrito: tiene que existir, estar activo y no ser el comodín.
       Trae la tarifa: delivery y pago al motorizado. */
    const distrito = typeof b.distrito === 'string' ? b.distrito.trim() : '';
    let deliveryNuevo = false;
    if (distrito) {
      const dRes = await pool.request()
        .input('distrito', sql.NVarChar, distrito)
        .query(`SELECT id, activo, precio_delivery, pago_motorizado FROM distritos WHERE nombre = @distrito`);
      const d = dRes.recordset[0];
      if (!d || !d.activo || distrito === DISTRITO_SIN_DEFINIR) {
        return res.status(400).json({ error: `Distrito no válido: ${distrito}` });
      }
      request
        .input('id_distrito',   sql.Int,           d.id)
        .input('delivery_base', sql.Decimal(10,2), parseFloat(d.precio_delivery) || 0)
        .input('pago_moto',     sql.Decimal(10,2), parseFloat(d.pago_motorizado) || 0);
      sets.push('id_distrito = @id_distrito', 'delivery_base = @delivery_base', 'pago_moto_base = @pago_moto');
      deliveryNuevo = true;
    } else if (obligatorio('distrito')) {
      return res.status(400).json({ error: 'El distrito es obligatorio.' });
    }

    /* Cobrado: hay que escribirlo, 0 es válido (= sin cobro) */
    const cobradoTxt = (b.cobrado === undefined || b.cobrado === null) ? '' : String(b.cobrado).trim();
    let cobradoNuevo = false;
    if (cobradoTxt !== '') {
      const cobrado = Number(cobradoTxt);
      if (!Number.isFinite(cobrado) || cobrado < 0 || cobrado > COBRADO_MAXIMO) {
        return res.status(400).json({ error: 'El monto por cobrar no es válido.' });
      }
      request
        .input('cobrado', sql.Decimal(10,2), Math.round(cobrado * 100) / 100)
        .input('metodo',  sql.NVarChar,      cobrado > 0 ? 'contraentrega' : 'sin-cobro');
      sets.push('monto_cobrado = @cobrado', 'metodo_pago = @metodo');
      cobradoNuevo = true;
    } else if (obligatorio('cobrado')) {
      return res.status(400).json({ error: 'El monto por cobrar es obligatorio (0 si no se cobra).' });
    }

    /* Valor del producto con los valores NUEVOS (en un UPDATE, las
       columnas de la derecha valen lo que tenían antes) */
    if (deliveryNuevo || cobradoNuevo) {
      const cobradoSql  = cobradoNuevo  ? '@cobrado'       : 'monto_cobrado';
      const deliverySql = deliveryNuevo ? '@delivery_base' : 'delivery_base';
      const resto = `${cobradoSql} - (${deliverySql} + monto_adicional)`;
      sets.push(`monto_producto = CASE WHEN ${resto} > 0 THEN ${resto} ELSE 0 END`);
    }

    if (sets.length === 0) return res.status(400).json({ error: 'No hay datos para guardar.' });

    const ifVersion = bufferDeVersion(b.ifVersion);
    let whereVersion = '';
    if (ifVersion) { request.input('ifVersion', sql.VarBinary(8), ifVersion); whereVersion = ' AND row_version = @ifVersion'; }

    const result = await request.query(`
      UPDATE ordenes
      SET ${sets.join(', ')}, actualizado_en = GETDATE()
      WHERE id = @id AND datos_pendientes = 1${whereVersion}
    `);
    if (result.rowsAffected[0] === 0) {
      const fresca = await conflictoDeVersion(pool, req.params.id);
      if (!fresca) return res.status(404).json({ error: 'Orden no encontrada' });
      return res.status(409).json({
        error: fresca.datos_pendientes
          ? 'Esta orden fue modificada por otro usuario mientras la completabas.'
          : 'Esta orden ya fue completada por otro usuario.',
        orden: fresca,
      });
    }

    const siguePendiente = await recalcularDatosPendientes(pool, req.params.id);
    res.json({
      ok: true,
      datos_pendientes: siguePendiente ? 1 : 0,
      version: await versionActualHex(pool, req.params.id),
    });
  } catch (err) {
    console.error('PATCH /ordenes/:id/completar-datos:', err.message);
    res.status(500).json({ error: 'Error al completar los datos de la orden' });
  }
});

/* ── PATCH /api/ordenes/:id/estado ───────────────────────────
   Gestores: cualquier orden. Motorizado: solo las suyas. */
router.patch('/:id/estado', async (req, res) => {
  try {
    const pool = await getPool();

    if (!(await puedeTocarOrden(req.usuario, req.params.id, pool))) {
      return res.status(403).json({ error: 'No puedes modificar esta orden' });
    }

    const ESTADOS = ['entregado','no-entregado','ausente','reprogramado','cancelado',
                     'devolucion','en-proceso'];
    const { estado } = req.body;
    let { metodoPago, condicionEspecial } = req.body;
    if (!ESTADOS.includes(estado)) {
      return res.status(400).json({ error: 'Estado no válido' });
    }
    if (condicionEspecial && !CONDICIONES_ESPECIALES.includes(condicionEspecial)) {
      return res.status(400).json({ error: 'Condición especial no válida' });
    }

    /* Un motorizado no puede cambiar el método de pago ni la condición
       especial (aunque los mande en el body) — se ignoran y se
       conserva lo que ya había. La UI ya los muestra bloqueados; esto
       es la protección real. */
    if (req.usuario.rol === 'motorizado') {
      const actual = await pool.request()
        .input('id', sql.BigInt, req.params.id)
        .query(`SELECT metodo_pago, condicion_especial FROM ordenes WHERE id = @id`);
      if (!actual.recordset[0]) return res.status(404).json({ error: 'Orden no encontrada' });
      metodoPago        = actual.recordset[0].metodo_pago;
      condicionEspecial = actual.recordset[0].condicion_especial;
    }

    const ifVersion = bufferDeVersion(req.body.ifVersion);
    const request = pool.request()
      .input('id',        sql.BigInt,   req.params.id)
      .input('estado',    sql.NVarChar, estado)
      .input('metodo',    sql.NVarChar, metodoPago || '')
      .input('condicion', sql.NVarChar, condicionEspecial || null);
    let whereVersion = '';
    if (ifVersion) { request.input('ifVersion', sql.VarBinary(8), ifVersion); whereVersion = ' AND row_version = @ifVersion'; }

    const result = await request.query(
      `UPDATE ordenes SET estado = @estado, metodo_pago = @metodo, condicion_especial = @condicion WHERE id = @id${whereVersion}`
    );
    if (ifVersion && result.rowsAffected[0] === 0) {
      const fresca = await conflictoDeVersion(pool, req.params.id);
      if (!fresca) return res.status(404).json({ error: 'Orden no encontrada' });
      return res.status(409).json({ error: 'Esta orden fue modificada por otro usuario mientras la editabas.', orden: fresca });
    }

    res.json({ ok: true, version: await versionActualHex(pool, req.params.id) });
  } catch (err) {
    console.error('PATCH /ordenes/:id/estado:', err.message);
    res.status(500).json({ error: 'Error al actualizar el estado' });
  }
});

/* ── PATCH /api/ordenes/:id/resolver ─────────────────────────
   La vista del motorizado (js/entregas-moto.js) cierra una orden en
   reparto con un solo pedido: COMPLETAR (entregado + medio de pago),
   OTROS (reprogramado / ausente / cancelado) o DETALLE (no entregado
   + motivo). Gestores, o el motorizado dueño de la orden.
   Body: { resultado, medioPago?, motivo?, ifVersion? }
   · Solo órdenes "en-proceso" y con motorizado: una orden ya resuelta
     no se resuelve dos veces (corregirla es cosa de "Actualizar orden").
   · Entregado contraentrega exige el medio de pago; sin cobro, no lleva.
   · No entregado exige el motivo; en los otros es opcional. Se guarda
     en ordenes.motivo_no_entrega (el del último intento fallido).
   · No toca montos ni condición especial (como /estado para el moto).
   · Revisa que el día no esté pagado en la Caja, como /completo.
   Las fotos NO pasan por acá: la pantalla las manda a la cola recién
   cuando esto respondió bien (regla de fotos, ver CLAUDE.md). Todo va
   en un solo UPDATE: no queda nada guardado a medias. */
const RESULTADOS_RESOLVER = ['entregado', 'reprogramado', 'ausente', 'cancelado', 'no-entregado'];

router.patch('/:id/resolver', async (req, res) => {
  try {
    const pool = await getPool();
    const ordenId = req.params.id;

    if (!(await puedeTocarOrden(req.usuario, ordenId, pool))) {
      return res.status(403).json({ error: 'No puedes modificar esta orden' });
    }

    const { resultado, medioPago } = req.body;
    const motivo = typeof req.body.motivo === 'string' ? req.body.motivo.trim() : '';
    if (!RESULTADOS_RESOLVER.includes(resultado)) {
      return res.status(400).json({ error: 'Resultado no válido' });
    }
    if (motivo.length > 300) {
      return res.status(400).json({ error: 'El motivo no puede pasar de 300 caracteres' });
    }
    if (resultado === 'no-entregado' && !motivo) {
      return res.status(400).json({ error: 'Indica el motivo por el que no se entregó' });
    }

    const r = await pool.request()
      .input('id', sql.BigInt, ordenId)
      .query(`SELECT estado, metodo_pago, id_tienda, id_motorizado, pago_velox, datos_pendientes,
                     CONVERT(varchar, fecha_reparto, 23) AS fecha_reparto
              FROM ordenes WHERE id = @id`);
    const orden = r.recordset[0];
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });

    if (orden.estado !== 'en-proceso') {
      return res.status(409).json({ error: 'Esta orden ya fue cerrada (' + orden.estado + ').', yaResuelta: true, estado: orden.estado });
    }
    if (!orden.id_motorizado) {
      return res.status(400).json({ error: 'Esta orden no tiene motorizado asignado.' });
    }
    if (orden.datos_pendientes) {
      return res.status(400).json({ error: 'A esta orden todavía le faltan datos ("Por completar").' });
    }

    /* Medio de pago: solo al entregar una contraentrega */
    let medio = null;
    if (resultado === 'entregado' && orden.metodo_pago === 'contraentrega') {
      if (!MEDIOS_PAGO.includes(medioPago)) {
        return res.status(400).json({ error: 'Elige cómo se recibió el pago' });
      }
      medio = medioPago;
    }

    const bloqueo = await bloqueoPorResolverEnDiaPagado(pool, orden, resultado);
    if (bloqueo) return res.status(400).json({ error: bloqueo, diaPagado: true });

    const ifVersion = bufferDeVersion(req.body.ifVersion);
    const request = pool.request()
      .input('id',     sql.BigInt,   ordenId)
      .input('estado', sql.NVarChar, resultado)
      .input('medio',  sql.NVarChar, medio)
      .input('motivo', sql.NVarChar, motivo || null);
    let whereVersion = '';
    if (ifVersion) { request.input('ifVersion', sql.VarBinary(8), ifVersion); whereVersion = ' AND row_version = @ifVersion'; }

    /* Entregado conserva el motivo del último intento fallido (es
       historia); los otros resultados lo pisan con el de este intento.
       El medio de pago se guarda solo si se entregó con cobro. */
    const result = await request.query(`
      UPDATE ordenes
      SET estado = @estado,
          medio_pago = CASE WHEN @estado = 'entregado' AND metodo_pago = 'contraentrega' THEN @medio ELSE medio_pago END,
          motivo_no_entrega = CASE WHEN @estado = 'entregado' THEN motivo_no_entrega ELSE @motivo END
      WHERE id = @id AND estado = 'en-proceso'${whereVersion}
    `);
    if (result.rowsAffected[0] === 0) {
      const fresca = await conflictoDeVersion(pool, ordenId);
      if (!fresca) return res.status(404).json({ error: 'Orden no encontrada' });
      return res.status(409).json({ error: 'Esta orden fue modificada por otro usuario mientras la llenabas.', orden: fresca });
    }

    res.json({ ok: true, version: await versionActualHex(pool, ordenId) });
  } catch (err) {
    console.error('PATCH /ordenes/:id/resolver:', err.message);
    res.status(500).json({ error: 'Error al cerrar la orden' });
  }
});

/* ── PATCH /api/ordenes/:id/contacto ─────────────────────── */
router.patch('/:id/contacto', async (req, res) => {
  try {
    const pool = await getPool();

    if (!(await puedeTocarOrden(req.usuario, req.params.id, pool))) {
      return res.status(403).json({ error: 'No puedes modificar esta orden' });
    }

    const { telefono, telefono2 } = req.body;
    await pool.request()
      .input('id',        sql.BigInt,   req.params.id)
      .input('telefono',  sql.NVarChar, telefono || '')
      .input('telefono2', sql.NVarChar, telefono2 || '')
      .query(`
        UPDATE ordenes
        SET dest_telefono = @telefono, dest_telefono_2 = @telefono2
        WHERE id = @id
      `);

    res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /ordenes/:id/contacto:', err.message);
    res.status(500).json({ error: 'Error al actualizar el contacto' });
  }
});

/* ── PATCH /api/ordenes/:id/completo ─────────────────────────
   Gestores: cualquier orden, todos los campos. Motorizado: solo
   las suyas, y los montos de "gestión" (delivery, adicionales,
   cobrado, pago al motorizado) se ignoran pase lo que pase en el
   body — se conserva lo que ya había en la base (ver más abajo). */
router.patch('/:id/completo', async (req, res) => {
  try {
    const pool = await getPool();

    if (!(await puedeTocarOrden(req.usuario, req.params.id, pool))) {
      return res.status(403).json({ error: 'No puedes modificar esta orden' });
    }
    const esMotorizado = req.usuario.rol === 'motorizado';

    const o = req.body;

    const lookups = await pool.request()
      .input('id',       sql.BigInt,   req.params.id)
      .input('tienda',   sql.NVarChar, o.tienda)
      .input('distrito', sql.NVarChar, o.distrito)
      .query(`
        SELECT
          (SELECT id     FROM tiendas   WHERE nombre = @tienda)   AS id_tienda,
          (SELECT activa FROM tiendas   WHERE nombre = @tienda)   AS tienda_activa,
          (SELECT id     FROM distritos WHERE nombre = @distrito) AS id_distrito,
          (SELECT id_tienda FROM ordenes WHERE id = @id)          AS id_tienda_actual
      `);

    const { id_tienda, tienda_activa, id_distrito, id_tienda_actual } = lookups.recordset[0];
    if (!id_tienda)   return res.status(400).json({ error: `Tienda no encontrada: ${o.tienda}` });
    if (!id_distrito) return res.status(400).json({ error: `Distrito no encontrado: ${o.distrito}` });
    /* Pasar la orden a una tienda inactiva no; conservar la que ya
       tenía sí (una orden vieja de una tienda que después se
       desactivó tiene que poder seguir editándose) */
    if (!tienda_activa && id_tienda !== id_tienda_actual) {
      return res.status(400).json({ error: `La tienda ${o.tienda} está inactiva.` });
    }

    /* La tienda comodín solo puede quedar en una orden de ráfaga que
       todavía está pendiente (se guardan otros datos sin elegir la
       tienda aún); a una orden normal no se le puede poner */
    if (o.tienda === TIENDA_SIN_DEFINIR) {
      const p = await pool.request()
        .input('id', sql.BigInt, req.params.id)
        .query(`SELECT datos_pendientes FROM ordenes WHERE id = @id`);
      if (!p.recordset[0] || !p.recordset[0].datos_pendientes) {
        return res.status(400).json({ error: 'Elegí una tienda.' });
      }
    }

    let delivery  = parseFloat(o.delivery)      || 0;
    let adicional  = parseFloat(o.montoAdicional)|| 0;
    let cobrado    = parseFloat(o.montoCobrado)  || 0;
    let producto   = parseFloat(o.montoProducto) || 0;
    let pagoMoto   = parseFloat(o.pagoMotoBase)  || 0;
    let pagoMotoAd = parseFloat(o.pagoMotoAdic)  || 0;

    /* Un motorizado no puede tocar estos montos (aunque los mande en
       el body): se ignoran y se conserva lo que ya había en la base.
       La UI ya los muestra bloqueados; esto es la protección real —
       nunca confiar en lo que manda el cliente. */
    if (esMotorizado) {
      const actual = await pool.request()
        .input('id', sql.BigInt, req.params.id)
        .query(`
          SELECT delivery_base, monto_adicional, monto_cobrado, monto_producto,
                 pago_moto_base, pago_moto_adicional
          FROM ordenes WHERE id = @id
        `);
      const a = actual.recordset[0];
      if (!a) return res.status(404).json({ error: 'Orden no encontrada' });
      delivery   = a.delivery_base;
      adicional  = a.monto_adicional;
      cobrado    = a.monto_cobrado;
      producto   = a.monto_producto;
      pagoMoto   = a.pago_moto_base;
      pagoMotoAd = a.pago_moto_adicional;
    }

    const pagoVelox = o.pagoVelox === 'pre-pagado' ? 'PAGADO' : 'PENDIENTE';
    const pagoVeloxMetodo = (pagoVelox === 'PAGADO' && PAGO_VELOX_METODOS.includes(o.pagoVeloxMetodo))
      ? o.pagoVeloxMetodo : null;

    const ifVersion = bufferDeVersion(o.ifVersion);
    const request = pool.request()
      .input('id',           sql.BigInt,        req.params.id)
      .input('id_tienda',    sql.Int,           id_tienda)
      .input('id_distrito',  sql.Int,           id_distrito)
      .input('dest_nombre',  sql.NVarChar,      o.dest || '')
      .input('dest_tel',     sql.NVarChar,      o.telefDest || '')
      .input('dest_tel2',    sql.NVarChar,      o.telefDest2 || '')
      .input('dest_dir',     sql.NVarChar,      o.direccion || '')
      .input('delivery',     sql.Decimal(10,2), delivery)
      .input('adicional',    sql.Decimal(10,2), adicional)
      .input('cobrado',      sql.Decimal(10,2), cobrado)
      .input('producto',     sql.Decimal(10,2), producto)
      .input('pago_moto',    sql.Decimal(10,2), pagoMoto)
      .input('pago_moto_ad', sql.Decimal(10,2), pagoMotoAd)
      .input('pago_velox',   sql.NVarChar,      pagoVelox)
      .input('pago_velox_metodo', sql.NVarChar, pagoVeloxMetodo)
      .input('obs',          sql.NVarChar,      o.obs || '');
    let whereVersion = '';
    if (ifVersion) { request.input('ifVersion', sql.VarBinary(8), ifVersion); whereVersion = ' AND row_version = @ifVersion'; }

    const result = await request.query(`
        UPDATE ordenes
        SET id_tienda           = @id_tienda,
            id_distrito         = @id_distrito,
            dest_nombre         = @dest_nombre,
            dest_telefono       = @dest_tel,
            dest_telefono_2     = @dest_tel2,
            dest_direccion      = @dest_dir,
            delivery_base       = @delivery,
            monto_adicional     = @adicional,
            monto_cobrado       = @cobrado,
            monto_producto      = @producto,
            pago_moto_base      = @pago_moto,
            pago_moto_adicional = @pago_moto_ad,
            pago_velox          = @pago_velox,
            pago_velox_metodo   = @pago_velox_metodo,
            observaciones       = @obs,
            actualizado_en      = GETDATE()
        WHERE id = @id${whereVersion}
      `);
    if (ifVersion && result.rowsAffected[0] === 0) {
      const fresca = await conflictoDeVersion(pool, req.params.id);
      if (!fresca) return res.status(404).json({ error: 'Orden no encontrada' });
      return res.status(409).json({ error: 'Esta orden fue modificada por otro usuario mientras la editabas.', orden: fresca });
    }

    /* Si era una orden de ráfaga y con esto quedaron completos los
       datos, deja de estar pendiente (también desde "Actualizar orden") */
    await recalcularDatosPendientes(pool, req.params.id);

    res.json({ ok: true, version: await versionActualHex(pool, req.params.id) });
  } catch (err) {
    console.error('PATCH /ordenes/:id/completo:', err.message);
    res.status(500).json({ error: 'Error al actualizar la orden' });
  }
});

/* ────────────────────────────────────────────────────────────
   FECHA DE REPARTO (ver velox_agregar_fecha_reparto.sql)
   El día que manda para la lista, el motorizado y la Caja es
   fecha_reparto = fecha_asignacion o, sin asignar, la de creación.
──────────────────────────────────────────────────────────── */
const DIAS_REPARTO_ADELANTE = 7; /* hasta cuántos días después de hoy se puede asignar */

function sumarDias(yyyymmdd, dias) {
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/* 'YYYY-MM-DD' → 'DD/MM/YYYY' para los mensajes */
const fechaDMY = f => f.split('-').reverse().join('/');

/* Si la orden suma plata en la Caja, cambiarla de día o de
   motorizado cambiaría el monto de un día que ya se marcó pagado.
   Mismas condiciones que las consultas de routes/caja.js:
   · Caja de tiendas: entregado / ausente, o cancelado pre-pagado
   · Caja de motorizados: entregado / ausente
   antes / despues = { id_tienda, id_motorizado, fecha_reparto }.
   Devuelve el mensaje de error, o null si se puede. */
async function bloqueoPorDiaPagado(pool, orden, antes, despues) {
  const cambiaDia  = antes.fecha_reparto !== despues.fecha_reparto;
  const cambiaMoto = (antes.id_motorizado || null) !== (despues.id_motorizado || null);
  if (!cambiaDia && !cambiaMoto) return null;

  if (sumaEnCajaTienda(orden.estado, orden.pago_velox) && cambiaDia) {
    for (const dia of [antes.fecha_reparto, despues.fecha_reparto]) {
      const tienda = await tiendaConDiaPagado(pool, orden.id_tienda, dia);
      if (tienda) {
        return `El ${fechaDMY(dia)} ya está marcado como pagado en la Caja de la tienda ${tienda}: ` +
               'mover esta orden cambiaría el monto que ya se pagó.';
      }
    }
  }
  if (sumaEnCajaMoto(orden.estado)) {
    const pares = [];
    if (antes.id_motorizado)   pares.push([antes.id_motorizado, antes.fecha_reparto]);
    if (despues.id_motorizado) pares.push([despues.id_motorizado, despues.fecha_reparto]);
    for (const [moto, dia] of pares) {
      const motorizado = await motoConDiaPagado(pool, moto, dia);
      if (motorizado) {
        return `El ${fechaDMY(dia)} ya está marcado como pagado en la Caja del motorizado ${motorizado}: ` +
               'mover esta orden cambiaría el monto que ya se pagó.';
      }
    }
  }
  return null;
}

/* Qué estados suman en cada Caja (mismas condiciones que routes/caja.js) */
function sumaEnCajaTienda(estado, pagoVelox) {
  return ['entregado', 'ausente'].includes(estado) || (estado === 'cancelado' && pagoVelox === 'PAGADO');
}
function sumaEnCajaMoto(estado) {
  return ['entregado', 'ausente'].includes(estado);
}

/* Nombre de la tienda / del motorizado si ese día ya está marcado
   pagado en su Caja, o null */
async function tiendaConDiaPagado(pool, idTienda, dia) {
  const r = await pool.request()
    .input('tienda', sql.Int, idTienda)
    .input('dia', sql.Date, dia)
    .query(`
      SELECT t.nombre FROM caja_pagos_tiendas cp JOIN tiendas t ON t.id = cp.id_tienda
      WHERE cp.id_tienda = @tienda AND cp.fecha_ciclo = @dia AND cp.pagado = 1
    `);
  return r.recordset[0] ? r.recordset[0].nombre : null;
}
async function motoConDiaPagado(pool, idMoto, dia) {
  const r = await pool.request()
    .input('moto', sql.Int, idMoto)
    .input('dia', sql.Date, dia)
    .query(`
      SELECT m.nombre FROM caja_pagos_motorizados cm JOIN motorizados m ON m.id = cm.id_motorizado
      WHERE cm.id_motorizado = @moto AND cm.fecha_dia = @dia AND cm.pagado = 1
    `);
  return r.recordset[0] ? r.recordset[0].nombre : null;
}

/* Resolver la orden (en-proceso → entregado, ausente...) cambia lo que
   suma en la Caja de su día sin moverla de día: si ese día ya está
   pagado para su tienda o su motorizado, no se puede. orden = {
   id_tienda, id_motorizado, fecha_reparto, pago_velox }. Devuelve el
   mensaje de error, o null. */
async function bloqueoPorResolverEnDiaPagado(pool, orden, estadoNuevo) {
  if (sumaEnCajaTienda(estadoNuevo, orden.pago_velox)) {
    const tienda = await tiendaConDiaPagado(pool, orden.id_tienda, orden.fecha_reparto);
    if (tienda) {
      return `El ${fechaDMY(orden.fecha_reparto)} ya está marcado como pagado en la Caja de la tienda ${tienda}: ` +
             'avisa en la oficina para cerrar esta orden.';
    }
  }
  if (sumaEnCajaMoto(estadoNuevo) && orden.id_motorizado) {
    const motorizado = await motoConDiaPagado(pool, orden.id_motorizado, orden.fecha_reparto);
    if (motorizado) {
      return `El ${fechaDMY(orden.fecha_reparto)} ya está marcado como pagado en la Caja del motorizado ${motorizado}: ` +
             'avisa en la oficina para cerrar esta orden.';
    }
  }
  return null;
}

/* ── PATCH /api/ordenes/:id/asignar ──────────────────────────
   Gestores: pueden asignar cualquier orden a cualquier motorizado,
   o desasignarla (motorizado vacío), y elegir el día de reparto
   (fechaReparto, opcional).
   Motorizado: solo puede autoasignarse una orden que esté libre —
   el servidor ignora cualquier nombre que mande el cliente y usa
   el de su propia sesión. No puede desasignar ni tocar una orden
   que ya tenga motorizado (ni la de otro, ni la suya). */
router.patch('/:id/asignar', async (req, res) => {
  try {
    const pool = await getPool();
    const esGestor     = GESTORES.includes(req.usuario.rol);
    const esMotorizado = req.usuario.rol === 'motorizado';

    if (!esGestor && !esMotorizado) {
      return res.status(403).json({ error: 'No tenés permiso para asignar órdenes' });
    }

    let id_motorizado;
    let motoInactivo = false;

    if (esMotorizado) {
      if (!req.usuario.id_motorizado) {
        return res.status(403).json({ error: 'Tu usuario no está vinculado a un motorizado' });
      }
      if (!req.body.motorizado) {
        return res.status(403).json({ error: 'No podés desasignar una orden' });
      }

      const actual = await pool.request()
        .input('id', sql.BigInt, req.params.id)
        .query(`SELECT id_motorizado FROM ordenes WHERE id = @id`);
      if (!actual.recordset[0]) return res.status(404).json({ error: 'Orden no encontrada' });
      if (actual.recordset[0].id_motorizado) {
        return res.status(403).json({ error: 'Esta orden ya tiene un motorizado asignado' });
      }

      id_motorizado = req.usuario.id_motorizado; /* se autoasigna, no puede elegir a otro */
      const yo = await pool.request()
        .input('idm', sql.Int, id_motorizado)
        .query(`SELECT activo FROM motorizados WHERE id = @idm`);
      motoInactivo = !yo.recordset[0] || !yo.recordset[0].activo;
    } else {
      const { motorizado } = req.body;
      id_motorizado = null;
      if (motorizado) {
        /* Antes un nombre desconocido desasignaba la orden sin avisar */
        const moto = await motorizadoPorNombre(pool, motorizado);
        if (!moto) return res.status(400).json({ error: `Motorizado no encontrado: ${motorizado}` });
        id_motorizado = moto.id;
        motoInactivo = !moto.activo;
      }
    }

    const actualRes = await pool.request()
      .input('id', sql.BigInt, req.params.id)
      .query(`
        SELECT id_tienda, id_motorizado, estado, pago_velox, datos_pendientes,
               CONVERT(varchar, fecha, 23)            AS fecha,
               CONVERT(varchar, fecha_asignacion, 23) AS fecha_asignacion,
               CONVERT(varchar, fecha_reparto, 23)    AS fecha_reparto
        FROM ordenes WHERE id = @id
      `);
    const actual = actualRes.recordset[0];
    if (!actual) return res.status(404).json({ error: 'Orden no encontrada' });

    /* A un motorizado inactivo no se le asignan órdenes. Si la orden ya
       era suya (ej. solo se cambia la fecha), se deja pasar */
    if (motoInactivo && id_motorizado !== actual.id_motorizado) {
      return res.status(400).json({ error: 'Ese motorizado está inactivo: no se le pueden asignar órdenes.' });
    }

    /* Una orden de ráfaga con datos pendientes no se puede asignar:
       todavía no se sabe de qué tienda es ni a quién se entrega */
    if (id_motorizado && actual.datos_pendientes) {
      return res.status(400).json({ error: 'Esta orden todavía tiene datos por completar (ver "Pendiente").' });
    }

    /* fecha_asignacion = día de reparto (lo que manda para la lista,
       el motorizado y la Caja; ordenes.fecha, la de creación, no se toca):
       · Desasignar → NULL (vuelve a verse en su día de creación).
       · Gestor que manda fechaReparto → ese día, entre el de creación
         y hoy + DIAS_REPARTO_ADELANTE.
       · Si no → se conserva la que tenía; si no tenía, hoy (Lima). El
         motorizado que se autoasigna siempre cae acá (la orden está
         libre, sin fecha): hoy.
       Pasarla de un motorizado a otro ya no la mueve de día: para
       reprogramarla se elige la fecha. */
    const hoy = hoyEnLima();
    let fechaAsignacion = null;
    if (id_motorizado) {
      const pedida = esGestor && typeof req.body.fechaReparto === 'string' ? req.body.fechaReparto.trim() : '';
      if (pedida) {
        const limite = sumarDias(hoy, DIAS_REPARTO_ADELANTE);
        if (!REGEX_FECHA.test(pedida) || Number.isNaN(Date.parse(pedida))) {
          return res.status(400).json({ error: 'La fecha de reparto no es válida.' });
        }
        if (pedida < actual.fecha || pedida > limite) {
          return res.status(400).json({
            error: `La fecha de reparto tiene que estar entre el ${fechaDMY(actual.fecha)} (creación de la orden) y el ${fechaDMY(limite)}.`
          });
        }
        fechaAsignacion = pedida;
      } else {
        fechaAsignacion = actual.fecha_asignacion || hoy;
      }
    }

    const bloqueo = await bloqueoPorDiaPagado(pool, actual,
      { id_motorizado: actual.id_motorizado, fecha_reparto: actual.fecha_reparto },
      { id_motorizado, fecha_reparto: fechaAsignacion || actual.fecha });
    if (bloqueo) return res.status(400).json({ error: bloqueo, diaPagado: true });

    const ifVersion = bufferDeVersion(req.body.ifVersion);
    const request = pool.request()
      .input('id',    sql.BigInt, req.params.id)
      .input('moto',  sql.Int,    id_motorizado)
      .input('fasig', sql.Date,   fechaAsignacion);
    let whereVersion = '';
    if (ifVersion) { request.input('ifVersion', sql.VarBinary(8), ifVersion); whereVersion = ' AND row_version = @ifVersion'; }

    const result = await request.query(`
      UPDATE ordenes
      SET fecha_asignacion = @fasig,
          id_motorizado    = @moto
      WHERE id = @id${whereVersion}
    `);
    if (ifVersion && result.rowsAffected[0] === 0) {
      const fresca = await conflictoDeVersion(pool, req.params.id);
      if (!fresca) return res.status(404).json({ error: 'Orden no encontrada' });
      return res.status(409).json({ error: 'Esta orden fue modificada por otro usuario mientras la editabas.', orden: fresca });
    }

    res.json({ ok: true, version: await versionActualHex(pool, req.params.id) });
  } catch (err) {
    console.error('PATCH /ordenes/:id/asignar:', err.message);
    res.status(500).json({ error: 'Error al asignar la orden' });
  }
});

/* ── PATCH /api/ordenes/:id/devolver — solo gestores ─────────
   El motorizado devolvió el producto a la oficina.
   · Reprogramado / No entregado (no se cobró el viaje)
     → la misma orden vuelve a "en-proceso" para salir de nuevo.
   · Ausente (sí se cobró el viaje a la tienda) → la original se deja
     tal cual (conserva el cobro) y se crea una copia nueva, sin
     motorizado, con fecha de hoy, para reintentar la entrega.
   · Cancelado, o cualquier condición especial (Cambio / Recojo /
     Escoge talla) → el producto no vuelve a salir a reparto, queda
     "en almacén" pendiente de devolver a la tienda (ver
     PATCH /:id/devolver-tienda y la página "Devolución Tienda").
──────────────────────────────────────────────────────────── */
const ESTADOS_VUELVE_A_PROCESO = ['reprogramado', 'no-entregado'];
const ESTADOS_UNA_SOLA_VEZ     = ['ausente', 'cancelado']; /* no cambian de estado al confirmar */

router.patch('/:id/devolver', requireRol(...GESTORES), async (req, res) => {
  try {
    const pool = await getPool();
    const ordenId = req.params.id;

    const r = await pool.request()
      .input('id', sql.BigInt, ordenId)
      .query(`SELECT * FROM ordenes WHERE id = @id`);
    const orden = r.recordset[0];
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });

    /* Ausente/Cancelado/condición especial no cambian de estado al
       confirmar, así que no se autolimitan como Reprogramado/No entregado
       — se bloquean a mano para no procesar la misma orden dos veces */
    const califica =
      ESTADOS_VUELVE_A_PROCESO.includes(orden.estado) ||
      (ESTADOS_UNA_SOLA_VEZ.includes(orden.estado) && !orden.devuelto) ||
      (CONDICIONES_ESPECIALES.includes(orden.condicion_especial) && !orden.devuelto);

    if (!califica) {
      return res.status(400).json({
        error: 'Esta orden no está en un estado que permita marcarla como devuelta.'
      });
    }

    if (orden.estado === 'cancelado' || CONDICIONES_ESPECIALES.includes(orden.condicion_especial)) {
      /* No vuelve a salir a reparto: queda en almacén pendiente de
         devolver a la tienda, no se toca el estado ni se duplica */
      await pool.request()
        .input('id', sql.BigInt, ordenId)
        .query(`UPDATE ordenes SET devuelto = devuelto + 1 WHERE id = @id`);

      return res.json({ ok: true, duplicada: false, almacen: true });
    }

    if (orden.estado === 'ausente') {
      /* Se cobró el viaje: la original se queda tal cual (con su cobro), se crea una copia */
      await pool.request()
        .input('id', sql.BigInt, ordenId)
        .query(`UPDATE ordenes SET devuelto = devuelto + 1 WHERE id = @id`);

      const codRes = await pool.request().query(`
        SELECT ISNULL(MAX(CAST(SUBSTRING(codigo,3,LEN(codigo)) AS INT)),1000) + 1 AS siguiente
        FROM ordenes WHERE codigo LIKE 'C-%'
      `);
      const nuevoCodigo = `C-${codRes.recordset[0].siguiente}`;

      const insertRes = await pool.request()
        .input('codigo',       sql.NVarChar,      nuevoCodigo)
        .input('id_tienda',    sql.Int,           orden.id_tienda)
        .input('id_origen',    sql.Int,           orden.id_origen)
        .input('id_distrito',  sql.Int,           orden.id_distrito)
        .input('dest_nombre',  sql.NVarChar,      orden.dest_nombre)
        .input('dest_tel',     sql.NVarChar,      orden.dest_telefono)
        .input('dest_tel2',    sql.NVarChar,      orden.dest_telefono_2)
        .input('dest_dir',     sql.NVarChar,      orden.dest_direccion)
        .input('metodo',       sql.NVarChar,      orden.metodo_pago)
        /* El pre-pago (si lo había) se consumió en el intento que quedó
           Ausente — la copia que sale de nuevo a reparto siempre nace
           en Post pago (PENDIENTE), nunca hereda el PAGADO original */
        .input('pago_velox',   sql.NVarChar,      'PENDIENTE')
        .input('delivery',     sql.Decimal(10,2), orden.delivery_base)
        .input('pago_moto',    sql.Decimal(10,2), orden.pago_moto_base)
        .input('especial',     sql.Bit,           orden.producto_especial)
        .input('obs',          sql.NVarChar,      orden.observaciones)
        .input('reprog_de',    sql.BigInt,        orden.id)
        /* Hoy en Lima: GETDATE() del servidor (UTC) daba el día
           siguiente después de las 19:00 */
        .input('hoy',          sql.Date,          hoyEnLima())
        .query(`
          INSERT INTO ordenes (
            codigo, fecha, id_tienda, id_origen, id_distrito, id_motorizado,
            dest_nombre, dest_telefono, dest_telefono_2, dest_direccion,
            estado, metodo_pago, pago_velox,
            delivery_base, pago_moto_base,
            producto_especial, observaciones, reprogramado_de
          ) VALUES (
            @codigo, @hoy, @id_tienda, @id_origen, @id_distrito, NULL,
            @dest_nombre, @dest_tel, @dest_tel2, @dest_dir,
            'en-proceso', @metodo, @pago_velox,
            @delivery, @pago_moto,
            @especial, @obs, @reprog_de
          );
          SELECT SCOPE_IDENTITY() AS id;
        `);

      return res.json({ ok: true, duplicada: true, nuevoId: insertRes.recordset[0].id, nuevoCodigo });
    }

    /* Reprogramado / No entregado: no se devuelve a la tienda, se
       reintenta otro día. La misma orden vuelve a en-proceso y SIN
       motorizado, así queda libre en Asignación. fecha_asignacion se
       vacía con el motorizado (como al desasignar): al reasignarla,
       /asignar le pone el día de la nueva asignación y el motorizado
       nuevo (o el mismo) la ve ese día. ordenes.fecha no cambia (Caja). */
    await pool.request()
      .input('id', sql.BigInt, ordenId)
      .query(`
        UPDATE ordenes
        SET devuelto = devuelto + 1,
            estado = 'en-proceso',
            id_motorizado = NULL,
            fecha_asignacion = NULL
        WHERE id = @id
      `);

    res.json({ ok: true, duplicada: false, aAsignacion: true });
  } catch (err) {
    console.error('PATCH /ordenes/:id/devolver:', err.message);
    res.status(500).json({ error: 'Error al procesar la devolución' });
  }
});

/* ── PATCH /api/ordenes/:id/devolver-tienda — solo gestores ──
   Cierra el ciclo de Cancelado/condición especial: el producto que
   estaba "en almacén" ya se le devolvió físicamente a la tienda. */
router.patch('/:id/devolver-tienda', requireRol(...GESTORES), async (req, res) => {
  try {
    const pool = await getPool();
    const ordenId = req.params.id;

    const r = await pool.request()
      .input('id', sql.BigInt, ordenId)
      .query(`SELECT estado, condicion_especial, devuelto, devuelto_tienda FROM ordenes WHERE id = @id`);
    const orden = r.recordset[0];
    if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });

    const enAlmacen =
      (orden.estado === 'cancelado' || CONDICIONES_ESPECIALES.includes(orden.condicion_especial)) &&
      orden.devuelto && !orden.devuelto_tienda;

    if (!enAlmacen) {
      return res.status(400).json({ error: 'Esta orden no está pendiente de devolver a la tienda.' });
    }

    await pool.request()
      .input('id', sql.BigInt, ordenId)
      .query(`UPDATE ordenes SET devuelto_tienda = 1 WHERE id = @id`);

    res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /ordenes/:id/devolver-tienda:', err.message);
    res.status(500).json({ error: 'Error al procesar la devolución a la tienda' });
  }
});

/* ── POST /api/ordenes/:id/evidencia/presigned ────────────────
   Gestores, o el motorizado dueño de la orden. Devuelve una URL
   firmada para que el celular suba la foto DIRECTO a Cloudflare
   R2 (el servidor nunca recibe el archivo — ver server/r2.js). */
router.post('/:id/evidencia/presigned', async (req, res) => {
  try {
    const pool = await getPool();
    if (!(await puedeTocarOrden(req.usuario, req.params.id, pool))) {
      return res.status(403).json({ error: 'No puedes subir evidencia para esta orden' });
    }

    if (!r2Habilitado()) {
      return res.status(503).json({
        error: 'El módulo de evidencia fotográfica todavía no está configurado. Contacta al administrador.'
      });
    }

    const { contentType, tipo } = req.body;
    const idSubida = leerIdSubida(req.body.idSubida);
    if (idSubida === false) return res.status(400).json({ error: 'Identificador de subida no válido' });
    if (tipo !== undefined && !TIPOS_FOTO.includes(tipo)) {
      return res.status(400).json({ error: 'Tipo de foto no válido' });
    }

    /* Un reintento de una foto que ya quedó registrada no se frena
       por el tope: la cola la va a dar por subida al registrarla */
    if (!(await buscarPorIdSubida(pool, idSubida))) {
      const rechazo = await rechazoPorTipoFoto(pool, req.usuario, req.params.id, tipo);
      if (rechazo) return res.status(rechazo.status).json({ error: rechazo.error });
    }

    const carpeta = CARPETA_POR_TIPO[tipo] || 'evidencias';
    const { uploadUrl, publicUrl } = await generarUrlSubidaEvidencia(req.params.id, contentType, carpeta, idSubida);

    res.json({ uploadUrl, publicUrl });
  } catch (err) {
    console.error('POST /ordenes/:id/evidencia/presigned:', err.message);
    res.status(400).json({ error: err.message || 'Error al generar la URL de subida' });
  }
});

/* ── PATCH /api/ordenes/:id/medio-pago ─────────────────────────
   Gestores, o el motorizado dueño de la orden.
   "pago-tienda" y "pago-empresa" (en pantalla: "Pago Velox")
   requieren evidencia, pero ya NO se exige en este momento: el
   motorizado puede guardar sin señal y la foto entra después por
   la cola del celular (POST /:id/foto/...). Mientras no llegue, la
   orden figura con evidencia_pendiente = 1 (ver SELECT_ORDEN).
   evidenciaUrl se sigue aceptando por compatibilidad. */
router.patch('/:id/medio-pago', async (req, res) => {
  try {
    const pool = await getPool();
    if (!(await puedeTocarOrden(req.usuario, req.params.id, pool))) {
      return res.status(403).json({ error: 'No puedes modificar esta orden' });
    }

    const { medioPago, evidenciaUrl } = req.body;
    const ordenId = req.params.id;

    if (medioPago && !MEDIOS_PAGO.includes(medioPago)) {
      return res.status(400).json({ error: 'Medio de pago no válido' });
    }

    /* La URL tiene que ser de nuestro bucket y de esta orden */
    if (evidenciaUrl && !esUrlDeOrden(evidenciaUrl, ordenId)) {
      return res.status(400).json({ error: 'URL de evidencia no válida' });
    }

    const ifVersion = bufferDeVersion(req.body.ifVersion);
    const request = pool.request()
      .input('id',    sql.BigInt,   ordenId)
      .input('medio', sql.NVarChar, medioPago || null);
    let whereVersion = '';
    if (ifVersion) { request.input('ifVersion', sql.VarBinary(8), ifVersion); whereVersion = ' AND row_version = @ifVersion'; }

    const result = await request.query(`UPDATE ordenes SET medio_pago = @medio WHERE id = @id${whereVersion}`);
    if (ifVersion && result.rowsAffected[0] === 0) {
      const fresca = await conflictoDeVersion(pool, ordenId);
      if (!fresca) return res.status(404).json({ error: 'Orden no encontrada' });
      return res.status(409).json({ error: 'Esta orden fue modificada por otro usuario mientras la editabas.', orden: fresca });
    }

    if (evidenciaUrl) {
      await pool.request()
        .input('id_orden', sql.BigInt,   ordenId)
        .input('url',      sql.NVarChar, evidenciaUrl)
        .query(`INSERT INTO ordenes_fotos (id_orden, tipo, url) VALUES (@id_orden, 'evidencia_medio_pago', @url)`);
    }

    res.json({ ok: true, version: await versionActualHex(pool, ordenId) });
  } catch (err) {
    console.error('PATCH /ordenes/:id/medio-pago:', err.message);
    res.status(500).json({ error: 'Error al guardar el medio de pago' });
  }
});

/* ════════════════════════════════════════════════════════════
   FOTOS DE LA ORDEN (foto del producto, evidencia del medio de pago
   y fotos de devolución)
   Todas las clases de foto usan estas rutas; se distinguen por "tipo"
   ('foto_producto' por defecto, ver TIPOS_FOTO).
   Dos caminos, según si R2 está configurado:
   · R2 activo → el navegador pide una URL firmada (la ruta
     /evidencia/presigned de arriba), sube la foto DIRECTO a R2 y
     después registra la URL con POST /:id/foto/registrar. El
     servidor nunca toca el archivo (ver DECISIONES.md D-003).
   · R2 sin configurar (MODO PRUEBA) → el navegador manda los bytes
     a POST /:id/foto/local, que los guarda en disco y los sirve por
     GET /:id/foto/:fotoId, siempre validando sesión.

   Reintentos sin duplicar: la cola del celular manda un idSubida
   (UUID) por foto. Si llega una foto con un idSubida que ya está
   registrado, se responde 200 con la foto existente en vez de
   insertar otra (la primera vez es 201).
════════════════════════════════════════════════════════════ */

/* Lee y valida tipo + idSubida; si algo vino mal responde 400 y
   devuelve null */
function leerDatosFoto(req, res, origen) {
  const tipo = origen.tipo || TIPO_FOTO_PRODUCTO;
  if (!TIPOS_FOTO.includes(tipo)) {
    res.status(400).json({ error: 'Tipo de foto no válido' });
    return null;
  }
  const idSubida = leerIdSubida(origen.idSubida);
  if (idSubida === false) {
    res.status(400).json({ error: 'Identificador de subida no válido' });
    return null;
  }
  return { tipo, idSubida };
}

/* puedeTocarOrden deja pasar a los gestores sin mirar si la orden
   existe; sin esto, una foto de una orden borrada fallaba con 500 (por
   la FK) y la cola del celular la reintentaba para siempre */
async function ordenExiste(pool, ordenId) {
  const r = await pool.request()
    .input('id', sql.BigInt, ordenId)
    .query('SELECT TOP 1 1 AS x FROM ordenes WHERE id = @id');
  return r.recordset.length > 0;
}

/* Foto ya registrada con este idSubida (o null) */
async function buscarPorIdSubida(pool, idSubida) {
  if (!idSubida) return null;
  const r = await pool.request()
    .input('id_subida', sql.UniqueIdentifier, idSubida)
    .query('SELECT id, CAST(id_orden AS INT) AS id_orden, tipo, url FROM ordenes_fotos WHERE id_subida = @id_subida');
  return r.recordset[0] || null;
}

/* Un idSubida repetido solo vale si es la misma foto: misma orden y
   mismo tipo. Si no, es un error del cliente, no un reintento. */
function esMismaFoto(existente, ordenId, tipo) {
  return existente.id_orden === parseInt(ordenId, 10) && existente.tipo === tipo;
}

/* Reglas propias de algunos tipos de foto (además de puedeTocarOrden):
   · Devolución: solo las suben los gestores, y la de vuelta a la
     oficina tiene un tope de MAX_FOTOS_DEVOLUCION por orden.
   · Las del motorizado (entrega, cambio, intentos): tope de seguridad
     de MAX_FOTOS_MOTORIZADO_POR_TIPO por tipo y por orden.
   Devuelve { status, error } si la foto no va, o null. Se llama
   después de reconocer los reintentos (idSubida ya registrado), así
   un reintento de la última foto permitida no rebota contra el tope. */
async function rechazoPorTipoFoto(pool, usuario, ordenId, tipo) {
  let tope = null;
  let mensaje = '';
  if (TIPOS_FOTO_DEVOLUCION.includes(tipo)) {
    if (!GESTORES.includes(usuario.rol)) {
      return { status: 403, error: 'Solo un administrador u operador puede subir fotos de devolución' };
    }
    if (tipo !== TIPO_FOTO_DEVOLUCION) return null;
    tope = MAX_FOTOS_DEVOLUCION;
    mensaje = `Esta orden ya tiene ${MAX_FOTOS_DEVOLUCION} fotos de devolución`;
  } else if (TIPOS_FOTO_MOTORIZADO.includes(tipo)) {
    tope = MAX_FOTOS_MOTORIZADO_POR_TIPO;
    mensaje = `Esta orden ya tiene ${MAX_FOTOS_MOTORIZADO_POR_TIPO} fotos de este tipo`;
  } else {
    return null;
  }

  const r = await pool.request()
    .input('id',   sql.BigInt,   ordenId)
    .input('tipo', sql.NVarChar, tipo)
    .query(`SELECT COUNT(*) AS total FROM ordenes_fotos WHERE id_orden = @id AND tipo = @tipo`);
  if (r.recordset[0].total >= tope) return { status: 409, error: mensaje };
  return null;
}

/* Inserta la fila en ordenes_fotos y devuelve su id. Si otro
   reintento con el mismo idSubida ganó la carrera (índice único),
   devuelve el id de esa fila en vez de fallar. */
async function registrarFoto(pool, ordenId, tipo, url, idSubida) {
  try {
    const r = await pool.request()
      .input('id_orden',  sql.BigInt,           ordenId)
      .input('tipo',      sql.NVarChar,         tipo)
      .input('url',       sql.NVarChar,         url)
      .input('id_subida', sql.UniqueIdentifier, idSubida || null)
      .query(`INSERT INTO ordenes_fotos (id_orden, tipo, url, id_subida) VALUES (@id_orden, @tipo, @url, @id_subida);
              SELECT CAST(SCOPE_IDENTITY() AS INT) AS id;`);
    return { fotoId: r.recordset[0].id, nueva: true };
  } catch (err) {
    /* 2601 / 2627 = clave duplicada */
    if (idSubida && (err.number === 2601 || err.number === 2627)) {
      const existente = await buscarPorIdSubida(pool, idSubida);
      if (existente) return { fotoId: existente.id, nueva: false, existente };
    }
    throw err;
  }
}

/* ── POST /api/ordenes/:id/foto/registrar — URL ya subida a R2 ──
   Body: { url, tipo?, idSubida? } */
router.post('/:id/foto/registrar', async (req, res) => {
  try {
    const pool = await getPool();
    if (!(await puedeTocarOrden(req.usuario, req.params.id, pool))) {
      return res.status(403).json({ error: 'No puedes agregar fotos a esta orden' });
    }

    if (!(await ordenExiste(pool, req.params.id))) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    const datos = leerDatosFoto(req, res, req.body);
    if (!datos) return;

    const { url } = req.body;
    if (!url || typeof url !== 'string' || url.length > 500 || !esUrlDeOrden(url, req.params.id)) {
      return res.status(400).json({ error: 'URL de foto no válida' });
    }

    const previa = await buscarPorIdSubida(pool, datos.idSubida);
    if (previa) {
      if (!esMismaFoto(previa, req.params.id, datos.tipo)) {
        return res.status(409).json({ error: 'Ese identificador de subida ya se usó para otra foto' });
      }
      return res.json({ ok: true, fotoId: previa.id, url: previa.url, repetida: true });
    }

    const rechazo = await rechazoPorTipoFoto(pool, req.usuario, req.params.id, datos.tipo);
    if (rechazo) return res.status(rechazo.status).json({ error: rechazo.error });

    const reg = await registrarFoto(pool, req.params.id, datos.tipo, url, datos.idSubida);
    if (!reg.nueva) {
      if (!esMismaFoto(reg.existente, req.params.id, datos.tipo)) {
        return res.status(409).json({ error: 'Ese identificador de subida ya se usó para otra foto' });
      }
      return res.json({ ok: true, fotoId: reg.fotoId, url: reg.existente.url, repetida: true });
    }
    res.status(201).json({ ok: true, fotoId: reg.fotoId, url });
  } catch (err) {
    console.error('POST /ordenes/:id/foto/registrar:', err.message);
    res.status(500).json({ error: 'Error al registrar la foto' });
  }
});

/* ── POST /api/ordenes/:id/foto/local — MODO PRUEBA ────────────
   Recibe el JPEG crudo (el navegador ya lo comprimió); tipo e
   idSubida van en la query (?tipo=...&idSubida=...) porque el body
   son los bytes. Solo aplica mientras R2 no esté configurado; si R2
   ya está activo se rechaza, para no terminar con fotos partidas
   entre los dos almacenamientos. */
router.post('/:id/foto/local',
  express.raw({ type: 'image/jpeg', limit: '6mb' }),
  async (req, res) => {
    try {
      const pool = await getPool();
      if (!(await puedeTocarOrden(req.usuario, req.params.id, pool))) {
        return res.status(403).json({ error: 'No puedes agregar fotos a esta orden' });
      }
      if (r2Habilitado()) {
        return res.status(409).json({ error: 'R2 ya está configurado: la foto debe subirse a R2, no al disco local.' });
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'No llegó ninguna imagen (se espera un JPEG).' });
      }

      if (!(await ordenExiste(pool, req.params.id))) {
        return res.status(404).json({ error: 'Orden no encontrada' });
      }

      const datos = leerDatosFoto(req, res, req.query);
      if (!datos) return;

      const ordenId = req.params.id;
      const urlLocal = (fotoId) => `/api/ordenes/${parseInt(ordenId, 10)}/foto/${fotoId}`;

      /* Reintento de una foto que ya llegó: si el archivo está en
         disco no se toca nada; si la fila quedó pero el archivo no
         (se cortó a mitad de camino), se completa con estos bytes */
      let reg;
      const previa = await buscarPorIdSubida(pool, datos.idSubida);
      if (previa) {
        reg = { fotoId: previa.id, nueva: false, existente: previa };
      } else {
        const rechazo = await rechazoPorTipoFoto(pool, req.usuario, ordenId, datos.tipo);
        if (rechazo) return res.status(rechazo.status).json({ error: rechazo.error });

        /* Se inserta primero para tener el id, que forma parte del
           nombre del archivo en disco — así la ruta que lo sirve lo
           reconstruye sola, sin guardar el nombre en otra columna */
        reg = await registrarFoto(pool, ordenId, datos.tipo, '', datos.idSubida);
      }

      if (!reg.nueva) {
        if (!esMismaFoto(reg.existente, ordenId, datos.tipo)) {
          return res.status(409).json({ error: 'Ese identificador de subida ya se usó para otra foto' });
        }
        if (existeFoto(ordenId, reg.fotoId) && reg.existente.url) {
          return res.json({ ok: true, fotoId: reg.fotoId, url: reg.existente.url, modo: 'local', repetida: true });
        }
      }

      try {
        await guardarFoto(ordenId, reg.fotoId, req.body);
      } catch (errDisco) {
        /* Sin archivo no hay foto: la fila nueva se borra para no
           dejar una foto "fantasma" con la URL vacía */
        if (reg.nueva) {
          await pool.request()
            .input('id', sql.Int, reg.fotoId)
            .query('DELETE FROM ordenes_fotos WHERE id = @id');
        }
        throw errDisco;
      }

      await pool.request()
        .input('id',  sql.Int,      reg.fotoId)
        .input('url', sql.NVarChar, urlLocal(reg.fotoId))
        .query('UPDATE ordenes_fotos SET url = @url WHERE id = @id');

      res.status(reg.nueva ? 201 : 200).json({ ok: true, fotoId: reg.fotoId, url: urlLocal(reg.fotoId), modo: 'local' });
    } catch (err) {
      console.error('POST /ordenes/:id/foto/local:', err.message);
      res.status(500).json({ error: 'Error al guardar la foto' });
    }
  }
);

/* Permiso para VER una foto (distinto de puedeTocarOrden, que es
   para modificar la orden):
   · admin / operador → todas
   · motorizado       → las de sus órdenes (igual que puedeTocarOrden)
   · tienda           → solo la foto del producto, y solo de órdenes
                        de SU tienda. La tienda sale de la sesión y la
                        de la orden, de la BD: nada viene del cliente.
   · visor            → ninguna
   Las fotos de devolución, solo los gestores. */
async function puedeVerFotoOrden(usuario, ordenId, tipo, pool) {
  if (TIPOS_FOTO_DEVOLUCION.includes(tipo)) return GESTORES.includes(usuario.rol);
  if (usuario.rol === 'tienda') {
    if (!usuario.id_tienda || tipo !== TIPO_FOTO_PRODUCTO) return false;
    const r = await pool.request()
      .input('id', sql.BigInt, ordenId)
      .query('SELECT id_tienda FROM ordenes WHERE id = @id');
    const fila = r.recordset[0];
    return !!fila && fila.id_tienda === usuario.id_tienda;
  }
  return puedeTocarOrden(usuario, ordenId, pool);
}

/* ── GET /api/ordenes/:id/foto/:fotoId — sirve la foto local ────
   Con sesión: la foto no queda pública como sí lo estaría en R2.
   Quién puede verla: ver puedeVerFotoOrden. */
router.get('/:id/foto/:fotoId', async (req, res) => {
  try {
    const pool = await getPool();

    const ordenId = parseInt(req.params.id, 10);
    const fotoId  = parseInt(req.params.fotoId, 10);
    if (!ordenId || !fotoId) return res.status(400).json({ error: 'Identificador no válido' });

    /* La foto tiene que pertenecer a esta orden; el tipo hace falta
       para decidir el permiso (la tienda solo ve la del producto) */
    const r = await pool.request()
      .input('id',       sql.Int,    fotoId)
      .input('id_orden', sql.BigInt, ordenId)
      .query('SELECT TOP 1 tipo FROM ordenes_fotos WHERE id = @id AND id_orden = @id_orden');
    const foto = r.recordset[0];

    /* Sin permiso se responde 403 antes de decir si la foto existe */
    if (!(await puedeVerFotoOrden(req.usuario, ordenId, foto ? foto.tipo : null, pool))) {
      return res.status(403).json({ error: 'No puedes ver las fotos de esta orden' });
    }
    if (!foto) return res.status(404).json({ error: 'Foto no encontrada' });

    if (!existeFoto(ordenId, fotoId)) {
      return res.status(404).json({ error: 'El archivo de la foto no está en el servidor' });
    }

    res.sendFile(rutaArchivo(ordenId, fotoId));
  } catch (err) {
    console.error('GET /ordenes/:id/foto/:fotoId:', err.message);
    res.status(500).json({ error: 'Error al obtener la foto' });
  }
});

module.exports = router;
