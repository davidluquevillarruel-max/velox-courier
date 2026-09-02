/* ============================================================
   devolucion-tienda.js — Página "Devolución Tienda"
   Muestra las órdenes Canceladas o con condición especial cuyo
   Sub-estado (ver _subEstadoOrden en js/pedidos.js) es "en-almacen":
   ya volvieron a la oficina pero todavía no se le devolvieron a la
   tienda. Reutiliza esa función y _badgeCondicionEspecial para no
   repetir esa lógica acá.

   initDevolucionTienda() — entrada desde el menú: arma los
   comboboxes de filtro (una sola vez) y carga la tabla.
   _recargarTablaDevolucionTienda() — solo recarga los datos; la
   usan las confirmaciones de devolución para refrescar esta
   página en vivo sin volver a armar los comboboxes.
   ============================================================ */

/* Motivo: "Cancelado" o la condición especial que tenga */
function _motivoDevolucionTienda(o) {
  if (o.condicionEspecial) {
    return typeof _badgeCondicionEspecial === 'function'
      ? _badgeCondicionEspecial(o.condicionEspecial)
      : o.condicionEspecial;
  }
  return '<span class="badge no-entregado">Cancelado</span>';
}

function _enAlmacen(o) {
  return typeof _subEstadoOrden === 'function' && _subEstadoOrden(o) === 'en-almacen';
}

window.initDevolucionTienda = async function() {
  if (typeof _cargarCatalogos === 'function') await _cargarCatalogos();
  _initFiltrosDevolucionTienda();
  await _recargarTablaDevolucionTienda();
};

function _initFiltrosDevolucionTienda() {
  if (typeof initComboBuscable !== 'function') return;

  initComboBuscable('f-filtro-tienda-devolucion-tienda', function() {
    return (typeof CATALOGO_TIENDAS !== 'undefined' ? CATALOGO_TIENDAS : []).map(function(t) {
      return { value: t.nombre, label: t.nombre };
    });
  }, function() { filtrarTablaDevolucionTienda(); });

  initComboBuscable('f-filtro-motorizado-devolucion-tienda', function() {
    return (typeof CATALOGO_MOTORIZADOS !== 'undefined' ? CATALOGO_MOTORIZADOS : []).map(function(m) {
      return { value: m.nombre, label: m.nombre + (m.zona ? ' — ' + m.zona : '') };
    });
  }, function() { filtrarTablaDevolucionTienda(); });
}

window._recargarTablaDevolucionTienda = async function() {
  var tbody = document.getElementById('tbody-devolucion-tienda');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--color-text-tertiary)">' +
    '<i class="ti ti-loader"></i> Cargando...</td></tr>';

  try {
    var r = await fetch('/api/ordenes');
    if (!r.ok) throw new Error('No se pudieron cargar las órdenes');
    var ordenes = await r.json();

    var enAlmacen = ordenes.filter(_enAlmacen);

    var elTotal = document.getElementById('total-devolucion-tienda');
    if (elTotal) elTotal.textContent = enAlmacen.length + (enAlmacen.length === 1 ? ' orden' : ' órdenes');

    if (enAlmacen.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="9" style="padding:0;border:none">' +
          '<div class="empty-state">' +
            '<div class="empty-state-icon"><i class="ti ti-circle-check"></i></div>' +
            '<div class="empty-state-title">Nada en almacén</div>' +
            '<div class="empty-state-sub">No hay productos pendientes de devolver a la tienda en este momento.</div>' +
          '</div>' +
        '</td></tr>';
    } else {
      tbody.innerHTML = enAlmacen.map(function(o) {
        return '<tr>' +
          '<td><strong>#' + o.codigo + '</strong></td>' +
          '<td>' + o.tienda + '</td>' +
          '<td>' + (o.dest_nombre || '—') + '</td>' +
          '<td>' + o.distrito + '</td>' +
          '<td>' + (o.motorizado || '<span style="color:var(--color-text-tertiary)">Sin asignar</span>') + '</td>' +
          '<td>' + _motivoDevolucionTienda(o) + '</td>' +
          '<td style="font-size:12px;color:var(--color-text-secondary)">' + (typeof _fechaDisplay === 'function' ? _fechaDisplay(o.fecha) : o.fecha) + '</td>' +
          '<td>' + (typeof _badgeSubEstado === 'function' ? _badgeSubEstado(o) : 'En almacén') + '</td>' +
          '<td><button class="btn btn-primary btn-sm" onclick="confirmarDevolucionTienda(' + o.id + ', this)">' +
            '<i class="ti ti-check"></i> Devuelto</button></td>' +
        '</tr>';
      }).join('');
    }
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:#A32D2D">Error al cargar las órdenes.</td></tr>';
    return;
  }

  if (typeof filtrarTablaDevolucionTienda === 'function') filtrarTablaDevolucionTienda();
};

/* Confirma que el producto ya se le devolvió físicamente a la tienda.
   Refresca esta página y "Todos los pedidos" al toque, sin F5. */
window.confirmarDevolucionTienda = async function(ordenId, btnEl) {
  if (!confirm('¿Confirmar que este producto ya se le devolvió a la tienda?')) return;
  if (btnEl) btnEl.disabled = true;

  try {
    var r = await fetch('/api/ordenes/' + ordenId + '/devolver-tienda', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
    });
    var data = await r.json().catch(function(){ return {}; });
    if (!r.ok) throw new Error(data.error || 'No se pudo confirmar la devolución a la tienda');

    if (typeof showNotif === 'function') showNotif('Producto devuelto a la tienda');

    _recargarTablaDevolucionTienda();
    if (typeof renderPedidos === 'function') renderPedidos();
    if (typeof _recargarTablaPendienteDevolucion === 'function') _recargarTablaPendienteDevolucion();
  } catch (err) {
    if (btnEl) btnEl.disabled = false;
    if (typeof showNotif === 'function') showNotif(err.message || 'Error al confirmar la devolución a la tienda');
  }
};
