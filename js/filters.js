/* ============================================================
   filters.js — Búsqueda y filtro de tablas
   CourierAdmin · Sistema de gestión interna
   ============================================================ */

/**
 * Filtra las filas de una tabla por texto libre.
 * Se enlaza al evento oninput del input de búsqueda.
 * @param {HTMLInputElement} inp - El campo de búsqueda
 * @param {string} tableId - ID del elemento <table>
 */
function filterTable(inp, tableId) {
  const value = inp.value.toLowerCase().trim();
  const rows = document.querySelectorAll('#' + tableId + ' tbody tr');

  rows.forEach(row => {
    const match = row.textContent.toLowerCase().includes(value);
    row.style.display = match ? '' : 'none';
  });
}

/**
 * Filtra las filas de una tabla por estado (badge).
 * Se enlaza al evento onchange del select de estado.
 * @param {HTMLSelectElement} sel - El select de filtro
 * @param {string} tableId - ID del elemento <table>
 */
function filterByStatus(sel, tableId) {
  const value = sel.value.toLowerCase().trim();
  const rows = document.querySelectorAll('#' + tableId + ' tbody tr');

  rows.forEach(row => {
    const match = !value || row.textContent.toLowerCase().includes(value);
    row.style.display = match ? '' : 'none';
  });
}
