/* ============================================================
   gestion-motos.js — Página "Gestión / Motorizado"
   (pages/gestion-motos.html). La gemela de Clientes / Tiendas para
   los motorizados: "qué hicieron y cuánto" en UN día.

   · Lista: GET /api/caja/motorizados/gestion?fecha= → cada moto con
     órdenes ese día, con su resumen por estado y sus totales.
   · Detalle: GET /api/caja/motorizados/:id/reporte?fecha= → el MISMO
     JSON con el que se dibuja el reporte en imagen, así la pantalla y
     la imagen no pueden dar distinto. La tabla de órdenes es la del
     panel de Motorizados (_renderTablaOrdenesDetalle, con Actualizar y
     Reasignar), que lee o.caja de GET /motorizados/:id/ordenes.
   · Botones del reporte: los mismos de Caja → Motorizados
     (botonesReporteMotoHTML): misma URL, mismo archivo. Solo admin.

   Nada se calcula acá: toda la plata viene de calcularOrdenCaja()
   (server/caja-motor.js), en el servidor. Acá solo se suma para la
   fila de totales (en céntimos) y se pinta.
   Admin y operador (el servidor lo exige igual: routes/caja.js).
   ============================================================ */

var _gmFecha       = '';    /* día que se ve (YYYY-MM-DD, Lima) */
var _gmMotoAbierto = null;  /* id del moto con el detalle abierto */
var _gmAbrirAlIniciar = null; /* lo deja abrirGestionMoto() antes de showPage */

function _gmHoyLima(diasAtras) {
  var d = new Date(Date.now() - (diasAtras || 0) * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(d);
}

function _gmEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _gmSoles(v) {
  return 'S/ ' + (parseFloat(v) || 0).toFixed(2);
}

/* Montos chicos en gris si son 0, como en la Caja */
function _gmMonto(v) {
  return (parseFloat(v) || 0) === 0
    ? '<span style="color:var(--color-text-tertiary)">S/ 0.00</span>'
    : '<span style="font-weight:600;white-space:nowrap">' + _gmSoles(v) + '</span>';
}

function _gmChipDia(liquidado) {
  if (!liquidado) return '<span class="badge pendiente">Pendiente</span>';
  return '<span class="badge entregado">Liquidado</span>' +
    (liquidado.difiere ? '<div style="font-size:10px;color:var(--color-amber-text);white-space:nowrap">difiere de lo pagado</div>' : '');
}

/* ════════════════════════════════════════════
   LISTA
════════════════════════════════════════════ */
async function _gmCargarLista() {
  var tbody = document.getElementById('tbody-gestion-motos');
  if (!tbody) return;
  var lbl = document.getElementById('lbl-fecha-gm');
  if (lbl) lbl.textContent = 'Mostrando: ' + _fechaDisplayM(_gmFecha);

  var datos;
  try {
    var r = await fetch(API + '/caja/motorizados/gestion?fecha=' + _gmFecha);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    datos = await r.json();
  } catch (err) {
    console.error('Gestión / Motorizado:', err);
    if (!tbody.dataset.firma) {
      tbody.innerHTML = '<tr><td colspan="11" style="padding:24px;color:var(--color-red-text)">No se pudo cargar la gestión del día.</td></tr>';
    }
    return;
  }
  if (datos.fecha !== _gmFecha) return; /* se cambió de día mientras cargaba */

  var motos = datos.motorizados || [];
  var c = function(v) { return Math.round((parseFloat(v) || 0) * 100); };
  var tot = { ordenes: 0, ent: 0, noEnt: 0, aus: 0, efectivo: 0, yape: 0, pago: 0, neto: 0 };

  var filas = motos.map(function(m) {
    var r = m.resumen || {}, t = m.totales || {};
    tot.ordenes += r.pedidos || 0; tot.ent += r.entregados || 0;
    tot.noEnt += r.no_entregados || 0; tot.aus += r.ausentes || 0;
    tot.efectivo += c(t.efectivo); tot.yape += c(t.yape); tot.pago += c(t.pago_moto); tot.neto += c(t.neto);
    return '<tr>' +
      '<td><div class="moto-resumen-nombre" title="' + _gmEsc(m.nombre) + '">' +
        '<div class="avatar ' + _gmEsc(m.color_avatar) + '" style="width:30px;height:30px;font-size:11px;flex-shrink:0">' + _gmEsc(m.iniciales) + '</div>' +
        '<strong>' + _gmEsc(m.nombre) + '</strong></div></td>' +
      '<td><strong>' + (r.pedidos || 0) + '</strong></td>' +
      '<td style="color:var(--color-green);font-weight:600">' + (r.entregados || 0) + '</td>' +
      '<td style="color:var(--color-red-text);font-weight:600">' + (r.no_entregados || 0) + '</td>' +
      '<td style="color:var(--color-amber-text);font-weight:600">' + (r.ausentes || 0) + '</td>' +
      '<td>' + _gmMonto(t.efectivo) + '</td>' +
      '<td>' + _gmMonto(t.yape) + '</td>' +
      '<td>' + _gmMonto(t.pago_moto) + '</td>' +
      '<td>' + _deudaMotoHTML(t.neto) + '</td>' +
      '<td>' + _gmChipDia(m.liquidado) + '</td>' +
      '<td><button class="btn btn-primary btn-sm" onclick="abrirDetalleGestionMoto(' + Number(m.id) + ')">' +
        '<i class="ti ti-eye"></i> Ver detalle</button></td>' +
    '</tr>';
  });

  var html = filas.length
    ? filas.join('') +
      '<tr style="background:var(--color-bg-secondary);font-weight:700">' +
        /* La celda fija lleva su propio fondo (la regla de PRIMERA
           COLUMNA FIJA de responsive.css le pone blanco) */
        '<td style="background:var(--color-bg-secondary)">TOTALES</td><td>' + tot.ordenes + '</td><td>' + tot.ent + '</td><td>' + tot.noEnt + '</td><td>' + tot.aus + '</td>' +
        '<td>' + _gmSoles(tot.efectivo / 100) + '</td><td>' + _gmSoles(tot.yape / 100) + '</td>' +
        '<td>' + _gmSoles(tot.pago / 100) + '</td><td>' + _deudaMotoHTML(tot.neto / 100) + '</td><td></td><td></td>' +
      '</tr>'
    : '<tr><td colspan="11" style="padding:24px;text-align:center;color:var(--color-text-tertiary)">' +
        'Ningún motorizado tuvo órdenes el ' + _fechaDisplayM(_gmFecha) + '.</td></tr>';

  /* El refresco de 8 s no repinta si nada cambió (no se pierde el scroll) */
  if (tbody.dataset.firma === html) return;
  tbody.dataset.firma = html;
  tbody.innerHTML = html;
}

function _gmMarcarBoton(tipo) {
  var hoy = document.getElementById('btn-hoy-gm');
  var ayer = document.getElementById('btn-ayer-gm');
  if (hoy)  hoy.classList.toggle('active', tipo === 'hoy');
  if (ayer) ayer.classList.toggle('active', tipo === 'ayer');
}

function _gmPonerFecha(fecha, tipo) {
  _gmFecha = fecha;
  var inp = document.getElementById('filtro-fecha-gm');
  if (inp) inp.value = fecha;
  _gmMarcarBoton(tipo || (fecha === _gmHoyLima(0) ? 'hoy' : fecha === _gmHoyLima(1) ? 'ayer' : null));
}

window.filtroRapidoGestionMotos = function(tipo) {
  _gmPonerFecha(_gmHoyLima(tipo === 'ayer' ? 1 : 0), tipo);
  _gmCargarLista();
};

window.aplicarFiltroGestionMotos = function() {
  var inp = document.getElementById('filtro-fecha-gm');
  /* Es de UN día: vacío vuelve a hoy */
  _gmPonerFecha(inp && inp.value ? inp.value : _gmHoyLima(0));
  _gmCargarLista();
};

/* ════════════════════════════════════════════
   DETALLE DE UN MOTORIZADO (ese día)
════════════════════════════════════════════ */
function _gmVista(cual) {
  var lista = document.getElementById('gm-vista-lista');
  var det = document.getElementById('gm-vista-detalle');
  if (lista) lista.style.display = cual === 'lista' ? '' : 'none';
  if (det)   det.style.display   = cual === 'detalle' ? '' : 'none';
}

window.abrirDetalleGestionMoto = async function(idMoto, sinScroll) {
  var det = document.getElementById('gm-vista-detalle');
  if (!det) return;
  _gmMotoAbierto = idMoto;
  var fecha = _gmFecha;
  _gmVista('detalle');
  if (!sinScroll) {
    det.innerHTML = '<div style="padding:40px;text-align:center;color:var(--color-text-secondary)"><i class="ti ti-loader" style="font-size:28px"></i> Cargando...</div>';
    window.scrollTo(0, 0);
  }

  var dia, ordenes;
  try {
    var resp = await Promise.all([
      fetch(API + '/caja/motorizados/' + idMoto + '/reporte?fecha=' + fecha),
      fetch(API + '/motorizados/' + idMoto + '/ordenes?fecha=' + fecha),
      MOTORIZADOS.length ? null : _cargarMotorizados(),
      /* Qué órdenes esperan que otro moto las acepte: la tabla muestra
         "Esperando a …" (js/reasignaciones.js) */
      typeof cargarReasignacionesPanel === 'function' ? cargarReasignacionesPanel(idMoto) : null,
    ]);
    if (!resp[0].ok) throw new Error('HTTP ' + resp[0].status);
    dia = await resp[0].json();
    ordenes = resp[1].ok ? await resp[1].json() : [];
  } catch (err) {
    console.error('Detalle Gestión / Motorizado:', err);
    det.innerHTML = '<div style="padding:24px"><button class="btn-back" onclick="volverListaGestionMotos()"><i class="ti ti-arrow-left"></i> Volver</button>' +
      '<div style="margin-top:16px;color:var(--color-red-text)">No se pudo cargar el detalle.</div></div>';
    return;
  }
  /* Se abrió otro moto, se volvió a la lista o cambió el día mientras cargaba */
  if (_gmMotoAbierto != idMoto || fecha !== _gmFecha) return;

  var m = MOTORIZADOS.find(function(x) { return x.id == idMoto; }) ||
          { nombre: dia.motorizado.nombre, iniciales: '', color_avatar: 'av-blue' };
  var r = dia.resumen || {}, t = dia.totales || {};
  var neto = parseFloat(t.neto) || 0;
  var colorNeto = _colorDeudaMoto(neto);

  var liq = '';
  if (dia.liquidado) {
    liq = '<div style="background:var(--color-green-bg);color:var(--color-green-text);border-radius:var(--radius-md);padding:10px 14px;margin-bottom:14px;font-size:13px">' +
      '<i class="ti ti-circle-check"></i> Día liquidado el ' + _fechaDisplayM(dia.liquidado.fecha_pago) +
      ' por ' + _gmSoles(dia.liquidado.saldo_pagado) +
      (dia.liquidado.difiere ? ' · <strong style="color:var(--color-amber-text)">difiere de lo que dan hoy los pedidos</strong>' : '') +
    '</div>';
  }

  var html =
    '<div class="detalle-header">' +
      '<div class="detalle-header-left">' +
        '<button class="btn-back" onclick="volverListaGestionMotos()"><i class="ti ti-arrow-left"></i> Volver</button>' +
        '<div style="display:flex;align-items:center;gap:12px">' +
          '<div class="avatar ' + _gmEsc(m.color_avatar) + '" style="width:44px;height:44px;font-size:16px;flex-shrink:0">' + _gmEsc(m.iniciales) + '</div>' +
          '<div><div class="detalle-nombre">' + _gmEsc(m.nombre) + '</div>' +
            '<div class="detalle-meta"><span><i class="ti ti-calendar"></i> ' + _fechaDisplayM(fecha) + '</span></div></div>' +
        '</div>' +
      '</div>' +
      /* El mismo reporte que Caja → Motorizados: generarlo acá o allá
         pisa el mismo archivo. Solo admin (si no, no pinta nada). */
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
        (typeof botonesReporteMotoHTML === 'function' ? botonesReporteMotoHTML(idMoto, fecha) : '') +
      '</div>' +
    '</div>' +
    liq +
    '<div class="moto-kpis">' +
      _kpiCard('Órdenes', r.pedidos || 0, 'blue', 'ti-package') +
      _kpiCard('Entregados', r.entregados || 0, 'green', 'ti-circle-check') +
      _kpiCard('No entregados', r.no_entregados || 0, 'red', 'ti-circle-x') +
      _kpiCard('Ausentes', r.ausentes || 0, 'amber', 'ti-user-off') +
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
        '<div style="font-size:11px;color:var(--color-text-secondary);font-weight:500;margin-bottom:2px">RESUMEN DEL DÍA</div>' +
        '<div style="font-size:15px;font-weight:700;color:' + colorNeto + '">' + _textoDeudaMoto(neto) + '</div>' +
        '<div style="font-size:12px;color:var(--color-text-secondary);margin-top:2px">' +
          'Entrega a Velox: <strong>' + _gmSoles(t.a_entregar) + '</strong> (efectivo ' + _gmSoles(t.efectivo) +
          ' · Yape ' + _gmSoles(t.yape) + ') &nbsp;·&nbsp; Velox le paga: <strong>' + _gmSoles(t.pago_moto) + '</strong></div>' +
      '</div>' +
    '</div>' +
    (ordenes.length
      ? '<div class="card"><div class="card-head"><span class="card-title">Órdenes del ' + _fechaDisplayM(fecha) + '</span>' +
          '<span style="font-size:12px;color:var(--color-text-secondary)">' + ordenes.length + ' registros</span></div>' +
          '<div style="padding:0 16px 16px">' + _renderTablaOrdenesDetalle(ordenes) + '</div></div>'
      : '<div style="padding:40px;text-align:center;color:var(--color-text-tertiary)">Sin órdenes ese día.</div>');

  det.innerHTML = html;
};

window.volverListaGestionMotos = function() {
  _gmMotoAbierto = null;
  var det = document.getElementById('gm-vista-detalle');
  if (det) det.innerHTML = '';
  _gmVista('lista');
  _gmCargarLista();
};

/* Desde la tarjeta de un moto en la página Motorizados ("Ver detalle"):
   abre esta página ya en ese moto, en el día de hoy */
window.abrirGestionMoto = function(idMoto) {
  _gmAbrirAlIniciar = idMoto;
  showPage('gestion-motos');
};

/* Después de guardar una orden ("Actualizar") o de un cambio de
   reasignación: el detalle abierto (o la lista) se vuelve a pintar */
function refrescarGestionMotos() {
  if (!document.getElementById('gm-vista-detalle')) return;
  if (_gmMotoAbierto) abrirDetalleGestionMoto(_gmMotoAbierto, true);
  else _gmCargarLista();
}
window.addEventListener('velox:reasignaciones', refrescarGestionMotos);

/* ════════════════════════════════════════════
   INIT
════════════════════════════════════════════ */
window.initGestionMotos = function() {
  _gmMotoAbierto = null;
  _gmPonerFecha(_gmHoyLima(0), 'hoy');
  var abrir = _gmAbrirAlIniciar;
  _gmAbrirAlIniciar = null;
  if (abrir) abrirDetalleGestionMoto(abrir);
  else _gmCargarLista();
  /* La lista se refresca sola; el detalle no (consultaría R2 por los
     botones del reporte en cada vuelta): se repinta al guardar */
  iniciarRefrescoAutomatico('tbody-gestion-motos', function() {
    if (!_gmMotoAbierto) return _gmCargarLista();
  });
};
