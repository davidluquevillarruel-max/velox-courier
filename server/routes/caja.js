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
const {
  r2Habilitado, generarUrlSubidaPagoTienda, esUrlDePagoTienda,
  generarUrlSubidaPagoMoto, esUrlDePagoMoto,
} = require('../r2');
const { guardarFoto, rutaArchivo, existeFoto } = require('../almacenamiento-local');
const { aCentimos, aSoles, filtroFecha, ordenesCaja, ordenesPrepagadas, cuadreCaja } = require('../caja-motor');

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

/* Pendientes (día sin marcar, por defecto) / pagados / todos.
   campo: de quién es el "pagado" (dia_pagado = tienda, dia_pagado_moto). */
function filtrarPorPago(ordenes, estado, campo = 'dia_pagado') {
  if (estado === 'todos')   return ordenes;
  if (estado === 'pagados') return ordenes.filter(o => o[campo]);
  return ordenes.filter(o => !o[campo]);
}

function leerFiltros(q) {
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
    const { desde, hasta, estado } = leerFiltros(req.query);
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
    const { desde, hasta, estado } = leerFiltros(req.query);
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

const MAX_FOTOS_PAGO = 5;

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
  const { desde, hasta } = leerFiltros(req.body);
  const fotos = Number(req.body.fotos);
  if (!Number.isInteger(fotos) || fotos < 1 || fotos > MAX_FOTOS_PAGO) {
    return res.status(400).json({ error: `Falta la foto del pago (de 1 a ${MAX_FOTOS_PAGO}).` });
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
   FOTOS DEL PAGO (liquidaciones)
   Las mismas tres rutas de la cola de fotos que las de una orden,
   colgadas de la liquidación. Una definición por tipo de liquidación;
   Caja Tienda (D-011) y Caja de motorizados (D-012) usan el mismo código:
   · R2 activo → /evidencia/presigned + PUT directo a R2 + /foto/registrar.
   · MODO PRUEBA → /foto/local (disco) y GET /foto/:fotoId la sirve.
   Reintentos sin duplicar por idSubida (índice único filtrado).
   Tope: MAX_FOTOS_PAGO por liquidación.
   Los nombres de tabla salen solo de estas constantes, nunca del pedido.
   ════════════════════════════════════════════════════════════ */
const LIQ_TIENDA = {
  ruta: '/tiendas/liquidaciones',
  tabla: 'caja_liquidaciones_tiendas',
  tablaFotos: 'caja_liquidaciones_tiendas_fotos',
  generarUrl: generarUrlSubidaPagoTienda,
  esUrl: esUrlDePagoTienda,
  prefijoLocal: 'liquidacion',
};
const LIQ_MOTO = {
  ruta: '/motorizados/liquidaciones',
  tabla: 'caja_liquidaciones_motorizados',
  tablaFotos: 'caja_liquidaciones_motorizados_fotos',
  generarUrl: generarUrlSubidaPagoMoto,
  esUrl: esUrlDePagoMoto,
  prefijoLocal: 'liquidacion-moto',
};

const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* null = no vino · false = vino mal · string = UUID en minúsculas
   (como leerIdSubida de routes/ordenes.js) */
function leerIdSubida(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  return (typeof valor === 'string' && REGEX_UUID.test(valor)) ? valor.toLowerCase() : false;
}

function rutasFotosLiquidacion(cfg) {
  const { ruta, tabla, tablaFotos, prefijoLocal } = cfg;

  async function fotoPorIdSubida(pool, idSubida) {
    if (!idSubida) return null;
    const r = await pool.request()
      .input('id_subida', sql.UniqueIdentifier, idSubida)
      .query(`SELECT id, CAST(id_liquidacion AS VARCHAR(20)) AS id_liquidacion, url
              FROM ${tablaFotos} WHERE id_subida = @id_subida`);
    return r.recordset[0] || null;
  }

  async function tope(pool, id) {
    const r = await pool.request()
      .input('id', sql.BigInt, id)
      .query(`SELECT COUNT(*) AS total FROM ${tablaFotos} WHERE id_liquidacion = @id`);
    return r.recordset[0].total >= MAX_FOTOS_PAGO;
  }

  /* Inserta la foto; si otro reintento con el mismo idSubida ganó la
     carrera, devuelve esa */
  async function registrar(pool, id, url, idSubida) {
    try {
      const r = await pool.request()
        .input('id_liq',    sql.BigInt,           id)
        .input('url',       sql.NVarChar,         url)
        .input('id_subida', sql.UniqueIdentifier, idSubida || null)
        .query(`INSERT INTO ${tablaFotos} (id_liquidacion, url, id_subida)
                OUTPUT INSERTED.id VALUES (@id_liq, @url, @id_subida)`);
      return { fotoId: r.recordset[0].id, nueva: true };
    } catch (err) {
      if (idSubida && (err.number === 2601 || err.number === 2627)) {
        const existente = await fotoPorIdSubida(pool, idSubida);
        if (existente) return { fotoId: existente.id, nueva: false, existente };
      }
      throw err;
    }
  }

  /* Valida :id y que la liquidación exista; responde y devuelve null si no */
  async function leerLiquidacion(req, res, pool) {
    const id = parseInt(req.params.id, 10);
    if (!id) { res.status(400).json({ error: 'Liquidación no válida' }); return null; }
    const r = await pool.request()
      .input('id', sql.BigInt, id)
      .query(`SELECT TOP 1 1 AS x FROM ${tabla} WHERE id = @id`);
    if (!r.recordset.length) { res.status(404).json({ error: 'Liquidación no encontrada' }); return null; }
    return id;
  }

  /* POST .../:id/evidencia/presigned  Body: { contentType, idSubida } */
  router.post(`${ruta}/:id/evidencia/presigned`, async (req, res) => {
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
      if (!(await fotoPorIdSubida(pool, idSubida)) && await tope(pool, id)) {
        return res.status(409).json({ error: `Este pago ya tiene ${MAX_FOTOS_PAGO} fotos` });
      }
      const { uploadUrl, publicUrl } = await cfg.generarUrl(id, req.body.contentType, idSubida);
      res.json({ uploadUrl, publicUrl });
    } catch (err) {
      console.error(`POST /caja${ruta}/:id/evidencia/presigned:`, err.message);
      res.status(400).json({ error: err.message || 'Error al generar la URL de subida' });
    }
  });

  /* POST .../:id/foto/registrar  Body: { url, idSubida } — URL ya subida a R2 */
  router.post(`${ruta}/:id/foto/registrar`, async (req, res) => {
    try {
      const pool = await getPool();
      const id = await leerLiquidacion(req, res, pool);
      if (!id) return;
      const idSubida = leerIdSubida(req.body.idSubida);
      if (idSubida === false) return res.status(400).json({ error: 'Identificador de subida no válido' });
      const { url } = req.body;
      if (!url || typeof url !== 'string' || url.length > 500 || !cfg.esUrl(url, id)) {
        return res.status(400).json({ error: 'URL de foto no válida' });
      }

      const previa = await fotoPorIdSubida(pool, idSubida);
      if (previa) {
        if (previa.id_liquidacion !== String(id)) {
          return res.status(409).json({ error: 'Ese identificador de subida ya se usó para otra foto' });
        }
        return res.json({ ok: true, fotoId: previa.id, url: previa.url, repetida: true });
      }
      if (await tope(pool, id)) {
        return res.status(409).json({ error: `Este pago ya tiene ${MAX_FOTOS_PAGO} fotos` });
      }

      const reg = await registrar(pool, id, url, idSubida);
      if (!reg.nueva) {
        if (reg.existente.id_liquidacion !== String(id)) {
          return res.status(409).json({ error: 'Ese identificador de subida ya se usó para otra foto' });
        }
        return res.json({ ok: true, fotoId: reg.fotoId, url: reg.existente.url, repetida: true });
      }
      res.status(201).json({ ok: true, fotoId: reg.fotoId, url });
    } catch (err) {
      console.error(`POST /caja${ruta}/:id/foto/registrar:`, err.message);
      res.status(500).json({ error: 'Error al registrar la foto' });
    }
  });

  /* POST .../:id/foto/local?idSubida= — MODO PRUEBA (solo sin R2). El body es el JPEG. */
  router.post(`${ruta}/:id/foto/local`,
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

        const urlLocal = fotoId => `/api/caja${ruta}/${id}/foto/${fotoId}`;
        let reg;
        const previa = await fotoPorIdSubida(pool, idSubida);
        if (previa) {
          reg = { fotoId: previa.id, nueva: false, existente: previa };
        } else {
          if (await tope(pool, id)) {
            return res.status(409).json({ error: `Este pago ya tiene ${MAX_FOTOS_PAGO} fotos` });
          }
          reg = await registrar(pool, id, '', idSubida);
        }
        if (!reg.nueva) {
          if (reg.existente.id_liquidacion !== String(id)) {
            return res.status(409).json({ error: 'Ese identificador de subida ya se usó para otra foto' });
          }
          if (existeFoto(id, reg.fotoId, prefijoLocal) && reg.existente.url) {
            return res.json({ ok: true, fotoId: reg.fotoId, url: reg.existente.url, modo: 'local', repetida: true });
          }
        }

        try {
          await guardarFoto(id, reg.fotoId, req.body, prefijoLocal);
        } catch (errDisco) {
          if (reg.nueva) {
            await pool.request().input('id', sql.BigInt, reg.fotoId)
              .query(`DELETE FROM ${tablaFotos} WHERE id = @id`);
          }
          throw errDisco;
        }
        await pool.request()
          .input('id',  sql.BigInt,   reg.fotoId)
          .input('url', sql.NVarChar, urlLocal(reg.fotoId))
          .query(`UPDATE ${tablaFotos} SET url = @url WHERE id = @id`);

        res.status(reg.nueva ? 201 : 200).json({ ok: true, fotoId: reg.fotoId, url: urlLocal(reg.fotoId), modo: 'local' });
      } catch (err) {
        console.error(`POST /caja${ruta}/:id/foto/local:`, err.message);
        res.status(500).json({ error: 'Error al guardar la foto' });
      }
    }
  );

  /* GET .../:id/foto/:fotoId — sirve la foto local (modo prueba), con
     sesión de gestor (todo /caja lo exige) */
  router.get(`${ruta}/:id/foto/:fotoId`, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const fotoId = parseInt(req.params.fotoId, 10);
      if (!id || !fotoId) return res.status(400).json({ error: 'Identificador no válido' });
      const pool = await getPool();
      const r = await pool.request()
        .input('id', sql.BigInt, fotoId).input('id_liq', sql.BigInt, id)
        .query(`SELECT TOP 1 1 AS x FROM ${tablaFotos} WHERE id = @id AND id_liquidacion = @id_liq`);
      if (!r.recordset.length || !existeFoto(id, fotoId, prefijoLocal)) {
        return res.status(404).json({ error: 'Foto no encontrada' });
      }
      res.sendFile(rutaArchivo(id, fotoId, prefijoLocal));
    } catch (err) {
      console.error(`GET /caja${ruta}/:id/foto/:fotoId:`, err.message);
      res.status(500).json({ error: 'Error al obtener la foto' });
    }
  });
}
rutasFotosLiquidacion(LIQ_TIENDA);
rutasFotosLiquidacion(LIQ_MOTO);

/* ════════════════════════════════════════════════════════════
   LIQUIDEZ DIARIA
   Teórica y en vivo, con el motor, por fecha de reparto: qué dejó cada
   día si todo se liquidara. No representa pagos: lo ya pagado no se
   congela acá, eso es la Caja real.
   Las vías son cómo pagó el cliente (y el prepago, según su método):
   cuentan aunque el moto todavía no haya rendido. Lo que las tiendas le
   pagan a Velox al liquidar no se cuenta, sería doble conteo.
   GET /api/caja/liquidez?desde=&hasta= (solo "desde" = ese día)
   ════════════════════════════════════════════════════════════ */
router.get('/liquidez', async (req, res) => {
  try {
    const pool = await getPool();
    const { desde, hasta } = leerFiltros(req.query);
    const ordenes = await ordenesCaja(pool, { desde, hasta });

    const nuevo = () => ({
      pedidos: 0, delivery: 0, pago_motos: 0, retenido: 0,
      efectivo: 0, yape: 0, deposito: 0, prepago_sin_metodo: 0,
    });
    const sumar = (a, c) => {
      a.pedidos    += 1;
      a.delivery   += c.delivery;
      a.pago_motos += c.pago_moto;
      a.retenido   += c.retenido;
      for (const k of Object.keys(c.vias)) a[k] += c.vias[k];
    };
    const enSoles = a => ({
      pedidos: a.pedidos,
      delivery: aSoles(a.delivery), pago_motos: aSoles(a.pago_motos),
      ganancia: aSoles(a.delivery - a.pago_motos), retenido: aSoles(a.retenido),
      efectivo: aSoles(a.efectivo), yape: aSoles(a.yape), deposito: aSoles(a.deposito),
      prepago_sin_metodo: aSoles(a.prepago_sin_metodo),
    });

    const porDia = new Map();
    const total = nuevo();
    for (const o of ordenes) {
      if (!porDia.has(o.fecha)) porDia.set(o.fecha, nuevo());
      sumar(porDia.get(o.fecha), o.calc);
      sumar(total, o.calc);
    }

    res.json({
      dias: [...porDia.keys()].sort().reverse().map(fecha => ({ fecha, ...enSoles(porDia.get(fecha)) })),
      totales: enSoles(total),
      cuadre: cuadreCaja(ordenes),
    });
  } catch (err) {
    console.error('GET /caja/liquidez:', err.message);
    res.status(500).json({ error: 'Error al obtener la liquidez' });
  }
});

/* ════════════════════════════════════════════════════════════
   CAJA REAL (Velox)
   Plata que YA cambió de mano. Lo liquidado va por su FECHA DE PAGO y
   con los montos guardados; Pago Velox y prepagos no tienen otra fecha
   que la de reparto.
   · Días del moto pagados antes de las liquidaciones: su monto_cobrado
     salió de la regla vieja, que sumaba toda la plata cobrada, Pago
     Velox incluido. Por eso ese Pago Velox no se vuelve a sumar por
     pedido, y sus vías quedan "sin desglose".
   · Prepagos de órdenes no cobrables: línea aparte, fuera del cuadre.
   · Lo que las tiendas pagan al liquidar entra al neto de tiendas pero
     no a las vías.
   GET /api/caja/real?desde=&hasta= (solo "desde" = ese día)
   ════════════════════════════════════════════════════════════ */
router.get('/real', async (req, res) => {
  try {
    const pool = await getPool();
    const { desde, hasta } = leerFiltros(req.query);

    const reqT = pool.request();
    const fT = filtroFecha(reqT, desde, hasta, 'CAST(ISNULL(cp.fecha_pago, cp.fecha_ciclo) AS DATE)');
    const t = (await reqT.query(`
      SELECT ISNULL(SUM(cp.monto_cobrar), 0) AS cobrar, ISNULL(SUM(cp.monto_devolver), 0) AS devolver
      FROM caja_pagos_tiendas cp WHERE cp.pagado = 1 ${fT}
    `)).recordset[0];

    const reqM = pool.request();
    const fM = filtroFecha(reqM, desde, hasta, 'CAST(ISNULL(cm.fecha_pago, cm.fecha_dia) AS DATE)');
    const m = (await reqM.query(`
      SELECT ISNULL(SUM(cm.monto_cobrado), 0) AS cobrado, ISNULL(SUM(cm.monto_a_pagar), 0) AS a_pagar,
             ISNULL(SUM(CASE WHEN cm.id_liquidacion IS NULL THEN cm.monto_cobrado ELSE 0 END), 0) AS sin_desglose
      FROM caja_pagos_motorizados cm WHERE cm.pagado = 1 ${fM}
    `)).recordset[0];

    const reqL = pool.request();
    const fL = filtroFecha(reqL, desde, hasta, 'l.fecha_pago');
    const l = (await reqL.query(`
      SELECT ISNULL(SUM(l.monto_efectivo), 0) AS efectivo, ISNULL(SUM(l.monto_yape), 0) AS yape
      FROM caja_liquidaciones_motorizados l WHERE 1 = 1 ${fL}
    `)).recordset[0];

    let pagoVelox = 0;
    for (const o of await ordenesCaja(pool, { desde, hasta })) {
      if (!o.dia_moto_sin_liquidacion) pagoVelox += o.calc.directo_velox;
    }

    let prepagos = 0, prepagosAparte = 0;
    const vias = {
      efectivo: aCentimos(l.efectivo), yape: aCentimos(l.yape),
      deposito: pagoVelox, prepago_sin_metodo: 0,
    };
    for (const p of await ordenesPrepagadas(pool, { desde, hasta })) {
      if (p.cobrable) prepagos += p.monto;
      else prepagosAparte += p.monto;
      vias[p.via] += p.monto;
    }

    const netoTiendas = aCentimos(t.cobrar) - aCentimos(t.devolver);
    const netoMotos   = aCentimos(m.cobrado) - aCentimos(m.a_pagar);
    const sinDesglose = aCentimos(m.sin_desglose);
    res.json({
      neto_motorizados: aSoles(netoMotos),
      neto_tiendas: aSoles(netoTiendas),
      pago_velox: aSoles(pagoVelox),
      prepagos: aSoles(prepagos),
      prepagos_no_cobrables: aSoles(prepagosAparte),
      caja_real: aSoles(netoMotos + netoTiendas + pagoVelox + prepagos + prepagosAparte),
      vias: {
        efectivo: aSoles(vias.efectivo), yape: aSoles(vias.yape), deposito: aSoles(vias.deposito),
        prepago_sin_metodo: aSoles(vias.prepago_sin_metodo),
        sin_desglose: aSoles(sinDesglose),
        total: aSoles(vias.efectivo + vias.yape + vias.deposito + vias.prepago_sin_metodo + sinDesglose),
      },
    });
  } catch (err) {
    console.error('GET /caja/real:', err.message);
    res.status(500).json({ error: 'Error al calcular la caja real' });
  }
});

/* ════════════════════════════════════════════════════════════
   CAJA DE MOTORIZADOS
   Mismo patrón que Caja Tienda. Saldo del moto = plata que pasó por
   sus manos (efectivo + Yape) − su pago por los viajes; Pago Velox y
   Pago tienda no suman. > 0 nos debe · < 0 le debemos.
   "Pagado" es por moto y por día (caja_pagos_motorizados.fecha_dia =
   fecha de reparto). Pendiente = en vivo, con el motor. Día pagado =
   el saldo guardado (monto_cobrado − monto_a_pagar).
   Un día con órdenes en proceso no se puede liquidar: si se liquidara,
   el moto ya no podría cerrarlas (ver bloqueoPorResolverEnDiaPagado).
   ════════════════════════════════════════════════════════════ */
async function diasPagadosMoto(pool, { desde, hasta, idMotorizado }) {
  const request = pool.request();
  const fFecha = filtroFecha(request, desde, hasta, 'cm.fecha_dia');
  let fMoto = '';
  if (idMotorizado) {
    request.input('id_motorizado', sql.Int, idMotorizado);
    fMoto = 'AND cm.id_motorizado = @id_motorizado';
  }
  const r = await request.query(`
    SELECT cm.id_motorizado, m.nombre AS motorizado,
           CONVERT(varchar, cm.fecha_dia, 23) AS fecha,
           CONVERT(varchar, cm.fecha_pago, 23) AS fecha_pago,
           cm.monto_cobrado, cm.monto_a_pagar
    FROM caja_pagos_motorizados cm
    JOIN motorizados m ON m.id = cm.id_motorizado
    WHERE cm.pagado = 1 ${fFecha} ${fMoto}
    ORDER BY cm.fecha_dia DESC
  `);
  return r.recordset.map(d => ({ ...d, saldo: aCentimos(d.monto_cobrado) - aCentimos(d.monto_a_pagar) }));
}

/* Días con órdenes en proceso: Set 'idMoto|fecha' */
async function diasAbiertosMoto(pool, { desde, hasta, idMotorizado }) {
  const request = pool.request();
  const fFecha = filtroFecha(request, desde, hasta);
  let fMoto = 'AND o.id_motorizado IS NOT NULL';
  if (idMotorizado) {
    request.input('id_motorizado', sql.Int, idMotorizado);
    fMoto = 'AND o.id_motorizado = @id_motorizado';
  }
  const r = await request.query(`
    SELECT DISTINCT o.id_motorizado, CONVERT(varchar, o.fecha_reparto, 23) AS fecha
    FROM ordenes o
    WHERE o.estado = 'en-proceso' ${fFecha} ${fMoto}
  `);
  return new Set(r.recordset.map(d => `${d.id_motorizado}|${d.fecha}`));
}

const ordenesDeMotos = async (pool, filtros) =>
  (await ordenesCaja(pool, filtros)).filter(o => o.id_motorizado);

function saldoVivoMotoPorDia(ordenes) {
  const m = new Map();
  for (const o of ordenes) {
    if (!o.dia_pagado_moto) continue;
    const k = `${o.id_motorizado}|${o.fecha}`;
    m.set(k, (m.get(k) || 0) + o.calc.saldo_moto);
  }
  return m;
}

/* GET /api/caja/motorizados?desde=&hasta=&estado=pendientes|pagados|todos
   Resumen por moto + KPIs (siempre sobre lo pendiente del período). */
router.get('/motorizados', async (req, res) => {
  try {
    const pool = await getPool();
    const { desde, hasta, estado } = leerFiltros(req.query);
    const ordenes = await ordenesDeMotos(pool, { desde, hasta });
    const pagados = await diasPagadosMoto(pool, { desde, hasta });
    const abiertos = await diasAbiertosMoto(pool, { desde, hasta });

    const porMoto = new Map();
    const motoDe = (id, motorizado) => {
      if (!porMoto.has(id)) {
        porMoto.set(id, {
          id, motorizado,
          pedidos: 0, efectivo: 0, yape: 0, pago: 0, saldo: 0,
          saldo_pendiente: 0, saldo_liquidable: 0,
          dias_pendientes: new Set(), dias_abiertos: new Set(), dias_pagados: new Set(),
          dias_difieren: 0, medios_por_definir: 0, ultimo_pago: null, visible: false,
        });
      }
      return porMoto.get(id);
    };
    for (const o of ordenes) {
      const t = motoDe(o.id_motorizado, o.motorizado);
      if (!o.dia_pagado_moto) {
        t.dias_pendientes.add(o.fecha);
        t.saldo_pendiente += o.calc.saldo_moto;
        if (abiertos.has(`${o.id_motorizado}|${o.fecha}`)) t.dias_abiertos.add(o.fecha);
        else t.saldo_liquidable += o.calc.saldo_moto;
      }
    }
    for (const o of filtrarPorPago(ordenes, estado, 'dia_pagado_moto')) {
      const t = porMoto.get(o.id_motorizado);
      t.visible = true;
      t.pedidos  += 1;
      t.efectivo += o.calc.en_mano_efectivo;
      t.yape     += o.calc.en_mano_yape;
      t.pago     += o.calc.pago_moto;
      if (o.calc.medio_por_definir) t.medios_por_definir++;
      if (!o.dia_pagado_moto) t.saldo += o.calc.saldo_moto;
    }
    const vivo = saldoVivoMotoPorDia(ordenes);
    for (const d of pagados) {
      const t = motoDe(d.id_motorizado, d.motorizado);
      t.dias_pagados.add(d.fecha);
      if (d.fecha_pago && (!t.ultimo_pago || d.fecha_pago > t.ultimo_pago)) t.ultimo_pago = d.fecha_pago;
      if (estado === 'pendientes') continue;
      t.visible = true;
      t.saldo += d.saldo;
      if ((vivo.get(`${d.id_motorizado}|${d.fecha}`) || 0) !== d.saldo) t.dias_difieren++;
    }

    let porCobrar = 0, porPagar = 0, alDia = 0, conSaldo = 0;
    for (const t of porMoto.values()) {
      if (t.saldo_pendiente > 0)      { porCobrar += t.saldo_pendiente; conSaldo++; }
      else if (t.saldo_pendiente < 0) { porPagar  -= t.saldo_pendiente; conSaldo++; }
      else alDia++;
    }

    res.json({
      kpis: {
        por_cobrar: aSoles(porCobrar), por_pagar: aSoles(porPagar),
        posicion_neta: aSoles(porCobrar - porPagar),
        al_dia: alDia, con_saldo: conSaldo,
      },
      motorizados: [...porMoto.values()].filter(t => t.visible).map(t => ({
        id: t.id, motorizado: t.motorizado, pedidos: t.pedidos,
        efectivo: aSoles(t.efectivo), yape: aSoles(t.yape), pago: aSoles(t.pago), saldo: aSoles(t.saldo),
        saldo_pendiente: aSoles(t.saldo_pendiente), saldo_liquidable: aSoles(t.saldo_liquidable),
        dias_pendientes: t.dias_pendientes.size, dias_abiertos: t.dias_abiertos.size,
        dias_liquidables: t.dias_pendientes.size - t.dias_abiertos.size,
        dias_pagados: t.dias_pagados.size, dias_difieren: t.dias_difieren,
        medios_por_definir: t.medios_por_definir,
        estado: t.dias_pendientes.size ? 'pendiente' : 'pagado',
        ultimo_pago: t.ultimo_pago,
      })),
    });
  } catch (err) {
    console.error('GET /caja/motorizados:', err.message);
    res.status(500).json({ error: 'Error al obtener la caja de motorizados' });
  }
});

/* Pagos registrados de un moto que tocan algún día del período, con
   sus fotos. Los días pagados antes de esto no tienen liquidación. */
async function liquidacionesDeMoto(pool, idMoto, desde, hasta) {
  const request = pool.request().input('id_moto', sql.Int, idMoto);
  const filtro = filtroFecha(request, desde, hasta, 'cm.fecha_dia');
  const r = await request.query(`
    SELECT l.id, CONVERT(varchar, l.fecha_pago, 23) AS fecha_pago, l.dias,
           l.monto_cobrado, l.monto_a_pagar, l.monto_efectivo, l.monto_yape,
           l.fotos_declaradas, u.nombre AS usuario,
           (SELECT CONVERT(varchar, MIN(x.fecha_dia), 23) FROM caja_pagos_motorizados x WHERE x.id_liquidacion = l.id) AS primer_dia,
           (SELECT CONVERT(varchar, MAX(x.fecha_dia), 23) FROM caja_pagos_motorizados x WHERE x.id_liquidacion = l.id) AS ultimo_dia
    FROM caja_liquidaciones_motorizados l
    LEFT JOIN usuarios u ON u.id = l.id_usuario
    WHERE l.id_motorizado = @id_moto
      AND EXISTS (SELECT 1 FROM caja_pagos_motorizados cm WHERE cm.id_liquidacion = l.id ${filtro})
    ORDER BY l.id DESC
  `);
  const liqs = r.recordset;
  if (!liqs.length) return [];
  const fotos = await pool.request().query(`
    SELECT id, id_liquidacion, url FROM caja_liquidaciones_motorizados_fotos
    WHERE id_liquidacion IN (${liqs.map(l => parseInt(l.id, 10)).join(',')}) AND url <> ''
    ORDER BY id
  `);
  return liqs.map(l => ({
    id: l.id, fecha_pago: l.fecha_pago, dias: l.dias, usuario: l.usuario,
    primer_dia: l.primer_dia, ultimo_dia: l.ultimo_dia,
    monto_efectivo: Number(l.monto_efectivo), monto_yape: Number(l.monto_yape),
    monto_a_pagar: Number(l.monto_a_pagar),
    neto: aSoles(aCentimos(l.monto_cobrado) - aCentimos(l.monto_a_pagar)),
    fotos_declaradas: l.fotos_declaradas,
    fotos: fotos.recordset.filter(f => String(f.id_liquidacion) === String(l.id)).map(f => ({ id: f.id, url: f.url })),
  }));
}

/* GET /api/caja/motorizados/:id/detalle?desde=&hasta=&estado=
   Por pedido, con los totales al pie. */
router.get('/motorizados/:id/detalle', async (req, res) => {
  try {
    const idMoto = parseInt(req.params.id, 10);
    if (!idMoto) return res.status(400).json({ error: 'Motorizado no válido' });
    const pool = await getPool();
    const { desde, hasta, estado } = leerFiltros(req.query);
    const todas = await ordenesDeMotos(pool, { desde, hasta, idMotorizado: idMoto });
    const ordenes = filtrarPorPago(todas, estado, 'dia_pagado_moto');

    const tot = { efectivo: 0, yape: 0, pago: 0, saldo: 0 };
    const pedidos = ordenes.map(o => {
      const c = o.calc;
      tot.efectivo += c.en_mano_efectivo;
      tot.yape     += c.en_mano_yape;
      tot.pago     += c.pago_moto;
      if (!o.dia_pagado_moto) tot.saldo += c.saldo_moto;
      return {
        id: o.id, codigo: o.codigo, fecha: o.fecha, estado: o.estado, tienda: o.tienda,
        dest_nombre: o.dest_nombre, metodo_pago: o.metodo_pago, medio_pago: o.medio_pago,
        cobrado: (o.estado === 'entregado' && o.metodo_pago === 'contraentrega') ? Number(o.monto_cobrado) : 0,
        en_mano: aSoles(c.en_mano_moto), pago_moto: aSoles(c.pago_moto), saldo: aSoles(c.saldo_moto),
        dia_pagado: o.dia_pagado_moto, fecha_pago: o.fecha_pago_moto,
      };
    });

    const vivo = saldoVivoMotoPorDia(todas);
    let dias_pagados = [];
    if (estado !== 'pendientes') {
      dias_pagados = (await diasPagadosMoto(pool, { desde, hasta, idMotorizado: idMoto })).map(d => {
        const hoy = vivo.get(`${idMoto}|${d.fecha}`) || 0;
        tot.saldo += d.saldo;
        return {
          fecha: d.fecha, fecha_pago: d.fecha_pago,
          saldo_pagado: aSoles(d.saldo), saldo_hoy: aSoles(hoy), difiere: hoy !== d.saldo,
        };
      });
    }
    const abiertos = await diasAbiertosMoto(pool, { desde, hasta, idMotorizado: idMoto });
    const pendientes = new Set(todas.filter(o => !o.dia_pagado_moto).map(o => o.fecha));

    res.json({
      pedidos,
      dias_pagados,
      dias_abiertos: [...pendientes].filter(f => abiertos.has(`${idMoto}|${f}`)).sort(),
      totales: {
        pedidos: pedidos.length,
        efectivo: aSoles(tot.efectivo), yape: aSoles(tot.yape), pago: aSoles(tot.pago), saldo: aSoles(tot.saldo),
      },
      liquidaciones: estado === 'pendientes' ? [] : await liquidacionesDeMoto(pool, idMoto, desde, hasta),
    });
  } catch (err) {
    console.error('GET /caja/motorizados/:id/detalle:', err.message);
    res.status(500).json({ error: 'Error al obtener el detalle del motorizado' });
  }
});

/* POST /api/caja/motorizados/pagar  { id_motorizado, desde?, hasta?, fotos }
   Liquida los días PENDIENTES del moto en el período, salvo los que
   tienen órdenes en proceso. Guarda por día lo que se liquidó, con el
   motor. fecha_pago = hoy en Lima. Crea la liquidación y le cuelga los
   días. fotos = cuántas se tomaron (1 a 5): entran después a la cola. */
router.post('/motorizados/pagar', async (req, res) => {
  const idMoto = parseInt(req.body.id_motorizado, 10);
  if (!idMoto) return res.status(400).json({ error: 'Falta el motorizado' });
  const { desde, hasta } = leerFiltros(req.body);
  const fotos = Number(req.body.fotos);
  if (!Number.isInteger(fotos) || fotos < 1 || fotos > MAX_FOTOS_PAGO) {
    return res.status(400).json({ error: `Falta la foto del pago (de 1 a ${MAX_FOTOS_PAGO}).` });
  }

  let tx;
  try {
    const pool = await getPool();
    const pendientes = filtrarPorPago(
      await ordenesDeMotos(pool, { desde, hasta, idMotorizado: idMoto }), 'pendientes', 'dia_pagado_moto');
    if (!pendientes.length) {
      return res.status(400).json({ error: 'Este motorizado no tiene días pendientes en el período.' });
    }
    const abiertos = await diasAbiertosMoto(pool, { desde, hasta, idMotorizado: idMoto });

    const porDia = new Map();
    const excluidos = new Set();
    for (const o of pendientes) {
      if (abiertos.has(`${idMoto}|${o.fecha}`)) { excluidos.add(o.fecha); continue; }
      const d = porDia.get(o.fecha) || { entregas: 0, a_pagar: 0, cobrado: 0, efectivo: 0, yape: 0 };
      if (o.estado === 'entregado') d.entregas++;
      d.a_pagar  += o.calc.pago_moto;
      d.cobrado  += o.calc.en_mano_moto;
      d.efectivo += o.calc.en_mano_efectivo;
      d.yape     += o.calc.en_mano_yape;
      porDia.set(o.fecha, d);
    }
    if (!porDia.size) {
      return res.status(400).json({
        error: 'Todos los días pendientes tienen órdenes en proceso: hay que cerrarlas antes de liquidar.',
      });
    }

    const tot = { a_pagar: 0, cobrado: 0, efectivo: 0, yape: 0 };
    for (const d of porDia.values()) for (const k of Object.keys(tot)) tot[k] += d[k];

    const hoy = hoyEnLima();
    tx = new sql.Transaction(pool);
    await tx.begin();
    const liq = await new sql.Request(tx)
      .input('id_moto',  sql.Int,           idMoto)
      .input('desde',    sql.Date,          desde || null)
      .input('hasta',    sql.Date,          hasta || null)
      .input('dias',     sql.Int,           porDia.size)
      .input('cobrado',  sql.Decimal(10,2), aSoles(tot.cobrado))
      .input('a_pagar',  sql.Decimal(10,2), aSoles(tot.a_pagar))
      .input('efectivo', sql.Decimal(10,2), aSoles(tot.efectivo))
      .input('yape',     sql.Decimal(10,2), aSoles(tot.yape))
      .input('hoy',      sql.Date,          hoy)
      .input('fotos',    sql.Int,           fotos)
      .input('id_usuario', sql.Int,         req.usuario.id)
      .query(`
        INSERT INTO caja_liquidaciones_motorizados
          (id_motorizado, desde, hasta, dias, monto_cobrado, monto_a_pagar, monto_efectivo, monto_yape,
           fecha_pago, fotos_declaradas, id_usuario)
        OUTPUT INSERTED.id
        VALUES (@id_moto, @desde, @hasta, @dias, @cobrado, @a_pagar, @efectivo, @yape, @hoy, @fotos, @id_usuario)
      `);
    const idLiquidacion = liq.recordset[0].id;

    for (const [fecha, d] of porDia) {
      /* Si otro usuario liquidó este día mientras tanto (UPDATE sin
         filas), se deshace todo: no se pisa un pago ya registrado */
      const r = await new sql.Request(tx)
        .input('id_moto',   sql.Int,           idMoto)
        .input('fecha_dia', sql.Date,          fecha)
        .input('entregas',  sql.Int,           d.entregas)
        .input('a_pagar',   sql.Decimal(10,2), aSoles(d.a_pagar))
        .input('cobrado',   sql.Decimal(10,2), aSoles(d.cobrado))
        .input('hoy',       sql.Date,          hoy)
        .input('id_liq',    sql.BigInt,        idLiquidacion)
        .query(`
          IF EXISTS (
            SELECT 1 FROM caja_pagos_motorizados WITH (UPDLOCK, HOLDLOCK)
            WHERE id_motorizado = @id_moto AND fecha_dia = @fecha_dia
          )
          BEGIN
            UPDATE caja_pagos_motorizados
            SET pagado = 1, fecha_pago = @hoy, id_liquidacion = @id_liq,
                total_entregas = @entregas, monto_a_pagar = @a_pagar, monto_cobrado = @cobrado
            WHERE id_motorizado = @id_moto AND fecha_dia = @fecha_dia AND pagado = 0;
            SELECT @@ROWCOUNT AS filas;
          END
          ELSE
          BEGIN
            INSERT INTO caja_pagos_motorizados
              (id_motorizado, fecha_dia, total_entregas, monto_a_pagar, monto_cobrado, pagado, fecha_pago, id_liquidacion)
            VALUES
              (@id_moto, @fecha_dia, @entregas, @a_pagar, @cobrado, 1, @hoy, @id_liq);
            SELECT 1 AS filas;
          END
        `);
      if (!r.recordset[0].filas) {
        const e = new Error('día ya pagado'); e.yaPagado = true; throw e;
      }
    }
    await tx.commit();

    res.json({ ok: true, dias: porDia.size, dias_excluidos: excluidos.size, fecha_pago: hoy, id_liquidacion: idLiquidacion });
  } catch (err) {
    if (tx) { try { await tx.rollback(); } catch (_) { /* ya cerrada */ } }
    if (err.yaPagado || err.number === 2601 || err.number === 2627) {
      return res.status(409).json({ error: 'Otro usuario acaba de marcar pagado un día de este motorizado. Revisa y vuelve a intentar.' });
    }
    console.error('POST /caja/motorizados/pagar:', err.message);
    res.status(500).json({ error: 'Error al registrar el pago' });
  }
});

module.exports = router;
