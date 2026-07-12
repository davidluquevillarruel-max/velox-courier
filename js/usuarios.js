/* ============================================================
   usuarios.js — Gestión de usuarios del sistema (solo admin)
   Conectado a /api/auth/usuarios y /api/auth/motorizados-libres
   ============================================================ */

var _USUARIOS_CACHE = [];

var _ROLES_LABEL = {
  admin:      'Administrador',
  operador:   'Operador',
  visor:      'Visor',
  motorizado: 'Motorizado',
};

/* ════════════════════════════════════════════
   INIT
════════════════════════════════════════════ */
window.initUsuarios = function() {
  _renderTablaUsuarios();
};

/* ════════════════════════════════════════════
   TABLA DE USUARIOS
════════════════════════════════════════════ */
async function _renderTablaUsuarios() {
  var tbody = document.getElementById('tbody-usuarios');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--color-text-tertiary)"><i class="ti ti-loader"></i> Cargando...</td></tr>';

  var sesion = _obtenerSesionUsuarios();
  var esMoto = sesion && sesion.rol === 'motorizado';

  try {
    var r = await fetch(API + '/auth/usuarios');
    _USUARIOS_CACHE = await r.json();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:#A32D2D">Error al cargar usuarios</td></tr>';
    return;
  }

  /* Motorizado: solo ve su propio usuario */
  var usuariosVisibles = esMoto
    ? _USUARIOS_CACHE.filter(function(u){ return u.email === sesion.email; })
    : _USUARIOS_CACHE;

  /* Ocultar botón agregar si es motorizado */
  var btnAgregar = document.getElementById('btn-agregar-usuario');
  if (btnAgregar) btnAgregar.style.display = esMoto ? 'none' : '';

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
      : '<span style="font-size:12px;color:var(--color-text-tertiary)">—</span>';

    var acciones = esMoto
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
  var sel = document.getElementById('f-usuario-motorizado');
  var avisoSinLibres = document.getElementById('sin-motorizados-libres');
  sel.innerHTML = '<option value="">Cargando...</option>';

  try {
    var r = await fetch(API + '/auth/motorizados-libres');
    var libres = await r.json();

    if (libres.length === 0) {
      sel.innerHTML = '<option value="">No hay motorizados libres</option>';
      if (avisoSinLibres) avisoSinLibres.style.display = 'block';
      return;
    }

    if (avisoSinLibres) avisoSinLibres.style.display = 'none';
    sel.innerHTML = '<option value="">Seleccionar motorizado...</option>' +
      libres.map(function(m) {
        return '<option value="' + m.id + '">' + m.nombre + '</option>';
      }).join('');
  } catch (err) {
    sel.innerHTML = '<option value="">Error al cargar</option>';
  }
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

window.abrirCambiarPassword = function(userId) {
  var overlay = document.getElementById('pwd-modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'pwd-modal-overlay';
    overlay.style.cssText = 'display:flex;position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:1000;align-items:center;justify-content:center';
    overlay.innerHTML =
      '<div style="background:var(--color-bg-primary);border-radius:var(--radius-lg);padding:24px;width:380px;max-width:95vw;box-shadow:0 8px 32px rgba(0,0,0,0.18)">' +
        '<div style="font-size:15px;font-weight:500;margin-bottom:16px"><i class="ti ti-key"></i> Cambiar contraseña</div>' +
        '<div style="display:flex;flex-direction:column;gap:12px">' +
          '<div><label style="font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:4px">Nueva contraseña</label>' +
            '<input id="f-nueva-pwd" type="password" class="search-box" style="width:100%" placeholder="Mínimo 8 caracteres" /></div>' +
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
    document.getElementById('f-nueva-pwd').value = '';
    document.getElementById('f-confirm-pwd').value = '';
    document.getElementById('pwd-error').style.display = 'none';
  }

  document.getElementById('btn-guardar-pwd').onclick = async function() {
    var nueva   = document.getElementById('f-nueva-pwd').value;
    var confirma = document.getElementById('f-confirm-pwd').value;
    var errEl   = document.getElementById('pwd-error');
    if (nueva.length < 8) { errEl.textContent='Mínimo 8 caracteres'; errEl.style.display='block'; return; }
    if (nueva !== confirma) { errEl.textContent='Las contraseñas no coinciden'; errEl.style.display='block'; return; }
    try {
      var r = await fetch(API + '/auth/usuarios/' + userId + '/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: nueva }),
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