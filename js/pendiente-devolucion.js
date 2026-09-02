/* ============================================================
   pendiente-devolucion.js — Página "Pendiente devolución"
   Reutiliza _calificaDevolucion (js/motorizados.js) y
   _filaOrdenPedido (js/pedidos.js): esta página no filtra ni
   arma las filas por su cuenta, así no queda una segunda copia
   de esa lógica que se pueda desincronizar de "Todos los pedidos".

   initPendienteDevolucion() — entrada desde el menú: arma los
   comboboxes de filtro (una sola vez) y carga la tabla.
   _recargarTablaPendienteDevolucion() — solo recarga los datos;
   la usan las confirmaciones de devolución para refrescar esta
   página en vivo sin volver a armar los comboboxes (si no,
   quedarían duplicados en cada refresco).
   ============================================================ */

window.initPendienteDevolucion = async function() {
  if (typeof _cargarCatalogos === 'function') await _cargarCatalogos();
  _initFiltrosPendienteDevolucion();
  await _recargarTablaPendienteDevolucion();
};

function _initFiltrosPendienteDevolucion() {
  if (typeof initComboBuscable !== 'function') return;

  initComboBuscable('f-filtro-tienda-pendiente-devolucion', function() {
    return (typeof CATALOGO_TIENDAS !== 'undefined' ? CATALOGO_TIENDAS : []).map(function(t) {
      return { value: t.nombre, label: t.nombre };
    });
  }, function() { filtrarTablaPendienteDevolucion(); });

  initComboBuscable('f-filtro-motorizado-pendiente-devolucion', function() {
    return (typeof CATALOGO_MOTORIZADOS !== 'undefined' ? CATALOGO_MOTORIZADOS : []).map(function(m) {
      return { value: m.nombre, label: m.nombre + (m.zona ? ' — ' + m.zona : '') };
    });
  }, function() { filtrarTablaPendienteDevolucion(); });
}

window._recargarTablaPendienteDevolucion = async function() {
  var tbody = document.getElementById('tbody-pendiente-devolucion');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="15" style="text-align:center;padding:24px;color:var(--color-text-tertiary)">' +
    '<i class="ti ti-loader"></i> Cargando...</td></tr>';

  try {
    var r = await fetch('/api/ordenes');
    if (!r.ok) throw new Error('No se pudieron cargar las órdenes');
    var ordenes = await r.json();

    var filtradas = ordenes.filter(function(o) {
      return typeof _calificaDevolucion === 'function' && _calificaDevolucion(o.estado, o.condicionEspecial, o.devuelto);
    });

    var elTotal = document.getElementById('total-pendiente-devolucion');
    if (elTotal) elTotal.textContent = filtradas.length + (filtradas.length === 1 ? ' orden' : ' órdenes');

    if (filtradas.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="15" style="padding:0;border:none">' +
          '<div class="empty-state">' +
            '<div class="empty-state-icon"><i class="ti ti-circle-check"></i></div>' +
            '<div class="empty-state-title">No hay nada pendiente</div>' +
            '<div class="empty-state-sub">Ninguna orden necesita confirmar devolución ni tiene condición especial en este momento.</div>' +
          '</div>' +
        '</td></tr>';
    } else {
      tbody.innerHTML = filtradas.map(_filaOrdenPedido).join('');
    }
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="15" style="text-align:center;padding:24px;color:#A32D2D">Error al cargar las órdenes.</td></tr>';
    return;
  }

  if (typeof filtrarTablaPendienteDevolucion === 'function') filtrarTablaPendienteDevolucion();
};
