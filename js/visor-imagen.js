/* ============================================================
   js/visor-imagen.js — visor de imágenes único (cambio 6)

   Abre una foto o un reporte encima de la pantalla, sin otra pestaña:
   lo de atrás (un modal abierto con datos escritos) queda tal cual.

   Dos formas de usarlo:
   · En el HTML: cualquier elemento con data-visor-url (y opcional
     data-visor-titulo). Un solo listener en document (en captura, así
     el clic no llega a la fila o tarjeta de atrás) lo abre. Los que
     están dentro del mismo [data-visor-grupo] forman el juego de las
     flechas ‹ ›. Funciona con el HTML que se repinta cada 8 s, porque
     no hay nada que volver a enganchar. Un <a href> sigue sirviendo
     con Ctrl+clic para otra pestaña.
   · Desde JS: abrirVisorImagen([{ url, titulo }], indice).

   Se cierra con la ✕, "Cerrar", Esc, tocando fuera de la imagen o con
   el botón atrás del celular (se agrega una entrada al historial al
   abrir y se saca al cerrar; navigation.js solo usa replaceState).
   ============================================================ */

var _visorEl = null;
var _visorLista = [];
var _visorIndice = 0;
var _visorCarga = 0;          /* cada imagen que se pide; descarta respuestas viejas */
var _visorConHistorial = false;
var _visorFocoAntes = null;
var _visorOverflowAntes = '';
var _visorToque = null;       /* { x, y } del dedo al empezar a deslizar */
var _visorTimerCopia = null;

function _visorEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _visorArmar() {
  if (_visorEl) return _visorEl;
  var el = document.createElement('div');
  el.id = 'visor-imagen';
  el.className = 'visor';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'visor-titulo');
  el.innerHTML =
    '<div class="visor-top">' +
      '<div class="visor-titulo" id="visor-titulo"></div>' +
      '<button type="button" class="visor-x" data-visor-accion="cerrar" aria-label="Cerrar"><i class="ti ti-x"></i></button>' +
    '</div>' +
    '<div class="visor-cuerpo">' +
      '<button type="button" class="visor-flecha visor-prev" data-visor-accion="prev" aria-label="Imagen anterior"><i class="ti ti-chevron-left"></i></button>' +
      '<div class="visor-cargando"><i class="ti ti-loader-2"></i> Cargando…</div>' +
      '<div class="visor-error" hidden><i class="ti ti-photo-off"></i><div>No se pudo cargar la imagen.</div>' +
        '<div class="visor-error-ayuda">Puede que ya no exista o que no haya señal. "Copiar URL" igual funciona.</div></div>' +
      '<img class="visor-img" alt="" hidden>' +
      '<button type="button" class="visor-flecha visor-next" data-visor-accion="next" aria-label="Imagen siguiente"><i class="ti ti-chevron-right"></i></button>' +
    '</div>' +
    '<div class="visor-url" hidden>' +
      '<div class="visor-url-ayuda">Este navegador no deja copiar solo. Mantené apretada la URL para copiarla:</div>' +
      '<input type="text" class="visor-url-input" readonly>' +
    '</div>' +
    '<div class="visor-acciones">' +
      '<button type="button" class="btn visor-btn" data-visor-accion="copiar"><i class="ti ti-copy"></i> <span>Copiar URL</span></button>' +
      '<button type="button" class="btn btn-primary visor-btn" data-visor-accion="cerrar">Cerrar</button>' +
    '</div>';

  el.addEventListener('click', _visorClic);
  var cuerpo = el.querySelector('.visor-cuerpo');
  cuerpo.addEventListener('touchstart', function(e) {
    if (e.touches.length !== 1) { _visorToque = null; return; }
    _visorToque = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });
  cuerpo.addEventListener('touchend', function(e) {
    if (!_visorToque || _visorLista.length < 2) return;
    var dx = e.changedTouches[0].clientX - _visorToque.x;
    var dy = e.changedTouches[0].clientY - _visorToque.y;
    _visorToque = null;
    /* Deslizar = sobre todo horizontal y de más de 50 px; si no, es un toque o un scroll */
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) _visorMover(dx < 0 ? 1 : -1);
  }, { passive: true });

  var img = el.querySelector('.visor-img');
  img.addEventListener('load', function() {
    if (Number(img.dataset.carga) !== _visorCarga) return;
    el.querySelector('.visor-cargando').hidden = true;
    img.hidden = false;
  });
  img.addEventListener('error', function() {
    if (Number(img.dataset.carga) !== _visorCarga || !img.getAttribute('src')) return;
    el.querySelector('.visor-cargando').hidden = true;
    el.querySelector('.visor-error').hidden = false;
  });

  document.body.appendChild(el);
  _visorEl = el;
  return el;
}

function _visorClic(e) {
  var accion = e.target.closest('[data-visor-accion]');
  if (accion) {
    var a = accion.getAttribute('data-visor-accion');
    if (a === 'cerrar') cerrarVisorImagen();
    else if (a === 'prev') _visorMover(-1);
    else if (a === 'next') _visorMover(1);
    else if (a === 'copiar') _visorCopiar();
    return;
  }
  /* Tocar fuera de la imagen (el fondo, la zona de carga) cierra */
  if (!e.target.closest('.visor-img, .visor-titulo, .visor-url, .visor-error')) cerrarVisorImagen();
}

function _visorPintar() {
  var el = _visorEl;
  var item = _visorLista[_visorIndice];
  var varias = _visorLista.length > 1;
  var titulo = (item.titulo || 'Imagen') + (varias ? ' · ' + (_visorIndice + 1) + ' de ' + _visorLista.length : '');
  el.querySelector('.visor-titulo').textContent = titulo;
  el.querySelector('.visor-prev').hidden = !varias;
  el.querySelector('.visor-next').hidden = !varias;
  el.querySelector('.visor-url').hidden = true;
  _visorEtiquetaCopiar('Copiar URL', false);

  var img = el.querySelector('.visor-img');
  _visorCarga++;
  img.hidden = true;
  img.alt = item.titulo || 'Imagen';
  img.dataset.carga = String(_visorCarga);
  el.querySelector('.visor-error').hidden = true;
  el.querySelector('.visor-cargando').hidden = false;
  img.removeAttribute('src');
  img.src = item.url;
  /* Ya estaba en caché: algunos navegadores no avisan con load */
  if (img.complete && img.naturalWidth) {
    el.querySelector('.visor-cargando').hidden = true;
    img.hidden = false;
  }
}

function _visorMover(paso) {
  if (_visorLista.length < 2) return;
  _visorIndice = (_visorIndice + paso + _visorLista.length) % _visorLista.length;
  _visorPintar();
}

function _visorUrlAbsoluta() {
  var item = _visorLista[_visorIndice];
  try { return new URL(item.url, window.location.href).href; } catch (e) { return item.url; }
}

function _visorEtiquetaCopiar(texto, hecho) {
  var btn = _visorEl && _visorEl.querySelector('[data-visor-accion="copiar"]');
  if (!btn) return;
  btn.innerHTML = '<i class="ti ' + (hecho ? 'ti-check' : 'ti-copy') + '"></i> <span>' + _visorEsc(texto) + '</span>';
  btn.classList.toggle('visor-btn-hecho', !!hecho);
}

/* Copia la URL. 1) API del portapapeles (https o localhost);
   2) el método viejo con un textarea; 3) si nada anda (algunos
   navegadores del celular), muestra la URL seleccionada para copiarla
   a mano. */
async function _visorCopiar() {
  var url = _visorUrlAbsoluta();
  var copiado = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(url);
      copiado = true;
    }
  } catch (e) { copiado = false; }

  if (!copiado) {
    var ta = document.createElement('textarea');
    ta.value = url;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    _visorEl.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, url.length);
    try { copiado = document.execCommand('copy'); } catch (e) { copiado = false; }
    ta.remove();
  }

  if (copiado) {
    _visorEl.querySelector('.visor-url').hidden = true;
    _visorEtiquetaCopiar('✓ URL copiada', true);
    clearTimeout(_visorTimerCopia);
    _visorTimerCopia = setTimeout(function() { _visorEtiquetaCopiar('Copiar URL', false); }, 2000);
    return;
  }
  var caja = _visorEl.querySelector('.visor-url');
  var input = caja.querySelector('input');
  input.value = url;
  caja.hidden = false;
  input.focus();
  input.select();
  input.setSelectionRange(0, url.length);
}

function _visorTecla(e) {
  if (!_visorEl || _visorEl.hidden) return;
  if (e.key === 'Escape') {
    /* Que no cierre también el modal de atrás (algunos escuchan Esc) */
    e.preventDefault();
    e.stopImmediatePropagation();
    cerrarVisorImagen();
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    if (e.target && e.target.classList && e.target.classList.contains('visor-url-input')) return;
    e.preventDefault();
    _visorMover(e.key === 'ArrowLeft' ? -1 : 1);
  }
}

/* lista: [{ url, titulo }] · indice: cuál mostrar primero */
window.abrirVisorImagen = function(lista, indice) {
  lista = (Array.isArray(lista) ? lista : [lista]).filter(function(x) { return x && x.url; });
  if (!lista.length) return;
  var el = _visorArmar();
  var yaAbierto = !el.hidden;

  _visorLista = lista;
  _visorIndice = Math.min(Math.max(Number(indice) || 0, 0), lista.length - 1);

  if (!yaAbierto) {
    _visorFocoAntes = document.activeElement;
    _visorOverflowAntes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    el.hidden = false;
    document.addEventListener('keydown', _visorTecla, true);
    try {
      history.pushState({ veloxVisor: true }, '');
      _visorConHistorial = true;
    } catch (e) { _visorConHistorial = false; }
  }
  _visorPintar();
  var x = el.querySelector('.visor-x');
  if (x) x.focus();
};

window.cerrarVisorImagen = function(desdeHistorial) {
  if (!_visorEl || _visorEl.hidden) return;
  _visorEl.hidden = true;
  _visorCarga++;
  var img = _visorEl.querySelector('.visor-img');
  img.removeAttribute('src');
  document.body.style.overflow = _visorOverflowAntes;
  document.removeEventListener('keydown', _visorTecla, true);
  clearTimeout(_visorTimerCopia);

  /* Cerrado con la ✕, Esc, etc.: se saca la entrada que puso al abrir,
     así el próximo "atrás" del celular hace lo de siempre. Si alguien
     cambió el historial en el medio (replaceState), no se toca. */
  var conHistorial = _visorConHistorial;
  _visorConHistorial = false;
  if (!desdeHistorial && conHistorial && history.state && history.state.veloxVisor) {
    history.back();
  }
  if (_visorFocoAntes && typeof _visorFocoAntes.focus === 'function' && document.contains(_visorFocoAntes)) {
    try { _visorFocoAntes.focus({ preventScroll: true }); } catch (e) { /* nada */ }
  }
  _visorFocoAntes = null;
};

window.addEventListener('popstate', function() {
  if (_visorEl && !_visorEl.hidden) cerrarVisorImagen(true);
});

/* Disparador por atributos (ver arriba). En captura: el clic no sigue
   a la fila / tarjeta de atrás. Ctrl, Shift, Cmd o el botón del medio
   dejan que un <a href> se abra en otra pestaña como siempre. */
document.addEventListener('click', function(e) {
  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  var disp = e.target.closest && e.target.closest('[data-visor-url]');
  if (!disp || disp.closest('#visor-imagen')) return;
  e.preventDefault();
  e.stopPropagation();

  var grupo = disp.closest('[data-visor-grupo]');
  var nodos = grupo ? Array.prototype.slice.call(grupo.querySelectorAll('[data-visor-url]')) : [disp];
  var lista = [];
  var indice = 0;
  nodos.forEach(function(n) {
    var url = n.getAttribute('data-visor-url');
    if (!url) return;
    /* La misma foto dos veces en el grupo cuenta una vez */
    var ya = lista.findIndex(function(x) { return x.url === url; });
    if (ya === -1) {
      lista.push({ url: url, titulo: n.getAttribute('data-visor-titulo') || '' });
      ya = lista.length - 1;
    }
    if (n === disp) indice = ya;
  });
  abrirVisorImagen(lista, indice);
}, true);

/* Atributos para poner en un elemento del HTML armado como texto:
   ' data-visor-url="…" data-visor-titulo="…"' (ya escapados) */
window.atributosVisor = function(url, titulo) {
  if (!url) return '';
  return ' data-visor-url="' + _visorEsc(url) + '"' + (titulo ? ' data-visor-titulo="' + _visorEsc(titulo) + '"' : '');
};
