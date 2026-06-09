/* ============================================================
   utils.js — Funciones utilitarias globales
   CourierAdmin · Sistema de gestión interna
   ============================================================ */

/**
 * Muestra la fecha actual en el footer del sidebar.
 */
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
