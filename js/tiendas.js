/* ============================================================
   tiendas.js — Catálogo de tiendas (pages/tiendas.html)
   Lista completa (sin filtro de fecha) con buscador, estado y si
   tiene usuario de acceso. Gestores: agregar, editar, desactivar /
   reactivar. Admin: además "Crear acceso" (por fila o los faltantes,
   con js/accesos.js) y eliminar definitivamente.
   Una tienda activa aparece en las selecciones para crear órdenes;
   una inactiva sigue acá y en el historial, pero no se puede elegir
   (y POST /ordenes la rechaza).
   El resumen de plata por tienda está en "Clientes / Tiendas".
   ============================================================ */

var TIENDAS_CATALOGO = [];
var _tiendaEditId = null;
var _tiendaElimId = null;

function _escTienda(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _rolTiendas() {
  var s = typeof _obtenerSesion === 'function' ? _obtenerSesion() : null;
  return s ? s.rol : '';
}
function _esGestorTiendas() { return ['admin', 'operador'].indexOf(_rolTiendas()) !== -1; }
function _esAdminTiendas()  { return _rolTiendas() === 'admin'; }

window.initTiendas = function() {
  var btnAgregar = document.getElementById('btn-agregar-tienda');
  var btnAccesos = document.getElementById('btn-crear-accesos-tiendas');
  if (btnAgregar) btnAgregar.style.display = _esGestorTiendas() ? '' : 'none';
  if (btnAccesos) btnAccesos.style.display = _esAdminTiendas() ? '' : 'none';
  _recargarCatalogoTiendas(true);
};

async function _recargarCatalogoTiendas(inicial) {
  var tbody = document.getElementById('tbody-tiendas');
  if (!tbody) return;
  if (inicial) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--color-text-tertiary)"><i class="ti ti-loader"></i> Cargando...</td></tr>';
  try {
    var r = await fetch(API + '/tiendas');
    if (!r.ok) throw new Error('Error ' + r.status);
    TIENDAS_CATALOGO = await r.json();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--color-red-text)">No se pudieron cargar las tiendas</td></tr>';
    return;
  }
  renderCatalogoTiendas();
}

/* Las selecciones de órdenes (CATALOGO_TIENDAS en js/pedidos.js) se
   recargan solas al entrar a Pedidos; esto las pone al día ya */
function _refrescarSeleccionesTiendas() {
  if (typeof _cargarCatalogos === 'function') _cargarCatalogos();
}

window.renderCatalogoTiendas = function() {
  var tbody = document.getElementById('tbody-tiendas');
  if (!tbody) return;
  var texto  = ((document.getElementById('f-buscar-tiendas') || {}).value || '').toLowerCase().trim();
  var estado = (document.getElementById('f-estado-tiendas') || {}).value || '';
  var acceso = (document.getElementById('f-acceso-tiendas') || {}).value || '';
  var gestor = _esGestorTiendas();
  var admin  = _esAdminTiendas();

  var visibles = TIENDAS_CATALOGO.filter(function(t) {
    if (estado === 'activas' && !t.activa) return false;
    if (estado === 'inactivas' && t.activa) return false;
    if (acceso === 'con' && !t.tiene_usuario) return false;
    if (acceso === 'sin' && t.tiene_usuario) return false;
    if (texto && (t.nombre + ' ' + (t.telefono || '') + ' ' + (t.ruc || '')).toLowerCase().indexOf(texto) === -1) return false;
    return true;
  });

  var activas = TIENDAS_CATALOGO.filter(function(t) { return t.activa; }).length;
  var sinAcceso = TIENDAS_CATALOGO.filter(function(t) { return t.activa && !t.tiene_usuario; }).length;
  var lbl = document.getElementById('lbl-total-tiendas');
  if (lbl) {
    lbl.textContent = (visibles.length !== TIENDAS_CATALOGO.length ? visibles.length + ' de ' : '') +
      TIENDAS_CATALOGO.length + ' tiendas · ' + activas + ' activas · ' + sinAcceso + ' activas sin acceso';
  }
  var btnAccesos = document.getElementById('btn-crear-accesos-tiendas');
  if (btnAccesos && admin) {
    btnAccesos.innerHTML = '<i class="ti ti-users-plus"></i> Crear accesos faltantes (' + sinAcceso + ')';
    btnAccesos.disabled = sinAcceso === 0;
  }

  if (!visibles.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--color-text-tertiary)">' +
      (TIENDAS_CATALOGO.length ? 'Ninguna tienda coincide con el filtro.' : 'Todavía no hay tiendas. Usa "Agregar tienda".') + '</td></tr>';
    return;
  }

  tbody.innerHTML = visibles.map(function(t) {
    var estadoBadge = t.activa
      ? '<span class="badge pendiente">Activa</span>'
      : '<span class="badge badge-inactivo">Inactiva</span>';
    var accesoBadge = t.tiene_usuario
      ? '<span class="badge entregado"><i class="ti ti-user-check"></i> Con acceso</span>'
      : '<span class="badge badge-inactivo">Sin acceso</span>';

    var acciones = '';
    if (gestor) {
      acciones += '<button class="btn btn-sm" onclick="editarTienda(' + t.id + ')" title="Editar"><i class="ti ti-pencil"></i></button>';
      acciones += t.activa
        ? '<button class="btn btn-sm" onclick="confirmarDesactivarTienda(' + t.id + ')" title="Desactivar" style="color:var(--color-red-text)"><i class="ti ti-ban"></i> Desactivar</button>'
        : '<button class="btn btn-sm" onclick="reactivarTienda(' + t.id + ')" title="Reactivar"><i class="ti ti-refresh"></i> Reactivar</button>';
    }
    if (admin && t.activa && !t.tiene_usuario) {
      acciones += '<button class="btn btn-sm" onclick="crearAccesoTienda(' + t.id + ')" title="Crear usuario de acceso"><i class="ti ti-user-plus"></i> Crear acceso</button>';
    }

    return '<tr' + (t.activa ? '' : ' class="fila-inactiva"') + '>' +
      '<td><div style="font-weight:500">' + _escTienda(t.nombre) + '</div>' +
        '<div style="font-size:11px;color:var(--color-text-secondary)">' +
          (t.ruc ? 'RUC: ' + _escTienda(t.ruc) + ' · ' : '') + _escTienda(t.ciclo_pago || '') +
        '</div></td>' +
      '<td style="font-size:12px">' + (t.telefono ? _escTienda(t.telefono) : '<span style="color:var(--color-text-tertiary)">—</span>') + '</td>' +
      '<td>' + estadoBadge + '</td>' +
      '<td>' + accesoBadge + '</td>' +
      '<td><div style="display:flex;gap:4px;flex-wrap:wrap">' + (acciones || '<span style="color:var(--color-text-tertiary)">—</span>') + '</div></td>' +
    '</tr>';
  }).join('');
};

/* ── Modal tienda ── */
window.abrirModalTienda = function() {
  _tiendaEditId = null;
  document.getElementById('tienda-modal-titulo').textContent = 'Agregar tienda cliente';
  document.getElementById('btn-guardar-tienda').innerHTML = '<i class="ti ti-plus"></i> Agregar';
  ['f-tienda-nombre','f-tienda-ruc','f-tienda-contacto','f-tienda-telefono','f-tienda-direccion','f-tienda-obs'].forEach(function(id){
    var el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('f-tienda-ciclo').value  = 'semanal';
  document.getElementById('f-tienda-activa').value = 'true';
  document.getElementById('tienda-modal-error').style.display   = 'none';
  document.getElementById('tienda-modal-overlay').style.display = 'flex';
  document.getElementById('f-tienda-nombre').focus();
};

window.editarTienda = function(id) {
  var t = TIENDAS_CATALOGO.find(function(x){ return x.id == id; });
  if (!t) return;
  _tiendaEditId = id;
  document.getElementById('tienda-modal-titulo').textContent = 'Editar tienda cliente';
  document.getElementById('btn-guardar-tienda').innerHTML = '<i class="ti ti-check"></i> Guardar cambios';
  document.getElementById('f-tienda-nombre').value    = t.nombre;
  document.getElementById('f-tienda-ruc').value       = t.ruc || '';
  document.getElementById('f-tienda-contacto').value  = t.contacto || '';
  document.getElementById('f-tienda-telefono').value  = t.telefono || '';
  document.getElementById('f-tienda-direccion').value = t.direccion || '';
  document.getElementById('f-tienda-ciclo').value     = t.ciclo_pago || 'semanal';
  document.getElementById('f-tienda-activa').value    = t.activa ? 'true' : 'false';
  document.getElementById('f-tienda-obs').value       = t.observaciones || '';
  document.getElementById('tienda-modal-error').style.display   = 'none';
  document.getElementById('tienda-modal-overlay').style.display = 'flex';
};

window.cerrarModalTienda = function() {
  document.getElementById('tienda-modal-overlay').style.display = 'none';
};

/* Solo el nombre es obligatorio: las tiendas importadas no tienen RUC
   ni correo, y antes eso impedía editar cualquiera de ellas */
window.guardarTienda = async function() {
  var nombre    = document.getElementById('f-tienda-nombre').value.trim();
  var ruc       = document.getElementById('f-tienda-ruc').value.trim();
  var contacto  = document.getElementById('f-tienda-contacto').value.trim();
  var telefono  = document.getElementById('f-tienda-telefono').value.trim();
  var direccion = document.getElementById('f-tienda-direccion').value.trim();
  var ciclo     = document.getElementById('f-tienda-ciclo').value;
  var activa    = document.getElementById('f-tienda-activa').value === 'true';
  var obs       = document.getElementById('f-tienda-obs').value.trim();
  var errEl     = document.getElementById('tienda-modal-error');

  var validaciones = [
    validarTexto(nombre, { obligatorio: true, min: 2, max: 100, nombreCampo: 'El nombre de la tienda' }),
    validarRUC(ruc, { obligatorio: false }),
    validarEmail(contacto, { obligatorio: false }),
    validarTelefono(telefono),
    validarTexto(direccion, { max: 200, nombreCampo: 'La dirección' }),
    validarTexto(obs, { max: 300, nombreCampo: 'Las observaciones' }),
  ];
  if (!ejecutarValidaciones(validaciones, errEl)) return;

  var body   = { nombre: nombre, ruc: ruc, contacto: contacto, telefono: telefono, direccion: direccion, ciclo_pago: ciclo, activa: activa, observaciones: obs };
  var url    = API + '/tiendas' + (_tiendaEditId ? '/' + _tiendaEditId : '');
  var method = _tiendaEditId ? 'PUT' : 'POST';
  var btn    = document.getElementById('btn-guardar-tienda');

  btn.disabled = true;
  try {
    var r = await fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) {
      var e = await r.json().catch(function() { return {}; });
      errEl.textContent = e.error || 'No se pudo guardar la tienda.';
      errEl.style.display = 'block';
      return;
    }
    cerrarModalTienda();
    _recargarCatalogoTiendas(false);
    _refrescarSeleccionesTiendas();
    if (typeof showNotif === 'function') showNotif(_tiendaEditId ? 'Tienda actualizada' : 'Tienda agregada: ' + nombre);
  } catch (err) {
    errEl.textContent = 'Error de conexión.';
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
  }
};

/* ── Desactivar / reactivar ── */
window.confirmarDesactivarTienda = function(id) {
  var t = TIENDAS_CATALOGO.find(function(x){ return x.id == id; });
  if (!t) return;
  _tiendaElimId = id;
  document.getElementById('confirm-tienda-nombre').textContent = t.nombre;
  var wrapFisico = document.getElementById('wrap-eliminar-tienda-fisico');
  if (wrapFisico) wrapFisico.style.display = _esAdminTiendas() ? '' : 'none';
  document.getElementById('tienda-confirm-overlay').style.display = 'flex';
};

window.cerrarConfirmTienda = function() {
  document.getElementById('tienda-confirm-overlay').style.display = 'none';
  _tiendaElimId = null;
};

async function _cambiarEstadoTienda(id, activa) {
  var r = await fetch(API + '/tiendas/' + id + '/estado', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activa: activa }),
  });
  if (!r.ok) {
    var e = await r.json().catch(function() { return {}; });
    throw new Error(e.error || 'No se pudo cambiar el estado');
  }
  _recargarCatalogoTiendas(false);
  _refrescarSeleccionesTiendas();
}

window.ejecutarDesactivarTienda = async function() {
  var t = TIENDAS_CATALOGO.find(function(x){ return x.id == _tiendaElimId; });
  if (!t) return;
  try {
    await _cambiarEstadoTienda(t.id, false);
    cerrarConfirmTienda();
    if (typeof showNotif === 'function') showNotif('Tienda desactivada: ' + t.nombre);
  } catch (err) {
    if (typeof showNotif === 'function') showNotif(err.message);
  }
};

window.reactivarTienda = async function(id) {
  var t = TIENDAS_CATALOGO.find(function(x){ return x.id == id; });
  if (!t) return;
  try {
    await _cambiarEstadoTienda(id, true);
    if (typeof showNotif === 'function') showNotif('Tienda reactivada: ' + t.nombre);
  } catch (err) {
    if (typeof showNotif === 'function') showNotif(err.message);
  }
};

window.abrirEliminarTiendaFisico = function() {
  var t = TIENDAS_CATALOGO.find(function(x){ return x.id == _tiendaElimId; });
  if (!t) return;
  var idGuardado = t.id, nombreGuardado = t.nombre;
  cerrarConfirmTienda();
  abrirConfirmarEliminacionFisica(nombreGuardado, API + '/tiendas/' + idGuardado + '/permanente', function() {
    _recargarCatalogoTiendas(false);
    _refrescarSeleccionesTiendas();
  });
};

/* ── Usuarios de acceso (js/accesos.js) ── */
window.crearAccesoTienda = function(id) {
  abrirCrearAccesos('tienda', [id], function() { _recargarCatalogoTiendas(false); });
};

window.crearAccesosFaltantesTiendas = function() {
  abrirCrearAccesos('tienda', null, function() { _recargarCatalogoTiendas(false); });
};
