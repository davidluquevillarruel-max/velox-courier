/* ============================================================
   gestion-motos.js — Página "Gestión / Motorizado"
   (pages/gestion-motos.html). La gemela de Clientes / Tiendas para
   los motorizados: "qué hicieron y cuánto".

   · Lista: GET /api/caja/motorizados/gestion?desde=&hasta= → cada moto
     con órdenes en el período. Mismos filtros que Clientes (Hoy, Ayer,
     semana, mes, rango, Ver todos), chips por moto y Exportar.
   · WhatsApp: le manda al moto SU reporte en imagen (el mismo de Caja →
     Motorizados) con el link; si ese día todavía no tiene imagen, la
     genera antes (solo admin puede generar; el operador manda la que
     ya existe). Marca "enviado" como en Clientes: en este navegador.
   · Detalle: pestañas con los últimos 7 días con órdenes hasta el día
     elegido (como el detalle de una tienda) o un período agrupado. Los
     números de cada día salen de GET /caja/motorizados/:id/dias (cada
     día = armarDiaMoto, la misma cuenta del reporte y de la Caja). La
     tabla de órdenes es la del panel de Motorizados
     (_renderTablaOrdenesDetalle, con Actualizar y Reasignar).

   Nada de plata se calcula acá: viene de calcularOrdenCaja() en el
   servidor. Acá solo se suma la fila de totales (en céntimos).
   Admin y operador (el servidor lo exige igual: routes/caja.js).
   ============================================================ */

var _gmDesde = '';          /* período de la lista ('' y '' = Ver todos) */
var _gmHasta = '';
var _gmTipo  = 'hoy';       /* botón activo: hoy, ayer, semana, ..., '' */
var _gmChip  = '';          /* id del moto elegido en los chips ('' = todos) */
var _gmLista = [];          /* última respuesta de la lista (Exportar, WhatsApp) */
var _gmDet   = null;        /* detalle abierto: { id, modo, base, desde, hasta, tipo, dias, activo } */
var _gmAbrirAlIniciar = null; /* lo deja abrirGestionMoto() antes de showPage */

/* ── Fechas ── */
function _gmHoyLima(diasAtras) {
  var d = new Date(Date.now() - (diasAtras || 0) * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(d);
}

/* Un solo día elegido en la lista (para el WhatsApp y su marca) */
function _gmDiaUnico() {
  return _gmDesde && _gmDesde === _gmHasta ? _gmDesde : '';
}

function _gmDiaMes(fecha) {
  var p = (fecha || '').split('-');
  return p.length === 3 ? p[2] + '/' + p[1] : fecha;
}

/* ── Formato ── */
function _gmEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _gmSoles(v) {
  return 'S/ ' + (parseFloat(v) || 0).toFixed(2);
}

function _gmMonto(v) {
  return (parseFloat(v) || 0) === 0
    ? '<span style="color:var(--color-text-tertiary)">S/ 0.00</span>'
    : '<span style="font-weight:600;white-space:nowrap">' + _gmSoles(v) + '</span>';
}

/* "Liquidado": un día → Liquidado / Pendiente; varios → cuántos */
function _gmChipLiquidado(m) {
  var dias = m.dias || 0, liq = m.dias_liquidados || 0;
  var difiere = m.difiere ? '<div style="font-size:10px;color:var(--color-amber-text);white-space:nowrap">difiere de lo pagado</div>' : '';
  if (!liq) return '<span class="badge pendiente">Pendiente</span>';
  if (liq === dias) return '<span class="badge entregado">Liquidado</span>' + difiere;
  return '<span class="badge ausente">' + liq + ' de ' + dias + ' días</span>' + difiere;
}

function _gmNombreHTML(m) {
  return '<div class="moto-resumen-nombre" title="' + _gmEsc(m.nombre) + '">' +
    '<div class="avatar ' + _gmEsc(m.color_avatar || 'av-blue') + '" style="width:30px;height:30px;font-size:11px;flex-shrink:0">' + _gmEsc(m.iniciales) + '</div>' +
    '<strong>' + _gmEsc(m.nombre) + '</strong></div>';
}

/* ════════════════════════════════════════════
   "ENVIADO" — igual que Clientes / Tiendas: vive en este navegador
   (localStorage). Va por moto Y día del reporte: mandarle el del 18 no
   marca el del 19. Se guardan los últimos 60 días.
════════════════════════════════════════════ */
var _GM_WA_CLAVE = 'velox_wa_motos';

function _gmWaLeer() {
  var data = null;
  try { data = JSON.parse(localStorage.getItem(_GM_WA_CLAVE)); } catch (e) { data = null; }
  return data && typeof data === 'object' ? data : {};
}

function _gmEnviado(idMoto, fecha) {
  return !!(fecha && _gmWaLeer()[idMoto + '|' + fecha]);
}

function _gmMarcarEnviado(idMoto, fecha) {
  var data = _gmWaLeer();
  data[idMoto + '|' + fecha] = _gmHoyLima(0);
  var limite = _gmHoyLima(60);
  Object.keys(data).forEach(function(k) { if (k.split('|')[1] < limite) delete data[k]; });
  try { localStorage.setItem(_GM_WA_CLAVE, JSON.stringify(data)); } catch (e) { /* solo afecta la marca */ }
}

function _gmCheckEnviadoHTML(idMoto, fecha) {
  return _gmEnviado(idMoto, fecha)
    ? ' <i class="ti ti-circle-check wa-enviado-check" title="Ya se le envió el reporte del ' + _gmEsc(_gmDiaMes(fecha)) + '" ' +
        'style="color:var(--color-green);font-size:14px;vertical-align:middle"></i>'
    : '';
}

/* Botón de WhatsApp del reporte de un día (lista y detalle). Sin un
   solo día elegido, apagado: el reporte es de un día. */
function _gmBotonWA(m, fecha, conTexto) {
  if (!m.telefono) return '<span style="color:var(--color-text-tertiary);font-size:12px">Sin teléfono</span>';
  if (!fecha) {
    return '<button class="btn btn-sm" disabled title="El reporte es de un día: filtrá un solo día" ' +
      'style="padding:4px 8px"><i class="ti ti-brand-whatsapp"></i></button>';
  }
  return '<span class="gm-wa" data-moto="' + Number(m.id) + '" data-fecha="' + _gmEsc(fecha) + '" style="white-space:nowrap">' +
    '<button class="btn btn-sm" onclick="enviarReporteMotoWA(' + Number(m.id) + ',\'' + _gmEsc(fecha) + '\',this)" ' +
      'title="Mandarle por WhatsApp su reporte del ' + _gmEsc(_gmDiaMes(fecha)) + '" ' +
      'style="background:#25D366;color:#fff;border-color:#25D366;padding:4px 8px' + (conTexto ? ';font-weight:600' : '') + '">' +
      '<i class="ti ti-brand-whatsapp"></i>' + (conTexto ? ' Enviar reporte ' + _gmEsc(_gmDiaMes(fecha)) : '') + '</button>' +
    _gmCheckEnviadoHTML(m.id, fecha) +
  '</span>';
}

/* Repinta las marcas de un moto y día donde estén (lista y detalle) */
function _gmRepintarMarcas(idMoto, fecha) {
  document.querySelectorAll('.gm-wa[data-moto="' + idMoto + '"][data-fecha="' + fecha + '"]').forEach(function(cont) {
    if (!cont.querySelector('.wa-enviado-check')) {
      cont.insertAdjacentHTML('beforeend', _gmCheckEnviadoHTML(idMoto, fecha));
    }
  });
  var tbody = document.getElementById('tbody-gestion-motos');
  if (tbody) tbody.dataset.firma = ''; /* el refresco no la borra */
}

function _gmMensajeWA(nombre, fecha, t, url) {
  var neto = parseFloat(t.neto) || 0;
  var msg = 'Hola ' + nombre + ' 👋\n';
  msg += '*Velox Courier* · tu reporte del ' + _fechaDisplayM(fecha) + ':\n';
  msg += url + '\n';
  msg += '-----------------------\n';
  msg += '💵 Efectivo: *' + _gmSoles(t.efectivo) + '*\n';
  msg += '📱 Yape: *' + _gmSoles(t.yape) + '*\n';
  msg += '📦 Entregás a Velox: *' + _gmSoles(t.a_entregar) + '*\n';
  msg += '🛵 Velox te paga: *' + _gmSoles(t.pago_moto) + '*\n';
  msg += (neto > 0 ? '🟢 Neto a entregar: *' + _gmSoles(neto) + '*'
        : neto < 0 ? '🟠 Velox te debe: *' + _gmSoles(Math.abs(neto)) + '*'
        : '⚪ Saldo en cero') + '\n';
  return msg;
}

function _gmTelefono51(tel) {
  var t = String(tel || '').replace(/[^0-9]/g, '');
  return t.length === 9 ? '51' + t : t;
}

var _gmEnviando = false;

/* Manda por WhatsApp el reporte de ese día al moto. Si el día todavía
   no tiene imagen, la genera antes (solo admin; el operador manda la
   que ya existe, igual que no puede generarla en la Caja). */
window.enviarReporteMotoWA = async function(idMoto, fecha, btn) {
  if (_gmEnviando) return;
  var m = _gmLista.find(function(x) { return x.id == idMoto; }) ||
          MOTORIZADOS.find(function(x) { return x.id == idMoto; });
  var tel = m && _gmTelefono51(m.telefono);
  if (!tel) { if (typeof showNotif === 'function') showNotif('Ese motorizado no tiene teléfono cargado'); return; }

  /* La pestaña se abre YA, con el toque: si se abre después de esperar
     al servidor, el celular la bloquea como ventana emergente */
  var ventana = null;
  try { ventana = window.open('', '_blank'); } catch (e) { ventana = null; }
  _gmEnviando = true;
  var htmlBtn = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader"></i>'; }

  try {
    var r = await fetch(API + '/caja/motorizados/' + idMoto + '/reporte?fecha=' + fecha);
    var datos = await r.json().catch(function() { return {}; });
    if (!r.ok) throw new Error(datos.error || 'No se pudieron traer los datos del día');

    var url = datos.reporte && datos.reporte.url;
    if (!url) {
      if (!datos.r2) throw new Error('las fotos y reportes (R2) no están configurados en este servidor');
      if (!(typeof _repEsAdmin === 'function' && _repEsAdmin())) {
        throw new Error('todavía no hay reporte del ' + _gmDiaMes(fecha) + ': lo tiene que generar un admin');
      }
      if (typeof showNotif === 'function') showNotif('Generando el reporte del ' + _gmDiaMes(fecha) + '…', 3000);
      var hecho = await _repGenerarYSubir('moto', idMoto, fecha, datos);
      url = hecho.url;
      _repAvisarGenerado('moto', idMoto, fecha, hecho.url, hecho.generadoEn);
    }

    var waUrl = 'https://api.whatsapp.com/send?phone=' + tel + '&text=' + encodeURIComponent(_gmMensajeWA(m.nombre, fecha, datos.totales || {}, url));
    if (ventana && !ventana.closed) ventana.location.href = waUrl;
    else window.open(waUrl, '_blank');

    _gmMarcarEnviado(idMoto, fecha);
    _gmRepintarMarcas(idMoto, fecha);
  } catch (err) {
    console.error('WhatsApp del reporte del moto:', err);
    if (ventana && !ventana.closed) ventana.close();
    if (typeof showNotif === 'function') showNotif('No se mandó: ' + (err && err.message ? err.message : 'error'), 6000);
  } finally {
    _gmEnviando = false;
    if (btn) { btn.disabled = false; btn.innerHTML = htmlBtn; }
  }
};

/* ════════════════════════════════════════════
   LISTA
════════════════════════════════════════════ */
async function _gmCargarLista() {
  var tbody = document.getElementById('tbody-gestion-motos');
  if (!tbody) return;
  var desde = _gmDesde, hasta = _gmHasta;
  var lbl = document.getElementById('lbl-fecha-gm');
  if (lbl) {
    lbl.textContent = !desde ? 'Mostrando: todos los días'
      : desde === hasta ? 'Mostrando: ' + _fechaDisplayM(desde)
      : 'Mostrando: ' + _fechaDisplayM(desde) + ' al ' + _fechaDisplayM(hasta);
  }

  var datos;
  try {
    var r = await fetch(API + '/caja/motorizados/gestion' + (desde ? '?desde=' + desde + '&hasta=' + hasta : ''));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    datos = await r.json();
  } catch (err) {
    console.error('Gestión / Motorizado:', err);
    if (!tbody.dataset.firma) {
      tbody.innerHTML = '<tr><td colspan="13" style="padding:24px;color:var(--color-red-text)">No se pudo cargar la gestión.</td></tr>';
    }
    return;
  }
  if ((datos.desde || '') !== desde || (desde && (datos.hasta || '') !== hasta)) return; /* cambió el filtro */
  _gmLista = datos.motorizados || [];

  /* Chips por moto: con un período elegido, como las tiendas en Clientes */
  var chips = document.getElementById('gm-chips');
  if (chips) {
    if (desde && _gmLista.length) {
      if (_gmChip && !_gmLista.some(function(m) { return m.id == _gmChip; })) _gmChip = '';
      var h = '<div style="display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 14px">' +
        '<button class="chip-tienda' + (_gmChip === '' ? ' active' : '') + '" onclick="filtrarPorMotoGestion(\'\')">Todos</button>';
      _gmLista.forEach(function(m) {
        h += '<button class="chip-tienda' + (_gmChip == m.id ? ' active' : '') + '" onclick="filtrarPorMotoGestion(' + Number(m.id) + ')">' + _gmEsc(m.nombre) + '</button>';
      });
      chips.innerHTML = h + '</div>';
    } else {
      chips.innerHTML = '';
      _gmChip = '';
    }
  }

  var visibles = _gmChip ? _gmLista.filter(function(m) { return m.id == _gmChip; }) : _gmLista;
  var dia = _gmDiaUnico();
  var c = function(v) { return Math.round((parseFloat(v) || 0) * 100); };
  var tot = { ordenes: 0, ent: 0, noEnt: 0, aus: 0, efectivo: 0, yape: 0, pago: 0, neto: 0 };

  var filas = visibles.map(function(m) {
    var rs = m.resumen || {}, t = m.totales || {};
    tot.ordenes += rs.pedidos || 0; tot.ent += rs.entregados || 0;
    tot.noEnt += rs.no_entregados || 0; tot.aus += rs.ausentes || 0;
    tot.efectivo += c(t.efectivo); tot.yape += c(t.yape); tot.pago += c(t.pago_moto); tot.neto += c(t.neto);
    var telHTML = m.telefono
      ? '<a href="https://api.whatsapp.com/send?phone=' + _gmTelefono51(m.telefono) + '" target="_blank" rel="noopener" ' +
          'style="display:inline-flex;align-items:center;gap:4px;color:#25D366;text-decoration:none;font-weight:500;white-space:nowrap">' +
          '<i class="ti ti-brand-whatsapp"></i> ' + _gmEsc(m.telefono) + '</a>'
      : '<span style="color:var(--color-text-tertiary)">—</span>';
    return '<tr>' +
      '<td>' + _gmNombreHTML(m) + '</td>' +
      '<td style="font-size:12px">' + telHTML + '</td>' +
      '<td>' + _gmBotonWA(m, dia, false) + '</td>' +
      '<td><strong>' + (rs.pedidos || 0) + '</strong></td>' +
      '<td style="color:var(--color-green);font-weight:600">' + (rs.entregados || 0) + '</td>' +
      '<td style="color:var(--color-red-text);font-weight:600">' + (rs.no_entregados || 0) + '</td>' +
      '<td style="color:var(--color-amber-text);font-weight:600">' + (rs.ausentes || 0) + '</td>' +
      '<td>' + _gmMonto(t.efectivo) + '</td>' +
      '<td>' + _gmMonto(t.yape) + '</td>' +
      '<td>' + _gmMonto(t.pago_moto) + '</td>' +
      '<td>' + _deudaMotoHTML(t.neto) + '</td>' +
      '<td>' + _gmChipLiquidado(m) + '</td>' +
      '<td><button class="btn btn-primary btn-sm" onclick="abrirDetalleGestionMoto(' + Number(m.id) + ')">' +
        '<i class="ti ti-eye"></i> Ver detalle</button></td>' +
    '</tr>';
  });

  var html = filas.length
    ? filas.join('') +
      '<tr style="background:var(--color-bg-secondary);font-weight:700">' +
        /* La celda fija lleva su propio fondo (la regla de PRIMERA
           COLUMNA FIJA de responsive.css le pone blanco) */
        '<td style="background:var(--color-bg-secondary)">TOTALES</td><td></td><td></td>' +
        '<td>' + tot.ordenes + '</td><td>' + tot.ent + '</td><td>' + tot.noEnt + '</td><td>' + tot.aus + '</td>' +
        '<td>' + _gmSoles(tot.efectivo / 100) + '</td><td>' + _gmSoles(tot.yape / 100) + '</td>' +
        '<td>' + _gmSoles(tot.pago / 100) + '</td><td>' + _deudaMotoHTML(tot.neto / 100) + '</td><td></td><td></td>' +
      '</tr>'
    : '<tr><td colspan="13" style="padding:24px;text-align:center;color:var(--color-text-tertiary)">' +
        'Ningún motorizado tuvo órdenes ' + (desde ? 'en ese período' : 'todavía') + '.</td></tr>';

  /* El refresco de 8 s no repinta si nada cambió (no se pierde el scroll) */
  if (tbody.dataset.firma === html) return;
  tbody.dataset.firma = html;
  tbody.innerHTML = html;
}

window.filtrarPorMotoGestion = function(idMoto) {
  _gmChip = idMoto ? String(idMoto) : '';
  _gmCargarLista();
};

function _gmMarcarBoton(tipo) {
  ['hoy', 'ayer', 'semana', 'semana-pasada', 'mes', 'mes-pasado'].forEach(function(k) {
    var el = document.getElementById('btn-' + k + '-gm');
    if (el) el.classList.toggle('active', tipo === k);
  });
}

function _gmPonerPeriodo(desde, hasta, tipo) {
  _gmDesde = desde; _gmHasta = hasta; _gmTipo = tipo || '';
  var inpD = document.getElementById('filtro-fecha-gm-desde');
  var inpH = document.getElementById('filtro-fecha-gm-hasta');
  if (inpD) inpD.value = desde;
  if (inpH) inpH.value = hasta;
  _gmMarcarBoton(_gmTipo);
}

/* Rango de un botón rápido. Semana y mes: los mismos de Clientes */
function _gmRangoRapido(tipo) {
  if (tipo === 'hoy')  return { desde: _gmHoyLima(0), hasta: _gmHoyLima(0) };
  if (tipo === 'ayer') return { desde: _gmHoyLima(1), hasta: _gmHoyLima(1) };
  if (tipo === 'semana')        return _rangoSemanaActualCli();
  if (tipo === 'semana-pasada') return _rangoSemanaPasadaCli();
  if (tipo === 'mes')           return _rangoMesActualCli();
  if (tipo === 'mes-pasado')    return _rangoMesPasadoCli();
  return null;
}

window.filtroRapidoGestionMotos = function(tipo) {
  var r = _gmRangoRapido(tipo);
  if (!r) return;
  _gmChip = '';
  _gmPonerPeriodo(r.desde, r.hasta, tipo);
  _gmCargarLista();
};

window.aplicarFiltroGestionMotos = function() {
  var inpD = document.getElementById('filtro-fecha-gm-desde');
  var inpH = document.getElementById('filtro-fecha-gm-hasta');
  var desde = inpD ? inpD.value : '', hasta = inpH ? inpH.value : '';
  /* Si llenó uno solo, es ese día (como en Clientes) */
  if (desde && !hasta) hasta = desde;
  if (hasta && !desde) desde = hasta;
  if (desde > hasta) { var x = desde; desde = hasta; hasta = x; }
  _gmChip = '';
  _gmPonerPeriodo(desde, hasta, desde && desde === hasta && desde === _gmHoyLima(0) ? 'hoy' : '');
  _gmCargarLista();
};

window.limpiarFiltroGestionMotos = function() {
  _gmChip = '';
  _gmPonerPeriodo('', '', '');
  _gmCargarLista();
};

/* Exportar: lo que se ve en la lista (período y chip), CSV con ";"
   y BOM para que Excel en es-PE lo abra en columnas */
window.exportarGestionMotos = function() {
  var visibles = _gmChip ? _gmLista.filter(function(m) { return m.id == _gmChip; }) : _gmLista;
  if (!visibles.length) { if (typeof showNotif === 'function') showNotif('No hay nada para exportar'); return; }
  var celda = function(v) { var s = String(v == null ? '' : v); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  var num = function(v) { return (parseFloat(v) || 0).toFixed(2); };
  var lineas = [['Motorizado', 'Teléfono', 'Desde', 'Hasta', 'Órdenes', 'Entregados', 'No entregados', 'Ausentes',
                 'Efectivo', 'Yape', 'Entrega a Velox', 'Su pago', 'Deuda moto', 'Días', 'Días liquidados'].join(';')];
  visibles.forEach(function(m) {
    var rs = m.resumen || {}, t = m.totales || {};
    lineas.push([m.nombre, m.telefono, _gmDesde || 'todos', _gmHasta || 'todos', rs.pedidos || 0, rs.entregados || 0,
      rs.no_entregados || 0, rs.ausentes || 0, num(t.efectivo), num(t.yape), num(t.a_entregar), num(t.pago_moto),
      num(t.neto), m.dias || 0, m.dias_liquidados || 0].map(celda).join(';'));
  });
  var blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'gestion_motorizados_' + (_gmDesde ? _gmDesde + (_gmHasta !== _gmDesde ? '_al_' + _gmHasta : '') : 'todos') + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
};

/* ════════════════════════════════════════════
   DETALLE DE UN MOTORIZADO
   Modo "dias": pestañas con los últimos 7 días con órdenes hasta el
   día base (el elegido en la lista, o hoy). Modo "periodo": un período
   agrupado en una sola vista (como el filtro del detalle de una tienda).
════════════════════════════════════════════ */
function _gmVista(cual) {
  var lista = document.getElementById('gm-vista-lista');
  var det = document.getElementById('gm-vista-detalle');
  if (lista) lista.style.display = cual === 'lista' ? '' : 'none';
  if (det)   det.style.display   = cual === 'detalle' ? '' : 'none';
}

function _gmMotoDet() {
  var id = _gmDet && _gmDet.id;
  return _gmLista.find(function(x) { return x.id == id; }) ||
         MOTORIZADOS.find(function(x) { return x.id == id; }) || { id: id, nombre: '—' };
}

/* Abre el detalle desde la lista: un día → sus pestañas; un período →
   ese período agrupado (así cuadra con la fila); Ver todos → hoy */
window.abrirDetalleGestionMoto = function(idMoto) {
  var dia = _gmDiaUnico();
  if (!_gmDesde) _gmDet = { id: idMoto, modo: 'dias', base: _gmHoyLima(0) };
  else if (dia)  _gmDet = { id: idMoto, modo: 'dias', base: dia };
  else           _gmDet = { id: idMoto, modo: 'periodo', desde: _gmDesde, hasta: _gmHasta, tipo: _gmTipo };
  _gmVista('detalle');
  window.scrollTo(0, 0);
  _gmPintarDetalle(false);
};

async function _gmPintarDetalle(silencioso) {
  var det = document.getElementById('gm-vista-detalle');
  if (!det || !_gmDet) return;
  var estado = _gmDet;
  if (!silencioso) det.innerHTML = '<div style="padding:40px;text-align:center;color:var(--color-text-secondary)"><i class="ti ti-loader" style="font-size:28px"></i> Cargando...</div>';

  var url = API + '/caja/motorizados/' + estado.id + '/dias?' +
    (estado.modo === 'periodo' ? 'desde=' + estado.desde + '&hasta=' + estado.hasta : 'hasta=' + estado.base);
  var datos;
  try {
    var r = await Promise.all([
      fetch(url),
      MOTORIZADOS.length ? null : _cargarMotorizados(),
    ]);
    if (!r[0].ok) throw new Error('HTTP ' + r[0].status);
    datos = await r[0].json();
  } catch (err) {
    console.error('Detalle Gestión / Motorizado:', err);
    det.innerHTML = '<div style="padding:24px"><button class="btn-back" onclick="volverListaGestionMotos()"><i class="ti ti-arrow-left"></i> Volver</button>' +
      '<div style="margin-top:16px;color:var(--color-red-text)">No se pudo cargar el detalle.</div></div>';
    return;
  }
  if (_gmDet !== estado) return; /* se abrió otro o se volvió mientras cargaba */
  estado.dias = datos.dias || [];
  estado.periodo = datos.periodo;
  if (estado.activo == null || estado.activo >= estado.dias.length) estado.activo = 0;

  var m = _gmMotoDet();
  var activoBtn = function(t) { return estado.modo === 'periodo' && estado.tipo === t ? ' active' : ''; };
  var html =
    '<div class="detalle-header">' +
      '<div class="detalle-header-left">' +
        '<button class="btn-back" onclick="volverListaGestionMotos()"><i class="ti ti-arrow-left"></i> Volver</button>' +
        '<div style="display:flex;align-items:center;gap:12px;min-width:0">' +
          '<div class="avatar ' + _gmEsc(m.color_avatar || 'av-blue') + '" style="width:44px;height:44px;font-size:16px;flex-shrink:0">' + _gmEsc(m.iniciales) + '</div>' +
          '<div style="min-width:0"><div class="detalle-nombre">' + _gmEsc(m.nombre) + '</div>' +
            '<div class="detalle-meta">' + (m.telefono ? '<span><i class="ti ti-phone"></i> ' + _gmEsc(m.telefono) + '</span>' : '<span>Sin teléfono</span>') + '</div></div>' +
        '</div>' +
      '</div>' +
    '</div>' +
    /* Filtro de período del detalle (como el de una tienda) */
    '<div style="display:flex;align-items:center;gap:8px;margin:0 0 16px;flex-wrap:wrap">' +
      '<button class="btn btn-sm' + (estado.modo === 'dias' ? ' active' : '') + '" onclick="diasGestionMoto()">Últimos 7 días</button>' +
      '<button class="btn btn-sm' + activoBtn('semana') + '" onclick="periodoGestionMoto(\'semana\')">Por semana</button>' +
      '<button class="btn btn-sm' + activoBtn('semana-pasada') + '" onclick="periodoGestionMoto(\'semana-pasada\')">Semana pasada</button>' +
      '<button class="btn btn-sm' + activoBtn('mes') + '" onclick="periodoGestionMoto(\'mes\')">Por mes</button>' +
      '<button class="btn btn-sm' + activoBtn('mes-pasado') + '" onclick="periodoGestionMoto(\'mes-pasado\')">Mes pasado</button>' +
      '<div class="date-filter-wrap"><i class="ti ti-calendar"></i>' +
        '<input type="date" id="gm-det-desde" value="' + _gmEsc(estado.modo === 'periodo' ? estado.desde : '') + '" onchange="periodoGestionMoto(\'rango\')" /></div>' +
      '<span style="font-size:12px;color:var(--color-text-secondary)">hasta</span>' +
      '<div class="date-filter-wrap"><i class="ti ti-calendar"></i>' +
        '<input type="date" id="gm-det-hasta" value="' + _gmEsc(estado.modo === 'periodo' ? estado.hasta : '') + '" onchange="periodoGestionMoto(\'rango\')" /></div>' +
    '</div>';

  if (estado.modo === 'periodo') {
    html += _gmBloquePeriodoHTML(estado);
  } else if (!estado.dias.length) {
    html += '<div style="padding:40px;text-align:center;color:var(--color-text-tertiary)">Sin órdenes hasta el ' + _fechaDisplayM(estado.base) + '.</div>';
  } else {
    if (estado.dias[0].fecha !== estado.base) {
      html += '<div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:10px">' +
        '<i class="ti ti-info-circle"></i> El ' + _fechaDisplayM(estado.base) + ' no tuvo órdenes: abajo, sus últimos días con órdenes.</div>';
    }
    html += '<div class="dias-tabs">';
    estado.dias.forEach(function(d, i) {
      html += '<div class="dia-tab' + (i === estado.activo ? ' active' : '') + '" onclick="cambiarDiaGestionMoto(' + i + ')">' +
        _fechaDisplayM(d.fecha) + (_gmEnviado(estado.id, d.fecha) ? ' <i class="ti ti-circle-check" style="color:var(--color-green)"></i>' : '') + '</div>';
    });
    html += '</div><div id="gm-dia"></div>';
  }

  det.innerHTML = html;
  if (estado.modo === 'dias' && estado.dias.length) _gmPintarDia();
  else if (estado.modo === 'periodo') _gmPintarOrdenes(estado.desde, estado.hasta, 'gm-periodo-ordenes');
}

/* Cuadros + resumen de un día o de un período (mismos datos de armarDiaMoto) */
function _gmCuadrosHTML(rs, t, titulo) {
  var neto = parseFloat(t.neto) || 0;
  var colorNeto = _colorDeudaMoto(neto);
  return '<div class="moto-kpis">' +
      _kpiCard('Órdenes', rs.pedidos || 0, 'blue', 'ti-package') +
      _kpiCard('Entregados', rs.entregados || 0, 'green', 'ti-circle-check') +
      _kpiCard('No entregados', rs.no_entregados || 0, 'red', 'ti-circle-x') +
      _kpiCard('Ausentes', rs.ausentes || 0, 'amber', 'ti-user-off') +
    '</div>' +
    '<div class="moto-kpis">' +
      _kpiCard('Efectivo', _gmSoles(t.efectivo), 'green', 'ti-cash') +
      _kpiCard('Yape', _gmSoles(t.yape), 'blue', 'ti-device-mobile') +
      _kpiCard('Su pago', _gmSoles(t.pago_moto), 'amber', 'ti-wallet') +
      _kpiCard('Deuda moto', (neto < 0 ? '− ' : '') + _gmSoles(Math.abs(neto)),
        neto > 0 ? 'green' : neto < 0 ? 'amber' : 'blue', 'ti-calculator') +
    '</div>' +
    '<div style="background:var(--color-bg-secondary);border-radius:var(--radius-lg);padding:16px 20px;margin-bottom:16px;' +
      'border-left:5px solid ' + colorNeto + ';display:flex;align-items:center;gap:14px">' +
      '<div style="background:' + colorNeto + ';border-radius:50%;width:38px;height:38px;display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
        '<i class="ti ti-calculator" style="color:#fff;font-size:17px"></i></div>' +
      '<div>' +
        '<div style="font-size:11px;color:var(--color-text-secondary);font-weight:500;margin-bottom:2px">' + titulo + '</div>' +
        '<div style="font-size:15px;font-weight:700;color:' + colorNeto + '">' + _textoDeudaMoto(neto) + '</div>' +
        '<div style="font-size:12px;color:var(--color-text-secondary);margin-top:2px">' +
          'Entrega a Velox: <strong>' + _gmSoles(t.a_entregar) + '</strong> (efectivo ' + _gmSoles(t.efectivo) +
          ' · Yape ' + _gmSoles(t.yape) + ') &nbsp;·&nbsp; Velox le paga: <strong>' + _gmSoles(t.pago_moto) + '</strong></div>' +
      '</div>' +
    '</div>';
}

/* El día de la pestaña activa: liquidado, reporte + WhatsApp, cuadros, órdenes */
function _gmPintarDia() {
  var cont = document.getElementById('gm-dia');
  var estado = _gmDet;
  if (!cont || !estado || !estado.dias.length) return;
  var d = estado.dias[estado.activo];
  var m = _gmMotoDet();

  var liq = '';
  if (d.liquidado) {
    liq = '<div style="background:var(--color-green-bg);color:var(--color-green-text);border-radius:var(--radius-md);padding:10px 14px;margin-bottom:14px;font-size:13px">' +
      '<i class="ti ti-circle-check"></i> Día liquidado el ' + _fechaDisplayM(d.liquidado.fecha_pago) +
      ' por ' + _gmSoles(d.liquidado.saldo_pagado) +
      (d.liquidado.difiere ? ' · <strong style="color:var(--color-amber-text)">difiere de lo que dan hoy los pedidos</strong>' : '') +
    '</div>';
  }

  cont.innerHTML =
    /* El mismo reporte que Caja → Motorizados (generarlo acá o allá pisa
       el mismo archivo; solo admin) y el WhatsApp con su marca */
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px">' +
      (typeof botonesReporteMotoHTML === 'function' ? botonesReporteMotoHTML(estado.id, d.fecha) : '') +
      _gmBotonWA(m, d.fecha, true) +
    '</div>' +
    liq +
    _gmCuadrosHTML(d.resumen || {}, d.totales || {}, 'RESUMEN DEL ' + _fechaDisplayM(d.fecha).toUpperCase()) +
    '<div id="gm-dia-ordenes"><div style="padding:16px;color:var(--color-text-tertiary);font-size:12px">Cargando órdenes…</div></div>';
  _gmPintarOrdenes(d.fecha, null, 'gm-dia-ordenes');
}

function _gmBloquePeriodoHTML(estado) {
  var p = estado.periodo || {};
  var desc = estado.desde === estado.hasta ? _fechaDisplayM(estado.desde)
    : _fechaDisplayM(estado.desde) + ' al ' + _fechaDisplayM(estado.hasta);
  if (!estado.dias.length) {
    return '<div style="padding:40px;text-align:center;color:var(--color-text-tertiary)">Sin órdenes del ' + desc + '.</div>';
  }
  var liq = p.dias_liquidados
    ? '<div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:10px"><i class="ti ti-circle-check" style="color:var(--color-green)"></i> ' +
        p.dias_liquidados + ' de ' + p.dias + ' días liquidados' + (p.difiere ? ' · <strong style="color:var(--color-amber-text)">alguno difiere de lo pagado</strong>' : '') + '</div>'
    : '';
  return '<div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:10px">' +
      '<i class="ti ti-info-circle"></i> ' + desc + ' · ' + p.dias + (p.dias === 1 ? ' día' : ' días') + ' con órdenes. ' +
      'El reporte y el WhatsApp son de un día: tocá "Últimos 7 días".</div>' +
    liq +
    _gmCuadrosHTML(p.resumen || {}, p.totales || {}, 'RESUMEN DEL PERÍODO') +
    '<div id="gm-periodo-ordenes"><div style="padding:16px;color:var(--color-text-tertiary);font-size:12px">Cargando órdenes…</div></div>';
}

/* La tabla de órdenes (la del panel de Motorizados: Actualizar, Reasignar) */
async function _gmPintarOrdenes(desde, hasta, idCont) {
  var estado = _gmDet;
  var url = API + '/motorizados/' + estado.id + '/ordenes?' + (hasta ? 'desde=' + desde + '&hasta=' + hasta : 'fecha=' + desde);
  var ordenes = [];
  try {
    var r = await Promise.all([
      fetch(url),
      /* Qué órdenes esperan que otro moto las acepte (js/reasignaciones.js) */
      typeof cargarReasignacionesPanel === 'function' ? cargarReasignacionesPanel(estado.id) : null,
    ]);
    ordenes = r[0].ok ? await r[0].json() : [];
  } catch (err) { ordenes = []; }
  var cont = document.getElementById(idCont);
  if (!cont || _gmDet !== estado) return;
  cont.innerHTML = ordenes.length
    ? '<div class="card"><div class="card-head"><span class="card-title">Órdenes</span>' +
        '<span style="font-size:12px;color:var(--color-text-secondary)">' + ordenes.length + ' registros</span></div>' +
        '<div style="padding:0 16px 16px">' + _renderTablaOrdenesDetalle(ordenes) + '</div></div>'
    : '<div style="padding:24px;text-align:center;color:var(--color-text-tertiary)">Sin órdenes.</div>';
}

window.cambiarDiaGestionMoto = function(idx) {
  if (!_gmDet || !_gmDet.dias || !_gmDet.dias[idx]) return;
  _gmDet.activo = idx;
  document.querySelectorAll('#gm-vista-detalle .dia-tab').forEach(function(t, i) { t.classList.toggle('active', i === idx); });
  _gmPintarDia();
};

window.diasGestionMoto = function() {
  if (!_gmDet) return;
  var base = _gmDet.modo === 'dias' ? _gmDet.base : (_gmDiaUnico() || _gmHoyLima(0));
  _gmDet = { id: _gmDet.id, modo: 'dias', base: base };
  _gmPintarDetalle(false);
};

window.periodoGestionMoto = function(tipo) {
  if (!_gmDet) return;
  var r;
  if (tipo === 'rango') {
    var d = (document.getElementById('gm-det-desde') || {}).value || '';
    var h = (document.getElementById('gm-det-hasta') || {}).value || '';
    if (d && !h) h = d;
    if (h && !d) d = h;
    if (!d) return;
    if (d > h) { var x = d; d = h; h = x; }
    r = { desde: d, hasta: h };
  } else {
    r = _gmRangoRapido(tipo);
  }
  if (!r) return;
  _gmDet = { id: _gmDet.id, modo: 'periodo', desde: r.desde, hasta: r.hasta, tipo: tipo };
  _gmPintarDetalle(false);
};

window.volverListaGestionMotos = function() {
  _gmDet = null;
  var det = document.getElementById('gm-vista-detalle');
  if (det) det.innerHTML = '';
  _gmVista('lista');
  var tbody = document.getElementById('tbody-gestion-motos');
  if (tbody) tbody.dataset.firma = '';
  _gmCargarLista();
};

/* Desde la tarjeta de un moto en la página Motorizados ("Ver detalle"):
   abre esta página ya en ese moto, en el día de hoy */
window.abrirGestionMoto = function(idMoto) {
  _gmAbrirAlIniciar = idMoto;
  showPage('gestion-motos');
};

/* Después de guardar una orden ("Actualizar") o de un cambio de
   reasignación: el detalle abierto (en su pestaña) o la lista */
function refrescarGestionMotos() {
  if (!document.getElementById('gm-vista-detalle')) return;
  if (_gmDet) _gmPintarDetalle(true);
  else _gmCargarLista();
}
window.addEventListener('velox:reasignaciones', refrescarGestionMotos);

/* ════════════════════════════════════════════
   INIT
════════════════════════════════════════════ */
window.initGestionMotos = function() {
  _gmDet = null;
  _gmChip = '';
  /* Arranca en hoy (como Clientes la primera vez); al volver a la
     página se conserva el período que se había elegido */
  if (!_gmDesde && _gmTipo === 'hoy') _gmPonerPeriodo(_gmHoyLima(0), _gmHoyLima(0), 'hoy');
  else _gmPonerPeriodo(_gmDesde, _gmHasta, _gmTipo);
  var abrir = _gmAbrirAlIniciar;
  _gmAbrirAlIniciar = null;
  if (abrir) {
    _gmDet = { id: abrir, modo: 'dias', base: _gmHoyLima(0) };
    _gmVista('detalle');
    _gmPintarDetalle(false);
    _gmCargarLista(); /* la deja lista para "Volver" */
  } else {
    _gmCargarLista();
  }
  /* La lista se refresca sola; el detalle no (consultaría R2 por los
     botones del reporte en cada vuelta): se repinta al guardar */
  iniciarRefrescoAutomatico('tbody-gestion-motos', function() {
    if (!_gmDet) return _gmCargarLista();
  });
};
