/* ============================================================
   clientes.js — Conectado a la API REST
   ============================================================ */
var API = '/api';
var TIENDAS_REGISTRO = [];
var _filtroDesdeClientes = '';
var _filtroHastaClientes = '';
var _filtroTiendaClientes = '';

/* Escapa texto para meterlo en HTML */
function _escCli(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* La sesión es de una tienda (solo pantalla: el alcance lo pone el servidor) */
function _sesionEsTiendaCli() {
  try { return (JSON.parse(localStorage.getItem('velox_usuario')) || {}).rol === 'tienda'; }
  catch (e) { return false; }
}

/* ── Filtro de período dentro del detalle de una tienda (agrupado) ── */
var _filtroDesdeDetalle    = '';
var _filtroHastaDetalle    = '';
var _tipoFiltroDetalle     = ''; /* '', 'semana', 'semana-pasada', 'mes', 'mes-pasado' */
var _tiendaIdDetalleActual = null;

function _fechaDisplayCli(yyyymmdd) {
  if (!yyyymmdd) return '—';
  var p = yyyymmdd.split('-');
  var meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return p[2] + ' ' + meses[parseInt(p[1])-1] + ' ' + p[0];
}

function _badgeEstadoTienda(est) {
  var map = { 'Al día':'entregado', 'Dev. pendiente':'ausente', 'Deuda':'no-entregado' };
  return '<span class="badge ' + (map[est]||'pendiente') + '">' + est + '</span>';
}

/* ════════════════════════════════════════════
   "ENVIADO" — igual que Gestión / Motorizado: vive en este navegador
   (localStorage). Va por tienda Y día del reporte: mandarle el del 18
   no marca el del 19. Se guardan los últimos 60 días.
════════════════════════════════════════════ */
var _CLI_WA_CLAVE = 'velox_wa_tiendas';

function _cliWaLeer() {
  var data = null;
  try { data = JSON.parse(localStorage.getItem(_CLI_WA_CLAVE)); } catch (e) { data = null; }
  return data && typeof data === 'object' ? data : {};
}

function _cliEnviado(idTienda, fecha) {
  return !!(fecha && _cliWaLeer()[idTienda + '|' + fecha]);
}

function _cliMarcarEnviado(idTienda, fecha) {
  var data = _cliWaLeer();
  data[idTienda + '|' + fecha] = _hoyCli();
  var d = new Date(); d.setDate(d.getDate() - 60);
  var limite = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  Object.keys(data).forEach(function(k) { if (k.split('|')[1] < limite) delete data[k]; });
  try { localStorage.setItem(_CLI_WA_CLAVE, JSON.stringify(data)); } catch (e) { /* solo afecta la marca */ }
}

/* dd/mm para los textos */
function _cliDiaMes(fecha) {
  var p = String(fecha || '').split('-');
  return p.length === 3 ? p[2] + '/' + p[1] : fecha;
}

function _cliCheckEnviadoHTML(idTienda, fecha) {
  return _cliEnviado(idTienda, fecha)
    ? ' <i class="ti ti-circle-check wa-enviado-check" title="Ya se le envió el reporte del ' + _escCli(_cliDiaMes(fecha)) + '" ' +
        'style="color:var(--color-green);font-size:14px;vertical-align:middle"></i>'
    : '';
}

/* Un solo día elegido en el filtro de la lista ('' con un período o "Ver todos") */
function _cliDiaUnico() {
  return _filtroDesdeClientes && _filtroDesdeClientes === _filtroHastaClientes ? _filtroDesdeClientes : '';
}

/* Botón de WhatsApp del reporte de un día de una tienda (lista y
   detalle). Sin un solo día, apagado: el reporte es de un día. La
   tienda no lo ve (lo decide quien lo llama). */
function _cliBotonWA(t, fecha, conTexto) {
  if (!t.telefono) return '<span style="color:var(--color-text-tertiary);font-size:12px">Sin teléfono</span>';
  if (!fecha) {
    return '<button class="btn btn-sm" disabled title="El reporte es de un día: filtrá un solo día" ' +
      'style="padding:4px 8px"><i class="ti ti-brand-whatsapp"></i>' + (conTexto ? ' Enviar reporte' : '') + '</button>';
  }
  return '<span class="cli-wa" data-tienda="' + Number(t.id) + '" data-fecha="' + _escCli(fecha) + '" style="white-space:nowrap">' +
    '<button class="btn btn-sm" onclick="enviarReporteTiendaWA(' + Number(t.id) + ',\'' + _escCli(fecha) + '\',this)" ' +
      'title="Mandarle por WhatsApp su reporte del ' + _escCli(_cliDiaMes(fecha)) + '" ' +
      'style="background:#25D366;color:#fff;border-color:#25D366;padding:4px 8px' + (conTexto ? ';font-weight:600' : '') + '">' +
      '<i class="ti ti-brand-whatsapp"></i>' + (conTexto ? ' Enviar reporte ' + _escCli(_cliDiaMes(fecha)) : '') + '</button>' +
    _cliCheckEnviadoHTML(t.id, fecha) +
  '</span>';
}

/* Repinta la marca de una tienda y día donde esté (lista y detalle) */
function _cliRepintarMarcas(idTienda, fecha) {
  document.querySelectorAll('.cli-wa[data-tienda="' + idTienda + '"][data-fecha="' + fecha + '"]').forEach(function(cont) {
    if (!cont.querySelector('.wa-enviado-check')) {
      cont.insertAdjacentHTML('beforeend', _cliCheckEnviadoHTML(idTienda, fecha));
    }
  });
}

/* ── Cargar tiendas desde API ── */
async function _cargarTiendas() {
  try {
    var r = await fetch(API + '/tiendas');
    TIENDAS_REGISTRO = await r.json();
    /* Sincronizar catálogo compartido con pedidos.js */
    if (typeof CATALOGO_TIENDAS !== 'undefined') {
      CATALOGO_TIENDAS.length = 0;
      TIENDAS_REGISTRO.filter(function(t){ return t.activa; }).forEach(function(t) {
        CATALOGO_TIENDAS.push({ id: t.id, nombre: t.nombre });
      });
    }
  } catch(err) { console.error('Error cargando tiendas:', err); }
}

/* Día de una orden para agrupar y filtrar: el de reparto (GET
   /tiendas/:id/ordenes ya filtra por ese día; o.fecha es la de creación) */
function _diaCli(o) {
  return o.fecha_reparto || o.fecha;
}

/* ── Plata de Clientes / Tiendas ──
   No se calcula nada acá: la plata de cada orden (o.caja) y de cada
   tienda (/tiendas/resumen) sale del motor de la Caja en el servidor
   (calcularOrdenCaja), lo mismo que Caja → Tienda, el reporte en imagen
   y el WhatsApp. El navegador solo suma (en céntimos) y pinta. */
function _cent(v) { return Math.round((parseFloat(v) || 0) * 100); }

function _totalesCajaCli(ords) {
  var c = { delivery: 0, retenido: 0, saldo: 0 };
  ords.forEach(function(o) {
    var k = o.caja || {};
    c.delivery += _cent(k.delivery); c.retenido += _cent(k.retenido); c.saldo += _cent(k.saldo);
  });
  return { delivery: c.delivery / 100, retenido: c.retenido / 100, saldo: c.saldo / 100 };
}

function _saldoTextoCli(saldo) {
  return saldo > 0 ? 'En resumen debe la tienda a Velox: S/ ' + saldo.toFixed(2)
    : saldo < 0 ? 'En resumen se le debe a la tienda: S/ ' + Math.abs(saldo).toFixed(2)
    : 'Saldo en cero';
}

function _saldoColorCli(saldo) {
  return saldo > 0 ? 'var(--color-green)' : saldo < 0 ? 'var(--color-red-text)' : 'var(--color-text-secondary)';
}

function _saldoHTMLCli(saldo) {
  return saldo > 0 ? '<span class="balance-pos">S/ ' + saldo.toFixed(2) + '</span>'
    : saldo < 0 ? '<span class="balance-neg">− S/ ' + Math.abs(saldo).toFixed(2) + '</span>'
    : '<span class="balance-zero">S/ 0.00</span>';
}

/* ── Render principal ── */
window.renderClientes = async function() {
  await _cargarTiendas();
  var desde = _filtroDesdeClientes;
  var hasta = _filtroHastaClientes;
  var hayFiltro = !!(desde && hasta);
  var lbl = document.getElementById('lbl-fecha-clientes');
  if (lbl) {
    lbl.textContent = !hayFiltro ? 'Mostrando: todos los días'
      : desde === hasta ? 'Mostrando: ' + _fechaDisplayCli(desde)
      : 'Mostrando: ' + _fechaDisplayCli(desde) + ' al ' + _fechaDisplayCli(hasta);
  }

  var tbody = document.getElementById('tbody-clientes');
  if (!tbody) return;
  var thWa = document.getElementById('th-wa-clientes');
  if (thWa) thWa.style.display = _sesionEsTiendaCli() ? 'none' : '';

  /* Detectar rol */
  var _sesionCli  = (function(){ var r=localStorage.getItem('velox_usuario'); if(!r) return null; try{return JSON.parse(r);}catch(e){return null;} })();
  var _esTienda   = _sesionCli && _sesionCli.rol === 'tienda';

  /* Lista de tiendas a mostrar. La tienda, la suya por id_tienda (no por
     el nombre del usuario, que puede ser distinto); el servidor ya le
     manda solo esa (GET /tiendas) */
  var _listaT = _esTienda
    ? TIENDAS_REGISTRO.filter(function(t){ return t.id == _sesionCli.id_tienda; })
    : TIENDAS_REGISTRO;

  /* Cargar resumen de todas las tiendas en UNA sola query */
  var resumenMap = {};
  try {
    var urlRes  = API + '/tiendas/resumen' + (hayFiltro ? '?desde=' + desde + '&hasta=' + hasta : '');
    var rRes    = await fetch(urlRes);
    var resData = await rRes.json();
    resData.forEach(function(d){ resumenMap[d.id_tienda] = d; });
  } catch(e) { console.error('Error resumen:', e); }

  var filas = _listaT.map(function(t) {
    var s = resumenMap[t.id];
    /* Si hay filtro de fecha y la tienda no tiene órdenes en ese rango, no mostrarla */
    if (hayFiltro && (!s || parseInt(s.total||0) === 0)) return null;
    var saldo       = s ? (parseFloat(s.saldo) || 0)     : 0;
    var pedidos     = s ? parseInt(s.total||0)          : 0;
    var entregados  = s ? parseInt(s.entregados||0)     : 0;
    var noEntregados= s ? parseInt(s.no_entregados||0)  : 0;
    var reprog      = s ? parseInt(s.reprogramados||0)  : 0;

    /* Saldo del período = motor de la Caja (> 0 nos debe, < 0 le debemos) */
    var saldoHTML = _saldoHTMLCli(saldo);
    var estadoCli = saldo > 0 ? 'Deuda' : saldo < 0 ? 'Dev. pendiente' : 'Al día';

    /* Teléfono + Yape */
    var telHTML = '';
    if (t.telefono) {
      var tel51 = '51' + t.telefono.replace(/[^0-9]/g,'');
      telHTML += '<a href="https://api.whatsapp.com/send?phone='+tel51+'" target="_blank" style="display:inline-flex;align-items:center;gap:4px;color:#25D366;text-decoration:none;font-weight:500"><i class="ti ti-brand-whatsapp"></i> '+t.telefono+'</a>';
    } else {
      telHTML += '<span style="color:var(--color-text-tertiary)">—</span>';
    }
    if (t.yape) telHTML += '<br><span style="font-size:11px;color:var(--color-text-secondary)"><i class="ti ti-currency-sol"></i> Yape: '+t.yape+'</span>';

    /* WhatsApp del reporte del día elegido (enviarReporteTiendaWA), con
       su marca de enviado. La tienda no manda resúmenes (a sí misma): ni
       la columna WA ni el link de su teléfono */
    if (_esTienda) {
      telHTML = t.telefono ? _escCli(t.telefono) : '<span style="color:var(--color-text-tertiary)">—</span>';
      if (t.yape) telHTML += '<br><span style="font-size:11px;color:var(--color-text-secondary)"><i class="ti ti-currency-sol"></i> Yape: ' + _escCli(t.yape) + '</span>';
    }
    var btnWA = _esTienda ? '' : '<td>' + _cliBotonWA(t, _cliDiaUnico(), false) + '</td>';

    /* Acciones: solo ver el detalle. Editar / desactivar está en el
       catálogo (página "Tiendas", js/tiendas.js) */
    var accionesHTML = '<td><button class="btn btn-sm" onclick="abrirDetalleTienda(\'' + t.id + '\')" title="Ver detalle"><i class="ti ti-eye"></i></button></td>';

    var html = '<tr>' +
      '<td><div style="font-weight:500">' + t.nombre + '</div>' +
        '<div style="font-size:11px;color:var(--color-text-secondary)">' +
          (t.ruc?'RUC: '+t.ruc+' · ':'') + t.ciclo_pago +
        '</div></td>' +
      '<td style="font-size:12px">' + telHTML + '</td>' +
      btnWA +
      '<td><strong>' + pedidos + '</strong></td>' +
      '<td style="color:var(--color-green);font-weight:600">' + entregados + '</td>' +
      '<td style="color:var(--color-red-text);font-weight:600">' + noEntregados + '</td>' +
      '<td style="color:var(--color-purple-text);font-weight:600">' + reprog + '</td>' +
      '<td>' + saldoHTML + '</td>' +
      '<td>' + _badgeEstadoTienda(estadoCli) + '</td>' +
      accionesHTML +
    '</tr>';

    return { nombre: t.nombre, html: html };
  });

  filas = filas.filter(Boolean);

  /* ── Chips de tiendas (solo si hay filtro de fecha) ── */
  var chipsContainer = document.getElementById('tiendas-chips-clientes');
  if (chipsContainer) {
    if (hayFiltro && filas.length > 0) {
      var chips = '<div style="display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 14px">';
      chips += '<button class="chip-tienda' + (_filtroTiendaClientes===''?' active':'') + '" onclick="filtrarPorTiendaClientes(\'\')">Todos</button>';
      filas.forEach(function(f) {
        var activo = _filtroTiendaClientes === f.nombre ? ' active' : '';
        chips += '<button class="chip-tienda' + activo + '" onclick="filtrarPorTiendaClientes(\'' + f.nombre.replace(/'/g,"\\'") + '\')">' + f.nombre + '</button>';
      });
      chips += '</div>';
      chipsContainer.innerHTML = chips;
    } else {
      chipsContainer.innerHTML = '';
      _filtroTiendaClientes = '';
    }
  }

  /* ── Filtrar por tienda seleccionada (si aplica) ── */
  var filasVisibles = filas;
  if (hayFiltro && _filtroTiendaClientes) {
    filasVisibles = filas.filter(function(f){ return f.nombre === _filtroTiendaClientes; });
  }

  tbody.innerHTML = filasVisibles.map(function(f){ return f.html; }).join('') ||
    '<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--color-text-tertiary)">Sin tiendas registradas</td></tr>';

  /* KPIs — calcular desde resumenMap */
  var totCobrar=0, totDevolver=0, alDia=0, conSaldo=0;
  Object.values(resumenMap).forEach(function(s){
    var sc = _cent(s.saldo);
    if (sc !== 0) conSaldo++; else alDia++;
    if (sc > 0) totCobrar += sc;
    if (sc < 0) totDevolver -= sc;
  });
  totCobrar /= 100; totDevolver /= 100;
  var set = function(id,v){ var el=document.getElementById(id); if(el) el.textContent=v; };
  set('kpi-cli-cobrar',   totCobrar>0   ? 'S/ '+totCobrar.toFixed(2)   : '—');
  set('kpi-cli-devolver', totDevolver>0 ? 'S/ '+totDevolver.toFixed(2) : '—');
  set('kpi-cli-aldia',    alDia);
  set('kpi-cli-saldo',    conSaldo);
};

/* ── Filtro por chip de tienda ── */
window.filtrarPorTiendaClientes = function(nombre) {
  _filtroTiendaClientes = nombre;
  renderClientes();
};

window.aplicarFiltroClientes = function() {
  var inpD = document.getElementById('filtro-fecha-clientes-desde');
  var inpH = document.getElementById('filtro-fecha-clientes-hasta');
  var desde = inpD ? inpD.value : '';
  var hasta = inpH ? inpH.value : '';
  /* Si solo llenó uno de los dos, usarlo como día único */
  if (desde && !hasta) hasta = desde;
  if (hasta && !desde) desde = hasta;
  _filtroDesdeClientes = desde;
  _filtroHastaClientes = hasta;
  _filtroTiendaClientes = '';
  _marcarBotonActivoClientes(null);
  renderClientes();
};

window.limpiarFiltroClientes = function() {
  _filtroDesdeClientes = '';
  _filtroHastaClientes = '';
  _filtroTiendaClientes = '';
  var inpD = document.getElementById('filtro-fecha-clientes-desde');
  var inpH = document.getElementById('filtro-fecha-clientes-hasta');
  if (inpD) inpD.value = '';
  if (inpH) inpH.value = '';
  var chipsContainer = document.getElementById('tiendas-chips-clientes');
  if (chipsContainer) chipsContainer.innerHTML = '';
  _marcarBotonActivoClientes(null);
  renderClientes();
};

function _hoyCli() {
  return _formatFechaCli(new Date());
}

function _ayerCli() {
  var d = new Date();
  d.setDate(d.getDate() - 1);
  return _formatFechaCli(d);
}

function _formatFechaCli(d) {
  var mm = ('0'+(d.getMonth()+1)).slice(-2);
  var dd = ('0'+d.getDate()).slice(-2);
  return d.getFullYear() + '-' + mm + '-' + dd;
}

/* Lunes de la semana (lunes-sábado) que contiene la fecha "d" */
function _lunesDeSemanaCli(d) {
  var dia = d.getDay(); /* 0=domingo,1=lunes,...,6=sábado */
  var offset = dia === 0 ? -6 : 1 - dia;
  var lunes = new Date(d);
  lunes.setDate(d.getDate() + offset);
  return lunes;
}

/* Lunes de esta semana → hoy, tope sábado */
function _rangoSemanaActualCli() {
  var hoy = new Date();
  var lunes = _lunesDeSemanaCli(hoy);
  var sabado = new Date(lunes);
  sabado.setDate(lunes.getDate() + 5);
  var fin = hoy > sabado ? sabado : hoy;
  return { desde: _formatFechaCli(lunes), hasta: _formatFechaCli(fin) };
}

/* Semana pasada completa (lunes a sábado) */
function _rangoSemanaPasadaCli() {
  var hoy = new Date();
  var lunesEsta = _lunesDeSemanaCli(hoy);
  var lunesPasada = new Date(lunesEsta);
  lunesPasada.setDate(lunesEsta.getDate() - 7);
  var sabadoPasada = new Date(lunesPasada);
  sabadoPasada.setDate(lunesPasada.getDate() + 5);
  return { desde: _formatFechaCli(lunesPasada), hasta: _formatFechaCli(sabadoPasada) };
}

/* Día 1 de este mes → hoy */
function _rangoMesActualCli() {
  var hoy = new Date();
  var inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  return { desde: _formatFechaCli(inicio), hasta: _formatFechaCli(hoy) };
}

/* Mes pasado completo */
function _rangoMesPasadoCli() {
  var hoy = new Date();
  var inicio = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  var fin    = new Date(hoy.getFullYear(), hoy.getMonth(), 0); /* día 0 = último día del mes anterior */
  return { desde: _formatFechaCli(inicio), hasta: _formatFechaCli(fin) };
}

function _marcarBotonActivoClientes(tipo) {
  var ids = {
    hoy: 'btn-hoy-clientes', ayer: 'btn-ayer-clientes',
    semana: 'btn-semana-clientes', 'semana-pasada': 'btn-semana-pasada-clientes',
    mes: 'btn-mes-clientes', 'mes-pasado': 'btn-mes-pasado-clientes'
  };
  Object.keys(ids).forEach(function(k) {
    var el = document.getElementById(ids[k]);
    if (el) el.classList.toggle('active', tipo === k);
  });
}

window.filtroRapidoClientes = function(tipo) {
  var rango;
  if (tipo === 'hoy')             rango = { desde: _hoyCli(),  hasta: _hoyCli()  };
  else if (tipo === 'ayer')       rango = { desde: _ayerCli(), hasta: _ayerCli() };
  else if (tipo === 'semana')         rango = _rangoSemanaActualCli();
  else if (tipo === 'semana-pasada')  rango = _rangoSemanaPasadaCli();
  else if (tipo === 'mes')            rango = _rangoMesActualCli();
  else if (tipo === 'mes-pasado')     rango = _rangoMesPasadoCli();
  else return;

  _filtroDesdeClientes = rango.desde;
  _filtroHastaClientes = rango.hasta;
  _filtroTiendaClientes = '';
  var inpD = document.getElementById('filtro-fecha-clientes-desde');
  var inpH = document.getElementById('filtro-fecha-clientes-hasta');
  if (inpD) inpD.value = rango.desde;
  if (inpH) inpH.value = rango.hasta;
  _marcarBotonActivoClientes(tipo);
  renderClientes();
};

/* ── Detalle tienda ── */

/* Filtro por período dentro del detalle (agrupa todo el rango en una sola vista,
   en vez de una tab por día — usa los mismos rangos que la página principal) */
window.filtroRapidoDetalle = function(tipo) {
  var rango;
  if (tipo === 'semana')             rango = _rangoSemanaActualCli();
  else if (tipo === 'semana-pasada') rango = _rangoSemanaPasadaCli();
  else if (tipo === 'mes')           rango = _rangoMesActualCli();
  else if (tipo === 'mes-pasado')    rango = _rangoMesPasadoCli();
  else return;

  _filtroDesdeDetalle = rango.desde;
  _filtroHastaDetalle = rango.hasta;
  _tipoFiltroDetalle  = tipo;
  renderDetalleTienda(_tiendaIdDetalleActual);
};

window.aplicarFiltroDetalle = function() {
  var inpD = document.getElementById('filtro-detalle-desde');
  var inpH = document.getElementById('filtro-detalle-hasta');
  var desde = inpD ? inpD.value : '';
  var hasta = inpH ? inpH.value : '';
  if (desde && !hasta) hasta = desde;
  if (hasta && !desde) desde = hasta;
  _filtroDesdeDetalle = desde;
  _filtroHastaDetalle = hasta;
  _tipoFiltroDetalle  = '';
  renderDetalleTienda(_tiendaIdDetalleActual);
};

window.limpiarFiltroDetalle = function() {
  _filtroDesdeDetalle = '';
  _filtroHastaDetalle = '';
  _tipoFiltroDetalle  = '';
  renderDetalleTienda(_tiendaIdDetalleActual);
};

/* Reinicia el filtro de período del detalle — se llama al entrar desde la lista,
   así no queda pegado el filtro de la tienda que se vio antes */
window._resetFiltroDetalleTienda = function() {
  _filtroDesdeDetalle = '';
  _filtroHastaDetalle = '';
  _tipoFiltroDetalle  = '';
};

/* Fila de tabla de una orden en el detalle de tienda.
   mostrarFecha=true agrega la columna Fecha (para la vista agrupada por período,
   donde las órdenes de varios días conviven en una sola tabla) */
function _filaOrdenDetalle(o, mostrarFecha) {
  var badgeE = {
    'entregado':'<span class="badge entregado">Entregado</span>',
    'no-entregado':'<span class="badge no-entregado">No entregado</span>',
    'ausente':'<span class="badge ausente">Ausente</span>',
    'en-proceso':'<span class="badge pendiente">En proceso</span>',
    'reprogramado':'<span class="badge reprogramado">Reprogramado</span>',
    'cancelado':'<span class="badge no-entregado">Cancelado</span>',
    'cambio':'<span class="badge ausente">Cambio</span>',
    'devolucion':'<span class="badge ausente">Devolución</span>',
    'recojo':'<span class="badge pendiente">Recojo</span>',
  };
  /* La plata de la orden ya viene calculada (o.caja, motor de la Caja):
     delivery cobrable, cobrado al cliente que tiene Velox (retenido) y
     su saldo. Las que no cuentan en la Caja, en gris y en 0. */
  var k = o.caja || {};
  var tieneCobro = !!k.cobrable;
  var delivery   = parseFloat(k.delivery) || 0;
  var adicional  = tieneCobro ? parseFloat(o.monto_adicional||0) : 0;
  var cero = '<span style="color:var(--color-text-tertiary)">S/ 0.00</span>';
  var tag = function(txt) {
    return ' <span style="font-size:10px;color:var(--color-amber-text);background:var(--color-amber-bg);padding:1px 5px;border-radius:8px">' + txt + '</span>';
  };
  var dStr = tieneCobro
    ? 'S/ '+delivery.toFixed(2) + (adicional > 0 ? tag('+S/'+adicional.toFixed(2)) : '') + (k.prepago ? tag('prepagado') : '')
    : cero;
  var cStr = tieneCobro ? 'S/ '+(parseFloat(k.retenido)||0).toFixed(2) : cero;
  var sStr = tieneCobro ? _saldoHTMLCli(parseFloat(k.saldo) || 0) : cero;
  /* data-visor-grupo: todas las fotos de la orden en un juego de flechas.
     Los íconos (iconosFotosOrdenColumna, js/motorizados.js): producto en
     el Código, la del estado en Estado y la del pago en Cobrado */
  return '<tr data-visor-grupo>' +
    (mostrarFecha ? '<td style="font-size:12px;color:var(--color-text-secondary)">' + _fechaDisplayCli(_diaCli(o)) + '</td>' : '') +
    '<td style="white-space:nowrap"><strong>#'+o.codigo+'</strong>'+iconosFotosOrdenColumna(o, 'codigo')+'</td>' +
    '<td>'+(o.dest_nombre||'—')+'</td>' +
    '<td>'+o.distrito+'</td>' +
    '<td>'+(o.motorizado||'—')+'</td>' +
    '<td style="white-space:nowrap">'+(badgeE[o.estado]||o.estado)+iconosFotosOrdenColumna(o, 'estado')+'</td>' +
    '<td>'+dStr+'</td><td style="white-space:nowrap">'+cStr+iconosFotosOrdenColumna(o, 'cobrado')+'</td><td>'+sStr+'</td>' +
  '</tr>';
}

/* Mini bloque de resumen (tarjetas + banner de saldo) para un conjunto de órdenes,
   reutilizado tanto por cada tab de día como por la vista agrupada por período */
function _bloqueResumenPeriodoDetalle(titulo, ords) {
  var t = _totalesCajaCli(ords);
  var deliv = t.delivery, cobr = t.retenido, saldo = t.saldo;
  var color = _saldoColorCli(saldo);
  var msg   = _saldoTextoCli(saldo);
  /* Días ya liquidados ("Marcar pagado" de la Caja): la fecha, como en
     el reporte en imagen */
  var pagos = {};
  ords.forEach(function(o) { if (o.caja && o.caja.fecha_pago) pagos[_diaCli(o)] = o.caja.fecha_pago; });
  var dias = Object.keys(pagos);
  var liq = !dias.length ? ''
    : '<div style="font-size:12px;color:var(--color-green-text);margin-top:2px"><i class="ti ti-circle-check"></i> ' +
        (dias.length === 1 ? 'Día liquidado el ' + _fechaDisplayCli(pagos[dias[0]]) : dias.length + ' días liquidados') + '</div>';
  return '<div class="resumen-dia" style="grid-template-columns:repeat(5,1fr);margin-bottom:12px">' +
      '<div class="resumen-item"><div class="resumen-label">Total</div><div class="resumen-val blue">' + ords.length + '</div></div>' +
      '<div class="resumen-item"><div class="resumen-label">Entregados</div><div class="resumen-val green">' + ords.filter(function(o){return o.estado==='entregado';}).length + '</div></div>' +
      '<div class="resumen-item"><div class="resumen-label">Reprogramados</div><div class="resumen-val purple">' + ords.filter(function(o){return o.estado==='reprogramado';}).length + '</div></div>' +
      '<div class="resumen-item"><div class="resumen-label">Delivery cobrable</div><div class="resumen-val blue">S/ ' + deliv.toFixed(2) + '</div></div>' +
      '<div class="resumen-item"><div class="resumen-label">Cobrado (lo tiene Velox)</div><div class="resumen-val green">S/ ' + cobr.toFixed(2) + '</div></div>' +
    '</div>' +
    '<div style="background:var(--color-bg-secondary);border-radius:var(--radius-lg);padding:14px 18px;' +
      'margin-bottom:14px;border-left:5px solid ' + color + ';display:flex;align-items:center;gap:12px">' +
      '<div style="background:' + color + ';border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
        '<i class="ti ti-calculator" style="color:#fff;font-size:15px"></i>' +
      '</div>' +
      '<div>' +
        '<div style="font-size:11px;color:var(--color-text-secondary);font-weight:500;margin-bottom:1px">' + titulo + '</div>' +
        '<div style="font-size:14px;font-weight:700;color:' + color + '">' + msg + '</div>' +
        liq +
      '</div>' +
    '</div>';
}

/* Cambiar tab de fecha en detalle tienda */
window.cambiarDiaTienda = function(idx) {
  document.querySelectorAll('.dia-tab-tienda').forEach(function(t){ t.classList.remove('active'); });
  document.querySelectorAll('.tabla-dia-tienda').forEach(function(t){ t.classList.remove('active'); });
  document.querySelectorAll('.dia-tab-tienda')[idx].classList.add('active');
  document.querySelectorAll('.tabla-dia-tienda')[idx].classList.add('active');
};

window.renderDetalleTienda = async function(tiendaId) {
  var container = document.getElementById('detalle-tienda-root');
  if (!container) return;
  _tiendaIdDetalleActual = tiendaId;
  container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--color-text-secondary)"><i class="ti ti-loader" style="font-size:32px"></i> Cargando...</div>';

  if (!TIENDAS_REGISTRO.length) await _cargarTiendas();
  var tienda = TIENDAS_REGISTRO.find(function(t){ return t.id == tiendaId; });
  if (!tienda) { container.innerHTML = '<div style="padding:40px">Tienda no encontrada.</div>'; return; }

  var r = await fetch(API + '/tiendas/' + tiendaId + '/ordenes');
  var ordenes = await r.json();
  var esTiendaDet = _sesionEsTiendaCli();

  /* Totales generales: la plata, del motor de la Caja (o.caja) */
  var plata = _totalesCajaCli(ordenes);
  var tot = { total:ordenes.length,
    entregados:   ordenes.filter(function(o){return o.estado==='entregado';}).length,
    noEntregados: ordenes.filter(function(o){return o.estado==='no-entregado';}).length,
    reprog:       ordenes.filter(function(o){return o.estado==='reprogramado';}).length,
    costoDeliv:   plata.delivery,
    cobrado:      plata.retenido,
    saldo:        plata.saldo,
  };

  /* Agrupar por fecha */
  var mapaFecha = {};
  ordenes.forEach(function(o) {
    var dia = _diaCli(o);
    if (!mapaFecha[dia]) mapaFecha[dia] = [];
    mapaFecha[dia].push(o);
  });
  var fechas = Object.keys(mapaFecha).sort().reverse();
  if (_filtroDesdeClientes && _filtroDesdeClientes === _filtroHastaClientes && mapaFecha[_filtroDesdeClientes]) {
    fechas = [_filtroDesdeClientes].concat(fechas.filter(function(f){ return f !== _filtroDesdeClientes; }));
  }
  /* Día del reporte en imagen (js/reporte-tienda.js): la primera
     pestaña; sin órdenes, el del filtro */
  var fechaReporte = fechas[0] || _filtroDesdeClientes || _hoyCli();

  var estadoT  = tot.saldo > 0 ? 'Deuda' : tot.saldo < 0 ? 'Dev. pendiente' : 'Al día';
  var badgeEstadoMap = { 'Al día':'entregado', 'Dev. pendiente':'ausente', 'Deuda':'no-entregado' };
  var saldoColor = _saldoColorCli(tot.saldo);
  var saldoMsg   = _saldoTextoCli(tot.saldo);

  /* Encabezado */
  var html =
    '<div class="detalle-header">' +
      '<div class="detalle-header-left">' +
        /* La tienda entra directo acá ("Mi cuenta"): no tiene lista a la que volver */
        (esTiendaDet ? '' : '<button class="btn-back" onclick="showPage(\'clientes\')"><i class="ti ti-arrow-left"></i> Volver</button>') +
        '<div><div class="detalle-nombre">' + tienda.nombre + '</div>' +
          '<div class="detalle-meta">' +
            (tienda.ruc ? '<span><i class="ti ti-id-badge"></i> RUC: '+tienda.ruc+'</span>' : '') +
            (tienda.contacto ? '<span><i class="ti ti-mail"></i> '+tienda.contacto+'</span>' : '') +
            '<span><span class="badge ' + (badgeEstadoMap[estadoT]||'pendiente') + '">' + estadoT + '</span></span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
        /* El WhatsApp del reporte va en cada día (abajo, en su pestaña).
           Ojo: un "cond ? a : b" dentro de una suma de textos va SIEMPRE
           entre paréntesis; sin ellos el + se come todo lo anterior y la
           línea entera vale '' (pasó en b138c92: se perdía este encabezado) */
        (typeof botonesReporteTiendaHTML === 'function' ? botonesReporteTiendaHTML(tienda.id, fechaReporte, tienda.nombre) : '') +
      '</div>' +
    '</div>' +

    /* Resumen general */
    '<div class="resumen-dia" style="grid-template-columns:repeat(5,1fr)">' +
      '<div class="resumen-item"><div class="resumen-label">Total órdenes</div><div class="resumen-val blue">' + tot.total + '</div></div>' +
      '<div class="resumen-item"><div class="resumen-label">Entregados</div><div class="resumen-val green">' + tot.entregados + '</div></div>' +
      '<div class="resumen-item"><div class="resumen-label">No entregados</div><div class="resumen-val red">' + tot.noEntregados + '</div></div>' +
      '<div class="resumen-item"><div class="resumen-label">Delivery cobrable</div><div class="resumen-val blue">S/ ' + tot.costoDeliv.toFixed(2) + '</div></div>' +
      '<div class="resumen-item"><div class="resumen-label">Cobrado (lo tiene Velox)</div><div class="resumen-val green">S/ ' + tot.cobrado.toFixed(2) + '</div></div>' +
    '</div>' +

    /* Banner resumen financiero */
    '<div style="background:var(--color-bg-secondary);border-radius:var(--radius-lg);padding:16px 20px;' +
      'margin-bottom:16px;border-left:5px solid ' + saldoColor + ';display:flex;align-items:center;gap:14px">' +
      '<div style="background:' + saldoColor + ';border-radius:50%;width:38px;height:38px;display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
        '<i class="ti ti-calculator" style="color:#fff;font-size:17px"></i>' +
      '</div>' +
      '<div>' +
        '<div style="font-size:11px;color:var(--color-text-secondary);font-weight:500;margin-bottom:2px">RESUMEN FINANCIERO TOTAL</div>' +
        '<div style="font-size:15px;font-weight:700;color:' + saldoColor + '">' + saldoMsg + '</div>' +
      '</div>' +
    '</div>';

  /* La tienda sigue con los filtros a mano (abajo) */
  if (fechas.length === 0 && !esTiendaDet) {
    html += '<div style="padding:40px;text-align:center;color:var(--color-text-tertiary)">Sin órdenes registradas.</div>';
    container.innerHTML = html;
    return;
  }

  /* ── Barra de filtro por período (agrupa el rango en una sola vista) ── */
  var hayFiltroDetalle = !!(_filtroDesdeDetalle && _filtroHastaDetalle);
  var activoBtn = function(t){ return _tipoFiltroDetalle === t ? ' active' : ''; };
  var descPeriodo = hayFiltroDetalle
    ? (_filtroDesdeDetalle === _filtroHastaDetalle ? _fechaDisplayCli(_filtroDesdeDetalle)
       : _fechaDisplayCli(_filtroDesdeDetalle) + ' al ' + _fechaDisplayCli(_filtroHastaDetalle))
    : 'Últimos 7 días';

  html += '<div style="display:flex;align-items:center;gap:8px;margin:16px 0;flex-wrap:wrap">' +
    '<button class="btn btn-sm' + activoBtn('semana') + '" onclick="filtroRapidoDetalle(\'semana\')">Por semana</button>' +
    '<button class="btn btn-sm' + activoBtn('semana-pasada') + '" onclick="filtroRapidoDetalle(\'semana-pasada\')">Semana pasada</button>' +
    '<button class="btn btn-sm' + activoBtn('mes') + '" onclick="filtroRapidoDetalle(\'mes\')">Por mes</button>' +
    '<button class="btn btn-sm' + activoBtn('mes-pasado') + '" onclick="filtroRapidoDetalle(\'mes-pasado\')">Mes pasado</button>' +
    '<div class="date-filter-wrap"><i class="ti ti-calendar"></i>' +
      '<input type="date" id="filtro-detalle-desde" value="' + (_filtroDesdeDetalle||'') + '" onchange="aplicarFiltroDetalle()" /></div>' +
    '<span style="font-size:12px;color:var(--color-text-secondary)">hasta</span>' +
    '<div class="date-filter-wrap"><i class="ti ti-calendar"></i>' +
      '<input type="date" id="filtro-detalle-hasta" value="' + (_filtroHastaDetalle||'') + '" onchange="aplicarFiltroDetalle()" /></div>' +
    '<button class="btn btn-sm" onclick="limpiarFiltroDetalle()"><i class="ti ti-adjustments-horizontal"></i> Últimos 7 días</button>' +
    '<span style="font-size:12px;color:var(--color-text-tertiary)">' + descPeriodo + '</span>' +
  '</div>';

  if (fechas.length === 0 && !hayFiltroDetalle) {
    /* Solo la tienda llega acá (arriba los gestores ya cortaron) */
    html += '<div style="padding:32px 16px;text-align:center;color:var(--color-text-secondary)">' +
      '<i class="ti ti-package-off" style="font-size:28px;display:block;margin-bottom:8px;color:var(--color-text-tertiary)"></i>' +
      'Todavía no tenés órdenes con Velox. Cuando repartamos tus pedidos, los vas a ver acá día por día.</div>';
  } else if (hayFiltroDetalle) {
    /* ── Vista agrupada: todo el rango en un solo bloque + tabla con columna Fecha ── */
    var ordsPeriodo = ordenes
      .filter(function(o){ return _diaCli(o) >= _filtroDesdeDetalle && _diaCli(o) <= _filtroHastaDetalle; })
      .sort(function(a,b){ return _diaCli(a) < _diaCli(b) ? 1 : _diaCli(a) > _diaCli(b) ? -1 : 0; });

    if (ordsPeriodo.length === 0) {
      html += '<div style="padding:40px;text-align:center;color:var(--color-text-tertiary)">Sin órdenes en este período.</div>';
    } else {
      if (!esTiendaDet) {
        html += '<div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:10px">' +
          '<i class="ti ti-info-circle"></i> El reporte y el WhatsApp son de un día: tocá "Últimos 7 días".</div>';
      }
      html += _bloqueResumenPeriodoDetalle('RESUMEN DEL PERÍODO', ordsPeriodo);
      html +=
        '<div class="card"><div class="card-head">' +
          '<span class="card-title">Órdenes — ' + descPeriodo + '</span>' +
          '<span style="font-size:12px;color:var(--color-text-secondary)">' + ordsPeriodo.length + ' registros</span>' +
        '</div><div class="table-wrap"><table><thead><tr>' +
          '<th>Fecha</th><th>Código</th><th>Destinatario</th><th>Distrito</th><th>Motorizado</th>' +
          '<th>Estado</th><th>Delivery</th><th>Cobrado</th><th>Saldo</th>' +
        '</tr></thead><tbody>' +
        ordsPeriodo.map(function(o){ return _filaOrdenDetalle(o, true); }).join('') +
        '</tbody></table></div></div>';
    }
  } else {
    /* ── Tabs por día, limitadas a los últimos 7 días con órdenes ── */
    var fechasMostrar = fechas.slice(0, 7);

    html += '<div class="dias-tabs">';
    fechasMostrar.forEach(function(fecha, i) {
      html += '<div class="dia-tab-tienda dia-tab' + (i===0?' active':'') + '" data-dia="' + fecha + '" onclick="cambiarDiaTienda(' + i + ')">' + _fechaDisplayCli(fecha) + '</div>';
    });
    html += '</div>';

    fechasMostrar.forEach(function(fecha, i) {
      var ordsDia = mapaFecha[fecha] || [];

      html += '<div class="tabla-dia-tienda tabla-dia' + (i===0?' active':'') + '">';
      if (!esTiendaDet) {
        html += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px">' +
          _cliBotonWA(tienda, fecha, true) + '</div>';
      }
      html += _bloqueResumenPeriodoDetalle('RESUMEN DEL DÍA', ordsDia);
      html +=
        '<div class="card"><div class="card-head">' +
          '<span class="card-title">Órdenes del ' + _fechaDisplayCli(fecha) + '</span>' +
          '<span style="font-size:12px;color:var(--color-text-secondary)">' + ordsDia.length + ' registros</span>' +
        '</div><div class="table-wrap"><table><thead><tr>' +
          '<th>Código</th><th>Destinatario</th><th>Distrito</th><th>Motorizado</th>' +
          '<th>Estado</th><th>Delivery</th><th>Cobrado</th><th>Saldo</th>' +
        '</tr></thead><tbody>' +
        ordsDia.map(function(o){ return _filaOrdenDetalle(o, false); }).join('') +
        '</tbody></table></div></div>';
      html += '</div>'; /* /tabla-dia-tienda */
    });
  }

  container.innerHTML = html;
};

window.exportarTiendas = function() {
  var csv = 'Nombre,RUC,Contacto,Teléfono,Dirección,Ciclo\n';
  TIENDAS_REGISTRO.forEach(function(t) {
    csv += [t.nombre,t.ruc,t.contacto,t.telefono,'"'+t.direccion+'"',t.ciclo_pago].join(',') + '\n';
  });
  var blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'tiendas.csv'; a.click();
};

/* Rol tienda: "Mi cuenta" = su detalle directo, sin la lista, los KPIs,
   Exportar ni "← Volver" (como el moto en Gestión / Motorizado). El id es
   el de la sesión, pero eso es solo pantalla: el servidor ya filtra por
   el id_tienda del token. La tarjeta "Lógica de saldo" queda abajo. */
function _initMiCuentaTienda(idTienda) {
  var titulo = document.getElementById('cli-titulo');
  var sub    = document.getElementById('cli-sub');
  if (titulo) titulo.textContent = 'Mi cuenta';
  if (sub) sub.textContent = 'Tu saldo con Velox y tus órdenes, día por día';
  ['cli-kpis', 'card-clientes-lista'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  var root = document.getElementById('detalle-tienda-root');
  if (!root) return;
  root.hidden = false;
  if (!idTienda) {
    root.innerHTML = '<div style="padding:40px;text-align:center;color:var(--color-text-secondary)">' +
      'Tu usuario no está vinculado a una tienda. Pedile a la oficina que lo revise.</div>';
    return;
  }
  _resetFiltroDetalleTienda();
  renderDetalleTienda(idTienda);
}

window.initClientes = function() {
  if (_sesionEsTiendaCli()) {
    var sesionCli = null;
    try { sesionCli = JSON.parse(localStorage.getItem('velox_usuario')); } catch (e) {}
    _initMiCuentaTienda(sesionCli && sesionCli.id_tienda);
    return;
  }
  /* Si no hay filtro previo (primera vez), arrancar con hoy */
  if (!_filtroDesdeClientes && !_filtroHastaClientes) {
    _filtroDesdeClientes = _hoyCli();
    _filtroHastaClientes = _hoyCli();
  }
  renderClientes();
  /* Restaurar los inputs de fecha y el botón activo */
  var inpD = document.getElementById('filtro-fecha-clientes-desde');
  var inpH = document.getElementById('filtro-fecha-clientes-hasta');
  if (inpD) inpD.value = _filtroDesdeClientes;
  if (inpH) inpH.value = _filtroHastaClientes;
  var esHoy  = _filtroDesdeClientes === _hoyCli()  && _filtroHastaClientes === _hoyCli();
  var esAyer = _filtroDesdeClientes === _ayerCli() && _filtroHastaClientes === _ayerCli();
  _marcarBotonActivoClientes(esHoy ? 'hoy' : esAyer ? 'ayer' : null);

  if (typeof iniciarRefrescoAutomatico === 'function') {
    iniciarRefrescoAutomatico('tbody-clientes', renderClientes);
  }
};

/* ════════════════════════════════════════════
   WHATSAPP DEL REPORTE DE UNA TIENDA (igual que el de motos,
   enviarReporteMotoWA en js/gestion-motos.js)
   Los números salen de GET /caja/tiendas/:id/reporte, o sea del motor
   de la Caja (calcularOrdenCaja): los mismos de Caja → Tienda y del
   reporte en imagen. El mensaje lleva cada orden del día, los totales
   y la URL de la imagen; si el día todavía no tiene imagen, el admin
   la genera antes y el operador manda la que haya (o recibe el aviso).
════════════════════════════════════════════ */
var _CLI_ESTADOS_WA = {
  'entregado':    ['✅', 'Entregado'],
  'ausente':      ['⚠️', 'Ausente'],
  'devolucion':   ['↩️', 'Devolución'],
  'reprogramado': ['🔄', 'Reprogramado'],
  'no-entregado': ['❌', 'No entregado'],
  'cancelado':    ['🚫', 'Cancelado'],
  'en-proceso':   ['🚚', 'En camino'],
};

function _cliSolesWA(v) {
  return 'S/ ' + (parseFloat(v) || 0).toFixed(2);
}

function _cliMensajeWA(nombre, fecha, datos, url) {
  var t = datos.totales || {};
  var saldo = parseFloat(t.saldo) || 0;
  var msg = 'Hola ' + nombre + ' 👋\n';
  msg += '*Velox Courier* · tu reporte del ' + _fechaDisplayCli(fecha) + ':\n';
  msg += url + '\n';
  msg += '-----------------------\n';
  (datos.pedidos || []).forEach(function(p) {
    var e = _CLI_ESTADOS_WA[p.estado] || ['📋', p.estado];
    var linea = e[0] + ' #' + p.codigo + ' · ' + (p.dest_nombre || '—') + ' · ' + (p.distrito || '—') + ' · ' + e[1];
    /* Su monto: lo que cuenta en la Caja (los no cobrables, nada) */
    if (p.cobrable) {
      linea += ' · delivery ' + _cliSolesWA(p.delivery) + (p.prepago ? ' (prepagado)' : '');
      if (parseFloat(p.retenido) > 0) linea += ' · cobrado ' + _cliSolesWA(p.retenido);
    }
    msg += linea + '\n';
  });
  msg += '-----------------------\n';
  msg += '🚚 Delivery del día: *' + _cliSolesWA(t.delivery) + '*\n';
  msg += '💵 Cobrado al cliente (lo tiene Velox): *' + _cliSolesWA(t.retenido) + '*\n';
  msg += (saldo > 0 ? '🟢 Saldo: nos debés *' + _cliSolesWA(saldo) + '*'
        : saldo < 0 ? '🟠 Saldo: te devolvemos *' + _cliSolesWA(Math.abs(saldo)) + '*'
        : '⚪ Saldo en cero') + '\n';
  if (datos.liquidado) msg += '✔️ Día liquidado el ' + _fechaDisplayCli(datos.liquidado.fecha_pago) + '\n';
  return msg;
}

function _cliTelefono51(tel) {
  var t = String(tel || '').replace(/[^0-9]/g, '');
  return t.length === 9 ? '51' + t : t;
}

var _cliEnviando = false;

window.enviarReporteTiendaWA = async function(idTienda, fecha, btn) {
  if (_cliEnviando) return;
  var t = TIENDAS_REGISTRO.find(function(x) { return x.id == idTienda; });
  var tel = t && _cliTelefono51(t.telefono);
  if (!tel) { if (typeof showNotif === 'function') showNotif('Esa tienda no tiene teléfono cargado'); return; }

  /* La pestaña se abre YA, con el toque: si se abre después de esperar
     al servidor, el celular la bloquea como ventana emergente */
  var ventana = null;
  try { ventana = window.open('', '_blank'); } catch (e) { ventana = null; }
  _cliEnviando = true;
  var htmlBtn = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader"></i>'; }

  try {
    var r = await fetch(API + '/caja/tiendas/' + idTienda + '/reporte?fecha=' + fecha);
    var datos = await r.json().catch(function() { return {}; });
    if (!r.ok) throw new Error(datos.error || 'No se pudieron traer los datos del día');
    if (!(datos.pedidos || []).length) throw new Error('la tienda no tiene órdenes el ' + _cliDiaMes(fecha));

    var url = datos.reporte && datos.reporte.url;
    if (!url) {
      if (!datos.r2) throw new Error('las fotos y reportes (R2) no están configurados en este servidor');
      if (!(typeof _repEsAdmin === 'function' && _repEsAdmin())) {
        throw new Error('todavía no hay reporte del ' + _cliDiaMes(fecha) + ': lo tiene que generar un admin');
      }
      if (typeof showNotif === 'function') showNotif('Generando el reporte del ' + _cliDiaMes(fecha) + '…', 3000);
      var hecho = await _repGenerarYSubir('tienda', idTienda, fecha, datos);
      url = hecho.url;
      _repAvisarGenerado('tienda', idTienda, fecha, hecho.url, hecho.generadoEn);
    }

    var waUrl = 'https://api.whatsapp.com/send?phone=' + tel + '&text=' + encodeURIComponent(_cliMensajeWA(t.nombre, fecha, datos, url));
    if (ventana && !ventana.closed) ventana.location.href = waUrl;
    else window.open(waUrl, '_blank');

    _cliMarcarEnviado(idTienda, fecha);
    _cliRepintarMarcas(idTienda, fecha);
  } catch (err) {
    console.error('WhatsApp del reporte de la tienda:', err);
    if (ventana && !ventana.closed) ventana.close();
    if (typeof showNotif === 'function') showNotif('No se mandó: ' + (err && err.message ? err.message : 'error'), 6000);
  } finally {
    _cliEnviando = false;
    if (btn) { btn.disabled = false; btn.innerHTML = htmlBtn; }
  }
};
