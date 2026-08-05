/* ============================================================
   routes/ordenes.js — Endpoints de órdenes
   Protegido: requiere sesión. El alcance de los datos se decide
   con el rol de la SESIÓN, nunca con parámetros del cliente.
   ============================================================ */

const express = require('express');
const router  = express.Router();
const { getPool, sql } = require('../db');
const { requireAuth, requireRol } = require('../middleware/auth');

/* Todas las rutas de este archivo exigen sesión */
router.use(requireAuth);

/* Roles que pueden modificar datos operativos */
const GESTORES = ['admin', 'operador'];

/* ────────────────────────────────────────────────────────────
   Devuelve el filtro SQL según quién pregunta.
   · admin / operador / visor → ven todo
   · motorizado               → solo sus órdenes
   · tienda                   → solo las de su tienda
   Se aplica en el servidor: el cliente no puede saltárselo.
──────────────────────────────────────────────────────────── */
function filtroPorRol(usuario, request) {
  if (usuario.rol === 'motorizado') {
    if (!usuario.id_motorizado) return { sql: 'AND 1 = 0' }; // sin vínculo: no ve nada
    request.input('scopeMoto', sql.Int, usuario.id_motorizado);
    return { sql: 'AND o.id_motorizado = @scopeMoto' };
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
    o.hora_asignacion,
    t.nombre  AS tienda,
    ori.nombre AS origen,
    d.nombre  AS distrito,
    z.nombre  AS zona,
    m.nombre  AS motorizado,
    o.dest_nombre, o.dest_telefono, o.dest_telefono_2, o.dest_direccion,
    o.estado, o.metodo_pago, o.pago_velox,
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

    const codRes = await pool.request().query(`
      SELECT ISNULL(MAX(CAST(SUBSTRING(codigo,3,LEN(codigo)) AS INT)),1000) + 1 AS siguiente
      FROM ordenes WHERE codigo LIKE 'C-%'
    `);
    const nuevoCodigo = `C-${codRes.recordset[0].siguiente}`;

    const lookups = await pool.request()
      .input('tienda',   sql.NVarChar, o.tienda)
      .input('origen',   sql.NVarChar, o.origen || 'GAMARRA')
      .input('distrito', sql.NVarChar, o.distrito)
      .query(`
        SELECT
          (SELECT id FROM tiendas   WHERE nombre = @tienda)   AS id_tienda,
          (SELECT id FROM origenes  WHERE nombre = @origen)   AS id_origen,
          (SELECT id FROM distritos WHERE nombre = @distrito) AS id_distrito
      `);

    const { id_tienda, id_origen, id_distrito } = lookups.recordset[0];

    if (!id_tienda)   return res.status(400).json({ error: `Tienda no encontrada: ${o.tienda}` });
    if (!id_origen)   return res.status(400).json({ error: `Origen no encontrado: ${o.origen}` });
    if (!id_distrito) return res.status(400).json({ error: `Distrito no encontrado: ${o.distrito}` });

    let id_motorizado = null;
    if (o.motorizado) {
      const mRes = await pool.request()
        .input('moto', sql.NVarChar, o.motorizado)
        .query(`SELECT id FROM motorizados WHERE nombre = @moto`);
      if (mRes.recordset.length > 0) id_motorizado = mRes.recordset[0].id;
    }

    const insertRes = await pool.request()
      .input('codigo',       sql.NVarChar,      nuevoCodigo)
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
      .input('estado',       sql.NVarChar,      o.estado || 'en-proceso')
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
          estado, metodo_pago,
          delivery_base, monto_adicional, monto_cobrado, monto_producto,
          pago_moto_base, pago_moto_adicional,
          producto_especial, observaciones
        ) VALUES (
          @codigo, @fecha, @hora,
          @id_tienda, @id_origen, @id_distrito, @id_moto,
          @dest_nombre, @dest_tel, @dest_tel2, @dest_dir,
          @estado, @metodo,
          @delivery, @adicional, @cobrado, @producto,
          @pago_moto, @pago_moto_ad,
          @especial, @obs
        );
        SELECT SCOPE_IDENTITY() AS id;
      `);

    res.status(201).json({ id: insertRes.recordset[0].id, codigo: nuevoCodigo });
  } catch (err) {
    console.error('POST /ordenes:', err.message);
    res.status(500).json({ error: 'Error al crear la orden' });
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
                     'cambio','devolucion','recojo','en-proceso'];
    const { estado, metodoPago } = req.body;
    if (!ESTADOS.includes(estado)) {
      return res.status(400).json({ error: 'Estado no válido' });
    }

    await pool.request()
      .input('id',     sql.BigInt,   req.params.id)
      .input('estado', sql.NVarChar, estado)
      .input('metodo', sql.NVarChar, metodoPago || '')
      .query(`UPDATE ordenes SET estado = @estado, metodo_pago = @metodo WHERE id = @id`);

    res.json({ ok: true });
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

/* ── PATCH /api/ordenes/:id/completo — solo gestores ─────── */
router.patch('/:id/completo', requireRol(...GESTORES), async (req, res) => {
  try {
    const pool = await getPool();
    const o    = req.body;

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

    await pool.request()
      .input('id',           sql.BigInt,        req.params.id)
      .input('id_tienda',    sql.Int,           id_tienda)
      .input('id_distrito',  sql.Int,           id_distrito)
      .input('dest_nombre',  sql.NVarChar,      o.dest || '')
      .input('dest_tel',     sql.NVarChar,      o.telefDest || '')
      .input('dest_tel2',    sql.NVarChar,      o.telefDest2 || '')
      .input('dest_dir',     sql.NVarChar,      o.direccion || '')
      .input('delivery',     sql.Decimal(10,2), parseFloat(o.delivery) || 0)
      .input('adicional',    sql.Decimal(10,2), parseFloat(o.montoAdicional) || 0)
      .input('cobrado',      sql.Decimal(10,2), parseFloat(o.montoCobrado) || 0)
      .input('producto',     sql.Decimal(10,2), parseFloat(o.montoProducto) || 0)
      .input('pago_moto',    sql.Decimal(10,2), parseFloat(o.pagoMotoBase) || 0)
      .input('pago_moto_ad', sql.Decimal(10,2), parseFloat(o.pagoMotoAdic) || 0)
      .input('obs',          sql.NVarChar,      o.obs || '')
      .query(`
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
            observaciones       = @obs,
            actualizado_en      = GETDATE()
        WHERE id = @id
      `);

    res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /ordenes/:id/completo:', err.message);
    res.status(500).json({ error: 'Error al actualizar la orden' });
  }
});

/* ── PATCH /api/ordenes/:id/asignar — solo gestores ──────── */
router.patch('/:id/asignar', requireRol(...GESTORES), async (req, res) => {
  try {
    const pool = await getPool();
    const { motorizado } = req.body;

    let id_motorizado = null;
    if (motorizado) {
      const mRes = await pool.request()
        .input('moto', sql.NVarChar, motorizado)
        .query(`SELECT id FROM motorizados WHERE nombre = @moto`);
      if (mRes.recordset.length > 0) id_motorizado = mRes.recordset[0].id;
    }

    await pool.request()
      .input('id',   sql.BigInt, req.params.id)
      .input('moto', sql.Int,    id_motorizado)
      .query(`UPDATE ordenes SET id_motorizado = @moto WHERE id = @id`);

    res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /ordenes/:id/asignar:', err.message);
    res.status(500).json({ error: 'Error al asignar la orden' });
  }
});

module.exports = router;
