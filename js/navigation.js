/* ============================================================
   navigation.js — Carga dinámica de páginas (SPA)
   Funciona con Node.js en localhost:3000
   ============================================================ */

function showPage(id) {
  var sesion = _obtenerSesion();

  /* ── Restricciones por rol ── */
  if (sesion) {
    var rol = sesion.rol;
    var _moto   = ['motorizados','evidencias','asignacion','usuarios'];
    var _tienda = ['clientes','evidencias','usuarios-tienda'];

    if (rol === 'motorizado' && !_moto.includes(id))   id = 'motorizados';
    if (rol === 'tienda'     && !_tienda.includes(id)) id = 'clientes';
    if (id === 'usuarios' && rol !== 'admin' && rol !== 'motorizado') {
      id = rol === 'tienda' ? 'clientes' : 'pedidos';
    }
  }

  document.querySelectorAll('.nav-item').forEach(function(n) {
    n.classList.remove('active');
    if (n.getAttribute('onclick') && n.getAttribute('onclick').includes("'" + id + "'")) {
      n.classList.add('active');
    }
  });

  var container = document.getElementById('main-content');
  container.style.opacity = '0';
  history.replaceState(null, '', window.location.pathname);

  fetch('pages/' + id + '.html')
    .then(function(r) {
      if (!r.ok) throw new Error('No se pudo cargar: ' + id);
      return r.text();
    })
    .then(function(html) {
      container.innerHTML = html;
      container.style.transition = 'opacity 0.15s';
      container.style.opacity = '1';

      if (id === 'pedidos')          initPedidos();
      if (id === 'clientes')         initClientes();
      if (id === 'evidencias')       initEvidencias();
      if (id === 'tarifas')          initTarifas();
      if (id === 'caja')             initCaja();
      if (id === 'motorizados')      initMotorizados();
      if (id === 'asignacion')       initAsignacion();
      if (id === 'usuarios')         initUsuarios();
      if (id === 'usuarios-tienda')  initUsuariosTienda();
    })
    .catch(function(err) {
      container.innerHTML =
        '<div style="padding:40px;color:var(--color-text-secondary);font-size:14px">' +
        'Error cargando página: <strong>' + err.message + '</strong></div>';
      container.style.opacity = '1';
    });
}

/* ── Detalle motorizado ── */
function abrirDetalle(motoId) {
  history.replaceState(null, '', window.location.pathname + '?moto=' + motoId);
  var container = document.getElementById('main-content');
  container.style.opacity = '0';

  fetch('pages/detalle-motorizado.html')
    .then(function(r) { return r.text(); })
    .then(function(html) {
      container.innerHTML = html;
      container.style.transition = 'opacity 0.15s';
      container.style.opacity = '1';
      if (typeof renderDetalleMoto === 'function') renderDetalleMoto(motoId);
    })
    .catch(function(err) {
      container.innerHTML = '<div style="padding:40px;color:var(--color-text-secondary)">Error: ' + err.message + '</div>';
      container.style.opacity = '1';
    });
}

/* ── Detalle tienda ── */
function abrirDetalleTienda(tiendaId) {
  history.replaceState(null, '', window.location.pathname + '?tienda=' + tiendaId);
  var container = document.getElementById('main-content');
  container.style.opacity = '0';

  fetch('pages/detalle-tienda.html')
    .then(function(r) { return r.text(); })
    .then(function(html) {
      container.innerHTML = html;
      container.style.transition = 'opacity 0.15s';
      container.style.opacity = '1';
      if (typeof renderDetalleTienda === 'function') renderDetalleTienda(tiendaId);
    })
    .catch(function(err) {
      container.innerHTML = '<div style="padding:40px;color:var(--color-text-secondary)">Error: ' + err.message + '</div>';
      container.style.opacity = '1';
    });
}

/* ── Carga inicial ── */
document.addEventListener('DOMContentLoaded', function() {
  _mostrarUsuarioSesion();
  _aplicarPermisosPorRol();

  var sesion = _obtenerSesion();
  var paginaInicial = sesion && sesion.rol === 'motorizado' ? 'motorizados'
                   : sesion && sesion.rol === 'tienda'     ? 'clientes'
                   : 'pedidos';

  fetch('pages/' + paginaInicial + '.html')
    .then(function(r) { return r.text(); })
    .then(function(html) {
      document.getElementById('main-content').innerHTML = html;
      document.querySelectorAll('.nav-item').forEach(function(n){ n.classList.remove('active'); });
      var navActivo = document.getElementById('nav-' + paginaInicial);
      if (navActivo) navActivo.classList.add('active');

      if (paginaInicial === 'motorizados') initMotorizados();
      else if (paginaInicial === 'clientes') initClientes();
      else initPedidos();
    })
    .catch(function(err) {
      console.error('Error carga inicial:', err);
    });
});

/* Lee la sesión guardada en localStorage (objeto usuario) */
function _obtenerSesion() {
  var raw = localStorage.getItem('velox_usuario');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch(e) { return null; }
}

/* Oculta del menú lateral las secciones que el rol "motorizado" no debe ver */
function _aplicarPermisosPorRol() {
  var sesion = _obtenerSesion();
  if (!sesion) return;

  if (sesion.rol === 'motorizado') {
    /* Motorizado: ocultar todo menos lo suyo */
    ['nav-pedidos','nav-clientes','nav-tarifas','nav-caja'].forEach(function(navId) {
      var el = document.getElementById(navId); if (el) el.style.display = 'none';
    });
    ['nav-motorizados','nav-evidencias','nav-asignacion','nav-usuarios'].forEach(function(navId) {
      var el = document.getElementById(navId); if (el) el.style.display = '';
    });
    var navUT = document.getElementById('nav-usuarios-tienda');
    if (navUT) navUT.style.display = 'none';

  } else if (sesion.rol === 'tienda') {
    /* Tienda: solo ve Clientes, Evidencias y Usuarios Tienda */
    ['nav-pedidos','nav-motorizados','nav-tarifas','nav-caja',
     'nav-asignacion','nav-usuarios'].forEach(function(navId) {
      var el = document.getElementById(navId); if (el) el.style.display = 'none';
    });
    ['nav-clientes','nav-evidencias','nav-usuarios-tienda'].forEach(function(navId) {
      var el = document.getElementById(navId); if (el) el.style.display = '';
    });

  } else if (sesion.rol !== 'admin') {
    var navUsuarios = document.getElementById('nav-usuarios');
    if (navUsuarios) navUsuarios.style.display = 'none';
    var navUT2 = document.getElementById('nav-usuarios-tienda');
    if (navUT2) navUT2.style.display = 'none';
  } else {
    /* Admin: mostrar todo */
    var navUT3 = document.getElementById('nav-usuarios-tienda');
    if (navUT3) navUT3.style.display = '';
  }
}


/* ════════════════════════════════════════════
   SESIÓN DE USUARIO
════════════════════════════════════════════ */
function _mostrarUsuarioSesion() {
  var raw = localStorage.getItem('velox_usuario');
  if (!raw) return;
  try {
    var u = JSON.parse(raw);
    var nombreEl = document.getElementById('usuario-nombre');
    var rolEl    = document.getElementById('usuario-rol');
    var avatarEl = document.getElementById('usuario-avatar');
    if (nombreEl) nombreEl.textContent = u.nombre || u.email || 'Usuario';
    if (rolEl)    rolEl.textContent    = u.rol || '';
    if (avatarEl) {
      var iniciales = (u.nombre || u.email || '?').trim().split(/\s+/).map(function(p){ return p[0]; }).slice(0,2).join('').toUpperCase();
      avatarEl.textContent = iniciales;
    }
  } catch (e) { /* sesión inválida */ }
}

window.cerrarSesion = function() {
  localStorage.removeItem('velox_usuario');
  window.location.href = 'login.html';
};
