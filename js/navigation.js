/* ============================================================
   navigation.js — Carga dinámica de páginas (SPA)
   Funciona con Node.js en localhost:3000
   ============================================================ */

function showPage(id) {
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

      if (id === 'pedidos')     initPedidos();
      if (id === 'clientes')    initClientes();
      if (id === 'evidencias')  initEvidencias();
      if (id === 'tarifas')     initTarifas();
      if (id === 'caja')        initCaja();
      if (id === 'motorizados') initMotorizados();
      if (id === 'asignacion')  initAsignacion();
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
  fetch('pages/pedidos.html')
    .then(function(r) { return r.text(); })
    .then(function(html) {
      document.getElementById('main-content').innerHTML = html;
      initPedidos();
    })
    .catch(function(err) {
      console.error('Error carga inicial:', err);
    });
});


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
