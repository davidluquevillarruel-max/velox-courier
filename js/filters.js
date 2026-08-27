/* ============================================================
   filters.js — Filtros combinados de la tabla de pedidos
   Los 4 filtros (texto, tienda, motorizado, estado) se aplican
   juntos ("Y"): cada uno recorta sobre lo que dejaron los demás,
   en vez de pisarse entre sí.
   ============================================================ */

/**
 * Filtra las filas de #tabla-pedidos-main combinando todos los
 * campos de filtro activos. Se llama desde cada input/select de
 * filtro (ver pages/pedidos.html) y también después de repintar
 * la tabla (ver renderPedidos en js/pedidos.js), para que el
 * filtro no se pierda al refrescar.
 */
function filtrarTablaPedidos() {
  var elTexto  = document.getElementById('f-buscar-pedidos');
  var elTienda = document.getElementById('f-filtro-tienda-pedidos');
  var elMoto   = document.getElementById('f-filtro-motorizado-pedidos');
  var elEstado = document.getElementById('f-filtro-estado-pedidos');

  var texto      = elTexto  ? elTexto.value.toLowerCase().trim() : '';
  var tienda     = elTienda ? elTienda.value.trim() : '';
  var motorizado = elMoto   ? elMoto.value.trim()   : '';
  var estado     = elEstado ? elEstado.value : '';

  var rows = document.querySelectorAll('#tabla-pedidos-main tbody tr');

  rows.forEach(function(row) {
    var celdas = row.querySelectorAll('td');
    if (celdas.length < 7) { row.style.display = ''; return; } /* fila de "sin órdenes" */

    var matchTexto  = !texto      || row.textContent.toLowerCase().includes(texto);
    var matchTienda = !tienda     || celdas[1].textContent.trim() === tienda;
    var matchMoto   = !motorizado || celdas[5].textContent.trim() === motorizado;
    var matchEstado = !estado     || celdas[6].textContent.trim() === estado;

    row.style.display = (matchTexto && matchTienda && matchMoto && matchEstado) ? '' : 'none';
  });
}
