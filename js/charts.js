/* ============================================================
   charts.js — Dashboard de Evidencias y métricas
   Todos los datos se obtienen de la API (/api/ordenes, etc.)
   Estados con cobro: entregado, ausente
   ============================================================ */
var _EV_API = '/api';
var _EC_EV  = ['entregado', 'ausente']; /* estados que generan cobro */

/* Filtro de rango activo en evidencias */
var _filtroEvidenciaDesde = '';
var _filtroEvidenciaHasta = '';
var _filtroEvidenciaMoto  = ''; /* nombre del motorizado si sesión es motorizado */

function _obtenerSesionEv() {
  var raw = localStorage.getItem('velox_usuario');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch(e) { return null; }
}

/* Caché de datos cargados */
var _evOrdenes    = [];
var _evMotos      = [];
var _evTiendas    = [];

/* ════════════════════════════════════════════
   HELPERS DE FECHA
════════════════════════════════════════════ */
function _fechaHaceDias(n) {
  var d = new Date();
  d.setDate(d.getDate() - n);
  var mm = ('0'+(d.getMonth()+1)).slice(-2);
  var dd = ('0'+d.getDate()).slice(-2);
  return d.getFullYear() + '-' + mm + '-' + dd;
}
function _primerDiaMes() {
  var d = new Date();
  var mm = ('0'+(d.getMonth()+1)).slice(-2);
  return d.getFullYear() + '-' + mm + '-01';
}
function _labelDiaEv(yyyymmdd) {
  var meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  var p = yyyymmdd.split('-');
  return p[2] + ' ' + meses[parseInt(p[1])-1];
}

/* ════════════════════════════════════════════
   CARGA DE DATOS DESDE LA API
════════════════════════════════════════════ */
async function _cargarDatosEvidencias() {
  try {
    var [rO, rM, rT] = await Promise.all([
      fetch(_EV_API + '/ordenes'),
      fetch(_EV_API + '/motorizados'),
      fetch(_EV_API + '/tiendas'),
    ]);
    _evOrdenes = await rO.json();
    _evMotos   = await rM.json();
    _evTiendas = await rT.json();
  } catch (err) {
    console.error('Error cargando datos de evidencias:', err);
    _evOrdenes = []; _evMotos = []; _evTiendas = [];
  }
}

/* Filtrar órdenes según rango activo */
function _ordenesFiltradas() {
  return _evOrdenes.filter(function(o) {
    if (_filtroEvidenciaDesde && o.fecha < _filtroEvidenciaDesde) return false;
    if (_filtroEvidenciaHasta && o.fecha > _filtroEvidenciaHasta) return false;
    /* Si es sesión motorizado, solo sus órdenes */
    if (_filtroEvidenciaMoto && o.motorizado &&
        o.motorizado.trim().toUpperCase() !== _filtroEvidenciaMoto.trim().toUpperCase()) return false;
    return true;
  });
}

/* ════════════════════════════════════════════
   KPIs PRINCIPALES
════════════════════════════════════════════ */
function _calcularKPIsEvidencias() {
  var ords = _ordenesFiltradas();

  var total        = ords.length;
  var entregados   = ords.filter(function(o){ return o.estado === 'entregado'; }).length;
  var noEntregados = ords.filter(function(o){ return o.estado === 'no-entregado'; }).length;
  var ausentes     = ords.filter(function(o){ return o.estado === 'ausente'; }).length;
  var reprogramados= ords.filter(function(o){ return o.estado === 'reprogramado'; }).length;

  /* Tasa de entrega = entregados / intentos de entrega (entregado+no-entregado+ausente) */
  var intentos = entregados + noEntregados + ausentes;
  var tasa     = intentos > 0 ? ((entregados / intentos) * 100).toFixed(1) + '%' : '0%';

  /* Ingreso delivery = suma de delivery_total en estados con cobro */
  var ingreso = ords.reduce(function(s, o) {
    return s + (_EC_EV.includes(o.estado) ? (parseFloat(o.delivery_total)||0) : 0);
  }, 0);

  /* Pago a motorizados = suma de pago_moto_total en estados con cobro */
  var pagoMotos = ords.reduce(function(s, o) {
    return s + (_EC_EV.includes(o.estado) ? (parseFloat(o.pago_moto_total)||0) : 0);
  }, 0);

  /* Saldo por cobrar = suma de (delivery - cobrado) positivos, agrupado por tienda */
  var porTienda = {};
  ords.forEach(function(o) {
    if (!_EC_EV.includes(o.estado)) return;
    if (!o.tienda) return;
    if (!porTienda[o.tienda]) porTienda[o.tienda] = { delivery:0, cobrado:0 };
    porTienda[o.tienda].delivery += parseFloat(o.delivery_total)||0;
    porTienda[o.tienda].cobrado  += parseFloat(o.monto_cobrado)||0;
  });
  var saldoPorCobrar = 0;
  Object.values(porTienda).forEach(function(t) {
    var s = t.delivery - t.cobrado;
    if (s > 0) saldoPorCobrar += s;
  });

  return {
    total, entregados, noEntregados, ausentes, reprogramados,
    tasa, ingreso, pagoMotos, saldoPorCobrar,
  };
}

/* ════════════════════════════════════════════
   GRÁFICO DE BARRAS — Entregas por día
════════════════════════════════════════════ */
function _calcularPorFechaEv() {
  var ords = _ordenesFiltradas();
  var mapaFecha = {};
  ords.forEach(function(o) {
    if (!mapaFecha[o.fecha]) mapaFecha[o.fecha] = { entregados:0, noEntregados:0, reprogramados:0 };
    if (o.estado === 'entregado')    mapaFecha[o.fecha].entregados++;
    if (o.estado === 'no-entregado' || o.estado === 'ausente') mapaFecha[o.fecha].noEntregados++;
    if (o.estado === 'reprogramado') mapaFecha[o.fecha].reprogramados++;
  });
  var fechas = Object.keys(mapaFecha).sort();
  /* Limitar a últimos 14 días si hay muchos */
  if (fechas.length > 14) fechas = fechas.slice(-14);
  return fechas.map(function(f) {
    return Object.assign({ fecha: f }, mapaFecha[f]);
  });
}

function initBarChart() {
  var container = document.getElementById('bar-chart');
  if (!container) return;
  container.innerHTML = '';

  var datos = _calcularPorFechaEv();

  if (datos.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:var(--color-text-tertiary);font-size:13px;padding:20px">Sin datos para el período seleccionado</div>';
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
      '<div class="bar-label">' + _labelDiaEv(d.fecha) + '</div>';
    container.appendChild(barWrap);
  });
}

/* ════════════════════════════════════════════
   RENDER KPIs
════════════════════════════════════════════ */
function _renderKPIsEvidencias() {
  var k = _calcularKPIsEvidencias();

  var set = function(id, v){ var el = document.getElementById(id); if (el) el.textContent = v; };
  set('ev-total',         k.total);
  set('ev-entregados',    k.entregados);
  set('ev-no-entregados', k.noEntregados);
  set('ev-tasa',          k.tasa);
  set('ev-ingreso',       'S/ ' + k.ingreso.toFixed(2));
  set('ev-ausentes',      k.ausentes);
  set('ev-reprog',        k.reprogramados);
  set('ev-saldo',         'S/ ' + k.saldoPorCobrar.toFixed(2));
  set('ev-pagomotos',     'S/ ' + k.pagoMotos.toFixed(2));
}

/* ════════════════════════════════════════════
   TABLA RENDIMIENTO POR MOTORIZADO
════════════════════════════════════════════ */
function _renderTablaMotorizadosEv() {
  var tbody = document.getElementById('tbody-ev-motos');
  if (!tbody) return;

  var ords = _ordenesFiltradas();

  var filas = _evMotos.map(function(m) {
    var ordenes = ords.filter(function(o) {
      return o.motorizado && o.motorizado.trim().toUpperCase() === m.nombre.trim().toUpperCase();
    });
    if (ordenes.length === 0) return '';

    var entregados    = ordenes.filter(function(o){ return o.estado === 'entregado'; }).length;
    var noEntregados  = ordenes.filter(function(o){ return o.estado === 'no-entregado'; }).length;
    var reprog        = ordenes.filter(function(o){ return o.estado === 'reprogramado'; }).length;
    var ausentes      = ordenes.filter(function(o){ return o.estado === 'ausente'; }).length;
    var intentos      = entregados + noEntregados + ausentes;
    var tasa          = intentos > 0 ? Math.round((entregados/intentos)*100) : 0;
    var tasaColor     = tasa >= 75 ? 'var(--color-green)' : tasa >= 50 ? 'var(--color-amber)' : 'var(--color-red-text)';
    var ingreso = ordenes.reduce(function(s,o){
      return s + (_EC_EV.includes(o.estado) ? (parseFloat(o.delivery_total)||0) : 0);
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
      '<td><button class="btn btn-sm btn-primary" onclick="verDetalleMotoEv(\'' + m.nombre + '\')"><i class="ti ti-chart-pie"></i> Ver detalle</button></td>' +
    '</tr>';
  }).filter(Boolean);

  tbody.innerHTML = filas.join('') ||
    '<tr><td colspan="10" style="text-align:center;padding:20px;color:var(--color-text-tertiary)">Sin datos para el período</td></tr>';
}

/* ════════════════════════════════════════════
   TABLA RENDIMIENTO POR TIENDA
════════════════════════════════════════════ */
function _renderTablaTiendasEv() {
  var tbody = document.getElementById('tbody-ev-tiendas');
  if (!tbody) return;

  var ords = _ordenesFiltradas();

  var filas = _evTiendas.map(function(t) {
    var ordenes = ords.filter(function(o) {
      return o.tienda && o.tienda.trim().toUpperCase() === t.nombre.trim().toUpperCase();
    });
    if (ordenes.length === 0) return '';

    var entregados   = ordenes.filter(function(o){ return o.estado === 'entregado'; }).length;
    var noEntregados = ordenes.filter(function(o){ return o.estado === 'no-entregado'; }).length;
    var ausentes     = ordenes.filter(function(o){ return o.estado === 'ausente'; }).length;
    var reprog       = ordenes.filter(function(o){ return o.estado === 'reprogramado'; }).length;
    var intentos     = entregados + noEntregados + ausentes;
    var tasa         = intentos > 0 ? Math.round((entregados/intentos)*100) : 0;
    var tasaColor    = tasa >= 75 ? 'var(--color-green)' : tasa >= 50 ? 'var(--color-amber)' : 'var(--color-red-text)';

    /* Solo estados con cobro */
    var facturado = ordenes.reduce(function(s,o){
      return s + (_EC_EV.includes(o.estado) ? (parseFloat(o.delivery_total)||0) : 0);
    }, 0);
    var cobrado = ordenes.reduce(function(s,o){
      return s + (_EC_EV.includes(o.estado) ? (parseFloat(o.monto_cobrado)||0) : 0);
    }, 0);
    var saldo      = facturado - cobrado;
    var saldoClass = saldo > 0 ? 'balance-pos' : saldo < 0 ? 'balance-neg' : 'balance-zero';

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
  }).filter(Boolean);

  tbody.innerHTML = filas.join('') ||
    '<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--color-text-tertiary)">Sin datos para el período</td></tr>';
}

/* ════════════════════════════════════════════
   RENDER GENERAL
════════════════════════════════════════════ */
function _renderEvidenciasCompleto() {
  _renderKPIsEvidencias();
  _renderTablaMotorizadosEv();
  _renderTablaTiendasEv();
  initBarChart();
}

/* ════════════════════════════════════════════
   INIT EVIDENCIAS — llamado desde navigation.js
════════════════════════════════════════════ */
window.initEvidencias = async function() {
  /* Detectar si es motorizado y filtrar solo sus órdenes */
  var sesionEv = _obtenerSesionEv();
  _filtroEvidenciaMoto = (sesionEv && sesionEv.rol === 'motorizado') ? sesionEv.nombre : '';

  /* Mostrar estado de carga */
  var tbM = document.getElementById('tbody-ev-motos');
  var tbT = document.getElementById('tbody-ev-tiendas');
  if (tbM) tbM.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--color-text-tertiary)"><i class="ti ti-loader"></i> Cargando...</td></tr>';
  /* Si es motorizado, ocultar sección de tiendas */
  var seccionTiendas = document.getElementById('seccion-ev-tiendas');
  if (seccionTiendas) seccionTiendas.style.display = _filtroEvidenciaMoto ? 'none' : '';

  await _cargarDatosEvidencias();

  /* Si es motorizado, filtrar _evMotos a solo él */
  if (_filtroEvidenciaMoto) {
    _evMotos = _evMotos.filter(function(m){
      return m.nombre.trim().toUpperCase() === _filtroEvidenciaMoto.trim().toUpperCase();
    });
  }

  _renderEvidenciasCompleto();
};

/* ════════════════════════════════════════════
   CAMBIO DE RANGO
════════════════════════════════════════════ */
window.setRangoEvidencias = function(btn, rango) {
  document.querySelectorAll('.ev-rango').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active');

  var hoy = _fechaHaceDias(0);
  if (rango === 'hoy')    { _filtroEvidenciaDesde = hoy; _filtroEvidenciaHasta = hoy; }
  if (rango === 'semana') { _filtroEvidenciaDesde = _fechaHaceDias(6); _filtroEvidenciaHasta = hoy; }
  if (rango === 'mes')    { _filtroEvidenciaDesde = _primerDiaMes(); _filtroEvidenciaHasta = hoy; }
  if (rango === 'todos')  { _filtroEvidenciaDesde = ''; _filtroEvidenciaHasta = ''; }

  _renderEvidenciasCompleto();
};

/* ════════════════════════════════════════════
   FILTRO DE FECHA PERSONALIZADO
════════════════════════════════════════════ */
window.aplicarFiltroEvidenciasFecha = function() {
  var desde = document.getElementById('ev-filtro-desde');
  var hasta = document.getElementById('ev-filtro-hasta');
  _filtroEvidenciaDesde = desde ? desde.value : '';
  _filtroEvidenciaHasta = hasta ? hasta.value : '';
  /* Quitar estado activo de los botones rápidos */
  document.querySelectorAll('.ev-rango').forEach(function(b){ b.classList.remove('active'); });
  _renderEvidenciasCompleto();
};

window.limpiarFiltroEvidenciasFecha = function() {
  var desde = document.getElementById('ev-filtro-desde');
  var hasta = document.getElementById('ev-filtro-hasta');
  if (desde) desde.value = '';
  if (hasta) hasta.value = '';
  _filtroEvidenciaDesde = '';
  _filtroEvidenciaHasta = '';
  document.querySelectorAll('.ev-rango').forEach(function(b){ b.classList.remove('active'); });
  var btnTodos = document.querySelector('.ev-rango[data-rango="todos"]');
  if (btnTodos) btnTodos.classList.add('active');
  _renderEvidenciasCompleto();
};

/* ════════════════════════════════════════════
   GRÁFICA CIRCULAR (DONUT) — SVG
════════════════════════════════════════════ */
function _donutSVG(segments, size) {
  size = size || 160;
  var radius        = size/2 - 14;
  var circumference = 2 * Math.PI * radius;
  var cx = size/2, cy = size/2;
  var total = segments.reduce(function(s,x){ return s+x.value; }, 0);

  if (total === 0) {
    return '<svg viewBox="0 0 '+size+' '+size+'" width="'+size+'" height="'+size+'">' +
      '<circle cx="'+cx+'" cy="'+cy+'" r="'+radius+'" fill="none" stroke="var(--color-border-secondary)" stroke-width="20" />' +
      '<text x="'+cx+'" y="'+cy+'" text-anchor="middle" dominant-baseline="middle" font-size="14" font-family="Arial" fill="var(--color-text-tertiary)">Sin datos</text>' +
    '</svg>';
  }

  var offset = 0;
  var circles = segments.filter(function(s){ return s.value > 0; }).map(function(seg) {
    var frac   = seg.value/total;
    var dash   = frac * circumference;
    var gap    = circumference - dash;
    var rotate = (offset/total) * 360 - 90;
    offset += seg.value;
    return '<circle cx="'+cx+'" cy="'+cy+'" r="'+radius+'" fill="none" stroke="'+seg.color+'" stroke-width="20" ' +
      'stroke-dasharray="'+dash.toFixed(2)+' '+gap.toFixed(2)+'" ' +
      'transform="rotate('+rotate.toFixed(2)+' '+cx+' '+cy+')" />';
  }).join('');

  var entregadosPct = Math.round((segments[0].value/total)*100);

  return '<svg viewBox="0 0 '+size+' '+size+'" width="'+size+'" height="'+size+'">' +
    '<circle cx="'+cx+'" cy="'+cy+'" r="'+radius+'" fill="none" stroke="var(--color-border-secondary)" stroke-width="20" />' +
    circles +
    '<text x="'+cx+'" y="'+(cy-4)+'" text-anchor="middle" font-size="22" font-weight="700" font-family="Arial" fill="var(--color-text-primary)">'+entregadosPct+'%</text>' +
    '<text x="'+cx+'" y="'+(cy+16)+'" text-anchor="middle" font-size="10" font-family="Arial" fill="var(--color-text-secondary)">entregado</text>' +
  '</svg>';
}

/* ════════════════════════════════════════════
   DETALLE DE MOTORIZADO — modal con dashboard
════════════════════════════════════════════ */
window.verDetalleMotoEv = function(nombreMoto) {
  var ords = _ordenesFiltradas().filter(function(o) {
    return o.motorizado && o.motorizado.trim().toUpperCase() === nombreMoto.trim().toUpperCase();
  });

  var entregados   = ords.filter(function(o){ return o.estado === 'entregado'; }).length;
  var noEntregados = ords.filter(function(o){ return o.estado === 'no-entregado'; }).length;
  var reprog       = ords.filter(function(o){ return o.estado === 'reprogramado'; }).length;
  var ausentes     = ords.filter(function(o){ return o.estado === 'ausente'; }).length;
  var cancelados   = ords.filter(function(o){ return o.estado === 'cancelado'; }).length;
  var otros        = ords.length - entregados - noEntregados - reprog - ausentes - cancelados;

  var intentos = entregados + noEntregados + ausentes;
  var tasa     = intentos > 0 ? Math.round((entregados/intentos)*100) : 0;

  var ingreso = ords.reduce(function(s,o){
    return s + (_EC_EV.includes(o.estado) ? (parseFloat(o.delivery_total)||0) : 0);
  }, 0);
  var pagoMoto = ords.reduce(function(s,o){
    return s + (_EC_EV.includes(o.estado) ? (parseFloat(o.pago_moto_total)||0) : 0);
  }, 0);
  var cobrado = ords.reduce(function(s,o){
    return s + (_EC_EV.includes(o.estado) ? (parseFloat(o.monto_cobrado)||0) : 0);
  }, 0);
  var totalMoto = cobrado - pagoMoto;
  var tmColor = totalMoto > 0 ? 'var(--color-green)' : totalMoto < 0 ? 'var(--color-red-text)' : 'var(--color-text-secondary)';
  var tmMsg   = totalMoto > 0
    ? 'Debe a Velox: S/ ' + totalMoto.toFixed(2)
    : totalMoto < 0
    ? 'Velox le debe: S/ ' + Math.abs(totalMoto).toFixed(2)
    : 'Saldo en cero';

  var segments = [
    { label:'Entregados',    value: entregados,    color: 'var(--color-green)' },
    { label:'No entregados', value: noEntregados,  color: 'var(--color-red)' },
    { label:'Reprogramados', value: reprog,        color: 'var(--color-amber)' },
    { label:'Ausentes',      value: ausentes,      color: 'var(--color-purple)' },
    { label:'Otros',         value: cancelados + otros, color: 'var(--color-border-secondary)' },
  ];

  var periodoLabel = (_filtroEvidenciaDesde || _filtroEvidenciaHasta)
    ? (_labelDiaEv(_filtroEvidenciaDesde || _filtroEvidenciaHasta) + ' — ' + _labelDiaEv(_filtroEvidenciaHasta || _filtroEvidenciaDesde))
    : 'Todo el período';

  var html =
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">' +
      '<div>' +
        '<div style="font-size:16px;font-weight:600">' + nombreMoto + '</div>' +
        '<div style="font-size:12px;color:var(--color-text-secondary)">' + periodoLabel + '</div>' +
      '</div>' +
      '<button onclick="cerrarDetalleMotoEv()" style="background:none;border:none;cursor:pointer;font-size:18px;color:var(--color-text-secondary)"><i class="ti ti-x"></i></button>' +
    '</div>' +

    '<div style="display:flex;gap:24px;align-items:center;flex-wrap:wrap;margin:16px 0">' +
      '<div>' + _donutSVG(segments, 150) + '</div>' +
      '<div style="display:flex;flex-direction:column;gap:8px;font-size:13px">' +
        segments.filter(function(s){ return s.value>0; }).map(function(s) {
          return '<div style="display:flex;align-items:center;gap:8px">' +
            '<span style="width:12px;height:12px;border-radius:3px;background:'+s.color+';display:inline-block"></span>' +
            '<span>' + s.label + ': <strong>' + s.value + '</strong></span>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</div>' +

    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">' +
      _kpiCardEv('Pedidos totales', ords.length, 'blue', 'ti-package') +
      _kpiCardEv('Tasa de entrega', tasa+'%', tasa>=75?'green':tasa>=50?'amber':'red', 'ti-target-arrow') +
      _kpiCardEv('Ingreso generado', 'S/ '+ingreso.toFixed(2), 'blue', 'ti-truck') +
      _kpiCardEv('Pago a motorizado', 'S/ '+pagoMoto.toFixed(2), 'amber', 'ti-wallet') +
      _kpiCardEv('Total cobrado', 'S/ '+cobrado.toFixed(2), 'green', 'ti-cash') +
      _kpiCardEv('Total moto', 'S/ '+totalMoto.toFixed(2), totalMoto>=0?'green':'red', 'ti-calculator') +
    '</div>' +

    '<div style="background:var(--color-bg-secondary);border-radius:var(--radius-lg);padding:14px 18px;' +
      'border-left:5px solid '+tmColor+';display:flex;align-items:center;gap:12px">' +
      '<div style="background:'+tmColor+';border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
        '<i class="ti ti-calculator" style="color:#fff;font-size:15px"></i>' +
      '</div>' +
      '<div>' +
        '<div style="font-size:11px;color:var(--color-text-secondary);font-weight:500;margin-bottom:1px">RESUMEN DEL PERÍODO</div>' +
        '<div style="font-size:14px;font-weight:700;color:'+tmColor+'">'+tmMsg+'</div>' +
      '</div>' +
    '</div>';

  var body = document.getElementById('ev-moto-modal-body');
  if (body) body.innerHTML = html;
  var overlay = document.getElementById('ev-moto-modal-overlay');
  if (overlay) overlay.style.display = 'flex';
};

function _kpiCardEv(label, value, color, icon) {
  return '<div style="background:var(--color-bg-secondary);border-radius:var(--radius-md);padding:10px 12px">' +
    '<div style="font-size:11px;color:var(--color-text-secondary);display:flex;align-items:center;gap:4px;margin-bottom:4px"><i class="ti '+icon+'"></i> '+label+'</div>' +
    '<div style="font-size:16px;font-weight:700;color:var(--color-'+color+')">'+value+'</div>' +
  '</div>';
}

window.cerrarDetalleMotoEv = function() {
  var overlay = document.getElementById('ev-moto-modal-overlay');
  if (overlay) overlay.style.display = 'none';
};
