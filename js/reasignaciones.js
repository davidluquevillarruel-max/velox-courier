/* ============================================================
   reasignaciones.js — Pasar una orden a otro motorizado, con
   aceptación (server/routes/reasignaciones.js).

   1. "Reasignar" (tarjeta de "Mis entregas de hoy" y tabla del panel
      del motorizado) abre la ventana: datos de la orden + motorizados
      activos con su avatar → "Enviar pedido".
   2. La orden SIGUE con el que la envía: borde punteado ámbar,
      "Esperando a <nombre>" y "Cancelar reasignación".
   3. Al destino le aparece arriba de "Mis entregas de hoy" una campana
      con contador y "<nombre> te quiere pasar una orden", con la foto
      del producto grande y "No" / "Sí, la acepto".
   4. Si nadie responde vence a medianoche (lo cierra el servidor).
   El estado del motorizado de la sesión se lee junto con su lista
   (js/entregas-moto.js, cada 8 s) con cargarReasignacionesMias().
   ============================================================ */

/* Lo del motorizado de la sesión (GET /reasignaciones/mias) */
var _rsgMias = { recibidas: [], enviadas: [], rechazadas: [] };
/* Lo enviado por el moto abierto en el panel de Motorizados, por orden */
var _rsgPanelPorOrden = {};
var _rsgOrdenPedido = null;   /* orden de la ventana "Reasignar" */
var _rsgElegido = null;       /* id del motorizado elegido */
var _rsgEnviando = false;

function _escRsg(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _montoRsg(o) {
  return o.metodo_pago === 'contraentrega'
    ? 'S/ ' + (parseFloat(o.monto_cobrado) || 0).toFixed(2)
    : 'Sin cobro';
}

/* ── Estado ───────────────────────────────────────────────── */

window.cargarReasignacionesMias = async function() {
  try {
    var r = await fetch(API + '/reasignaciones/mias');
    if (r.ok) _rsgMias = await r.json();
  } catch (e) { /* sin señal: queda lo último que se leyó */ }
  return _rsgMias;
};

window.cargarReasignacionesPanel = async function(idMoto) {
  _rsgPanelPorOrden = {};
  try {
    var r = await fetch(API + '/reasignaciones/motorizado/' + idMoto);
    if (!r.ok) return;
    var d = await r.json();
    d.enviadas.forEach(function(x) { _rsgPanelPorOrden[x.id_orden] = x; });
  } catch (e) { /* la tabla sale sin las marcas de espera */ }
};

/* La pendiente (o la rechazada sin ver) que mandó el moto de la sesión */
window.reasignacionDeOrden = function(idOrden) {
  return {
    enviada:   _rsgMias.enviadas.find(function(x) { return x.id_orden == idOrden; }) || null,
    rechazada: _rsgMias.rechazadas.find(function(x) { return x.id_orden == idOrden; }) || null,
  };
};

function _avisarCambioRsg() {
  window.dispatchEvent(new CustomEvent('velox:reasignaciones'));
}

/* ── Ventana "Reasignar" ──────────────────────────────────── */

function _modalRsg() {
  var m = document.getElementById('rsg-modal');
  if (m) return m;
  m = document.createElement('div');
  m.id = 'rsg-modal';
  m.className = 'rsg-modal';
  m.style.display = 'none';
  m.addEventListener('click', function(e) { if (e.target === m) cerrarPedirReasignacion(); });
  document.body.appendChild(m);
  return m;
}

window.abrirPedirReasignacion = async function(idOrden) {
  var modal = _modalRsg();
  _rsgOrdenPedido = null; _rsgElegido = null; _rsgEnviando = false;
  modal.innerHTML = '<div class="rsg-caja"><div class="rsg-cargando"><i class="ti ti-loader"></i> Cargando…</div></div>';
  modal.style.display = 'flex';
  try {
    var res = await Promise.all([fetch(API + '/ordenes/' + idOrden), fetch(API + '/motorizados')]);
    if (!res[0].ok) throw new Error('No se pudo cargar la orden');
    var orden = await res[0].json();
    var motos = res[1].ok ? await res[1].json() : [];
    _rsgOrdenPedido = orden;
    var otros = motos.filter(function(m) { return m.activo && m.nombre !== orden.motorizado; });
    _pintarModalRsg(orden, otros);
  } catch (err) {
    modal.innerHTML = '<div class="rsg-caja"><div class="rsg-cargando" style="color:var(--color-red-text)">' + _escRsg(err.message) + '</div>' +
      '<div class="rsg-pie"><button type="button" class="btn btn-sm" onclick="cerrarPedirReasignacion()">Cerrar</button></div></div>';
  }
};

function _pintarModalRsg(o, motos) {
  var lista = motos.length
    ? motos.map(function(m) {
        return '<button type="button" class="rsg-moto" data-id="' + m.id + '" onclick="elegirMotoReasignacion(' + m.id + ')">' +
          '<span class="avatar ' + _escRsg(m.color_avatar || 'av-blue') + ' rsg-avatar">' + _escRsg(m.iniciales || '?') + '</span>' +
          '<span class="rsg-moto-nombre">' + _escRsg(m.nombre) +
            (m.zona ? '<small>' + _escRsg(m.zona) + '</small>' : '') + '</span>' +
          '<i class="ti ti-circle-check rsg-check"></i>' +
        '</button>';
      }).join('')
    : '<div class="rsg-cargando">No hay otros motorizados activos.</div>';

  _modalRsg().innerHTML =
    '<div class="rsg-caja">' +
      '<div class="rsg-cabeza"><i class="ti ti-arrows-exchange"></i> Pasar orden a otro motorizado' +
        '<button type="button" class="btn btn-sm" onclick="cerrarPedirReasignacion()" aria-label="Cerrar"><i class="ti ti-x"></i></button></div>' +
      '<div class="rsg-orden">' +
        '<div class="rsg-orden-codigo">#' + _escRsg(o.codigo) + '</div>' +
        '<div class="rsg-orden-cliente">' + _escRsg(o.dest_nombre || 'Sin nombre') + '</div>' +
        '<div class="rsg-orden-datos"><i class="ti ti-map-pin"></i> ' + _escRsg(o.distrito) +
          ' &nbsp;·&nbsp; <i class="ti ti-cash"></i> ' + _montoRsg(o) + '</div>' +
      '</div>' +
      '<div class="rsg-subtitulo">¿A quién se la pasas?</div>' +
      '<div class="rsg-lista">' + lista + '</div>' +
      '<div class="rsg-nota"><i class="ti ti-info-circle"></i> La orden sigue siendo tuya hasta que el otro motorizado la acepte.</div>' +
      '<div class="entrega-error" id="rsg-error"></div>' +
      '<div class="rsg-pie">' +
        '<button type="button" class="btn btn-sm" onclick="cerrarPedirReasignacion()">Cancelar</button>' +
        '<button type="button" class="btn btn-primary btn-sm" id="rsg-enviar" disabled onclick="enviarPedidoReasignacion()">' +
          '<i class="ti ti-send"></i> Enviar pedido</button>' +
      '</div>' +
    '</div>';
}

window.elegirMotoReasignacion = function(idMoto) {
  _rsgElegido = idMoto;
  document.querySelectorAll('#rsg-modal .rsg-moto').forEach(function(b) {
    b.classList.toggle('elegido', b.dataset.id == idMoto);
  });
  var btn = document.getElementById('rsg-enviar');
  if (btn) btn.disabled = false;
};

window.cerrarPedirReasignacion = function() {
  var m = document.getElementById('rsg-modal');
  if (m) m.style.display = 'none';
  _rsgOrdenPedido = null; _rsgElegido = null;
};

window.enviarPedidoReasignacion = async function() {
  if (!_rsgOrdenPedido || !_rsgElegido || _rsgEnviando) return;
  _rsgEnviando = true;
  var btn = document.getElementById('rsg-enviar');
  if (btn) btn.disabled = true;
  var err = document.getElementById('rsg-error');
  try {
    var r = await fetch(API + '/reasignaciones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idOrden: _rsgOrdenPedido.id, idMotorizadoPara: _rsgElegido }),
    });
    var d = await r.json().catch(function() { return {}; });
    if (!r.ok) throw new Error(d.error || 'No se pudo enviar el pedido');
    cerrarPedirReasignacion();
    if (typeof showNotif === 'function') showNotif('Pedido enviado a ' + d.moto_para + '. Espera a que lo acepte.');
    _avisarCambioRsg();
  } catch (e) {
    if (err) { err.textContent = e.message; err.style.display = 'block'; }
    if (btn) btn.disabled = false;
  } finally {
    _rsgEnviando = false;
  }
};

/* ── Respuestas ───────────────────────────────────────────── */

async function _postRsg(ruta, okMsg) {
  try {
    var r = await fetch(API + '/reasignaciones/' + ruta, { method: 'POST' });
    var d = await r.json().catch(function() { return {}; });
    if (!r.ok) {
      if (typeof showNotif === 'function') showNotif(d.error || 'No se pudo completar', 6000);
    } else if (okMsg && typeof showNotif === 'function') {
      showNotif(typeof okMsg === 'function' ? okMsg(d) : okMsg);
    }
  } catch (e) {
    if (typeof showNotif === 'function') showNotif('Sin conexión: inténtalo de nuevo', 5000);
  }
  _avisarCambioRsg();
}

window.cancelarReasignacion = function(id) {
  if (!confirm('¿Cancelar el pedido? La orden sigue contigo.')) return;
  _postRsg(id + '/cancelar', 'Pedido cancelado: la orden sigue contigo');
};

window.aceptarReasignacion = function(id, boton) {
  if (boton) boton.disabled = true;
  _postRsg(id + '/aceptar', function(d) { return 'Ahora #' + d.codigo + ' es tuya: está arriba de tu lista'; });
};

window.rechazarReasignacion = function(id, boton) {
  if (boton) boton.disabled = true;
  _postRsg(id + '/rechazar', 'Rechazaste la orden: sigue con el otro motorizado');
};

window.vistoRechazoReasignacion = function(id) {
  _rsgMias.rechazadas = _rsgMias.rechazadas.filter(function(x) { return x.id !== id; });
  _postRsg(id + '/visto', null);
};

/* ── Piezas de HTML ───────────────────────────────────────── */

/* Campana + pedidos recibidos, arriba de "Mis entregas de hoy" */
window.recibidasReasignacionHTML = function() {
  var rec = _rsgMias.recibidas || [];
  if (!rec.length) return '';
  return '<div class="rsg-recibidas">' +
    '<div class="rsg-recibidas-head"><span class="rsg-campana"><i class="ti ti-bell-ringing"></i>' +
      '<span class="nav-contador">' + rec.length + '</span></span>' +
      (rec.length === 1 ? 'Te quieren pasar una orden' : 'Te quieren pasar ' + rec.length + ' órdenes') + '</div>' +
    rec.map(function(x) {
      var foto = x.foto_producto_url
        ? '<img class="rsg-foto" src="' + _escRsg(x.foto_producto_url) + '" alt="Foto del producto" ' +
            'onerror="this.outerHTML=\'<div class=&quot;rsg-foto rsg-foto-vacia&quot;><i class=&quot;ti ti-photo-off&quot;></i></div>\'">'
        : '<div class="rsg-foto rsg-foto-vacia"><i class="ti ti-photo-off"></i></div>';
      return '<div class="rsg-pedido">' +
        '<div class="rsg-pedido-titulo"><span class="avatar ' + _escRsg(x.moto_de_color || 'av-blue') + ' rsg-avatar">' +
          _escRsg(x.moto_de_iniciales || '?') + '</span><span><strong>' + _escRsg(x.moto_de) + '</strong> te quiere pasar una orden</span></div>' +
        foto +
        '<div class="rsg-pedido-datos assign-info">' +
          '<div class="assign-tienda">' + _escRsg(x.tienda) + '</div>' +
          '<div class="assign-dato"><i class="ti ti-map-pin"></i> ' + _escRsg(x.distrito) + '</div>' +
          '<div class="assign-dato"><i class="ti ti-user"></i> ' + _escRsg(x.dest_nombre || 'Sin nombre') + '</div>' +
          '<div class="assign-dato"><i class="ti ti-cash"></i> ' +
            (x.metodo_pago === 'contraentrega' ? 'Contraentrega · <span class="entrega-monto">' + _montoRsg(x) + '</span>' : 'Sin cobro') + '</div>' +
          '<div class="assign-code">#' + _escRsg(x.codigo) + '</div>' +
        '</div>' +
        '<div class="rsg-pedido-botones">' +
          '<button type="button" class="rsg-no" onclick="rechazarReasignacion(' + x.id + ', this)"><i class="ti ti-x"></i> No</button>' +
          '<button type="button" class="rsg-si" onclick="aceptarReasignacion(' + x.id + ', this)"><i class="ti ti-check"></i> Sí, la acepto</button>' +
        '</div>' +
      '</div>';
    }).join('') +
  '</div>';
};

/* Franja dentro de la tarjeta del que envía: esperando o rechazada */
window.estadoReasignacionTarjetaHTML = function(idOrden) {
  var e = reasignacionDeOrden(idOrden);
  if (e.enviada) {
    return '<div class="rsg-espera"><i class="ti ti-clock-hour-4"></i> Esperando a <strong>' + _escRsg(e.enviada.moto_para) + '</strong>' +
      '<button type="button" class="rsg-link" onclick="cancelarReasignacion(' + e.enviada.id + ')">Cancelar reasignación</button></div>';
  }
  if (e.rechazada) {
    return '<div class="rsg-rechazo"><i class="ti ti-x"></i> <strong>' + _escRsg(e.rechazada.moto_para) + '</strong> no aceptó la orden: sigue contigo' +
      '<button type="button" class="rsg-link" onclick="vistoRechazoReasignacion(' + e.rechazada.id + ')">Entendido</button></div>';
  }
  return '';
};

/* Celda de la tabla del panel de Motorizados: botón, o la espera */
window.celdaReasignarPanelHTML = function(o) {
  if (o.estado !== 'en-proceso') return '';
  var p = _rsgPanelPorOrden[o.id];
  if (p) {
    return '<span class="rsg-espera rsg-espera-chica"><i class="ti ti-clock-hour-4"></i> Esperando a ' + _escRsg(p.moto_para) +
      ' <button type="button" class="rsg-link" onclick="cancelarReasignacion(' + p.id + ')">Cancelar</button></span>';
  }
  return '<button class="btn btn-sm" style="color:var(--color-amber-text);border-color:#fcd34d" ' +
    'onclick="abrirPedirReasignacion(' + o.id + ')" title="Pedirle a otro motorizado que la tome">' +
    '<i class="ti ti-arrows-exchange"></i> Reasignar</button>';
};
