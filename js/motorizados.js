/* ============================================================
   motorizados.js — Conectado a la API REST
   ============================================================ */

var API = '/api';
var MOTORIZADOS = []; /* caché local */

var _motoEditId      = null;
var _motoElimId      = null;
var _filtroFechaMoto = '';

/* ════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════ */
function _initiales(nombre) {
  var p = nombre.trim().split(' ');
  return (p[0][0] + (p[1] ? p[1][0] : '')).toUpperCase();
}

function _fechaDisplayM(yyyymmdd) {
  if (!yyyymmdd) return '—';
  var p = yyyymmdd.split('-');
  var meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return p[2] + ' ' + meses[parseInt(p[1])-1] + ' ' + p[0];
}

/* ════════════════════════════════════════════
   CARGAR MOTORIZADOS DESDE LA API
════════════════════════════════════════════ */
async function _cargarMotorizados() {
  try {
    var r = await fetch(API + '/motorizados');
    MOTORIZADOS = await r.json();
  } catch (err) {
    console.error('Error cargando motorizados:', err);
    MOTORIZADOS = [];
  }
}

/* ════════════════════════════════════════════
   CALCULAR STATS DESDE LA API
════════════════════════════════════════════ */
async function _calcularStatsMoto(idMotorizado, fecha) {
  try {
    var url = API + '/motorizados/' + idMotorizado + '/ordenes';
    if (fecha) url += '?fecha=' + fecha;
    var r = await fetch(url);
    var ordenes = await r.json();
    if (!ordenes.length) return null;

    var entregados    = ordenes.filter(function(o){ return o.estado==='entregado'; }).length;
    var noEntregados  = ordenes.filter(function(o){ return o.estado==='no-entregado'; }).length;
    var ausentes      = ordenes.filter(function(o){ return o.estado==='ausente'; }).length;
    var reprogramados = ordenes.filter(function(o){ return o.estado==='reprogramado'; }).length;
    var cobrable      = entregados + noEntregados;
    var tasa          = cobrable > 0 ? Math.round((entregados/cobrable)*100) : 0;
    var estadosConCobro = ['entregado', 'ausente'];
    var pagoTotal = ordenes.reduce(function(s,o){
      return s + (estadosConCobro.includes(o.estado) ? (parseFloat(o.pago_moto_total)||0) : 0);
    }, 0);
    var cobrado = ordenes.reduce(function(s,o){
      return s + (estadosConCobro.includes(o.estado) ? (parseFloat(o.monto_cobrado)||0) : 0);
    }, 0);

    return {
      total: ordenes.length, entregados, noEntregados, ausentes, reprogramados,
      tasa: tasa + '%', tasaNum: tasa, pagoTotal, cobrado, ordenes,
    };
  } catch(err) { return null; }
}

/* ════════════════════════════════════════════
   RENDER — GRID DE TARJETAS
════════════════════════════════════════════ */
window.renderMotorizados = async function() {
  await _cargarMotorizados();
  var grid = document.getElementById('moto-grid-content');
  if (!grid) return;

  grid.innerHTML = MOTORIZADOS.map(function(m) {
    var estadoBadge = m.activo
      ? '<span class="badge pendiente">Activo</span>'
      : '<span style="background:#F0F0F0;color:#777;padding:3px 9px;border-radius:20px;font-size:11px">Inactivo</span>';
    return '<div class="moto-card">' +
      '<div class="moto-head">' +
        '<div class="avatar ' + m.color_avatar + '">' + m.iniciales + '</div>' +
        '<div style="flex:1">' +
          '<div class="moto-name">' + m.nombre + '</div>' +
          '<div class="moto-phone"><i class="ti ti-phone" style="font-size:11px"></i> ' +
            (m.telefono || 'Sin teléfono') + (m.zona ? ' · ' + m.zona : '') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:8px">' +
        'Ingreso: ' + (m.fecha_ingreso || '—') + ' &nbsp;·&nbsp; ' + estadoBadge +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;gap:6px">' +
        '<button class="btn btn-primary btn-sm" onclick="abrirDetalle(' + m.id + ')">' +
          '<i class="ti ti-eye"></i> Ver detalle</button>' +
        '<div style="display:flex;gap:4px">' +
          '<button class="btn btn-sm" onclick="editarMoto(' + m.id + ')"><i class="ti ti-pencil"></i></button>' +
          '<button class="btn btn-sm" onclick="confirmarEliminarMoto(' + m.id + ')" style="color:#A32D2D;border-color:#F09595"><i class="ti ti-trash"></i></button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  _renderTablaResumen();
};

async function _renderTablaResumen() {
  var tbody = document.getElementById('tbody-motos-resumen');
  if (!tbody) return;

  var fecha = _filtroFechaMoto;
  var lbl = document.getElementById('lbl-fecha-motos');
  if (lbl) lbl.textContent = fecha ? 'Mostrando: ' + _fechaDisplayM(fecha) : 'Mostrando: todos los días';

  /* Renderizar filas async */
  var filas = await Promise.all(MOTORIZADOS.map(async function(m) {
    var s = await _calcularStatsMoto(m.id, fecha);
    if (!s) {
      return '<tr>' +
        '<td><div style="display:flex;align-items:center;gap:8px">' +
          '<div class="avatar ' + m.color_avatar + '" style="width:30px;height:30px;font-size:11px">' + m.iniciales + '</div>' +
          '<strong>' + m.nombre + '</strong></div></td>' +
        '<td colspan="8" style="color:var(--color-text-tertiary)">Sin órdenes</td>' +
        '<td><button class="btn btn-sm" onclick="abrirDetalleMotoHistorial(' + m.id + ')"><i class="ti ti-eye"></i></button></td>' +
      '</tr>';
    }
    var tc = s.tasaNum >= 75 ? 'var(--color-green)' : s.tasaNum >= 50 ? 'var(--color-amber)' : 'var(--color-red-text)';
    var totalMoto = s.cobrado - s.pagoTotal;
    var tmColor   = totalMoto > 0 ? 'var(--color-green)' : totalMoto < 0 ? 'var(--color-red-text)' : 'var(--color-text-secondary)';
    return '<tr>' +
      '<td><div style="display:flex;align-items:center;gap:8px">' +
        '<div class="avatar ' + m.color_avatar + '" style="width:30px;height:30px;font-size:11px">' + m.iniciales + '</div>' +
        '<strong>' + m.nombre + '</strong></div></td>' +
      '<td><strong>' + s.total + '</strong></td>' +
      '<td style="color:var(--color-green);font-weight:600">' + s.entregados + '</td>' +
      '<td style="color:var(--color-red-text);font-weight:600">' + s.noEntregados + '</td>' +
      '<td style="color:var(--color-amber-text);font-weight:600">' + s.ausentes + '</td>' +
      '<td style="color:var(--color-purple-text);font-weight:600">' + s.reprogramados + '</td>' +
      '<td><span style="color:' + tc + ';font-weight:700">' + s.tasa + '</span></td>' +
      '<td style="font-weight:600">S/ ' + s.pagoTotal.toFixed(2) + '</td>' +
      '<td style="font-weight:600;color:var(--color-blue-text)">S/ ' + s.cobrado.toFixed(2) + '</td>' +
      '<td style="font-weight:700;color:' + tmColor + '">S/ ' + totalMoto.toFixed(2) + '</td>' +
      '<td><button class="btn btn-primary btn-sm" onclick="abrirDetalleMotoHistorial(' + m.id + ')">' +
        '<i class="ti ti-eye"></i> Ver detalle</button></td>' +
    '</tr>';
  }));

  tbody.innerHTML = filas.join('');
}

/* ════════════════════════════════════════════
   FILTRO DE FECHA
════════════════════════════════════════════ */
window.aplicarFiltroMotos = function() {
  var inp = document.getElementById('filtro-fecha-motos');
  _filtroFechaMoto = inp ? inp.value : '';
  _renderTablaResumen();
};

window.limpiarFiltroMotos = function() {
  _filtroFechaMoto = '';
  var inp = document.getElementById('filtro-fecha-motos');
  if (inp) inp.value = '';
  _renderTablaResumen();
};

/* ════════════════════════════════════════════
   DETALLE HISTORIAL INLINE
════════════════════════════════════════════ */
window.abrirDetalleMotoHistorial = async function(motoId) {
  var m = MOTORIZADOS.find(function(x){ return x.id == motoId; });
  if (!m) return;

  var panel = document.getElementById('panel-detalle-moto');
  if (!panel) return;

  panel.innerHTML = '<div style="padding:20px;text-align:center;color:var(--color-text-secondary)"><i class="ti ti-loader" style="font-size:24px"></i> Cargando...</div>';
  panel.style.display = 'block';

  var s = await _calcularStatsMoto(motoId, _filtroFechaMoto);

  if (!s) {
    panel.innerHTML = '<div style="padding:20px;text-align:center;color:var(--color-text-tertiary)">Sin órdenes para ' + m.nombre + '</div>';
    return;
  }

  var saldoMoto  = s.cobrado - s.pagoTotal;
  var saldoColor = saldoMoto > 0 ? 'var(--color-green)' : saldoMoto < 0 ? 'var(--color-red-text)' : 'var(--color-text-secondary)';
  var saldoMsg   = saldoMoto > 0
    ? 'En resumen debe a Velox: S/ ' + saldoMoto.toFixed(2)
    : saldoMoto < 0
    ? 'En resumen se le debe al motorizado: S/ ' + Math.abs(saldoMoto).toFixed(2)
    : 'Saldo en cero';

  var tc = s.tasaNum >= 75 ? 'green' : s.tasaNum >= 50 ? 'amber' : 'red';

  var html =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">' +
      '<div style="display:flex;align-items:center;gap:12px">' +
        '<div class="avatar ' + m.color_avatar + '" style="width:44px;height:44px;font-size:16px">' + m.iniciales + '</div>' +
        '<div><div style="font-size:16px;font-weight:600">' + m.nombre + '</div>' +
          '<div style="font-size:12px;color:var(--color-text-secondary)">' +
            (_filtroFechaMoto ? 'Detalle del ' + _fechaDisplayM(_filtroFechaMoto) : 'Historial completo') +
          '</div></div>' +
      '</div>' +
      '<div style="display:flex;gap:8px">' +
        '<button class="btn btn-sm" onclick="cerrarDetalleMotoHistorial()"><i class="ti ti-x"></i> Cerrar</button>' +
      '</div>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">' +
      _kpiCard('Total órdenes', s.total, 'blue', 'ti-package') +
      _kpiCard('Entregados', s.entregados, 'green', 'ti-circle-check') +
      _kpiCard('No entregados / Ausentes', s.noEntregados + s.ausentes, 'red', 'ti-circle-x') +
      _kpiCard('Tasa entrega', s.tasa, tc, 'ti-chart-line') +
    '</div>' +
    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">' +
      _kpiCard('Pago a motorizado', 'S/ ' + s.pagoTotal.toFixed(2), 'amber', 'ti-wallet') +
      _kpiCard('Total cobrado', 'S/ ' + s.cobrado.toFixed(2), 'blue', 'ti-cash') +
      _kpiCard('Total moto', 'S/ ' + (s.cobrado - s.pagoTotal).toFixed(2), (s.cobrado - s.pagoTotal) >= 0 ? 'green' : 'red', 'ti-calculator') +
      _kpiCard('Reprogramados', s.reprogramados, 'amber', 'ti-refresh') +
    '</div>' +
    '<div style="background:var(--color-bg-secondary);border-radius:var(--radius-lg);padding:18px 22px;' +
    'margin-bottom:16px;border-left:5px solid ' + saldoColor + ';display:flex;align-items:center;gap:14px">' +
      '<div style="background:' + saldoColor + ';border-radius:50%;width:40px;height:40px;display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
        '<i class="ti ti-calculator" style="color:#fff;font-size:18px"></i>' +
      '</div>' +
      '<div>' +
        '<div style="font-size:11px;color:var(--color-text-secondary);font-weight:500;margin-bottom:2px">RESUMEN DEL PERÍODO</div>' +
        '<div style="font-size:16px;font-weight:700;color:' + saldoColor + '">' + saldoMsg + '</div>' +
      '</div>' +
    '</div>' +
    _renderTablaOrdenesDetalle(s.ordenes) +
    '</div>';

  panel.innerHTML = html;
  setTimeout(function(){ panel.scrollIntoView({ behavior:'smooth', block:'start' }); }, 50);
};

function _kpiCard(label, valor, color, icon) {
  return '<div class="metric ' + color + '" style="padding:14px 16px">' +
    '<div class="metric-body"><div class="metric-label">' + label + '</div>' +
    '<div class="metric-val ' + color + '">' + valor + '</div></div>' +
    '<div class="metric-icon ' + color + '"><i class="ti ' + icon + '"></i></div>' +
  '</div>';
}

function _renderTablaOrdenesDetalle(ordenes) {
  var badgeMap = {
    'entregado':    '<span class="badge entregado">Entregado</span>',
    'no-entregado': '<span class="badge no-entregado">No entregado</span>',
    'ausente':      '<span class="badge ausente">Ausente</span>',
    'reprogramado': '<span class="badge reprogramado">Reprogramado</span>',
    'cancelado':    '<span class="badge no-entregado">Cancelado</span>',
    'cambio':       '<span class="badge ausente">Cambio</span>',
    'devolucion':   '<span class="badge ausente">Devolución</span>',
    'recojo':       '<span class="badge pendiente">Recojo</span>',
    'en-proceso':   '<span class="badge pendiente">En proceso</span>',
  };
  var metodoLabel = {
    'yape':'Yape','plin':'Plin','pos':'POS',
    'efectivo':'Efectivo','pago-tienda':'Pago tienda','sin-cobro':'Sin cobro'
  };

  /* Estados que SÍ generan cobro */
  var estadosConCobro = ['entregado', 'ausente'];

  var cols = ['Código','Tienda','Destinatario','Distrito','Estado','Método',
              'Delivery','Cobrado','Pago moto','Total moto','Especial','Fecha'];

  return '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">' +
    '<thead><tr>' +
    cols.map(function(h){
      return '<th style="background:var(--color-bg-secondary);padding:9px 12px;text-align:left;' +
             'font-weight:600;font-size:11px;color:var(--color-text-secondary);' +
             'border-bottom:1px solid var(--color-border-tertiary);white-space:nowrap">' + h + '</th>';
    }).join('') +
    '</tr></thead><tbody>' +
    ordenes.map(function(o) {
      var tieneCobro = estadosConCobro.includes(o.estado);

      /* Delivery: solo si tiene cobro */
      var delivery   = tieneCobro ? parseFloat(o.delivery_total||0) : 0;
      /* Cobrado: solo si tiene cobro */
      var cobrado    = tieneCobro ? parseFloat(o.monto_cobrado||0)  : 0;
      /* Pago moto: solo si tiene cobro */
      var pagoMoto   = tieneCobro ? parseFloat(o.pago_moto_total||0): 0;
      /* Total moto = cobrado - pago moto */
      var totalMoto  = cobrado - pagoMoto;

      var deliveryStr  = tieneCobro ? 'S/ ' + delivery.toFixed(2)  : '<span style="color:var(--color-text-tertiary)">S/ 0.00</span>';
      var cobradoStr   = tieneCobro ? 'S/ ' + cobrado.toFixed(2)   : '<span style="color:var(--color-text-tertiary)">S/ 0.00</span>';
      var pagoMotoStr  = tieneCobro ? 'S/ ' + pagoMoto.toFixed(2)  : '<span style="color:var(--color-text-tertiary)">S/ 0.00</span>';

      var totalMotoColor = totalMoto > 0 ? 'var(--color-green)' :
                           totalMoto < 0 ? 'var(--color-red-text)' :
                           'var(--color-text-secondary)';
      var totalMotoStr = tieneCobro
        ? '<span style="font-weight:700;color:' + totalMotoColor + '">S/ ' + totalMoto.toFixed(2) + '</span>'
        : '<span style="color:var(--color-text-tertiary)">S/ 0.00</span>';

      var especial = o.producto_especial
        ? '<span style="color:var(--color-amber-text);font-weight:600">+S/ ' + parseFloat(o.monto_adicional||0).toFixed(2) + '</span>'
        : '—';

      return '<tr style="border-bottom:1px solid var(--color-border-tertiary)">' +
        '<td style="padding:8px 12px"><strong>#' + o.codigo + '</strong></td>' +
        '<td style="padding:8px 12px">' + o.tienda + '</td>' +
        '<td style="padding:8px 12px">' + (o.dest_nombre||'—') + '</td>' +
        '<td style="padding:8px 12px">' + o.distrito + '</td>' +
        '<td style="padding:8px 12px">' + (badgeMap[o.estado]||o.estado) + '</td>' +
        '<td style="padding:8px 12px;font-size:11px">' + (metodoLabel[o.metodo_pago]||o.metodo_pago||'—') + '</td>' +
        '<td style="padding:8px 12px;font-weight:500">' + deliveryStr + '</td>' +
        '<td style="padding:8px 12px;font-weight:500">' + cobradoStr + '</td>' +
        '<td style="padding:8px 12px;color:var(--color-amber-text);font-weight:600">' + pagoMotoStr + '</td>' +
        '<td style="padding:8px 12px">' + totalMotoStr + '</td>' +
        '<td style="padding:8px 12px">' + especial + '</td>' +
        '<td style="padding:8px 12px;font-size:11px;color:var(--color-text-secondary)">' + _fechaDisplayM(o.fecha) + '</td>' +
      '</tr>';
    }).join('') +
    '</tbody></table></div>';
}

window.cerrarDetalleMotoHistorial = function() {
  var panel = document.getElementById('panel-detalle-moto');
  if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
};

/* ════════════════════════════════════════════
   DETALLE COMPLETO (página detalle-motorizado)
════════════════════════════════════════════ */
window.renderDetalleMoto = async function(motoId) {
  var container = document.getElementById('detalle-root');
  if (!container) return;

  if (!MOTORIZADOS.length) await _cargarMotorizados();
  var m = MOTORIZADOS.find(function(x){ return x.id == motoId; });

  if (!m) {
    container.innerHTML = '<div style="padding:40px;color:var(--color-text-secondary)">Motorizado no encontrado.</div>';
    return;
  }

  container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--color-text-secondary)"><i class="ti ti-loader" style="font-size:32px"></i><br>Cargando órdenes...</div>';

  /* Cargar todas las órdenes del motorizado */
  var r = await fetch(API + '/motorizados/' + motoId + '/ordenes');
  var todasOrdenes = await r.json();

  /* Agrupar por fecha */
  var mapaFecha = {};
  todasOrdenes.forEach(function(o) {
    if (!mapaFecha[o.fecha]) mapaFecha[o.fecha] = [];
    mapaFecha[o.fecha].push(o);
  });
  var fechas = Object.keys(mapaFecha).sort().reverse();

  var html =
    '<div class="detalle-header">' +
      '<div class="detalle-header-left">' +
        '<button class="btn-back" onclick="showPage(\'motorizados\')"><i class="ti ti-arrow-left"></i> Volver</button>' +
        '<div class="detalle-avatar ' + m.color_avatar + '">' + m.iniciales + '</div>' +
        '<div><div class="detalle-nombre">' + m.nombre + '</div>' +
          '<div class="detalle-meta">' +
            '<span><i class="ti ti-phone"></i> ' + (m.telefono||'Sin teléfono') + '</span>' +
            (m.zona ? '<span><i class="ti ti-map-pin"></i> ' + m.zona + '</span>' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

  if (fechas.length === 0) {
    html += '<div style="padding:40px;text-align:center;color:var(--color-text-tertiary)">Sin órdenes registradas.</div>';
    container.innerHTML = html;
    return;
  }

  html += '<div class="dias-tabs">';
  fechas.forEach(function(fecha, i) {
    html += '<div class="dia-tab' + (i===0?' active':'') + '" data-dia="' + fecha + '" onclick="cambiarDiaMoto(' + i + ')">' + _fechaDisplayM(fecha) + '</div>';
  });
  html += '</div>';

  fechas.forEach(function(fecha, i) {
    var ords = mapaFecha[fecha];
    var entregados   = ords.filter(function(o){ return o.estado==='entregado'; }).length;
    var noEntregados = ords.filter(function(o){ return o.estado==='no-entregado'; }).length;
    var reprog       = ords.filter(function(o){ return o.estado==='reprogramado'; }).length;
    var _estadosCobro = ['entregado','ausente'];
    var pagoTotal = ords.reduce(function(s,o){
      return s + (_estadosCobro.includes(o.estado) ? (parseFloat(o.pago_moto_total)||0) : 0);
    }, 0);
    var cobrado = ords.reduce(function(s,o){
      return s + (_estadosCobro.includes(o.estado) ? (parseFloat(o.monto_cobrado)||0) : 0);
    }, 0);
    var saldo = cobrado - pagoTotal;
    var saldoColor   = saldo > 0 ? 'var(--color-green)' : saldo < 0 ? 'var(--color-red-text)' : 'var(--color-text-secondary)';

    html += '<div class="tabla-dia' + (i===0?' active':'') + '">';
    html += '<div class="resumen-dia">' +
      '<div class="resumen-item"><div class="resumen-label">Total</div><div class="resumen-val blue">' + ords.length + '</div></div>' +
      '<div class="resumen-item"><div class="resumen-label">Entregados</div><div class="resumen-val green">' + entregados + '</div></div>' +
      '<div class="resumen-item"><div class="resumen-label">No entregados</div><div class="resumen-val red">' + noEntregados + '</div></div>' +
      '<div class="resumen-item"><div class="resumen-label">Reprogramados</div><div class="resumen-val purple">' + reprog + '</div></div>' +
      '<div class="resumen-item"><div class="resumen-label">Pago motorizado</div><div class="resumen-val amber">S/ ' + pagoTotal.toFixed(2) + '</div></div>' +
    '</div>';

        var saldoMsgFull = saldo > 0
      ? 'En resumen debe a Velox: S/ ' + saldo.toFixed(2)
      : saldo < 0
      ? 'En resumen se le debe al motorizado: S/ ' + Math.abs(saldo).toFixed(2)
      : 'Saldo en cero';
    html += '<div style="background:var(--color-bg-secondary);border-radius:var(--radius-lg);padding:16px 20px;' +
      'margin-bottom:14px;border-left:5px solid ' + saldoColor + ';display:flex;align-items:center;gap:14px">' +
        '<div style="background:' + saldoColor + ';border-radius:50%;width:38px;height:38px;display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
          '<i class="ti ti-calculator" style="color:#fff;font-size:17px"></i>' +
        '</div>' +
        '<div>' +
          '<div style="font-size:11px;color:var(--color-text-secondary);font-weight:500;margin-bottom:2px">RESUMEN DEL DÍA</div>' +
          '<div style="font-size:15px;font-weight:700;color:' + saldoColor + '">' + saldoMsgFull + '</div>' +
          '<div style="font-size:12px;color:var(--color-text-secondary);margin-top:2px">Cobrado: <strong>S/ ' + cobrado.toFixed(2) + '</strong> &nbsp;·&nbsp; Pago moto: <strong>S/ ' + pagoTotal.toFixed(2) + '</strong></div>' +
        '</div>' +
      '</div>';

    html += '<div class="card"><div class="card-head">' +
      '<span class="card-title">Órdenes del ' + _fechaDisplayM(fecha) + '</span>' +
      '<span style="font-size:12px;color:var(--color-text-secondary)">' + ords.length + ' registros</span>' +
    '</div>' + _renderTablaOrdenesDetalle(ords) + '</div>';
    html += '</div>';
  });

  container.innerHTML = html;
};

window.cambiarDiaMoto = function(idx) {
  document.querySelectorAll('.dia-tab').forEach(function(t){ t.classList.remove('active'); });
  document.querySelectorAll('.tabla-dia').forEach(function(t){ t.classList.remove('active'); });
  document.querySelectorAll('.dia-tab')[idx].classList.add('active');
  document.querySelectorAll('.tabla-dia')[idx].classList.add('active');
};

/* ════════════════════════════════════════════
   MODAL AGREGAR / EDITAR
════════════════════════════════════════════ */
window.abrirModalMoto = function() {
  _motoEditId = null;
  document.getElementById('moto-modal-titulo').textContent = 'Agregar motorizado';
  document.getElementById('btn-guardar-moto').innerHTML = '<i class="ti ti-plus"></i> Agregar';
  ['f-moto-nombre','f-moto-telefono','f-moto-dni','f-moto-placa','f-moto-referencia'].forEach(function(id){
    var el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('f-moto-zona').value   = '';
  document.getElementById('f-moto-color').value  = 'av-blue';
  document.getElementById('f-moto-activo').value = 'true';
  document.getElementById('moto-modal-error').style.display   = 'none';
  document.getElementById('moto-modal-overlay').style.display = 'flex';
};

window.editarMoto = function(id) {
  var m = MOTORIZADOS.find(function(x){ return x.id == id; });
  if (!m) return;
  _motoEditId = id;
  document.getElementById('moto-modal-titulo').textContent = 'Editar motorizado';
  document.getElementById('btn-guardar-moto').innerHTML = '<i class="ti ti-check"></i> Guardar cambios';
  document.getElementById('f-moto-nombre').value     = m.nombre;
  document.getElementById('f-moto-telefono').value   = m.telefono || '';
  document.getElementById('f-moto-dni').value        = m.dni || '';
  document.getElementById('f-moto-placa').value      = m.placa || '';
  document.getElementById('f-moto-referencia').value = m.referencia || '';
  document.getElementById('f-moto-zona').value       = m.zona || '';
  document.getElementById('f-moto-color').value      = m.color_avatar || 'av-blue';
  document.getElementById('f-moto-activo').value     = m.activo ? 'true' : 'false';
  document.getElementById('moto-modal-error').style.display   = 'none';
  document.getElementById('moto-modal-overlay').style.display = 'flex';
};

window.cerrarModalMoto = function() {
  document.getElementById('moto-modal-overlay').style.display = 'none';
};

window.guardarMoto = async function() {
  var nombre     = document.getElementById('f-moto-nombre').value.trim();
  var telefono   = document.getElementById('f-moto-telefono').value.trim();
  var zona       = document.getElementById('f-moto-zona').value;
  var color      = document.getElementById('f-moto-color').value;
  var activo     = document.getElementById('f-moto-activo').value === 'true';
  var dni        = document.getElementById('f-moto-dni').value.trim();
  var placa      = document.getElementById('f-moto-placa').value.trim();
  var referencia = document.getElementById('f-moto-referencia').value.trim();
  var errEl      = document.getElementById('moto-modal-error');

  if (!nombre) {
    errEl.textContent = 'El nombre es obligatorio.';
    errEl.style.display = 'block'; return;
  }

  var body = { nombre, telefono, zona, color, activo, dni, placa, referencia,
               iniciales: _initiales(nombre) };
  var url    = API + '/motorizados' + (_motoEditId ? '/' + _motoEditId : '');
  var method = _motoEditId ? 'PUT' : 'POST';

  try {
    var r = await fetch(url, { method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    if (!r.ok) { var e = await r.json(); errEl.textContent = e.error||'Error'; errEl.style.display='block'; return; }
    cerrarModalMoto();
    renderMotorizados();
    if (typeof showNotif === 'function') showNotif(_motoEditId ? 'Motorizado actualizado' : 'Motorizado agregado');
  } catch(err) { errEl.textContent = 'Error de conexión.'; errEl.style.display = 'block'; }
};

window.confirmarEliminarMoto = function(id) {
  var m = MOTORIZADOS.find(function(x){ return x.id == id; });
  if (!m) return;
  _motoElimId = id;
  document.getElementById('confirm-moto-nombre').textContent   = m.nombre;
  document.getElementById('moto-confirm-overlay').style.display = 'flex';
};

window.cerrarConfirmMoto = function() {
  document.getElementById('moto-confirm-overlay').style.display = 'none';
  _motoElimId = null;
};

window.ejecutarEliminarMoto = async function() {
  try {
    await fetch(API + '/motorizados/' + _motoElimId, { method: 'DELETE' });
    cerrarConfirmMoto();
    renderMotorizados();
    if (typeof showNotif === 'function') showNotif('Motorizado eliminado');
  } catch(err) { console.error(err); }
};

window.initMotorizados = function() {
  _filtroFechaMoto = '';
  renderMotorizados();
};
