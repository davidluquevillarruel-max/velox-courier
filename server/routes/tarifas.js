/* ============================================================
   routes/tarifas.js
   ============================================================ */
const express = require('express');
const router  = express.Router();
const { getPool, sql } = require('../db');

/* GET /api/tarifas */
router.get('/', async (req, res) => {
  try {
    const pool   = await getPool();
    const result = await pool.request().query(`SELECT * FROM v_tarifario ORDER BY zona, distrito`);
    res.json(result.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* GET /api/tarifas/zonas */
router.get('/zonas', async (req, res) => {
  try {
    const pool   = await getPool();
    const result = await pool.request().query(`SELECT id, nombre FROM zonas WHERE activa=1 ORDER BY nombre`);
    res.json(result.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* POST /api/tarifas */
router.post('/', async (req, res) => {
  try {
    const pool = await getPool();
    const d    = req.body;

    const z = await pool.request()
      .input('zona', sql.NVarChar, d.zona)
      .query(`SELECT id FROM zonas WHERE nombre = @zona`);
    if (!z.recordset.length) return res.status(400).json({ error: `Zona no encontrada: ${d.zona}` });

    const r = await pool.request()
      .input('nombre',   sql.NVarChar, d.distrito)
      .input('id_zona',  sql.Int,      z.recordset[0].id)
      .input('delivery', sql.Decimal,  parseFloat(d.delivery) || 0)
      .input('moto',     sql.Decimal,  parseFloat(d.moto) || 0)
      .query(`
        INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
        VALUES (@nombre, @id_zona, @delivery, @moto);
        SELECT SCOPE_IDENTITY() AS id;
      `);

    res.status(201).json({ id: r.recordset[0].id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* PUT /api/tarifas/:id */
router.put('/:id', async (req, res) => {
  try {
    const pool = await getPool();
    const d    = req.body;

    const z = await pool.request()
      .input('zona', sql.NVarChar, d.zona)
      .query(`SELECT id FROM zonas WHERE nombre = @zona`);
    if (!z.recordset.length) return res.status(400).json({ error: `Zona no encontrada: ${d.zona}` });

    await pool.request()
      .input('id',       sql.Int,      req.params.id)
      .input('nombre',   sql.NVarChar, d.distrito)
      .input('id_zona',  sql.Int,      z.recordset[0].id)
      .input('delivery', sql.Decimal,  parseFloat(d.delivery) || 0)
      .input('moto',     sql.Decimal,  parseFloat(d.moto) || 0)
      .query(`
        UPDATE distritos
        SET nombre=@nombre, id_zona=@id_zona,
            precio_delivery=@delivery, pago_motorizado=@moto
        WHERE id=@id
      `);

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* DELETE /api/tarifas/:id */
router.delete('/:id', async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, req.params.id)
      .query(`UPDATE distritos SET activo = 0 WHERE id = @id`);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
