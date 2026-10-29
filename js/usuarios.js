/* ============================================================
   usuarios.js — Gestión de usuarios del sistema (solo admin)
   Conectado a /api/auth/usuarios y /api/auth/motorizados-libres
   ============================================================ */

var _USUARIOS_CACHE = [];
var _MOTOS_LIBRES_CACHE = [];
var _comboMotoUsuario = null; /* combobox buscable de js/combobox.js */

var _ROLES_LABEL = {
  admin:      'Administrador',
  operador:   'Operador',
  visor:      'Visor',
  motorizado: 'Motorizado',
  tienda:     'Tienda',
};

/* ════════════════════════════════════════════
   INIT
════════════════════════════════════════════ */
window.initUsuarios = function() {
  _renderTablaUsuarios();
  _comboMotoUsuario = initComboBuscable('f-usuario-motorizado', function() {
    return _MOTOS_LIBRES_CACHE.map(function(m) {
      return { value: String(m.id), label: m.nombre };
    });
  });
};

/* ════════════════════════════════════════════
   TABLA DE USUARIOS
════════════════════════════════════════════ */
async function _renderTablaUsuarios() {
  var tbody = document.getElementById('tbody-usuarios');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--color-text-tertiary)"><i class="ti ti-loader"></i> Cargando...</td></tr>';

  var sesion = _obtenerSesionUsuarios();
  /* Motorizado y tienda solo ven su propio usuario (para cambiar su
     contraseña); el resto de la página es del admin */
  var esPropio = sesion && (sesion.rol === 'motorizado' || sesion.rol === 'tienda');

  try {
    var r = await fetch(API + '/auth/usuarios');
    _USUARIOS_CACHE = await r.json();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:#A32D2D">Error al cargar usuarios</td></tr>';
    return;
  }

  var filtroRol = (document.getElementById('f-rol-usuarios') || {}).value || '';
  var texto     = ((document.getElementById('f-buscar-usuarios') || {}).value || '').toLowerCase().trim();
  var usuariosVisibles = esPropio
    ? _USUARIOS_CACHE.filter(function(u){ return u.email === sesion.email; })
    : _USUARIOS_CACHE.filter(function(u) {
        if (filtroRol && u.rol !== filtroRol) return false;
        if (texto && (u.nombre + ' ' + u.email + ' ' + (u.tienda_nombre || '') + ' ' + (u.motorizado_nombre || '')).toLowerCase().indexOf(texto) === -1) return false;
        return true;
      });

  /* Botones y filtros: solo para el admin */
  ['barra-acciones-usuarios', 'filtros-usuarios'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = esPropio ? 'none' : 'flex';
  });

  if (usuariosVisibles.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--color-text-tertiary)">Sin usuarios registrados</td></tr>';
    return;
  }

  tbody.innerHTML = usuariosVisibles.map(function(u) {
    var estadoBadge = u.activo
      ? '<span class="badge entregado">Activo</span>'
      : '<span style="background:#F0F0F0;color:#777;padding:3px 9px;border-radius:20px;font-size:11px">Inactivo</span>';

    var vinculo = u.motorizado_nombre
      ? '<span style="font-size:12px"><i class="ti ti-motorbike"></i> ' + u.motorizado_nombre + '</span>'
      : u.tienda_nombre
        ? '<span style="font-size:12px"><i class="ti ti-building-store"></i> ' + u.tienda_nombre + '</span>'
        : '<span style="font-size:12px;color:var(--color-text-tertiary)">—</span>';

    var acciones = esPropio
      ? '<button class="btn btn-sm" onclick="abrirCambiarPassword(' + u.id + ')"><i class="ti ti-key"></i> Cambiar contraseña</button>'
      : '<div style="display:flex;gap:4px">' +
          '<button class="btn btn-sm" onclick="toggleEstadoUsuario(' + u.id + ',' + (u.activo ? 'false' : 'true') + ')">' +
            (u.activo ? '<i class="ti ti-lock"></i> Desactivar' : '<i class="ti ti-lock-open"></i> Activar') +
          '</button>' +
          '<button class="btn btn-sm" onclick="abrirEliminarUsuarioFisico(' + u.id + ',&quot;' + u.nombre + '&quot;)" style="color:#A32D2D;border-color:#F09595"><i class="ti ti-trash"></i></button>' +
        '</div>';

    return '<tr>' +
      '<td><strong>' + u.nombre + '</strong></td>' +
      '<td style="font-size:12px">' + u.email + '</td>' +
      '<td>' + (_ROLES_LABEL[u.rol] || u.rol) + '</td>' +
      '<td>' + vinculo + '</td>' +
      '<td style="font-size:12px;color:var(--color-text-secondary)">' + (u.ultimo_acceso || 'Nunca') + '</td>' +
      '<td>' + estadoBadge + '</td>' +
      '<td>' + acciones + '</td>' +
    '</tr>';
  }).join('');
}

window.filtrarUsuarios = function() { _renderTablaUsuarios(); };

/* Usuarios para los motorizados activos que no tienen (js/accesos.js) */
window.crearAccesosMotorizados = function() {
  abrirCrearAccesos('motorizado', null, _renderTablaUsuarios);
};

window.abrirEliminarUsuarioFisico = function(id, nombre) {
  abrirConfirmarEliminacionFisica(nombre, API + '/auth/usuarios/' + id + '/permanente', function() {
    _renderTablaUsuarios();
  });
};

window.toggleEstadoUsuario = async function(id, nuevoEstado) {
  try {
    await fetch(API + '/auth/usuarios/' + id + '/estado', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activo: nuevoEstado }),
    });
    _renderTablaUsuarios();
    if (typeof showNotif === 'function') showNotif('Usuario actualizado');
  } catch (err) {
    if (typeof showNotif === 'function') showNotif('Error al actualizar usuario');
  }
};

/* ════════════════════════════════════════════
   MODAL — Agregar usuario
════════════════════════════════════════════ */
window.abrirModalUsuario = async function() {
  document.getElementById('f-usuario-nombre').value = '';
  document.getElementById('f-usuario-email-prefijo').value = '';
  document.getElementById('f-usuario-rol').value = 'motorizado';
  document.getElementById('f-usuario-password').value = '';
  var errEl = document.getElementById('usuario-modal-error');
  if (errEl) errEl.style.display = 'none';

  await _cargarMotorizadosLibres();
  onCambioRolUsuario();

  document.getElementById('usuario-modal-overlay').style.display = 'flex';
};

window.cerrarModalUsuario = function() {
  document.getElementById('usuario-modal-overlay').style.display = 'none';
};

/* Muestra/oculta el selector de "vincular con motorizado" según el rol elegido */
window.onCambioRolUsuario = function() {
  var rol  = document.getElementById('f-usuario-rol').value;
  var wrap = document.getElementById('wrap-vincular-motorizado');
  if (wrap) wrap.style.display = (rol === 'motorizado') ? 'block' : 'none';
};

async function _cargarMotorizadosLibres() {
  var input = document.getElementById('f-usuario-motorizado');
  var avisoSinLibres = document.getElementById('sin-motorizados-libres');
  if (_comboMotoUsuario) _comboMotoUsuario.limpiar();
  if (input) input.placeholder = 'Cargando...';

  try {
    var r = await fetch(API + '/auth/motorizados-libres');
    _MOTOS_LIBRES_CACHE = await r.json();
  } catch (err) {
    _MOTOS_LIBRES_CACHE = [];
  }

  var hayLibres = _MOTOS_LIBRES_CACHE.length > 0;
  if (avisoSinLibres) avisoSinLibres.style.display = hayLibres ? 'none' : 'block';
  if (input) input.placeholder = hayLibres ? 'Escribe para buscar motorizado...' : 'No hay motorizados libres';
}

window.guardarUsuario = async function() {
  var nombre        = document.getElementById('f-usuario-nombre').value.trim();
  var emailPrefijo  = document.getElementById('f-usuario-email-prefijo').value.trim();
  var rol           = document.getElementById('f-usuario-rol').value;
  var idMotorizado  = document.getElementById('f-usuario-motorizado').value;
  var password      = document.getElementById('f-usuario-password').value;
  var errEl         = document.getElementById('usuario-modal-error');

  var email = emailPrefijo ? (emailPrefijo.toLowerCase() + '@velox.pe') : '';

  var validaciones = [
    validarTexto(nombre, { obligatorio: true, min: 2, max: 100, nombreCampo: 'El nombre' }),
    validarEmailVelox(email, { obligatorio: true }),
    validarPasswordFuerte(password, { obligatorio: true }),
  ];
  if (!ejecutarValidaciones(validaciones, errEl)) return;

  if (rol === 'motorizado' && !idMotorizado) {
    errEl.textContent = 'Selecciona a qué motorizado se vincula este usuario.';
    errEl.style.display = 'block';
    return;
  }

  try {
    var r = await fetch(API + '/auth/usuarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: nombre,
        email: email,
        password: password,
        rol: rol,
        id_motorizado: rol === 'motorizado' ? idMotorizado : null,
      }),
    });
    var data = await r.json();

    if (!r.ok) {
      errEl.textContent = data.error || 'No se pudo crear el usuario.';
      errEl.style.display = 'block';
      return;
    }

    cerrarModalUsuario();
    _renderTablaUsuarios();
    if (typeof showNotif === 'function') showNotif('Usuario creado correctamente: ' + email);

  } catch (err) {
    errEl.textContent = 'Error de conexión al crear el usuario.';
    errEl.style.display = 'block';
  }
};

function _obtenerSesionUsuarios() {
  var raw = localStorage.getItem('velox_usuario');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch(e) { return null; }
}

window.cerrarPwdModal = function() { var o=document.getElementById('pwd-modal-overlay'); if(o) o.remove(); };

/* El admin resetea cualquier contraseña sin la actual; los demás solo
   cambian la suya y el servidor les pide la actual */
window.abrirCambiarPassword = function(userId) {
  var sesion = _obtenerSesionUsuarios();
  var pideActual = !(sesion && sesion.rol === 'admin');
  var overlay = document.getElementById('pwd-modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'pwd-modal-overlay';
    overlay.style.cssText = 'display:flex;position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:1000;align-items:center;justify-content:center';
    overlay.innerHTML =
      '<div style="background:var(--color-bg-primary);border-radius:var(--radius-lg);padding:24px;width:380px;max-width:95vw;box-shadow:0 8px 32px rgba(0,0,0,0.18)">' +
        '<div style="font-size:15px;font-weight:500;margin-bottom:16px"><i class="ti ti-key"></i> Cambiar contraseña</div>' +
        '<div style="display:flex;flex-direction:column;gap:12px">' +
          '<div id="wrap-pwd-actual"><label style="font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:4px">Contraseña actual</label>' +
            '<input id="f-actual-pwd" type="password" class="search-box" style="width:100%" autocomplete="current-password" /></div>' +
          '<div><label style="font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:4px">Nueva contraseña</label>' +
            '<input id="f-nueva-pwd" type="password" class="search-box" style="width:100%" placeholder="Mínimo 8 caracteres" autocomplete="new-password" />' +
            '<div style="font-size:11px;color:var(--color-text-tertiary);margin-top:4px">Con mayúscula, minúscula, número y un símbolo (ej: !)</div></div>' +
          '<div><label style="font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:4px">Confirmar contraseña</label>' +
            '<input id="f-confirm-pwd" type="password" class="search-box" style="width:100%" placeholder="Repetir contraseña" /></div>' +
          '<div id="pwd-error" style="display:none;color:#A32D2D;font-size:12px;padding:8px 12px;background:#FCEBEB;border-radius:var(--radius-md)"></div>' +
        '</div>' +
        '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">' +
          '<button class="btn btn-sm" onclick="cerrarPwdModal()">Cancelar</button>' +
          '<button class="btn btn-primary btn-sm" id="btn-guardar-pwd"><i class="ti ti-check"></i> Guardar</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
  } else {
    overlay.style.display = 'flex';
    document.getElementById('f-actual-pwd').value = '';
    document.getElementById('f-nueva-pwd').value = '';
    document.getElementById('f-confirm-pwd').value = '';
    document.getElementById('pwd-error').style.display = 'none';
  }

  document.getElementById('wrap-pwd-actual').style.display = pideActual ? '' : 'none';

  document.getElementById('btn-guardar-pwd').onclick = async function() {
    var actual  = document.getElementById('f-actual-pwd').value;
    var nueva   = document.getElementById('f-nueva-pwd').value;
    var confirma = document.getElementById('f-confirm-pwd').value;
    var errEl   = document.getElementById('pwd-error');
    if (pideActual && !actual) { errEl.textContent='Ingresa tu contraseña actual'; errEl.style.display='block'; return; }
    if (!ejecutarValidaciones([validarPasswordFuerte(nueva, { obligatorio: true })], errEl)) return;
    if (nueva !== confirma) { errEl.textContent='Las contraseñas no coinciden'; errEl.style.display='block'; return; }
    try {
      var r = await fetch(API + '/auth/usuarios/' + userId + '/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pideActual ? { password: nueva, passwordActual: actual } : { password: nueva }),
      });
      var data = await r.json();
      if (data.ok) {
        document.getElementById('pwd-modal-overlay').remove();
        if (typeof showNotif === 'function') showNotif('Contraseña actualizada correctamente');
      } else {
        errEl.textContent = data.error || 'Error al actualizar';
        errEl.style.display = 'block';
      }
    } catch(e) { errEl.textContent='Error de conexión'; errEl.style.display='block'; }
  };
};