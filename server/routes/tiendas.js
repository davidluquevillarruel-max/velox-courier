/* ============================================================
   routes/tiendas.js — con endpoint /resumen
   Protegido: requiere sesión. Escritura solo para gestores.
   Rol tienda: ve/consulta únicamente su propia tienda.
   ============================================================ */
const express = require('express');
const router  = express.Router();
const { getPool, sql } = require('../db');
const { requireAuth, requireRol } = require('../middleware/auth');
const { calcularOrdenCaja, aSoles } = require('../caja-motor');

router.use(requireAuth);
const GESTORES = ['admin', 'operador'];

/* Tienda comodín de las órdenes de foto en ráfaga (ver
   velox_agregar_rafaga.sql y routes/ordenes.js). No es una tienda
   real: no se lista en ninguna pantalla ni se puede editar. */
const TIENDA_SIN_DEFINIR = 'SIN DEFINIR';

async function esTiendaComodin(pool, id) {
  const r = await pool.request()
    .input('id', sql.Int, id)
    .input('comodin', sql.NVarChar, TIENDA_SIN_DEFINIR)
    .query(`SELECT 1 AS si FROM tiendas WHERE id = @id AND nombre = @comodin`);
  return r.recordset.length > 0;
}

/* Nombre de la tienda para crear/editar: obligatorio, sin repetir
   (la tabla tiene uq_tiendas_nombre) y nunca el del comodín. Devuelve
   { nombre } o { error } con el mensaje para el 400. */
async function validarNombreTienda(pool, nombre, idPropio) {
  nombre = typeof nombre === 'string' ? nombre.trim().replace(/\s+/g, ' ') : '';
  if (nombre.length < 2)   return { error: 'El nombre de la tienda es obligatorio (mínimo 2 caracteres).' };
  if (nombre.length > 100) return { error: 'El nombre de la tienda no puede pasar de 100 caracteres.' };
  if (nombre.toUpperCase() === TIENDA_SIN_DEFINIR) return { error: 'Ese nombre está reservado por el sistema.' };
  const r = await pool.request()
    .input('nombre', sql.NVarChar, nombre)
    .input('id',     sql.Int,      idPropio || 0)
    .query(`SELECT 1 AS si FROM tiendas WHERE nombre = @nombre AND id <> @id`);
  if (r.recordset.length > 0) return { error: 'Ya existe una tienda con ese nombre.' };
  return { nombre };
}

/* Choque con uq_tiendas_nombre (dos altas al mismo tiempo) */
function esNombreDuplicado(err) {
  return err && (err.number === 2627 || err.number === 2601);
}

/* Una tienda solo puede consultar su propia tienda; el motorizado,
   ninguna (serían órdenes y clientes de toda la tienda) */
function tiendaAutorizada(usuario, idTiendaPedida) {
  if (usuario.rol === 'motorizado') return false;
  if (usuario.rol !== 'tienda') return true;
  return usuario.id_tienda === parseInt(idTiendaPedida, 10);
}

/* GET /api/tiendas */
router.get('/', async (req, res) => {
  try {
    const pool    = await getPool();
    const request = pool.request();

    request.input('comodin', sql.NVarChar, TIENDA_SIN_DEFINIR);
    let filtro = 'WHERE nombre <> @comodin';
    if (req.usuario.rol === 'tienda') {
      request.input('yo', sql.Int, req.usuario.id_tienda || -1);
      filtro += ' AND id = @yo';
    }

    /* El motorizado necesita solo los nombres (filtro de Asignación,
       Evidencias, "Actualizar orden"): sin RUC, contacto, teléfono,
       Yape ni dirección de las tiendas */
    if (req.usuario.rol === 'motorizado') {
      const r = await request.query(`SELECT id, nombre, activa FROM tiendas ${filtro} ORDER BY nombre`);
      return res.json(r.recordset);
    }

    const result = await request.query(`
      SELECT id, nombre, ruc, contacto, telefono, yape, direccion,
             ciclo_pago, activa, observaciones,
             CONVERT(varchar,creado_en,23) AS creado_en,
             /* Para el catálogo (js/tiendas.js): si ya tiene usuario de acceso */
             CAST(CASE WHEN EXISTS (SELECT 1 FROM usuarios u WHERE u.id_tienda = tiendas.id)
                       THEN 1 ELSE 0 END AS BIT) AS tiene_usuario
      FROM tiendas
      ${filtro}
      ORDER BY nombre
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error('GET /tiendas:', err.message);
    res.status(500).json({ error: 'Error al listar tiendas' });
  }
});

/* GET /api/tiendas/resumen?fecha=YYYY-MM-DD
   GET /api/tiendas/resumen?desde=YYYY-MM-DD&hasta=YYYY-MM-DD */
router.get('/resumen', async (req, res) => {
  try {
    /* La plata de las tiendas no es del motorizado */
    if (req.usuario.rol === 'motorizado') {
      return res.status(403).json({ error: 'Acceso denegado para este rol' });
    }
    const pool    = await getPool();
    const fecha   = req.query.fecha;
    const desde   = req.query.desde;
    const hasta   = req.query.hasta;
    const request = pool.request();

    let filtroFecha  = '';
    request.input('comodin', sql.NVarChar, TIENDA_SIN_DEFINIR);
    let filtroTienda = 'WHERE t.nombre <> @comodin';
    if (desde && hasta) {
      request.input('desde', sql.Date, desde);
      request.input('hasta', sql.Date, hasta);
      filtroFecha = 'AND o.fecha_reparto BETWEEN @desde AND @hasta';
    } else if (fecha) {
      request.input('fecha', sql.Date, fecha);
      filtroFecha = 'AND o.fecha_reparto = @fecha';
    }
    if (req.usuario.rol === 'tienda') {
      request.input('yo', sql.Int, req.usuario.id_tienda || -1);
      filtroTienda += ' AND t.id = @yo';
    }

    /* La plata sale del motor de la Caja (calcularOrdenCaja), en vivo,
       igual que Caja → Tienda, el reporte en imagen y el WhatsApp: antes
       era la regla vieja (entregado / ausente, delivery − cobrado), que
       no miraba el medio de pago ni el prepago. Un día ya liquidado se
       cuenta igual en vivo (como el reporte); la Caja muestra el saldo
       guardado y avisa "difiere" si alguien editó una orden después. */
    const result = await request.query(`
      SELECT t.id AS id_tienda, o.id, o.estado, o.metodo_pago, o.medio_pago, o.pago_velox,
             o.pago_velox_metodo, o.delivery_total, o.pago_moto_total, o.monto_cobrado, o.id_motorizado
      FROM tiendas t
      LEFT JOIN ordenes o ON o.id_tienda = t.id AND o.estado <> 'anulado' ${filtroFecha}
      ${filtroTienda}
    `);
    const CONTAR = { 'entregado': 'entregados', 'no-entregado': 'no_entregados',
                     'reprogramado': 'reprogramados', 'ausente': 'ausentes' };
    const porTienda = new Map();
    for (const o of result.recordset) {
      if (!porTienda.has(o.id_tienda)) {
        porTienda.set(o.id_tienda, { id_tienda: o.id_tienda, total: 0, entregados: 0, no_entregados: 0,
          reprogramados: 0, ausentes: 0, delivery: 0, retenido: 0, saldo: 0 });
      }
      if (!o.id) continue; /* tienda sin órdenes en el período */
      const s = porTienda.get(o.id_tienda);
      const c = calcularOrdenCaja(o);
      s.total++;
      if (CONTAR[o.estado]) s[CONTAR[o.estado]]++;
      s.delivery += c.delivery; s.retenido += c.retenido; s.saldo += c.saldo_tienda;
    }
    res.json([...porTienda.values()].map(s => ({
      ...s, delivery: aSoles(s.delivery), retenido: aSoles(s.retenido), saldo: aSoles(s.saldo),
    })));
  } catch (err) {
    console.error('GET /tiendas/resumen:', err.message);
    res.status(500).json({ error: 'Error al generar el resumen' });
  }
});

/* POST /api/tiendas — solo gestores. Solo el nombre es obligatorio. */
router.post('/', requireRol(...GESTORES), async (req, res) => {
  try {
    const pool = await getPool();
    const t    = req.body;
    const v    = await validarNombreTienda(pool, t.nombre);
    if (v.error) return res.status(400).json({ error: v.error });
    const r = await pool.request()
      .input('nombre',    sql.NVarChar, v.nombre)
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
  } catch (err) {
    if (esNombreDuplicado(err)) return res.status(400).json({ error: 'Ya existe una tienda con ese nombre.' });
    console.error('POST /tiendas:', err.message);
    res.status(500).json({ error: 'Error al crear la tienda' });
  }
});

/* PUT /api/tiendas/:id — solo gestores */
router.put('/:id', requireRol(...GESTORES), async (req, res) => {
  try {
    const pool = await getPool();
    if (await esTiendaComodin(pool, req.params.id)) {
      return res.status(400).json({ error: 'Esta tienda es interna del sistema y no se puede modificar.' });
    }
    const t    = req.body;
    const v    = await validarNombreTienda(pool, t.nombre, parseInt(req.params.id, 10));
    if (v.error) return res.status(400).json({ error: v.error });
    await pool.request()
      .input('id',        sql.Int,      req.params.id)
      .input('nombre',    sql.NVarChar, v.nombre)
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
  } catch (err) {
    if (esNombreDuplicado(err)) return res.status(400).json({ error: 'Ya existe una tienda con ese nombre.' });
    console.error('PUT /tiendas/:id:', err.message);
    res.status(500).json({ error: 'Error al actualizar la tienda' });
  }
});

/* PATCH /api/tiendas/:id/estado — solo gestores. { activa: true|false }
   Desactivar / reactivar desde el catálogo. Una tienda inactiva sigue
   en el catálogo y en el historial, pero no sale en las selecciones
   para crear órdenes (y POST /ordenes la rechaza). */
router.patch('/:id/estado', requireRol(...GESTORES), async (req, res) => {
  try {
    const pool = await getPool();
    if (await esTiendaComodin(pool, req.params.id)) {
      return res.status(400).json({ error: 'Esta tienda es interna del sistema y no se puede modificar.' });
    }
    const r = await pool.request()
      .input('id',     sql.Int, req.params.id)
      .input('activa', sql.Bit, req.body.activa ? 1 : 0)
      .query(`UPDATE tiendas SET activa = @activa WHERE id = @id`);
    if (!r.rowsAffected[0]) return res.status(404).json({ error: 'Tienda no encontrada' });
    res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /tiendas/:id/estado:', err.message);
    res.status(500).json({ error: 'Error al cambiar el estado de la tienda' });
  }
});

/* DELETE /api/tiendas/:id — solo gestores */
router.delete('/:id', requireRol(...GESTORES), async (req, res) => {
  try {
    const pool = await getPool();
    if (await esTiendaComodin(pool, req.params.id)) {
      return res.status(400).json({ error: 'Esta tienda es interna del sistema y no se puede modificar.' });
    }
    await pool.request()
      .input('id', sql.Int, req.params.id)
      .query(`UPDATE tiendas SET activa = 0 WHERE id = @id`);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /tiendas/:id:', err.message);
    res.status(500).json({ error: 'Error al desactivar la tienda' });
  }
});

/* DELETE /api/tiendas/:id/permanente — solo admin */
router.delete('/:id/permanente', requireRol('admin'), async (req, res) => {
  try {
    const pool = await getPool();
    if (await esTiendaComodin(pool, req.params.id)) {
      return res.status(400).json({ error: 'Esta tienda es interna del sistema y no se puede modificar.' });
    }
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
  } catch (err) {
    console.error('DELETE /tiendas/:id/permanente:', err.message);
    res.status(500).json({ error: 'Error al eliminar la tienda' });
  }
});

/* GET /api/tiendas/:id/ordenes — respeta el alcance del rol tienda */
router.get('/:id/ordenes', async (req, res) => {
  try {
    if (!tiendaAutorizada(req.usuario, req.params.id)) {
      return res.status(403).json({ error: 'No puedes ver las órdenes de otra tienda' });
    }

    const pool  = await getPool();
    const fecha = req.query.fecha;
    const desde = req.query.desde;
    const hasta = req.query.hasta;
    let query = `
      SELECT o.id, o.codigo, CONVERT(varchar,o.fecha,23) AS fecha,
             CONVERT(varchar,o.fecha_reparto,23) AS fecha_reparto,
             d.nombre AS distrito, m.nombre AS motorizado,
             o.dest_nombre, o.estado, o.metodo_pago, o.medio_pago, o.pago_velox, o.pago_velox_metodo,
             o.delivery_total, o.monto_adicional, o.monto_cobrado, o.monto_producto,
             o.pago_moto_total, o.producto_especial, o.id_motorizado,
             (SELECT TOP 1 url FROM ordenes_fotos WHERE id_orden = o.id AND tipo = 'foto_producto' ORDER BY subido_en DESC) AS foto_producto_url
      FROM ordenes o
      JOIN distritos d ON d.id = o.id_distrito
      LEFT JOIN motorizados m ON m.id = o.id_motorizado
      WHERE o.id_tienda = @id AND o.estado <> 'anulado'
    `;
    const request = pool.request().input('id', sql.Int, req.params.id);
    if (desde && hasta) {
      query += ` AND o.fecha_reparto BETWEEN @desde AND @hasta`;
      request.input('desde', sql.Date, desde);
      request.input('hasta', sql.Date, hasta);
    } else if (fecha) {
      query += ` AND o.fecha_reparto = @fecha`;
      request.input('fecha', sql.Date, fecha);
    }
    query += ` ORDER BY o.fecha_reparto DESC, o.id`;
    const [result, pagados] = await Promise.all([
      request.query(query),
      pool.request().input('id', sql.Int, req.params.id).query(`
        SELECT CONVERT(varchar, fecha_ciclo, 23) AS dia, CONVERT(varchar, fecha_pago, 23) AS fecha_pago
        FROM caja_pagos_tiendas WHERE id_tienda = @id AND pagado = 1`),
    ]);
    /* La plata de cada orden, del motor de la Caja (lo mismo que Caja →
       Tienda, el reporte en imagen y el WhatsApp): el navegador solo suma
       y pinta. caja.fecha_pago = el día de esa orden ya se liquidó. */
    const pagoDe = new Map(pagados.recordset.map(p => [p.dia, p.fecha_pago]));
    res.json(result.recordset.map(o => {
      const c = calcularOrdenCaja(o);
      const { medio_pago, pago_velox, pago_velox_metodo, id_motorizado, ...resto } = o;
      return {
        ...resto,
        medio_pago,
        caja: {
          cobrable: c.cobrable, prepago: c.es_prepago,
          delivery: aSoles(c.delivery), retenido: aSoles(c.retenido), saldo: aSoles(c.saldo_tienda),
          fecha_pago: pagoDe.get(o.fecha_reparto) || null,
        },
      };
    }));
  } catch (err) {
    console.error('GET /tiendas/:id/ordenes:', err.message);
    res.status(500).json({ error: 'Error al listar las órdenes de la tienda' });
  }
});

module.exports = router;
