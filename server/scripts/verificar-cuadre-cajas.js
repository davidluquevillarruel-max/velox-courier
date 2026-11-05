/* ============================================================
   server/scripts/verificar-cuadre-cajas.js
   Control de cuadre de la Caja. SOLO LECTURA: no escribe nada.

     saldo motos + saldo tiendas + Pago Velox + prepagos
       = delivery − pago a motos

   Uso (desde server/):
     node scripts/verificar-cuadre-cajas.js
     node scripts/verificar-cuadre-cajas.js --desde=2026-10-20
     node scripts/verificar-cuadre-cajas.js --desde=2026-10-16 --hasta=2026-11-03
   Solo --desde = ese único día, como en la pantalla.

   Sale con código 1 si no cuadra. Los días ya pagados cuyo monto
   guardado difiere de lo que da hoy se listan aparte y no hacen
   fallar: son esperables (regla vieja, orden editada después).
   ============================================================ */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { getPool } = require('../db');
const { aCentimos, aSoles, filtroFecha, ordenesCaja, cuadreCaja } = require('../caja-motor');

function argumento(nombre) {
  const a = process.argv.find(x => x.startsWith(`--${nombre}=`));
  const v = a ? a.split('=')[1] : '';
  if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    console.error(`--${nombre} tiene que ser YYYY-MM-DD`);
    process.exit(2);
  }
  return v;
}

/* Días pagados de una caja cuyo saldo guardado difiere del calculado.
   saldoPorDia: Map 'clave|fecha' → céntimos calculados hoy. */
function diferencias(filas, saldoPorDia) {
  return filas
    .map(f => ({
      nombre: f.nombre, fecha: f.fecha,
      guardado: aSoles(aCentimos(f.a_favor) - aCentimos(f.en_contra)),
      hoy_da: aSoles(saldoPorDia.get(`${f.id}|${f.fecha}`) || 0),
    }))
    .filter(f => f.guardado !== f.hoy_da);
}

(async () => {
  const desde = argumento('desde');
  const hasta = argumento('hasta');
  const pool = await getPool();

  const ordenes = await ordenesCaja(pool, { desde, hasta });
  const c = cuadreCaja(ordenes);

  console.log(`\nPeríodo: ${desde || 'inicio'} → ${hasta || (desde ? desde : 'hoy')} · ${ordenes.length} órdenes cobrables\n`);
  console.table({
    'Saldo motos':    c.saldo_motos,
    'Saldo tiendas':  c.saldo_tiendas,
    'Pago Velox':     c.pago_velox,
    'Prepagos':       c.prepagos,
    '= Izquierda':    c.izquierda,
    'Delivery':       c.delivery,
    'Pago a motos':   c.pago_motos,
    '= Derecha':      c.derecha,
  });

  if (c.sin_motorizado.length) {
    console.log(`\nCobrables sin motorizado (${c.sin_motorizado.length}):`);
    console.table(c.sin_motorizado);
  }

  /* Días ya pagados: guardado contra lo que da hoy */
  const porTienda = new Map(), porMoto = new Map();
  const sumar = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
  for (const o of ordenes) {
    sumar(porTienda, `${o.id_tienda}|${o.fecha}`, o.calc.saldo_tienda);
    if (o.id_motorizado) sumar(porMoto, `${o.id_motorizado}|${o.fecha}`, o.calc.saldo_moto);
  }

  const reqT = pool.request();
  const fT = filtroFecha(reqT, desde, hasta, 'cp.fecha_ciclo');
  const pagTiendas = await reqT.query(`
    SELECT cp.id_tienda AS id, t.nombre, CONVERT(varchar, cp.fecha_ciclo, 23) AS fecha,
           cp.monto_cobrar AS a_favor, cp.monto_devolver AS en_contra
    FROM caja_pagos_tiendas cp JOIN tiendas t ON t.id = cp.id_tienda
    WHERE cp.pagado = 1 ${fT}`);
  const reqM = pool.request();
  const fM = filtroFecha(reqM, desde, hasta, 'cm.fecha_dia');
  const pagMotos = await reqM.query(`
    SELECT cm.id_motorizado AS id, m.nombre, CONVERT(varchar, cm.fecha_dia, 23) AS fecha,
           cm.monto_cobrado AS a_favor, cm.monto_a_pagar AS en_contra
    FROM caja_pagos_motorizados cm JOIN motorizados m ON m.id = cm.id_motorizado
    WHERE cm.pagado = 1 ${fM}`);

  const difT = diferencias(pagTiendas.recordset, porTienda);
  const difM = diferencias(pagMotos.recordset, porMoto);
  console.log(`\nDías pagados: ${pagTiendas.recordset.length} de tiendas, ${pagMotos.recordset.length} de motos.`);
  if (difT.length) { console.log(`Tiendas: difieren de lo pagado (${difT.length}):`); console.table(difT); }
  if (difM.length) { console.log(`Motos: difieren de lo pagado (${difM.length}):`); console.table(difM); }

  await pool.close();
  if (c.ok) {
    console.log(`\nCUADRA: ${c.izquierda.toFixed(2)} = ${c.derecha.toFixed(2)}\n`);
  } else {
    console.log(`\nNO CUADRA: diferencia S/ ${c.diferencia.toFixed(2)}\n`);
    process.exit(1);
  }
})().catch(e => { console.error(e.message); process.exit(1); });
