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

   CAMPOS_PENDIENTES dice qué hay que completar para que la orden
   deje de estar pendiente. Para cambiarlos:
   · Sacar un campo → quitarlo de la lista (nada más).
   · Agregar uno nuevo → sumarlo a la lista, a
     CHEQUEOS_DATOS_PENDIENTES y a PATCH /:id/completar-datos.
   La ventana "Pendiente" del frontend arma sus campos con la
   lista que devuelve GET /pendientes-datos.
──────────────────────────────────────────────────────────── */
const TIENDA_SIN_DEFINIR = 'SIN DEFINIR';
const CAMPOS_PENDIENTES = ['tienda', 'destinatario', 'telefono'];

/* f = fila con tienda (nombre), dest_nombre y dest_telefono */
const CHEQUEOS_DATOS_PENDIENTES = {
  tienda:       f => !!f.tienda && f.tienda !== TIENDA_SIN_DEFINIR,
  destinatario: f => !!(f.dest_nombre && f.dest_nombre.trim()),
  telefono:     f => !!(f.dest_telefono && f.dest_telefono.trim()),
};

/* Si la orden está pendiente y ya tiene todos los CAMPOS_PENDIENTES,
   le apaga la marca. Se llama después de cualquier guardado que
   pueda completar datos (la ventana "Pendiente" o "Actualizar
   orden"). Devuelve si la orden sigue pendiente. */
async function recalcularDatosPendientes(pool, ordenId) {
  const r = await pool.request()
    .input('id', sql.BigInt, ordenId)
    .query(`
      SELECT o.datos_pendientes, t.nombre AS tienda, o.dest_nombre, o.dest_telefono
      FROM ordenes o
      JOIN tiendas t ON t.id = o.id_tienda
      WHERE o.id = @id
    `);
  const f = r.recordset[0];
  if (!f || !f.datos_pendientes) return false;

  const completa = CAMPOS_PENDIENTES.every(c => CHEQUEOS_DATOS_PENDIENTES[c](f));
  if (!completa) return true;

  await pool.request()
    .input('id', sql.BigInt, ordenId)
    .query(`UPDATE ordenes SET datos_pendientes = 0 WHERE id = @id`);
  return false;
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
const TIPOS_FOTO = [TIPO_FOTO_PRODUCTO, TIPO_FOTO_EVIDENCIA];

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
    /* Orden de ráfaga a la que todavía le faltan datos ("Por completar") */
    o.datos_pendientes,
    o.delivery_base, o.monto_adicional, o.delivery_total,
    o.monto_cobrado, o.monto_producto,
    o.pago_moto_base, o.pago_moto_adicional, o.pago_moto_total,
    o.producto_especial, o.observaciones, o.reprogramado_de
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

/* ── GET /api/ordenes?fecha=YYYY-MM-DD ───────────────────── */
router.get('/', async (req, res) => {
  try {
    const pool    = await getPool();
    const request = pool.request();
    const fecha   = req.query.fecha;

    let where = 'WHERE 1 = 1';
    if (fecha) {
      request.input('fecha', sql.Date, fecha);
      where += ' AND o.fecha = @fecha';
    }
    where += ' ' + filtroPorRol(req.usuario, request).sql;

    const result = await request.query(
      `${SELECT_ORDEN} ${where} ORDER BY o.fecha DESC, o.id DESC`
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
    res.json({ campos: CAMPOS_PENDIENTES, ordenes: result.recordset });
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
    res.json(result.recordset[0]);
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
          (SELECT id FROM tiendas   WHERE nombre = @tienda)   AS id_tienda,
          (SELECT id FROM origenes  WHERE nombre = @origen)   AS id_origen,
          (SELECT id FROM distritos WHERE nombre = @distrito) AS id_distrito
      `);

    const { id_tienda, id_origen, id_distrito } = lookups.recordset[0];

    if (!id_tienda)   return res.status(400).json({ error: `Tienda no encontrada: ${o.tienda}` });
    /* El comodín es solo para las órdenes de ráfaga (POST /rafaga) */
    if (o.tienda === TIENDA_SIN_DEFINIR) return res.status(400).json({ error: 'Elegí una tienda.' });
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
      const mRes = await pool.request()
        .input('moto', sql.NVarChar, o.motorizado)
        .query(`SELECT id FROM motorizados WHERE nombre = @moto`);
      if (mRes.recordset.length > 0) id_motorizado = mRes.recordset[0].id;
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
   Crea una orden SIN datos para una foto tomada en serie: tienda y
   distrito comodín "SIN DEFINIR", datos_pendientes = 1. La foto
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

    const lookups = await pool.request()
      .input('tienda',   sql.NVarChar, TIENDA_SIN_DEFINIR)
      .input('origen',   sql.NVarChar, 'GAMARRA')
      .input('distrito', sql.NVarChar, DISTRITO_SIN_DEFINIR)
      .query(`
        SELECT
          (SELECT id FROM tiendas   WHERE nombre = @tienda)   AS id_tienda,
          (SELECT id FROM origenes  WHERE nombre = @origen)   AS id_origen,
          (SELECT id FROM distritos WHERE nombre = @distrito) AS id_distrito
      `);
    const { id_tienda, id_origen, id_distrito } = lookups.recordset[0];
    if (!id_tienda)   return res.status(500).json({ error: 'Falta la tienda "SIN DEFINIR" en la base: corré velox_agregar_rafaga.sql.' });
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
   estén en la lista se guardan solo si vienen.
   Si otro usuario ya la completó (o la cambió, con ifVersion)
   responde 409 con la orden fresca. */
router.patch('/:id/completar-datos', requireRol(...GESTORES), async (req, res) => {
  try {
    const pool = await getPool();
    const b    = req.body;
    const obligatorio = c => CAMPOS_PENDIENTES.includes(c);

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
    } else if (obligatorio('tienda')) {
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
      .input('tienda',   sql.NVarChar, o.tienda)
      .input('distrito', sql.NVarChar, o.distrito)
      .query(`
        SELECT
          (SELECT id FROM tiendas   WHERE nombre = @tienda)   AS id_tienda,
          (SELECT id FROM distritos WHERE nombre = @distrito) AS id_distrito
      `);

    const { id_tienda, id_distrito } = lookups.recordset[0];
    if (!id_tienda)   return res.status(400).json({ error: `Tienda no encontrada: ${o.tienda}` });
    if (!id_distrito) return res.status(400).json({ error: `Distrito no encontrado: ${o.distrito}` });

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

/* ── PATCH /api/ordenes/:id/asignar ──────────────────────────
   Gestores: pueden asignar cualquier orden a cualquier motorizado,
   o desasignarla (motorizado vacío).
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
    } else {
      const { motorizado } = req.body;
      id_motorizado = null;
      if (motorizado) {
        const mRes = await pool.request()
          .input('moto', sql.NVarChar, motorizado)
          .query(`SELECT id FROM motorizados WHERE nombre = @moto`);
        if (mRes.recordset.length > 0) id_motorizado = mRes.recordset[0].id;
      }
    }

    /* Una orden de ráfaga con datos pendientes no se puede asignar:
       todavía no se sabe de qué tienda es ni a quién se entrega */
    if (id_motorizado) {
      const p = await pool.request()
        .input('id', sql.BigInt, req.params.id)
        .query(`SELECT datos_pendientes FROM ordenes WHERE id = @id`);
      if (!p.recordset[0]) return res.status(404).json({ error: 'Orden no encontrada' });
      if (p.recordset[0].datos_pendientes) {
        return res.status(400).json({ error: 'Esta orden todavía tiene datos por completar (ver "Pendiente").' });
      }
    }

    const ifVersion = bufferDeVersion(req.body.ifVersion);
    const request = pool.request()
      .input('id',   sql.BigInt, req.params.id)
      .input('moto', sql.Int,    id_motorizado);
    let whereVersion = '';
    if (ifVersion) { request.input('ifVersion', sql.VarBinary(8), ifVersion); whereVersion = ' AND row_version = @ifVersion'; }

    const result = await request.query(`UPDATE ordenes SET id_motorizado = @moto WHERE id = @id${whereVersion}`);
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
        .query(`
          INSERT INTO ordenes (
            codigo, fecha, id_tienda, id_origen, id_distrito, id_motorizado,
            dest_nombre, dest_telefono, dest_telefono_2, dest_direccion,
            estado, metodo_pago, pago_velox,
            delivery_base, pago_moto_base,
            producto_especial, observaciones, reprogramado_de
          ) VALUES (
            @codigo, CAST(GETDATE() AS DATE), @id_tienda, @id_origen, @id_distrito, NULL,
            @dest_nombre, @dest_tel, @dest_tel2, @dest_dir,
            'en-proceso', @metodo, @pago_velox,
            @delivery, @pago_moto,
            @especial, @obs, @reprog_de
          );
          SELECT SCOPE_IDENTITY() AS id;
        `);

      return res.json({ ok: true, duplicada: true, nuevoId: insertRes.recordset[0].id, nuevoCodigo });
    }

    /* Reprogramado / No entregado: misma orden vuelve a en-proceso */
    await pool.request()
      .input('id', sql.BigInt, ordenId)
      .query(`UPDATE ordenes SET devuelto = devuelto + 1, estado = 'en-proceso' WHERE id = @id`);

    res.json({ ok: true, duplicada: false });
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

    const carpeta = tipo === TIPO_FOTO_PRODUCTO ? 'productos' : 'evidencias';
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
   FOTOS DE LA ORDEN (foto del producto y evidencia del medio de pago)
   Las dos clases de foto usan estas rutas; se distinguen por "tipo"
   ('foto_producto' por defecto, o 'evidencia_medio_pago').
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
   · visor            → ninguna */
async function puedeVerFotoOrden(usuario, ordenId, tipo, pool) {
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
