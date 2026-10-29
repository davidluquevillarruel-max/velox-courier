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

   Refresco suave (como "Todos los pedidos"): el "Cargando..." y el
   mensaje de error solo se ven en la carga inicial. Después se traen
   los datos y recién ahí se cambian las filas, de una vez; si nada
   cambió, la tabla no se toca (no se mueve el scroll ni lo que se
   está por tocar), y si falla la red queda como estaba.
   ============================================================ */

var _ultimoHtmlPendienteDevolucion = null;

window.initPendienteDevolucion = async function() {
  if (typeof _cargarCatalogos === 'function') await _cargarCatalogos();
  _initFiltrosPendienteDevolucion();
  await _recargarTablaPendienteDevolucion({ inicial: true });

  if (typeof iniciarRefrescoAutomatico === 'function') {
    iniciarRefrescoAutomatico('tbody-pendiente-devolucion', _recargarTablaPendienteDevolucion);
  }
};

function _initFiltrosPendienteDevolucion() {
  if (typeof initComboBuscable !== 'function') return;

  initComboBuscable('f-filtro-tienda-pendiente-devolucion', function() {
    return typeof opcionesFiltroTiendas === 'function' ? opcionesFiltroTiendas('chk-inactivos-pendiente-devolucion') : [];
  }, function() { filtrarTablaPendienteDevolucion(); });

  initComboBuscable('f-filtro-motorizado-pendiente-devolucion', function() {
    return typeof opcionesFiltroMotorizados === 'function' ? opcionesFiltroMotorizados('chk-inactivos-pendiente-devolucion') : [];
  }, function() { filtrarTablaPendienteDevolucion(); });
}

/**
 * @param {{inicial: boolean}} [opciones] - inicial = entrada a la
 *   página: muestra "Cargando..." y, si falla, el error. Sin esto
 *   (refresco automático, después de confirmar) no se ve nada de eso.
 */
window._recargarTablaPendienteDevolucion = async function(opciones) {
  var inicial = !!(opciones && opciones.inicial);
  var tbody = document.getElementById('tbody-pendiente-devolucion');
  if (!tbody) return;

  if (inicial) {
    _ultimoHtmlPendienteDevolucion = null;
    tbody.innerHTML = '<tr><td colspan="15" style="text-align:center;padding:24px;color:var(--color-text-tertiary)">' +
      '<i class="ti ti-loader"></i> Cargando...</td></tr>';
  }

  var html;
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
      html =
        '<tr><td colspan="15" style="padding:0;border:none">' +
          '<div class="empty-state">' +
            '<div class="empty-state-icon"><i class="ti ti-circle-check"></i></div>' +
            '<div class="empty-state-title">No hay nada pendiente</div>' +
            '<div class="empty-state-sub">Ninguna orden necesita confirmar devolución ni tiene condición especial en este momento.</div>' +
          '</div>' +
        '</td></tr>';
    } else {
      html = filtradas.map(_filaOrdenPedido).join('');
    }
  } catch (err) {
    if (inicial) {
      tbody.innerHTML = '<tr><td colspan="15" style="text-align:center;padding:24px;color:#A32D2D">Error al cargar las órdenes.</td></tr>';
    }
    return;
  }

  /* Nada cambió desde el último pintado: no se toca la tabla */
  if (html === _ultimoHtmlPendienteDevolucion) return;
  _ultimoHtmlPendienteDevolucion = html;
  tbody.innerHTML = html;

  if (typeof filtrarTablaPendienteDevolucion === 'function') filtrarTablaPendienteDevolucion();
};
