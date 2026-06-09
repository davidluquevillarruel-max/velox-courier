/* ============================================================
   routes/motorizados.js
   ============================================================ */
const express = require('express');
const router  = express.Router();
const { getPool, sql } = require('../db');

/* GET /api/motorizados */
router.get('/', async (req, res) => {
  try {
    const pool   = await getPool();
    const result = await pool.request().query(`
      SELECT m.id, m.nombre, m.iniciales, m.telefono, m.dni, m.placa,
             m.color_avatar, m.activo, m.referencia,
             CONVERT(varchar,m.fecha_ingreso,23) AS fecha_ingreso,
             z.nombre AS zona
      FROM motorizados m
      LEFT JOIN zonas z ON z.id = m.id_zona
      ORDER BY m.nombre
    `);
    res.json(result.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* POST /api/motorizados */
router.post('/', async (req, res) => {
  try {
    const pool = await getPool();
    const m    = req.body;

    let id_zona = null;
    if (m.zona) {
      const z = await pool.request()
        .input('zona', sql.NVarChar, m.zona)
        .query(`SELECT id FROM zonas WHERE nombre = @zona`);
      if (z.recordset.length > 0) id_zona = z.recordset[0].id;
    }

    const r = await pool.request()
      .input('nombre',    sql.NVarChar, m.nombre)
      .input('iniciales', sql.NVarChar, m.iniciales || m.nombre.substring(0,2).toUpperCase())
      .input('id_zona',   sql.Int,      id_zona)
      .input('telefono',  sql.NVarChar, m.telefono || '')
      .input('dni',       sql.NVarChar, m.dni || '')
      .input('placa',     sql.NVarChar, m.placa || '')
      .input('referencia',sql.NVarChar, m.referencia || '')
      .input('color',     sql.NVarChar, m.color || 'av-blue')
      .input('activo',    sql.Bit,      m.activo !== false ? 1 : 0)
      .query(`
        INSERT INTO motorizados (nombre,iniciales,id_zona,telefono,dni,placa,referencia,color_avatar,activo)
        VALUES (@nombre,@iniciales,@id_zona,@telefono,@dni,@placa,@referencia,@color,@activo);
        SELECT SCOPE_IDENTITY() AS id;
      `);

    res.status(201).json({ id: r.recordset[0].id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* PUT /api/motorizados/:id */
router.put('/:id', async (req, res) => {
  try {
    const pool = await getPool();
    const m    = req.body;

    let id_zona = null;
    if (m.zona) {
      const z = await pool.request()
        .input('zona', sql.NVarChar, m.zona)
        .query(`SELECT id FROM zonas WHERE nombre = @zona`);
      if (z.recordset.length > 0) id_zona = z.recordset[0].id;
    }

    await pool.request()
      .input('id',        sql.Int,      req.params.id)
      .input('nombre',    sql.NVarChar, m.nombre)
      .input('iniciales', sql.NVarChar, m.iniciales)
      .input('id_zona',   sql.Int,      id_zona)
      .input('telefono',  sql.NVarChar, m.telefono || '')
      .input('dni',       sql.NVarChar, m.dni || '')
      .input('placa',     sql.NVarChar, m.placa || '')
      .input('referencia',sql.NVarChar, m.referencia || '')
      .input('color',     sql.NVarChar, m.color || 'av-blue')
      .input('activo',    sql.Bit,      m.activo !== false ? 1 : 0)
      .query(`
        UPDATE motorizados
        SET nombre=@nombre, iniciales=@iniciales, id_zona=@id_zona,
            telefono=@telefono, dni=@dni, placa=@placa,
            referencia=@referencia, color_avatar=@color, activo=@activo
        WHERE id=@id
      `);

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* DELETE /api/motorizados/:id */
router.delete('/:id', async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, req.params.id)
      .query(`UPDATE motorizados SET activo = 0 WHERE id = @id`);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* GET /api/motorizados/:id/ordenes?fecha=YYYY-MM-DD */
router.get('/:id/ordenes', async (req, res) => {
  try {
    const pool  = await getPool();
    const fecha = req.query.fecha;

    let query = `
      SELECT o.id, o.codigo, CONVERT(varchar,o.fecha,23) AS fecha,
             t.nombre AS tienda, d.nombre AS distrito,
             o.dest_nombre, o.estado, o.metodo_pago,
             o.delivery_total, o.monto_cobrado, o.monto_producto,
             o.pago_moto_total, o.monto_adicional, o.producto_especial
      FROM ordenes o
      JOIN tiendas   t ON t.id = o.id_tienda
      JOIN distritos d ON d.id = o.id_distrito
      WHERE o.id_motorizado = @id
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
