/* ============================================================
   reporte-moto.js — "Generar reporte" en el detalle de un motorizado
   Igual que el reporte de tienda (D-017), con los helpers de
   js/reporte-tienda.js (va DESPUÉS de ese archivo en index.html):
   mismo canvas, misma subida a R2 (reportes-moto/<id>-<fecha>-<HMAC>.png),
   mismos botones. Solo admin.

   Regla de la plata (caja-motor.js, la arma GET
   /api/caja/motorizados/:id/reporte):
   · El moto entrega TODO lo que pasó por sus manos: efectivo + Yape.
   · Velox le paga su delivery aparte (pago_moto): no se descuenta de
     lo que entrega.
   · Pago Velox y Pago tienda no pasaron por él: van con "—".
   · Neto = lo que entrega − su pago (> 0 entrega, < 0 Velox le paga).
   ============================================================ */

/* Qué cobró el moto en ese pedido: [monto o null, etiqueta, color].
   Con monto, la etiqueta es el tag (Efectivo / Yape); sin monto, la
   nota de por qué no hay nada que entregar. */
function _repCobroMoto(p) {
  var c = _REP_COLOR;
  if (p.efectivo > 0) return [p.efectivo, 'Efectivo', '#15803d'];
  if (p.yape > 0)     return [p.yape, 'Yape', '#6d28d9'];
  if (p.directo_velox > 0) return [null, 'Pago a Velox', c.tenue];
  if (p.estado === 'entregado' && p.metodo_pago === 'contraentrega') {
    return [null, p.medio_pago === 'pago-tienda' ? 'Pago tienda' : 'Medio por definir', c.tenue];
  }
  if (p.estado === 'entregado' && p.metodo_pago === 'sin-cobro') return [null, 'Sin cobro', c.tenue];
  return [null, '', c.tenue];          /* ausente, reprogramado, etc.: "—" */
}

function dibujarReporteMoto(datos, generadoEn) {
  var c = _REP_COLOR, M = _REP_MARGEN, W = _REP_ANCHO, ancho = W - 2 * M;
  var pedidos = datos.pedidos || [];
  var r = datos.resumen || {};
  var tot = datos.totales || {};

  var altoHeader = 230, altoLiq = datos.liquidado ? 84 : 0, altoResumen = 190;
  var extras = [['Reprogramados', r.reprogramados], ['No entregados', r.no_entregados],
                ['Cancelados', r.cancelados], ['En proceso', r.en_proceso]].filter(function(x) { return x[1] > 0; });
  if (extras.length) altoResumen += 36;
  var altoLista = 70 + Math.max(pedidos.length, 1) * _REP_ALTO_FILA + 16;
  var altoTotales = 420, altoPie = 80;
  var H = altoHeader + altoLiq + altoResumen + altoLista + altoTotales + altoPie + 3 * 24;

  var canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  var ctx = canvas.getContext('2d');
  ctx.fillStyle = c.fondo;
  ctx.fillRect(0, 0, W, H);

  /* Header: marca, "Reporte del día", "Motorizado", nombre, fecha */
  ctx.fillStyle = c.marca;
  ctx.fillRect(0, 0, W, altoHeader);
  ctx.save();
  ctx.font = '700 22px ' + _REP_FUENTE;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '4px';
  ctx.fillStyle = c.marcaSuave;
  ctx.fillText('VELOX COURIER', M, 62);
  ctx.restore();
  _repTexto(ctx, 'Reporte del día', W - M, 62, 22, c.marcaSuave, 600, 'right');
  _repTexto(ctx, 'Motorizado', M, 104, 22, c.marcaSuave, 600);
  ctx.font = '700 46px ' + _REP_FUENTE;
  _repTexto(ctx, _repRecortar(ctx, datos.motorizado && datos.motorizado.nombre, ancho), M, 152, 46, c.marcaTexto, 700);
  var fl = _repFechaLarga(datos.fecha);
  _repTexto(ctx, fl.charAt(0).toUpperCase() + fl.slice(1), M, 194, 26, c.marcaTexto, 400);
  var y = altoHeader + 24;

  /* Día liquidado */
  if (datos.liquidado) {
    _repRect(ctx, M, y, ancho, altoLiq - 16, 14, c.verdeFondo);
    var liq = 'Día liquidado el ' + _repDiaMes(datos.liquidado.fecha_pago);
    if (datos.liquidado.difiere) liq += '  ·  se liquidó ' + (datos.liquidado.saldo_pagado < 0 ? '− ' : '') + _repSoles(datos.liquidado.saldo_pagado);
    _repTexto(ctx, '✓  ' + liq, M + 24, y + 44, 26, c.verde, 600);
    y += altoLiq;
  }

  /* Resumen: pedidos, entregados, ausentes (+ devoluciones si hay) */
  var cajas = [['Pedidos', r.pedidos, c.marca], ['Entregados', r.entregados, c.verde], ['Ausentes', r.ausentes, c.ambar]];
  if (r.devoluciones > 0) cajas.push(['Devoluciones', r.devoluciones, '#7c3aed']);
  var sep = 20, anchoCaja = (ancho - sep * (cajas.length - 1)) / cajas.length;
  cajas.forEach(function(k, i) {
    var x = M + i * (anchoCaja + sep);
    _repRect(ctx, x, y, anchoCaja, 150, 18, c.tarjeta);
    _repTexto(ctx, String(k[1] || 0), x + anchoCaja / 2, y + 88, 60, k[2], 700, 'center');
    _repTexto(ctx, k[0], x + anchoCaja / 2, y + 128, 24, c.tenue, 500, 'center');
  });
  y += 150;
  if (extras.length) {
    _repTexto(ctx, extras.map(function(x) { return x[0] + ': ' + x[1]; }).join('   ·   '), M + 4, y + 34, 22, c.tenue, 500);
    y += 36;
  }
  y += 40;

  /* Lista: cliente, distrito, estado, cobró */
  _repRect(ctx, M, y, ancho, altoLista, 18, c.tarjeta);
  var col = { cliente: M + 24, distrito: M + 330, estado: M + 570, cobro: M + ancho - 24 };
  _repTexto(ctx, 'CLIENTE', col.cliente, y + 44, 18, c.tenue, 700);
  _repTexto(ctx, 'DISTRITO', col.distrito, y + 44, 18, c.tenue, 700);
  _repTexto(ctx, 'ESTADO', col.estado, y + 44, 18, c.tenue, 700);
  _repTexto(ctx, 'COBRÓ', col.cobro, y + 44, 18, c.tenue, 700, 'right');
  var fy = y + 70;

  if (!pedidos.length) {
    _repTexto(ctx, 'No hay pedidos para este día.', M + ancho / 2, fy + 46, 24, c.tenue, 500, 'center');
  }
  pedidos.forEach(function(p, i) {
    var top = fy + i * _REP_ALTO_FILA;
    ctx.fillStyle = c.linea;
    ctx.fillRect(M + 20, top, ancho - 40, 2);
    var base = top + 46;

    ctx.font = '600 24px ' + _REP_FUENTE;
    _repTexto(ctx, _repRecortar(ctx, p.dest_nombre || '—', col.distrito - col.cliente - 20), col.cliente, base - 6, 24, c.texto, 600);
    ctx.font = '400 17px ' + _REP_FUENTE;
    _repTexto(ctx, _repRecortar(ctx, '#' + (p.codigo || '') + (p.tienda ? ' · ' + p.tienda : ''), col.distrito - col.cliente - 20),
      col.cliente, base + 20, 17, c.tenue, 400);
    ctx.font = '400 22px ' + _REP_FUENTE;
    _repTexto(ctx, _repRecortar(ctx, p.distrito || '—', col.estado - col.distrito - 20), col.distrito, base, 22, c.texto, 400);

    var e = _REP_ESTADOS[p.estado] || [p.estado, c.gris, c.grisFondo];
    ctx.font = '700 18px ' + _REP_FUENTE;
    var anchoBadge = ctx.measureText(e[0]).width + 28;
    _repRect(ctx, col.estado, base - 26, anchoBadge, 36, 18, e[2]);
    _repTexto(ctx, e[0], col.estado + 14, base - 2, 18, e[1], 700);

    /* Cobró: monto + tag (Efectivo / Yape), o "—" con su nota */
    var cb = _repCobroMoto(p);
    if (cb[0] != null) {
      _repTexto(ctx, _repSoles(cb[0]), col.cobro, base - 6, 23, c.texto, 700, 'right');
      ctx.font = '700 15px ' + _REP_FUENTE;
      var anchoTag = ctx.measureText(cb[1]).width + 20;
      _repRect(ctx, col.cobro - anchoTag, base + 6, anchoTag, 24, 12, cb[2] + '1f');
      _repTexto(ctx, cb[1], col.cobro - anchoTag / 2, base + 23, 15, cb[2], 700, 'center');
    } else {
      _repTexto(ctx, '—', col.cobro, cb[1] ? base - 6 : base, 23, c.tenue, 700, 'right');
      if (cb[1]) _repTexto(ctx, cb[1], col.cobro, base + 20, 16, c.tenue, 500, 'right');
    }
  });
  y += altoLista + 24;

  /* Totales */
  _repRect(ctx, M, y, ancho, altoTotales - 24, 18, c.tarjeta);
  _repTexto(ctx, 'Efectivo cobrado', M + 28, y + 52, 24, c.tenue, 500);
  _repTexto(ctx, _repSoles(tot.efectivo), M + ancho - 28, y + 52, 26, c.texto, 700, 'right');
  _repTexto(ctx, 'Yape cobrado', M + 28, y + 96, 24, c.tenue, 500);
  _repTexto(ctx, _repSoles(tot.yape), M + ancho - 28, y + 96, 26, c.texto, 700, 'right');

  /* Dos destacados: lo que entrega (ámbar) y lo que le pagan (verde) */
  var mitad = (ancho - 40 - 20) / 2, yb = y + 124;
  _repRect(ctx, M + 20, yb, mitad, 150, 16, c.ambarFondo);
  _repTexto(ctx, 'A ENTREGAR A VELOX', M + 44, yb + 42, 20, c.ambar, 700);
  _repTexto(ctx, 'Todo lo cobrado (efectivo + Yape)', M + 44, yb + 70, 17, c.ambar, 400);
  _repTexto(ctx, _repSoles(tot.a_entregar), M + 44, yb + 126, 48, c.ambar, 800);
  var xv = M + 20 + mitad + 20;
  _repRect(ctx, xv, yb, mitad, 150, 16, c.verdeFondo);
  _repTexto(ctx, 'VELOX TE PAGA', xv + 24, yb + 42, 20, c.verde, 700);
  _repTexto(ctx, 'Tu delivery del día', xv + 24, yb + 70, 17, c.verde, 400);
  _repTexto(ctx, _repSoles(tot.pago_moto), xv + 24, yb + 126, 48, c.verde, 800);

  /* Neto: lo que entrega después de su pago */
  var neto = Number(tot.neto) || 0;
  var textoNeto = neto > 0.004 ? 'Neto: entregás ' + _repSoles(neto) + ' a Velox (después de tu pago)'
    : neto < -0.004 ? 'Neto: Velox te paga ' + _repSoles(neto) + ' (después de lo que entregás)'
    : 'Neto: quedan a mano (S/ 0.00)';
  _repRect(ctx, M + 20, yb + 172, ancho - 40, 70, 14, c.grisFondo);
  ctx.font = '700 26px ' + _REP_FUENTE;
  _repTexto(ctx, _repRecortar(ctx, textoNeto, ancho - 88), M + 44, yb + 216, 26, c.texto, 700);

  /* Pie */
  _repTexto(ctx, 'Generado el ' + _repAhoraLima(generadoEn) + '  ·  Velox Courier', W / 2, H - 36, 20, c.tenue, 400, 'center');

  return canvas;
}

/* Registro en los reportes compartidos (js/reporte-tienda.js) */
if (typeof _REP_TIPOS !== 'undefined') {
  _REP_TIPOS.moto = { api: '/caja/motorizados/', dibujar: function(d, t) { return dibujarReporteMoto(d, t); } };
}

/* Detalle del motorizado (js/motorizados.js) */
window.botonesReporteMotoHTML = function(idMoto, fecha) {
  return typeof _repBotonesHTML === 'function' ? _repBotonesHTML('moto', idMoto, fecha) : '';
};
