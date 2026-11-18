/* ============================================================
   notificaciones.js — Botón "Notificaciones" del menú (admin y
   operador): contador rojo + panel "Para revisar".
   · No entregado                  → ícono ✕ en rojo
   · Entregado con Pago tienda     → ícono de tienda en ámbar
   · Reasignación aceptada (info)  → ícono de moto en verde
   "Abrir" lleva a Todos los pedidos con esa orden abierta en
   "Actualizar orden", sin marcar nada. El aviso queda revisado PARA
   TODOS recién cuando alguien GUARDA esa orden en "Actualizar orden"
   (desde el aviso o desde cualquier otro lado); cerrar sin guardar lo
   deja en la campana.
   El servidor esconde solo los que ya no aplican (la orden cambió).
   Contador: cada 20 s mientras la pestaña está a la vista.

   El MOTORIZADO tiene el mismo botón, siempre visible (aunque esté en
   0), con SUS avisos, que salen de GET /reasignaciones/mias
   (js/reasignaciones.js, panelNotificacionesMotoHTML): pedidos que le
   llegaron para aceptar (No / Sí, la acepto) y las respuestas a lo que
   él mandó ("X aceptó" / "X no aceptó", con "Entendido"). El contador
   se repinta cada vez que se leen (también con el refresco de 8 s de
   "Mis entregas de hoy", evento velox:reasignaciones-leidas).
   ============================================================ */

var _AVISOS_REFRESCO_MS = 20000;
var _avisosTimer = null;
var _avisosLista = [];
var _avisosTotal = 0;

function _avisosEsGestor() {
  var s = typeof _obtenerSesion === 'function' ? _obtenerSesion() : null;
  return !!s && (s.rol === 'admin' || s.rol === 'operador');
}

function _avisosEsMoto() {
  var s = typeof _obtenerSesion === 'function' ? _obtenerSesion() : null;
  return !!s && s.rol === 'motorizado';
}

function _escAvisos(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* 'YYYY-MM-DD HH:mm:ss' → 'dd/mm HH:mm' */
function _fechaAviso(s) {
  if (!s) return '';
  var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?/);
  if (!m) return s;
  return m[3] + '/' + m[2] + (m[4] ? ' ' + m[4] + ':' + m[5] : '');
}

/* ── Contador ─────────────────────────────────────────────── */

function _pintarContadorAvisos(total) {
  _avisosTotal = total;
  var c = document.getElementById('nav-notif-contador');
  if (c) {
    c.textContent = total > 99 ? '99+' : String(total);
    c.style.display = total > 0 ? '' : 'none';
  }
  /* En el celular el menú está escondido: un punto rojo en la hamburguesa */
  var h = document.getElementById('hamburger-btn');
  if (h) h.classList.toggle('con-avisos', total > 0);
}

/* forzar: después de una acción del usuario (guardar), aunque la
   pestaña figure escondida; el sondeo de 20 s no lee si no se ve */
async function _refrescarContadorAvisos(forzar) {
  if (document.hidden && forzar !== true) return;
  if (_avisosEsMoto()) {
    /* Al terminar dispara velox:reasignaciones-leidas → _pintarAvisosMoto */
    if (typeof cargarReasignacionesMias === 'function') cargarReasignacionesMias();
    return;
  }
  try {
    var r = await fetch(API + '/notificaciones/total');
    if (!r.ok) return;
    var d = await r.json();
    _pintarContadorAvisos(d.total || 0);
    /* Con el panel abierto, la lista también se mantiene al día */
    var panel = document.getElementById('notif-panel');
    if (panel && panel.style.display !== 'none') _cargarAvisos(false);
  } catch (e) { /* sin señal: se reintenta en el próximo ciclo */ }
}

/* ── Panel ────────────────────────────────────────────────── */

window.togglePanelNotificaciones = function() {
  var panel = document.getElementById('notif-panel');
  if (!panel) return;
  if (panel.style.display !== 'none') { cerrarPanelNotificaciones(); return; }
  panel.style.display = 'flex';
  document.getElementById('notif-capa').style.display = 'block';
  document.addEventListener('keydown', _escPanelAvisos);
  if (_avisosEsMoto()) {
    _pintarAvisosMoto();          /* lo último que se leyó, al instante */
    _refrescarContadorAvisos();   /* y lo fresco cuando llegue */
    return;
  }
  _cargarAvisos(true);
};

/* Contador y (si está abierto) panel del moto, con lo que ya leyó
   js/reasignaciones.js: no va al servidor */
function _pintarAvisosMoto() {
  if (typeof totalNotificacionesMoto !== 'function') return;
  _pintarContadorAvisos(totalNotificacionesMoto());
  var panel = document.getElementById('notif-panel');
  if (!panel || panel.style.display === 'none') return;
  var html = _cabezaPanelAvisos('Notificaciones', totalNotificacionesMoto()) +
    '<div class="notif-panel-lista">' + panelNotificacionesMotoHTML() + '</div>';
  if (panel._ultimoHtml === html) return;
  panel._ultimoHtml = html;
  panel.innerHTML = html;
}

function _cabezaPanelAvisos(titulo, n) {
  return '<div class="notif-panel-head">' +
      '<span><i class="ti ti-bell"></i> ' + titulo +
        (n ? ' <span class="nav-contador">' + n + '</span>' : '') +
      '</span>' +
      '<button type="button" class="btn btn-sm" onclick="cerrarPanelNotificaciones()" aria-label="Cerrar"><i class="ti ti-x"></i></button>' +
    '</div>';
}

window.cerrarPanelNotificaciones = function() {
  var panel = document.getElementById('notif-panel');
  if (panel) panel.style.display = 'none';
  var capa = document.getElementById('notif-capa');
  if (capa) capa.style.display = 'none';
  document.removeEventListener('keydown', _escPanelAvisos);
};

function _escPanelAvisos(e) {
  if (e.key === 'Escape') cerrarPanelNotificaciones();
}

async function _cargarAvisos(inicial) {
  var panel = document.getElementById('notif-panel');
  if (!panel) return;
  if (inicial) _pintarPanelAvisos(null);
  try {
    var r = await fetch(API + '/notificaciones');
    if (!r.ok) throw new Error();
    _avisosLista = await r.json();
    _pintarContadorAvisos(_avisosLista.length);
    _pintarPanelAvisos(_avisosLista);
  } catch (e) {
    if (inicial) _pintarPanelAvisos('error');
  }
}

var _AVISO_TIPOS = {
  no_entregado: { clase: 'aviso-rojo',  icono: 'ti-x',              titulo: 'No entregado' },
  pago_tienda:  { clase: 'aviso-ambar', icono: 'ti-building-store', titulo: 'Pago tienda' },
  reasignacion: { clase: 'aviso-verde', icono: 'ti-motorbike',      titulo: 'Reasignación' },
  observacion:  { clase: 'aviso-azul',  icono: 'ti-message-2',      titulo: 'Observación' },
};

/* Extracto de una nota larga: corta en una palabra y agrega "…" */
function _recortarAviso(texto, max) {
  texto = String(texto || '');
  if (texto.length <= max) return texto;
  var corte = texto.lastIndexOf(' ', max);
  return texto.slice(0, corte > max * 0.6 ? corte : max) + '…';
}

function _avisoHTML(a) {
  var t = _AVISO_TIPOS[a.tipo] || { clase: '', icono: 'ti-bell', titulo: a.tipo };
  var cliente = a.dest_nombre ? _escAvisos(a.dest_nombre) : 'Sin nombre';
  var principal, detalle, extracto = '';
  if (a.tipo === 'observacion') {
    /* "ALEX agregó una observación · #C-1095 · Berth A" y abajo la última
       nota (el aviso es uno por orden y guarda la última: autor, detalle) */
    principal = '<strong>' + _escAvisos(a.autor || a.motorizado || 'El motorizado') + '</strong> agregó una observación · #' +
                _escAvisos(a.codigo) + ' · <strong>' + cliente + '</strong>';
    if (a.detalle) extracto = '<span class="aviso-extracto">“' + _escAvisos(_recortarAviso(a.detalle, 140)) + '”</span>';
    detalle = [_escAvisos(a.distrito)];
  } else if (a.tipo === 'reasignacion') {
    principal = '<strong>' + _escAvisos(a.moto_de || '—') + '</strong> pasó #' + _escAvisos(a.codigo) +
                ' a <strong>' + _escAvisos(a.moto_para || '—') + '</strong>';
    detalle = [cliente, _escAvisos(a.distrito)];
  } else {
    principal = t.titulo + ' · <strong>' + cliente + '</strong>';
    detalle = ['#' + _escAvisos(a.codigo), _escAvisos(a.distrito)];
    if (a.metodo_pago === 'contraentrega') detalle.push('<span class="aviso-nowrap">S/ ' + (parseFloat(a.monto_cobrado) || 0).toFixed(2) + '</span>');
    if (a.motorizado) detalle.push('<span class="aviso-nowrap"><i class="ti ti-motorbike"></i> ' + _escAvisos(a.motorizado) + '</span>');
  }
  detalle.push('<span class="aviso-nowrap">' + _fechaAviso(a.creada_en) + '</span>');
  return '<button type="button" class="aviso-item" onclick="abrirAviso(' + a.id + ')">' +
      '<span class="aviso-icono ' + t.clase + '"><i class="ti ' + t.icono + '"></i></span>' +
      '<span class="aviso-texto">' +
        '<span class="aviso-principal">' + principal + '</span>' +
        extracto +
        '<span class="aviso-detalle">' + detalle.filter(Boolean).join(' · ') + '</span>' +
      '</span>' +
      '<span class="aviso-abrir">Abrir <i class="ti ti-chevron-right"></i></span>' +
    '</button>';
}

function _pintarPanelAvisos(lista) {
  var panel = document.getElementById('notif-panel');
  if (!panel) return;
  var cuerpo;
  if (lista === null) cuerpo = '<div class="aviso-vacio"><i class="ti ti-loader"></i> Cargando…</div>';
  else if (lista === 'error') cuerpo = '<div class="aviso-vacio" style="color:var(--color-red-text)">No se pudieron cargar los avisos.</div>';
  else if (!lista.length) cuerpo = '<div class="aviso-vacio"><i class="ti ti-circle-check"></i> No hay nada para revisar.</div>';
  else cuerpo = lista.map(_avisoHTML).join('');

  var html = _cabezaPanelAvisos('Para revisar', Array.isArray(lista) ? lista.length : 0) +
    '<div class="notif-panel-lista">' + cuerpo + '</div>';
  /* El refresco no repinta si nada cambió (no se pierde el scroll) */
  if (panel._ultimoHtml === html) return;
  panel._ultimoHtml = html;
  panel.innerHTML = html;
}

/* "Abrir": solo lleva a la orden. El aviso NO se marca acá: sigue en la
   campana hasta que alguien guarda "Actualizar orden" de esa orden
   (marcarAvisosOrdenRevisados, abajo). Cerrar sin guardar lo deja. */
window.abrirAviso = async function(idAviso) {
  try {
    var r = await fetch(API + '/notificaciones/' + idAviso);
    var d = await r.json().catch(function() { return {}; });
    if (!r.ok) throw new Error(d.error || 'No se pudo abrir el aviso');

    cerrarPanelNotificaciones();
    if (d.yaRevisada) {
      /* El panel tenía hasta 20 s de atraso: otro ya guardó la orden */
      _avisosLista = _avisosLista.filter(function(a) { return a.id !== idAviso; });
      _pintarContadorAvisos(_avisosLista.length);
      _pintarPanelAvisos(_avisosLista);
      if (typeof showNotif === 'function') {
        showNotif((d.revisadaPor ? d.revisadaPor : 'Otro usuario') + ' ya revisó este aviso', 4000);
      }
    }

    showPage('pedidos');
    if (typeof abrirActualizarEstadoOrden === 'function') abrirActualizarEstadoOrden(d.id_orden);
  } catch (err) {
    if (typeof showNotif === 'function') showNotif(err.message, 5000);
  }
};

/* Lo llama guardarActualizarEstadoOrden (js/motorizados.js) cuando los
   PATCH salieron bien, venga de donde venga el modal: guardar = revisada.
   Sin await del lado de quien guarda: si falla (sin señal), la orden ya
   quedó guardada y el aviso sigue en la campana para la próxima. */
window.marcarAvisosOrdenRevisados = async function(idOrden) {
  if (!idOrden || !_avisosEsGestor()) return;
  try {
    var r = await fetch(API + '/notificaciones/orden/' + idOrden + '/revisar', { method: 'POST' });
    if (!r.ok) return;
    var d = await r.json().catch(function() { return {}; });
    if (!d.marcadas) return;
    _avisosLista = _avisosLista.filter(function(a) { return String(a.id_orden) !== String(idOrden); });
    _refrescarContadorAvisos(true);
  } catch (e) { /* sin señal: el aviso queda, se revisa al guardar de nuevo */ }
};

/* ── Arranque ─────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function() {
  if (!_avisosEsGestor() && !_avisosEsMoto()) return;
  if (_avisosEsMoto()) {
    /* Cada lectura de /reasignaciones/mias (este botón, o el refresco de
       "Mis entregas de hoy") repinta contador y panel */
    window.addEventListener('velox:reasignaciones-leidas', _pintarAvisosMoto);
    /* Aceptó, rechazó, canceló o mandó algo: leer de nuevo */
    window.addEventListener('velox:reasignaciones', _refrescarContadorAvisos);
  }
  var nav = document.getElementById('nav-notificaciones');
  if (nav) nav.style.display = '';
  _refrescarContadorAvisos();
  _avisosTimer = setInterval(_refrescarContadorAvisos, _AVISOS_REFRESCO_MS);
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden) _refrescarContadorAvisos();
  });
});
