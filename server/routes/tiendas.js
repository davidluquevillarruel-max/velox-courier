/* ============================================================
   routes/tiendas.js — con endpoint /resumen agregado
   ============================================================ */
const express = require('express');
const router  = express.Router();
const { getPool, sql } = require('../db');

/* GET /api/tiendas */
router.get('/', async (req, res) => {
  try {
    const pool   = await getPool();
    const result = await pool.request().query(`
      SELECT id, nombre, ruc, contacto, telefono, yape, direccion,
             ciclo_pago, activa, observaciones,
             CONVERT(varchar,creado_en,23) AS creado_en
      FROM tiendas
      ORDER BY nombre
    `);
    res.json(result.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* GET /api/tiendas/resumen?fecha=YYYY-MM-DD
   FIX: devuelve stats de TODAS las tiendas en una sola query
   Si no hay fecha, devuelve el acumulado total */
router.get('/resumen', async (req, res) => {
  try {
    const pool  = await getPool();
    const fecha = req.query.fecha;
    const request = pool.request();
    let filtroFecha = '';
    if (fecha) {
      request.input('fecha', sql.Date, fecha);
      filtroFecha = 'AND o.fecha = @fecha';
    }

    const result = await request.query(`
      SELECT
        t.id                                                              AS id_tienda,
        COUNT(o.id)                                                       AS total,
        SUM(CASE WHEN o.estado = 'entregado'    THEN 1 ELSE 0 END)       AS entregados,
        SUM(CASE WHEN o.estado = 'no-entregado' THEN 1 ELSE 0 END)       AS no_entregados,
        SUM(CASE WHEN o.estado = 'reprogramado' THEN 1 ELSE 0 END)       AS reprogramados,
        SUM(CASE WHEN o.estado = 'ausente'      THEN 1 ELSE 0 END)       AS ausentes,
        /* Por cobrar = delivery que la tienda nos debe (delivery > cobrado) */
        SUM(CASE WHEN o.estado IN ('entregado','ausente')
                      AND (o.delivery_base + o.monto_adicional) > o.monto_cobrado
                 THEN (o.delivery_base + o.monto_adicional) - o.monto_cobrado
                 ELSE 0 END)                                              AS por_cobrar,
        /* Por devolver = exceso que cobró el motorizado y hay que devolver */
        SUM(CASE WHEN o.estado IN ('entregado','ausente')
                      AND o.monto_cobrado > (o.delivery_base + o.monto_adicional)
                 THEN o.monto_cobrado - (o.delivery_base + o.monto_adicional)
                 ELSE 0 END)                                              AS por_devolver
      FROM tiendas t
      LEFT JOIN ordenes o ON o.id_tienda = t.id ${filtroFecha}
      GROUP BY t.id
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error('GET /tiendas/resumen:', err);
    res.status(500).json({ error: err.message });
  }
});

/* POST /api/tiendas */
router.post('/', async (req, res) => {
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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* PUT /api/tiendas/:id */
router.put('/:id', async (req, res) => {
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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* DELETE /api/tiendas/:id */
router.delete('/:id', async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, req.params.id)
      .query(`UPDATE tiendas SET activa = 0 WHERE id = @id`);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* DELETE /api/tiendas/:id/permanente */
router.delete('/:id/permanente', async (req, res) => {
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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* GET /api/tiendas/:id/ordenes */
router.get('/:id/ordenes', async (req, res) => {
  try {
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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
