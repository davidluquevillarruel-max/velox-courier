/* ============================================================
   pedidos.js — Conectado a la API REST
   Todos los datos vienen de /api/ordenes
   ============================================================ */

var API = '/api';

/* Catálogos en memoria — se cargan al iniciar */
var CATALOGO_TIENDAS     = [];
var CATALOGO_MOTORIZADOS = [];
var CATALOGO_DISTRITOS   = [];

var _filtroFecha  = '';
var _ordenesCache = []; /* caché local del día activo */

/* ── FOTO DEL PRODUCTO ──
   La foto vive comprimida en memoria hasta que la orden existe: la
   subida necesita el id de la orden, que recién se conoce después
   del POST. Ahí pasa a la cola de fotos (js/cola-fotos.js), que la
   guarda en el teléfono y la sube aunque la señal vaya y venga. */
var _fotoProductoBlob = null;  /* JPEG comprimido listo para subir */
var _fotoProductoUrl  = null;  /* object URL solo para la vista previa */
var _modoOrdenRapida  = false; /* true = solo tienda, destinatario y teléfono */

/* Comboboxes buscables del modal "Agregar orden" (js/combobox.js).
   Se inicializan una sola vez por carga de página en initPedidos(). */
var _comboTienda     = null;
var _comboDistrito   = null;
var _comboMotorizado = null;

/* ════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════ */
function _hoy() {
  var d  = new Date();
  var mm = ('0'+(d.getMonth()+1)).slice(-2);
  var dd = ('0'+d.getDate()).slice(-2);
  return d.getFullYear() + '-' + mm + '-' + dd;
}

function _horaActual() {
  var d = new Date();
  return ('0'+d.getHours()).slice(-2) + ':' + ('0'+d.getMinutes()).slice(-2);
}

function _fechaDisplay(yyyymmdd) {
  if (!yyyymmdd) return '—';
  var p = yyyymmdd.split('-');
  var meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return p[2] + ' ' + meses[parseInt(p[1])-1] + ' ' + p[0];
}

function _badgeEstado(estado) {
  var map = {
    'entregado':    '<span class="badge entregado">Entregado</span>',
    'no-entregado': '<span class="badge no-entregado">No entregado</span>',
    'ausente':      '<span class="badge ausente">Ausente</span>',
    'en-proceso':   '<span class="badge pendiente">En proceso</span>',
    'reprogramado': '<span class="badge reprogramado">Reprogramado</span>',
    'cancelado':    '<span class="badge no-entregado">Cancelado</span>',
    'devolucion':   '<span class="badge ausente">Devolución</span>',
  };
  return map[estado] || '<span class="badge pendiente">' + estado + '</span>';
}

/* "Cambio"/"Recojo"/"Escoge talla" no son estados de progreso, son
   condiciones especiales aparte (columna condicion_especial) */
function _badgeCondicionEspecial(condicion) {
  var map = {
    'cambio':       '<span class="badge ausente">Cambio</span>',
    'recojo':       '<span class="badge pendiente">Recojo</span>',
    'escoge-talla': '<span class="badge reprogramado">Escoge talla</span>',
  };
  return map[condicion] || '<span style="color:var(--color-text-tertiary)">—</span>';
}

/* "Sub-estado" — no es el estado real de la orden (Entregado/Cancelado/
   etc.), es el seguimiento de la devolución física a la tienda para
   las Canceladas o con condición especial. Se calcula solo, no es una
   columna aparte en la base: sale de estado + condición + devuelto +
   devuelto_tienda. Compartido con js/devolucion-tienda.js. */
function _subEstadoOrden(o) {
  var aplica = (o.estado === 'cancelado' || o.condicionEspecial) && parseInt(o.devuelto) > 0;
  if (!aplica) return '';
  return o.devuelto_tienda ? 'devuelto' : 'en-almacen';
}

function _badgeSubEstado(o) {
  var sub = _subEstadoOrden(o);
  if (sub === 'en-almacen') return '<span class="badge reprogramado">En almacén</span>';
  if (sub === 'devuelto')   return '<span class="badge entregado">Devuelto</span>';
  return '<span style="color:var(--color-text-tertiary)">—</span>';
}

/* Botón para confirmar una devolución directo desde la tabla (usa
   _calificaDevolucion de js/motorizados.js). Solo se muestra cuando
   la orden lo necesita — el contador histórico se ve en "Actualizar",
   acá la columna es de acción, no de historial. */
function _celdaDevuelto(o) {
  var califica = typeof _calificaDevolucion === 'function' && _calificaDevolucion(o.estado, o.condicionEspecial, o.devuelto);
  if (!califica) {
    return '<span style="color:var(--color-text-tertiary)">—</span>';
  }
  return '<button class="btn btn-sm" style="padding:4px 8px" title="Confirmar devolución" ' +
    'onclick="confirmarDevolucionDesdeTabla(' + o.id + ', this)"><i class="ti ti-package-import"></i> Confirmar</button>';
}

/* Pide confirmación (desde la tabla no hay tiempo de repasar la orden
   como en el modal) y dispara la misma acción que "Confirmar devolución" */
window.confirmarDevolucionDesdeTabla = function(ordenId, btnEl) {
  if (!confirm('¿Confirmar que el motorizado devolvió el producto de esta orden a la oficina?')) return;
  if (typeof confirmarDevolucionOrden === 'function') confirmarDevolucionOrden(ordenId, btnEl);
};

/* Ícono de cámara para abrir la foto del producto en otra pestaña.
   Sin foto devuelve '' (no muestra nada). Lo comparten la tabla de
   "Todos los pedidos" y el detalle de la tienda en js/clientes.js. */
function _iconoFotoProducto(url) {
  if (!url) return '';
  var href = String(url).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return ' <a href="' + href + '" target="_blank" rel="noopener" title="Ver la foto del producto"' +
    ' style="color:var(--color-blue);text-decoration:none"><i class="ti ti-camera"></i></a>';
}

/* Marca ámbar si la orden se cobró con un medio de pago que exige foto
   ("Pago tienda" / "Pago Velox") y la evidencia todavía no llegó al
   servidor (sigue en la cola de algún teléfono — ver js/cola-fotos.js).
   El dato lo calcula el servidor (evidencia_pendiente). Lo comparten
   "Todos los pedidos" y el detalle del motorizado (js/motorizados.js). */
function _iconoEvidenciaPendiente(o) {
  if (!o || !o.evidencia_pendiente) return '';
  return ' <span title="Evidencia de pago pendiente de subir" style="color:var(--color-amber)">' +
    '<i class="ti ti-clock-exclamation"></i></span>';
}

/* Arma la fila <tr> de una orden — la usa la tabla de "Todos los
   pedidos" (renderPedidos) y la de "Pendiente devolución"
   (js/pendiente-devolucion.js), para no repetir este HTML en dos lados */
function _filaOrdenPedido(o) {
  var especial = o.producto_especial
    ? '<span title="Producto especial" style="color:var(--color-amber);margin-left:4px"><i class="ti ti-package-import"></i></span>'
    : '';
  var delivery = parseFloat(o.delivery_total || 0);
  var adicional = parseFloat(o.monto_adicional || 0);
  var deliveryHTML = 'S/ ' + delivery.toFixed(2) +
    (adicional > 0
      ? ' <span style="font-size:10px;color:var(--color-amber-text);background:var(--color-amber-bg);padding:1px 5px;border-radius:8px">+S/' + adicional.toFixed(2) + '</span>'
      : '');

  var pagoMoto = parseFloat(o.pago_moto_total || 0);
  var pagoMotoAdicional = parseFloat(o.pago_moto_adicional || 0);
  var pagoMotoHTML = 'S/ ' + pagoMoto.toFixed(2) +
    (pagoMotoAdicional > 0
      ? ' <span style="font-size:10px;color:var(--color-amber-text);background:var(--color-amber-bg);padding:1px 5px;border-radius:8px">+S/' + pagoMotoAdicional.toFixed(2) + '</span>'
      : '');

  return '<tr>' +
    '<td><strong>#' + o.codigo + '</strong>' + _iconoFotoProducto(o.foto_producto_url) + _iconoEvidenciaPendiente(o) + '</td>' +
    '<td>' + o.tienda + especial + '</td>' +
    '<td>' + (o.dest_nombre || '—') + '</td>' +
    '<td>' + (typeof _botonWhatsApp === 'function' ? _botonWhatsApp(o.dest_telefono, o.dest_nombre, o.dest_telefono_2) : (o.dest_telefono || '—')) + '</td>' +
    '<td>' + o.distrito + '</td>' +
    '<td>' + (o.motorizado || '<span style="color:var(--color-text-tertiary)">Sin asignar</span>') + '</td>' +
    '<td>' + _badgeEstado(o.estado) + '</td>' +
    '<td>' + _badgeCondicionEspecial(o.condicionEspecial) + '</td>' +
    '<td>' + _celdaDevuelto(o) + '</td>' +
    '<td>' + _badgeSubEstado(o) + '</td>' +
    '<td>' + (o.hora_asignacion || '—') + '</td>' +
    '<td>' + deliveryHTML + '</td>' +
    '<td>' + pagoMotoHTML + '</td>' +
    '<td style="font-size:12px;color:var(--color-text-secondary)">' + _fechaDisplay(o.fecha) + '</td>' +
    '<td><button class="btn btn-sm" onclick="abrirActualizarEstadoOrden(' + o.id + ')"><i class="ti ti-refresh"></i> Actualizar</button></td>' +
  '</tr>';
}

/* ════════════════════════════════════════════
   CARGAR CATÁLOGOS DESDE LA API
════════════════════════════════════════════ */
async function _cargarCatalogos() {
  try {
    /* Tiendas */
    const rT = await fetch(API + '/tiendas');
    const tiendas = await rT.json();
    CATALOGO_TIENDAS.length = 0;
    tiendas.filter(function(t){ return t.activa; }).forEach(function(t) {
      CATALOGO_TIENDAS.push({ id: t.id, nombre: t.nombre });
    });

    /* Motorizados */
    const rM = await fetch(API + '/motorizados');
    const motos = await rM.json();
    CATALOGO_MOTORIZADOS.length = 0;
    motos.filter(function(m){ return m.activo; }).forEach(function(m) {
      CATALOGO_MOTORIZADOS.push({ id: m.id, nombre: m.nombre, zona: m.zona || '' });
    });

    /* Distritos desde tarifas — solo los activos: los inactivos no son
       elegibles, y ahí vive el comodín "SIN DEFINIR" del flujo rápido */
    const rD = await fetch(API + '/tarifas');
    const tarifas = await rD.json();
    CATALOGO_DISTRITOS.length = 0;
    tarifas.filter(function(t){ return t.activo; }).forEach(function(t) {
      CATALOGO_DISTRITOS.push(t.distrito);
    });

  } catch (err) {
    console.error('Error cargando catálogos:', err);
  }
}

/* ════════════════════════════════════════════
   CARGAR ÓRDENES DESDE LA API
════════════════════════════════════════════ */
async function _cargarOrdenes(fecha) {
  try {
    var url = API + '/ordenes';
    if (fecha) url += '?fecha=' + fecha;
    var r = await fetch(url);
    if (!r.ok) throw new Error('Error al cargar órdenes');
    _ordenesCache = await r.json();
    return _ordenesCache;
  } catch (err) {
    console.error('Error cargando órdenes:', err);
    _ordenesCache = [];
    return [];
  }
}

/* ════════════════════════════════════════════
   RENDER
════════════════════════════════════════════ */
window.renderPedidos = async function() {
  var ordenes = await _cargarOrdenes(_filtroFecha);

  var total       = ordenes.length;
  var entregados  = ordenes.filter(function(o){ return o.estado === 'entregado'; }).length;
  var enRuta      = ordenes.filter(function(o){ return o.estado === 'en-proceso'; }).length;
  var sinEntregar = ordenes.filter(function(o){
    return o.estado === 'no-entregado' || o.estado === 'ausente';
  }).length;

  var set = function(id,v){ var el=document.getElementById(id); if(el) el.textContent=v; };
  set('kpi-total',      total);
  set('kpi-entregados', entregados);
  set('kpi-enruta',     enRuta);
  set('kpi-sin',        sinEntregar);
  set('lbl-fecha-activa', _filtroFecha
    ? 'Mostrando: ' + _fechaDisplay(_filtroFecha)
    : 'Mostrando: todos los días');

  var tbody = document.getElementById('tbody-pedidos');
  if (!tbody) return;

  if (ordenes.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="15" style="padding:0;border:none">' +
        '<div class="empty-state">' +
          '<div class="empty-state-icon"><i class="ti ti-clipboard-list"></i></div>' +
          '<div class="empty-state-title">Sin órdenes para esta fecha</div>' +
          '<div class="empty-state-sub">No se encontraron órdenes con los filtros seleccionados.</div>' +
        '</div>' +
      '</td></tr>';
  } else {
    tbody.innerHTML = ordenes.map(_filaOrdenPedido).join('');
  }

  /* Reaplicar los filtros de texto/tienda/motorizado/estado tras repintar */
  if (typeof filtrarTablaPedidos === 'function') filtrarTablaPedidos();
};

/* ════════════════════════════════════════════
   FILTROS
════════════════════════════════════════════ */
window.aplicarFiltroPedidos = function() {
  var inp = document.getElementById('filtro-fecha-pedidos');
  _filtroFecha = inp ? inp.value : '';
  _marcarBotonActivoPedidos(null);
  renderPedidos();
};

window.limpiarFiltroPedidos = function() {
  _filtroFecha = '';
  var inp = document.getElementById('filtro-fecha-pedidos');
  if (inp) inp.value = '';
  _marcarBotonActivoPedidos(null);
  renderPedidos();
};

function _marcarBotonActivoPedidos(tipo) {
  var btnHoy  = document.getElementById('btn-hoy-pedidos');
  var btnAyer = document.getElementById('btn-ayer-pedidos');
  if (btnHoy)  btnHoy.classList.toggle('active', tipo === 'hoy');
  if (btnAyer) btnAyer.classList.toggle('active', tipo === 'ayer');
}

window.filtroRapidoPedidos = function(tipo) {
  var fecha = tipo === 'hoy' ? _hoy() : _hoyMenos1();
  _filtroFecha = fecha;
  var inp = document.getElementById('filtro-fecha-pedidos');
  if (inp) inp.value = fecha;
  _marcarBotonActivoPedidos(tipo);
  renderPedidos();
};

function _hoyMenos1() {
  var d = new Date();
  d.setDate(d.getDate() - 1);
  var mm = ('0'+(d.getMonth()+1)).slice(-2);
  var dd = ('0'+d.getDate()).slice(-2);
  return d.getFullYear() + '-' + mm + '-' + dd;
}

/* ════════════════════════════════════════════
   MODAL — AGREGAR ORDEN
════════════════════════════════════════════ */
/* Crea los comboboxes buscables (una sola vez; ver _initCombosOrden) */
function _initCombosOrden() {
  _comboTienda = initComboBuscable('f-orden-tienda', function() {
    return CATALOGO_TIENDAS.map(function(t) {
      return { value: t.nombre, label: t.nombre };
    });
  });

  _comboMotorizado = initComboBuscable('f-orden-motorizado', function() {
    return CATALOGO_MOTORIZADOS.map(function(m) {
      return { value: m.nombre, label: m.nombre + (m.zona ? ' — ' + m.zona : '') };
    });
  });

  _comboDistrito = initComboBuscable('f-orden-distrito', function() {
    return CATALOGO_DISTRITOS.map(function(d) {
      return { value: d, label: d };
    });
  }, function() { onDistritoChange(); });
}

/**
 * @param {boolean} [modoRapido] true cuando se entra desde el botón de
 *   cámara: la foto ya está adjunta y solo se piden tienda,
 *   destinatario y teléfono. Sin este parámetro (botón "Agregar
 *   orden") el modal arranca sin foto y pide los campos de siempre.
 */
window.abrirModalOrden = function(modoRapido) {
  _modoOrdenRapida = !!modoRapido;
  /* En el flujo normal se arranca sin foto; en el rápido se conserva
     la que se acaba de tomar */
  if (!_modoOrdenRapida) _limpiarFotoProducto();

  var fFecha = document.getElementById('f-orden-fecha');
  if (fFecha) fFecha.value = _hoy();

  if (_comboTienda)     _comboTienda.limpiar();
  if (_comboMotorizado) _comboMotorizado.limpiar();
  if (_comboDistrito)   _comboDistrito.limpiar();
  var hint = document.getElementById('delivery-hint');
  if (hint) hint.textContent = '';

  ['f-orden-dest','f-orden-telef','f-orden-direccion','f-orden-obs','f-orden-delivery',
   'f-orden-pagomoto','f-orden-pagomotoadic','f-orden-cobrado'].forEach(function(id){
    var el = document.getElementById(id); if (el) el.value = '';
  });
  var fTieneCondicion = document.getElementById('f-orden-tiene-condicion');
  var fCondicion = document.getElementById('f-orden-condicion');
  if (fTieneCondicion) fTieneCondicion.checked = false;
  if (fCondicion) { fCondicion.value = ''; fCondicion.disabled = true; }
  var fHora = document.getElementById('f-orden-hora');
  if (fHora) fHora.value = _horaActual();
  var fMetodo = document.getElementById('f-orden-metodo');
  if (fMetodo) fMetodo.value = 'sin-cobro';
  var fPrepagado = document.getElementById('f-orden-prepagado');
  var fPrepagadoLbl = document.getElementById('f-orden-prepagado-label');
  var fPrepagadoMetodo = document.getElementById('f-orden-prepagado-metodo');
  if (fPrepagado) fPrepagado.checked = false;
  if (fPrepagadoLbl) fPrepagadoLbl.textContent = 'Post pago';
  if (fPrepagadoMetodo) { fPrepagadoMetodo.value = ''; fPrepagadoMetodo.disabled = true; }

  var errEl = document.getElementById('orden-modal-error');
  if (errEl) errEl.style.display = 'none';
  _pintarEstadoFotoOrden();
  document.getElementById('orden-modal-overlay').style.display = 'flex';
};

/* Habilita el select de condición especial solo si el interruptor está prendido */
window.onToggleCondicionOrden = function() {
  var chk = document.getElementById('f-orden-tiene-condicion');
  var sel = document.getElementById('f-orden-condicion');
  if (!chk || !sel) return;
  sel.disabled = !chk.checked;
  if (!chk.checked) sel.value = '';
};

/* Actualiza la etiqueta "Post pago" / "Pre pagado" y habilita el
   select de Efectivo/Yape solo si el interruptor está prendido */
window.onTogglePrepagado = function() {
  var chk = document.getElementById('f-orden-prepagado');
  var lbl = document.getElementById('f-orden-prepagado-label');
  var sel = document.getElementById('f-orden-prepagado-metodo');
  if (!chk || !lbl) return;
  lbl.textContent = chk.checked ? 'Pre pagado' : 'Post pago';
  if (sel) {
    sel.disabled = !chk.checked;
    if (!chk.checked) sel.value = '';
  }
};

window.onDistritoChange = function() {
  /* Autocompletar delivery Y pago moto desde catálogo de tarifas */
  fetch(API + '/tarifas').then(function(r){ return r.json(); }).then(function(tarifas) {
    var selDist   = document.getElementById('f-orden-distrito');
    var fDeliv    = document.getElementById('f-orden-delivery');
    var fPagoMoto = document.getElementById('f-orden-pagomoto');
    if (!selDist || !fDeliv) return;
    var t = tarifas.find(function(x){ return x.distrito === selDist.value; });
    if (t) {
      fDeliv.value = t.precio_delivery;
      if (fPagoMoto) fPagoMoto.value = parseFloat(t.pago_motorizado || 0).toFixed(2);
      var hint = document.getElementById('delivery-hint');
      if (hint) hint.textContent = 'Tarifa: delivery S/ ' + parseFloat(t.precio_delivery).toFixed(2) +
        (t.pago_motorizado ? ' · moto S/ ' + parseFloat(t.pago_motorizado).toFixed(2) : '');
    }
  });
};

window.cerrarModalOrden = function() {
  document.getElementById('orden-modal-overlay').style.display = 'none';
  _limpiarFotoProducto();
  _modoOrdenRapida = false;
};

/* ════════════════════════════════════════════
   FOTO DEL PRODUCTO — captura, vista previa y subida

   Un solo ícono de cámara en el modal sirve para los dos flujos:
   · Botón de cámara de la barra → se toma la foto y el modal se
     abre con la foto ya adjunta (marca verde).
   · Botón "Agregar orden" → el modal arranca sin foto (marca roja)
     y se puede adjuntar un archivo o tomar la foto ahí mismo.
════════════════════════════════════════════ */

/* ── TAMAÑO DE LA FOTO ──
   Mismo criterio que el resto del proyecto (DECISIONES.md D-003) */
var _FOTO_MAX_ANCHO = 1280;
var _FOTO_CALIDAD   = 0.7;

/* Cámara en vivo: stream activo y si la captura viene del flujo rápido */
var _camaraStream      = null;
var _camaraFlujoRapido = false;

/* Botón de cámara de la barra: abre la cámara y, con la foto tomada,
   abre el modal en modo rápido */
window.tomarFotoOrdenRapida = function() {
  abrirCamaraOrden(true);
};

/* Botones de adentro del modal */
window.tomarFotoOrden = function() {
  abrirCamaraOrden(false);
};
window.adjuntarFotoOrden = function() {
  var input = document.getElementById('f-orden-foto-archivo');
  if (input) input.click();
};

/* ── CÁMARA EN VIVO (getUserMedia) ──
   Funciona igual en PC (webcam) y en celular (cámara trasera). Antes
   esto usaba input capture="environment", pero eso es solo una
   sugerencia que las PC ignoran: ahí siempre abría el explorador de
   archivos en vez de la cámara.

   Ojo: getUserMedia exige contexto seguro (HTTPS o localhost). Si se
   entra desde el celular por http://IP-de-la-PC:3000, el navegador la
   bloquea — en ese caso se cae al input con capture, que en celular sí
   abre la cámara nativa. En producción (HTTPS) funciona directo. */

/* El overlay se arma una sola vez y se reutiliza */
function _overlayCamara() {
  var overlay = document.getElementById('camara-orden-overlay');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'camara-orden-overlay';
  overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:1300;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML =
    '<div style="width:100%;max-width:520px;display:flex;flex-direction:column;gap:12px">' +
      '<video id="camara-orden-video" autoplay playsinline muted ' +
             'style="width:100%;max-height:68vh;background:#000;border-radius:var(--radius-md);object-fit:contain"></video>' +
      '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">' +
        '<button type="button" class="btn btn-primary" onclick="capturarFotoCamara()">' +
          '<i class="ti ti-camera"></i> Capturar' +
        '</button>' +
        '<button type="button" class="btn" onclick="cerrarCamaraOrden()">' +
          '<i class="ti ti-x"></i> Cancelar' +
        '</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  return overlay;
}

/* Fallback: input nativo con capture (en celular abre la cámara) */
function _dispararInputCamara(esFlujoRapido) {
  var input = document.getElementById(esFlujoRapido ? 'f-orden-foto-rapida' : 'f-orden-foto-camara');
  if (input) input.click();
}

window.abrirCamaraOrden = async function(esFlujoRapido) {
  _camaraFlujoRapido = !!esFlujoRapido;

  /* Navegador sin getUserMedia o sin contexto seguro (http por IP) */
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    _dispararInputCamara(esFlujoRapido);
    return;
  }

  var overlay = _overlayCamara();
  overlay.style.display = 'flex';
  var video = document.getElementById('camara-orden-video');

  try {
    /* ideal (no exact) para que en PC no falle al no haber cámara trasera */
    _camaraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    video.srcObject = _camaraStream;
    try { await video.play(); } catch (e) { /* autoplay ya se encarga */ }
  } catch (err) {
    /* Permiso denegado, cámara ocupada, o sin cámara: se usa el input */
    cerrarCamaraOrden();
    if (typeof showNotif === 'function') {
      showNotif('No se pudo abrir la cámara (' + (err.name || 'error') + '). Elegí la foto a mano.', 4000);
    }
    _dispararInputCamara(esFlujoRapido);
  }
};

/* Toma el frame actual del video, ya escalado, y lo deja listo */
window.capturarFotoCamara = function() {
  var video = document.getElementById('camara-orden-video');
  if (!video || !video.videoWidth) {
    if (typeof showNotif === 'function') showNotif('La cámara todavía no está lista, probá de nuevo');
    return;
  }

  var escala = video.videoWidth > _FOTO_MAX_ANCHO ? _FOTO_MAX_ANCHO / video.videoWidth : 1;
  var canvas = document.createElement('canvas');
  canvas.width  = Math.round(video.videoWidth  * escala);
  canvas.height = Math.round(video.videoHeight * escala);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

  var esRapido = _camaraFlujoRapido;
  cerrarCamaraOrden();

  canvas.toBlob(function(blob) {
    if (!blob) {
      if (typeof showNotif === 'function') showNotif('No se pudo capturar la foto');
      return;
    }
    _guardarFotoEnMemoria(blob);
    _usarFotoTomada(esRapido);
  }, 'image/jpeg', _FOTO_CALIDAD);
};

/* Corta el stream: sin esto queda prendida la luz de la cámara */
window.cerrarCamaraOrden = function() {
  if (_camaraStream) {
    _camaraStream.getTracks().forEach(function(t) { t.stop(); });
    _camaraStream = null;
  }
  var video = document.getElementById('camara-orden-video');
  if (video) video.srcObject = null;
  var overlay = document.getElementById('camara-orden-overlay');
  if (overlay) overlay.style.display = 'none';
};

/* Deja la foto comprimida lista para subir (la comparten la cámara en
   vivo y el adjuntar archivo) */
function _guardarFotoEnMemoria(blob) {
  _limpiarFotoProducto();
  _fotoProductoBlob = blob;
  _fotoProductoUrl  = URL.createObjectURL(blob);
}

/* Qué hacer una vez que ya hay foto: en el flujo rápido abre el modal,
   en el normal solo refresca el indicador */
function _usarFotoTomada(esFlujoRapido) {
  if (esFlujoRapido) {
    abrirModalOrden(true);
  } else {
    _pintarEstadoFotoOrden();
    if (typeof showNotif === 'function') showNotif('Foto adjunta a la orden');
  }
}

/**
 * Se dispara al elegir una foto con el input (adjuntar archivo, o el
 * fallback de cámara en celular). Comprime y la deja lista en memoria.
 * @param {HTMLInputElement} input
 * @param {boolean} esFlujoRapido true si viene del botón de la barra:
 *   en ese caso además abre el modal con la foto ya adjunta.
 */
window.onFotoProductoSeleccionada = async function(input, esFlujoRapido) {
  var file = input.files && input.files[0];
  input.value = ''; /* permite volver a elegir el mismo archivo */
  if (!file) return;

  try {
    _guardarFotoEnMemoria(await comprimirImagenJPEG(file, _FOTO_MAX_ANCHO, _FOTO_CALIDAD));
  } catch (err) {
    if (typeof showNotif === 'function') showNotif(err.message || 'No se pudo procesar la foto');
    return;
  }

  _usarFotoTomada(esFlujoRapido);
};

/* Abre o cierra la vista previa de una foto. Compartida por el modal
   de nueva orden (foto en memoria) y por "Actualizar orden" en
   js/motorizados.js (foto ya subida). La imagen se pide recién al
   abrir, y solo si cambió: así no se gastan datos al abrir el modal. */
function _toggleVistaPreviaFoto(idContenedor, idImagen, src) {
  var cont = document.getElementById(idContenedor);
  var img  = document.getElementById(idImagen);
  if (!cont || !img) return;

  if (cont.style.display === 'block') { cont.style.display = 'none'; return; }
  if (img.getAttribute('src') !== src) img.src = src;
  cont.style.display = 'block';
}

/* El ícono de cámara del modal muestra u oculta la foto adjunta */
window.toggleVistaPreviaFotoOrden = function() {
  if (!_fotoProductoBlob) {
    if (typeof showNotif === 'function') showNotif('Todavía no hay foto adjunta');
    return;
  }
  _toggleVistaPreviaFoto('foto-orden-preview', 'foto-orden-preview-img', _fotoProductoUrl);
};

/* Marca roja = sin foto, verde = con foto */
function _pintarEstadoFotoOrden() {
  var hayFoto = !!_fotoProductoBlob;
  var badge   = document.getElementById('foto-orden-badge');
  var estado  = document.getElementById('foto-orden-estado');
  var btnVer  = document.getElementById('btn-ver-foto-orden');
  var hint    = document.getElementById('orden-modo-rapido-hint');

  if (badge)  badge.style.background = hayFoto ? 'var(--color-green)' : 'var(--color-red)';
  if (estado) estado.textContent = hayFoto
    ? 'Foto adjunta — toca la cámara para verla'
    : 'Sin foto adjunta';
  if (btnVer) {
    btnVer.style.color = hayFoto ? 'var(--color-green)' : 'var(--color-text-tertiary)';
    btnVer.title = hayFoto ? 'Ver la foto adjunta' : 'Todavía no hay foto adjunta';
  }
  if (hint) hint.style.display = _modoOrdenRapida ? 'block' : 'none';

  if (!hayFoto) {
    var cont = document.getElementById('foto-orden-preview');
    if (cont) cont.style.display = 'none';
  }
}

function _limpiarFotoProducto() {
  if (_fotoProductoUrl) URL.revokeObjectURL(_fotoProductoUrl);
  _fotoProductoBlob = null;
  _fotoProductoUrl  = null;
  var cont = document.getElementById('foto-orden-preview');
  if (cont) cont.style.display = 'none';
}

window.guardarOrden = async function() {
  var fecha      = document.getElementById('f-orden-fecha').value;
  var tienda     = document.getElementById('f-orden-tienda').value;
  var dest       = document.getElementById('f-orden-dest').value.trim();
  var telef      = document.getElementById('f-orden-telef').value.trim();
  var direccion  = document.getElementById('f-orden-direccion').value.trim();
  var distrito   = document.getElementById('f-orden-distrito').value;
  var motorizado = document.getElementById('f-orden-motorizado').value;
  var tieneCondicion   = document.getElementById('f-orden-tiene-condicion').checked;
  var condicionEspecial = tieneCondicion ? document.getElementById('f-orden-condicion').value : '';
  var pagoVelox  = document.getElementById('f-orden-prepagado').checked ? 'pre-pagado' : 'post-pago';
  var pagoVeloxMetodo = pagoVelox === 'pre-pagado' ? document.getElementById('f-orden-prepagado-metodo').value : '';
  var hora       = document.getElementById('f-orden-hora').value;
  var delivery   = document.getElementById('f-orden-delivery').value;
  var pagoMoto   = document.getElementById('f-orden-pagomoto').value;
  var pagoMotoAdic = document.getElementById('f-orden-pagomotoadic').value;
  var cobrado    = document.getElementById('f-orden-cobrado').value;
  var metodoPago = document.getElementById('f-orden-metodo').value;
  var obs        = document.getElementById('f-orden-obs').value.trim();
  var errEl      = document.getElementById('orden-modal-error');

  /* En el flujo rápido (botón de cámara) solo se piden tienda,
     destinatario y teléfono: el distrito queda "SIN DEFINIR" y se
     completa después desde "Actualizar orden" */
  if (_modoOrdenRapida) {
    if (!tienda || !dest || !telef) {
      errEl.textContent = 'Tienda, destinatario y teléfono son obligatorios.';
      errEl.style.display = 'block';
      return;
    }
  } else if (!fecha || !tienda || !dest || !distrito) {
    errEl.textContent = 'Fecha, tienda, destinatario y distrito son obligatorios.';
    errEl.style.display = 'block';
    return;
  }

  var validaciones = [
    validarTexto(dest, { obligatorio: true, min: 2, max: 100, nombreCampo: 'El nombre del destinatario' }),
    _modoOrdenRapida ? validarTelefonoObligatorio(telef) : validarTelefono(telef),
    validarTexto(direccion, { min: 5, max: 200, nombreCampo: 'La dirección' }),
    validarTexto(obs, { max: 300, nombreCampo: 'Las observaciones' }),
  ];
  if (!ejecutarValidaciones(validaciones, errEl)) return;

  try {
    var r = await fetch(API + '/ordenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fecha:      fecha,
        tienda:     tienda,
        origen:     'GAMARRA',
        dest:       dest,
        telefDest:  telef,
        direccion:  direccion,
        distrito:   distrito,
        motorizado: motorizado,
        condicionEspecial: condicionEspecial,
        pagoVelox:  pagoVelox,
        pagoVeloxMetodo: pagoVeloxMetodo,
        horaAsig:   hora || _horaActual(),
        delivery:   parseFloat(delivery) || 0,
        pagoMotoBase: parseFloat(pagoMoto) || 0,
        pagoMotoAdic: parseFloat(pagoMotoAdic) || 0,
        montoCobrado: parseFloat(cobrado) || 0,
        metodoPago: metodoPago,
        obs:        obs,
      }),
    });

    if (!r.ok) {
      var errData = await r.json();
      errEl.textContent = errData.error || 'Error al guardar la orden.';
      errEl.style.display = 'block';
      return;
    }

    var data = await r.json();

    /* La orden ya está creada: recién ahora existe el id que la subida
       necesita. La foto pasa a la cola (js/cola-fotos.js): queda
       guardada en el teléfono y sube en segundo plano, con reintentos
       si no hay señal. La orden no espera a la foto. */
    var avisoFoto = '';
    if (_fotoProductoBlob) {
      try {
        var enCola = await encolarFoto(data.id, 'foto_producto', _fotoProductoBlob);
        avisoFoto = enCola.persistente
          ? ' · la foto se sube en segundo plano'
          : ' · la foto no se pudo guardar en el teléfono: no cierres Velox hasta que suba';
      } catch (errFoto) {
        avisoFoto = ' · la orden se guardó, pero la foto no: ' + (errFoto.message || 'error al procesarla');
      }
    }

    cerrarModalOrden();
    renderPedidos();
    if (typeof showNotif === 'function') showNotif('Orden #' + data.codigo + ' registrada' + avisoFoto, avisoFoto ? 5000 : 2500);

  } catch (err) {
    /* Sin respuesta del servidor. Lo normal es que la orden NO se haya
       creado, pero si la señal se cortó justo después del POST pudo
       haberse creado igual: por eso se pide revisar la lista antes de
       reintentar. El modal queda abierto con todo lo cargado, foto
       incluida. */
    errEl.textContent = 'Sin conexión con el servidor: no se pudo confirmar la orden. Lo que cargaste (y la foto) sigue acá. Cuando haya señal, revisa que no figure en la lista y vuelve a guardar.';
    errEl.style.display = 'block';
  }
};

/* ════════════════════════════════════════════
   INIT
════════════════════════════════════════════ */
window.initPedidos = async function() {
  await _cargarCatalogos();
  _filtroFecha = _hoy();
  var inp = document.getElementById('filtro-fecha-pedidos');
  if (inp) inp.value = _filtroFecha;
  _marcarBotonActivoPedidos('hoy');
  _initCombosOrden();
  _initFiltrosPedidosTabla();
  await renderPedidos();

  /* Repinta la tabla sola cada 8s, así los cambios de otros usuarios
     conectados aparecen sin que haga falta recargar (ver js/utils.js) */
  iniciarRefrescoAutomatico('tbody-pedidos', renderPedidos);
};

/* Comboboxes buscables de la barra de filtros de la tabla (no confundir
   con los del modal "Agregar orden" — ver _initCombosOrden) */
function _initFiltrosPedidosTabla() {
  initComboBuscable('f-filtro-tienda-pedidos', function() {
    return CATALOGO_TIENDAS.map(function(t) { return { value: t.nombre, label: t.nombre }; });
  }, function() { filtrarTablaPedidos(); });

  initComboBuscable('f-filtro-motorizado-pedidos', function() {
    return CATALOGO_MOTORIZADOS.map(function(m) {
      return { value: m.nombre, label: m.nombre + (m.zona ? ' — ' + m.zona : '') };
    });
  }, function() { filtrarTablaPedidos(); });
}
