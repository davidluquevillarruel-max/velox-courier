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

   Refresco suave (como "Todos los pedidos"): el "Cargando..." y el
   mensaje de error solo se ven en la carga inicial. Después se traen
   los datos y recién ahí se cambian las filas, de una vez; si nada
   cambió, la tabla no se toca, y si falla la red queda como estaba.
   ============================================================ */

var _ultimoHtmlDevolucionTienda = null;

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
  await _recargarTablaDevolucionTienda({ inicial: true });

  if (typeof iniciarRefrescoAutomatico === 'function') {
    iniciarRefrescoAutomatico('tbody-devolucion-tienda', _recargarTablaDevolucionTienda);
  }
};

function _initFiltrosDevolucionTienda() {
  if (typeof initComboBuscable !== 'function') return;

  initComboBuscable('f-filtro-tienda-devolucion-tienda', function() {
    return typeof opcionesFiltroTiendas === 'function' ? opcionesFiltroTiendas('chk-inactivos-devolucion-tienda') : [];
  }, function() { filtrarTablaDevolucionTienda(); });

  initComboBuscable('f-filtro-motorizado-devolucion-tienda', function() {
    return typeof opcionesFiltroMotorizados === 'function' ? opcionesFiltroMotorizados('chk-inactivos-devolucion-tienda') : [];
  }, function() { filtrarTablaDevolucionTienda(); });
}

/**
 * @param {{inicial: boolean}} [opciones] - inicial = entrada a la
 *   página: muestra "Cargando..." y, si falla, el error. Sin esto
 *   (refresco automático, después de confirmar) no se ve nada de eso.
 */
window._recargarTablaDevolucionTienda = async function(opciones) {
  var inicial = !!(opciones && opciones.inicial);
  var tbody = document.getElementById('tbody-devolucion-tienda');
  if (!tbody) return;

  if (inicial) {
    _ultimoHtmlDevolucionTienda = null;
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--color-text-tertiary)">' +
      '<i class="ti ti-loader"></i> Cargando...</td></tr>';
  }

  var html;
  try {
    var r = await fetch('/api/ordenes');
    if (!r.ok) throw new Error('No se pudieron cargar las órdenes');
    var ordenes = await r.json();

    var enAlmacen = ordenes.filter(_enAlmacen);

    var elTotal = document.getElementById('total-devolucion-tienda');
    if (elTotal) elTotal.textContent = enAlmacen.length + (enAlmacen.length === 1 ? ' orden' : ' órdenes');

    if (enAlmacen.length === 0) {
      html =
        '<tr><td colspan="9" style="padding:0;border:none">' +
          '<div class="empty-state">' +
            '<div class="empty-state-icon"><i class="ti ti-circle-check"></i></div>' +
            '<div class="empty-state-title">Nada en almacén</div>' +
            '<div class="empty-state-sub">No hay productos pendientes de devolver a la tienda en este momento.</div>' +
          '</div>' +
        '</td></tr>';
    } else {
      html = enAlmacen.map(function(o) {
        return '<tr>' +
          '<td><strong>#' + o.codigo + '</strong></td>' +
          '<td>' + o.tienda + '</td>' +
          '<td>' + (o.dest_nombre || '—') + '</td>' +
          '<td>' + o.distrito + '</td>' +
          '<td>' + (o.motorizado || '<span style="color:var(--color-text-tertiary)">Sin asignar</span>') + '</td>' +
          '<td>' + _motivoDevolucionTienda(o) + '</td>' +
          '<td style="font-size:12px;color:var(--color-text-secondary)">' + (typeof _celdaFechaOrden === 'function' ? _celdaFechaOrden(o) : (o.fecha_reparto || o.fecha)) + '</td>' +
          '<td>' + (typeof _badgeSubEstado === 'function' ? _badgeSubEstado(o) : 'En almacén') + '</td>' +
          '<td><button class="btn btn-primary btn-sm" data-codigo="' + String(o.codigo || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '" ' +
            'onclick="confirmarDevolucionTienda(' + o.id + ', this)">' +
            '<i class="ti ti-check"></i> Devuelto</button></td>' +
        '</tr>';
      }).join('');
    }
  } catch (err) {
    if (inicial) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:#A32D2D">Error al cargar las órdenes.</td></tr>';
    }
    return;
  }

  /* Nada cambió desde el último pintado: no se toca la tabla */
  if (html === _ultimoHtmlDevolucionTienda) return;
  _ultimoHtmlDevolucionTienda = html;
  tbody.innerHTML = html;

  if (typeof filtrarTablaDevolucionTienda === 'function') filtrarTablaDevolucionTienda();
};

/* Foto tomada para una entrega que no se pudo confirmar: el reintento
   la reusa en vez de pedirla de nuevo (como en confirmarDevolucionOrden) */
var _fotoDevolucionTiendaSinConfirmar = null; /* { ordenId, blob } */

/* Confirma que el producto ya se le devolvió físicamente a la tienda.
   Primero pide la foto de la entrega (js/camara-foto.js; aceptarla es
   la confirmación); con PATCH /devolver-tienda ya hecho, la foto entra
   a la cola (js/cola-fotos.js) y sube en segundo plano.
   Refresca esta página y "Todos los pedidos" al toque, sin F5. */
window.confirmarDevolucionTienda = async function(ordenId, btnEl) {
  var codigo = (btnEl && btnEl.getAttribute('data-codigo')) || '';

  var foto;
  if (_fotoDevolucionTiendaSinConfirmar && _fotoDevolucionTiendaSinConfirmar.ordenId == ordenId) {
    foto = _fotoDevolucionTiendaSinConfirmar.blob;
  } else {
    foto = await pedirFoto({
      titulo:  'Foto de la entrega a la tienda' + (codigo ? ' — #' + codigo : ''),
      textoOk: 'Usar foto y confirmar',
    });
    if (!foto) return;
  }
  if (btnEl) btnEl.disabled = true;

  try {
    var r = await fetch('/api/ordenes/' + ordenId + '/devolver-tienda', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
    });
    var data = await r.json().catch(function(){ return {}; });
    if (!r.ok) throw new Error(data.error || 'No se pudo confirmar la devolución a la tienda');

    _fotoDevolucionTiendaSinConfirmar = null;
    try {
      await encolarFoto(ordenId, 'foto_devolucion_tienda', foto, codigo);
    } catch (errCola) {
      console.error('Cola de fotos (devolución a tienda):', errCola);
      if (typeof showNotif === 'function') showNotif('La devolución quedó confirmada, pero no se pudo guardar la foto en este dispositivo.', 5000);
    }

    if (typeof showNotif === 'function') showNotif('Producto devuelto a la tienda');

    _recargarTablaDevolucionTienda();
    if (typeof renderPedidos === 'function') renderPedidos();
    if (typeof _recargarTablaPendienteDevolucion === 'function') _recargarTablaPendienteDevolucion();
  } catch (err) {
    _fotoDevolucionTiendaSinConfirmar = { ordenId: ordenId, blob: foto };
    if (btnEl) btnEl.disabled = false;
    if (typeof showNotif === 'function') showNotif(err.message || 'Error al confirmar la devolución a la tienda');
  }
};
