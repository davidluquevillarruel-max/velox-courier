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
const { r2Habilitado, generarUrlSubidaPagoTienda, esUrlDePagoTienda } = require('../r2');
const { guardarFoto, rutaArchivo, existeFoto } = require('../almacenamiento-local');
const { aCentimos, aSoles, filtroFecha, ordenesCaja } = require('../caja-motor');

/* Caja maneja dinero: solo admin y operador, sin excepción */
router.use(requireAuth);
router.use(requireRol('admin', 'operador'));

/* ════════════════════════════════════════════════════════════
   CAJA TIENDA
   La plata de cada orden la calcula server/caja-motor.js.
   "Pagado" sigue siendo por tienda y por día
   (caja_pagos_tiendas.fecha_ciclo = fecha de reparto).
   Pendiente = en vivo, con el motor. Día pagado = el saldo que se
   guardó al pagar (monto_cobrar − monto_devolver): no se recalcula.
   Si lo que da hoy no coincide, se avisa "Difiere de lo pagado".
   Delivery, retenido y el detalle por pedido van siempre en vivo,
   porque lo guardado es por día y solo tiene el saldo.
   ════════════════════════════════════════════════════════════ */

/* Fecha de hoy en Lima ('YYYY-MM-DD'), como hoyEnLima() de
   routes/ordenes.js: GETDATE() del servidor (UTC) daba el día
   siguiente después de las 19:00 de Lima. */
function hoyEnLima() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
}

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

/* Días pagados del período (de una tienda o de todas), con el saldo
   guardado en céntimos. Trae también los días que hoy ya no tienen
   órdenes cobrables: lo pagado no desaparece. */
async function diasPagadosTienda(pool, { desde, hasta, idTienda }) {
  const request = pool.request();
  const fFecha = filtroFecha(request, desde, hasta, 'cp.fecha_ciclo');
  let fTienda = '';
  if (idTienda) {
    request.input('id_tienda', sql.Int, idTienda);
    fTienda = 'AND cp.id_tienda = @id_tienda';
  }
  const r = await request.query(`
    SELECT cp.id_tienda, t.nombre AS tienda, t.ciclo_pago,
           CONVERT(varchar, cp.fecha_ciclo, 23) AS fecha,
           CONVERT(varchar, cp.fecha_pago, 23) AS fecha_pago,
           cp.monto_cobrar, cp.monto_devolver
    FROM caja_pagos_tiendas cp
    JOIN tiendas t ON t.id = cp.id_tienda
    WHERE cp.pagado = 1 ${fFecha} ${fTienda}
    ORDER BY cp.fecha_ciclo DESC
  `);
  return r.recordset.map(d => ({ ...d, saldo: aCentimos(d.monto_cobrar) - aCentimos(d.monto_devolver) }));
}

/* Lo que da hoy cada día pagado, para compararlo con lo guardado:
   Map 'idTienda|fecha' → céntimos */
function saldoVivoPorDia(ordenes) {
  const m = new Map();
  for (const o of ordenes) {
    if (!o.dia_pagado) continue;
    const k = `${o.id_tienda}|${o.fecha}`;
    m.set(k, (m.get(k) || 0) + o.calc.saldo_tienda);
  }
  return m;
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
    const ordenes = await ordenesCaja(pool, { desde, hasta });
    const diasPagados = await diasPagadosTienda(pool, { desde, hasta });

    const porTienda = new Map();
    const tiendaDe = (id, tienda, ciclo_pago) => {
      if (!porTienda.has(id)) {
        porTienda.set(id, {
          id, tienda, ciclo_pago,
          pedidos: 0, delivery: 0, retenido: 0, saldo: 0,
          saldo_pendiente: 0, dias_pendientes: new Set(), dias_pagados: new Set(),
          dias_difieren: 0, ultimo_pago: null, visible: false,
        });
      }
      return porTienda.get(id);
    };
    for (const o of ordenes) {
      const t = tiendaDe(o.id_tienda, o.tienda, o.ciclo_pago);
      if (!o.dia_pagado) {
        t.dias_pendientes.add(o.fecha);
        t.saldo_pendiente += o.calc.saldo_tienda;
      }
    }
    for (const o of filtrarPorPago(ordenes, estado)) {
      const t = porTienda.get(o.id_tienda);
      t.visible = true;
      t.pedidos  += 1;
      t.delivery += o.calc.delivery;
      t.retenido += o.calc.retenido;
      if (!o.dia_pagado) t.saldo += o.calc.saldo_tienda;
    }
    /* Días pagados: el saldo es el guardado */
    const vivo = saldoVivoPorDia(ordenes);
    for (const d of diasPagados) {
      const t = tiendaDe(d.id_tienda, d.tienda, d.ciclo_pago);
      t.dias_pagados.add(d.fecha);
      if (d.fecha_pago && (!t.ultimo_pago || d.fecha_pago > t.ultimo_pago)) t.ultimo_pago = d.fecha_pago;
      if (estado === 'pendientes') continue;
      t.visible = true;
      t.saldo += d.saldo;
      if ((vivo.get(`${d.id_tienda}|${d.fecha}`) || 0) !== d.saldo) t.dias_difieren++;
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
      dias_difieren: t.dias_difieren,
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
    const todas = await ordenesCaja(pool, { desde, hasta, idTienda });
    const ordenes = filtrarPorPago(todas, estado);

    const tot = { delivery: 0, retenido: 0, saldo: 0 };
    const pedidos = ordenes.map(o => {
      tot.delivery += o.calc.delivery;
      tot.retenido += o.calc.retenido;
      if (!o.dia_pagado) tot.saldo += o.calc.saldo_tienda;
      return {
        id: o.id, codigo: o.codigo, fecha: o.fecha, estado: o.estado,
        dest_nombre: o.dest_nombre, metodo_pago: o.metodo_pago, medio_pago: o.medio_pago,
        delivery: aSoles(o.calc.delivery), retenido: aSoles(o.calc.retenido), saldo: aSoles(o.calc.saldo_tienda),
        pago_oficina: o.calc.es_prepago ? 'pre' : 'post',
        pago: (o.calc.es_prepago || o.dia_pagado) ? 'PAGADO' : 'pendiente',
        dia_pagado: o.dia_pagado, fecha_pago: o.fecha_pago,
      };
    });

    /* Días pagados: el saldo de los totales es el guardado, y se avisa
       cuáles ya no coinciden con lo que dan hoy sus pedidos */
    const vivo = saldoVivoPorDia(todas);
    let dias_pagados = [];
    if (estado !== 'pendientes') {
      dias_pagados = (await diasPagadosTienda(pool, { desde, hasta, idTienda })).map(d => {
        const hoy = vivo.get(`${idTienda}|${d.fecha}`) || 0;
        tot.saldo += d.saldo;
        return {
          fecha: d.fecha, fecha_pago: d.fecha_pago,
          saldo_pagado: aSoles(d.saldo), saldo_hoy: aSoles(hoy), difiere: hoy !== d.saldo,
        };
      });
    }

    res.json({
      pedidos,
      dias_pagados,
      totales: {
        pedidos: pedidos.length,
        delivery: aSoles(tot.delivery), retenido: aSoles(tot.retenido), saldo: aSoles(tot.saldo),
      },
      /* "Pagados" / "Todos": los pagos registrados, con sus fotos */
      liquidaciones: estado === 'pendientes' ? [] : await liquidacionesDeTienda(pool, idTienda, desde, hasta),
    });
  } catch (err) {
    console.error('GET /caja/tiendas/:id/detalle:', err.message);
    res.status(500).json({ error: 'Error al obtener el detalle de la tienda' });
  }
});

/* Liquidaciones ("Marcar pagado") de una tienda que tocan algún día
   del período, con sus fotos. Los días pagados antes de que existieran
   las liquidaciones (id_liquidacion NULL) no aparecen acá. */
async function liquidacionesDeTienda(pool, idTienda, desde, hasta) {
  const request = pool.request().input('id_tienda', sql.Int, idTienda);
  const filtro = filtroFecha(request, desde, hasta, 'cp.fecha_ciclo');
  const r = await request.query(`
    SELECT l.id, CONVERT(varchar, l.fecha_pago, 23) AS fecha_pago, l.dias,
           l.monto_cobrar, l.monto_devolver, l.fotos_declaradas, u.nombre AS usuario,
           (SELECT CONVERT(varchar, MIN(x.fecha_ciclo), 23) FROM caja_pagos_tiendas x WHERE x.id_liquidacion = l.id) AS primer_dia,
           (SELECT CONVERT(varchar, MAX(x.fecha_ciclo), 23) FROM caja_pagos_tiendas x WHERE x.id_liquidacion = l.id) AS ultimo_dia
    FROM caja_liquidaciones_tiendas l
    LEFT JOIN usuarios u ON u.id = l.id_usuario
    WHERE l.id_tienda = @id_tienda
      AND EXISTS (SELECT 1 FROM caja_pagos_tiendas cp WHERE cp.id_liquidacion = l.id ${filtro})
    ORDER BY l.id DESC
  `);
  const liqs = r.recordset;
  if (!liqs.length) return [];

  const fotos = await pool.request().query(`
    SELECT id, id_liquidacion, url FROM caja_liquidaciones_tiendas_fotos
    WHERE id_liquidacion IN (${liqs.map(l => parseInt(l.id, 10)).join(',')}) AND url <> ''
    ORDER BY id
  `);
  return liqs.map(l => {
    const cobrar = Number(l.monto_cobrar), devolver = Number(l.monto_devolver);
    return {
      id: l.id, fecha_pago: l.fecha_pago, dias: l.dias, usuario: l.usuario,
      primer_dia: l.primer_dia, ultimo_dia: l.ultimo_dia,
      monto_cobrar: cobrar, monto_devolver: devolver, neto: Math.round((cobrar - devolver) * 100) / 100,
      fotos_declaradas: l.fotos_declaradas,
      fotos: fotos.recordset.filter(f => String(f.id_liquidacion) === String(l.id)).map(f => ({ id: f.id, url: f.url })),
    };
  });
}

const MAX_FOTOS_PAGO_TIENDA = 5;

/* POST /api/caja/tiendas/pagar  { id_tienda, desde?, hasta?, fotos }
   Liquida los días PENDIENTES de la tienda en el período (mismo
   filtro de fechas que la lista). Por cada día guarda lo que se
   cobra y lo que se devuelve, con el motor (caja-motor.js).
   fecha_pago = hoy en Lima.
   Crea la liquidación (caja_liquidaciones_tiendas) y le cuelga los
   días. fotos = cuántas fotos del pago se tomaron (1 a 5): las fotos
   NO vienen acá, entran después a la cola del teléfono y llegan por
   /tiendas/liquidaciones/:id/... (regla de fotos de CLAUDE.md). */
router.post('/tiendas/pagar', async (req, res) => {
  const idTienda = parseInt(req.body.id_tienda, 10);
  if (!idTienda) return res.status(400).json({ error: 'Falta la tienda' });
  const { desde, hasta } = leerFiltrosTienda(req.body);
  const fotos = Number(req.body.fotos);
  if (!Number.isInteger(fotos) || fotos < 1 || fotos > MAX_FOTOS_PAGO_TIENDA) {
    return res.status(400).json({ error: `Falta la foto del pago (de 1 a ${MAX_FOTOS_PAGO_TIENDA}).` });
  }

  let tx;
  try {
    const pool = await getPool();
    const pendientes = filtrarPorPago(await ordenesCaja(pool, { desde, hasta, idTienda }), 'pendientes');
    if (!pendientes.length) {
      return res.status(400).json({ error: 'Esta tienda no tiene días pendientes en el período.' });
    }

    const porDia = new Map();
    for (const o of pendientes) {
      const d = porDia.get(o.fecha) || { cobrar: 0, devolver: 0 };
      if (o.calc.saldo_tienda > 0) d.cobrar   += o.calc.saldo_tienda;
      else                         d.devolver -= o.calc.saldo_tienda;
      porDia.set(o.fecha, d);
    }

    let totCobrar = 0, totDevolver = 0;
    for (const d of porDia.values()) { totCobrar += d.cobrar; totDevolver += d.devolver; }

    const hoy = hoyEnLima();
    tx = new sql.Transaction(pool);
    await tx.begin();
    const liq = await new sql.Request(tx)
      .input('id_tienda',      sql.Int,           idTienda)
      .input('desde',          sql.Date,          desde || null)
      .input('hasta',          sql.Date,          hasta || null)
      .input('dias',           sql.Int,           porDia.size)
      .input('monto_cobrar',   sql.Decimal(10,2), aSoles(totCobrar))
      .input('monto_devolver', sql.Decimal(10,2), aSoles(totDevolver))
      .input('hoy',            sql.Date,          hoy)
      .input('fotos',          sql.Int,           fotos)
      .input('id_usuario',     sql.Int,           req.usuario.id)
      .query(`
        INSERT INTO caja_liquidaciones_tiendas
          (id_tienda, desde, hasta, dias, monto_cobrar, monto_devolver, fecha_pago, fotos_declaradas, id_usuario)
        OUTPUT INSERTED.id
        VALUES (@id_tienda, @desde, @hasta, @dias, @monto_cobrar, @monto_devolver, @hoy, @fotos, @id_usuario)
      `);
    const idLiquidacion = liq.recordset[0].id;

    for (const [fecha, d] of porDia) {
      /* Si otro usuario liquidó este día mientras tanto (UPDATE sin
         filas), se deshace todo: no se pisa un pago ya registrado */
      const r = await new sql.Request(tx)
        .input('id_tienda',      sql.Int,           idTienda)
        .input('fecha_ciclo',    sql.Date,          fecha)
        .input('monto_cobrar',   sql.Decimal(10,2), aSoles(d.cobrar))
        .input('monto_devolver', sql.Decimal(10,2), aSoles(d.devolver))
        .input('hoy',            sql.Date,          hoy)
        .input('id_liq',         sql.BigInt,        idLiquidacion)
        .query(`
          IF EXISTS (
            SELECT 1 FROM caja_pagos_tiendas WITH (UPDLOCK, HOLDLOCK)
            WHERE id_tienda = @id_tienda AND fecha_ciclo = @fecha_ciclo
          )
          BEGIN
            UPDATE caja_pagos_tiendas
            SET pagado = 1, fecha_pago = @hoy, id_liquidacion = @id_liq,
                monto_cobrar = @monto_cobrar, monto_devolver = @monto_devolver
            WHERE id_tienda = @id_tienda AND fecha_ciclo = @fecha_ciclo AND pagado = 0;
            SELECT @@ROWCOUNT AS filas;
          END
          ELSE
          BEGIN
            INSERT INTO caja_pagos_tiendas
              (id_tienda, fecha_ciclo, monto_cobrar, monto_devolver, pagado, fecha_pago, id_liquidacion)
            VALUES
              (@id_tienda, @fecha_ciclo, @monto_cobrar, @monto_devolver, 1, @hoy, @id_liq);
            SELECT 1 AS filas;
          END
        `);
      if (!r.recordset[0].filas) {
        const e = new Error('día ya pagado'); e.yaPagado = true; throw e;
      }
    }
    await tx.commit();

    res.json({ ok: true, dias: porDia.size, fecha_pago: hoy, id_liquidacion: idLiquidacion });
  } catch (err) {
    if (tx) { try { await tx.rollback(); } catch (_) { /* ya cerrada */ } }
    if (err.yaPagado || err.number === 2601 || err.number === 2627) {
      return res.status(409).json({ error: 'Otro usuario acaba de marcar pagado un día de esta tienda. Revisa y vuelve a intentar.' });
    }
    console.error('POST /caja/tiendas/pagar:', err.message);
    res.status(500).json({ error: 'Error al registrar el pago' });
  }
});

/* ════════════════════════════════════════════════════════════
   FOTOS DEL PAGO (liquidación de Caja Tienda)
   Las sube la MISMA cola de js/cola-fotos.js (encolarFotoPagoTienda),
   por las mismas tres rutas que las fotos de una orden, colgadas de
   la liquidación en vez de la orden:
   · R2 activo → /evidencia/presigned + PUT directo a R2 (carpeta
     pagos-tienda/liquidacion-<id>/) + /foto/registrar.
   · MODO PRUEBA → /foto/local (disco) y GET /foto/:fotoId la sirve.
   Reintentos sin duplicar por idSubida (índice único filtrado).
   Tope: MAX_FOTOS_PAGO_TIENDA por liquidación.
   ════════════════════════════════════════════════════════════ */
const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* null = no vino · false = vino mal · string = UUID en minúsculas
   (como leerIdSubida de routes/ordenes.js) */
function leerIdSubida(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  return (typeof valor === 'string' && REGEX_UUID.test(valor)) ? valor.toLowerCase() : false;
}

async function liquidacionExiste(pool, id) {
  const r = await pool.request()
    .input('id', sql.BigInt, id)
    .query('SELECT TOP 1 1 AS x FROM caja_liquidaciones_tiendas WHERE id = @id');
  return r.recordset.length > 0;
}

async function fotoPagoPorIdSubida(pool, idSubida) {
  if (!idSubida) return null;
  const r = await pool.request()
    .input('id_subida', sql.UniqueIdentifier, idSubida)
    .query(`SELECT id, CAST(id_liquidacion AS VARCHAR(20)) AS id_liquidacion, url
            FROM caja_liquidaciones_tiendas_fotos WHERE id_subida = @id_subida`);
  return r.recordset[0] || null;
}

async function topeFotosPago(pool, id) {
  const r = await pool.request()
    .input('id', sql.BigInt, id)
    .query('SELECT COUNT(*) AS total FROM caja_liquidaciones_tiendas_fotos WHERE id_liquidacion = @id');
  return r.recordset[0].total >= MAX_FOTOS_PAGO_TIENDA;
}

/* Inserta la foto; si otro reintento con el mismo idSubida ganó la
   carrera, devuelve esa */
async function registrarFotoPago(pool, id, url, idSubida) {
  try {
    const r = await pool.request()
      .input('id_liq',    sql.BigInt,           id)
      .input('url',       sql.NVarChar,         url)
      .input('id_subida', sql.UniqueIdentifier, idSubida || null)
      .query(`INSERT INTO caja_liquidaciones_tiendas_fotos (id_liquidacion, url, id_subida)
              OUTPUT INSERTED.id VALUES (@id_liq, @url, @id_subida)`);
    return { fotoId: r.recordset[0].id, nueva: true };
  } catch (err) {
    if (idSubida && (err.number === 2601 || err.number === 2627)) {
      const existente = await fotoPagoPorIdSubida(pool, idSubida);
      if (existente) return { fotoId: existente.id, nueva: false, existente };
    }
    throw err;
  }
}

/* Valida :id y que la liquidación exista; responde y devuelve null si no */
async function leerLiquidacion(req, res, pool) {
  const id = parseInt(req.params.id, 10);
  if (!id) { res.status(400).json({ error: 'Liquidación no válida' }); return null; }
  if (!(await liquidacionExiste(pool, id))) { res.status(404).json({ error: 'Liquidación no encontrada' }); return null; }
  return id;
}

/* POST /api/caja/tiendas/liquidaciones/:id/evidencia/presigned
   Body: { contentType, idSubida } */
router.post('/tiendas/liquidaciones/:id/evidencia/presigned', async (req, res) => {
  try {
    const pool = await getPool();
    const id = await leerLiquidacion(req, res, pool);
    if (!id) return;
    if (!r2Habilitado()) {
      return res.status(503).json({ error: 'El almacenamiento de fotos todavía no está configurado.' });
    }
    const idSubida = leerIdSubida(req.body.idSubida);
    if (idSubida === false) return res.status(400).json({ error: 'Identificador de subida no válido' });

    /* Un reintento de una foto ya registrada no rebota contra el tope */
    if (!(await fotoPagoPorIdSubida(pool, idSubida)) && await topeFotosPago(pool, id)) {
      return res.status(409).json({ error: `Este pago ya tiene ${MAX_FOTOS_PAGO_TIENDA} fotos` });
    }
    const { uploadUrl, publicUrl } = await generarUrlSubidaPagoTienda(id, req.body.contentType, idSubida);
    res.json({ uploadUrl, publicUrl });
  } catch (err) {
    console.error('POST /caja/tiendas/liquidaciones/:id/evidencia/presigned:', err.message);
    res.status(400).json({ error: err.message || 'Error al generar la URL de subida' });
  }
});

/* POST /api/caja/tiendas/liquidaciones/:id/foto/registrar
   Body: { url, idSubida } — URL ya subida a R2 */
router.post('/tiendas/liquidaciones/:id/foto/registrar', async (req, res) => {
  try {
    const pool = await getPool();
    const id = await leerLiquidacion(req, res, pool);
    if (!id) return;
    const idSubida = leerIdSubida(req.body.idSubida);
    if (idSubida === false) return res.status(400).json({ error: 'Identificador de subida no válido' });
    const { url } = req.body;
    if (!url || typeof url !== 'string' || url.length > 500 || !esUrlDePagoTienda(url, id)) {
      return res.status(400).json({ error: 'URL de foto no válida' });
    }

    const previa = await fotoPagoPorIdSubida(pool, idSubida);
    if (previa) {
      if (previa.id_liquidacion !== String(id)) {
        return res.status(409).json({ error: 'Ese identificador de subida ya se usó para otra foto' });
      }
      return res.json({ ok: true, fotoId: previa.id, url: previa.url, repetida: true });
    }
    if (await topeFotosPago(pool, id)) {
      return res.status(409).json({ error: `Este pago ya tiene ${MAX_FOTOS_PAGO_TIENDA} fotos` });
    }

    const reg = await registrarFotoPago(pool, id, url, idSubida);
    if (!reg.nueva) {
      if (reg.existente.id_liquidacion !== String(id)) {
        return res.status(409).json({ error: 'Ese identificador de subida ya se usó para otra foto' });
      }
      return res.json({ ok: true, fotoId: reg.fotoId, url: reg.existente.url, repetida: true });
    }
    res.status(201).json({ ok: true, fotoId: reg.fotoId, url });
  } catch (err) {
    console.error('POST /caja/tiendas/liquidaciones/:id/foto/registrar:', err.message);
    res.status(500).json({ error: 'Error al registrar la foto' });
  }
});

/* POST /api/caja/tiendas/liquidaciones/:id/foto/local?idSubida= — MODO PRUEBA
   (solo sin R2). El body es el JPEG. */
router.post('/tiendas/liquidaciones/:id/foto/local',
  express.raw({ type: 'image/jpeg', limit: '6mb' }),
  async (req, res) => {
    try {
      const pool = await getPool();
      if (r2Habilitado()) {
        return res.status(409).json({ error: 'R2 ya está configurado: la foto debe subirse a R2, no al disco local.' });
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'No llegó ninguna imagen (se espera un JPEG).' });
      }
      const id = await leerLiquidacion(req, res, pool);
      if (!id) return;
      const idSubida = leerIdSubida(req.query.idSubida);
      if (idSubida === false) return res.status(400).json({ error: 'Identificador de subida no válido' });

      const urlLocal = fotoId => `/api/caja/tiendas/liquidaciones/${id}/foto/${fotoId}`;
      let reg;
      const previa = await fotoPagoPorIdSubida(pool, idSubida);
      if (previa) {
        reg = { fotoId: previa.id, nueva: false, existente: previa };
      } else {
        if (await topeFotosPago(pool, id)) {
          return res.status(409).json({ error: `Este pago ya tiene ${MAX_FOTOS_PAGO_TIENDA} fotos` });
        }
        reg = await registrarFotoPago(pool, id, '', idSubida);
      }
      if (!reg.nueva) {
        if (reg.existente.id_liquidacion !== String(id)) {
          return res.status(409).json({ error: 'Ese identificador de subida ya se usó para otra foto' });
        }
        if (existeFoto(id, reg.fotoId, 'liquidacion') && reg.existente.url) {
          return res.json({ ok: true, fotoId: reg.fotoId, url: reg.existente.url, modo: 'local', repetida: true });
        }
      }

      try {
        await guardarFoto(id, reg.fotoId, req.body, 'liquidacion');
      } catch (errDisco) {
        if (reg.nueva) {
          await pool.request().input('id', sql.BigInt, reg.fotoId)
            .query('DELETE FROM caja_liquidaciones_tiendas_fotos WHERE id = @id');
        }
        throw errDisco;
      }
      await pool.request()
        .input('id',  sql.BigInt,   reg.fotoId)
        .input('url', sql.NVarChar, urlLocal(reg.fotoId))
        .query('UPDATE caja_liquidaciones_tiendas_fotos SET url = @url WHERE id = @id');

      res.status(reg.nueva ? 201 : 200).json({ ok: true, fotoId: reg.fotoId, url: urlLocal(reg.fotoId), modo: 'local' });
    } catch (err) {
      console.error('POST /caja/tiendas/liquidaciones/:id/foto/local:', err.message);
      res.status(500).json({ error: 'Error al guardar la foto' });
    }
  }
);

/* GET /api/caja/tiendas/liquidaciones/:id/foto/:fotoId — sirve la foto
   local (modo prueba), con sesión de gestor (todo /caja lo exige) */
router.get('/tiendas/liquidaciones/:id/foto/:fotoId', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const fotoId = parseInt(req.params.fotoId, 10);
    if (!id || !fotoId) return res.status(400).json({ error: 'Identificador no válido' });
    const pool = await getPool();
    const r = await pool.request()
      .input('id', sql.BigInt, fotoId).input('id_liq', sql.BigInt, id)
      .query('SELECT TOP 1 1 AS x FROM caja_liquidaciones_tiendas_fotos WHERE id = @id AND id_liquidacion = @id_liq');
    if (!r.recordset.length || !existeFoto(id, fotoId, 'liquidacion')) {
      return res.status(404).json({ error: 'Foto no encontrada' });
    }
    res.sendFile(rutaArchivo(id, fotoId, 'liquidacion'));
  } catch (err) {
    console.error('GET /caja/tiendas/liquidaciones/:id/foto/:fotoId:', err.message);
    res.status(500).json({ error: 'Error al obtener la foto' });
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
