/* ============================================================
   reporte-tienda.js — "Generar reporte" en Clientes / Tiendas
   Arma el reporte del día de una tienda como IMAGEN (PNG) y le da
   una URL pública para mandarla. Solo admin (el servidor lo exige).

   1. GET /api/caja/tiendas/:id/reporte?fecha=  → datos del día, con la
      plata calculada por el mismo motor que la Caja (caja-motor.js).
   2. Se dibuja a mano en un <canvas> (sin librerías, nada en el
      servidor): dibujarReporteTienda().
   3. POST /api/caja/tiendas/:id/reporte/subida → PUT firmado a R2 con
      un nombre FIJO por tienda + fecha (firmado con HMAC, no se puede
      adivinar): "Generar de nuevo" pisa el mismo archivo y la URL no
      cambia. Va con Cache-Control no-cache.

   La paleta va acá y no en variables CSS: el canvas no las lee, y la
   imagen tiene que salir igual con el tema claro o el oscuro.
   ============================================================ */

var _REP_ANCHO = 1080;      /* ancho de la imagen, en px */
var _REP_MARGEN = 48;
var _REP_FUENTE = '"Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif';

var _REP_COLOR = {
  fondo: '#f4f6fb', tarjeta: '#ffffff', borde: '#e3e7ef',
  marca: '#1d3f8f', marcaTexto: '#ffffff', marcaSuave: '#b9c8ee',
  texto: '#1b2333', tenue: '#6b7487', linea: '#eef1f6',
  verde: '#15803d', verdeFondo: '#e3f5e9',
  ambar: '#b45309', ambarFondo: '#fdf0dc',
  gris: '#6b7487', grisFondo: '#eef1f6',
};

/* estado → [etiqueta, color del texto, fondo del badge] */
var _REP_ESTADOS = {
  'entregado':    ['Entregado',    '#15803d', '#e3f5e9'],
  'ausente':      ['Ausente',      '#b45309', '#fdf0dc'],
  'devolucion':   ['Devolución',   '#7c3aed', '#efe7fd'],
  'reprogramado': ['Reprogramado', '#1d4ed8', '#e4ecfd'],
  'no-entregado': ['No entregado', '#b91c1c', '#fde6e6'],
  'cancelado':    ['Cancelado',    '#4b5563', '#eceef2'],
  'en-proceso':   ['En proceso',   '#0e7490', '#e0f4f8'],
};

var _REP_MEDIOS = {
  'yape-motorizado': 'Yape', 'efectivo-motorizado': 'Efectivo',
  'pago-tienda': 'Pago tienda', 'pago-empresa': 'Pago Velox',
};

/* ── utilidades ─────────────────────────────────────────── */

function _repSoles(n) {
  return 'S/ ' + Math.abs(Number(n) || 0).toFixed(2);
}

/* 'YYYY-MM-DD' → 'lunes 10 de noviembre de 2026' */
function _repFechaLarga(yyyymmdd) {
  var p = String(yyyymmdd).split('-');
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12));
  try {
    return d.toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  } catch (e) {
    return p[2] + '/' + p[1] + '/' + p[0];
  }
}

function _repDiaMes(yyyymmdd) {
  var p = String(yyyymmdd || '').split('-');
  return p.length === 3 ? p[2] + '/' + p[1] : String(yyyymmdd || '');
}

/* Fecha y hora de Lima: 'dd/mm/yyyy hh:mm' */
function _repAhoraLima(fecha) {
  var f = fecha || new Date();
  try {
    var partes = new Intl.DateTimeFormat('es-PE', {
      timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(f);
    var v = {};
    partes.forEach(function(x) { v[x.type] = x.value; });
    return v.day + '/' + v.month + '/' + v.year + ' ' + v.hour + ':' + v.minute;
  } catch (e) {
    return f.toLocaleString();
  }
}

/* Método en dos líneas: [principal, detalle] (el detalle puede ir vacío) */
function _repMetodo(p) {
  var principal = p.metodo_pago === 'sin-cobro' ? 'Sin cobro' : 'Contraentrega';
  var detalle = [];
  if (p.metodo_pago !== 'sin-cobro' && _REP_MEDIOS[p.medio_pago]) detalle.push(_REP_MEDIOS[p.medio_pago]);
  if (p.prepago) detalle.push('Delivery prepagado');
  return [principal, detalle.join(' · ')];
}

/* Texto recortado con "…" para que entre en el ancho */
function _repRecortar(ctx, texto, ancho) {
  texto = String(texto == null ? '' : texto);
  if (ctx.measureText(texto).width <= ancho) return texto;
  while (texto.length > 1 && ctx.measureText(texto + '…').width > ancho) texto = texto.slice(0, -1);
  return texto + '…';
}

function _repRect(ctx, x, y, w, h, r, color) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function _repTexto(ctx, texto, x, y, tam, color, peso, alinear) {
  ctx.font = (peso || 400) + ' ' + tam + 'px ' + _REP_FUENTE;
  ctx.fillStyle = color;
  ctx.textAlign = alinear || 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(texto, x, y);
}

/* saldo → [color, fondo, leyenda] (> 0 la tienda nos debe, < 0 le debemos) */
function _repTonoSaldo(saldo) {
  var c = _REP_COLOR;
  if (saldo > 0.004)  return [c.verde, c.verdeFondo, 'nos debe'];
  if (saldo < -0.004) return [c.ambar, c.ambarFondo, 'le debemos'];
  return [c.gris, c.grisFondo, ''];
}

/* ── dibujo ─────────────────────────────────────────────── */

var _REP_ALTO_FILA = 76;

/* Dibuja el reporte en un canvas nuevo y lo devuelve. datos = la
   respuesta de GET /caja/tiendas/:id/reporte. */
function dibujarReporteTienda(datos, generadoEn) {
  var c = _REP_COLOR, M = _REP_MARGEN, W = _REP_ANCHO, ancho = W - 2 * M;
  var pedidos = datos.pedidos || [];
  var r = datos.resumen || {};

  var altoHeader = 210, altoLiq = datos.liquidado ? 84 : 0, altoResumen = 190;
  var extras = [['Reprogramados', r.reprogramados], ['No entregados', r.no_entregados],
                ['Cancelados', r.cancelados], ['En proceso', r.en_proceso]].filter(function(x) { return x[1] > 0; });
  if (extras.length) altoResumen += 36;
  var altoLista = 70 + Math.max(pedidos.length, 1) * _REP_ALTO_FILA + 16;
  var altoTotales = 300, altoPie = 80;
  var H = altoHeader + altoLiq + altoResumen + altoLista + altoTotales + altoPie + 3 * 24;

  var canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  var ctx = canvas.getContext('2d');
  ctx.fillStyle = c.fondo;
  ctx.fillRect(0, 0, W, H);

  /* Header */
  ctx.fillStyle = c.marca;
  ctx.fillRect(0, 0, W, altoHeader);
  ctx.save();
  ctx.font = '700 22px ' + _REP_FUENTE;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '4px';
  ctx.fillStyle = c.marcaSuave;
  ctx.fillText('VELOX COURIER', M, 62);
  ctx.restore();
  _repTexto(ctx, 'Reporte del día', W - M, 62, 22, c.marcaSuave, 600, 'right');
  ctx.font = '700 46px ' + _REP_FUENTE;
  _repTexto(ctx, _repRecortar(ctx, datos.tienda && datos.tienda.nombre, ancho), M, 128, 46, c.marcaTexto, 700);
  var fl = _repFechaLarga(datos.fecha);
  _repTexto(ctx, fl.charAt(0).toUpperCase() + fl.slice(1), M, 172, 26, c.marcaTexto, 400);
  var y = altoHeader + 24;

  /* Día liquidado */
  if (datos.liquidado) {
    _repRect(ctx, M, y, ancho, altoLiq - 16, 14, c.verdeFondo);
    var liq = 'Día liquidado el ' + _repDiaMes(datos.liquidado.fecha_pago);
    if (datos.liquidado.difiere) liq += '  ·  se pagó ' + (datos.liquidado.saldo_pagado < 0 ? '− ' : '') + _repSoles(datos.liquidado.saldo_pagado);
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

  /* Lista de pedidos */
  _repRect(ctx, M, y, ancho, altoLista, 18, c.tarjeta);
  /* El estado termina antes de x ≈ 810 y el saldo más largo ("− S/ 1000.00")
     empieza después de 820: no se pisan */
  var col = { cliente: M + 24, distrito: M + 280, metodo: M + 450, estado: M + 640, saldo: M + ancho - 24 };
  _repTexto(ctx, 'CLIENTE', col.cliente, y + 44, 18, c.tenue, 700);
  _repTexto(ctx, 'DISTRITO', col.distrito, y + 44, 18, c.tenue, 700);
  _repTexto(ctx, 'MÉTODO', col.metodo, y + 44, 18, c.tenue, 700);
  _repTexto(ctx, 'ESTADO', col.estado, y + 44, 18, c.tenue, 700);
  _repTexto(ctx, 'SALDO', col.saldo, y + 44, 18, c.tenue, 700, 'right');
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
    _repTexto(ctx, '#' + (p.codigo || ''), col.cliente, base + 20, 17, c.tenue, 400);
    ctx.font = '400 22px ' + _REP_FUENTE;
    _repTexto(ctx, _repRecortar(ctx, p.distrito || '—', col.metodo - col.distrito - 20), col.distrito, base, 22, c.texto, 400);
    var met = _repMetodo(p), anchoMet = col.estado - col.metodo - 16;
    ctx.font = '400 20px ' + _REP_FUENTE;
    _repTexto(ctx, _repRecortar(ctx, met[0], anchoMet), col.metodo, met[1] ? base - 6 : base, 20, c.texto, 400);
    if (met[1]) {
      ctx.font = '400 16px ' + _REP_FUENTE;
      _repTexto(ctx, _repRecortar(ctx, met[1], anchoMet), col.metodo, base + 20, 16, c.tenue, 400);
    }

    var e = _REP_ESTADOS[p.estado] || [p.estado, c.gris, c.grisFondo];
    ctx.font = '700 18px ' + _REP_FUENTE;
    var anchoBadge = ctx.measureText(e[0]).width + 28;
    _repRect(ctx, col.estado, base - 26, anchoBadge, 36, 18, e[2]);
    _repTexto(ctx, e[0], col.estado + 14, base - 2, 18, e[1], 700);

    var t = _repTonoSaldo(p.saldo);
    _repTexto(ctx, (p.saldo < -0.004 ? '− ' : '') + _repSoles(p.saldo), col.saldo, base - 6, 23, t[0], 700, 'right');
    if (t[2]) _repTexto(ctx, t[2], col.saldo, base + 20, 16, t[0], 500, 'right');
  });
  y += altoLista + 24;

  /* Totales */
  var tot = datos.totales || {};
  _repRect(ctx, M, y, ancho, altoTotales - 24, 18, c.tarjeta);
  _repTexto(ctx, 'Delivery cobrable', M + 28, y + 52, 24, c.tenue, 500);
  _repTexto(ctx, _repSoles(tot.delivery), M + ancho - 28, y + 52, 26, c.texto, 700, 'right');
  _repTexto(ctx, 'Cobrado al cliente (lo tiene Velox)', M + 28, y + 96, 24, c.tenue, 500);
  _repTexto(ctx, _repSoles(tot.retenido), M + ancho - 28, y + 96, 26, c.texto, 700, 'right');

  var ts = _repTonoSaldo(tot.saldo);
  _repRect(ctx, M + 20, y + 124, ancho - 40, 128, 16, ts[1]);
  _repTexto(ctx, 'SALDO DEL DÍA', M + 48, y + 168, 22, ts[0], 700);
  var leyenda = tot.saldo > 0.004 ? 'La tienda nos debe' : tot.saldo < -0.004 ? 'Le debemos a la tienda' : 'Saldo en cero';
  _repTexto(ctx, leyenda, M + 48, y + 212, 26, ts[0], 500);
  _repTexto(ctx, _repSoles(tot.saldo), M + ancho - 48, y + 220, 64, ts[0], 800, 'right');
  y += altoTotales;

  /* Pie */
  _repTexto(ctx, 'Generado el ' + _repAhoraLima(generadoEn) + '  ·  Velox Courier', W / 2, H - 36, 20, c.tenue, 400, 'center');

  return canvas;
}

/* ── botones y subida (compartidos por todos los reportes) ──
   Cada tipo de reporte se registra con la base de su ruta en la API
   y su función de dibujo. El del motorizado se registra en
   js/reporte-moto.js. Las rutas son <api><id>/reporte y
   <api><id>/reporte/subida. */
var _REP_TIPOS = {
  tienda: { api: '/caja/tiendas/', dibujar: function(d, t) { return dibujarReporteTienda(d, t); } },
};

function _repEsAdmin() {
  try { return (JSON.parse(localStorage.getItem('velox_usuario')) || {}).rol === 'admin'; }
  catch (e) { return false; }
}

function _repEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

/* HTML de los botones "Generar reporte dd/mm" / "Ver imagen" / "Copiar".
   Solo admin: para el resto devuelve ''. Al pintarse, pregunta si ya
   hay un reporte de ese día para mostrar su URL y "Copiar". */
function _repBotonesHTML(tipo, idQuien, fecha) {
  if (!_REP_TIPOS[tipo] || !_repEsAdmin() || !idQuien || !fecha) return '';
  var id = 'rep-' + tipo + '-' + idQuien + '-' + fecha;
  setTimeout(function() { _repConsultarExistente(id); }, 0);
  return '<span id="' + id + '" class="reporte-tienda" data-tipo="' + _repEsc(tipo) + '" data-id="' + _repEsc(idQuien) + '" data-fecha="' + _repEsc(fecha) + '" ' +
      'style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap">' +
      '<button type="button" class="btn btn-sm" data-rep="generar" onclick="generarReporteTienda(this)" ' +
        'title="Crea una imagen del reporte del ' + _repEsc(_repDiaMes(fecha)) + ' y le da una URL para mandar">' +
        '<i class="ti ti-photo"></i> <span data-rep="texto">Generar reporte ' + _repEsc(_repDiaMes(fecha)) + '</span></button>' +
      '<a data-rep="link" target="_blank" rel="noopener" style="display:none;font-size:12px"></a>' +
      '<button type="button" class="btn btn-sm" data-rep="copiar" onclick="copiarUrlReporte(this)" style="display:none" title="Copiar la URL de la imagen">' +
        '<i class="ti ti-copy"></i> Copiar</button>' +
    '</span>';
}

/* Detalle de una tienda (js/clientes.js) */
window.botonesReporteTiendaHTML = function(idTienda, fecha) {
  return _repBotonesHTML('tienda', idTienda, fecha);
};

/* Base de las rutas del reporte del contenedor: '/api/caja/tiendas/15' */
function _repRutaBase(cont) {
  var cfg = _REP_TIPOS[cont.getAttribute('data-tipo')];
  return cfg ? API + cfg.api + cont.getAttribute('data-id') : null;
}

function _repMostrarUrl(cont, url, generadoEn) {
  var link = cont.querySelector('[data-rep="link"]');
  var copiar = cont.querySelector('[data-rep="copiar"]');
  var texto = cont.querySelector('[data-rep="texto"]');
  cont.setAttribute('data-url', url);
  if (link) {
    link.href = url;
    link.textContent = 'Ver imagen' + (generadoEn ? ' (' + _repAhoraLima(new Date(generadoEn)).slice(-5) + ')' : '');
    link.style.display = '';
  }
  if (copiar) { copiar.style.display = ''; copiar.innerHTML = '<i class="ti ti-copy"></i> Copiar'; }
  if (texto) texto.textContent = 'Generar de nuevo';
}

async function _repConsultarExistente(id) {
  var cont = document.getElementById(id);
  var base = cont && _repRutaBase(cont);
  if (!base) return;
  try {
    var r = await fetch(base + '/reporte?fecha=' + cont.getAttribute('data-fecha'));
    if (!r.ok) return;
    var d = await r.json();
    if (d.reporte && d.reporte.url) _repMostrarUrl(cont, d.reporte.url, d.reporte.generado_en);
  } catch (e) { /* sin señal: queda solo "Generar reporte" */ }
}

function _repCanvasABlob(canvas) {
  return new Promise(function(resolve, reject) {
    canvas.toBlob(function(b) { b ? resolve(b) : reject(new Error('No se pudo armar la imagen')); }, 'image/png');
  });
}

var _repGenerando = false;

window.generarReporteTienda = async function(btn) {
  var cont = btn && btn.closest('.reporte-tienda');
  if (!cont || _repGenerando) return;
  var cfg = _REP_TIPOS[cont.getAttribute('data-tipo')];
  var base = _repRutaBase(cont);
  if (!cfg || !base) return;
  var fecha = cont.getAttribute('data-fecha');
  var htmlBtn = btn.innerHTML;
  _repGenerando = true;
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader"></i> Generando...';

  var blob = null;
  try {
    var r = await fetch(base + '/reporte?fecha=' + fecha);
    var datos = await r.json().catch(function() { return {}; });
    if (!r.ok) throw new Error(datos.error || 'No se pudieron traer los datos del día');

    var ahora = new Date();
    blob = await _repCanvasABlob(cfg.dibujar(datos, ahora));

    var s = await fetch(base + '/reporte/subida', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fecha: fecha }),
    });
    var subida = await s.json().catch(function() { return {}; });
    if (!s.ok) throw new Error(subida.error || 'No se pudo preparar la subida');

    var put = await fetch(subida.uploadUrl, { method: 'PUT', headers: subida.headers, body: blob, credentials: 'omit' });
    if (!put.ok) throw new Error('R2 rechazó la imagen (HTTP ' + put.status + ')');

    _repMostrarUrl(cont, subida.publicUrl, ahora.toISOString());
    if (typeof showNotif === 'function') showNotif('Reporte listo: copiá la URL con "Copiar"', 3500);
  } catch (err) {
    console.error('Reporte de tienda:', err);
    var msg = err && err.message ? err.message : 'Error';
    /* Un PUT bloqueado por CORS llega como TypeError sin status */
    if (err instanceof TypeError && blob) msg = 'No se pudo subir la imagen a R2 (revisá que el CORS del bucket permita cache-control)';
    if (typeof showNotif === 'function') showNotif('No se generó el reporte: ' + msg, 7000);
  } finally {
    _repGenerando = false;
    btn.disabled = false;
    if (btn.innerHTML.indexOf('Generando') !== -1) btn.innerHTML = htmlBtn;
    if (cont.getAttribute('data-url')) {
      var t = btn.querySelector('[data-rep="texto"]');
      if (t) t.textContent = 'Generar de nuevo';
    }
  }
};

window.copiarUrlReporte = async function(btn) {
  var cont = btn && btn.closest('.reporte-tienda');
  var url = cont && cont.getAttribute('data-url');
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
  } catch (err) {
    /* Sin permiso de portapapeles (http por IP): a la antigua, como en js/accesos.js */
    var ta = document.createElement('textarea');
    ta.value = url;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* nada más que hacer */ }
    ta.remove();
  }
  btn.innerHTML = '<i class="ti ti-check"></i> Copiado';
};
