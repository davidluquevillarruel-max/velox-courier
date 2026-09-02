/* ============================================================
   motorizados.js — Conectado a la API REST
   ============================================================ */

var API = '/api';
var MOTORIZADOS = []; /* caché local */

var _motoEditId      = null;
var _motoElimId      = null;
var _filtroFechaMoto = '';
var _motoDetalleAbiertoId = null;

/* Si la sesión es de un motorizado, solo debe ver su propio registro */
function _motorizadosVisibles() {
  var raw = localStorage.getItem('velox_usuario');
  if (!raw) return MOTORIZADOS;
  try {
    var sesion = JSON.parse(raw);
    if (sesion.rol === 'motorizado' && sesion.id_motorizado) {
      return MOTORIZADOS.filter(function(m){ return m.id == sesion.id_motorizado; });
    }
  } catch(e) {}
  return MOTORIZADOS;
}

function _esSesionMotorizado() {
  var raw = localStorage.getItem('velox_usuario');
  if (!raw) return false;
  try { return JSON.parse(raw).rol === 'motorizado'; } catch(e) { return false; }
}

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

  var esMoto = _esSesionMotorizado();
  var visibles = _motorizadosVisibles();

  /* Ocultar botón "Agregar motorizado" si el rol es motorizado */
  var btnAgregar = document.querySelector('[onclick="abrirModalMoto()"]');
  if (btnAgregar && esMoto) btnAgregar.style.display = 'none';

  grid.innerHTML = visibles.map(function(m) {
    var estadoBadge = m.activo
      ? '<span class="badge pendiente">Activo</span>'
      : '<span style="background:#F0F0F0;color:#777;padding:3px 9px;border-radius:20px;font-size:11px">Inactivo</span>';
    var accionesEdicion = esMoto ? '' :
        '<div style="display:flex;gap:4px">' +
          '<button class="btn btn-sm" onclick="editarMoto(' + m.id + ')"><i class="ti ti-pencil"></i></button>' +
          '<button class="btn btn-sm" onclick="confirmarEliminarMoto(' + m.id + ')" style="color:#A32D2D;border-color:#F09595"><i class="ti ti-trash"></i></button>' +
        '</div>';
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
        '<button class="btn btn-primary btn-sm" onclick="abrirDetalleMotoHistorial(' + m.id + ')">' +
          '<i class="ti ti-eye"></i> Ver detalle</button>' +
        accionesEdicion +
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
  var filas = await Promise.all(_motorizadosVisibles().map(async function(m) {
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
function _fechaHaceDiasMoto(n) {
  var d = new Date();
  d.setDate(d.getDate() - n);
  var mm = ('0'+(d.getMonth()+1)).slice(-2);
  var dd = ('0'+d.getDate()).slice(-2);
  return d.getFullYear() + '-' + mm + '-' + dd;
}

function _marcarBotonActivoMotos(tipo) {
  var btnHoy  = document.getElementById('btn-hoy-motos');
  var btnAyer = document.getElementById('btn-ayer-motos');
  if (btnHoy)  btnHoy.classList.toggle('active', tipo === 'hoy');
  if (btnAyer) btnAyer.classList.toggle('active', tipo === 'ayer');
}

window.aplicarFiltroMotos = function() {
  var inp = document.getElementById('filtro-fecha-motos');
  _filtroFechaMoto = inp ? inp.value : '';
  _marcarBotonActivoMotos(null);
  _renderTablaResumen();
  _refrescarPanelDetalleSiAbierto();
};

window.filtroRapidoMotos = function(tipo) {
  var fecha = tipo === 'hoy' ? _fechaHaceDiasMoto(0) : _fechaHaceDiasMoto(1);
  _filtroFechaMoto = fecha;
  var inp = document.getElementById('filtro-fecha-motos');
  if (inp) inp.value = fecha;
  _marcarBotonActivoMotos(tipo);
  _renderTablaResumen();
  _refrescarPanelDetalleSiAbierto();
};

window.limpiarFiltroMotos = function() {
  _filtroFechaMoto = '';
  var inp = document.getElementById('filtro-fecha-motos');
  if (inp) inp.value = '';
  _marcarBotonActivoMotos(null);
  _renderTablaResumen();
  _refrescarPanelDetalleSiAbierto();
};

/* Si el panel de detalle de un motorizado está abierto, lo vuelve a
   cargar con el filtro de fecha actual (para que no quede desactualizado) */
function _refrescarPanelDetalleSiAbierto() {
  var panel = document.getElementById('panel-detalle-moto');
  if (panel && panel.style.display !== 'none' && _motoDetalleAbiertoId) {
    abrirDetalleMotoHistorial(_motoDetalleAbiertoId);
  }
}

/* ════════════════════════════════════════════
   DETALLE HISTORIAL INLINE
════════════════════════════════════════════ */
window.abrirDetalleMotoHistorial = async function(motoId) {
  var m = MOTORIZADOS.find(function(x){ return x.id == motoId; });
  if (!m) return;

  var panel = document.getElementById('panel-detalle-moto');
  if (!panel) return;

  _motoDetalleAbiertoId = motoId;
  panel.innerHTML = '<div style="padding:20px;text-align:center;color:var(--color-text-secondary)"><i class="ti ti-loader" style="font-size:24px"></i> Cargando...</div>';
  panel.style.display = 'block';

  var s = await _calcularStatsMoto(motoId, _filtroFechaMoto);

  if (!s) {
    panel.innerHTML = '<div style="padding:20px;text-align:center;color:var(--color-text-tertiary)">' +
      'Sin órdenes para ' + m.nombre + (_filtroFechaMoto ? ' el ' + _fechaDisplayM(_filtroFechaMoto) : '') +
      '</div>';
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

function _linkWhatsApp(telefono, nombreDest) {
  var limpio = telefono.replace(/[^0-9]/g, '');
  if (limpio.length === 9) limpio = '51' + limpio;

  var saludo = nombreDest && nombreDest.trim() && nombreDest.trim() !== '—'
    ? 'Buenas tardes ' + nombreDest.trim() + ', le saludamos de Velox, para comentarle que estamos llegando a su ubicación en 10 minutos.'
    : 'Buenas tardes, le saludamos de Velox, para comentarle que estamos llegando a su ubicación en 10 minutos.';

  return 'https://wa.me/' + limpio + '?text=' + encodeURIComponent(saludo);
}

function _botonWhatsApp(telefono, nombreDest, telefono2) {
  if (!telefono && !telefono2) {
    return '<span style="color:var(--color-text-tertiary);font-size:11px">Sin teléfono</span>';
  }

  var html = '<div style="display:flex;flex-direction:column;gap:4px">';

  if (telefono) {
    html += '<a href="' + _linkWhatsApp(telefono, nombreDest) + '" target="_blank" rel="noopener" ' +
      'style="display:inline-flex;align-items:center;gap:5px;background:#25D366;color:#fff;' +
      'padding:5px 12px;border-radius:var(--radius-md);font-size:12px;font-weight:600;text-decoration:none">' +
      '<i class="ti ti-brand-whatsapp"></i> WhatsApp</a>';
  }
  if (telefono2) {
    html += '<a href="' + _linkWhatsApp(telefono2, nombreDest) + '" target="_blank" rel="noopener" ' +
      'style="display:inline-flex;align-items:center;gap:5px;background:#25D366;color:#fff;' +
      'padding:5px 12px;border-radius:var(--radius-md);font-size:11px;font-weight:600;text-decoration:none;opacity:0.85">' +
      '<i class="ti ti-brand-whatsapp"></i> Adicional</a>';
  }

  html += '</div>';
  return html;
}

/* Órdenes en estos estados ya están cerradas: no tiene sentido reasignarlas */
var _ESTADOS_NO_REASIGNABLES = ['entregado', 'cancelado'];

function _renderTablaOrdenesDetalle(ordenes) {
  var esMoto = _esSesionMotorizado(); /* un motorizado no puede reasignar (el backend tampoco lo permite) */
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
    'efectivo':'Efectivo','pago-tienda':'Pago tienda','sin-cobro':'Sin cobro',
    'contraentrega':'Contraentrega'
  };

  /* Estados que SÍ generan cobro */
  var estadosConCobro = ['entregado', 'ausente'];

  var cols = ['Código','Tienda','Destinatario','','Distrito','Estado','Método',
              'Delivery','Cobrado','Pago moto','Total moto','Especial','Fecha',''];

  return '<div class="table-wrap"><table style="width:100%;border-collapse:collapse;font-size:12px">' +
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
        '<td style="padding:8px 12px">' + _botonWhatsApp(o.dest_telefono, o.dest_nombre, o.dest_telefono_2) + '</td>' +
        '<td style="padding:8px 12px">' + o.distrito + '</td>' +
        '<td style="padding:8px 12px">' + (badgeMap[o.estado]||o.estado) + '</td>' +
        '<td style="padding:8px 12px;font-size:11px">' + (metodoLabel[o.metodo_pago]||o.metodo_pago||'—') + '</td>' +
        '<td style="padding:8px 12px;font-weight:500">' + deliveryStr + '</td>' +
        '<td style="padding:8px 12px;font-weight:500">' + cobradoStr + '</td>' +
        '<td style="padding:8px 12px;color:var(--color-amber-text);font-weight:600">' + pagoMotoStr + '</td>' +
        '<td style="padding:8px 12px">' + totalMotoStr + '</td>' +
        '<td style="padding:8px 12px">' + especial + '</td>' +
        '<td style="padding:8px 12px;font-size:11px;color:var(--color-text-secondary)">' + _fechaDisplayM(o.fecha) + '</td>' +
        '<td style="padding:8px 12px"><div style="display:flex;gap:4px;flex-wrap:wrap">' +
          '<button class="btn btn-sm" onclick="abrirActualizarEstadoOrden(' + o.id + ')"><i class="ti ti-refresh"></i> Actualizar</button>' +
          (!esMoto && !_ESTADOS_NO_REASIGNABLES.includes(o.estado)
            ? '<button class="btn btn-sm" style="color:var(--color-amber-text);border-color:#fcd34d" ' +
              'onclick="abrirReasignarDetalle(' + o.id + ')" title="Reasignar a otro motorizado">' +
              '<i class="ti ti-arrows-exchange"></i> Reasignar</button>'
            : '') +
        '</div></td>' +
      '</tr>';
    }).join('') +
    '</tbody></table></div>';
}

/* ════════════════════════════════════════════
   MODAL — REASIGNAR ORDEN A OTRO MOTORIZADO
   Se abre desde el botón "Reasignar" del historial
   de un motorizado. Hace el mismo PATCH que usa la
   página "Asignación" (PATCH /ordenes/:id/asignar).
════════════════════════════════════════════ */
var _reasignandoOrdenIdDet = null;

window.abrirReasignarDetalle = async function(ordenId) {
  _reasignandoOrdenIdDet = ordenId;

  var overlay = document.getElementById('modal-reasignar-det');
  var lista   = document.getElementById('reasignar-det-lista');
  var info    = document.getElementById('reasignar-det-info');
  if (!overlay || !lista || !info) return;

  info.textContent = 'Cargando...';
  lista.innerHTML = '';
  overlay.style.display = 'flex';

  try {
    var r = await fetch(API + '/ordenes/' + ordenId);
    var orden = await r.json();
    if (!r.ok) throw new Error(orden.error || 'No se pudo cargar la orden');

    info.textContent = '#' + orden.codigo + ' · ' + orden.tienda + ' → ' + orden.distrito;

    var activos = MOTORIZADOS.filter(function(m) {
      return m.activo && m.id != _motoDetalleAbiertoId;
    });

    if (activos.length === 0) {
      lista.innerHTML = '<div style="padding:12px;text-align:center;color:var(--color-text-tertiary);font-size:13px">' +
        'No hay otros motorizados activos</div>';
      return;
    }

    lista.innerHTML = activos.map(function(m) {
      return '<div style="display:flex;align-items:center;justify-content:space-between;' +
        'padding:10px 12px;border-radius:var(--radius-md);border:1px solid var(--color-border-tertiary);margin-bottom:6px">' +
        '<div style="display:flex;align-items:center;gap:10px">' +
          '<div class="avatar ' + m.color_avatar + '" style="width:32px;height:32px;font-size:12px">' + m.iniciales + '</div>' +
          '<div style="font-size:13px;font-weight:600">' + m.nombre +
            (m.zona ? ' <span style="font-weight:400;color:var(--color-text-secondary)">· ' + m.zona + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<button class="btn btn-primary btn-sm" onclick="confirmarReasignarDetalle(\'' + m.nombre.replace(/'/g, "\\'") + '\')">' +
          '<i class="ti ti-check"></i> Seleccionar</button>' +
      '</div>';
    }).join('');
  } catch (err) {
    info.textContent = '';
    lista.innerHTML = '<div style="padding:12px;text-align:center;color:#A32D2D;font-size:13px">Error al cargar la orden</div>';
  }
};

window.cerrarModalReasignarDetalle = function() {
  var overlay = document.getElementById('modal-reasignar-det');
  if (overlay) overlay.style.display = 'none';
  _reasignandoOrdenIdDet = null;
};

window.confirmarReasignarDetalle = async function(nuevoMotoNombre) {
  if (!_reasignandoOrdenIdDet) return;

  try {
    var r = await fetch(API + '/ordenes/' + _reasignandoOrdenIdDet + '/asignar', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motorizado: nuevoMotoNombre }),
    });
    if (!r.ok) throw new Error('No se pudo reasignar');

    var motoOrigen = _motoDetalleAbiertoId;
    cerrarModalReasignarDetalle();
    if (typeof showNotif === 'function') showNotif('Orden reasignada a ' + nuevoMotoNombre);

    /* La orden ya no es de este motorizado: refrescar su historial y el resumen */
    if (motoOrigen) abrirDetalleMotoHistorial(motoOrigen);
    if (typeof _renderTablaResumen === 'function') _renderTablaResumen();
  } catch (err) {
    if (typeof showNotif === 'function') showNotif('Error al reasignar el pedido');
  }
};

window.cerrarDetalleMotoHistorial = function() {
  var panel = document.getElementById('panel-detalle-moto');
  if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
  _motoDetalleAbiertoId = null;
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

  var validaciones = [
    validarTexto(nombre, { obligatorio: true, min: 2, max: 100, nombreCampo: 'El nombre del motorizado' }),
    validarTelefonoObligatorio(telefono),
    validarDNI(dni, { obligatorio: true }),
    validarPlaca(placa),
    validarTexto(referencia, { max: 200, nombreCampo: 'La referencia' }),
  ];
  if (!ejecutarValidaciones(validaciones, errEl)) return;

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

window.abrirEliminarMotoFisico = function() {
  var m = MOTORIZADOS.find(function(x){ return x.id == _motoElimId; });
  if (!m) return;
  var idGuardado = m.id, nombreGuardado = m.nombre;
  cerrarConfirmMoto();
  abrirConfirmarEliminacionFisica(nombreGuardado, API + '/motorizados/' + idGuardado + '/permanente', function() {
    renderMotorizados();
  });
};

window.initMotorizados = function() {
  /* Todos arrancan con "Hoy" por defecto */
  _filtroFechaMoto = _fechaHaceDiasMoto(0);
  renderMotorizados().then(function() {
    var inp = document.getElementById('filtro-fecha-motos');
    if (inp) inp.value = _filtroFechaMoto;
    _marcarBotonActivoMotos('hoy');
  });
};

/* ════════════════════════════════════════════
   ACTUALIZAR ESTADO DE ORDEN (desde el detalle
   de motorizado). Esto hace PATCH directo en la
   tabla "ordenes" — el cambio se refleja en TODA
   la app (Pedidos, Caja, Evidencias, Clientes)
   porque todas leen de la misma BD en tiempo real.
════════════════════════════════════════════ */
var _ordenActualizarId = null;
var _ordenActualizarBloqueaEnProceso = false; /* true si hace falta confirmar la devolución primero */

var _ESTADOS_ORDEN = [
  { value: 'entregado',    label: 'Entregado' },
  { value: 'no-entregado', label: 'No entregado' },
  { value: 'ausente',      label: 'Ausente' },
  { value: 'reprogramado', label: 'Reprogramado' },
  { value: 'cancelado',    label: 'Cancelado' },
  { value: 'devolucion',   label: 'Devolución' },
  { value: 'en-proceso',   label: 'En proceso' },
];

/* "Cambio"/"Recojo"/"Escoge talla" no son estados de progreso, son
   condiciones especiales aparte (columna condicion_especial) */
var _CONDICIONES_ESPECIALES = [
  { value: 'cambio',       label: 'Cambio' },
  { value: 'recojo',       label: 'Recojo' },
  { value: 'escoge-talla', label: 'Escoge talla' },
];

var _METODOS_PAGO = [
  { value: 'sin-cobro',     label: 'Sin cobro' },
  { value: 'contraentrega', label: 'Contraentrega' },
  { value: 'yape',          label: 'Yape' },
  { value: 'plin',          label: 'Plin' },
  { value: 'pos',           label: 'POS' },
  { value: 'efectivo',      label: 'Efectivo' },
  { value: 'pago-tienda',   label: 'Pago tienda' },
];

window.abrirActualizarEstadoOrden = async function(ordenId) {
  _ordenActualizarId = ordenId;

  var overlay = document.getElementById('orden-estado-modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'orden-estado-modal-overlay';
    overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:1100;align-items:flex-start;justify-content:center;overflow-y:auto;padding:40px 0';
    document.body.appendChild(overlay);
  }

  overlay.innerHTML = '<div style="background:var(--color-bg-primary);border-radius:var(--radius-lg);padding:24px;width:480px;max-width:95vw;text-align:center;color:var(--color-text-secondary)"><i class="ti ti-loader"></i> Cargando datos de la orden...</div>';
  overlay.style.display = 'flex';

  try {
    var [rOrden, rTiendas, rDistritos, rMotos] = await Promise.all([
      fetch(API + '/ordenes/' + ordenId),
      fetch(API + '/tiendas'),
      fetch(API + '/tarifas'),
      fetch(API + '/motorizados'),
    ]);
    var orden       = await rOrden.json();
    var tiendas     = await rTiendas.json();
    var distritos   = await rDistritos.json();
    var motorizados = await rMotos.json();

    _renderModalActualizarOrden(orden, tiendas, distritos, motorizados);
  } catch (err) {
    overlay.innerHTML = '<div style="background:var(--color-bg-primary);border-radius:var(--radius-lg);padding:24px;width:380px;text-align:center;color:#A32D2D">Error al cargar la orden.</div>';
  }
};

/* Estados que hacen que el motorizado vuelva a la oficina con el
   producto en mano. Compartido con js/pedidos.js y
   js/pendiente-devolucion.js (para no repetir esta lista en 3 lados). */
var _ESTADOS_CON_DEVOLUCION = ['reprogramado', 'cancelado', 'no-entregado', 'ausente'];

/* Reprogramado/No entregado cambian de estado al confirmar (vuelven a
   "en-proceso"), así que pueden volver a calificar en un ciclo futuro.
   Ausente/Cancelado/condición especial NO cambian de estado al confirmar
   (a propósito: Ausente conserva el cobro, Cancelado y condición especial
   pasan a "Devolución Tienda") — ahí el "ya se atendió" no lo dice el
   estado, lo dice el contador: si ya se confirmó una vez, no vuelve a
   calificar acá (para Cancelado/condición especial, el siguiente paso es
   la página "Devolución Tienda", no volver a aparecer en esta lista). */
var _ESTADOS_UNA_SOLA_VEZ = ['ausente', 'cancelado'];

function _calificaDevolucion(estado, condicionEspecial, devuelto) {
  var yaConfirmado = parseInt(devuelto) > 0;
  if (_ESTADOS_UNA_SOLA_VEZ.includes(estado) || condicionEspecial) {
    return !yaConfirmado;
  }
  return _ESTADOS_CON_DEVOLUCION.includes(estado);
}

function _renderModalActualizarOrden(orden, tiendas, distritos, motorizados) {
  var overlay = document.getElementById('orden-estado-modal-overlay');
  if (!overlay) return;

  var calificaDevolucion = _calificaDevolucion(orden.estado, orden.condicionEspecial, orden.devuelto);
  var vecesDevuelto = parseInt(orden.devuelto) || 0;
  _ordenActualizarBloqueaEnProceso = calificaDevolucion;

  /* Contador siempre visible, sin importar si la orden está calificando
     ahora mismo o no — es el historial de esta orden */
  var contadorDevueltoHTML =
    '<div style="font-size:11px;color:var(--color-text-tertiary)">' +
      'Veces que volvió a la oficina: <strong style="color:var(--color-text-secondary)">' + vecesDevuelto + '</strong>' +
    '</div>';

  var seccionDevuelto = '';
  if (calificaDevolucion) {
    seccionDevuelto =
      '<div style="background:var(--color-amber-bg);border-radius:var(--radius-md);padding:12px 14px">' +
        '<div style="font-size:13px;font-weight:600;color:var(--color-amber-text);margin-bottom:4px">' +
          '¿El motorizado ya devolvió el producto a la oficina?' +
        '</div>' +
        '<div style="font-size:11px;color:var(--color-text-secondary);margin-bottom:10px">' +
          (orden.estado === 'ausente'
            ? 'A esta orden ya se le cobró el viaje a la tienda: se va a crear una orden nueva para reintentar la entrega.'
            : (orden.estado === 'cancelado' || orden.condicionEspecial)
            ? 'El producto no vuelve a salir a reparto: queda en almacén, pendiente de devolver a la tienda (ver la página "Devolución Tienda").'
            : 'La orden va a volver a "En proceso" para que pueda salir de nuevo.') +
        '</div>' +
        '<button type="button" class="btn btn-primary btn-sm" onclick="confirmarDevolucionOrden(' + orden.id + ', this)">' +
          '<i class="ti ti-package-import"></i> Confirmar devolución' +
        '</button>' +
      '</div>';
  } else if (vecesDevuelto > 0) {
    seccionDevuelto =
      '<div style="background:var(--color-green-bg);border-radius:var(--radius-md);padding:10px 14px;' +
      'font-size:13px;color:var(--color-green-text);display:flex;align-items:center;gap:8px">' +
        '<i class="ti ti-circle-check"></i> Producto devuelto a Velox — confirmado' +
      '</div>';
  }

  overlay.innerHTML =
    '<div style="background:var(--color-bg-primary);border-radius:var(--radius-lg);padding:24px;width:480px;max-width:95vw;box-shadow:0 8px 32px rgba(0,0,0,0.18);margin:auto">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">' +
        '<span style="font-size:15px;font-weight:500">Actualizar orden #' + orden.codigo + '</span>' +
        '<button onclick="cerrarActualizarEstadoOrden()" style="background:none;border:none;cursor:pointer;font-size:18px;color:var(--color-text-secondary)"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:14px">' +

        '<div>' +
          '<label style="font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:4px">Tienda cliente</label>' +
          '<input id="f-orden-tienda-update" class="search-box" style="width:100%" placeholder="Escribe para buscar tienda..." value="' + (orden.tienda||'').replace(/"/g,'&quot;') + '" />' +
        '</div>' +

        '<div>' +
          '<label style="font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:4px">Motorizado asignado <span style="font-weight:400;color:var(--color-text-tertiary)">(opcional)</span></label>' +
          '<input id="f-orden-motorizado-update" class="search-box" style="width:100%" placeholder="Escribe para buscar motorizado..." value="' + (orden.motorizado||'').replace(/"/g,'&quot;') + '" />' +
        '</div>' +

        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
          '<div>' +
            '<label style="font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:4px">Nombre destinatario</label>' +
            '<input id="f-orden-dest-update" class="search-box" style="width:100%" maxlength="100" value="' + (orden.dest_nombre||'') + '" />' +
          '</div>' +
          '<div>' +
            '<label style="font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:4px">Distrito</label>' +
            '<input id="f-orden-distrito-update" class="search-box" style="width:100%" placeholder="Escribe para buscar distrito..." value="' + (orden.distrito||'').replace(/"/g,'&quot;') + '" />' +
          '</div>' +
        '</div>' +

        '<div>' +
          '<label style="font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:4px">Dirección de entrega</label>' +
          '<input id="f-orden-direccion-update" class="search-box" style="width:100%" maxlength="200" value="' + (orden.dest_direccion||'') + '" />' +
        '</div>' +

        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
          '<div>' +
            '<label style="font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:4px">Teléfono</label>' +
            '<input id="f-orden-telefono-update" class="search-box" style="width:100%" placeholder="Ej: 987654321" maxlength="9" inputmode="numeric" ' +
              'oninput="this.value=this.value.replace(/[^0-9]/g,\'\')" value="' + (orden.dest_telefono||'') + '" />' +
          '</div>' +
          '<div>' +
            '<label style="font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:4px">Teléfono adicional</label>' +
            '<input id="f-orden-telefono2-update" class="search-box" style="width:100%" placeholder="Si hay otro" maxlength="9" inputmode="numeric" ' +
              'oninput="this.value=this.value.replace(/[^0-9]/g,\'\')" value="' + (orden.dest_telefono_2||'') + '" />' +
          '</div>' +
        '</div>' +

        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
          '<div>' +
            '<label style="font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:4px">Estado</label>' +
            '<select id="f-orden-estado-update" class="filter-select" style="width:100%">' +
              _ESTADOS_ORDEN.map(function(e){
                return '<option value="' + e.value + '"' + (e.value===orden.estado?' selected':'') + '>' + e.label + '</option>';
              }).join('') +
            '</select>' +
          '</div>' +
          '<div>' +
            '<label style="font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:4px">Método de pago</label>' +
            '<select id="f-orden-metodo-update" class="filter-select" style="width:100%" onchange="onMetodoPagoChangeUpdate()">' +
              _METODOS_PAGO.map(function(m){
                return '<option value="' + m.value + '"' + (m.value===(orden.metodo_pago||'sin-cobro')?' selected':'') + '>' + m.label + '</option>';
              }).join('') +
            '</select>' +
          '</div>' +
        '</div>' +

        '<div>' +
          '<label style="font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:6px">Condiciones especiales</label>' +
          '<div style="display:flex;align-items:center;gap:10px">' +
            '<label class="toggle-switch">' +
              '<input type="checkbox" id="f-orden-tiene-condicion-update" onchange="onToggleCondicionUpdate()"' + (orden.condicionEspecial ? ' checked' : '') + ' />' +
              '<span class="toggle-slider"></span>' +
            '</label>' +
            '<select id="f-orden-condicion-update" class="filter-select" style="flex:1"' + (orden.condicionEspecial ? '' : ' disabled') + '>' +
              '<option value="">Ninguna</option>' +
              _CONDICIONES_ESPECIALES.map(function(c){
                return '<option value="' + c.value + '"' + (c.value===orden.condicionEspecial?' selected':'') + '>' + c.label + '</option>';
              }).join('') +
            '</select>' +
          '</div>' +
        '</div>' +

        '<div>' +
          '<label style="font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:6px">Pago del delivery en oficina</label>' +
          '<div style="display:flex;align-items:center;gap:10px">' +
            '<label class="toggle-switch">' +
              '<input type="checkbox" id="f-orden-prepagado-update" onchange="onTogglePrepagadoUpdate()"' + (orden.pago_velox === 'PAGADO' ? ' checked' : '') + ' />' +
              '<span class="toggle-slider"></span>' +
            '</label>' +
            '<span id="f-orden-prepagado-update-label" style="font-size:13px;font-weight:500">' +
              (orden.pago_velox === 'PAGADO' ? 'Pre pagado' : 'Post pago') +
            '</span>' +
            '<select id="f-orden-prepagado-metodo-update" class="filter-select" style="flex:1"' + (orden.pago_velox === 'PAGADO' ? '' : ' disabled') + '>' +
              '<option value="">¿Cómo?</option>' +
              '<option value="efectivo"' + (orden.pago_velox_metodo==='efectivo'?' selected':'') + '>Efectivo</option>' +
              '<option value="yape"' + (orden.pago_velox_metodo==='yape'?' selected':'') + '>Yape</option>' +
            '</select>' +
          '</div>' +
        '</div>' +

        contadorDevueltoHTML +
        seccionDevuelto +

        '<div style="font-size:12px;color:var(--color-text-secondary);font-weight:600;margin-top:4px">Montos (S/)</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
          '<div>' +
            '<label style="font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:4px">Cobrado</label>' +
            '<input id="f-orden-cobrado-update" type="number" step="0.01" min="0" class="search-box" style="width:100%;background:var(--color-green-bg)" value="' + (orden.monto_cobrado||0) + '" oninput="_recalcularValorProductoUpdate()" />' +
          '</div>' +
          '<div>' +
            '<label style="font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:4px">Valor producto <span style="font-weight:400;color:var(--color-text-tertiary)">(automático)</span></label>' +
            '<input id="f-orden-producto-update" type="number" step="0.01" min="0" class="search-box" style="width:100%;background:var(--color-bg-secondary)" value="' + (orden.monto_producto||0) + '" readonly />' +
          '</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
          '<div>' +
            '<label style="font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:4px">Delivery base</label>' +
            '<input id="f-orden-delivery-update" type="number" step="0.01" min="0" class="search-box" style="width:100%" value="' + (orden.delivery_base||0) + '" oninput="_recalcularValorProductoUpdate()" />' +
          '</div>' +
          '<div>' +
            '<label style="font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:4px">Adicional</label>' +
            '<input id="f-orden-adicional-update" type="number" step="0.01" min="0" class="search-box" style="width:100%" value="' + (orden.monto_adicional||0) + '" oninput="_recalcularValorProductoUpdate()" />' +
          '</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
          '<div>' +
            '<label style="font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:4px">Pago moto base</label>' +
            '<input id="f-orden-pagomoto-update" type="number" step="0.01" min="0" class="search-box" style="width:100%" value="' + (orden.pago_moto_base||0) + '" />' +
          '</div>' +
          '<div>' +
            '<label style="font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:4px">Pago moto adicional</label>' +
            '<input id="f-orden-pagomotoad-update" type="number" step="0.01" min="0" class="search-box" style="width:100%" value="' + (orden.pago_moto_adicional||0) + '" />' +
          '</div>' +
        '</div>' +

        '<div>' +
          '<label style="font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:4px">Observaciones</label>' +
          '<input id="f-orden-obs-update" class="search-box" style="width:100%" maxlength="300" value="' + (orden.observaciones||'') + '" />' +
        '</div>' +

        '<div id="orden-estado-error" style="display:none;color:#A32D2D;font-size:12px;padding:8px 12px;background:#FCEBEB;border-radius:var(--radius-md)"></div>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px">' +
        '<button class="btn btn-sm" onclick="cerrarActualizarEstadoOrden()">Cancelar</button>' +
        '<button class="btn btn-primary btn-sm" onclick="guardarActualizarEstadoOrden()"><i class="ti ti-check"></i> Guardar</button>' +
      '</div>' +
    '</div>';

  /* El modal se reconstruye entero cada vez que se abre, así que los
     comboboxes se inician de nuevo en cada apertura (ver js/combobox.js) */
  _distritosCatalogoUpdate = distritos;

  initComboBuscable('f-orden-tienda-update', function() {
    return tiendas.map(function(t) { return { value: t.nombre, label: t.nombre }; });
  });

  initComboBuscable('f-orden-motorizado-update', function() {
    return motorizados.filter(function(m){ return m.activo; }).map(function(m) {
      return { value: m.nombre, label: m.nombre + (m.zona ? ' — ' + m.zona : '') };
    });
  });

  initComboBuscable('f-orden-distrito-update', function() {
    return distritos.map(function(d) { return { value: d.distrito, label: d.distrito }; });
  }, function(valor) { onDistritoChangeUpdate(valor); });

  /* Recalcula de una por si el valor guardado había quedado desactualizado,
     y bloquea "Cobrado" si el método ya venía en "Sin cobro" */
  onMetodoPagoChangeUpdate();
}

/* "Sin cobro" bloquea y limpia "Cobrado" — no tiene sentido que el
   motorizado reporte un monto cobrado si el método dice que no cobró
   nada (sería un error de gestión, ver el pedido del usuario). */
window.onMetodoPagoChangeUpdate = function() {
  var sel   = document.getElementById('f-orden-metodo-update');
  var fCobr = document.getElementById('f-orden-cobrado-update');
  if (!sel || !fCobr) return;
  var esSinCobro = sel.value === 'sin-cobro';
  fCobr.disabled = esSinCobro;
  if (esSinCobro) fCobr.value = '0';
  _recalcularValorProductoUpdate();
};

/* Valor producto = lo que se cobró de más sobre el delivery (con su
   adicional) — es lo que se le debe devolver a la tienda. Se recalcula
   solo, no se escribe a mano (ver D-005 y el pedido del usuario). */
window._recalcularValorProductoUpdate = function() {
  var fDeliv = document.getElementById('f-orden-delivery-update');
  var fAdic  = document.getElementById('f-orden-adicional-update');
  var fCobr  = document.getElementById('f-orden-cobrado-update');
  var fProd  = document.getElementById('f-orden-producto-update');
  if (!fDeliv || !fAdic || !fCobr || !fProd) return;

  var delivery  = parseFloat(fDeliv.value) || 0;
  var adicional = parseFloat(fAdic.value)  || 0;
  var cobrado   = parseFloat(fCobr.value)  || 0;
  var producto  = cobrado - (delivery + adicional);

  fProd.value = (producto > 0 ? producto : 0).toFixed(2);
};

/* Habilita el select de condición especial solo si el interruptor está prendido */
window.onToggleCondicionUpdate = function() {
  var chk = document.getElementById('f-orden-tiene-condicion-update');
  var sel = document.getElementById('f-orden-condicion-update');
  if (!chk || !sel) return;
  sel.disabled = !chk.checked;
  if (!chk.checked) sel.value = '';
};

/* Actualiza la etiqueta "Post pago" / "Pre pagado" y habilita el
   select de Efectivo/Yape solo si el interruptor está prendido */
window.onTogglePrepagadoUpdate = function() {
  var chk = document.getElementById('f-orden-prepagado-update');
  var lbl = document.getElementById('f-orden-prepagado-update-label');
  var sel = document.getElementById('f-orden-prepagado-metodo-update');
  if (!chk || !lbl) return;
  lbl.textContent = chk.checked ? 'Pre pagado' : 'Post pago';
  if (sel) {
    sel.disabled = !chk.checked;
    if (!chk.checked) sel.value = '';
  }
};

/* ── Confirmar que el motorizado devolvió el producto — acción aparte,
   separada del botón "Guardar" porque dispara un cambio importante
   (cambia el estado, o crea una orden nueva) ── */
/**
 * @param {number} [ordenId] - Si no se pasa, usa la orden abierta en el modal.
 * @param {HTMLElement} [btnEl] - Botón que disparó la acción, se desactiva
 *        mientras se procesa para evitar un doble click accidental.
 */
window.confirmarDevolucionOrden = async function(ordenId, btnEl) {
  ordenId = ordenId || _ordenActualizarId;
  if (!ordenId) return;

  if (btnEl) { btnEl.disabled = true; }
  var errEl = document.getElementById('orden-estado-error');

  try {
    var r = await fetch(API + '/ordenes/' + ordenId + '/devolver', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
    });
    var data = await r.json().catch(function(){ return {}; });
    if (!r.ok) throw new Error(data.error || 'No se pudo procesar la devolución');

    if (_ordenActualizarId == ordenId) cerrarActualizarEstadoOrden();
    if (typeof showNotif === 'function') {
      showNotif(data.duplicada
        ? 'Producto devuelto — se creó la orden #' + data.nuevoCodigo + ' para reintentar'
        : data.almacen
        ? 'Producto devuelto — queda en almacén, pendiente de devolver a la tienda'
        : 'Producto devuelto — la orden volvió a "En proceso"');
    }

    if (typeof _renderTablaResumen === 'function') _renderTablaResumen();
    if (typeof _motoDetalleAbiertoId !== 'undefined' && _motoDetalleAbiertoId) abrirDetalleMotoHistorial(_motoDetalleAbiertoId);
    if (typeof renderPedidos === 'function') renderPedidos();
    if (typeof _recargarTablaPendienteDevolucion === 'function') _recargarTablaPendienteDevolucion();
    if (typeof _recargarTablaDevolucionTienda === 'function') _recargarTablaDevolucionTienda();
    if (typeof _refrescarCajaActual === 'function') _refrescarCajaActual();
  } catch (err) {
    if (btnEl) { btnEl.disabled = false; }
    if (errEl) {
      errEl.textContent = err.message || 'Error al procesar la devolución.';
      errEl.style.display = 'block';
    } else if (typeof showNotif === 'function') {
      showNotif(err.message || 'Error al procesar la devolución.');
    }
  }
};

/* Catálogo de distritos vigente para el combobox del modal "Actualizar
   orden" — se refresca cada vez que _renderModalActualizarOrden corre */
var _distritosCatalogoUpdate = [];

window.onDistritoChangeUpdate = function(distritoSeleccionado) {
  var fDeliv    = document.getElementById('f-orden-delivery-update');
  var fPagoMoto = document.getElementById('f-orden-pagomoto-update');

  var d = _distritosCatalogoUpdate.find(function(x) { return x.distrito === distritoSeleccionado; });
  if (!d) return;

  if (fDeliv)    fDeliv.value    = parseFloat(d.precio_delivery).toFixed(2);
  if (fPagoMoto) fPagoMoto.value = parseFloat(d.pago_motorizado || 0).toFixed(2);
};

window.cerrarActualizarEstadoOrden = function() {
  var overlay = document.getElementById('orden-estado-modal-overlay');
  if (overlay) overlay.style.display = 'none';
  _ordenActualizarId = null;
};

window.guardarActualizarEstadoOrden = async function() {
  var tienda      = document.getElementById('f-orden-tienda-update').value;
  var dest        = document.getElementById('f-orden-dest-update').value.trim();
  var distrito    = document.getElementById('f-orden-distrito-update').value;
  var motorizado  = document.getElementById('f-orden-motorizado-update').value;
  var direccion   = document.getElementById('f-orden-direccion-update').value.trim();
  var telefono    = document.getElementById('f-orden-telefono-update').value.trim();
  var telefono2   = document.getElementById('f-orden-telefono2-update').value.trim();
  var estado      = document.getElementById('f-orden-estado-update').value;
  var tieneCondicion    = document.getElementById('f-orden-tiene-condicion-update').checked;
  var condicionEspecial = tieneCondicion ? document.getElementById('f-orden-condicion-update').value : '';
  var prepagado   = document.getElementById('f-orden-prepagado-update').checked ? 'pre-pagado' : 'post-pago';
  var prepagadoMetodo = prepagado === 'pre-pagado' ? document.getElementById('f-orden-prepagado-metodo-update').value : '';
  var metodoPago  = document.getElementById('f-orden-metodo-update').value;
  var delivery    = document.getElementById('f-orden-delivery-update').value;
  var adicional   = document.getElementById('f-orden-adicional-update').value;
  var cobrado     = document.getElementById('f-orden-cobrado-update').value;
  var producto    = document.getElementById('f-orden-producto-update').value;
  var pagoMoto    = document.getElementById('f-orden-pagomoto-update').value;
  var pagoMotoAd  = document.getElementById('f-orden-pagomotoad-update').value;
  var obs         = document.getElementById('f-orden-obs-update').value.trim();
  var errEl       = document.getElementById('orden-estado-error');

  if (!tienda || !distrito) {
    errEl.textContent = 'Tienda y distrito son obligatorios: elige uno de la lista.';
    errEl.style.display = 'block';
    return;
  }

  if (estado === 'en-proceso' && _ordenActualizarBloqueaEnProceso) {
    errEl.textContent = 'Esta orden necesita que confirmes la devolución del producto antes de pasarla a "En proceso" (usá el botón "Confirmar devolución" de arriba).';
    errEl.style.display = 'block';
    return;
  }

  var validaciones = [
    validarTexto(dest, { obligatorio: true, min: 2, max: 100, nombreCampo: 'El nombre del destinatario' }),
    validarTelefono(telefono),
    validarTelefono(telefono2),
    validarTexto(direccion, { min: 5, max: 200, nombreCampo: 'La dirección' }),
    validarTexto(obs, { max: 300, nombreCampo: 'Las observaciones' }),
  ];
  if (!ejecutarValidaciones(validaciones, errEl)) return;

  try {
    var rCompleto = await fetch(API + '/ordenes/' + _ordenActualizarId + '/completo', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tienda: tienda, dest: dest, distrito: distrito, direccion: direccion,
        telefDest: telefono, telefDest2: telefono2,
        delivery: delivery, montoAdicional: adicional, montoCobrado: cobrado, montoProducto: producto,
        pagoMotoBase: pagoMoto, pagoMotoAdic: pagoMotoAd,
        pagoVelox: prepagado, pagoVeloxMetodo: prepagadoMetodo,
        obs: obs,
      }),
    });
    if (!rCompleto.ok) {
      var errData = await rCompleto.json().catch(function(){ return {}; });
      throw new Error(errData.error || 'No se pudo actualizar la orden');
    }

    var rAsignar = await fetch(API + '/ordenes/' + _ordenActualizarId + '/asignar', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motorizado: motorizado || null }),
    });
    if (!rAsignar.ok) throw new Error('No se pudo actualizar el motorizado asignado');

    var rEstado = await fetch(API + '/ordenes/' + _ordenActualizarId + '/estado', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: estado, metodoPago: metodoPago, condicionEspecial: condicionEspecial }),
    });
    if (!rEstado.ok) throw new Error('No se pudo actualizar el estado');

    cerrarActualizarEstadoOrden();
    if (typeof showNotif === 'function') showNotif('Orden actualizada correctamente');

    /* Refrescar la vista actual, sea cual sea la página donde se abrió el modal.
       Cada función ya se cuida sola si su página no está en pantalla. */
    if (typeof _renderTablaResumen === 'function') _renderTablaResumen();
    if (typeof _motoDetalleAbiertoId !== 'undefined' && _motoDetalleAbiertoId) abrirDetalleMotoHistorial(_motoDetalleAbiertoId);
    if (typeof renderPedidos === 'function') renderPedidos();
    if (typeof _recargarTablaPendienteDevolucion === 'function') _recargarTablaPendienteDevolucion();
    if (typeof _recargarTablaDevolucionTienda === 'function') _recargarTablaDevolucionTienda();
    if (typeof _refrescarCajaActual === 'function') _refrescarCajaActual();

  } catch (err) {
    if (errEl) { errEl.textContent = err.message || 'Error al actualizar la orden.'; errEl.style.display = 'block'; }
  }
};
