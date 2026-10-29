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

/* Día de trabajo de una orden: su fecha de reparto (fecha_trabajo,
   la calcula GET /motorizados/:id/ordenes con ordenes.fecha_reparto),
   el mismo día que usan Pedidos y la Caja. o.fecha es la de creación,
   que no cambia. */
function _fechaTrabajoM(o) {
  return o.fecha_trabajo || o.fecha;
}

/* Celda "Fecha" del detalle: el día de trabajo y, si la orden se creó
   otro día, ese día en gris debajo (para ubicarla en Caja / Pedidos) */
function _celdaFechaTrabajoM(o) {
  var dia = _fechaTrabajoM(o);
  var html = _fechaDisplayM(dia);
  if (o.fecha && o.fecha !== dia) {
    html += '<div style="font-size:10px;color:var(--color-text-tertiary)">creada el ' + _fechaDisplayM(o.fecha) + '</div>';
  }
  return html;
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

  /* Renderizar filas async. Las celdas tienen que coincidir con los 13
     encabezados de pages/motorizados.html (Motorizado, Teléfono, Yape,
     9 columnas de números y la de acción) */
  var filas = await Promise.all(_motorizadosVisibles().map(async function(m) {
    var s = await _calcularStatsMoto(m.id, fecha);
    var celdasContacto =
      '<td style="font-size:12px">' + (m.telefono || '—') + '</td>' +
      '<td style="font-size:12px">' + (m.yape || '—') + '</td>';
    if (!s) {
      return '<tr>' +
        '<td><div style="display:flex;align-items:center;gap:8px">' +
          '<div class="avatar ' + m.color_avatar + '" style="width:30px;height:30px;font-size:11px">' + m.iniciales + '</div>' +
          '<strong>' + m.nombre + '</strong></div></td>' +
        celdasContacto +
        '<td colspan="9" style="color:var(--color-text-tertiary)">Sin órdenes</td>' +
        '<td class="col-accion-moto-fijo"><button class="btn btn-sm" onclick="abrirDetalleMotoHistorial(' + m.id + ')"><i class="ti ti-eye"></i></button></td>' +
      '</tr>';
    }
    var tc = s.tasaNum >= 75 ? 'var(--color-green)' : s.tasaNum >= 50 ? 'var(--color-amber)' : 'var(--color-red-text)';
    var totalMoto = s.cobrado - s.pagoTotal;
    var tmColor   = totalMoto > 0 ? 'var(--color-green)' : totalMoto < 0 ? 'var(--color-red-text)' : 'var(--color-text-secondary)';
    return '<tr>' +
      '<td><div style="display:flex;align-items:center;gap:8px">' +
        '<div class="avatar ' + m.color_avatar + '" style="width:30px;height:30px;font-size:11px">' + m.iniciales + '</div>' +
        '<strong>' + m.nombre + '</strong></div></td>' +
      celdasContacto +
      '<td><strong>' + s.total + '</strong></td>' +
      '<td style="color:var(--color-green);font-weight:600">' + s.entregados + '</td>' +
      '<td style="color:var(--color-red-text);font-weight:600">' + s.noEntregados + '</td>' +
      '<td style="color:var(--color-amber-text);font-weight:600">' + s.ausentes + '</td>' +
      '<td style="color:var(--color-purple-text);font-weight:600">' + s.reprogramados + '</td>' +
      '<td><span style="color:' + tc + ';font-weight:700">' + s.tasa + '</span></td>' +
      '<td style="font-weight:600">S/ ' + s.pagoTotal.toFixed(2) + '</td>' +
      '<td class="col-cobrado-fijo" style="font-weight:600;color:var(--color-blue-text)">S/ ' + s.cobrado.toFixed(2) + '</td>' +
      '<td class="col-totalmoto-fijo" style="font-weight:700;color:' + tmColor + '">S/ ' + totalMoto.toFixed(2) + '</td>' +
      '<td class="col-accion-moto-fijo"><button class="btn btn-primary btn-sm" onclick="abrirDetalleMotoHistorial(' + m.id + ')">' +
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

  return 'https://api.whatsapp.com/send?phone=' + limpio + '&text=' + encodeURIComponent(saludo);
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

  return '<div class="table-wrap"><table id="tabla-ordenes-moto-detalle" style="width:100%;border-collapse:collapse;font-size:12px">' +
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
        '<td style="padding:8px 12px"><strong>#' + o.codigo + '</strong>' + _iconoEvidenciaPendiente(o) + '</td>' +
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
        '<td style="padding:8px 12px;font-size:11px;color:var(--color-text-secondary);white-space:nowrap">' + _celdaFechaTrabajoM(o) + '</td>' +
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
      /* Sin fecha: conserva su día de reparto (ver PATCH /asignar) */
      body: JSON.stringify({ motorizado: nuevoMotoNombre }),
    });
    if (!r.ok) {
      var dataErr = await r.json().catch(function() { return {}; });
      throw new Error(dataErr.error || 'Error al reasignar el pedido');
    }

    var motoOrigen = _motoDetalleAbiertoId;
    cerrarModalReasignarDetalle();
    if (typeof showNotif === 'function') showNotif('Orden reasignada a ' + nuevoMotoNombre);

    /* La orden ya no es de este motorizado: refrescar su historial y el resumen */
    if (motoOrigen) abrirDetalleMotoHistorial(motoOrigen);
    if (typeof _renderTablaResumen === 'function') _renderTablaResumen();
  } catch (err) {
    if (typeof showNotif === 'function') showNotif(err.message || 'Error al reasignar el pedido', 5000);
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

  /* Agrupar por día de trabajo (el día en que se le asignó; ver
     _fechaTrabajoM), no por el día en que se creó la orden */
  var mapaFecha = {};
  todasOrdenes.forEach(function(o) {
    var dia = _fechaTrabajoM(o);
    if (!mapaFecha[dia]) mapaFecha[dia] = [];
    mapaFecha[dia].push(o);
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
/* Mientras no se escriba a mano en "Número Yape", copia el teléfono.
   Vive acá y no en pages/motorizados.html porque las páginas se
   inyectan con innerHTML y el navegador no ejecuta sus <script>. */
window.sincronizarYapeMoto = function() {
  var tel  = document.getElementById('f-moto-telefono');
  var yape = document.getElementById('f-moto-yape');
  if (tel && yape && !yape._editadoManual) yape.value = tel.value;
};

window.abrirModalMoto = function() {
  _motoEditId = null;
  document.getElementById('moto-modal-titulo').textContent = 'Agregar motorizado';
  document.getElementById('btn-guardar-moto').innerHTML = '<i class="ti ti-plus"></i> Agregar';
  ['f-moto-nombre','f-moto-telefono','f-moto-yape','f-moto-dni','f-moto-placa','f-moto-referencia'].forEach(function(id){
    var el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('f-moto-yape')._editadoManual = false;
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
  /* Si el Yape guardado es distinto del teléfono, se trata como
     editado a mano: cambiar el teléfono ya no lo pisa */
  var yapeEl = document.getElementById('f-moto-yape');
  yapeEl.value = m.yape || '';
  yapeEl._editadoManual = !!m.yape && m.yape !== (m.telefono || '');
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
  /* Vacío = el servidor copia el teléfono (routes/motorizados.js) */
  var yape       = document.getElementById('f-moto-yape').value.trim();
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
    /* Mismo formato que un teléfono, pero con su propio mensaje */
    (yape && !/^[0-9]{9}$/.test(yape))
      ? { ok: false, msg: 'El número Yape debe tener exactamente 9 dígitos.' }
      : { ok: true },
    validarDNI(dni, { obligatorio: true }),
    validarPlaca(placa),
    validarTexto(referencia, { max: 200, nombreCampo: 'La referencia' }),
  ];
  if (!ejecutarValidaciones(validaciones, errEl)) return;

  var body = { nombre, telefono, yape, zona, color, activo, dni, placa, referencia,
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
  /* "Mis entregas de hoy" arriba de todo (solo el rol motorizado; ver
     js/entregas-moto.js) */
  if (typeof initEntregasMoto === 'function') initEntregasMoto();

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

/* Control de concurrencia optimista (ver velox_agregar_concurrencia.sql
   y server/routes/ordenes.js): versión de la orden tal como la
   cargamos. Se va actualizando con la que devuelve cada PATCH
   exitoso, para encadenar los guardados de una misma sesión del
   modal — ver _patchOrdenConVersion(). */
var _ordenActualizarVersion = null;
/* Código visible de la orden abierta (ej. "C-1234"), para que el
   indicador de fotos diga de qué orden es cada evidencia en cola */
var _ordenActualizarCodigo = '';

/* Evidencia elegida en esta apertura del modal: JPEG comprimido en
   memoria (o null). No se sube al elegirla: al guardar la orden pasa a
   la cola de fotos (js/cola-fotos.js), que la sube con reintentos. */
var _medioPagoEvidenciaBlob = null;
/* true si la orden YA tenía una evidencia subida de una vez anterior —
   en ese caso no hace falta volver a tomar una para poder guardar */
var _medioPagoTeniaEvidenciaPrevia = false;
/* true si en la cola de ESTE teléfono ya hay una evidencia de esta
   orden esperando subir — tampoco hace falta volver a tomarla */
var _medioPagoEvidenciaEnCola = false;

/* Gate "Recibido" — solo motorizado, solo si la orden tiene condición
   especial (ver confirmarRecibidoCondicionEspecial) */
var _ordenActualizarRecibidoRequerido  = false;
var _ordenActualizarRecibidoConfirmado = false;

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
];

/* Medio de pago real (distinto de "Método de pago" de arriba):
   cómo se recibió la plata en la práctica. Selección única.
   "pago-tienda" y "pago-empresa" exigen evidencia fotográfica
   (ver server/r2.js y velox_agregar_medio_pago.sql). "pago-empresa"
   se muestra como "Pago Velox" — nombre distinto por dentro para no
   confundirlo con la columna pago_velox (prepago de la tienda en oficina). */
var _MEDIOS_PAGO = [
  { value: 'yape-motorizado',     label: 'Yape motorizado',     evidencia: false },
  { value: 'efectivo-motorizado', label: 'Efectivo motorizado', evidencia: false },
  { value: 'pago-tienda',         label: 'Pago tienda',         evidencia: true },
  { value: 'pago-empresa',        label: 'Pago Velox',          evidencia: true },
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
  _ordenActualizarVersion = orden.version || null;
  _ordenActualizarCodigo  = orden.codigo || '';

  /* Contador siempre visible, sin importar si la orden está calificando
     ahora mismo o no — es el historial de esta orden */
  var contadorDevueltoHTML =
    '<div style="font-size:11px;color:var(--color-text-tertiary)">' +
      'Veces que volvió a la oficina: <strong style="color:var(--color-text-secondary)">' + vecesDevuelto + '</strong>' +
    '</div>';

  var fotosOrden = Array.isArray(orden.fotos) ? orden.fotos : [];
  var fotosDevolucionHTML = _fotosDevolucionHTML(fotosOrden.filter(function(f) {
    return f.tipo === 'foto_devolucion' || f.tipo === 'foto_devolucion_tienda';
  }));
  var seccionFotosEntrega = _seccionFotosEntregaHTML(fotosOrden, orden.motivo_no_entrega);
  var codigoAttr = String(orden.codigo || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');

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
            : 'La orden va a volver a "En proceso" y sin motorizado, a Asignación, para asignarla de nuevo otro día.') +
        '</div>' +
        '<div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap">' +
          '<button type="button" class="btn btn-primary btn-sm" data-codigo="' + codigoAttr + '" ' +
                  'data-fotos-devolucion="' + (parseInt(orden.fotos_devolucion_total) || 0) + '" ' +
                  'onclick="confirmarDevolucionOrden(' + orden.id + ', this)">' +
            '<i class="ti ti-package-import"></i> Confirmar devolución' +
          '</button>' +
          fotosDevolucionHTML +
        '</div>' +
      '</div>';
  } else if (vecesDevuelto > 0) {
    seccionDevuelto =
      '<div style="background:var(--color-green-bg);border-radius:var(--radius-md);padding:10px 14px">' +
        '<div style="font-size:13px;color:var(--color-green-text);display:flex;align-items:center;gap:8px">' +
          '<i class="ti ti-circle-check"></i> Producto devuelto a Velox — confirmado' +
        '</div>' +
        (fotosDevolucionHTML ? '<div style="margin-top:10px">' + fotosDevolucionHTML + '</div>' : '') +
      '</div>';
  }

  /* Foto del producto: el mismo ícono de cámara y la misma vista previa
     que el modal de nueva orden (pages/pedidos.html), solo para ver.
     Sin foto no se muestra nada. La URL va en data-src y la imagen se
     pide recién al tocar el ícono (ver _toggleVistaPreviaFoto). */
  var seccionFotoProducto = '';
  if (orden.foto_producto_url) {
    var srcFoto = String(orden.foto_producto_url).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    seccionFotoProducto =
      '<div style="display:flex;align-items:center;gap:12px;background:var(--color-bg-secondary);border-radius:var(--radius-md);padding:10px 12px;margin-bottom:12px">' +
        '<button type="button" id="btn-ver-foto-orden-update" data-src="' + srcFoto + '" onclick="toggleVistaPreviaFotoUpdate(this)" title="Ver la foto del producto" ' +
                'style="position:relative;background:var(--color-bg-primary);border:1px solid var(--color-border-secondary);border-radius:var(--radius-md);width:46px;height:46px;flex-shrink:0;cursor:pointer;font-size:21px;color:var(--color-green)">' +
          '<i class="ti ti-camera"></i>' +
          '<span style="position:absolute;top:-5px;right:-5px;width:15px;height:15px;border-radius:50%;background:var(--color-green);border:2px solid var(--color-bg-secondary)"></span>' +
        '</button>' +
        '<div style="font-size:12px;font-weight:600;color:var(--color-text-secondary)">Foto del producto — toca la cámara para verla</div>' +
      '</div>' +
      '<div id="foto-orden-preview-update" style="display:none;margin-bottom:18px">' +
        '<img id="foto-orden-preview-img-update" alt="Foto del producto" ' +
             'onerror="fotoUpdateNoCargo()" ' +
             'style="width:100%;max-height:320px;object-fit:contain;border-radius:var(--radius-md);display:block;background:var(--color-bg-tertiary)" />' +
        '<div id="foto-orden-preview-error-update" style="display:none;font-size:12px;color:var(--color-text-secondary);padding:10px 12px;background:var(--color-bg-tertiary);border-radius:var(--radius-md)">' +
          '<i class="ti ti-photo-off"></i> No se pudo cargar la foto' +
        '</div>' +
      '</div>';
  }

  overlay.innerHTML =
    '<div style="background:var(--color-bg-primary);border-radius:var(--radius-lg);padding:24px;width:480px;max-width:95vw;box-shadow:0 8px 32px rgba(0,0,0,0.18);margin:auto">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">' +
        '<span style="font-size:15px;font-weight:500">Actualizar orden #' + orden.codigo + '</span>' +
        '<button onclick="cerrarActualizarEstadoOrden()" style="background:none;border:none;cursor:pointer;font-size:18px;color:var(--color-text-secondary)"><i class="ti ti-x"></i></button>' +
      '</div>' +
      seccionFotoProducto +
      seccionFotosEntrega +
      '<div style="display:flex;flex-direction:column;gap:14px">' +

        '<div>' +
          '<label style="font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:4px">Tienda cliente</label>' +
          '<input id="f-orden-tienda-update" class="search-box" style="width:100%" placeholder="Escribe para buscar tienda..." value="' + (orden.tienda||'').replace(/"/g,'&quot;') + '" />' +
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
          '<label style="font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:4px">' +
            'Medio de pago <span style="font-weight:400;color:var(--color-text-tertiary)">(cómo se recibió la plata — distinto del "Método de pago" de arriba)</span>' +
          '</label>' +
          '<select id="f-orden-medio-pago-update" class="filter-select" style="width:100%" onchange="onMedioPagoChangeUpdate()">' +
            '<option value="">Sin definir</option>' +
            _MEDIOS_PAGO.map(function(mp){
              return '<option value="' + mp.value + '"' + (mp.value===orden.medio_pago?' selected':'') + '>' + mp.label + '</option>';
            }).join('') +
          '</select>' +
          '<div id="f-orden-evidencia-wrap-update" style="display:none;margin-top:8px;background:var(--color-amber-bg);border-radius:var(--radius-md);padding:10px 12px">' +
            '<div style="font-size:12px;color:var(--color-amber-text);font-weight:600;margin-bottom:6px">' +
              '<i class="ti ti-camera"></i> Este medio de pago requiere evidencia (foto)' +
            '</div>' +
            '<input id="f-orden-evidencia-update" type="file" accept="image/jpeg,image/png,image/webp" onchange="onSeleccionarEvidenciaUpdate(this)" style="font-size:12px" />' +
            '<div id="f-orden-evidencia-status-update" style="font-size:11px;color:var(--color-text-secondary);margin-top:6px"></div>' +
          '</div>' +
        '</div>' +

        '<div id="bloque-condicion-especial-update">' +
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

        /* Solo para motorizado, y solo si la orden ya tiene una condición
           especial (Cambio/Recojo/Escoge talla) — ver confirmarRecibidoCondicionEspecial() */
        '<div id="bloque-recibido-update" style="display:none;background:var(--color-amber-bg);border-radius:var(--radius-md);padding:12px 14px">' +
          '<div style="font-size:13px;font-weight:600;color:var(--color-amber-text);margin-bottom:4px">' +
            '<i class="ti ti-package-import"></i> Esta orden tiene una condición especial' +
          '</div>' +
          '<div style="font-size:11px;color:var(--color-text-secondary);margin-bottom:10px">' +
            'Antes de guardar, confirma que ya recibiste el producto de vuelta del cliente.' +
          '</div>' +
          '<button type="button" id="btn-recibido-update" class="btn btn-primary btn-sm" onclick="confirmarRecibidoCondicionEspecial()">' +
            '<i class="ti ti-check"></i> Recibido' +
          '</button>' +
          '<div id="f-orden-recibido-status-update" style="font-size:12px;color:var(--color-green-text);margin-top:8px;display:none">' +
            '<i class="ti ti-circle-check"></i> Confirmado' +
          '</div>' +
        '</div>' +

        '<div id="bloque-prepago-update">' +
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
            '<label style="font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:4px">Por cobrar</label>' +
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
          '<label style="font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:4px">Motorizado asignado <span style="font-weight:400;color:var(--color-text-tertiary)">(opcional)</span></label>' +
          '<input id="f-orden-motorizado-update" class="search-box" style="width:100%" placeholder="Escribe para buscar motorizado..." value="' + (orden.motorizado||'').replace(/"/g,'&quot;') + '" />' +
        '</div>' +

        /* Día de reparto: el que manda en Pedidos, Motorizados y la Caja.
           Con motorizado, el que ya tiene; sin motorizado, hoy (es el
           día que tomaría al asignarla). Solo gestores (ver más abajo). */
        '<div id="bloque-fecha-reparto-update">' +
          '<label style="font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:4px">Fecha de reparto <span style="font-weight:400;color:var(--color-text-tertiary)">(creada el ' + _fechaDisplayM(orden.fecha) + ')</span></label>' +
          '<input id="f-orden-fecha-reparto-update" type="date" class="search-box" style="width:100%" min="' + orden.fecha + '" value="' + (orden.motorizado ? (orden.fecha_reparto || orden.fecha) : _hoy()) + '" />' +
        '</div>' +

        '<div>' +
          '<label style="font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:4px">Observaciones</label>' +
          '<input id="f-orden-obs-update" class="search-box" style="width:100%" maxlength="300" value="' + (orden.observaciones||'') + '" />' +
        '</div>' +

        '<div id="orden-estado-error" style="display:none;color:#A32D2D;font-size:12px;padding:8px 12px;background:#FCEBEB;border-radius:var(--radius-md)"></div>' +

        /* Conflicto de edición simultánea — ver _patchOrdenConVersion()
           y guardarActualizarEstadoOrden(). Nada de lo que estaba en
           este formulario se llegó a guardar cuando esto aparece. */
        '<div id="orden-conflicto-update" style="display:none;background:var(--color-amber-bg);border-radius:var(--radius-md);padding:12px 14px">' +
          '<div style="font-size:13px;font-weight:600;color:var(--color-amber-text);margin-bottom:6px">' +
            '<i class="ti ti-alert-triangle"></i> Esta orden cambió mientras la editabas' +
          '</div>' +
          '<div style="font-size:11px;color:var(--color-text-secondary);margin-bottom:10px">' +
            'Otro usuario guardó cambios en esta misma orden hace un momento. Para no pisar lo suyo, nada de lo que escribiste acá se guardó todavía.' +
          '</div>' +
          '<button type="button" class="btn btn-primary btn-sm" onclick="recargarOrdenPorConflicto()">' +
            '<i class="ti ti-refresh"></i> Ver los datos actuales' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px">' +
        '<button class="btn btn-sm" onclick="cerrarActualizarEstadoOrden()">Cancelar</button>' +
        '<button class="btn btn-primary btn-sm" id="btn-guardar-orden-update" onclick="guardarActualizarEstadoOrden()"><i class="ti ti-check"></i> Guardar</button>' +
      '</div>' +
    '</div>';

  /* El modal se reconstruye entero cada vez que se abre, así que los
     comboboxes se inician de nuevo en cada apertura (ver js/combobox.js) */
  _distritosCatalogoUpdate = distritos;

  /* Solo tiendas activas, más la que la orden ya tiene aunque se haya
     desactivado (así una orden vieja se puede seguir guardando; el
     servidor solo rechaza pasarla a otra tienda inactiva) */
  initComboBuscable('f-orden-tienda-update', function() {
    return tiendas.filter(function(t) { return t.activa || t.nombre === orden.tienda; })
      .map(function(t) { return { value: t.nombre, label: t.nombre + (t.activa ? '' : ' (inactiva)') }; });
  });

  initComboBuscable('f-orden-motorizado-update', function() {
    return motorizados.filter(function(m){ return m.activo; }).map(function(m) {
      return { value: m.nombre, label: m.nombre + (m.zona ? ' — ' + m.zona : '') };
    });
  });

  initComboBuscable('f-orden-distrito-update', function() {
    /* Solo distritos activos: el comodín "SIN DEFINIR" del flujo rápido
       no debe poder elegirse a mano */
    return distritos.filter(function(d){ return d.activo; })
      .map(function(d) { return { value: d.distrito, label: d.distrito }; });
  }, function(valor) { onDistritoChangeUpdate(valor); });

  /* Recalcula de una por si el valor guardado había quedado desactualizado,
     y bloquea "Cobrado" si el método ya venía en "Sin cobro" */
  onMetodoPagoChangeUpdate();

  /* Evidencia: se resetea en cada apertura del modal — si la orden ya
     tenía una foto subida de antes, se avisa pero no hace falta volver
     a tomarla (ver PATCH /medio-pago en el servidor) */
  _medioPagoEvidenciaBlob = null;
  _medioPagoEvidenciaEnCola = false;
  _medioPagoTeniaEvidenciaPrevia = !!orden.evidencia_url;
  onMedioPagoChangeUpdate();
  var statusEvidencia = document.getElementById('f-orden-evidencia-status-update');
  if (statusEvidencia && orden.evidencia_url) {
    statusEvidencia.innerHTML = '<i class="ti ti-circle-check" style="color:var(--color-green)"></i> Ya tiene evidencia subida — ' +
      '<a href="' + orden.evidencia_url + '" target="_blank" rel="noopener">ver foto</a>. Elige otro archivo solo si quieres reemplazarla.';
  } else if (statusEvidencia && orden.evidencia_pendiente) {
    /* Se guardó el medio de pago pero la foto todavía no llegó al
       servidor (sigue en la cola de algún teléfono) */
    statusEvidencia.innerHTML = '<i class="ti ti-clock" style="color:var(--color-amber)"></i> Evidencia pendiente de subir.';
  }
  _revisarEvidenciaEnCola(orden.id);

  /* Un motorizado ve estos campos, pero no los puede tocar — quedan
     en gris. La protección REAL está en el servidor (/completo y
     /estado ignoran estos valores si vienen de un motorizado, y
     /asignar directamente no se llama — ver guardarActualizarEstadoOrden);
     esto es solo para que no puedan ni intentarlo desde la pantalla. */
  _ordenActualizarRecibidoRequerido  = false;
  _ordenActualizarRecibidoConfirmado = false;

  if (_esSesionMotorizado()) {
    ['f-orden-metodo-update', 'f-orden-cobrado-update', 'f-orden-adicional-update',
     'f-orden-pagomotoad-update', 'f-orden-motorizado-update',
     'f-orden-delivery-update', 'f-orden-pagomoto-update',
     'f-orden-tiene-condicion-update', 'f-orden-condicion-update'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.disabled = true;
    });

    /* No debe ver "Pago del delivery en oficina" — se oculta entero,
       no solo se bloquea (a diferencia de los campos de arriba) */
    var bloquePrepago = document.getElementById('bloque-prepago-update');
    if (bloquePrepago) bloquePrepago.style.display = 'none';
    var bloqueFechaReparto = document.getElementById('bloque-fecha-reparto-update');
    if (bloqueFechaReparto) bloqueFechaReparto.style.display = 'none';

    /* Si la orden ya tiene una condición especial, no puede guardar
       nada de esta orden sin antes confirmar "Recibido". Si ya tomó la
       foto del cambio en su vista de entregas (js/entregas-moto.js),
       esa foto es la constancia y no hace falta. */
    var tieneFotoCambio = fotosOrden.some(function(f) { return f.tipo === 'foto_cambio'; });
    if (orden.condicionEspecial && !tieneFotoCambio) {
      _ordenActualizarRecibidoRequerido = true;
      var bloqueRecibido = document.getElementById('bloque-recibido-update');
      if (bloqueRecibido) bloqueRecibido.style.display = 'block';
      var btnGuardar = document.getElementById('btn-guardar-orden-update');
      if (btnGuardar) btnGuardar.disabled = true;
    }
  }
}

/* El motorizado confirma que ya tiene en mano el producto que el
   cliente le devolvió/entregó (condición especial: Cambio/Recojo/
   Escoge talla) — recién ahí se habilita "Guardar". Es un chequeo
   de esta sesión del modal, se vuelve a pedir cada vez que se abre. */
window.confirmarRecibidoCondicionEspecial = function() {
  _ordenActualizarRecibidoConfirmado = true;

  var btn = document.getElementById('btn-recibido-update');
  if (btn) { btn.disabled = true; btn.style.display = 'none'; }
  var status = document.getElementById('f-orden-recibido-status-update');
  if (status) status.style.display = 'block';

  var btnGuardar = document.getElementById('btn-guardar-orden-update');
  if (btnGuardar) btnGuardar.disabled = false;
};

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

/* Muestra el bloque de "adjuntar evidencia" solo cuando el medio de
   pago elegido la exige (pago-tienda / pago-empresa — ver _MEDIOS_PAGO) */
window.onMedioPagoChangeUpdate = function() {
  var sel  = document.getElementById('f-orden-medio-pago-update');
  var wrap = document.getElementById('f-orden-evidencia-wrap-update');
  if (!sel || !wrap) return;
  var medio = _MEDIOS_PAGO.find(function(m) { return m.value === sel.value; });
  wrap.style.display = (medio && medio.evidencia) ? 'block' : 'none';
};

/* Comprime la foto en el navegador antes de subirla (ver DECISIONES.md
   D-003: ~1280px de ancho, calidad 0.7 — sin esto, cualquier proveedor
   de almacenamiento sale caro con el volumen de fotos del negocio). */
function _comprimirImagenEvidencia(file) {
  /* La compresión vive en js/utils.js (comprimirImagenJPEG), compartida
     con la foto del producto de js/pedidos.js */
  return comprimirImagenJPEG(file, 1280, 0.7);
}

/* Al elegir un archivo: solo comprime y lo deja en memoria. No usa la
   red: la subida la hace la cola de fotos recién cuando la orden se
   guardó bien (ver guardarActualizarEstadoOrden), así funciona aunque
   en este momento no haya señal. */
window.onSeleccionarEvidenciaUpdate = async function(inputEl) {
  var statusEl = document.getElementById('f-orden-evidencia-status-update');
  var file = inputEl.files && inputEl.files[0];
  if (!file || !_ordenActualizarId) return;

  _medioPagoEvidenciaBlob = null;
  if (statusEl) statusEl.innerHTML = '<i class="ti ti-loader"></i> Procesando la foto...';

  try {
    _medioPagoEvidenciaBlob = await _comprimirImagenEvidencia(file);
    if (statusEl) statusEl.innerHTML = '<i class="ti ti-circle-check" style="color:var(--color-green)"></i> Foto lista — se sube en segundo plano al guardar';
  } catch (err) {
    if (statusEl) statusEl.innerHTML = '<span style="color:#A32D2D">' + (err.message || 'No se pudo procesar la foto') + '</span>';
    inputEl.value = '';
  }
};

/* ¿Ya hay una evidencia de esta orden en la cola de ESTE teléfono? Si
   la hay, no se vuelve a pedir la foto para guardar y se avisa. */
async function _revisarEvidenciaEnCola(ordenId) {
  if (typeof obtenerColaFotos !== 'function') return;
  try {
    var cola = await obtenerColaFotos();
    var enCola = cola.some(function(it) {
      return it.ordenId === parseInt(ordenId, 10) && it.tipo === 'evidencia_medio_pago' && it.estado === 'pendiente';
    });
    /* El modal pudo cerrarse o cambiar de orden mientras se leía la cola */
    if (!enCola || _ordenActualizarId != ordenId) return;

    _medioPagoEvidenciaEnCola = true;
    var statusEl = document.getElementById('f-orden-evidencia-status-update');
    if (statusEl && !_medioPagoTeniaEvidenciaPrevia && !_medioPagoEvidenciaBlob) {
      statusEl.innerHTML = '<i class="ti ti-cloud-upload" style="color:var(--color-amber)"></i> La evidencia está en la cola de este teléfono: se sube sola cuando haya señal.';
    }
  } catch (err) {
    console.error('Evidencia en cola:', err);
  }
}

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

/* ── Fotos de la orden en "Actualizar orden" ──
   Vienen de GET /ordenes/:id (orden.fotos, ya filtradas por rol). Cada
   foto es un botón; la imagen se pide recién al tocarlo, para no gastar
   datos al abrir el modal. Cada bloque (data-fotos-seccion) tiene su
   propia vista previa (ver verFotoEnSeccion). */
var _MAX_FOTOS_DEVOLUCION = 5;

function _escFoto(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/* Botón de una foto: cámara + etiqueta, y la fecha en el title */
function _botonFotoOrden(f, etiqueta, titulo) {
  var cuando = f.subido_en ? f.subido_en.slice(8, 10) + '/' + f.subido_en.slice(5, 7) + ' ' + f.subido_en.slice(11, 16) : '';
  return '<button type="button" class="btn btn-sm" data-src="' + _escFoto(f.url) + '" onclick="verFotoEnSeccion(this)" ' +
           'title="' + _escFoto(titulo + (cuando ? ' — ' + cuando : '')) + '" ' +
           'style="padding:4px 8px;font-size:12px;background:var(--color-bg-primary)">' +
           '<i class="ti ti-camera"></i> ' + _escFoto(etiqueta) +
         '</button>';
}

/* Vista previa compartida por las fotos de un bloque */
function _vistaPreviaFotosHTML() {
  return '<div class="fotos-preview" style="display:none;margin-top:8px">' +
      '<img alt="Foto" onerror="fotoEnSeccionNoCargo(this)" ' +
           'style="width:100%;max-height:280px;object-fit:contain;border-radius:var(--radius-md);display:block;background:var(--color-bg-tertiary)" />' +
      '<div class="fotos-preview-error" style="display:none;font-size:12px;color:var(--color-text-secondary);padding:10px 12px;background:var(--color-bg-tertiary);border-radius:var(--radius-md)">' +
        '<i class="ti ti-photo-off"></i> No se pudo cargar la foto' +
      '</div>' +
    '</div>';
}

/* Devolución: una por cada vez que el producto volvió a la oficina
   (hasta MAX_FOTOS_DEVOLUCION en el servidor) y la de la entrega a la
   tienda. Va en la zona amarilla / verde de la devolución. */
function _fotosDevolucionHTML(fotos) {
  if (!Array.isArray(fotos) || !fotos.length) return '';

  var vueltas = 0;
  var botones = fotos.map(function(f) {
    var esTienda = f.tipo === 'foto_devolucion_tienda';
    var etiqueta = esTienda ? 'Tienda' : String(++vueltas);
    return _botonFotoOrden(f, etiqueta, esTienda ? 'Foto de la entrega a la tienda' : 'Foto de la devolución ' + etiqueta);
  }).join('');

  return '<div data-fotos-seccion style="flex:1;min-width:160px">' +
      '<div style="font-size:11px;color:var(--color-text-secondary);margin-bottom:4px">' +
        'Fotos de devolución (' + vueltas + '/' + _MAX_FOTOS_DEVOLUCION + ')' +
      '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap">' + botones + '</div>' +
      _vistaPreviaFotosHTML() +
    '</div>';
}

/* Las que toma el motorizado al cerrar la orden (js/entregas-moto.js),
   cada una en su lugar, más el motivo del último intento fallido */
var _GRUPOS_FOTOS_ENTREGA = [
  { tipo: 'foto_entrega',         label: 'Entrega' },
  { tipo: 'foto_cambio',          label: 'Cambio' },
  { tipo: 'evidencia_medio_pago', label: 'Pago' },
  { tipo: 'foto_reprogramado',    label: 'Reprogramado' },
  { tipo: 'foto_ausente',         label: 'Ausente' },
  { tipo: 'foto_cancelado',       label: 'Cancelado' },
  { tipo: 'foto_no_entregado',    label: 'No entregado' },
];

function _seccionFotosEntregaHTML(fotos, motivo) {
  var grupos = _GRUPOS_FOTOS_ENTREGA.map(function(g) {
    var deEste = fotos.filter(function(f) { return f.tipo === g.tipo; });
    if (!deEste.length) return '';
    return '<div class="fotos-orden-grupo">' +
        '<span class="fotos-orden-grupo-label">' + g.label + '</span>' +
        deEste.map(function(f, i) {
          return _botonFotoOrden(f, deEste.length > 1 ? String(i + 1) : 'Ver', 'Foto: ' + g.label.toLowerCase());
        }).join('') +
      '</div>';
  }).join('');
  if (!grupos && !motivo) return '';

  return '<div data-fotos-seccion style="background:var(--color-bg-secondary);border-radius:var(--radius-md);padding:10px 12px;margin-bottom:12px;display:flex;flex-direction:column;gap:6px">' +
      '<div style="font-size:12px;font-weight:600;color:var(--color-text-secondary)">Fotos del motorizado</div>' +
      grupos +
      (motivo ? '<div style="font-size:12px;color:var(--color-text-secondary)">Motivo del último intento: <strong style="color:var(--color-text-primary)">' + _escFoto(motivo) + '</strong></div>' : '') +
      _vistaPreviaFotosHTML() +
    '</div>';
}

/* Tocar la misma foto la cierra; tocar otra la cambia */
window.verFotoEnSeccion = function(btn) {
  var seccion = btn.closest('[data-fotos-seccion]');
  var cont = seccion && seccion.querySelector('.fotos-preview');
  var img  = cont && cont.querySelector('img');
  var err  = cont && cont.querySelector('.fotos-preview-error');
  if (!cont || !img) return;
  var src = btn.getAttribute('data-src');

  if (cont.style.display === 'block' && img.getAttribute('src') === src) {
    cont.style.display = 'none';
    return;
  }
  img.style.display = 'block';
  if (err) err.style.display = 'none';
  if (img.getAttribute('src') !== src) img.src = src;
  cont.style.display = 'block';
};

window.fotoEnSeccionNoCargo = function(img) {
  var err = img.parentNode.querySelector('.fotos-preview-error');
  img.style.display = 'none';
  if (err) err.style.display = 'block';
};

/* Foto tomada para una devolución que no se pudo confirmar (sin señal,
   error del servidor): se guarda para que el reintento no obligue a
   sacarla de nuevo. Solo una, de la última orden que falló. */
var _fotoDevolucionSinConfirmar = null; /* { ordenId, blob } */

/* ── Confirmar que el motorizado devolvió el producto — acción aparte,
   separada del botón "Guardar" porque dispara un cambio importante
   (cambia el estado, o crea una orden nueva) ──
   Primero pide la foto de la devolución (js/camara-foto.js); con la
   foto aceptada recién manda PATCH /devolver, y si salió bien la foto
   entra a la cola (js/cola-fotos.js), que la sube en segundo plano: el
   usuario no espera la subida. Con MAX_FOTOS_DEVOLUCION fotos ya
   registradas no se pide otra y se confirma sin foto. */
/**
 * @param {number} [ordenId] - Si no se pasa, usa la orden abierta en el modal.
 * @param {HTMLElement} [btnEl] - Botón que disparó la acción, se desactiva
 *        mientras se procesa para evitar un doble click accidental. Trae
 *        data-codigo y data-fotos-devolucion (fotos ya registradas).
 */
window.confirmarDevolucionOrden = async function(ordenId, btnEl) {
  ordenId = ordenId || _ordenActualizarId;
  if (!ordenId) return;

  var codigo = (btnEl && btnEl.getAttribute('data-codigo')) || '';
  var fotosPrevias = parseInt(btnEl && btnEl.getAttribute('data-fotos-devolucion'), 10) || 0;

  var foto = null;
  if (fotosPrevias >= _MAX_FOTOS_DEVOLUCION) {
    if (!confirm('Esta orden ya tiene ' + _MAX_FOTOS_DEVOLUCION + ' fotos de devolución: se confirma sin foto.\n\n' +
                 '¿Confirmar que el motorizado devolvió el producto' + (codigo ? ' de #' + codigo : '') + ' a la oficina?')) return;
  } else if (_fotoDevolucionSinConfirmar && _fotoDevolucionSinConfirmar.ordenId == ordenId) {
    foto = _fotoDevolucionSinConfirmar.blob;
  } else {
    foto = await pedirFoto({
      titulo:  'Foto de la devolución' + (codigo ? ' — #' + codigo : ''),
      textoOk: 'Usar foto y confirmar',
    });
    if (!foto) return;
  }

  if (btnEl) { btnEl.disabled = true; }
  var errEl = document.getElementById('orden-estado-error');

  try {
    var r = await fetch(API + '/ordenes/' + ordenId + '/devolver', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
    });
    var data = await r.json().catch(function(){ return {}; });
    if (!r.ok) throw new Error(data.error || 'No se pudo procesar la devolución');

    /* La devolución ya quedó: la foto va a la cola y sube sola */
    _fotoDevolucionSinConfirmar = null;
    if (foto) {
      try {
        await encolarFoto(ordenId, 'foto_devolucion', foto, codigo);
      } catch (errCola) {
        console.error('Cola de fotos (devolución):', errCola);
        if (typeof showNotif === 'function') showNotif('La devolución quedó confirmada, pero no se pudo guardar la foto en este dispositivo.', 5000);
      }
    }

    if (_ordenActualizarId == ordenId) cerrarActualizarEstadoOrden();
    if (typeof showNotif === 'function') {
      showNotif(data.duplicada
        ? 'Producto devuelto — se creó la orden #' + data.nuevoCodigo + ' para reintentar'
        : data.almacen
        ? 'Producto devuelto — queda en almacén, pendiente de devolver a la tienda'
        : data.aAsignacion
        ? 'Producto devuelto — la orden volvió a Asignación, sin motorizado'
        : 'Producto devuelto — la orden volvió a "En proceso"');
    }

    if (typeof _renderTablaResumen === 'function') _renderTablaResumen();
    if (typeof _motoDetalleAbiertoId !== 'undefined' && _motoDetalleAbiertoId) abrirDetalleMotoHistorial(_motoDetalleAbiertoId);
    if (typeof renderPedidos === 'function') renderPedidos();
    if (typeof _recargarTablaPendienteDevolucion === 'function') _recargarTablaPendienteDevolucion();
    if (typeof _recargarTablaDevolucionTienda === 'function') _recargarTablaDevolucionTienda();
    if (typeof _refrescarCajaActual === 'function') _refrescarCajaActual();
  } catch (err) {
    if (foto) _fotoDevolucionSinConfirmar = { ordenId: ordenId, blob: foto };
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

/* Ícono de cámara de "Actualizar orden": reusa la vista previa del
   modal de nueva orden (_toggleVistaPreviaFoto, en js/pedidos.js) */
window.toggleVistaPreviaFotoUpdate = function(btn) {
  _toggleVistaPreviaFoto('foto-orden-preview-update', 'foto-orden-preview-img-update', btn.getAttribute('data-src'));
};

/* La foto no cargó (no está en el servidor, o el rol no puede verla):
   se esconde la imagen rota y se avisa en su lugar */
window.fotoUpdateNoCargo = function() {
  var img = document.getElementById('foto-orden-preview-img-update');
  var err = document.getElementById('foto-orden-preview-error-update');
  if (img) img.style.display = 'none';
  if (err) err.style.display = 'block';
};

window.cerrarActualizarEstadoOrden = function() {
  var overlay = document.getElementById('orden-estado-modal-overlay');
  if (overlay) overlay.style.display = 'none';
  _ordenActualizarId = null;
};

/* PATCH con control de versión (ver server/routes/ordenes.js). Manda
   siempre _ordenActualizarVersion, y si el guardado sale bien, la
   actualiza con la que devuelve el servidor — así el siguiente PATCH
   de esta misma sesión de guardado encadena sobre la versión recién
   escrita (que es propia, no un conflicto real).
   Si el servidor responde 409 (alguien más guardó primero), tira un
   error con `conflicto: true` y la orden fresca adjunta, para que
   guardarActualizarEstadoOrden() lo muestre en vez de un error genérico. */
async function _patchOrdenConVersion(url, body) {
  var cuerpo = Object.assign({}, body, { ifVersion: _ordenActualizarVersion });
  var r = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  var data = await r.json().catch(function() { return {}; });

  if (r.status === 409) {
    var errConflicto = new Error(data.error || 'Esta orden fue modificada por otro usuario mientras la editabas.');
    errConflicto.conflicto = true;
    throw errConflicto;
  }
  if (!r.ok) throw new Error(data.error || 'No se pudo guardar el cambio.');

  if (data.version) _ordenActualizarVersion = data.version;
  return data;
}

/* Botón "Ver los datos actuales" del aviso de conflicto — recarga la
   orden entera desde cero (descarta el borrador que había en el
   formulario, a propósito: es lo que el usuario elige al apretarlo). */
window.recargarOrdenPorConflicto = function() {
  if (_ordenActualizarId) abrirActualizarEstadoOrden(_ordenActualizarId);
};

window.guardarActualizarEstadoOrden = async function() {
  var tienda      = document.getElementById('f-orden-tienda-update').value;
  var dest        = document.getElementById('f-orden-dest-update').value.trim();
  var distrito    = document.getElementById('f-orden-distrito-update').value;
  var motorizado  = document.getElementById('f-orden-motorizado-update').value;
  var fechaReparto = document.getElementById('f-orden-fecha-reparto-update').value;
  var direccion   = document.getElementById('f-orden-direccion-update').value.trim();
  var telefono    = document.getElementById('f-orden-telefono-update').value.trim();
  var telefono2   = document.getElementById('f-orden-telefono2-update').value.trim();
  var estado      = document.getElementById('f-orden-estado-update').value;
  var tieneCondicion    = document.getElementById('f-orden-tiene-condicion-update').checked;
  var condicionEspecial = tieneCondicion ? document.getElementById('f-orden-condicion-update').value : '';
  var prepagado   = document.getElementById('f-orden-prepagado-update').checked ? 'pre-pagado' : 'post-pago';
  var prepagadoMetodo = prepagado === 'pre-pagado' ? document.getElementById('f-orden-prepagado-metodo-update').value : '';
  var metodoPago  = document.getElementById('f-orden-metodo-update').value;
  var medioPago   = document.getElementById('f-orden-medio-pago-update').value;
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

  var medioRequiereEvidencia = _MEDIOS_PAGO.some(function(m) { return m.value === medioPago && m.evidencia; });
  /* Basta con que la foto esté TOMADA (en memoria, ya subida o en la cola
     de este teléfono): no hace falta que haya subido para poder guardar */
  if (medioRequiereEvidencia && !_medioPagoEvidenciaBlob && !_medioPagoTeniaEvidenciaPrevia && !_medioPagoEvidenciaEnCola) {
    errEl.textContent = 'Este medio de pago requiere adjuntar una foto de evidencia antes de guardar.';
    errEl.style.display = 'block';
    return;
  }

  if (_ordenActualizarRecibidoRequerido && !_ordenActualizarRecibidoConfirmado) {
    errEl.textContent = 'Confirma "Recibido" antes de guardar esta orden.';
    errEl.style.display = 'block';
    return;
  }

  try {
    /* /asignar va PRIMERO: si rechaza la fecha de reparto (fuera de
       rango, o un día ya pagado en la Caja) no se guarda nada a medias.
       Un motorizado no puede reasignar (el campo queda bloqueado en
       pantalla) — directamente no se manda este PATCH: el servidor
       igual lo rechazaría (una orden que ya tiene motorizado no se
       puede "autoasignar" de nuevo), así evitamos ese error confuso. */
    if (!_esSesionMotorizado()) {
      var cuerpoAsignar = { motorizado: motorizado || null };
      if (motorizado && fechaReparto) cuerpoAsignar.fechaReparto = fechaReparto;
      await _patchOrdenConVersion(API + '/ordenes/' + _ordenActualizarId + '/asignar', cuerpoAsignar);
    }

    await _patchOrdenConVersion(API + '/ordenes/' + _ordenActualizarId + '/completo', {
      tienda: tienda, dest: dest, distrito: distrito, direccion: direccion,
      telefDest: telefono, telefDest2: telefono2,
      delivery: delivery, montoAdicional: adicional, montoCobrado: cobrado, montoProducto: producto,
      pagoMotoBase: pagoMoto, pagoMotoAdic: pagoMotoAd,
      pagoVelox: prepagado, pagoVeloxMetodo: prepagadoMetodo,
      obs: obs,
    });

    await _patchOrdenConVersion(API + '/ordenes/' + _ordenActualizarId + '/estado', {
      estado: estado, metodoPago: metodoPago, condicionEspecial: condicionEspecial,
    });

    await _patchOrdenConVersion(API + '/ordenes/' + _ordenActualizarId + '/medio-pago', {
      medioPago: medioPago || null,
    });

    /* Recién con la orden guardada, la evidencia pasa a la cola: así no
       queda subida una foto de un medio de pago que no se guardó. La
       cola la guarda en el teléfono y la sube con reintentos. */
    var avisoEvidencia = '';
    if (_medioPagoEvidenciaBlob) {
      try {
        var enCola = await encolarFoto(_ordenActualizarId, 'evidencia_medio_pago', _medioPagoEvidenciaBlob, _ordenActualizarCodigo);
        _medioPagoEvidenciaBlob = null;
        avisoEvidencia = enCola.persistente
          ? ' · la evidencia se sube en segundo plano'
          : ' · la evidencia no se pudo guardar en el teléfono: no cierres Velox hasta que suba';
      } catch (errFoto) {
        avisoEvidencia = ' · la orden se guardó, pero la evidencia no: ' + (errFoto.message || 'error al procesarla');
      }
    }

    cerrarActualizarEstadoOrden();
    if (typeof showNotif === 'function') showNotif('Orden actualizada correctamente' + avisoEvidencia, avisoEvidencia ? 5000 : 2500);

    /* Refrescar la vista actual, sea cual sea la página donde se abrió el modal.
       Cada función ya se cuida sola si su página no está en pantalla. */
    if (typeof _renderTablaResumen === 'function') _renderTablaResumen();
    if (typeof _motoDetalleAbiertoId !== 'undefined' && _motoDetalleAbiertoId) abrirDetalleMotoHistorial(_motoDetalleAbiertoId);
    if (typeof renderPedidos === 'function') renderPedidos();
    if (typeof _recargarTablaPendienteDevolucion === 'function') _recargarTablaPendienteDevolucion();
    if (typeof _recargarTablaDevolucionTienda === 'function') _recargarTablaDevolucionTienda();
    if (typeof _refrescarCajaActual === 'function') _refrescarCajaActual();

  } catch (err) {
    /* Conflicto de edición simultánea: NINGUNO de los PATCH de arriba
       que todavía no corrieron se manda (el que falló cortó la cadena
       con el throw) — nada se guarda a medias. Se avisa en vez de
       pisar lo que el otro usuario ya guardó. */
    if (err.conflicto) {
      var banner = document.getElementById('orden-conflicto-update');
      if (banner) banner.style.display = 'block';
      if (errEl) errEl.style.display = 'none';
      return;
    }
    /* fetch tira TypeError cuando no hay red: el mensaje del navegador
       ("Failed to fetch") no le dice nada a alguien en la calle */
    var mensaje = (err instanceof TypeError)
      ? 'Sin conexión: no se pudo guardar. Lo que cargaste (y la foto) sigue acá; vuelve a guardar cuando haya señal.'
      : (err.message || 'Error al actualizar la orden.');
    if (errEl) { errEl.textContent = mensaje; errEl.style.display = 'block'; }
  }
};
