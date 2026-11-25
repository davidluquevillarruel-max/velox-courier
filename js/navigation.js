/* ============================================================
   navigation.js — Carga dinámica de páginas (SPA)
   Funciona con Node.js en localhost:3000
   ============================================================ */

function showPage(id) {
  var sesion = _obtenerSesion();

  /* ── Restricciones por rol ── */
  if (sesion) {
    var rol = sesion.rol;
    var _moto   = ['motorizados','gestion-motos','evidencias','asignacion','usuarios'];
    var _tienda = ['clientes','evidencias','usuarios'];

    if (rol === 'motorizado' && !_moto.includes(id))   id = 'motorizados';
    if (rol === 'tienda'     && !_tienda.includes(id)) id = 'clientes';
    /* Usuarios: el admin gestiona; motorizado y tienda solo ven el suyo
       (para cambiar su contraseña) */
    if (id === 'usuarios' && rol !== 'admin' && rol !== 'motorizado' && rol !== 'tienda') {
      id = 'pedidos';
    }
    /* Gestión / Motorizado: plata de la Caja; gestores y el motorizado
       (este, solo su propio detalle: lo frena el servidor) */
    if (id === 'gestion-motos' && rol !== 'admin' && rol !== 'operador' && rol !== 'motorizado') id = 'pedidos';
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
      if (id === 'pendiente-devolucion') initPendienteDevolucion();
      if (id === 'devolucion-tienda') initDevolucionTienda();
      if (id === 'clientes')         initClientes();
      if (id === 'gestion-motos')    initGestionMotos();
      if (id === 'evidencias')       initEvidencias();
      if (id === 'tarifas')          initTarifas();
      if (id === 'caja')             initCaja();
      if (id === 'motorizados')      initMotorizados();
      if (id === 'asignacion')       initAsignacion();
      if (id === 'usuarios')         initUsuarios();
      if (id === 'tiendas')          initTiendas();
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
      if (typeof _resetFiltroDetalleTienda === 'function') _resetFiltroDetalleTienda();
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

/* Nombre del panel (arriba del menú) y título de la pestaña según el rol:
   motorizado → "Motorizado", tienda → "Tienda", el resto (admin, operador,
   visor) → "Admin". El <wbr> deja partirlo en dos líneas solo si no entra
   (menú de 200 px entre 769 y 1024 px). Corre al cargar este archivo (está
   al final del <body>) para que no se vea "Admin" un instante. */
function _aplicarNombrePanel() {
  var sesion = _obtenerSesion();
  var rol = sesion && sesion.rol;
  var sufijo = rol === 'motorizado' ? 'Motorizado' : rol === 'tienda' ? 'Tienda' : 'Admin';
  var el = document.getElementById('logo-name');
  if (el) el.innerHTML = 'VeloxCourier<wbr>' + sufijo;
  document.title = 'Velox Courier - ' + sufijo;
}
_aplicarNombrePanel();

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

  /* Gestión / Motorizado: admin, operador y el motorizado (lo suyo) */
  if (sesion.rol !== 'admin' && sesion.rol !== 'operador' && sesion.rol !== 'motorizado') {
    var navGm = document.getElementById('nav-gestion-motos');
    if (navGm) navGm.style.display = 'none';
  }

  if (sesion.rol === 'motorizado') {
    /* Motorizado: ocultar todo menos lo suyo */
    ['nav-pedidos','nav-pendiente-devolucion','nav-devolucion-tienda','nav-clientes','nav-tiendas','nav-tarifas','nav-caja'].forEach(function(navId) {
      var el = document.getElementById(navId); if (el) el.style.display = 'none';
    });
    ['nav-motorizados','nav-evidencias','nav-asignacion','nav-usuarios'].forEach(function(navId) {
      var el = document.getElementById(navId); if (el) el.style.display = '';
    });

  } else if (sesion.rol === 'tienda') {
    /* Tienda: solo ve Clientes, Evidencias y su usuario */
    ['nav-pedidos','nav-pendiente-devolucion','nav-devolucion-tienda','nav-motorizados','nav-tiendas','nav-tarifas','nav-caja',
     'nav-asignacion'].forEach(function(navId) {
      var el = document.getElementById(navId); if (el) el.style.display = 'none';
    });
    ['nav-clientes','nav-evidencias','nav-usuarios'].forEach(function(navId) {
      var el = document.getElementById(navId); if (el) el.style.display = '';
    });
    /* Para la tienda, Clientes / Tiendas es su propia cuenta (js/clientes.js,
       _initMiCuentaTienda): el menú dice lo mismo que el título */
    var navCli = document.getElementById('nav-clientes');
    if (navCli) navCli.innerHTML = '<i class="ti ti-building-store" aria-hidden="true"></i> Mi cuenta';

  } else if (sesion.rol !== 'admin') {
    var navUsuarios = document.getElementById('nav-usuarios');
    if (navUsuarios) navUsuarios.style.display = 'none';
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

window.cerrarSesion = async function() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch (e) { /* aunque falle, salimos igual */ }
  localStorage.removeItem('velox_usuario');
  window.location.href = 'login.html';
};
