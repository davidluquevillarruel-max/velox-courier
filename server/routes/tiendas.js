/* ============================================================
   routes/tiendas.js
   ============================================================ */
const express = require('express');
const router  = express.Router();
const { getPool, sql } = require('../db');

/* GET /api/tiendas */
router.get('/', async (req, res) => {
  try {
    const pool   = await getPool();
    const result = await pool.request().query(`
      SELECT id, nombre, ruc, contacto, telefono, direccion,
             ciclo_pago, activa, observaciones,
             CONVERT(varchar,creado_en,23) AS creado_en
      FROM tiendas
      ORDER BY nombre
    `);
    res.json(result.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
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
      .input('direccion', sql.NVarChar, t.direccion || '')
      .input('ciclo',     sql.NVarChar, t.ciclo_pago || 'semanal')
      .input('activa',    sql.Bit,      t.activa !== false ? 1 : 0)
      .input('obs',       sql.NVarChar, t.observaciones || '')
      .query(`
        INSERT INTO tiendas (nombre,ruc,contacto,telefono,direccion,ciclo_pago,activa,observaciones)
        VALUES (@nombre,@ruc,@contacto,@telefono,@direccion,@ciclo,@activa,@obs);
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
      .input('direccion', sql.NVarChar, t.direccion || '')
      .input('ciclo',     sql.NVarChar, t.ciclo_pago || 'semanal')
      .input('activa',    sql.Bit,      t.activa !== false ? 1 : 0)
      .input('obs',       sql.NVarChar, t.observaciones || '')
      .query(`
        UPDATE tiendas
        SET nombre=@nombre, ruc=@ruc, contacto=@contacto,
            telefono=@telefono, direccion=@direccion,
            ciclo_pago=@ciclo, activa=@activa, observaciones=@obs
        WHERE id=@id
      `);

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* DELETE /api/tiendas/:id (desactiva) */
router.delete('/:id', async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, req.params.id)
      .query(`UPDATE tiendas SET activa = 0 WHERE id = @id`);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* GET /api/tiendas/:id/ordenes?fecha=YYYY-MM-DD */
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
