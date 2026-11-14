/* ============================================================
   notificaciones.js — Botón "Notificaciones" del menú (admin y
   operador): contador rojo + panel "Para revisar".
   · No entregado                  → ícono ✕ en rojo
   · Entregado con Pago tienda     → ícono de tienda en ámbar
   · Reasignación aceptada (info)  → ícono de moto en verde
   "Abrir" marca el aviso revisado PARA TODOS (POST /revisar) y lleva a
   Todos los pedidos con esa orden abierta en "Actualizar orden".
   El servidor esconde solo los que ya no aplican (la orden cambió).
   Contador: cada 20 s mientras la pestaña está a la vista.
   ============================================================ */

var _AVISOS_REFRESCO_MS = 20000;
var _avisosTimer = null;
var _avisosLista = [];
var _avisosTotal = 0;

function _avisosEsGestor() {
  var s = typeof _obtenerSesion === 'function' ? _obtenerSesion() : null;
  return !!s && (s.rol === 'admin' || s.rol === 'operador');
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

async function _refrescarContadorAvisos() {
  if (document.hidden) return;
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
  _cargarAvisos(true);
};

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
};

function _avisoHTML(a) {
  var t = _AVISO_TIPOS[a.tipo] || { clase: '', icono: 'ti-bell', titulo: a.tipo };
  var cliente = a.dest_nombre ? _escAvisos(a.dest_nombre) : 'Sin nombre';
  var principal, detalle;
  if (a.tipo === 'reasignacion') {
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

  var html =
    '<div class="notif-panel-head">' +
      '<span><i class="ti ti-bell"></i> Para revisar' +
        (Array.isArray(lista) && lista.length ? ' <span class="nav-contador">' + lista.length + '</span>' : '') +
      '</span>' +
      '<button type="button" class="btn btn-sm" onclick="cerrarPanelNotificaciones()" aria-label="Cerrar"><i class="ti ti-x"></i></button>' +
    '</div>' +
    '<div class="notif-panel-lista">' + cuerpo + '</div>';
  /* El refresco no repinta si nada cambió (no se pierde el scroll) */
  if (panel._ultimoHtml === html) return;
  panel._ultimoHtml = html;
  panel.innerHTML = html;
}

/* "Abrir": revisado para todos, y a la orden */
window.abrirAviso = async function(idAviso) {
  try {
    var r = await fetch(API + '/notificaciones/' + idAviso + '/revisar', { method: 'POST' });
    var d = await r.json().catch(function() { return {}; });
    if (!r.ok) throw new Error(d.error || 'No se pudo abrir el aviso');

    _avisosLista = _avisosLista.filter(function(a) { return a.id !== idAviso; });
    _pintarContadorAvisos(_avisosLista.length);
    _pintarPanelAvisos(_avisosLista);
    cerrarPanelNotificaciones();
    if (d.yaRevisada && typeof showNotif === 'function') showNotif('Otro usuario ya había abierto este aviso');

    showPage('pedidos');
    if (typeof abrirActualizarEstadoOrden === 'function') abrirActualizarEstadoOrden(d.id_orden);
  } catch (err) {
    if (typeof showNotif === 'function') showNotif(err.message, 5000);
  }
};

/* ── Arranque ─────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function() {
  if (!_avisosEsGestor()) return;
  var nav = document.getElementById('nav-notificaciones');
  if (nav) nav.style.display = '';
  _refrescarContadorAvisos();
  _avisosTimer = setInterval(_refrescarContadorAvisos, _AVISOS_REFRESCO_MS);
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden) _refrescarContadorAvisos();
  });
});
