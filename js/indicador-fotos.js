/* ============================================================
   indicador-fotos.js — Indicador visible de la cola de fotos
   Solo la parte visual de js/cola-fotos.js: una pastilla fija
   abajo a la izquierda, en todas las páginas, que dice cuántas
   fotos faltan subir. Si la cola está vacía, no se ve.

   · Ámbar: fotos esperando subir (con "· sin señal" si el
     navegador avisa que está desconectado).
   · Rojo: hay fotos con error, que no se reintentan solas.

   Al tocarla abre un panel con la lista y "Reintentar ahora" (todas).
   Cada foto con error tiene además "Reintentar" y "Descartar".

   Se entera de los cambios por el evento 'velox:cola-fotos' que
   emite la cola; no toca IndexedDB directamente.
   ============================================================ */

var _indicadorFotosItems = [];

var _TIPOS_FOTO_LABEL = {
  foto_producto:        'Foto del producto',
  evidencia_medio_pago: 'Evidencia de pago',
};

function _escIndicador(txt) {
  return String(txt == null ? '' : txt)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _plural(n, uno, varios) {
  return n + ' ' + (n === 1 ? uno : varios);
}

function _haceCuanto(ms) {
  var min = Math.floor((Date.now() - ms) / 60000);
  if (min < 1)  return 'recién';
  if (min < 60) return 'hace ' + min + ' min';
  var h = Math.floor(min / 60);
  if (h < 24)   return 'hace ' + h + ' h';
  return 'hace ' + _plural(Math.floor(h / 24), 'día', 'días');
}

/* Relee la cola y repinta la pastilla (y el panel, si está abierto) */
async function refrescarIndicadorFotos() {
  if (typeof obtenerColaFotos !== 'function') return;
  try {
    _indicadorFotosItems = await obtenerColaFotos();
  } catch (err) {
    console.error('Indicador de fotos:', err);
    return;
  }
  _pintarPastillaFotos();
  _pintarPanelFotos();
}

function _pintarPastillaFotos() {
  var pastilla = document.getElementById('indicador-fotos');
  if (!pastilla) return;

  var errores    = _indicadorFotosItems.filter(function(it) { return it.estado === 'error'; }).length;
  var pendientes = _indicadorFotosItems.length - errores;

  if (!_indicadorFotosItems.length) {
    pastilla.style.display = 'none';
    return;
  }

  var partes = [];
  if (pendientes) partes.push(_plural(pendientes, 'foto por subir', 'fotos por subir'));
  if (errores)    partes.push(_plural(errores, 'foto con error', 'fotos con error'));
  /* navigator.onLine solo es confiable cuando dice false */
  var sinSenal = pendientes && navigator.onLine === false ? ' · sin señal' : '';

  pastilla.className = 'indicador-fotos' + (errores ? ' indicador-fotos-error' : '');
  pastilla.innerHTML =
    '<i class="ti ' + (errores ? 'ti-alert-triangle' : 'ti-cloud-upload') + '" aria-hidden="true"></i>' +
    '<span>' + partes.join(' · ') + sinSenal + '</span>';
  pastilla.title = 'Ver las fotos que faltan subir';
  pastilla.style.display = 'flex';
}

function _pintarPanelFotos() {
  var panel = document.getElementById('indicador-fotos-panel');
  if (!panel || panel.style.display !== 'block') return;

  /* Se vació la cola: el panel ya no tiene nada que mostrar */
  if (!_indicadorFotosItems.length) {
    panel.style.display = 'none';
    return;
  }

  var filas = _indicadorFotosItems.map(function(it) {
    var detalle;
    if (it.estado === 'error') {
      detalle = '<div class="indicador-fotos-item-error">' + _escIndicador(it.ultimoError || 'Error al subir') + '</div>';
    } else if (it.intentos > 0) {
      detalle = '<div class="indicador-fotos-item-detalle">Reintentando (' + _plural(it.intentos, 'intento', 'intentos') + ')' +
        (it.ultimoError ? ' — ' + _escIndicador(it.ultimoError) : '') + '</div>';
    } else {
      detalle = '<div class="indicador-fotos-item-detalle">En cola</div>';
    }
    if (it.enMemoria) {
      detalle += '<div class="indicador-fotos-item-error">No se pudo guardar en el teléfono: no cierres Velox hasta que suba</div>';
    }

    return '<div class="indicador-fotos-item">' +
      '<div style="flex:1;min-width:0">' +
        '<div class="indicador-fotos-item-titulo">' + _escIndicador(_TIPOS_FOTO_LABEL[it.tipo] || 'Foto') +
          /* Las fotos encoladas antes de guardar el código no lo tienen */
          (it.codigoOrden ? ' · #' + _escIndicador(it.codigoOrden) : '') +
          ' <span>· ' + _haceCuanto(it.creada) + '</span></div>' +
        detalle +
      '</div>' +
      (it.estado === 'error'
        ? '<div class="indicador-fotos-item-acciones">' +
            '<button type="button" class="btn btn-sm" data-id="' + _escIndicador(it.idSubida) + '" onclick="reintentarFotoDesdeIndicador(this)">Reintentar</button>' +
            '<button type="button" class="btn btn-sm" data-id="' + _escIndicador(it.idSubida) + '" onclick="descartarFotoDesdeIndicador(this)">Descartar</button>' +
          '</div>'
        : '') +
    '</div>';
  }).join('');

  panel.innerHTML =
    '<div class="indicador-fotos-panel-cabecera">' +
      '<span>Fotos por subir</span>' +
      '<button type="button" onclick="cerrarPanelFotos()" aria-label="Cerrar"><i class="ti ti-x"></i></button>' +
    '</div>' +
    '<div class="indicador-fotos-lista">' + filas + '</div>' +
    '<div class="indicador-fotos-nota">Se suben solas cuando hay señal y Velox está abierto.</div>' +
    '<button type="button" id="btn-reintentar-fotos" class="btn btn-primary btn-sm" style="width:100%" onclick="reintentarFotosDesdeIndicador()">' +
      '<i class="ti ti-refresh"></i> Reintentar ahora' +
    '</button>';
}

window.togglePanelFotos = function() {
  var panel = document.getElementById('indicador-fotos-panel');
  if (!panel) return;
  if (panel.style.display === 'block') { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  _pintarPanelFotos();
};

window.cerrarPanelFotos = function() {
  var panel = document.getElementById('indicador-fotos-panel');
  if (panel) panel.style.display = 'none';
};

window.reintentarFotosDesdeIndicador = async function() {
  var btn = document.getElementById('btn-reintentar-fotos');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader"></i> Subiendo...'; }
  try {
    await reintentarColaFotos();
  } finally {
    /* El evento de la cola ya repinta; esto cubre el caso en que la
       pasada no cambió nada (sigue sin señal) */
    refrescarIndicadorFotos();
  }
};

/* "Reintentar" de una foto con error: la vuelve a la cola y la intenta
   subir ya. Si sube, desaparece de la lista; si falla de nuevo, vuelve
   a quedar con su error (el evento de la cola repinta el panel). */
window.reintentarFotoDesdeIndicador = async function(btn) {
  btn.disabled = true;
  btn.textContent = 'Subiendo...';
  try {
    await reintentarColaFotos(btn.getAttribute('data-id'));
  } finally {
    refrescarIndicadorFotos();
  }
};

window.descartarFotoDesdeIndicador = async function(btn) {
  var id   = btn.getAttribute('data-id');
  var item = _indicadorFotosItems.find(function(it) { return it.idSubida === id; });

  var mensaje = '¿Descartar esta foto? No se va a subir y se borra del teléfono.';
  /* Una evidencia descartada deja la orden con la evidencia pendiente
     (el medio de pago ya quedó guardado sin foto) */
  if (item && item.tipo === 'evidencia_medio_pago') {
    mensaje += '\n\nOjo: es una evidencia de pago. La orden va a quedar con la evidencia ' +
      'pendiente hasta que alguien suba otra foto desde "Actualizar orden".';
  }
  if (!confirm(mensaje)) return;
  await descartarFotoEnCola(id);
};

(function _iniciarIndicadorFotos() {
  window.addEventListener('velox:cola-fotos', refrescarIndicadorFotos);
  window.addEventListener('online',  refrescarIndicadorFotos);
  window.addEventListener('offline', refrescarIndicadorFotos);
  /* Al abrir Velox se pinta ya, sin esperar la primera pasada de la cola */
  refrescarIndicadorFotos();
})();
