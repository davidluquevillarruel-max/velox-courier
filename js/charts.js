/* ============================================================
   charts.js — Gráfico de barras + lógica de Evidencias
   Todos los datos se calculan desde ORDENES (pedidos.js)
   En producción: reemplazar con fetch() a la API.
   ============================================================ */

/* ════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════ */
function _fechaHaceDias(n) {
  var d = new Date();
  d.setDate(d.getDate() - n);
  var mm = ('0'+(d.getMonth()+1)).slice(-2);
  var dd = ('0'+d.getDate()).slice(-2);
  return d.getFullYear() + '-' + mm + '-' + dd;
}

function _labelDia(yyyymmdd) {
  var meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  var p = yyyymmdd.split('-');
  return p[2] + ' ' + meses[parseInt(p[1])-1];
}

/* Calcular KPIs desde ORDENES filtrando por rango de fechas */
function _calcularKPIsEvidencias(fechaDesde, fechaHasta) {
  if (typeof ORDENES === 'undefined') return null;

  var filtradas = ORDENES.filter(function(o) {
    return o.fecha >= fechaDesde && o.fecha <= fechaHasta;
  });

  var total        = filtradas.length;
  var entregados   = filtradas.filter(function(o){ return o.estado === 'entregado'; }).length;
  var noEntregados = filtradas.filter(function(o){ return o.estado === 'no-entregado'; }).length;
  var ausentes     = filtradas.filter(function(o){ return o.estado === 'ausente'; }).length;
  var reprogramados= filtradas.filter(function(o){ return o.estado === 'reprogramado'; }).length;
  var cancelados   = filtradas.filter(function(o){ return o.estado === 'cancelado'; }).length;

  var cobrable = entregados + noEntregados;
  var tasa     = cobrable > 0 ? ((entregados / cobrable) * 100).toFixed(1) + '%' : '0%';

  var ingreso = filtradas.reduce(function(s, o) {
    if (o.estado === 'entregado' || o.estado === 'no-entregado') {
      return s + (parseFloat(o.delivery) || 0);
    }
    return s;
  }, 0);

  var saldoPorCobrar = filtradas.reduce(function(s, o) {
    if ((o.estado === 'entregado' || o.estado === 'no-entregado') && o.metodoPago !== 'pago-tienda') {
      return s + (parseFloat(o.delivery) || 0);
    }
    return s;
  }, 0);

  return {
    total, entregados, noEntregados, ausentes, reprogramados, cancelados,
    tasa, ingreso, saldoPorCobrar,
  };
}

/* Calcular stats por fecha para el gráfico de barras */
function _calcularPorFecha(fechaDesde, fechaHasta) {
  if (typeof ORDENES === 'undefined') return [];
  var mapaFecha = {};
  ORDENES.forEach(function(o) {
    if (o.fecha < fechaDesde || o.fecha > fechaHasta) return;
    if (!mapaFecha[o.fecha]) mapaFecha[o.fecha] = { entregados:0, noEntregados:0, reprogramados:0 };
    if (o.estado === 'entregado')    mapaFecha[o.fecha].entregados++;
    if (o.estado === 'no-entregado' || o.estado === 'ausente') mapaFecha[o.fecha].noEntregados++;
    if (o.estado === 'reprogramado') mapaFecha[o.fecha].reprogramados++;
  });
  return Object.keys(mapaFecha).sort().map(function(f) {
    return Object.assign({ fecha: f }, mapaFecha[f]);
  });
}

/* ════════════════════════════════════════════
   GRÁFICO DE BARRAS
════════════════════════════════════════════ */
function initBarChart() {
  var container = document.getElementById('bar-chart');
  if (!container) return;
  container.innerHTML = '';

  /* Últimos 7 días */
  var fechaHasta = _fechaHaceDias(0);
  var fechaDesde = _fechaHaceDias(6);
  var datos      = _calcularPorFecha(fechaDesde, fechaHasta);

  /* Si no hay datos reales, mostrar mensaje */
  if (datos.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:var(--color-text-tertiary);font-size:13px;padding:20px">Sin datos para los últimos 7 días</div>';
    return;
  }

  var maxVal    = Math.max.apply(null, datos.map(function(d){ return d.entregados + d.noEntregados + d.reprogramados; })) || 1;
  var maxHeight = 110;

  datos.forEach(function(d) {
    var h1 = Math.round((d.entregados    / maxVal) * maxHeight);
    var h2 = Math.round((d.noEntregados  / maxVal) * maxHeight);
    var h3 = Math.round((d.reprogramados / maxVal) * maxHeight);

    var barWrap = document.createElement('div');
    barWrap.className = 'bar-wrap';
    barWrap.innerHTML =
      '<div class="bar-stack">' +
        '<div class="bar fill-green" style="height:' + h1 + 'px" title="' + d.entregados + ' entregados"></div>' +
        '<div class="bar fill-red"   style="height:' + h2 + 'px" title="' + d.noEntregados + ' no entregados"></div>' +
        '<div class="bar" style="height:' + h3 + 'px;background:var(--color-amber);border-radius:3px 3px 0 0;min-height:' + (h3>0?'4':'0') + 'px" title="' + d.reprogramados + ' reprogramados"></div>' +
      '</div>' +
      '<div class="bar-label">' + _labelDia(d.fecha) + '</div>';
    container.appendChild(barWrap);
  });
}

/* ════════════════════════════════════════════
   INIT EVIDENCIAS — llamado desde navigation.js
════════════════════════════════════════════ */
window.initEvidencias = function() {
  initBarChart();
  _renderKPIsEvidencias('hoy');
  _renderTablaMotorizadosEv();
  _renderTablaTiendasEv();
};

/* ── Render KPIs según rango ── */
function _renderKPIsEvidencias(rango) {
  var hoy   = _fechaHaceDias(0);
  var desde, hasta;

  if (rango === 'hoy') {
    desde = hoy; hasta = hoy;
  } else if (rango === 'semana') {
    desde = _fechaHaceDias(6); hasta = hoy;
  } else {
    desde = _fechaHaceDias(29); hasta = hoy;
  }

  var k = _calcularKPIsEvidencias(desde, hasta);
  if (!k) return;

  var set = function(id, v){ var el = document.getElementById(id); if (el) el.textContent = v; };
  set('ev-total',        k.total);
  set('ev-entregados',   k.entregados);
  set('ev-no-entregados',k.noEntregados);
  set('ev-tasa',         k.tasa);
  set('ev-ingreso',      'S/ ' + k.ingreso.toFixed(2));
  set('ev-ausentes',     k.ausentes);
  set('ev-reprog',       k.reprogramados);
  set('ev-saldo',        'S/ ' + k.saldoPorCobrar.toFixed(2));
  set('ev-tiempo',       '—');  /* requiere timestamps reales */
}

/* ── Tabla rendimiento por motorizado ── */
function _renderTablaMotorizadosEv() {
  var tbody = document.getElementById('tbody-ev-motos');
  if (!tbody || typeof MOTORIZADOS === 'undefined' || typeof ORDENES === 'undefined') return;

  var hoy   = _fechaHaceDias(0);
  var desde = _filtroEvidenciaDesde || _fechaHaceDias(6);
  var hasta = _filtroEvidenciaHasta || hoy;

  tbody.innerHTML = MOTORIZADOS.map(function(m) {
    var ordenes = ORDENES.filter(function(o) {
      return o.motorizado && o.motorizado.trim().toUpperCase() === m.nombre.toUpperCase()
        && o.fecha >= desde && o.fecha <= hasta;
    });
    if (ordenes.length === 0) return '';

    var entregados   = ordenes.filter(function(o){ return o.estado === 'entregado'; }).length;
    var noEntregados = ordenes.filter(function(o){ return o.estado === 'no-entregado'; }).length;
    var reprog       = ordenes.filter(function(o){ return o.estado === 'reprogramado'; }).length;
    var ausentes     = ordenes.filter(function(o){ return o.estado === 'ausente'; }).length;
    var cobrable     = entregados + noEntregados;
    var tasa         = cobrable > 0 ? Math.round((entregados/cobrable)*100) : 0;
    var tasaColor    = tasa >= 75 ? 'var(--color-green)' : tasa >= 50 ? 'var(--color-amber)' : 'var(--color-red-text)';
    var ingreso      = ordenes.reduce(function(s,o){
      return s + ((o.estado==='entregado'||o.estado==='no-entregado') ? (parseFloat(o.delivery)||0) : 0);
    }, 0);

    return '<tr>' +
      '<td><strong>' + m.nombre + '</strong></td>' +
      '<td>' + (m.zona || '—') + '</td>' +
      '<td>' + ordenes.length + '</td>' +
      '<td style="color:var(--color-green);font-weight:600">' + entregados + '</td>' +
      '<td style="color:var(--color-red-text);font-weight:600">' + noEntregados + '</td>' +
      '<td style="color:var(--color-purple-text);font-weight:600">' + reprog + '</td>' +
      '<td style="color:var(--color-amber-text);font-weight:600">' + ausentes + '</td>' +
      '<td><span style="color:' + tasaColor + ';font-weight:700">' + tasa + '%</span></td>' +
      '<td style="font-weight:600">S/ ' + ingreso.toFixed(2) + '</td>' +
    '</tr>';
  }).filter(Boolean).join('') ||
  '<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--color-text-tertiary)">Sin datos para el período</td></tr>';
}

/* ── Tabla rendimiento por tienda ── */
function _renderTablaTiendasEv() {
  var tbody = document.getElementById('tbody-ev-tiendas');
  if (!tbody || typeof TIENDAS_REGISTRO === 'undefined' || typeof ORDENES === 'undefined') return;

  var hoy   = _fechaHaceDias(0);
  var desde = _filtroEvidenciaDesde || _fechaHaceDias(6);
  var hasta = _filtroEvidenciaHasta || hoy;

  tbody.innerHTML = TIENDAS_REGISTRO.map(function(t) {
    var ordenes = ORDENES.filter(function(o) {
      return o.tienda && o.tienda.trim().toUpperCase() === t.nombre.toUpperCase()
        && o.fecha >= desde && o.fecha <= hasta;
    });
    if (ordenes.length === 0) return '';

    var entregados   = ordenes.filter(function(o){ return o.estado === 'entregado'; }).length;
    var noEntregados = ordenes.filter(function(o){ return o.estado === 'no-entregado'; }).length;
    var reprog       = ordenes.filter(function(o){ return o.estado === 'reprogramado'; }).length;
    var cobrable     = entregados + noEntregados;
    var tasa         = cobrable > 0 ? Math.round((entregados/cobrable)*100) : 0;
    var tasaColor    = tasa >= 75 ? 'var(--color-green)' : tasa >= 50 ? 'var(--color-amber)' : 'var(--color-red-text)';
    var facturado    = ordenes.reduce(function(s,o){
      return s + ((o.estado==='entregado'||o.estado==='no-entregado') ? (parseFloat(o.delivery)||0) : 0);
    }, 0);
    var cobrado      = ordenes.reduce(function(s,o){ return s + (parseFloat(o.montoCobrado)||0); }, 0);
    var saldo        = facturado - ordenes.reduce(function(s,o){ return s + (parseFloat(o.montoProducto)||0); }, 0);
    var saldoClass   = saldo > 0 ? 'balance-pos' : saldo < 0 ? 'balance-neg' : 'balance-zero';

    return '<tr>' +
      '<td><strong>' + t.nombre + '</strong></td>' +
      '<td>' + ordenes.length + '</td>' +
      '<td style="color:var(--color-green);font-weight:600">' + entregados + '</td>' +
      '<td style="color:var(--color-red-text);font-weight:600">' + noEntregados + '</td>' +
      '<td style="color:var(--color-purple-text);font-weight:600">' + reprog + '</td>' +
      '<td><span style="color:' + tasaColor + ';font-weight:700">' + tasa + '%</span></td>' +
      '<td>S/ ' + facturado.toFixed(2) + '</td>' +
      '<td>S/ ' + cobrado.toFixed(2) + '</td>' +
      '<td class="' + saldoClass + '">S/ ' + Math.abs(saldo).toFixed(2) + '</td>' +
    '</tr>';
  }).filter(Boolean).join('') ||
  '<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--color-text-tertiary)">Sin datos para el período</td></tr>';
}

/* Filtro de rango activo en evidencias */
var _filtroEvidenciaDesde = '';
var _filtroEvidenciaHasta = '';

window.setRangoEvidencias = function(btn, rango) {
  document.querySelectorAll('.ev-rango').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active');

  var hoy = _fechaHaceDias(0);
  if (rango === 'hoy')    { _filtroEvidenciaDesde = hoy; _filtroEvidenciaHasta = hoy; }
  if (rango === 'semana') { _filtroEvidenciaDesde = _fechaHaceDias(6); _filtroEvidenciaHasta = hoy; }
  if (rango === 'mes')    { _filtroEvidenciaDesde = _fechaHaceDias(29); _filtroEvidenciaHasta = hoy; }

  _renderKPIsEvidencias(rango);
  _renderTablaMotorizadosEv();
  _renderTablaTiendasEv();
  initBarChart();
};
