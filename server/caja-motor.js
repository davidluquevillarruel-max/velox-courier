/* ============================================================
   server/caja-motor.js
   Motor de la Caja: la ÚNICA definición de cuánta plata mueve una
   orden. Caja Tienda, Motorizados, Liquidez y Caja real leen de acá.

   No sabe nada de sesiones ni de roles: quien lo llama decide qué
   órdenes pide (idTienda / idMotorizado salen de la sesión o del
   filtro de un gestor, según la ruta).

   Reglas por orden, en su fecha_reparto:
   · Cobrable = entregado / ausente / devolucion. El resto no suma.
   · delivery = delivery_total.
   · retenido = monto_cobrado SOLO si se entregó en contraentrega y la
     plata la tiene Velox: efectivo o Yape al moto (en_mano_moto) o
     Pago Velox (directo_velox). Con "Pago tienda" o medio por definir,
     0. Ausente y devolución no retienen.
   · pago_moto = pago_moto_total si es cobrable y tiene motorizado.
   · saldo_tienda: postpago = delivery − retenido;
     prepago (pago_velox = 'PAGADO') = − retenido.
     > 0 la tienda nos debe · < 0 le debemos.
   · saldo_moto = en_mano_moto − pago_moto.
     > 0 el moto nos debe · < 0 le debemos.
   · vias = cómo pagó el cliente: efectivo moto → efectivo, Yape moto
     → yape, Pago Velox → deposito; el prepago según su método
     (sin método → prepago_sin_metodo). Pago tienda no cuenta.

   Todo en céntimos (enteros) para que las sumas no arrastren errores
   de coma flotante; aSoles() los pasa a soles al responder.
   ============================================================ */
const { sql } = require('./db');

const ESTADOS_COBRABLES   = ['entregado', 'ausente', 'devolucion'];
const MEDIOS_EN_MANO_MOTO = ['efectivo-motorizado', 'yape-motorizado'];
const MEDIO_DIRECTO_VELOX = 'pago-empresa';
const VIA_DE_MEDIO = { 'efectivo-motorizado': 'efectivo', 'yape-motorizado': 'yape', 'pago-empresa': 'deposito' };
const VIA_DE_PREPAGO = { efectivo: 'efectivo', yape: 'yape' };

const aCentimos = v => Math.round((Number(v) || 0) * 100);
const aSoles = c => c / 100;

/* Toda la plata de una orden. Una orden no cobrable da todo en 0. */
function calcularOrdenCaja(o) {
  const cobrable   = ESTADOS_COBRABLES.includes(o.estado);
  const es_prepago = o.pago_velox === 'PAGADO';
  const delivery   = cobrable ? aCentimos(o.delivery_total) : 0;
  const pago_moto  = (cobrable && o.id_motorizado) ? aCentimos(o.pago_moto_total) : 0;

  const cobrado = (o.estado === 'entregado' && o.metodo_pago === 'contraentrega')
    ? aCentimos(o.monto_cobrado) : 0;
  const en_mano_moto  = MEDIOS_EN_MANO_MOTO.includes(o.medio_pago) ? cobrado : 0;
  const directo_velox = o.medio_pago === MEDIO_DIRECTO_VELOX ? cobrado : 0;
  const retenido = en_mano_moto + directo_velox;
  const prepago  = es_prepago ? delivery : 0;

  const vias = { efectivo: 0, yape: 0, deposito: 0, prepago_sin_metodo: 0 };
  if (retenido) vias[VIA_DE_MEDIO[o.medio_pago]] += retenido;
  if (prepago)  vias[VIA_DE_PREPAGO[o.pago_velox_metodo] || 'prepago_sin_metodo'] += prepago;

  return {
    cobrable, es_prepago, delivery, retenido, en_mano_moto, directo_velox, pago_moto, prepago,
    saldo_tienda: (es_prepago ? 0 : delivery) - retenido,
    saldo_moto: en_mano_moto - pago_moto,
    vias,
  };
}

/* Filtro de fechas de la Caja. Solo "desde" = ese único día; solo
   "hasta" = hasta ese día; nada = todo. */
function filtroFecha(request, desde, hasta, columna = 'o.fecha_reparto') {
  if (desde) request.input('desde', sql.Date, desde);
  if (hasta) request.input('hasta', sql.Date, hasta);
  if (desde && hasta) return `AND ${columna} BETWEEN @desde AND @hasta`;
  if (desde)          return `AND ${columna} = @desde`;
  if (hasta)          return `AND ${columna} <= @hasta`;
  return '';
}

/* Órdenes cobrables del período, cada una con su cálculo (calc) y si
   su día ya está marcado pagado para la tienda (dia_pagado). */
async function ordenesCaja(pool, { desde, hasta, idTienda, idMotorizado } = {}) {
  const request = pool.request();
  const fFecha = filtroFecha(request, desde, hasta);
  let filtros = '';
  if (idTienda) {
    request.input('id_tienda', sql.Int, idTienda);
    filtros += ' AND o.id_tienda = @id_tienda';
  }
  if (idMotorizado) {
    request.input('id_motorizado', sql.Int, idMotorizado);
    filtros += ' AND o.id_motorizado = @id_motorizado';
  }
  const r = await request.query(`
    SELECT o.id, o.codigo, o.id_tienda, t.nombre AS tienda, t.ciclo_pago, o.id_motorizado,
           CONVERT(varchar, o.fecha_reparto, 23) AS fecha,
           o.estado, o.metodo_pago, o.medio_pago, o.pago_velox, o.pago_velox_metodo,
           o.delivery_total, o.pago_moto_total, o.monto_cobrado, o.dest_nombre,
           ISNULL(cp.pagado, 0) AS dia_pagado,
           CONVERT(varchar, cp.fecha_pago, 23) AS fecha_pago
    FROM ordenes o
    JOIN tiendas t ON t.id = o.id_tienda
    OUTER APPLY (SELECT TOP 1 c.pagado, c.fecha_pago FROM caja_pagos_tiendas c
                 WHERE c.id_tienda = o.id_tienda AND c.fecha_ciclo = o.fecha_reparto
                 ORDER BY c.pagado DESC) cp
    WHERE o.estado IN (${ESTADOS_COBRABLES.map(e => `'${e}'`).join(',')})
      ${fFecha} ${filtros}
    ORDER BY t.nombre, o.fecha_reparto DESC, o.id DESC
  `);
  return r.recordset.map(o => ({ ...o, dia_pagado: !!o.dia_pagado, calc: calcularOrdenCaja(o) }));
}

/* Control de cuadre, sobre órdenes de ordenesCaja():
     saldo motos + saldo tiendas + Pago Velox + prepagos
       = delivery − pago a motos
   Orden por orden siempre cierra, así que no prueba el cálculo: detecta
   lo que se pierde al armar cada caja. Acá el saldo de motos solo suma
   órdenes con motorizado, igual que su caja; una entregada sin moto con
   plata en mano descuadra y aparece en sin_motorizado. Es en vivo: los
   montos ya pagados (guardados) no entran. */
function cuadreCaja(ordenes) {
  const t = { saldo_motos: 0, saldo_tiendas: 0, pago_velox: 0, prepagos: 0, delivery: 0, pago_motos: 0 };
  const sin_motorizado = [];
  for (const o of ordenes) {
    const c = o.calc;
    if (o.id_motorizado) t.saldo_motos += c.saldo_moto;
    else if (c.cobrable) sin_motorizado.push({ id: o.id, codigo: o.codigo, estado: o.estado, fecha: o.fecha });
    t.saldo_tiendas += c.saldo_tienda;
    t.pago_velox    += c.directo_velox;
    t.prepagos      += c.prepago;
    t.delivery      += c.delivery;
    t.pago_motos    += c.pago_moto;
  }
  const izquierda = t.saldo_motos + t.saldo_tiendas + t.pago_velox + t.prepagos;
  const derecha   = t.delivery - t.pago_motos;
  return {
    ok: izquierda === derecha,
    diferencia: aSoles(izquierda - derecha),
    saldo_motos: aSoles(t.saldo_motos), saldo_tiendas: aSoles(t.saldo_tiendas),
    pago_velox: aSoles(t.pago_velox), prepagos: aSoles(t.prepagos),
    izquierda: aSoles(izquierda),
    delivery: aSoles(t.delivery), pago_motos: aSoles(t.pago_motos),
    derecha: aSoles(derecha),
    sin_motorizado,
  };
}

module.exports = {
  ESTADOS_COBRABLES,
  aCentimos, aSoles,
  calcularOrdenCaja, filtroFecha, ordenesCaja, cuadreCaja,
};
