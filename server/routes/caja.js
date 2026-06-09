/* ============================================================
   routes/caja.js
   ============================================================ */
const express = require('express');
const router  = express.Router();
const { getPool, sql } = require('../db');

/* GET /api/caja/tiendas?desde=YYYY-MM-DD&hasta=YYYY-MM-DD */
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

    /* Estados con cobro: entregado, ausente
       Usamos delivery_base + monto_adicional porque delivery_total es columna calculada */
    const result = await request.query(`
      SELECT
        t.id,
        t.nombre        AS tienda,
        t.ciclo_pago,
        CONVERT(varchar, o.fecha, 23) AS fecha,
        SUM(CASE WHEN o.estado IN ('entregado','ausente')
                 THEN (o.delivery_base + o.monto_adicional) ELSE 0 END)  AS delivery_cobrable,
        SUM(CASE WHEN o.estado IN ('entregado','ausente')
                 THEN o.monto_cobrado ELSE 0 END)                         AS cobrado,
        SUM(CASE WHEN o.estado IN ('entregado','ausente')
                 THEN (o.delivery_base + o.monto_adicional) ELSE 0 END)
        - SUM(CASE WHEN o.estado IN ('entregado','ausente')
                   THEN o.monto_cobrado ELSE 0 END)                       AS saldo_neto,
        ISNULL(cp.pagado, 0)                                               AS pagado,
        cp.fecha_pago
      FROM ordenes o
      JOIN tiendas t ON t.id = o.id_tienda
      LEFT JOIN caja_pagos_tiendas cp
             ON cp.id_tienda = t.id AND cp.fecha_ciclo = o.fecha
      ${where}
      GROUP BY t.id, t.nombre, t.ciclo_pago, o.fecha, cp.pagado, cp.fecha_pago
      HAVING SUM(CASE WHEN o.estado IN ('entregado','ausente')
                      THEN (o.delivery_base + o.monto_adicional) ELSE 0 END) > 0
      ORDER BY t.nombre, o.fecha DESC
    `);

    res.json(result.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* POST /api/caja/tiendas/pagar — Marcar pago de tienda */
router.post('/tiendas/pagar', async (req, res) => {
  try {
    const pool = await getPool();
    const { id_tienda, fecha } = req.body;

    await pool.request()
      .input('id_tienda',   sql.Int,  id_tienda)
      .input('fecha_ciclo', sql.Date, fecha)
      .execute('sp_marcar_pago_tienda');

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* GET /api/caja/liquidez?desde=YYYY-MM-DD&hasta=YYYY-MM-DD */
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
        COUNT(*)                       AS pedidos,
        SUM(CASE WHEN o.estado IN ('entregado','ausente')
                 THEN (o.delivery_base + o.monto_adicional) ELSE 0 END)       AS bruto,
        SUM(CASE WHEN o.estado IN ('entregado','ausente')
                 THEN (o.pago_moto_base + o.pago_moto_adicional) ELSE 0 END)  AS pago_motorizados,
        /* Devolución = cuando cobrado > delivery (exceso que se devuelve a la tienda) */
        SUM(CASE WHEN o.estado IN ('entregado','ausente')
                      AND o.monto_cobrado > (o.delivery_base + o.monto_adicional)
                 THEN o.monto_cobrado - (o.delivery_base + o.monto_adicional)
                 ELSE 0 END)                                                   AS devoluciones,
        /* Líquido neto = Bruto - Pago motos - Devoluciones */
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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* GET /api/caja/motorizados */
router.get('/motorizados', async (req, res) => {
  try {
    const pool   = await getPool();
    /* Solo estados con cobro: entregado, ausente
       Usamos pago_moto_base + pago_moto_adicional porque pago_moto_total es columna calculada */
    const result = await pool.request().query(`
      SELECT
        m.id                                                   AS id_motorizado,
        m.nombre                                               AS motorizado,
        CONVERT(varchar, o.fecha, 23)                          AS fecha,
        SUM(CASE WHEN o.estado='entregado' THEN 1 ELSE 0 END)  AS entregas,
        SUM(CASE WHEN o.estado IN ('entregado','ausente')
                 THEN (o.pago_moto_base + o.pago_moto_adicional) ELSE 0 END)  AS pago_moto,
        SUM(CASE WHEN o.estado IN ('entregado','ausente')
                 THEN o.monto_cobrado ELSE 0 END)                              AS cobrado,
        ISNULL(cm.pagado, 0)                                                   AS pagado,
        cm.fecha_pago
      FROM ordenes o
      JOIN motorizados m ON m.id = o.id_motorizado
      LEFT JOIN caja_pagos_motorizados cm
             ON cm.id_motorizado = m.id AND cm.fecha_dia = o.fecha
      WHERE o.id_motorizado IS NOT NULL
      GROUP BY m.id, m.nombre, o.fecha, cm.pagado, cm.fecha_pago
      HAVING SUM(CASE WHEN o.estado IN ('entregado','ausente')
                      THEN (o.pago_moto_base + o.pago_moto_adicional) ELSE 0 END) > 0
          OR SUM(CASE WHEN o.estado IN ('entregado','ausente')
                      THEN o.monto_cobrado ELSE 0 END) > 0
      ORDER BY m.nombre, o.fecha DESC
    `);
    res.json(result.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* POST /api/caja/motorizados/pagar — Marcar pago a motorizado */
router.post('/motorizados/pagar', async (req, res) => {
  try {
    const pool = await getPool();
    const { id_motorizado, fecha } = req.body;

    await pool.request()
      .input('id_moto',   sql.Int,  id_motorizado)
      .input('fecha_dia', sql.Date, fecha)
      .query(`
        IF EXISTS (SELECT 1 FROM caja_pagos_motorizados WHERE id_motorizado=@id_moto AND fecha_dia=@fecha_dia)
          UPDATE caja_pagos_motorizados SET pagado=1, fecha_pago=GETDATE()
          WHERE id_motorizado=@id_moto AND fecha_dia=@fecha_dia;
        ELSE
          INSERT INTO caja_pagos_motorizados (id_motorizado, fecha_dia, total_entregas, monto_a_pagar, monto_cobrado, pagado, fecha_pago)
          SELECT @id_moto, @fecha_dia,
            SUM(CASE WHEN estado='entregado' THEN 1 ELSE 0 END),
            SUM(CASE WHEN estado IN ('entregado','ausente') THEN pago_moto_total ELSE 0 END),
            SUM(CASE WHEN estado IN ('entregado','ausente') THEN monto_cobrado ELSE 0 END),
            1, GETDATE()
          FROM ordenes WHERE id_motorizado=@id_moto AND fecha=@fecha_dia;
      `);

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
