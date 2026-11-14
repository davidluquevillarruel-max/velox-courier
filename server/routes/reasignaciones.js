/* ============================================================
   routes/reasignaciones.js — Un motorizado le pasa una orden a otro,
   y el otro tiene que aceptarla (tabla reasignaciones, ver
   velox_agregar_notificaciones_reasignaciones.sql).

   · POST /                → pedir (moto dueño de la orden, o un gestor
                             en su nombre). La orden NO cambia todavía:
                             sigue siendo responsabilidad del que la envía.
   · POST /:id/aceptar     → solo el destino: la orden pasa a él
                             (asignada_en = ahora, sale arriba de su
                             lista) y los gestores reciben un aviso.
   · POST /:id/rechazar    → solo el destino: no pasa nada.
   · POST /:id/cancelar    → el que la envió (o un gestor).
   · POST /:id/visto       → el que la envió ya vio la respuesta ("no
                             aceptó" o "aceptó"): deja de mostrarse.
   · GET  /mias            → lo del motorizado de la sesión.
   · GET  /motorizado/:id  → lo enviado por un moto (panel de Motorizados).

   Una sola pendiente por orden (índice ux_reasig_orden_pendiente).
   Vence a medianoche de Lima; las vencidas y las que ya no valen (la
   orden se cerró, la oficina la pasó a otro) se cierran solas al leer
   (cerrarReasignacionesViejas en server/avisos.js).
   El alcance sale SIEMPRE de la sesión, nunca del body.
   ============================================================ */
const express = require('express');
const router  = express.Router();
const { getPool, sql } = require('../db');
const { requireAuth, requireRol } = require('../middleware/auth');
const { ahoraLima, proximaMedianocheLima, cerrarReasignacionesViejas } = require('../avisos');

router.use(requireAuth, requireRol('admin', 'operador', 'motorizado'));
const GESTORES = ['admin', 'operador'];

function idValido(v) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function miMoto(req) {
  return req.usuario.rol === 'motorizado' ? (req.usuario.id_motorizado || null) : null;
}

/* Lo que el moto de origen necesita para pintar sus tarjetas y sus
   Notificaciones: pendientes (esperando) y las respuestas que todavía
   no vio ("X no aceptó" / "X aceptó"; vista_por_origen_en vacío). */
async function enviadasDe(pool, idMoto) {
  const r = await pool.request()
    .input('m', sql.Int, idMoto)
    .query(`
      SELECT r.id, r.id_orden, r.estado, r.id_motorizado_para,
             mp.nombre AS moto_para, o.codigo, o.dest_nombre,
             CONVERT(varchar(19), r.creada_en, 120) AS creada_en,
             CONVERT(varchar(19), r.respondida_en, 120) AS respondida_en
      FROM reasignaciones r
      JOIN motorizados mp ON mp.id = r.id_motorizado_para
      JOIN ordenes o      ON o.id = r.id_orden
      WHERE r.id_motorizado_de = @m
        AND (r.estado = 'pendiente'
             OR (r.estado IN ('rechazada', 'aceptada') AND r.vista_por_origen_en IS NULL))
      ORDER BY r.id DESC
    `);
  return {
    enviadas:   r.recordset.filter(x => x.estado === 'pendiente'),
    rechazadas: r.recordset.filter(x => x.estado === 'rechazada'),
    aceptadas:  r.recordset.filter(x => x.estado === 'aceptada'),
  };
}

/* GET /api/reasignaciones/mias — solo el rol motorizado */
router.get('/mias', async (req, res) => {
  try {
    const yo = miMoto(req);
    if (!yo) return res.json({ recibidas: [], enviadas: [], rechazadas: [], aceptadas: [] });
    const pool = await getPool();
    await cerrarReasignacionesViejas(pool);

    const rec = await pool.request()
      .input('m', sql.Int, yo)
      .query(`
        SELECT r.id, r.id_orden,
               CONVERT(varchar(19), r.creada_en, 120) AS creada_en,
               md.nombre AS moto_de, md.iniciales AS moto_de_iniciales, md.color_avatar AS moto_de_color,
               o.codigo, o.dest_nombre, o.metodo_pago, o.monto_cobrado,
               t.nombre AS tienda, d.nombre AS distrito,
               (SELECT TOP 1 url FROM ordenes_fotos
                 WHERE id_orden = o.id AND tipo = 'foto_producto' ORDER BY subido_en DESC) AS foto_producto_url
        FROM reasignaciones r
        JOIN motorizados md ON md.id = r.id_motorizado_de
        JOIN ordenes o      ON o.id = r.id_orden
        JOIN tiendas t      ON t.id = o.id_tienda
        JOIN distritos d    ON d.id = o.id_distrito
        WHERE r.id_motorizado_para = @m AND r.estado = 'pendiente'
        ORDER BY r.id DESC
      `);
    res.json({ recibidas: rec.recordset, ...(await enviadasDe(pool, yo)) });
  } catch (err) {
    console.error('GET /reasignaciones/mias:', err.message);
    res.status(500).json({ error: 'Error al leer las reasignaciones' });
  }
});

/* GET /api/reasignaciones/motorizado/:id — lo enviado por ese moto
   (el motorizado solo puede pedir lo suyo) */
router.get('/motorizado/:id', async (req, res) => {
  try {
    const id = idValido(req.params.id);
    if (!id) return res.status(400).json({ error: 'Motorizado no válido' });
    if (req.usuario.rol === 'motorizado' && miMoto(req) !== id) {
      return res.status(403).json({ error: 'No puedes ver las reasignaciones de otro motorizado' });
    }
    const pool = await getPool();
    await cerrarReasignacionesViejas(pool);
    res.json(await enviadasDe(pool, id));
  } catch (err) {
    console.error('GET /reasignaciones/motorizado/:id:', err.message);
    res.status(500).json({ error: 'Error al leer las reasignaciones' });
  }
});

/* POST /api/reasignaciones { idOrden, idMotorizadoPara } */
router.post('/', async (req, res) => {
  let tx;
  try {
    const idOrden = idValido(req.body.idOrden);
    const idPara  = idValido(req.body.idMotorizadoPara);
    if (!idOrden || !idPara) return res.status(400).json({ error: 'Falta la orden o el motorizado' });

    const pool = await getPool();
    const r = await pool.request()
      .input('o', sql.BigInt, idOrden)
      .input('p', sql.Int, idPara)
      .query(`
        SELECT o.estado, o.id_motorizado, o.codigo,
               (SELECT activo FROM motorizados WHERE id = @p) AS para_activo,
               (SELECT nombre FROM motorizados WHERE id = @p) AS para_nombre
        FROM ordenes o WHERE o.id = @o
      `);
    const o = r.recordset[0];
    if (!o) return res.status(404).json({ error: 'Orden no encontrada' });

    /* Quién la envía: el moto de la sesión (y tiene que ser suya), o un
       gestor en nombre del moto que la tiene */
    if (req.usuario.rol === 'motorizado') {
      if (!miMoto(req) || o.id_motorizado !== miMoto(req)) {
        return res.status(403).json({ error: 'Solo puedes pasar tus propias órdenes' });
      }
    } else if (!GESTORES.includes(req.usuario.rol)) {
      return res.status(403).json({ error: 'No tienes permiso' });
    }
    if (!o.id_motorizado) return res.status(400).json({ error: 'Esta orden no tiene motorizado: asígnala desde Asignación.' });
    if (o.estado !== 'en-proceso') {
      return res.status(400).json({ error: 'Solo se pueden pasar órdenes que siguen en reparto.' });
    }
    if (o.para_activo === null || o.para_activo === undefined) return res.status(400).json({ error: 'Motorizado no encontrado' });
    if (!o.para_activo) return res.status(400).json({ error: 'Ese motorizado está inactivo.' });
    if (idPara === o.id_motorizado) return res.status(400).json({ error: 'La orden ya es de ese motorizado.' });

    tx = new sql.Transaction(pool);
    await tx.begin();
    await cerrarReasignacionesViejas(tx);
    let ins;
    try {
      ins = await new sql.Request(tx)
        .input('o',     sql.BigInt, idOrden)
        .input('de',    sql.Int, o.id_motorizado)
        .input('para',  sql.Int, idPara)
        .input('ahora', sql.VarChar(19), ahoraLima())
        .input('vence', sql.VarChar(19), proximaMedianocheLima())
        .query(`
          INSERT INTO reasignaciones (id_orden, id_motorizado_de, id_motorizado_para, creada_en, vence_en)
          OUTPUT INSERTED.id
          VALUES (@o, @de, @para, CONVERT(datetime2(0), @ahora, 120), CONVERT(datetime2(0), @vence, 120))
        `);
    } catch (err) {
      const num = err.number || (err.originalError && err.originalError.info && err.originalError.info.number);
      if ((num === 2601 || num === 2627) && String(err.message).includes('ux_reasig_orden_pendiente')) {
        await tx.rollback(); tx = null;
        return res.status(409).json({ error: 'Esta orden ya tiene un pedido de reasignación esperando respuesta.' });
      }
      throw err;
    }
    /* Un pedido nuevo deja atrás el "no aceptó" anterior de esta orden:
       si no, al cancelar este volvería a aparecer el rechazo viejo */
    await new sql.Request(tx)
      .input('o', sql.BigInt, idOrden)
      .input('ahora', sql.VarChar(19), ahoraLima())
      .query(`UPDATE reasignaciones SET vista_por_origen_en = CONVERT(datetime2(0), @ahora, 120)
              WHERE id_orden = @o AND estado = 'rechazada' AND vista_por_origen_en IS NULL`);
    await tx.commit(); tx = null;
    res.status(201).json({ ok: true, id: ins.recordset[0].id, moto_para: o.para_nombre });
  } catch (err) {
    if (tx) { try { await tx.rollback(); } catch (e) { /* ya se deshizo */ } }
    console.error('POST /reasignaciones:', err.message);
    res.status(500).json({ error: 'Error al pedir la reasignación' });
  }
});

/* Lee una reasignación para responderla, después de cerrar las viejas */
async function leerReasignacion(executor, id, bloquear) {
  const r = await new sql.Request(executor)
    .input('id', sql.Int, id)
    .query(`
      SELECT r.id, r.id_orden, r.id_motorizado_de, r.id_motorizado_para, r.estado,
             o.codigo, md.nombre AS moto_de, mp.nombre AS moto_para, mp.activo AS para_activo
      FROM reasignaciones r ${bloquear ? 'WITH (UPDLOCK, HOLDLOCK)' : ''}
      JOIN ordenes o      ON o.id = r.id_orden
      JOIN motorizados md ON md.id = r.id_motorizado_de
      JOIN motorizados mp ON mp.id = r.id_motorizado_para
      WHERE r.id = @id
    `);
  return r.recordset[0] || null;
}

/* Por qué ya no se puede responder */
function motivoCerrada(ra) {
  return {
    vencida:   'Este pedido venció a medianoche: la orden quedó con ' + ra.moto_de + '.',
    cancelada: 'Este pedido ya no está vigente: ' + ra.moto_de + ' lo canceló o la orden cambió.',
    aceptada:  'Este pedido ya fue aceptado.',
    rechazada: 'Este pedido ya fue rechazado.',
  }[ra.estado] || 'Este pedido ya no está pendiente.';
}

/* POST /api/reasignaciones/:id/aceptar — solo el destino */
router.post('/:id/aceptar', async (req, res) => {
  let tx;
  try {
    const id = idValido(req.params.id);
    if (!id) return res.status(400).json({ error: 'Pedido no válido' });
    const yo = miMoto(req);
    if (!yo) return res.status(403).json({ error: 'Solo el motorizado que recibe el pedido puede aceptarlo' });

    const pool = await getPool();
    tx = new sql.Transaction(pool);
    await tx.begin();
    await cerrarReasignacionesViejas(tx);
    const ra = await leerReasignacion(tx, id, true);
    if (!ra || ra.id_motorizado_para !== yo) {
      await tx.rollback(); tx = null;
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }
    if (ra.estado !== 'pendiente') {
      await tx.rollback(); tx = null;
      return res.status(409).json({ error: motivoCerrada(ra), estado: ra.estado });
    }
    if (!ra.para_activo) {
      await tx.rollback(); tx = null;
      return res.status(400).json({ error: 'Tu motorizado está inactivo: no puedes recibir órdenes.' });
    }

    const ahora = ahoraLima();
    /* Pasa solo si la orden sigue en reparto y con el que la envió */
    const up = await new sql.Request(tx)
      .input('o', sql.BigInt, ra.id_orden)
      .input('de', sql.Int, ra.id_motorizado_de)
      .input('para', sql.Int, yo)
      .input('ahora', sql.VarChar(19), ahora)
      .query(`
        UPDATE ordenes
        SET id_motorizado = @para, asignada_en = CONVERT(datetime2(0), @ahora, 120)
        WHERE id = @o AND id_motorizado = @de AND estado = 'en-proceso'
      `);
    if (up.rowsAffected[0] === 0) {
      await new sql.Request(tx).input('id', sql.Int, id).input('ahora', sql.VarChar(19), ahora)
        .query(`UPDATE reasignaciones SET estado = 'cancelada', respondida_en = CONVERT(datetime2(0), @ahora, 120) WHERE id = @id`);
      await tx.commit(); tx = null;
      return res.status(409).json({ error: 'La orden ya no está disponible: ' + ra.moto_de + ' la cerró o la oficina la cambió.', estado: 'cancelada' });
    }

    await new sql.Request(tx)
      .input('id', sql.Int, id)
      .input('o', sql.BigInt, ra.id_orden)
      .input('ahora', sql.VarChar(19), ahora)
      .query(`
        UPDATE reasignaciones SET estado = 'aceptada', respondida_en = CONVERT(datetime2(0), @ahora, 120) WHERE id = @id;
        INSERT INTO notificaciones (tipo, id_orden, id_reasignacion, creada_en)
        VALUES ('reasignacion', @o, @id, CONVERT(datetime2(0), @ahora, 120));
      `);
    await tx.commit(); tx = null;
    res.json({ ok: true, id_orden: ra.id_orden, codigo: ra.codigo });
  } catch (err) {
    if (tx) { try { await tx.rollback(); } catch (e) { /* ya se deshizo */ } }
    console.error('POST /reasignaciones/:id/aceptar:', err.message);
    res.status(500).json({ error: 'Error al aceptar la orden' });
  }
});

/* Cierra una pendiente sin mover la orden: rechazar (destino) o
   cancelar (origen o gestor) */
async function cerrarSinMover(req, res, estadoNuevo, puede) {
  try {
    const id = idValido(req.params.id);
    if (!id) return res.status(400).json({ error: 'Pedido no válido' });
    const pool = await getPool();
    await cerrarReasignacionesViejas(pool);
    const ra = await leerReasignacion(pool, id, false);
    if (!ra || !puede(ra)) return res.status(404).json({ error: 'Pedido no encontrado' });
    const r = await pool.request()
      .input('id', sql.Int, id)
      .input('estado', sql.NVarChar(20), estadoNuevo)
      .input('ahora', sql.VarChar(19), ahoraLima())
      .query(`UPDATE reasignaciones SET estado = @estado, respondida_en = CONVERT(datetime2(0), @ahora, 120)
              WHERE id = @id AND estado = 'pendiente'`);
    if (r.rowsAffected[0] === 0) {
      const fresca = await leerReasignacion(pool, id, false);
      return res.status(409).json({ error: motivoCerrada(fresca), estado: fresca.estado });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /reasignaciones/:id/' + estadoNuevo + ':', err.message);
    res.status(500).json({ error: 'Error al responder el pedido' });
  }
}

router.post('/:id/rechazar', (req, res) =>
  cerrarSinMover(req, res, 'rechazada', ra => ra.id_motorizado_para === miMoto(req)));

router.post('/:id/cancelar', (req, res) =>
  cerrarSinMover(req, res, 'cancelada', ra =>
    GESTORES.includes(req.usuario.rol) || ra.id_motorizado_de === miMoto(req)));

/* POST /api/reasignaciones/:id/visto — el que la envió ya vio la
   respuesta (rechazada o aceptada): deja de mostrarse en su tarjeta y
   en sus Notificaciones */
router.post('/:id/visto', async (req, res) => {
  try {
    const id = idValido(req.params.id);
    if (!id) return res.status(400).json({ error: 'Pedido no válido' });
    const pool = await getPool();
    const ra = await leerReasignacion(pool, id, false);
    if (!ra || !(GESTORES.includes(req.usuario.rol) || ra.id_motorizado_de === miMoto(req))) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }
    await pool.request()
      .input('id', sql.Int, id)
      .input('ahora', sql.VarChar(19), ahoraLima())
      .query(`UPDATE reasignaciones SET vista_por_origen_en = CONVERT(datetime2(0), @ahora, 120)
              WHERE id = @id AND vista_por_origen_en IS NULL`);
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /reasignaciones/:id/visto:', err.message);
    res.status(500).json({ error: 'Error al marcar el aviso' });
  }
});

module.exports = router;
