/* ============================================================
   routes/notificaciones.js — "Para revisar" de admin y operador
   (botón Notificaciones del menú, js/notificaciones.js).

   Cada aviso es UNA fila compartida por todos los gestores: el
   primero que lo abre lo marca revisado (revisada_en) y desaparece
   para todos. Nacen en server/avisos.js (registrarAvisoSiNace, al
   pasar a no entregado o a entregado con Pago tienda) y en
   routes/reasignaciones.js (cuando se acepta una reasignación).
   Los datos que se muestran se leen de la orden en vivo.
   ============================================================ */
const express = require('express');
const router  = express.Router();
const { getPool, sql } = require('../db');
const { requireAuth, requireRol } = require('../middleware/auth');
const { ahoraLima, SQL_AVISO_VIGENTE } = require('../avisos');

router.use(requireAuth, requireRol('admin', 'operador'));

const FROM_AVISOS = `
  FROM notificaciones n
  JOIN ordenes o ON o.id = n.id_orden
  WHERE n.revisada_en IS NULL AND ${SQL_AVISO_VIGENTE}
`;

/* GET /api/notificaciones/total — el contador rojo del menú */
router.get('/total', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`SELECT COUNT(*) AS total ${FROM_AVISOS}`);
    res.json({ total: r.recordset[0].total });
  } catch (err) {
    console.error('GET /notificaciones/total:', err.message);
    res.status(500).json({ error: 'Error al contar las notificaciones' });
  }
});

/* GET /api/notificaciones — los avisos abiertos, el más nuevo arriba */
router.get('/', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT TOP 200
        n.id, n.tipo, n.id_orden,
        CONVERT(varchar(19), n.creada_en, 120) AS creada_en,
        o.codigo, o.dest_nombre, o.metodo_pago, o.monto_cobrado,
        CONVERT(varchar, o.fecha_reparto, 23) AS fecha_reparto,
        d.nombre AS distrito,
        m.nombre AS motorizado,
        mde.nombre  AS moto_de,
        mpara.nombre AS moto_para
      FROM notificaciones n
      JOIN ordenes o   ON o.id = n.id_orden
      JOIN distritos d ON d.id = o.id_distrito
      LEFT JOIN motorizados m     ON m.id = o.id_motorizado
      LEFT JOIN reasignaciones ra ON ra.id = n.id_reasignacion
      LEFT JOIN motorizados mde   ON mde.id = ra.id_motorizado_de
      LEFT JOIN motorizados mpara ON mpara.id = ra.id_motorizado_para
      WHERE n.revisada_en IS NULL AND ${SQL_AVISO_VIGENTE}
      ORDER BY n.creada_en DESC, n.id DESC
    `);
    res.json(r.recordset);
  } catch (err) {
    console.error('GET /notificaciones:', err.message);
    res.status(500).json({ error: 'Error al listar las notificaciones' });
  }
});

/* POST /api/notificaciones/:id/revisar — "Abrir": queda revisado para
   todos. Si otro lo abrió primero, responde igual (con yaRevisada) y
   el id de la orden, para que la pantalla la abra de todos modos. */
router.post('/:id/revisar', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Aviso no válido' });
    const pool = await getPool();
    const r = await pool.request()
      .input('id', sql.Int, id)
      .input('usuario', sql.Int, req.usuario.id)
      .input('ahora', sql.VarChar(19), ahoraLima())
      .query(`
        UPDATE notificaciones
        SET revisada_en = CONVERT(datetime2(0), @ahora, 120), id_usuario_revisa = @usuario
        WHERE id = @id AND revisada_en IS NULL;
        SELECT @@ROWCOUNT AS marcadas, (SELECT id_orden FROM notificaciones WHERE id = @id) AS id_orden;
      `);
    const fila = r.recordset[0];
    if (!fila || !fila.id_orden) return res.status(404).json({ error: 'Aviso no encontrado' });
    res.json({ ok: true, id_orden: fila.id_orden, yaRevisada: fila.marcadas === 0 });
  } catch (err) {
    console.error('POST /notificaciones/:id/revisar:', err.message);
    res.status(500).json({ error: 'Error al marcar el aviso' });
  }
});

module.exports = router;
