/* ============================================================
   routes/motorizados.js
   Protegido: requiere sesión. Escritura solo para gestores.
   Un motorizado solo consulta sus propias órdenes.
   ============================================================ */
const express = require('express');
const router  = express.Router();
const { getPool, sql } = require('../db');
const { requireAuth, requireRol } = require('../middleware/auth');
const { calcularOrdenCaja, aSoles } = require('../caja-motor');

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

/* Busca el id de la zona por nombre. Sin zona → null (permitido).
   Una zona que no existe devuelve undefined: antes se guardaba vacía
   sin avisar (pasó con "Norte" y "Este" sueltos, que en la BD son una
   sola zona "Norte/Este"), y el motorizado quedaba fuera del
   autoasignar de su zona. */
async function idDeZona(pool, zona) {
  if (!zona) return null;
  const z = await pool.request()
    .input('zona', sql.NVarChar, zona)
    .query(`SELECT id FROM zonas WHERE nombre = @zona`);
  return z.recordset.length > 0 ? z.recordset[0].id : undefined;
}

/* POST /api/motorizados — solo gestores */
router.post('/', requireRol(...GESTORES), async (req, res) => {
  try {
    const pool = await getPool();
    const m    = req.body;
    const id_zona = await idDeZona(pool, m.zona);
    if (id_zona === undefined) return res.status(400).json({ error: 'Zona no válida' });
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
    const id_zona = await idDeZona(pool, m.zona);
    if (id_zona === undefined) return res.status(400).json({ error: 'Zona no válida' });
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
    /* Un moto que solo RECIBIÓ pedidos de reasignación (y los rechazó)
       no tiene órdenes, pero las filas de reasignaciones lo referencian:
       sin esto, el DELETE daría un 500 por la FK */
    const checkReasig = await pool.request()
      .input('id', sql.Int, req.params.id)
      .query(`SELECT COUNT(*) AS total FROM reasignaciones WHERE id_motorizado_de = @id OR id_motorizado_para = @id`);
    if (checkReasig.recordset[0].total > 0) {
      return res.status(400).json({
        error: `No se puede eliminar: este motorizado tiene ${checkReasig.recordset[0].total} pedido(s) de reasignación registrado(s). Usa la opción de desactivar en su lugar.`
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
    /* El día de trabajo del motorizado es la fecha de reparto
       (ordenes.fecha_reparto = fecha_asignacion o, si no tiene, la de
       creación; ver velox_agregar_fecha_reparto.sql). "fecha" sigue
       siendo la de creación, como dato histórico. */
    let query = `
      SELECT o.id, o.codigo, CONVERT(varchar,o.fecha,23) AS fecha,
             CONVERT(varchar, o.fecha_reparto, 23) AS fecha_trabajo,
             t.nombre AS tienda, d.nombre AS distrito,
             o.dest_nombre, o.dest_telefono, o.dest_telefono_2, o.estado, o.metodo_pago,
             o.medio_pago, o.pago_velox, o.pago_velox_metodo, o.id_motorizado,
             o.delivery_total, o.monto_cobrado, o.monto_producto,
             o.pago_moto_total, o.monto_adicional, o.producto_especial,
             /* Mismo cálculo que SELECT_ORDEN en routes/ordenes.js */
             CASE WHEN o.medio_pago IN ('pago-tienda', 'pago-empresa')
                   AND NOT EXISTS (SELECT 1 FROM ordenes_fotos WHERE id_orden = o.id AND tipo = 'evidencia_medio_pago')
                  THEN 1 ELSE 0 END AS evidencia_pendiente
      FROM ordenes o
      JOIN tiendas   t ON t.id = o.id_tienda
      JOIN distritos d ON d.id = o.id_distrito
      WHERE o.id_motorizado = @id AND o.estado <> 'anulado'
    `;
    /* Un período (desde + hasta, la vista agrupada del detalle de
       "Gestión / Motorizado"); si no, un día ("fecha") o todo */
    const FECHA_OK = /^\d{4}-\d{2}-\d{2}$/;
    const desde = FECHA_OK.test(req.query.desde || '') ? req.query.desde : '';
    const hasta = FECHA_OK.test(req.query.hasta || '') ? req.query.hasta : '';
    const porRango = !!(desde && hasta);
    if (porRango) query += ` AND o.fecha_reparto BETWEEN @desde AND @hasta`;
    else if (fecha) query += ` AND o.fecha_reparto = @fecha`;
    /* Por día (el más reciente arriba) y, dentro del día, la última
       asignada arriba (asignada_en, hora de Lima). Las que no tienen
       hora (anteriores a la columna) van al final del día, por id. */
    query += ` ORDER BY o.fecha_reparto DESC, o.asignada_en DESC, o.id DESC`;
    /* El motorizado: siempre el id del token (arriba ya se frenó otro id) */
    const idMoto = req.usuario.rol === 'motorizado' ? req.usuario.id_motorizado : parseInt(req.params.id, 10);
    const request = pool.request().input('id', sql.Int, idMoto);
    if (porRango) request.input('desde', sql.Date, desde).input('hasta', sql.Date, hasta);
    else if (fecha) request.input('fecha', sql.Date, fecha);
    const result = await request.query(query);
    /* La plata de cada orden sale del motor de la Caja (calcularOrdenCaja),
       la misma cuenta que Caja → Motorizados. Antes el navegador tomaba el
       "por cobrar" de toda orden entregada o ausente como si el moto lo
       hubiera cobrado (también un ausente, un Pago tienda o un Pago Velox).
       caja.* va en soles:
         en_mano (efectivo + yape) = lo que el moto tuvo en la mano
         pago_moto = su delivery (entregado / ausente / devolución)
         saldo_moto = en_mano − pago_moto: > 0 le debe a Velox, < 0 Velox le debe */
    res.json(result.recordset.map(o => {
      const c = calcularOrdenCaja(o);
      return {
        ...o,
        caja: {
          cobrable: c.cobrable,
          delivery: aSoles(c.delivery),
          en_mano_efectivo: aSoles(c.en_mano_efectivo),
          en_mano_yape: aSoles(c.en_mano_yape),
          en_mano: aSoles(c.en_mano_moto),
          directo_velox: aSoles(c.directo_velox),
          pago_moto: aSoles(c.pago_moto),
          saldo_moto: aSoles(c.saldo_moto),
          medio_por_definir: c.medio_por_definir,
        },
      };
    }));
  } catch (err) {
    console.error('GET /motorizados/:id/ordenes:', err.message);
    res.status(500).json({ error: 'Error al listar las órdenes del motorizado' });
  }
});

module.exports = router;
