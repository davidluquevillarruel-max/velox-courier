/* ============================================================
   avisos.js — Lógica compartida de Notificaciones y Reasignaciones
   (tablas de velox_agregar_notificaciones_reasignaciones.sql).

   · Avisos "Para revisar" de los gestores (tabla notificaciones):
     nacen cuando una orden PASA a no entregado, o a entregado con
     Pago tienda. Las rutas que cambian estado o medio de pago leen el
     tipo antes (tipoAvisoDeOrden) y, si el guardado salió bien, llaman
     registrarAvisoSiNace. Si después la orden cambia y ya no es de ese
     tipo, el aviso no se borra: se esconde al listar
     (SQL_AVISO_VIGENTE).
   · Reasignaciones: la que vence a medianoche, o cuya orden ya no
     está en reparto con el moto que la pidió, se cierra sola la
     próxima vez que alguien las lee (cerrarReasignacionesViejas). No
     hay tarea programada.

   Horas de Lima como texto 'YYYY-MM-DD HH:mm:ss' y en el SQL
   CONVERT(datetime2(0), @x, 120): un Date de JS iría en UTC.
   ============================================================ */
const { sql } = require('./db');

function _partesLima(fecha) {
  const p = {};
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(fecha).forEach(x => { p[x.type] = x.value; });
  return p;
}

/* Ahora en Lima, 'YYYY-MM-DD HH:mm:ss' */
function ahoraLima() {
  const p = _partesLima(new Date());
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/* La próxima medianoche de Lima ('YYYY-MM-DD 00:00:00' del día
   siguiente): ahí vence una reasignación que nadie respondió. Lima no
   tiene horario de verano, así que un día son siempre 24 h. */
function proximaMedianocheLima() {
  const p = _partesLima(new Date());
  const manana = new Date(Date.UTC(+p.year, +p.month - 1, +p.day + 1));
  return manana.toISOString().slice(0, 10) + ' 00:00:00';
}

/* ── Avisos de los gestores ─────────────────────────────────── */

/* Qué aviso le corresponde a una orden en el estado en que está:
   'no_entregado', 'pago_tienda' o null */
function tipoAviso(o) {
  if (!o) return null;
  if (o.estado === 'no-entregado') return 'no_entregado';
  if (o.estado === 'entregado' && o.medio_pago === 'pago-tienda') return 'pago_tienda';
  return null;
}

async function tipoAvisoDeOrden(pool, idOrden) {
  const r = await pool.request()
    .input('id', sql.BigInt, idOrden)
    .query('SELECT estado, medio_pago FROM ordenes WHERE id = @id');
  return tipoAviso(r.recordset[0]);
}

/* Después de un guardado que pudo cambiar estado o medio de pago: si
   la orden PASÓ a un tipo de aviso (antes no lo era, o era otro), nace
   uno. Si ya hay uno abierto de ese tipo, no se duplica (índice
   ux_notif_orden_tipo_abierta). Nunca hace fallar el guardado de la
   orden, que ya está hecho: un error acá solo queda en el log. */
async function registrarAvisoSiNace(pool, idOrden, tipoAntes) {
  try {
    const tipo = await tipoAvisoDeOrden(pool, idOrden);
    if (!tipo || tipo === tipoAntes) return;
    await pool.request()
      .input('tipo',  sql.NVarChar(30), tipo)
      .input('orden', sql.BigInt, idOrden)
      .input('ahora', sql.VarChar(19), ahoraLima())
      .query(`
        IF NOT EXISTS (SELECT 1 FROM notificaciones
                       WHERE id_orden = @orden AND tipo = @tipo
                         AND revisada_en IS NULL AND id_reasignacion IS NULL)
          INSERT INTO notificaciones (tipo, id_orden, creada_en)
          VALUES (@tipo, @orden, CONVERT(datetime2(0), @ahora, 120))
      `);
  } catch (err) {
    console.error('registrarAvisoSiNace:', err.message);
  }
}

/* Un aviso abierto se muestra solo si la orden sigue siendo de su tipo
   (si la corrigieron antes de que alguien lo abriera, se esconde). Los
   de reasignación son informativos: siempre. Alias: n (notificaciones)
   y o (ordenes). */
const SQL_AVISO_VIGENTE = `(
  n.tipo = 'reasignacion'
  OR (n.tipo = 'no_entregado' AND o.estado = 'no-entregado')
  OR (n.tipo = 'pago_tienda'  AND o.estado = 'entregado' AND o.medio_pago = 'pago-tienda')
)`;

/* ── Reasignaciones ─────────────────────────────────────────── */

/* Cierra las pendientes que ya no valen:
   · vencidas (pasó la medianoche) → 'vencida'
   · la orden ya no está en reparto, o ya no es del moto que la pidió
     (la cerró, la oficina la pasó a otro, la anularon) → 'cancelada'
   Va antes de leerlas y antes de crear una nueva: si no, una pendiente
   vencida seguiría ocupando el índice ux_reasig_orden_pendiente. */
async function cerrarReasignacionesViejas(poolOTransaccion) {
  await new sql.Request(poolOTransaccion)
    .input('ahora', sql.VarChar(19), ahoraLima())
    .query(`
      UPDATE reasignaciones
      SET estado = 'vencida', respondida_en = vence_en
      WHERE estado = 'pendiente' AND vence_en <= CONVERT(datetime2(0), @ahora, 120);

      UPDATE r
      SET estado = 'cancelada', respondida_en = CONVERT(datetime2(0), @ahora, 120)
      FROM reasignaciones r
      JOIN ordenes o ON o.id = r.id_orden
      WHERE r.estado = 'pendiente'
        AND (o.estado <> 'en-proceso' OR o.id_motorizado IS NULL OR o.id_motorizado <> r.id_motorizado_de);
    `);
}

module.exports = {
  ahoraLima,
  proximaMedianocheLima,
  tipoAviso,
  tipoAvisoDeOrden,
  registrarAvisoSiNace,
  SQL_AVISO_VIGENTE,
  cerrarReasignacionesViejas,
};
