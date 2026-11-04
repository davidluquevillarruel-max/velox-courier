/* ============================================================
   routes/caja.js
   Protegido: TODO el módulo de caja es solo para gestores
   (admin / operador). Tiendas y motorizados no acceden aquí.

   El "día" de la caja es la FECHA DE REPARTO (ordenes.fecha_reparto,
   ver velox_agregar_fecha_reparto.sql), no la de creación: entrega
   del día = cobro del día. En las respuestas, "fecha" es ese día; las
   marcas de pagado (caja_pagos_tiendas.fecha_ciclo /
   caja_pagos_motorizados.fecha_dia) también lo son.
   ============================================================ */
const express = require('express');
const router  = express.Router();
const { getPool, sql } = require('../db');
const { requireAuth, requireRol } = require('../middleware/auth');

/* Caja maneja dinero: solo admin y operador, sin excepción */
router.use(requireAuth);
router.use(requireRol('admin', 'operador'));

/* ════════════════════════════════════════════════════════════
   CAJA TIENDA
   Por pedido, en su fecha_reparto. Solo entran los estados
   cobrables (entregado / ausente / devolucion); el resto
   (en-proceso, reprogramado, no-entregado, cancelado) no suma.
   · delivery = delivery_total (delivery_base + monto_adicional)
   · retenido = monto_cobrado SOLO si se entregó en contraentrega y
     la plata la tiene Velox (Pago Velox, Yape o efectivo al moto);
     con "Pago tienda" o medio por definir, 0.
   · Postpago: saldo = delivery − retenido.
     Prepago (pago_velox = 'PAGADO'): el delivery ya se pagó en
     oficina, saldo = − retenido.
   saldo > 0 la tienda nos debe · < 0 le debemos · = 0 saldado.
   "Pagado" sigue siendo por tienda y por día
   (caja_pagos_tiendas.fecha_ciclo = fecha de reparto).
   ════════════════════════════════════════════════════════════ */
const ESTADOS_COBRABLES_TIENDA = ['entregado', 'ausente', 'devolucion'];
const MEDIOS_QUE_RETIENE_VELOX = ['pago-empresa', 'yape-motorizado', 'efectivo-motorizado'];

/* Única función que calcula la plata de una orden en la Caja Tienda.
   Trabaja en céntimos (enteros) para que las sumas no arrastren
   errores de coma flotante; aSoles() los pasa a soles al responder. */
function calcularCajaTienda(o) {
  const centimos = v => Math.round((Number(v) || 0) * 100);
  const prepago  = o.pago_velox === 'PAGADO';
  const delivery = centimos(o.delivery_total);
  const retenido = (o.estado === 'entregado' && o.metodo_pago === 'contraentrega' &&
                    MEDIOS_QUE_RETIENE_VELOX.includes(o.medio_pago))
    ? centimos(o.monto_cobrado) : 0;
  return { prepago, delivery, retenido, saldo: (prepago ? 0 : delivery) - retenido };
}
const aSoles = c => c / 100;

/* Fecha de hoy en Lima ('YYYY-MM-DD'), como hoyEnLima() de
   routes/ordenes.js: GETDATE() del servidor (UTC) daba el día
   siguiente después de las 19:00 de Lima. */
function hoyEnLima() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
}

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

/* Filtro de fechas de la Caja Tienda. Solo "desde" = ese único día;
   solo "hasta" = hasta ese día; nada = todo. */
function filtroFechaTienda(request, desde, hasta) {
  if (desde) request.input('desde', sql.Date, desde);
  if (hasta) request.input('hasta', sql.Date, hasta);
  if (desde && hasta) return 'AND o.fecha_reparto BETWEEN @desde AND @hasta';
  if (desde)          return 'AND o.fecha_reparto = @desde';
  if (hasta)          return 'AND o.fecha_reparto <= @hasta';
  return '';
}

/* Órdenes cobrables del período (de una tienda o de todas), cada una
   con su cálculo y si su día ya está marcado pagado. */
async function ordenesCajaTienda(pool, { desde, hasta, idTienda }) {
  const request = pool.request();
  const filtroFecha = filtroFechaTienda(request, desde, hasta);
  let filtroTienda = '';
  if (idTienda) {
    request.input('id_tienda', sql.Int, idTienda);
    filtroTienda = 'AND o.id_tienda = @id_tienda';
  }
  const r = await request.query(`
    SELECT o.id, o.codigo, o.id_tienda, t.nombre AS tienda, t.ciclo_pago,
           CONVERT(varchar, o.fecha_reparto, 23) AS fecha,
           o.estado, o.metodo_pago, o.medio_pago, o.pago_velox,
           o.delivery_total, o.monto_cobrado, o.dest_nombre,
           ISNULL(cp.pagado, 0) AS dia_pagado,
           CONVERT(varchar, cp.fecha_pago, 23) AS fecha_pago
    FROM ordenes o
    JOIN tiendas t ON t.id = o.id_tienda
    OUTER APPLY (SELECT TOP 1 c.pagado, c.fecha_pago FROM caja_pagos_tiendas c
                 WHERE c.id_tienda = o.id_tienda AND c.fecha_ciclo = o.fecha_reparto
                 ORDER BY c.pagado DESC) cp
    WHERE o.estado IN (${ESTADOS_COBRABLES_TIENDA.map(e => `'${e}'`).join(',')})
      ${filtroFecha} ${filtroTienda}
    ORDER BY t.nombre, o.fecha_reparto DESC, o.id DESC
  `);
  return r.recordset.map(o => ({ ...o, dia_pagado: !!o.dia_pagado, calc: calcularCajaTienda(o) }));
}

/* Pendientes (día sin marcar, por defecto) / pagados / todos */
function filtrarPorPago(ordenes, estado) {
  if (estado === 'todos')   return ordenes;
  if (estado === 'pagados') return ordenes.filter(o => o.dia_pagado);
  return ordenes.filter(o => !o.dia_pagado);
}

function leerFiltrosTienda(q) {
  const desde = FECHA_RE.test(q.desde || '') ? q.desde : '';
  const hasta = FECHA_RE.test(q.hasta || '') ? q.hasta : '';
  const estado = ['pendientes', 'pagados', 'todos'].includes(q.estado) ? q.estado : 'pendientes';
  return { desde, hasta, estado };
}

/* GET /api/caja/tiendas?desde=&hasta=&estado=pendientes|pagados|todos
   Resumen por tienda del período + KPIs. Los KPIs miran siempre lo
   PENDIENTE del período (lo que falta liquidar), sea cual sea el
   filtro de la lista. */
router.get('/tiendas', async (req, res) => {
  try {
    const pool = await getPool();
    const { desde, hasta, estado } = leerFiltrosTienda(req.query);
    const ordenes = await ordenesCajaTienda(pool, { desde, hasta });

    const porTienda = new Map();
    for (const o of ordenes) {
      if (!porTienda.has(o.id_tienda)) {
        porTienda.set(o.id_tienda, {
          id: o.id_tienda, tienda: o.tienda, ciclo_pago: o.ciclo_pago,
          pedidos: 0, delivery: 0, retenido: 0, saldo: 0,
          saldo_pendiente: 0, dias_pendientes: new Set(), dias_pagados: new Set(),
          ultimo_pago: null, visible: false,
        });
      }
      const t = porTienda.get(o.id_tienda);
      if (o.dia_pagado) {
        t.dias_pagados.add(o.fecha);
        if (o.fecha_pago && (!t.ultimo_pago || o.fecha_pago > t.ultimo_pago)) t.ultimo_pago = o.fecha_pago;
      } else {
        t.dias_pendientes.add(o.fecha);
        t.saldo_pendiente += o.calc.saldo;
      }
    }
    for (const o of filtrarPorPago(ordenes, estado)) {
      const t = porTienda.get(o.id_tienda);
      t.visible = true;
      t.pedidos  += 1;
      t.delivery += o.calc.delivery;
      t.retenido += o.calc.retenido;
      t.saldo    += o.calc.saldo;
    }

    let porCobrar = 0, porDevolver = 0, alDia = 0, conSaldo = 0;
    for (const t of porTienda.values()) {
      if (t.saldo_pendiente > 0)      { porCobrar   += t.saldo_pendiente; conSaldo++; }
      else if (t.saldo_pendiente < 0) { porDevolver -= t.saldo_pendiente; conSaldo++; }
      else alDia++;
    }

    const tiendas = [...porTienda.values()].filter(t => t.visible).map(t => ({
      id: t.id, tienda: t.tienda, ciclo_pago: t.ciclo_pago,
      pedidos: t.pedidos,
      delivery: aSoles(t.delivery), retenido: aSoles(t.retenido), saldo: aSoles(t.saldo),
      saldo_pendiente: aSoles(t.saldo_pendiente),
      dias_pendientes: t.dias_pendientes.size, dias_pagados: t.dias_pagados.size,
      estado: t.dias_pendientes.size ? 'pendiente' : 'pagado',
      ultimo_pago: t.ultimo_pago,
    }));

    res.json({
      kpis: {
        por_cobrar: aSoles(porCobrar), por_devolver: aSoles(porDevolver),
        posicion_neta: aSoles(porCobrar - porDevolver),
        al_dia: alDia, con_saldo: conSaldo,
      },
      tiendas,
    });
  } catch (err) {
    console.error('GET /caja/tiendas:', err.message);
    res.status(500).json({ error: 'Error al obtener la caja de tiendas' });
  }
});

/* GET /api/caja/tiendas/:id/detalle?desde=&hasta=&estado=
   Detalle por pedido de una tienda (mismo filtro que el resumen) +
   totales al pie. pago = PAGADO si el delivery ya se pagó: por
   adelantado en oficina (prepago) o porque su día ya se liquidó. */
router.get('/tiendas/:id/detalle', async (req, res) => {
  try {
    const idTienda = parseInt(req.params.id, 10);
    if (!idTienda) return res.status(400).json({ error: 'Tienda no válida' });
    const pool = await getPool();
    const { desde, hasta, estado } = leerFiltrosTienda(req.query);
    const ordenes = filtrarPorPago(await ordenesCajaTienda(pool, { desde, hasta, idTienda }), estado);

    const tot = { delivery: 0, retenido: 0, saldo: 0 };
    const pedidos = ordenes.map(o => {
      tot.delivery += o.calc.delivery;
      tot.retenido += o.calc.retenido;
      tot.saldo    += o.calc.saldo;
      return {
        id: o.id, codigo: o.codigo, fecha: o.fecha, estado: o.estado,
        dest_nombre: o.dest_nombre, metodo_pago: o.metodo_pago, medio_pago: o.medio_pago,
        delivery: aSoles(o.calc.delivery), retenido: aSoles(o.calc.retenido), saldo: aSoles(o.calc.saldo),
        pago_oficina: o.calc.prepago ? 'pre' : 'post',
        pago: (o.calc.prepago || o.dia_pagado) ? 'PAGADO' : 'pendiente',
        dia_pagado: o.dia_pagado, fecha_pago: o.fecha_pago,
      };
    });

    res.json({
      pedidos,
      totales: {
        pedidos: pedidos.length,
        delivery: aSoles(tot.delivery), retenido: aSoles(tot.retenido), saldo: aSoles(tot.saldo),
      },
    });
  } catch (err) {
    console.error('GET /caja/tiendas/:id/detalle:', err.message);
    res.status(500).json({ error: 'Error al obtener el detalle de la tienda' });
  }
});

/* POST /api/caja/tiendas/pagar  { id_tienda, desde?, hasta? }
   Liquida los días PENDIENTES de la tienda en el período (mismo
   filtro de fechas que la lista). Por cada día guarda lo que se
   cobra y lo que se devuelve, con la misma calcularCajaTienda().
   fecha_pago = hoy en Lima. */
router.post('/tiendas/pagar', async (req, res) => {
  const idTienda = parseInt(req.body.id_tienda, 10);
  if (!idTienda) return res.status(400).json({ error: 'Falta la tienda' });
  const { desde, hasta } = leerFiltrosTienda(req.body);

  let tx;
  try {
    const pool = await getPool();
    const pendientes = filtrarPorPago(await ordenesCajaTienda(pool, { desde, hasta, idTienda }), 'pendientes');
    if (!pendientes.length) {
      return res.status(400).json({ error: 'Esta tienda no tiene días pendientes en el período.' });
    }

    const porDia = new Map();
    for (const o of pendientes) {
      const d = porDia.get(o.fecha) || { cobrar: 0, devolver: 0 };
      if (o.calc.saldo > 0) d.cobrar   += o.calc.saldo;
      else                  d.devolver -= o.calc.saldo;
      porDia.set(o.fecha, d);
    }

    const hoy = hoyEnLima();
    tx = new sql.Transaction(pool);
    await tx.begin();
    for (const [fecha, d] of porDia) {
      await new sql.Request(tx)
        .input('id_tienda',      sql.Int,           idTienda)
        .input('fecha_ciclo',    sql.Date,          fecha)
        .input('monto_cobrar',   sql.Decimal(10,2), aSoles(d.cobrar))
        .input('monto_devolver', sql.Decimal(10,2), aSoles(d.devolver))
        .input('hoy',            sql.Date,          hoy)
        .query(`
          IF EXISTS (
            SELECT 1 FROM caja_pagos_tiendas
            WHERE id_tienda = @id_tienda AND fecha_ciclo = @fecha_ciclo
          )
            UPDATE caja_pagos_tiendas
            SET pagado = 1, fecha_pago = @hoy,
                monto_cobrar = @monto_cobrar, monto_devolver = @monto_devolver
            WHERE id_tienda = @id_tienda AND fecha_ciclo = @fecha_ciclo;
          ELSE
            INSERT INTO caja_pagos_tiendas
              (id_tienda, fecha_ciclo, monto_cobrar, monto_devolver, pagado, fecha_pago)
            VALUES
              (@id_tienda, @fecha_ciclo, @monto_cobrar, @monto_devolver, 1, @hoy);
        `);
    }
    await tx.commit();

    res.json({ ok: true, dias: porDia.size, fecha_pago: hoy });
  } catch (err) {
    if (tx) { try { await tx.rollback(); } catch (_) { /* ya cerrada */ } }
    console.error('POST /caja/tiendas/pagar:', err.message);
    res.status(500).json({ error: 'Error al registrar el pago' });
  }
});


/* GET /api/caja/liquidez?desde=&hasta= */
router.get('/liquidez', async (req, res) => {
  try {
    const pool = await getPool();
    const { desde, hasta } = req.query;

    let where = '';
    if (desde && hasta) where = `WHERE o.fecha_reparto BETWEEN @desde AND @hasta`;
    else if (desde)     where = `WHERE o.fecha_reparto >= @desde`;
    else if (hasta)     where = `WHERE o.fecha_reparto <= @hasta`;

    const request = pool.request();
    if (desde) request.input('desde', sql.Date, desde);
    if (hasta) request.input('hasta', sql.Date, hasta);

    const result = await request.query(`
      SELECT
        CONVERT(varchar, o.fecha_reparto, 23) AS fecha,
        COUNT(*) AS pedidos,
        SUM(CASE WHEN o.estado IN ('entregado','ausente')
                 THEN (o.delivery_base + o.monto_adicional) ELSE 0 END)       AS bruto,
        SUM(CASE WHEN o.estado IN ('entregado','ausente')
                 THEN (o.pago_moto_base + o.pago_moto_adicional) ELSE 0 END)  AS pago_motorizados,
        SUM(CASE WHEN o.estado IN ('entregado','ausente')
                      AND o.monto_cobrado > (o.delivery_base + o.monto_adicional)
                 THEN o.monto_cobrado - (o.delivery_base + o.monto_adicional)
                 ELSE 0 END)                                                   AS devoluciones,
        SUM(CASE WHEN o.estado IN ('entregado','ausente')
                 THEN (o.delivery_base + o.monto_adicional) ELSE 0 END)
        - SUM(CASE WHEN o.estado IN ('entregado','ausente')
                   THEN (o.pago_moto_base + o.pago_moto_adicional) ELSE 0 END)
        - SUM(CASE WHEN o.estado IN ('entregado','ausente')
                        AND o.monto_cobrado > (o.delivery_base + o.monto_adicional)
                   THEN o.monto_cobrado - (o.delivery_base + o.monto_adicional)
                   ELSE 0 END)                                                 AS liquido_neto
      FROM ordenes o
      ${where}
      GROUP BY o.fecha_reparto
      ORDER BY o.fecha_reparto DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error('GET /caja/liquidez:', err.message);
    res.status(500).json({ error: 'Error al obtener la liquidez' });
  }
});

/* GET /api/caja/real?desde=&hasta=
   Caja real: plata que YA cambió de mano (solo cuenta lo marcado "pagado"
   en caja_pagos_tiendas / caja_pagos_motorizados). A diferencia de
   /liquidez (que es teórico y no mira el estado de pago), este número
   cambia exactamente cuando se marca algo como pagado. */
router.get('/real', async (req, res) => {
  try {
    const pool = await getPool();
    const { desde, hasta } = req.query;

    let filtroTiendas = '';
    let filtroMotos   = '';
    let filtroPrepago = '';
    const request = pool.request();
    if (desde && hasta) {
      filtroTiendas = 'AND cp.fecha_ciclo BETWEEN @desde AND @hasta';
      filtroMotos   = 'AND cm.fecha_dia BETWEEN @desde AND @hasta';
      filtroPrepago = 'AND o.fecha_reparto BETWEEN @desde AND @hasta';
      request.input('desde', sql.Date, desde);
      request.input('hasta', sql.Date, hasta);
    } else if (desde) {
      filtroTiendas = 'AND cp.fecha_ciclo >= @desde';
      filtroMotos   = 'AND cm.fecha_dia >= @desde';
      filtroPrepago = 'AND o.fecha_reparto >= @desde';
      request.input('desde', sql.Date, desde);
    } else if (hasta) {
      filtroTiendas = 'AND cp.fecha_ciclo <= @hasta';
      filtroMotos   = 'AND cm.fecha_dia <= @hasta';
      filtroPrepago = 'AND o.fecha_reparto <= @hasta';
      request.input('hasta', sql.Date, hasta);
    }

    const result = await request.query(`
      SELECT
        ISNULL((SELECT SUM(monto_cobrar - monto_devolver)
                FROM caja_pagos_tiendas cp
                WHERE cp.pagado = 1 ${filtroTiendas}), 0) AS neto_tiendas,
        ISNULL((SELECT SUM(monto_cobrado - monto_a_pagar)
                FROM caja_pagos_motorizados cm
                WHERE cm.pagado = 1 ${filtroMotos}), 0) AS neto_motorizados,
        /* Prepagos: plata que la tienda ya pagó en oficina al momento de
           despachar. No pasa por caja_pagos_tiendas (no es una deuda que
           se "marca pagada" después, ya entró en el momento), así que se
           suma directo desde ordenes — sin esto, Caja real quedaba corta
           en cada pedido pre-pagado. */
        ISNULL((SELECT SUM(o.delivery_base + o.monto_adicional)
                FROM ordenes o
                WHERE o.pago_velox = 'PAGADO' ${filtroPrepago}), 0) AS neto_prepago
    `);

    const r = result.recordset[0];
    const neto_tiendas      = parseFloat(r.neto_tiendas || 0);
    const neto_motorizados  = parseFloat(r.neto_motorizados || 0);
    const neto_prepago      = parseFloat(r.neto_prepago || 0);
    res.json({
      neto_tiendas,
      neto_motorizados,
      neto_prepago,
      caja_real: neto_tiendas + neto_motorizados + neto_prepago,
    });
  } catch (err) {
    console.error('GET /caja/real:', err.message);
    res.status(500).json({ error: 'Error al calcular la caja real' });
  }
});

/* GET /api/caja/motorizados?desde=&hasta= */
router.get('/motorizados', async (req, res) => {
  try {
    const pool  = await getPool();
    const { desde, hasta } = req.query;

    let filtroFecha = '';
    const request = pool.request();
    if (desde && hasta) {
      filtroFecha = 'AND o.fecha_reparto BETWEEN @desde AND @hasta';
      request.input('desde', sql.Date, desde);
      request.input('hasta', sql.Date, hasta);
    } else if (desde) {
      filtroFecha = 'AND o.fecha_reparto >= @desde';
      request.input('desde', sql.Date, desde);
    } else if (hasta) {
      filtroFecha = 'AND o.fecha_reparto <= @hasta';
      request.input('hasta', sql.Date, hasta);
    }

    const result = await request.query(`
      SELECT
        m.id AS id_motorizado, m.nombre AS motorizado,
        CONVERT(varchar, o.fecha_reparto, 23) AS fecha,
        SUM(CASE WHEN o.estado='entregado' THEN 1 ELSE 0 END) AS entregas,
        SUM(CASE WHEN o.estado IN ('entregado','ausente')
                 THEN (o.pago_moto_base + o.pago_moto_adicional) ELSE 0 END)  AS pago_moto,
        SUM(CASE WHEN o.estado IN ('entregado','ausente')
                 THEN o.monto_cobrado ELSE 0 END)                              AS cobrado,
        ISNULL(cm.pagado, 0) AS pagado,
        CONVERT(varchar, cm.fecha_pago, 23) AS fecha_pago
      FROM ordenes o
      JOIN motorizados m ON m.id = o.id_motorizado
      LEFT JOIN caja_pagos_motorizados cm
             ON cm.id_motorizado = m.id AND cm.fecha_dia = o.fecha_reparto
      WHERE o.id_motorizado IS NOT NULL ${filtroFecha}
      GROUP BY m.id, m.nombre, o.fecha_reparto, cm.pagado, cm.fecha_pago
      HAVING SUM(CASE WHEN o.estado IN ('entregado','ausente')
                      THEN (o.pago_moto_base + o.pago_moto_adicional) ELSE 0 END) > 0
          OR SUM(CASE WHEN o.estado IN ('entregado','ausente')
                      THEN o.monto_cobrado ELSE 0 END) > 0
      ORDER BY m.nombre, o.fecha_reparto DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error('GET /caja/motorizados:', err.message);
    res.status(500).json({ error: 'Error al obtener la caja de motorizados' });
  }
});

/* POST /api/caja/motorizados/pagar */
router.post('/motorizados/pagar', async (req, res) => {
  try {
    const pool = await getPool();
    const { id_motorizado, fecha } = req.body;

    await pool.request()
      .input('id_moto',   sql.Int,  id_motorizado)
      .input('fecha_dia', sql.Date, fecha)
      .query(`
        IF EXISTS (SELECT 1 FROM caja_pagos_motorizados WHERE id_motorizado=@id_moto AND fecha_dia=@fecha_dia)
          UPDATE caja_pagos_motorizados
          SET pagado=1, fecha_pago=CAST(GETDATE() AS DATE)
          WHERE id_motorizado=@id_moto AND fecha_dia=@fecha_dia;
        ELSE
          INSERT INTO caja_pagos_motorizados
            (id_motorizado, fecha_dia, total_entregas, monto_a_pagar, monto_cobrado, pagado, fecha_pago)
          SELECT
            @id_moto, @fecha_dia,
            SUM(CASE WHEN estado='entregado' THEN 1 ELSE 0 END),
            SUM(CASE WHEN estado IN ('entregado','ausente') THEN (pago_moto_base + pago_moto_adicional) ELSE 0 END),
            SUM(CASE WHEN estado IN ('entregado','ausente') THEN monto_cobrado ELSE 0 END),
            1, CAST(GETDATE() AS DATE)
          FROM ordenes
          WHERE id_motorizado=@id_moto AND fecha_reparto=@fecha_dia;
      `);

    res.json({ ok: true });
  } catch (err) {
    console.error('POST /caja/motorizados/pagar:', err.message);
    res.status(500).json({ error: 'Error al registrar el pago' });
  }
});

module.exports = router;
