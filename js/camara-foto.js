/* ============================================================
   camara-foto.js — Pedir una foto con vista previa y OK
   pedirFoto() abre la cámara, deja ver la foto tomada y devuelve el
   JPEG ya comprimido recién cuando el usuario la acepta. Solo
   CAPTURA: quien la llama la manda a la cola de siempre
   (encolarFoto en js/cola-fotos.js), que la sube en segundo plano.

   Reusa la cámara de js/pedidos.js (_pedirStreamCamara,
   _cuadroDeVideo y _FOTO_CALIDAD), por eso va después de ese
   archivo. Sin cámara en vivo (sin getUserMedia, http por IP,
   permiso denegado) ofrece elegir la foto con el input nativo, que
   en el celular abre la cámara del teléfono.

   La usan las fotos de devolución: "Confirmar devolución"
   (js/motorizados.js) y "Devuelto" de Devolución Tienda
   (js/devolucion-tienda.js).
   ============================================================ */

var _pfStream   = null;
var _pfBlob     = null;
var _pfUrl      = null;
var _pfResolver = null;

/* El overlay se arma una sola vez y se reutiliza */
function _overlayPedirFoto() {
  var overlay = document.getElementById('pedir-foto-overlay');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'pedir-foto-overlay';
  overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:1300;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML =
    '<div style="width:100%;max-width:520px;display:flex;flex-direction:column;gap:12px">' +
      '<div id="pedir-foto-titulo" style="color:#fff;font-size:15px;font-weight:600;text-align:center"></div>' +
      '<div id="pedir-foto-aviso" style="display:none;color:#fff;font-size:13px;text-align:center"></div>' +
      '<video id="pedir-foto-video" autoplay playsinline muted ' +
             'style="width:100%;max-height:62vh;background:#000;border-radius:var(--radius-md);object-fit:contain"></video>' +
      '<img id="pedir-foto-img" alt="Foto tomada" ' +
           'style="display:none;width:100%;max-height:62vh;background:#000;border-radius:var(--radius-md);object-fit:contain">' +
      '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">' +
        '<button type="button" class="btn btn-primary" id="pedir-foto-btn-capturar" onclick="_capturarPedirFoto()">' +
          '<i class="ti ti-camera"></i> Capturar' +
        '</button>' +
        '<button type="button" class="btn btn-primary" id="pedir-foto-btn-archivo" onclick="_elegirArchivoPedirFoto()">' +
          '<i class="ti ti-photo"></i> Elegir foto' +
        '</button>' +
        '<button type="button" class="btn btn-primary" id="pedir-foto-btn-ok" onclick="_aceptarPedirFoto()">' +
          '<i class="ti ti-check"></i> <span id="pedir-foto-texto-ok">Usar foto</span>' +
        '</button>' +
        /* .btn es transparente: sobre el fondo negro necesita el suyo */
        '<button type="button" class="btn" id="pedir-foto-btn-repetir" onclick="_repetirPedirFoto()" style="background:var(--color-bg-primary)">' +
          '<i class="ti ti-refresh"></i> Repetir' +
        '</button>' +
        '<button type="button" class="btn" onclick="_cancelarPedirFoto()" style="background:var(--color-bg-primary)">' +
          '<i class="ti ti-x"></i> Cancelar' +
        '</button>' +
      '</div>' +
      '<input type="file" id="pedir-foto-input" accept="image/*" capture="environment" ' +
             'style="display:none" onchange="_onArchivoPedirFoto(this)">' +
    '</div>';
  document.body.appendChild(overlay);
  return overlay;
}

/* Qué se ve en cada paso: 'camara' (video en vivo), 'archivo' (sin
   cámara en vivo: botón para elegir la foto) o 'vista' (foto tomada,
   esperando el OK) */
function _pasoPedirFoto(paso, aviso) {
  var mostrar = function(id, si) {
    var el = document.getElementById(id);
    if (el) el.style.display = si ? '' : 'none';
  };
  mostrar('pedir-foto-video',       paso === 'camara');
  mostrar('pedir-foto-btn-capturar', paso === 'camara');
  mostrar('pedir-foto-btn-archivo', paso === 'archivo');
  mostrar('pedir-foto-img',         paso === 'vista');
  mostrar('pedir-foto-btn-ok',      paso === 'vista');
  mostrar('pedir-foto-btn-repetir', paso === 'vista');

  var elAviso = document.getElementById('pedir-foto-aviso');
  if (elAviso) {
    elAviso.textContent = aviso || '';
    elAviso.style.display = aviso ? 'block' : 'none';
  }
}

/* Corta el stream: sin esto queda prendida la luz de la cámara */
function _apagarCamaraPedirFoto() {
  if (_pfStream) {
    _pfStream.getTracks().forEach(function(t) { t.stop(); });
    _pfStream = null;
  }
  var video = document.getElementById('pedir-foto-video');
  if (video) video.srcObject = null;
}

function _limpiarFotoPedirFoto() {
  if (_pfUrl) URL.revokeObjectURL(_pfUrl);
  _pfUrl  = null;
  _pfBlob = null;
}

async function _encenderCamaraPedirFoto() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    _pasoPedirFoto('archivo');
    return;
  }

  _pasoPedirFoto('camara');
  try {
    _pfStream = await _pedirStreamCamara();
    /* Se canceló mientras el navegador pedía el permiso */
    if (!_pfResolver) { _apagarCamaraPedirFoto(); return; }
    var video = document.getElementById('pedir-foto-video');
    video.srcObject = _pfStream;
    try { await video.play(); } catch (e) { /* autoplay ya se encarga */ }
  } catch (err) {
    /* Permiso denegado, cámara ocupada o sin cámara. No se abre el
       input solo: el navegador lo bloquea fuera de un toque */
    _apagarCamaraPedirFoto();
    _pasoPedirFoto('archivo', 'No se pudo abrir la cámara (' + (err.name || 'error') + '). Elige la foto a mano.');
  }
}

function _mostrarVistaPedirFoto(blob) {
  _limpiarFotoPedirFoto();
  _pfBlob = blob;
  _pfUrl  = URL.createObjectURL(blob);
  document.getElementById('pedir-foto-img').src = _pfUrl;
  _pasoPedirFoto('vista');
}

function _terminarPedirFoto(blob) {
  _apagarCamaraPedirFoto();
  var overlay = document.getElementById('pedir-foto-overlay');
  if (overlay) overlay.style.display = 'none';
  var img = document.getElementById('pedir-foto-img');
  if (img) img.removeAttribute('src');

  var resolver = _pfResolver;
  _pfResolver = null;
  /* El blob sigue vivo para quien lo recibe; solo se suelta la URL */
  if (_pfUrl) URL.revokeObjectURL(_pfUrl);
  _pfUrl  = null;
  _pfBlob = null;
  if (resolver) resolver(blob);
}

/**
 * Pide una foto: cámara → vista previa → OK.
 * @param {Object} [opciones]
 * @param {string} [opciones.titulo] - Texto arriba de la cámara.
 * @param {string} [opciones.textoOk] - Texto del botón que acepta la foto.
 * @returns {Promise<Blob|null>} El JPEG comprimido, o null si se canceló.
 */
window.pedirFoto = function(opciones) {
  opciones = opciones || {};
  /* Si quedó otro pedido abierto, se da por cancelado */
  if (_pfResolver) _terminarPedirFoto(null);

  var overlay = _overlayPedirFoto();
  document.getElementById('pedir-foto-titulo').textContent = opciones.titulo || 'Toma la foto';
  document.getElementById('pedir-foto-texto-ok').textContent = opciones.textoOk || 'Usar foto';
  overlay.style.display = 'flex';

  return new Promise(function(resolve) {
    _pfResolver = resolve;
    _encenderCamaraPedirFoto();
  });
};

/* El cuadro se copia en el momento; la cámara se apaga mientras se
   decide (Repetir la vuelve a prender) */
window._capturarPedirFoto = function() {
  var canvas = _cuadroDeVideo(document.getElementById('pedir-foto-video'));
  if (!canvas) {
    if (typeof showNotif === 'function') showNotif('La cámara todavía no está lista, prueba de nuevo');
    return;
  }
  _apagarCamaraPedirFoto();

  canvas.toBlob(function(blob) {
    if (!_pfResolver) return;
    if (!blob) {
      if (typeof showNotif === 'function') showNotif('No se pudo capturar la foto');
      _encenderCamaraPedirFoto();
      return;
    }
    _mostrarVistaPedirFoto(blob);
  }, 'image/jpeg', _FOTO_CALIDAD);
};

window._elegirArchivoPedirFoto = function() {
  var input = document.getElementById('pedir-foto-input');
  if (input) input.click();
};

window._onArchivoPedirFoto = async function(input) {
  var file = input.files && input.files[0];
  input.value = ''; /* permite volver a elegir el mismo archivo */
  if (!file || !_pfResolver) return;

  try {
    _mostrarVistaPedirFoto(await comprimirImagenJPEG(file, _FOTO_MAX_ANCHO, _FOTO_CALIDAD));
  } catch (err) {
    if (typeof showNotif === 'function') showNotif(err.message || 'No se pudo procesar la foto');
  }
};

window._aceptarPedirFoto = function() {
  if (_pfBlob) _terminarPedirFoto(_pfBlob);
};

window._repetirPedirFoto = function() {
  _limpiarFotoPedirFoto();
  var img = document.getElementById('pedir-foto-img');
  if (img) img.removeAttribute('src');
  _encenderCamaraPedirFoto();
};

window._cancelarPedirFoto = function() {
  _terminarPedirFoto(null);
};
