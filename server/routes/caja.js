/* ============================================================
   routes/caja.js
   Protegido: TODO el módulo de caja es solo para gestores
   (admin / operador). Tiendas y motorizados no acceden aquí.
   ============================================================ */
const express = require('express');
const router  = express.Router();
const { getPool, sql } = require('../db');
const { requireAuth, requireRol } = require('../middleware/auth');

/* Caja maneja dinero: solo admin y operador, sin excepción */
router.use(requireAuth);
router.use(requireRol('admin', 'operador'));

/* GET /api/caja/tiendas?desde=&hasta= */
router.get('/tiendas', async (req, res) => {
  try {
    const pool  = await getPool();
    const { desde, hasta } = req.query;

    let where = '';
    if (desde && hasta) where = `WHERE o.fecha BETWEEN @desde AND @hasta`;
    else if (desde)     where = `WHERE o.fecha >= @desde`;
    else if (hasta)     where = `WHERE o.fecha <= @hasta`;

    const request = pool.request();
    if (desde) request.input('desde', sql.Date, desde);
    if (hasta) request.input('hasta', sql.Date, hasta);

    const result = await request.query(`
      WITH base AS (
        SELECT
          o.id_tienda, o.fecha,
          /* Delivery cobrable: solo si aún no se pagó por adelantado en
             oficina (pago_velox). Si ya era PAGADO, ese delivery no
             vuelve a sumar acá — ya se cobró aparte. */
          CASE WHEN o.estado IN ('entregado','ausente') AND o.pago_velox <> 'PAGADO'
               THEN (o.delivery_base + o.monto_adicional) ELSE 0 END AS cobrable,
          /* Cobrado "efectivo": lo cobrado en la entrega, MÁS el caso
             especial de un Cancelado que ya estaba pre-pagado — ahí no
             se cobró nada, hay que devolverle a la tienda lo que
             adelantó, por eso entra como "cobrado" (da saldo negativo). */
          CASE
            WHEN o.estado IN ('entregado','ausente') THEN o.monto_cobrado
            WHEN o.estado = 'cancelado' AND o.pago_velox = 'PAGADO'
                 THEN (o.delivery_base + o.monto_adicional + o.monto_cobrado)
            ELSE 0
          END AS cobrado_ef
        FROM ordenes o
        ${where}
      )
      SELECT
        t.id, t.nombre AS tienda, t.ciclo_pago,
        CONVERT(varchar, b.fecha, 23) AS fecha,
        SUM(b.cobrable)                      AS delivery_cobrable,
        SUM(b.cobrado_ef)                    AS cobrado,
        SUM(b.cobrable) - SUM(b.cobrado_ef)  AS saldo_neto,
        ISNULL(cp.pagado, 0) AS pagado,
        CONVERT(varchar, cp.fecha_pago, 23) AS fecha_pago
      FROM base b
      JOIN tiendas t ON t.id = b.id_tienda
      LEFT JOIN caja_pagos_tiendas cp
             ON cp.id_tienda = t.id AND cp.fecha_ciclo = b.fecha
      GROUP BY t.id, t.nombre, t.ciclo_pago, b.fecha, cp.pagado, cp.fecha_pago
      HAVING SUM(b.cobrable) <> 0 OR SUM(b.cobrado_ef) <> 0
      ORDER BY t.nombre, b.fecha DESC
    `);

    res.json(result.recordset);
  } catch (err) {
    console.error('GET /caja/tiendas:', err.message);
    res.status(500).json({ error: 'Error al obtener la caja de tiendas' });
  }
});

/* POST /api/caja/tiendas/pagar */
router.post('/tiendas/pagar', async (req, res) => {
  try {
    const pool = await getPool();
    const { id_tienda, fecha } = req.body;

    if (!id_tienda || !fecha) {
      return res.status(400).json({ error: 'Faltan id_tienda o fecha' });
    }

    const totales = await pool.request()
      .input('id_tienda',   sql.Int,  id_tienda)
      .input('fecha_ciclo', sql.Date, fecha)
      .query(`
        WITH base AS (
          SELECT
            CASE WHEN estado IN ('entregado','ausente') AND pago_velox <> 'PAGADO'
                 THEN (delivery_base + monto_adicional) ELSE 0 END AS cobrable,
            CASE
              WHEN estado IN ('entregado','ausente') THEN monto_cobrado
              WHEN estado = 'cancelado' AND pago_velox = 'PAGADO'
                   THEN (delivery_base + monto_adicional + monto_cobrado)
              ELSE 0
            END AS cobrado_ef
          FROM ordenes
          WHERE id_tienda = @id_tienda AND fecha = @fecha_ciclo
        )
        SELECT
          SUM(CASE WHEN cobrable > cobrado_ef THEN cobrable - cobrado_ef ELSE 0 END) AS monto_cobrar,
          SUM(CASE WHEN cobrado_ef > cobrable THEN cobrado_ef - cobrable ELSE 0 END) AS monto_devolver
        FROM base
      `);

    const t = totales.recordset[0];
    const monto_cobrar   = parseFloat(t.monto_cobrar   || 0);
    const monto_devolver = parseFloat(t.monto_devolver || 0);

    await pool.request()
      .input('id_tienda',      sql.Int,           id_tienda)
      .input('fecha_ciclo',    sql.Date,          fecha)
      .input('monto_cobrar',   sql.Decimal(10,2), monto_cobrar)
      .input('monto_devolver', sql.Decimal(10,2), monto_devolver)
      .query(`
        IF EXISTS (
          SELECT 1 FROM caja_pagos_tiendas
          WHERE id_tienda = @id_tienda AND fecha_ciclo = @fecha_ciclo
        )
          UPDATE caja_pagos_tiendas
          SET pagado = 1, fecha_pago = CAST(GETDATE() AS DATE),
              monto_cobrar = @monto_cobrar, monto_devolver = @monto_devolver
          WHERE id_tienda = @id_tienda AND fecha_ciclo = @fecha_ciclo;
        ELSE
          INSERT INTO caja_pagos_tiendas
            (id_tienda, fecha_ciclo, monto_cobrar, monto_devolver, pagado, fecha_pago)
          VALUES
            (@id_tienda, @fecha_ciclo, @monto_cobrar, @monto_devolver, 1, CAST(GETDATE() AS DATE));
      `);

    res.json({ ok: true });
  } catch (err) {
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
    if (desde && hasta) where = `WHERE o.fecha BETWEEN @desde AND @hasta`;
    else if (desde)     where = `WHERE o.fecha >= @desde`;
    else if (hasta)     where = `WHERE o.fecha <= @hasta`;

    const request = pool.request();
    if (desde) request.input('desde', sql.Date, desde);
    if (hasta) request.input('hasta', sql.Date, hasta);

    const result = await request.query(`
      SELECT
        CONVERT(varchar, o.fecha, 23) AS fecha,
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
      GROUP BY o.fecha
      ORDER BY o.fecha DESC
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
      filtroPrepago = 'AND o.fecha BETWEEN @desde AND @hasta';
      request.input('desde', sql.Date, desde);
      request.input('hasta', sql.Date, hasta);
    } else if (desde) {
      filtroTiendas = 'AND cp.fecha_ciclo >= @desde';
      filtroMotos   = 'AND cm.fecha_dia >= @desde';
      filtroPrepago = 'AND o.fecha >= @desde';
      request.input('desde', sql.Date, desde);
    } else if (hasta) {
      filtroTiendas = 'AND cp.fecha_ciclo <= @hasta';
      filtroMotos   = 'AND cm.fecha_dia <= @hasta';
      filtroPrepago = 'AND o.fecha <= @hasta';
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
      filtroFecha = 'AND o.fecha BETWEEN @desde AND @hasta';
      request.input('desde', sql.Date, desde);
      request.input('hasta', sql.Date, hasta);
    } else if (desde) {
      filtroFecha = 'AND o.fecha >= @desde';
      request.input('desde', sql.Date, desde);
    } else if (hasta) {
      filtroFecha = 'AND o.fecha <= @hasta';
      request.input('hasta', sql.Date, hasta);
    }

    const result = await request.query(`
      SELECT
        m.id AS id_motorizado, m.nombre AS motorizado,
        CONVERT(varchar, o.fecha, 23) AS fecha,
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
             ON cm.id_motorizado = m.id AND cm.fecha_dia = o.fecha
      WHERE o.id_motorizado IS NOT NULL ${filtroFecha}
      GROUP BY m.id, m.nombre, o.fecha, cm.pagado, cm.fecha_pago
      HAVING SUM(CASE WHEN o.estado IN ('entregado','ausente')
                      THEN (o.pago_moto_base + o.pago_moto_adicional) ELSE 0 END) > 0
          OR SUM(CASE WHEN o.estado IN ('entregado','ausente')
                      THEN o.monto_cobrado ELSE 0 END) > 0
      ORDER BY m.nombre, o.fecha DESC
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
          WHERE id_motorizado=@id_moto AND fecha=@fecha_dia;
      `);

    res.json({ ok: true });
  } catch (err) {
    console.error('POST /caja/motorizados/pagar:', err.message);
    res.status(500).json({ error: 'Error al registrar el pago' });
  }
});

module.exports = router;
