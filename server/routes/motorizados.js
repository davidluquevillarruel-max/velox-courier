/* ============================================================
   routes/motorizados.js
   Protegido: requiere sesión. Escritura solo para gestores.
   Un motorizado solo consulta sus propias órdenes.
   ============================================================ */
const express = require('express');
const router  = express.Router();
const { getPool, sql } = require('../db');
const { requireAuth, requireRol } = require('../middleware/auth');

router.use(requireAuth);
const GESTORES = ['admin', 'operador'];

/* GET /api/motorizados — cualquier usuario autenticado puede leer el catálogo */
router.get('/', async (req, res) => {
  try {
    const pool   = await getPool();
    const result = await pool.request().query(`
      SELECT m.id, m.nombre, m.iniciales, m.telefono, m.yape, m.dni, m.placa,
             m.color_avatar, m.activo, m.referencia,
             CONVERT(varchar,m.fecha_ingreso,23) AS fecha_ingreso,
             z.nombre AS zona
      FROM motorizados m
      LEFT JOIN zonas z ON z.id = m.id_zona
      ORDER BY m.nombre
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error('GET /motorizados:', err.message);
    res.status(500).json({ error: 'Error al listar motorizados' });
  }
});

/* POST /api/motorizados — solo gestores */
router.post('/', requireRol(...GESTORES), async (req, res) => {
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
      .input('yape',      sql.NVarChar, m.yape || m.telefono || '')
      .input('dni',       sql.NVarChar, m.dni || '')
      .input('placa',     sql.NVarChar, m.placa || '')
      .input('referencia',sql.NVarChar, m.referencia || '')
      .input('color',     sql.NVarChar, m.color || 'av-blue')
      .input('activo',    sql.Bit,      m.activo !== false ? 1 : 0)
      .query(`
        INSERT INTO motorizados (nombre,iniciales,id_zona,telefono,yape,dni,placa,referencia,color_avatar,activo)
        VALUES (@nombre,@iniciales,@id_zona,@telefono,@yape,@dni,@placa,@referencia,@color,@activo);
        SELECT SCOPE_IDENTITY() AS id;
      `);
    res.status(201).json({ id: r.recordset[0].id });
  } catch (err) {
    console.error('POST /motorizados:', err.message);
    res.status(500).json({ error: 'Error al crear el motorizado' });
  }
});

/* PUT /api/motorizados/:id — solo gestores */
router.put('/:id', requireRol(...GESTORES), async (req, res) => {
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
      .input('yape',      sql.NVarChar, m.yape || m.telefono || '')
      .input('dni',       sql.NVarChar, m.dni || '')
      .input('placa',     sql.NVarChar, m.placa || '')
      .input('referencia',sql.NVarChar, m.referencia || '')
      .input('color',     sql.NVarChar, m.color || 'av-blue')
      .input('activo',    sql.Bit,      m.activo !== false ? 1 : 0)
      .query(`
        UPDATE motorizados
        SET nombre=@nombre, iniciales=@iniciales, id_zona=@id_zona,
            telefono=@telefono, yape=@yape, dni=@dni, placa=@placa,
            referencia=@referencia, color_avatar=@color, activo=@activo
        WHERE id=@id
      `);
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /motorizados/:id:', err.message);
    res.status(500).json({ error: 'Error al actualizar el motorizado' });
  }
});

/* DELETE /api/motorizados/:id — solo gestores */
router.delete('/:id', requireRol(...GESTORES), async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, req.params.id)
      .query(`UPDATE motorizados SET activo = 0 WHERE id = @id`);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /motorizados/:id:', err.message);
    res.status(500).json({ error: 'Error al desactivar el motorizado' });
  }
});

/* DELETE /api/motorizados/:id/permanente — solo admin */
router.delete('/:id/permanente', requireRol('admin'), async (req, res) => {
  try {
    const pool = await getPool();
    const checkOrdenes = await pool.request()
      .input('id', sql.Int, req.params.id)
      .query(`SELECT COUNT(*) AS total FROM ordenes WHERE id_motorizado = @id`);
    if (checkOrdenes.recordset[0].total > 0) {
      return res.status(400).json({
        error: `No se puede eliminar: este motorizado tiene ${checkOrdenes.recordset[0].total} orden(es) registrada(s). Usa la opción de desactivar en su lugar.`
      });
    }
    const checkUsuario = await pool.request()
      .input('id', sql.Int, req.params.id)
      .query(`SELECT COUNT(*) AS total FROM usuarios WHERE id_motorizado = @id`);
    if (checkUsuario.recordset[0].total > 0) {
      return res.status(400).json({
        error: `No se puede eliminar: este motorizado tiene un usuario de acceso vinculado. Elimina primero ese usuario en la página "Usuarios".`
      });
    }
    await pool.request()
      .input('id', sql.Int, req.params.id)
      .query(`DELETE FROM motorizados WHERE id = @id`);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /motorizados/:id/permanente:', err.message);
    res.status(500).json({ error: 'Error al eliminar el motorizado' });
  }
});

/* GET /api/motorizados/:id/ordenes — motorizado solo ve las suyas */
router.get('/:id/ordenes', async (req, res) => {
  try {
    if (req.usuario.rol === 'motorizado' &&
        req.usuario.id_motorizado !== parseInt(req.params.id, 10)) {
      return res.status(403).json({ error: 'No puedes ver las órdenes de otro motorizado' });
    }

    const pool  = await getPool();
    const fecha = req.query.fecha;
    let query = `
      SELECT o.id, o.codigo, CONVERT(varchar,o.fecha,23) AS fecha,
             t.nombre AS tienda, d.nombre AS distrito,
             o.dest_nombre, o.dest_telefono, o.dest_telefono_2, o.estado, o.metodo_pago,
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
  } catch (err) {
    console.error('GET /motorizados/:id/ordenes:', err.message);
    res.status(500).json({ error: 'Error al listar las órdenes del motorizado' });
  }
});

module.exports = router;
