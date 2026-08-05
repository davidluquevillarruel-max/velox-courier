/* ============================================================
   utils.js — Funciones utilitarias globales
   CourierAdmin · Sistema de gestión interna
   ============================================================ */

/**
 * Muestra la fecha actual en el footer del sidebar.
 */
/* ============================================================
   AUTENTICACIÓN POR COOKIE — interceptor global de fetch
   Pegar este bloque al INICIO de utils.js (después de la cabecera).

   Hace tres cosas, para TODAS las llamadas fetch del sistema, sin
   tener que tocar cada archivo:
     1. Envía siempre la cookie de sesión (credentials: 'include').
     2. Si el servidor responde 401 (sesión caída/inválida),
        limpia la sesión local y manda al login.
     3. Evita bucles: no redirige si ya estamos en login.html.
   ============================================================ */
(function() {
  var _fetch = window.fetch;

  window.fetch = function(url, options) {
    options = options || {};
    /* Adjuntar la cookie en cada petición al mismo origen */
    if (options.credentials === undefined) {
      options.credentials = 'include';
    }

    return _fetch(url, options).then(function(res) {
      /* Sesión expirada o no autenticado → volver al login */
      if (res.status === 401) {
        var enLogin = window.location.pathname.indexOf('login.html') !== -1;
        if (!enLogin) {
          localStorage.removeItem('velox_usuario');
          window.location.href = 'login.html';
        }
      }
      return res;
    });
  };

  /* Cerrar sesión: borra la cookie en el servidor y limpia local */
  window.cerrarSesion = async function() {
    try {
      await _fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (e) { /* ignorar: igual limpiamos y salimos */ }
    localStorage.removeItem('velox_usuario');
    window.location.href = 'login.html';
  };
})();



(function initFecha() {
  const hoy = new Date();
  const el = document.getElementById('fecha-hoy');
  if (el) {
    el.textContent = hoy.toLocaleDateString('es-PE', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  }
})();

/**
 * Muestra una notificación flotante temporal.
 * @param {string} msg - Texto a mostrar
 * @param {number} duracion - Milisegundos antes de ocultarse (default: 2500)
 */
function showNotif(msg, duracion = 2500) {
  const n = document.getElementById('notif');
  if (!n) return;
  n.textContent = msg;
  n.style.display = 'block';
  clearTimeout(n._timer);
  n._timer = setTimeout(() => { n.style.display = 'none'; }, duracion);
}
