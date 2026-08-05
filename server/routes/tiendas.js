/* ============================================================
   routes/tiendas.js — con endpoint /resumen
   Protegido: requiere sesión. Escritura solo para gestores.
   Rol tienda: ve/consulta únicamente su propia tienda.
   ============================================================ */
const express = require('express');
const router  = express.Router();
const { getPool, sql } = require('../db');
const { requireAuth, requireRol } = require('../middleware/auth');

router.use(requireAuth);
const GESTORES = ['admin', 'operador'];

/* Una tienda solo puede consultar su propia tienda */
function tiendaAutorizada(usuario, idTiendaPedida) {
  if (usuario.rol !== 'tienda') return true;
  return usuario.id_tienda === parseInt(idTiendaPedida, 10);
}

/* GET /api/tiendas */
router.get('/', async (req, res) => {
  try {
    const pool    = await getPool();
    const request = pool.request();

    let filtro = '';
    if (req.usuario.rol === 'tienda') {
      request.input('yo', sql.Int, req.usuario.id_tienda || -1);
      filtro = 'WHERE id = @yo';
    }

    const result = await request.query(`
      SELECT id, nombre, ruc, contacto, telefono, yape, direccion,
             ciclo_pago, activa, observaciones,
             CONVERT(varchar,creado_en,23) AS creado_en
      FROM tiendas
      ${filtro}
      ORDER BY nombre
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error('GET /tiendas:', err.message);
    res.status(500).json({ error: 'Error al listar tiendas' });
  }
});

/* GET /api/tiendas/resumen?fecha=YYYY-MM-DD */
router.get('/resumen', async (req, res) => {
  try {
    const pool    = await getPool();
    const fecha   = req.query.fecha;
    const request = pool.request();

    let filtroFecha  = '';
    let filtroTienda = '';
    if (fecha) {
      request.input('fecha', sql.Date, fecha);
      filtroFecha = 'AND o.fecha = @fecha';
    }
    if (req.usuario.rol === 'tienda') {
      request.input('yo', sql.Int, req.usuario.id_tienda || -1);
      filtroTienda = 'WHERE t.id = @yo';
    }

    const result = await request.query(`
      SELECT
        t.id AS id_tienda,
        COUNT(o.id) AS total,
        SUM(CASE WHEN o.estado = 'entregado'    THEN 1 ELSE 0 END) AS entregados,
        SUM(CASE WHEN o.estado = 'no-entregado' THEN 1 ELSE 0 END) AS no_entregados,
        SUM(CASE WHEN o.estado = 'reprogramado' THEN 1 ELSE 0 END) AS reprogramados,
        SUM(CASE WHEN o.estado = 'ausente'      THEN 1 ELSE 0 END) AS ausentes,
        SUM(CASE WHEN o.estado IN ('entregado','ausente')
                      AND (o.delivery_base + o.monto_adicional) > o.monto_cobrado
                 THEN (o.delivery_base + o.monto_adicional) - o.monto_cobrado
                 ELSE 0 END) AS por_cobrar,
        SUM(CASE WHEN o.estado IN ('entregado','ausente')
                      AND o.monto_cobrado > (o.delivery_base + o.monto_adicional)
                 THEN o.monto_cobrado - (o.delivery_base + o.monto_adicional)
                 ELSE 0 END) AS por_devolver
      FROM tiendas t
      LEFT JOIN ordenes o ON o.id_tienda = t.id ${filtroFecha}
      ${filtroTienda}
      GROUP BY t.id
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error('GET /tiendas/resumen:', err.message);
    res.status(500).json({ error: 'Error al generar el resumen' });
  }
});

/* POST /api/tiendas — solo gestores */
router.post('/', requireRol(...GESTORES), async (req, res) => {
  try {
    const pool = await getPool();
    const t    = req.body;
    const r = await pool.request()
      .input('nombre',    sql.NVarChar, t.nombre)
      .input('ruc',       sql.NVarChar, t.ruc || '')
      .input('contacto',  sql.NVarChar, t.contacto || '')
      .input('telefono',  sql.NVarChar, t.telefono || '')
      .input('yape',      sql.NVarChar, t.yape || t.telefono || '')
      .input('direccion', sql.NVarChar, t.direccion || '')
      .input('ciclo',     sql.NVarChar, t.ciclo_pago || 'semanal')
      .input('activa',    sql.Bit,      t.activa !== false ? 1 : 0)
      .input('obs',       sql.NVarChar, t.observaciones || '')
      .query(`
        INSERT INTO tiendas (nombre,ruc,contacto,telefono,yape,direccion,ciclo_pago,activa,observaciones)
        VALUES (@nombre,@ruc,@contacto,@telefono,@yape,@direccion,@ciclo,@activa,@obs);
        SELECT SCOPE_IDENTITY() AS id;
      `);
    res.status(201).json({ id: r.recordset[0].id });
  } catch (err) {
    console.error('POST /tiendas:', err.message);
    res.status(500).json({ error: 'Error al crear la tienda' });
  }
});

/* PUT /api/tiendas/:id — solo gestores */
router.put('/:id', requireRol(...GESTORES), async (req, res) => {
  try {
    const pool = await getPool();
    const t    = req.body;
    await pool.request()
      .input('id',        sql.Int,      req.params.id)
      .input('nombre',    sql.NVarChar, t.nombre)
      .input('ruc',       sql.NVarChar, t.ruc || '')
      .input('contacto',  sql.NVarChar, t.contacto || '')
      .input('telefono',  sql.NVarChar, t.telefono || '')
      .input('yape',      sql.NVarChar, t.yape || t.telefono || '')
      .input('direccion', sql.NVarChar, t.direccion || '')
      .input('ciclo',     sql.NVarChar, t.ciclo_pago || 'semanal')
      .input('activa',    sql.Bit,      t.activa !== false ? 1 : 0)
      .input('obs',       sql.NVarChar, t.observaciones || '')
      .query(`
        UPDATE tiendas
        SET nombre=@nombre, ruc=@ruc, contacto=@contacto,
            telefono=@telefono, yape=@yape, direccion=@direccion,
            ciclo_pago=@ciclo, activa=@activa, observaciones=@obs
        WHERE id=@id
      `);
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /tiendas/:id:', err.message);
    res.status(500).json({ error: 'Error al actualizar la tienda' });
  }
});

/* DELETE /api/tiendas/:id — solo gestores */
router.delete('/:id', requireRol(...GESTORES), async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, req.params.id)
      .query(`UPDATE tiendas SET activa = 0 WHERE id = @id`);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /tiendas/:id:', err.message);
    res.status(500).json({ error: 'Error al desactivar la tienda' });
  }
});

/* DELETE /api/tiendas/:id/permanente — solo admin */
router.delete('/:id/permanente', requireRol('admin'), async (req, res) => {
  try {
    const pool = await getPool();
    const check = await pool.request()
      .input('id', sql.Int, req.params.id)
      .query(`SELECT COUNT(*) AS total FROM ordenes WHERE id_tienda = @id`);
    if (check.recordset[0].total > 0) {
      return res.status(400).json({
        error: `No se puede eliminar: esta tienda tiene ${check.recordset[0].total} orden(es) registrada(s). Usa desactivar en su lugar.`
      });
    }
    await pool.request()
      .input('id', sql.Int, req.params.id)
      .query(`DELETE FROM tiendas WHERE id = @id`);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /tiendas/:id/permanente:', err.message);
    res.status(500).json({ error: 'Error al eliminar la tienda' });
  }
});

/* GET /api/tiendas/:id/ordenes — respeta el alcance del rol tienda */
router.get('/:id/ordenes', async (req, res) => {
  try {
    if (!tiendaAutorizada(req.usuario, req.params.id)) {
      return res.status(403).json({ error: 'No puedes ver las órdenes de otra tienda' });
    }

    const pool  = await getPool();
    const fecha = req.query.fecha;
    let query = `
      SELECT o.id, o.codigo, CONVERT(varchar,o.fecha,23) AS fecha,
             d.nombre AS distrito, m.nombre AS motorizado,
             o.dest_nombre, o.estado, o.metodo_pago,
             o.delivery_total, o.monto_cobrado, o.monto_producto,
             o.pago_moto_total, o.producto_especial
      FROM ordenes o
      JOIN distritos d ON d.id = o.id_distrito
      LEFT JOIN motorizados m ON m.id = o.id_motorizado
      WHERE o.id_tienda = @id
    `;
    if (fecha) query += ` AND o.fecha = @fecha`;
    query += ` ORDER BY o.fecha DESC, o.id`;
    const request = pool.request().input('id', sql.Int, req.params.id);
    if (fecha) request.input('fecha', sql.Date, fecha);
    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    console.error('GET /tiendas/:id/ordenes:', err.message);
    res.status(500).json({ error: 'Error al listar las órdenes de la tienda' });
  }
});

module.exports = router;
