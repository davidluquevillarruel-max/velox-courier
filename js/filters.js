/* ============================================================
   filters.js — Filtros combinados de tablas de órdenes
   Una sola función genérica (filtrarTablaOrdenes) sirve para las
   3 tablas que muestran órdenes (Todos los pedidos, Pendiente
   devolución, Devolución Tienda) — cada página solo le dice qué
   filtros tiene y en qué columna está cada dato. Todos los
   filtros activos se combinan con "Y": cada uno recorta sobre lo
   que dejaron los demás, en vez de pisarse entre sí.
   ============================================================ */

/**
 * @param {object} cfg
 * @param {string} cfg.tableId   - id de la <table> a filtrar
 * @param {number} cfg.minCols   - mínimo de <td> para considerar
 *        que es una fila real (si tiene menos, es la fila de
 *        "sin resultados" y se deja tal cual)
 * @param {object} cfg.cols      - índice (0-based) de cada columna
 *        que esta tabla tenga: tienda, motorizado, estado,
 *        condicion, devuelto, subestado
 * @param {string} [cfg.idTexto]      - input de búsqueda libre
 * @param {string} [cfg.idTienda]     - combobox de tienda
 * @param {string} [cfg.idMoto]       - combobox de motorizado
 * @param {string} [cfg.idEstado]     - select de estado
 * @param {string} [cfg.idCondicion]  - checkbox "con condición especial"
 * @param {string} [cfg.idPendiente]  - checkbox "pendientes de devolución"
 * @param {string} [cfg.idSubestado]  - select de sub-estado
 */
function filtrarTablaOrdenes(cfg) {
  var val = function(id) { var el = document.getElementById(id); return el ? el.value : ''; };
  var chk = function(id) { var el = document.getElementById(id); return el ? el.checked : false; };

  var texto      = cfg.idTexto     ? val(cfg.idTexto).toLowerCase().trim() : '';
  var tienda     = cfg.idTienda    ? val(cfg.idTienda).trim() : '';
  var motorizado = cfg.idMoto      ? val(cfg.idMoto).trim()   : '';
  var estado     = cfg.idEstado    ? val(cfg.idEstado) : '';
  var subestado  = cfg.idSubestado ? val(cfg.idSubestado) : '';
  var soloCondicion  = cfg.idCondicion ? chk(cfg.idCondicion) : false;
  var soloPendientes = cfg.idPendiente ? chk(cfg.idPendiente) : false;

  var cols = cfg.cols || {};
  var rows = document.querySelectorAll('#' + cfg.tableId + ' tbody tr');

  rows.forEach(function(row) {
    var celdas = row.querySelectorAll('td');
    if (celdas.length < (cfg.minCols || 1)) { row.style.display = ''; return; } /* fila de "sin resultados" */

    var checks = [!texto || row.textContent.toLowerCase().includes(texto)];

    if (cols.tienda != null)
      checks.push(!tienda || celdas[cols.tienda].textContent.trim() === tienda);
    if (cols.motorizado != null)
      checks.push(!motorizado || celdas[cols.motorizado].textContent.trim() === motorizado);
    if (cols.estado != null)
      checks.push(!estado || celdas[cols.estado].textContent.trim() === estado);
    if (cols.condicion != null)
      checks.push(!soloCondicion || celdas[cols.condicion].textContent.trim() !== '—');
    if (cols.devuelto != null)
      checks.push(!soloPendientes || celdas[cols.devuelto].querySelector('button') !== null);
    if (cols.subestado != null) {
      var etiqueta = subestado === 'en-almacen' ? 'En almacén' : subestado === 'devuelto' ? 'Devuelto' : '';
      checks.push(!subestado || celdas[cols.subestado].textContent.trim() === etiqueta);
    }

    row.style.display = checks.indexOf(false) === -1 ? '' : 'none';
  });
}

/* "Todos los pedidos" — la tabla con más columnas y filtros */
function filtrarTablaPedidos() {
  filtrarTablaOrdenes({
    tableId: 'tabla-pedidos-main',
    minCols: 9,
    cols: { tienda: 1, motorizado: 5, estado: 6, condicion: 7, devuelto: 8, subestado: 9 },
    idTexto: 'f-buscar-pedidos',
    idTienda: 'f-filtro-tienda-pedidos',
    idMoto: 'f-filtro-motorizado-pedidos',
    idEstado: 'f-filtro-estado-pedidos',
    idCondicion: 'f-filtro-condicion-especial',
    idPendiente: 'f-filtro-pendiente-devolucion',
    idSubestado: 'f-filtro-subestado-pedidos',
  });
}

/* "Pendiente devolución" — misma tabla que "Todos los pedidos" (mismas
   columnas), solo con los filtros de búsqueda, tienda y motorizado */
function filtrarTablaPendienteDevolucion() {
  filtrarTablaOrdenes({
    tableId: 'tabla-pendiente-devolucion',
    minCols: 9,
    cols: { tienda: 1, motorizado: 5 },
    idTexto: 'f-buscar-pendiente-devolucion',
    idTienda: 'f-filtro-tienda-pendiente-devolucion',
    idMoto: 'f-filtro-motorizado-pendiente-devolucion',
  });
}

/* "Devolución Tienda" — tabla propia, más chica (ver js/devolucion-tienda.js) */
function filtrarTablaDevolucionTienda() {
  filtrarTablaOrdenes({
    tableId: 'tabla-devolucion-tienda',
    minCols: 5,
    cols: { tienda: 1, motorizado: 4 },
    idTexto: 'f-buscar-devolucion-tienda',
    idTienda: 'f-filtro-tienda-devolucion-tienda',
    idMoto: 'f-filtro-motorizado-devolucion-tienda',
  });
}
