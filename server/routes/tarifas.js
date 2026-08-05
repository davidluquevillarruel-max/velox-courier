/* ============================================================
   routes/tarifas.js
   Protegido: lectura para autenticados, escritura solo gestores.
   ============================================================ */
const express = require('express');
const router  = express.Router();
const { getPool, sql } = require('../db');
const { requireAuth, requireRol } = require('../middleware/auth');

router.use(requireAuth);
const GESTORES = ['admin', 'operador'];

/* GET /api/tarifas */
router.get('/', async (req, res) => {
  try {
    const pool   = await getPool();
    const result = await pool.request().query(`SELECT * FROM v_tarifario ORDER BY zona, distrito`);
    res.json(result.recordset);
  } catch (err) {
    console.error('GET /tarifas:', err.message);
    res.status(500).json({ error: 'Error al listar tarifas' });
  }
});

/* GET /api/tarifas/zonas */
router.get('/zonas', async (req, res) => {
  try {
    const pool   = await getPool();
    const result = await pool.request().query(`SELECT id, nombre FROM zonas WHERE activa=1 ORDER BY nombre`);
    res.json(result.recordset);
  } catch (err) {
    console.error('GET /tarifas/zonas:', err.message);
    res.status(500).json({ error: 'Error al listar zonas' });
  }
});

/* POST /api/tarifas — solo gestores */
router.post('/', requireRol(...GESTORES), async (req, res) => {
  try {
    const pool = await getPool();
    const d    = req.body;

    const z = await pool.request()
      .input('zona', sql.NVarChar, d.zona)
      .query(`SELECT id FROM zonas WHERE nombre = @zona`);
    if (!z.recordset.length) return res.status(400).json({ error: `Zona no encontrada: ${d.zona}` });

    const r = await pool.request()
      .input('nombre',   sql.NVarChar,      d.distrito)
      .input('id_zona',  sql.Int,           z.recordset[0].id)
      .input('delivery', sql.Decimal(10,2), parseFloat(d.delivery) || 0)
      .input('moto',     sql.Decimal(10,2), parseFloat(d.moto) || 0)
      .query(`
        INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
        VALUES (@nombre, @id_zona, @delivery, @moto);
        SELECT SCOPE_IDENTITY() AS id;
      `);

    res.status(201).json({ id: r.recordset[0].id });
  } catch (err) {
    console.error('POST /tarifas:', err.message);
    res.status(500).json({ error: 'Error al crear la tarifa' });
  }
});

/* PUT /api/tarifas/:id — solo gestores */
router.put('/:id', requireRol(...GESTORES), async (req, res) => {
  try {
    const pool = await getPool();
    const d    = req.body;

    const z = await pool.request()
      .input('zona', sql.NVarChar, d.zona)
      .query(`SELECT id FROM zonas WHERE nombre = @zona`);
    if (!z.recordset.length) return res.status(400).json({ error: `Zona no encontrada: ${d.zona}` });

    await pool.request()
      .input('id',       sql.Int,           req.params.id)
      .input('nombre',   sql.NVarChar,      d.distrito)
      .input('id_zona',  sql.Int,           z.recordset[0].id)
      .input('delivery', sql.Decimal(10,2), parseFloat(d.delivery) || 0)
      .input('moto',     sql.Decimal(10,2), parseFloat(d.moto) || 0)
      .query(`
        UPDATE distritos
        SET nombre=@nombre, id_zona=@id_zona,
            precio_delivery=@delivery, pago_motorizado=@moto
        WHERE id=@id
      `);

    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /tarifas/:id:', err.message);
    res.status(500).json({ error: 'Error al actualizar la tarifa' });
  }
});

/* DELETE /api/tarifas/:id — solo gestores */
router.delete('/:id', requireRol(...GESTORES), async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, req.params.id)
      .query(`UPDATE distritos SET activo = 0 WHERE id = @id`);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /tarifas/:id:', err.message);
    res.status(500).json({ error: 'Error al desactivar la tarifa' });
  }
});

/* DELETE /api/tarifas/:id/permanente — solo admin */
router.delete('/:id/permanente', requireRol('admin'), async (req, res) => {
  try {
    const pool = await getPool();

    const check = await pool.request()
      .input('id', sql.Int, req.params.id)
      .query(`SELECT COUNT(*) AS total FROM ordenes WHERE id_distrito = @id`);

    if (check.recordset[0].total > 0) {
      return res.status(400).json({
        error: `No se puede eliminar: este distrito tiene ${check.recordset[0].total} orden(es) registrada(s). Usa la opción de desactivar en su lugar.`
      });
    }

    await pool.request()
      .input('id', sql.Int, req.params.id)
      .query(`DELETE FROM distritos WHERE id = @id`);

    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /tarifas/:id/permanente:', err.message);
    res.status(500).json({ error: 'Error al eliminar la tarifa' });
  }
});

module.exports = router;
