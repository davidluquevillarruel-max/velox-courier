/* ============================================================
   routes/notificaciones.js — "Para revisar" de admin y operador
   (botón Notificaciones del menú, js/notificaciones.js).

   Cada aviso es UNA fila compartida por todos los gestores. "Abrir"
   solo lleva a la orden; queda revisado (revisada_en, quién) recién
   cuando alguien GUARDA "Actualizar orden" de esa orden, y entonces
   desaparece para todos. Nacen en server/avisos.js (registrarAvisoSiNace, al
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

/* POST /api/notificaciones/orden/:idOrden/revisar — se llama al GUARDAR
   "Actualizar orden" (aunque no haya cambiado nada): guardar significa
   que la orden ya se revisó. Marca TODOS los avisos abiertos de esa
   orden (también los escondidos por SQL_AVISO_VIGENTE, que ya no
   valen), para todos los gestores. Da igual desde dónde se abrió el
   modal (el aviso, la tabla, la Caja). */
router.post('/orden/:idOrden/revisar', async (req, res) => {
  try {
    const idOrden = parseInt(req.params.idOrden, 10);
    if (!idOrden) return res.status(400).json({ error: 'Orden no válida' });
    const pool = await getPool();
    const r = await pool.request()
      .input('orden', sql.BigInt, idOrden)
      .input('usuario', sql.Int, req.usuario.id)
      .input('ahora', sql.VarChar(19), ahoraLima())
      .query(`
        UPDATE notificaciones
        SET revisada_en = CONVERT(datetime2(0), @ahora, 120), id_usuario_revisa = @usuario
        WHERE id_orden = @orden AND revisada_en IS NULL;
        SELECT @@ROWCOUNT AS marcadas;
      `);
    res.json({ ok: true, marcadas: r.recordset[0].marcadas });
  } catch (err) {
    console.error('POST /notificaciones/orden/:idOrden/revisar:', err.message);
    res.status(500).json({ error: 'Error al marcar los avisos de la orden' });
  }
});

/* "Abrir": NO marca nada (eso pasa al guardar la orden). Devuelve la
   orden a abrir y si otro gestor ya la revisó mientras tanto (el panel
   puede tener hasta 20 s de atraso), para avisarlo y abrirla igual. */
async function infoAviso(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Aviso no válido' });
    const pool = await getPool();
    const r = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT n.id_orden, CASE WHEN n.revisada_en IS NULL THEN 0 ELSE 1 END AS revisada,
               u.nombre AS revisada_por
        FROM notificaciones n
        LEFT JOIN usuarios u ON u.id = n.id_usuario_revisa
        WHERE n.id = @id
      `);
    const fila = r.recordset[0];
    if (!fila) return res.status(404).json({ error: 'Aviso no encontrado' });
    res.json({ ok: true, id_orden: fila.id_orden, yaRevisada: fila.revisada === 1, revisadaPor: fila.revisada_por || null });
  } catch (err) {
    console.error('GET /notificaciones/:id:', err.message);
    res.status(500).json({ error: 'Error al leer el aviso' });
  }
}
router.get('/:id', infoAviso);
/* Compatibilidad: la pantalla de antes (en un navegador sin recargar)
   llamaba a este POST al tocar "Abrir". Ahora responde lo mismo que el
   GET y NO marca: el aviso se cierra recién al guardar. */
router.post('/:id/revisar', infoAviso);

module.exports = router;
