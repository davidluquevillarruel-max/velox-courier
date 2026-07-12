/* ============================================================
   js/usuarios-tienda.js — Gestión de usuarios de tiendas
   Admin: ve todos, crea, activa/desactiva
   Tienda: ve solo su usuario, puede cambiar contraseña
   ============================================================ */

var _USUARIOS_TIENDA_CACHE = [];
var _TIENDAS_LIBRES_CACHE  = [];

function _sesionUT() {
  var raw = localStorage.getItem('velox_usuario');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch(e) { return null; }
}

/* ════════════════════════════════════════════
   INIT
════════════════════════════════════════════ */
window.initUsuariosTienda = async function() {
  var sesion = _sesionUT();
  var esTienda = sesion && sesion.rol === 'tienda';

  var lbl = document.getElementById('lbl-usuarios-tienda-modo');
  var btn = document.getElementById('btn-crear-usuarios-tienda');

  if (esTienda) {
    if (lbl) lbl.textContent = 'Estás viendo tu usuario de acceso';
    if (btn) btn.style.display = 'none';
  } else {
    if (lbl) lbl.textContent = 'Solo lectura para tiendas — no pueden modificar datos del sistema';
    if (btn) btn.style.display = '';
  }

  await _renderTablaUsuariosTienda();
};

/* ════════════════════════════════════════════
   TABLA
════════════════════════════════════════════ */
async function _renderTablaUsuariosTienda() {
  var tbody = document.getElementById('tbody-usuarios-tienda');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--color-text-tertiary)"><i class="ti ti-loader"></i> Cargando...</td></tr>';

  var sesion   = _sesionUT();
  var esTienda = sesion && sesion.rol === 'tienda';

  try {
    var r = await fetch('/api/auth/usuarios');
    var todos = await r.json();
    /* Filtrar solo tiendas */
    _USUARIOS_TIENDA_CACHE = todos.filter(function(u){ return u.rol === 'tienda'; });
  } catch(err) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:#A32D2D">Error al cargar usuarios</td></tr>';
    return;
  }

  /* Tienda: solo ve su propio usuario */
  var visibles = esTienda
    ? _USUARIOS_TIENDA_CACHE.filter(function(u){ return u.email === sesion.email; })
    : _USUARIOS_TIENDA_CACHE;

  if (visibles.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--color-text-tertiary)">' +
      (esTienda ? 'No se encontró tu usuario.' : 'No hay usuarios de tienda creados aún. Usa el botón "Crear usuarios para todas las tiendas".') +
      '</td></tr>';
    return;
  }

  tbody.innerHTML = visibles.map(function(u) {
    var estadoBadge = u.activo
      ? '<span class="badge entregado">Activo</span>'
      : '<span style="background:#F0F0F0;color:#777;padding:3px 9px;border-radius:20px;font-size:11px">Inactivo</span>';

    var acciones = esTienda
      ? '<button class="btn btn-sm" onclick="abrirCambiarPasswordTienda(' + u.id + ')"><i class="ti ti-key"></i> Cambiar contraseña</button>'
      : '<div style="display:flex;gap:4px">' +
          '<button class="btn btn-sm" onclick="toggleEstadoUsuarioTienda(' + u.id + ',' + (u.activo ? 'false' : 'true') + ')">' +
            (u.activo ? '<i class="ti ti-lock"></i> Desactivar' : '<i class="ti ti-lock-open"></i> Activar') +
          '</button>' +
          '<button class="btn btn-sm" onclick="eliminarUsuarioTienda(' + u.id + ',\'' + u.nombre.replace(/'/g,"\\'") + '\')" style="color:#A32D2D;border-color:#F09595"><i class="ti ti-trash"></i></button>' +
        '</div>';

    return '<tr>' +
      '<td><strong>' + u.nombre + '</strong></td>' +
      '<td style="font-size:12px">' + u.email + '</td>' +
      '<td>' + estadoBadge + '</td>' +
      '<td style="font-size:12px;color:var(--color-text-secondary)">' + (u.ultimo_acceso || 'Nunca') + '</td>' +
      '<td>' + acciones + '</td>' +
    '</tr>';
  }).join('');
}

/* ════════════════════════════════════════════
   FILTRAR POR NOMBRE
════════════════════════════════════════════ */
window.filtrarUsuariosTienda = function() {
  var q = (document.getElementById('buscar-usuario-tienda').value || '').toLowerCase();
  var filas = document.querySelectorAll('#tbody-usuarios-tienda tr');
  filas.forEach(function(fila) {
    var texto = fila.textContent.toLowerCase();
    fila.style.display = texto.includes(q) ? '' : 'none';
  });
};

/* ════════════════════════════════════════════
   TOGGLE ESTADO
════════════════════════════════════════════ */
window.toggleEstadoUsuarioTienda = async function(id, nuevoEstado) {
  try {
    await fetch('/api/auth/usuarios/' + id + '/estado', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activo: nuevoEstado }),
    });
    _renderTablaUsuariosTienda();
    if (typeof showNotif === 'function') showNotif('Estado actualizado');
  } catch(err) { console.error(err); }
};

/* ════════════════════════════════════════════
   ELIMINAR USUARIO TIENDA
════════════════════════════════════════════ */
window.eliminarUsuarioTienda = function(id, nombre) {
  if (!confirm('¿Eliminar el usuario de ' + nombre + '? La tienda ya no podrá acceder al sistema.')) return;
  fetch('/api/auth/usuarios/' + id + '/permanente', { method: 'DELETE' })
    .then(function(r){ return r.json(); })
    .then(function(data){
      if (data.ok) {
        _renderTablaUsuariosTienda();
        if (typeof showNotif === 'function') showNotif('Usuario eliminado');
      }
    });
};

/* ════════════════════════════════════════════
   CAMBIAR CONTRASEÑA (tienda)
════════════════════════════════════════════ */
window.abrirCambiarPasswordTienda = function(userId) {
  var overlay = document.getElementById('pwd-tienda-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'pwd-tienda-overlay';
    overlay.style.cssText = 'display:flex;position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:1000;align-items:center;justify-content:center';
    overlay.innerHTML =
      '<div style="background:var(--color-bg-primary);border-radius:var(--radius-lg);padding:24px;width:380px;max-width:95vw;box-shadow:0 8px 32px rgba(0,0,0,0.18)">' +
        '<div style="font-size:15px;font-weight:500;margin-bottom:16px"><i class="ti ti-key"></i> Cambiar contraseña</div>' +
        '<div style="display:flex;flex-direction:column;gap:12px">' +
          '<div><label style="font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:4px">Nueva contraseña</label>' +
            '<input id="f-nueva-pwd-tienda" type="password" class="search-box" style="width:100%" placeholder="Mínimo 8 caracteres" /></div>' +
          '<div><label style="font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:4px">Confirmar contraseña</label>' +
            '<input id="f-confirm-pwd-tienda" type="password" class="search-box" style="width:100%" placeholder="Repetir contraseña" /></div>' +
          '<div id="pwd-tienda-error" style="display:none;color:#A32D2D;font-size:12px;padding:8px 12px;background:#FCEBEB;border-radius:var(--radius-md)"></div>' +
        '</div>' +
        '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">' +
          '<button class="btn btn-sm" onclick="cerrarPwdTiendaModal()">Cancelar</button>' +
          '<button class="btn btn-primary btn-sm" id="btn-guardar-pwd-tienda"><i class="ti ti-check"></i> Guardar</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
  } else {
    overlay.style.display = 'flex';
    document.getElementById('f-nueva-pwd-tienda').value = '';
    document.getElementById('f-confirm-pwd-tienda').value = '';
    document.getElementById('pwd-tienda-error').style.display = 'none';
  }

  document.getElementById('btn-guardar-pwd-tienda').onclick = async function() {
    var nueva    = document.getElementById('f-nueva-pwd-tienda').value;
    var confirma = document.getElementById('f-confirm-pwd-tienda').value;
    var errEl    = document.getElementById('pwd-tienda-error');
    if (nueva.length < 8) { errEl.textContent='Mínimo 8 caracteres'; errEl.style.display='block'; return; }
    if (nueva !== confirma) { errEl.textContent='Las contraseñas no coinciden'; errEl.style.display='block'; return; }
    try {
      var r    = await fetch('/api/auth/usuarios/' + userId + '/password', {
        method: 'PATCH', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ password: nueva }),
      });
      var data = await r.json();
      if (data.ok) {
        cerrarPwdTiendaModal();
        if (typeof showNotif === 'function') showNotif('Contraseña actualizada');
      } else {
        errEl.textContent = data.error || 'Error'; errEl.style.display = 'block';
      }
    } catch(e) { errEl.textContent='Error de conexión'; errEl.style.display='block'; }
  };
};

window.cerrarPwdTiendaModal = function() {
  var o = document.getElementById('pwd-tienda-overlay'); if (o) o.remove();
};

/* ════════════════════════════════════════════
   CREAR USUARIOS MASIVO PARA TODAS LAS TIENDAS
════════════════════════════════════════════ */
window.crearUsuariosTiendasMasivo = async function() {
  var overlay = document.getElementById('modal-crear-masivo-overlay');
  var preview = document.getElementById('masivo-preview');
  var errEl   = document.getElementById('masivo-error');
  if (!overlay || !preview) return;

  preview.innerHTML = '<i class="ti ti-loader"></i> Calculando tiendas sin usuario...';
  errEl.style.display = 'none';
  overlay.style.display = 'flex';

  try {
    /* Obtener tiendas y usuarios existentes */
    var [rT, rU] = await Promise.all([
      fetch('/api/tiendas'),
      fetch('/api/auth/usuarios'),
    ]);
    var tiendas  = await rT.json();
    var usuarios = await rU.json();

    /* Emails de tiendas que ya tienen usuario */
    var emailsExistentes = new Set(usuarios.filter(function(u){ return u.rol==='tienda'; }).map(function(u){ return u.email; }));

    /* Tiendas que necesitan usuario */
    _TIENDAS_LIBRES_CACHE = tiendas.filter(function(t){
      var emailGen = _generarEmailTienda(t.nombre);
      return !emailsExistentes.has(emailGen);
    });

    if (_TIENDAS_LIBRES_CACHE.length === 0) {
      preview.innerHTML = '<span style="color:var(--color-green)">✅ Todas las tiendas ya tienen usuario de acceso.</span>';
      document.getElementById('btn-confirmar-masivo').style.display = 'none';
      return;
    }

    document.getElementById('btn-confirmar-masivo').style.display = '';
    preview.innerHTML = '<strong>' + _TIENDAS_LIBRES_CACHE.length + ' tiendas sin usuario:</strong><br><br>' +
      _TIENDAS_LIBRES_CACHE.map(function(t){
        return '· ' + t.nombre + ' → <span style="color:var(--color-blue-text)">' + _generarEmailTienda(t.nombre) + '</span>';
      }).join('<br>');
  } catch(err) {
    preview.innerHTML = '';
    errEl.textContent = 'Error al cargar datos: ' + err.message;
    errEl.style.display = 'block';
  }
};

function _generarEmailTienda(nombre) {
  /* Limpiar nombre: sin espacios, sin tildes, minúsculas */
  var limpio = nombre.toLowerCase()
    .replace(/á/g,'a').replace(/é/g,'e').replace(/í/g,'i').replace(/ó/g,'o').replace(/ú/g,'u').replace(/ñ/g,'n')
    .replace(/[^a-z0-9]/g,'')
    .substring(0, 30);
  return limpio + '@velox.pe';
}

function _generarPasswordTienda(nombre) {
  /* Contraseña: PrimerLetraMayuscula + restoSinEspacios + Velox2026! */
  var limpio = nombre.replace(/\s+/g,'').replace(/[^a-zA-Z0-9]/g,'');
  var pwd = limpio.charAt(0).toUpperCase() + limpio.slice(1) + 'Velox2026!';
  return pwd;
}

window.confirmarCrearMasivo = async function() {
  var btn   = document.getElementById('btn-confirmar-masivo');
  var errEl = document.getElementById('masivo-error');
  var prev  = document.getElementById('masivo-preview');

  btn.disabled   = true;
  btn.innerHTML  = '<i class="ti ti-loader"></i> Creando...';
  errEl.style.display = 'none';

  var errores  = [];
  var creados  = 0;

  for (var i = 0; i < _TIENDAS_LIBRES_CACHE.length; i++) {
    var t = _TIENDAS_LIBRES_CACHE[i];
    try {
      var r = await fetch('/api/auth/usuarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre:   t.nombre,
          email:    _generarEmailTienda(t.nombre),
          password: _generarPasswordTienda(t.nombre),
          rol:      'tienda',
          id_tienda: t.id,
        }),
      });
      var data = await r.json();
      if (data.ok) creados++;
      else errores.push(t.nombre + ': ' + (data.error || 'Error'));
    } catch(e) {
      errores.push(t.nombre + ': Error de red');
    }
  }

  btn.disabled  = false;
  btn.innerHTML = '<i class="ti ti-check"></i> Confirmar y crear';

  if (errores.length > 0) {
    errEl.innerHTML = 'Errores:<br>' + errores.join('<br>');
    errEl.style.display = 'block';
  }

  prev.innerHTML = '<span style="color:var(--color-green)">✅ Se crearon <strong>' + creados + '</strong> usuarios nuevos.</span>';
  document.getElementById('btn-confirmar-masivo').style.display = 'none';

  /* Refrescar tabla */
  setTimeout(function(){
    cerrarModalMasivo();
    _renderTablaUsuariosTienda();
  }, 2000);

  if (typeof showNotif === 'function') showNotif(creados + ' usuarios de tienda creados');
};

window.cerrarModalMasivo = function() {
  var o = document.getElementById('modal-crear-masivo-overlay');
  if (o) o.style.display = 'none';
};
