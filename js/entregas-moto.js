/* ============================================================
   entregas-moto.js — Vista del motorizado: "Mis entregas de hoy"
   Arriba de la página Motorizados (solo rol motorizado): una lista
   resumida con sus órdenes de HOY que siguen en reparto ("en-proceso"),
   cada una con un botón EMPEZAR. EMPEZAR abre una pantalla sobrepuesta
   para cerrar la entrega con tres caminos:
     · COMPLETAR → entregado. Foto de entrega siempre; foto del cambio
       si la orden tiene condición especial (reemplaza "Recibido");
       en contraentrega, cómo se cobró y la foto del pago (todos los
       medios, efectivo incluido).
     · OTROS     → reprogramado / ausente / cancelado, cada uno con su foto.
     · DETALLE   → no entregado: motivo (lista + "otro") y de 1 a 3 fotos.
   La foto del pago y las de DETALLE se pueden tomar con la cámara o
   subir desde la galería (la prueba de un Yape suele ser una captura
   ya guardada); entrega y cambio, solo con la cámara en vivo.
   Cerrar la orden es UN pedido (PATCH /ordenes/:id/resolver), que
   necesita señal en ese momento. Las fotos se toman antes (cámara de
   js/camara-foto.js, o la galería) y quedan en memoria; recién cuando el servidor
   respondió bien entran a la cola de siempre (encolarFoto, en
   js/cola-fotos.js), que las sube a R2 en segundo plano: el motorizado
   no espera ninguna subida y pasa directo a la siguiente orden.
   La orden cerrada desaparece de esta lista; la tabla de abajo
   (_renderTablaOrdenesDetalle) sigue igual.
   ============================================================ */

var _ENT_MAX_FOTOS_DETALLE = 3;

/* Medios de pago que piden foto en esta vista: todos (en "Actualizar
   orden" solo la piden Pago tienda y Pago Velox: ver _MEDIOS_PAGO) */
var _ENT_MEDIOS_CON_FOTO = ['yape-motorizado', 'efectivo-motorizado', 'pago-tienda', 'pago-empresa'];

/* Tipos de foto que además se pueden subir desde la galería */
var _ENT_TIPOS_CON_GALERIA = ['evidencia_medio_pago', 'foto_no_entregado'];

var _ENT_OTROS = [
  { value: 'reprogramado', label: 'Reprogramado', foto: 'foto_reprogramado' },
  { value: 'ausente',      label: 'Ausente',      foto: 'foto_ausente' },
  { value: 'cancelado',    label: 'Cancelado',    foto: 'foto_cancelado' },
];

var _ENT_MOTIVOS = [
  { value: 'no-contesta',     label: 'No contesta' },
  { value: 'direccion-errada', label: 'Dirección errada' },
  { value: 'sin-dinero',      label: 'Cliente no tenía el dinero' },
  { value: 'rechazo',         label: 'Rechazó el producto' },
  { value: 'otro',            label: 'Otro' },
];

var _ENT_CONDICIONES = { 'cambio': 'Cambio', 'recojo': 'Recojo', 'escoge-talla': 'Escoge talla' };

var _entPendientes = [];      /* órdenes de hoy en reparto, en el orden de la lista */
var _entOrden      = null;    /* la orden abierta en la pantalla sobrepuesta */
var _entBorradores = {};      /* lo que se fue llenando, por orden (solo en memoria) */
var _entGuardando  = false;
var _entTimer      = null;
var _entUltimoHtml = null;

function _escEnt(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _soles(n) {
  return 'S/ ' + (parseFloat(n) || 0).toFixed(2);
}

function _hoyEnt() {
  return _fechaHaceDiasMoto(0);
}

/* ── Lista "Mis entregas de hoy" ──────────────────────────── */

/* Se llama desde initMotorizados. Para los demás roles no hace nada. */
window.initEntregasMoto = function() {
  var cont = document.getElementById('mis-entregas-hoy');
  if (!cont || !_esSesionMotorizado()) return;
  cont.style.display = 'block';
  _entUltimoHtml = null;
  _recargarEntregasHoy(true);

  if (_entTimer) clearInterval(_entTimer);
  _entTimer = iniciarRefrescoAutomatico('mis-entregas-hoy', function() { return _recargarEntregasHoy(false); });
};

async function _cargarPendientesHoy() {
  var r = await fetch(API + '/ordenes?fecha=' + _hoyEnt());
  if (!r.ok) throw new Error('No se pudieron cargar tus órdenes');
  var ordenes = await r.json();
  return ordenes
    .filter(function(o) { return o.estado === 'en-proceso' && !o.datos_pendientes; })
    .sort(function(a, b) {
      var ha = a.hora_asignacion || '', hb = b.hora_asignacion || '';
      if (ha !== hb) return ha < hb ? -1 : 1;
      return a.id - b.id;
    });
}

async function _recargarEntregasHoy(inicial) {
  var cont = document.getElementById('mis-entregas-hoy');
  if (!cont) return;
  if (inicial) cont.innerHTML = '<div class="entregas-hoy-vacio" style="color:var(--color-text-secondary);background:var(--color-bg-secondary)"><i class="ti ti-loader"></i> Cargando tus entregas...</div>';

  try {
    _entPendientes = await _cargarPendientesHoy();
  } catch (err) {
    if (inicial) cont.innerHTML = '<div class="entrega-error" style="display:block">' + _escEnt(err.message) + '</div>';
    return;
  }

  var html =
    '<div class="entregas-hoy-head">' +
      '<span class="entregas-hoy-titulo">Mis entregas de hoy</span>' +
      (_entPendientes.length ? '<span class="entregas-hoy-cuenta">Quedan ' + _entPendientes.length + '</span>' : '') +
    '</div>';

  if (!_entPendientes.length) {
    html += '<div class="entregas-hoy-vacio"><i class="ti ti-circle-check"></i> No tienes entregas pendientes para hoy.</div>';
  } else {
    html += '<div class="entregas-hoy-lista">' + _entPendientes.map(function(o) {
      var cond = o.condicionEspecial ? ' · <span class="badge ausente">' + _escEnt(_ENT_CONDICIONES[o.condicionEspecial] || o.condicionEspecial) + '</span>' : '';
      var cobro = o.metodo_pago === 'contraentrega'
        ? '<span class="entrega-item-cobro">Por cobrar ' + _soles(o.monto_cobrado) + '</span>'
        : 'Sin cobro';
      return '<div class="entrega-item">' +
        '<div class="entrega-item-datos">' +
          '<strong>#' + _escEnt(o.codigo) + '</strong> · ' + _escEnt(o.distrito) + '<br>' +
          _escEnt(o.dest_nombre || '—') + ' · ' + _escEnt(o.tienda) + '<br>' +
          cobro + cond +
        '</div>' +
        '<button type="button" class="btn-empezar" onclick="empezarEntrega(' + o.id + ')">EMPEZAR</button>' +
      '</div>';
    }).join('') + '</div>';
  }

  /* Sin cambios no se repinta (la lista se refresca cada 8 s) */
  if (html === _entUltimoHtml) return;
  _entUltimoHtml = html;
  cont.innerHTML = html;
}

/* ── Pantalla sobrepuesta ─────────────────────────────────── */

function _borradorEnt(ordenId) {
  if (!_entBorradores[ordenId]) {
    _entBorradores[ordenId] = {
      modo: null,          /* 'completar' | 'otros' | 'detalle' */
      fotos: {},           /* tipo → Blob (foto_no_entregado → [Blob]) */
      medioPago: '',
      otro: '',            /* reprogramado / ausente / cancelado */
      motivoOtros: '',
      motivo: '',          /* value de _ENT_MOTIVOS */
      motivoTexto: '',
    };
  }
  return _entBorradores[ordenId];
}

function _overlayEnt() {
  var ov = document.getElementById('entrega-overlay');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.id = 'entrega-overlay';
  ov.className = 'entrega-overlay';
  ov.style.display = 'none';
  document.body.appendChild(ov);
  return ov;
}

window.empezarEntrega = function(ordenId) {
  var o = _entPendientes.find(function(x) { return x.id == ordenId; });
  if (!o) return;
  _entOrden = o;
  _entGuardando = false;
  _pintarOverlayEnt();
  var ov = _overlayEnt();
  ov.style.display = 'flex';
  var cuerpo = ov.querySelector('.entrega-cuerpo');
  if (cuerpo) cuerpo.scrollTop = 0;
};

window.volverAListaEntregas = function() {
  var ov = document.getElementById('entrega-overlay');
  if (ov) ov.style.display = 'none';
  _entOrden = null;
  _recargarEntregasHoy(false);
};

function _pintarOverlayEnt() {
  var o = _entOrden;
  if (!o) return;
  var b = _borradorEnt(o.id);
  var ov = _overlayEnt();

  var fotoProducto = o.foto_producto_url
    ? '<img class="entrega-foto-producto" src="' + _escEnt(o.foto_producto_url) + '" alt="Foto del producto" ' +
        'onerror="this.outerHTML=\'<div class=&quot;entrega-sin-foto&quot;><i class=&quot;ti ti-photo-off&quot;></i> No se pudo cargar la foto del producto</div>\'">'
    : '<div class="entrega-sin-foto"><i class="ti ti-photo-off"></i> Sin foto del producto</div>';

  var metodo = o.metodo_pago === 'contraentrega' ? 'Contraentrega' : 'Sin cobro';
  var cond = o.condicionEspecial ? (_ENT_CONDICIONES[o.condicionEspecial] || o.condicionEspecial) : 'Ninguna';

  var tel = o.dest_telefono ? '<a href="tel:' + _escEnt(o.dest_telefono) + '"><i class="ti ti-phone"></i> ' + _escEnt(o.dest_telefono) + '</a>' : '';
  var tel2 = o.dest_telefono_2 ? ' · <a href="tel:' + _escEnt(o.dest_telefono_2) + '">' + _escEnt(o.dest_telefono_2) + '</a>' : '';
  var contacto = (o.dest_direccion || tel)
    ? '<div class="entrega-contacto">' +
        (o.dest_direccion ? '<i class="ti ti-map-pin"></i> ' + _escEnt(o.dest_direccion) + '<br>' : '') +
        tel + tel2 +
        (o.observaciones ? '<br><i class="ti ti-note"></i> ' + _escEnt(o.observaciones) : '') +
      '</div>'
    : '';

  ov.innerHTML =
    '<div class="entrega-panel">' +
      '<div class="entrega-top">' +
        '<button type="button" class="btn btn-sm" onclick="volverAListaEntregas()"><i class="ti ti-arrow-left"></i> Lista</button>' +
        '<span class="entrega-top-codigo">#' + _escEnt(o.codigo) + '</span>' +
        '<span class="entrega-top-progreso">Quedan ' + _entPendientes.length + '</span>' +
      '</div>' +
      '<div class="entrega-cuerpo">' +
        fotoProducto +
        '<div class="entrega-datos">' +
          _datoEnt('Tienda', o.tienda) +
          _datoEnt('Distrito', o.distrito) +
          _datoEnt('Por cobrar', o.metodo_pago === 'contraentrega' ? _soles(o.monto_cobrado) : '—') +
          _datoEnt('Cliente', o.dest_nombre || '—') +
          _datoEnt('Método de pago', metodo) +
          _datoEnt('Condición especial', cond) +
        '</div>' +
        contacto +
        '<div id="entrega-seccion">' + _seccionModoEnt(o, b) + '</div>' +
        '<div class="entrega-error" id="entrega-error"></div>' +
      '</div>' +
      '<div class="entrega-acciones">' +
        _botonAccionEnt('completar', 'COMPLETAR', b.modo) +
        _botonAccionEnt('otros', 'OTROS', b.modo) +
        _botonAccionEnt('detalle', 'DETALLE', b.modo) +
      '</div>' +
    '</div>';
}

function _datoEnt(label, valor) {
  return '<div><div class="entrega-dato-label">' + label + '</div><div class="entrega-dato-valor">' + _escEnt(valor) + '</div></div>';
}

function _botonAccionEnt(modo, texto, modoActual) {
  return '<button type="button" class="entrega-accion ' + modo + (modo === modoActual ? ' activa' : '') + '" ' +
    'onclick="elegirModoEntrega(\'' + modo + '\')">' + texto + '</button>';
}

window.elegirModoEntrega = function(modo) {
  if (!_entOrden || _entGuardando) return;
  _borradorEnt(_entOrden.id).modo = modo;
  _pintarOverlayEnt();
  var sec = document.getElementById('entrega-seccion');
  if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

/* Casillero de foto. idx solo para las de "no entregado" (varias).
   Los tipos de _ENT_TIPOS_CON_GALERIA llevan dos botones abajo:
   "Tomar foto" (cámara) y "Subir imagen" (galería). */
function _slotFotoEnt(tipo, titulo, blob, idx) {
  var url = blob ? _urlBlobEnt(blob) : '';
  var arg = '\'' + tipo + '\'' + (idx != null ? ', ' + idx : '');
  if (_ENT_TIPOS_CON_GALERIA.indexOf(tipo) !== -1) {
    return '<div class="foto-slot-doble">' +
        '<div class="foto-slot' + (blob ? ' lista' : '') + '">' +
          (blob ? '<img src="' + url + '" alt="">' : '<i class="ti ti-photo"></i>') +
          '<span>' + _escEnt(titulo) +
            '<span class="foto-slot-estado">' + (blob ? 'Lista — puedes cambiarla' : 'Falta') + '</span>' +
          '</span>' +
        '</div>' +
        '<div class="foto-slot-botones">' +
          '<button type="button" class="entrega-opcion" onclick="tomarFotoEntrega(' + arg + ')"><i class="ti ti-camera"></i> Tomar foto</button>' +
          '<button type="button" class="entrega-opcion" onclick="subirImagenEntrega(' + arg + ')"><i class="ti ti-photo-up"></i> Subir imagen</button>' +
        '</div>' +
      '</div>';
  }
  return '<button type="button" class="foto-slot' + (blob ? ' lista' : '') + '" onclick="tomarFotoEntrega(' + arg + ')">' +
      (blob ? '<img src="' + url + '" alt="">' : '<i class="ti ti-camera"></i>') +
      '<span>' + _escEnt(titulo) +
        '<span class="foto-slot-estado">' + (blob ? 'Lista — toca para repetirla' : 'Falta — toca para tomarla') + '</span>' +
      '</span>' +
    '</button>';
}

/* Una URL por Blob, reusada entre repintados (se liberan al cerrar la orden) */
var _entUrls = new Map();
function _urlBlobEnt(blob) {
  if (!_entUrls.has(blob)) _entUrls.set(blob, URL.createObjectURL(blob));
  return _entUrls.get(blob);
}
function _soltarUrlsEnt(borrador) {
  Object.keys(borrador.fotos).forEach(function(k) {
    [].concat(borrador.fotos[k]).forEach(function(blob) {
      if (_entUrls.has(blob)) { URL.revokeObjectURL(_entUrls.get(blob)); _entUrls.delete(blob); }
    });
  });
}

function _seccionModoEnt(o, b) {
  if (b.modo === 'completar') return _seccionCompletarEnt(o, b);
  if (b.modo === 'otros')     return _seccionOtrosEnt(o, b);
  if (b.modo === 'detalle')   return _seccionDetalleEnt(o, b);
  return '<div class="entrega-ayuda" style="text-align:center;padding:6px 0">Elige abajo cómo terminó esta entrega.</div>';
}

/* Qué falta para poder completar (lista vacía = listo) */
function _faltantesCompletarEnt(o, b) {
  var faltan = [];
  if (!b.fotos.foto_entrega) faltan.push('la foto de la entrega');
  if (o.condicionEspecial && !b.fotos.foto_cambio) faltan.push('la foto del producto que te dio el cliente');
  if (o.metodo_pago === 'contraentrega') {
    if (!b.medioPago) faltan.push('cómo se cobró');
    else if (_ENT_MEDIOS_CON_FOTO.indexOf(b.medioPago) !== -1 && !b.fotos.evidencia_medio_pago) faltan.push('la foto del pago');
  }
  return faltan;
}

function _seccionCompletarEnt(o, b) {
  var html = '<div class="entrega-seccion"><div class="entrega-seccion-titulo"><i class="ti ti-circle-check"></i> Entregado</div>';
  html += _slotFotoEnt('foto_entrega', 'Foto de la entrega', b.fotos.foto_entrega);

  if (o.condicionEspecial) {
    html += '<div class="entrega-ayuda">Esta orden tiene ' + _escEnt((_ENT_CONDICIONES[o.condicionEspecial] || o.condicionEspecial).toLowerCase()) +
      ': fotografía el producto que te entregó el cliente.</div>';
    html += _slotFotoEnt('foto_cambio', 'Foto del cambio', b.fotos.foto_cambio);
  }

  if (o.metodo_pago === 'contraentrega') {
    html += '<div class="entrega-seccion-titulo" style="margin-top:4px">¿Cómo se cobró? <span style="font-weight:400;color:var(--color-text-secondary)">(' + _soles(o.monto_cobrado) + ')</span></div>';
    html += '<div class="entrega-opciones">' + _MEDIOS_PAGO.map(function(m) {
      return '<button type="button" class="entrega-opcion' + (b.medioPago === m.value ? ' activa' : '') + '" ' +
        'onclick="elegirMedioPagoEntrega(\'' + m.value + '\')">' + m.label + '</button>';
    }).join('') + '</div>';
    if (b.medioPago && _ENT_MEDIOS_CON_FOTO.indexOf(b.medioPago) !== -1) {
      html += _slotFotoEnt('evidencia_medio_pago', 'Foto del pago', b.fotos.evidencia_medio_pago);
    }
  }

  var faltan = _faltantesCompletarEnt(o, b);
  if (faltan.length) html += '<div class="entrega-ayuda"><i class="ti ti-info-circle"></i> Falta ' + faltan.join(', ') + '.</div>';
  html += '<button type="button" class="btn-entrega-confirmar" id="btn-entrega-confirmar" ' + (faltan.length ? 'disabled ' : '') +
    'onclick="confirmarEntrega(\'completar\')"><i class="ti ti-check"></i> Completar entrega</button>';
  return html + '</div>';
}

function _seccionOtrosEnt(o, b) {
  var html = '<div class="entrega-seccion"><div class="entrega-seccion-titulo">¿Qué pasó?</div>';
  html += '<div class="entrega-opciones" style="grid-template-columns:repeat(3,1fr)">' + _ENT_OTROS.map(function(x) {
    return '<button type="button" class="entrega-opcion' + (b.otro === x.value ? ' activa' : '') + '" ' +
      'onclick="elegirOtroEntrega(\'' + x.value + '\')">' + x.label + '</button>';
  }).join('') + '</div>';

  var elegido = _ENT_OTROS.find(function(x) { return x.value === b.otro; });
  if (elegido) {
    html += _slotFotoEnt(elegido.foto, 'Foto: ' + elegido.label.toLowerCase(), b.fotos[elegido.foto]);
    html += '<input type="text" class="search-box" style="width:100%" maxlength="300" placeholder="Comentario (opcional)" ' +
      'value="' + _escEnt(b.motivoOtros) + '" oninput="_borradorEnt(' + o.id + ').motivoOtros = this.value">';
    var listo = !!b.fotos[elegido.foto];
    if (!listo) html += '<div class="entrega-ayuda"><i class="ti ti-info-circle"></i> Falta la foto.</div>';
    html += '<button type="button" class="btn-entrega-confirmar" id="btn-entrega-confirmar" ' + (listo ? '' : 'disabled ') +
      'onclick="confirmarEntrega(\'otros\')">Confirmar ' + elegido.label.toLowerCase() + '</button>';
  }
  return html + '</div>';
}

function _seccionDetalleEnt(o, b) {
  var html = '<div class="entrega-seccion"><div class="entrega-seccion-titulo"><i class="ti ti-circle-x"></i> No se entregó — ¿por qué?</div>';
  html += '<div class="entrega-opciones una-columna">' + _ENT_MOTIVOS.map(function(m) {
    return '<button type="button" class="entrega-opcion' + (b.motivo === m.value ? ' activa' : '') + '" ' +
      'onclick="elegirMotivoEntrega(\'' + m.value + '\')">' + m.label + '</button>';
  }).join('') + '</div>';
  if (b.motivo === 'otro') {
    html += '<input type="text" id="entrega-motivo-texto" class="search-box" style="width:100%" maxlength="280" placeholder="Cuenta qué pasó" ' +
      'value="' + _escEnt(b.motivoTexto) + '" oninput="_borradorEnt(' + o.id + ').motivoTexto = this.value; _actualizarBotonDetalleEnt()">';
  }

  var fotos = b.fotos.foto_no_entregado || [];
  html += '<div class="entrega-seccion-titulo" style="margin-top:4px">Fotos <span style="font-weight:400;color:var(--color-text-secondary)">(de 1 a ' + _ENT_MAX_FOTOS_DETALLE + ')</span></div>';
  fotos.forEach(function(blob, i) {
    html += _slotFotoEnt('foto_no_entregado', 'Foto ' + (i + 1), blob, i);
  });
  if (fotos.length < _ENT_MAX_FOTOS_DETALLE) {
    html += _slotFotoEnt('foto_no_entregado', fotos.length ? 'Agregar otra foto' : 'Foto 1', null, fotos.length);
  }

  html += '<div class="entrega-ayuda" id="entrega-detalle-falta"></div>';
  html += '<button type="button" class="btn-entrega-confirmar" id="btn-entrega-confirmar" disabled onclick="confirmarEntrega(\'detalle\')">Terminar</button>';
  setTimeout(_actualizarBotonDetalleEnt, 0);
  return html + '</div>';
}

function _motivoDetalleEnt(b) {
  if (!b.motivo) return '';
  if (b.motivo === 'otro') {
    var t = (b.motivoTexto || '').trim();
    return t ? 'Otro: ' + t : '';
  }
  var m = _ENT_MOTIVOS.find(function(x) { return x.value === b.motivo; });
  return m ? m.label : '';
}

/* En DETALLE el texto de "otro" se escribe sin repintar: el botón se
   habilita a mano */
window._actualizarBotonDetalleEnt = function() {
  if (!_entOrden) return;
  var b = _borradorEnt(_entOrden.id);
  var faltan = [];
  if (!_motivoDetalleEnt(b)) faltan.push(b.motivo === 'otro' ? 'contar qué pasó' : 'el motivo');
  if (!(b.fotos.foto_no_entregado || []).length) faltan.push('al menos una foto');
  var btn = document.getElementById('btn-entrega-confirmar');
  if (btn) btn.disabled = faltan.length > 0;
  var el = document.getElementById('entrega-detalle-falta');
  if (el) el.innerHTML = faltan.length ? '<i class="ti ti-info-circle"></i> Falta ' + faltan.join(' y ') + '.' : '';
};

window.elegirMedioPagoEntrega = function(medio) {
  _borradorEnt(_entOrden.id).medioPago = medio;
  _repintarSeccionEnt();
};
window.elegirOtroEntrega = function(valor) {
  _borradorEnt(_entOrden.id).otro = valor;
  _repintarSeccionEnt();
};
window.elegirMotivoEntrega = function(valor) {
  _borradorEnt(_entOrden.id).motivo = valor;
  _repintarSeccionEnt();
  if (valor === 'otro') {
    var inp = document.getElementById('entrega-motivo-texto');
    if (inp) inp.focus();
  }
};

/* Solo la sección del modo: así no se recarga la foto del producto */
function _repintarSeccionEnt() {
  var sec = document.getElementById('entrega-seccion');
  if (sec && _entOrden) sec.innerHTML = _seccionModoEnt(_entOrden, _borradorEnt(_entOrden.id));
  _mostrarErrorEnt('');
}

var _ENT_TITULOS_FOTO = {
  foto_entrega:         'Foto de la entrega',
  foto_cambio:          'Foto del producto que te dio el cliente',
  evidencia_medio_pago: 'Foto del pago',
  foto_reprogramado:    'Foto: reprogramado',
  foto_ausente:         'Foto: ausente',
  foto_cancelado:       'Foto: cancelado',
  foto_no_entregado:    'Foto: no se entregó',
};

/* Abre la cámara y guarda la foto aceptada en el borrador. No sube
   nada: eso pasa al confirmar (ver confirmarEntrega). */
window.tomarFotoEntrega = async function(tipo, idx) {
  if (!_entOrden || _entGuardando) return;
  var orden = _entOrden;
  var blob = await pedirFoto({
    titulo:  (_ENT_TITULOS_FOTO[tipo] || 'Foto') + ' — #' + orden.codigo,
    textoOk: 'Usar foto',
  });
  _guardarFotoEnt(orden, tipo, idx, blob);
};

/* Galería: el input sin "capture" deja elegir una imagen ya guardada
   (captura del Yape, foto del voucher). Se comprime igual que la de
   la cámara y queda en el borrador; la sube la cola al confirmar. */
var _entDestinoGaleria = null;

function _inputGaleriaEnt() {
  var input = document.getElementById('entrega-input-galeria');
  if (input) return input;
  input = document.createElement('input');
  input.type = 'file';
  input.id = 'entrega-input-galeria';
  input.accept = 'image/*';
  input.style.display = 'none';
  input.onchange = _onImagenGaleriaEnt;
  document.body.appendChild(input);
  return input;
}

window.subirImagenEntrega = function(tipo, idx) {
  if (!_entOrden || _entGuardando) return;
  _entDestinoGaleria = { orden: _entOrden, tipo: tipo, idx: idx };
  _inputGaleriaEnt().click();
};

async function _onImagenGaleriaEnt() {
  var input = this;
  var file = input.files && input.files[0];
  input.value = ''; /* permite volver a elegir la misma imagen */
  var destino = _entDestinoGaleria;
  _entDestinoGaleria = null;
  if (!file || !destino) return;

  var blob;
  try {
    blob = await comprimirImagenJPEG(file, _FOTO_MAX_ANCHO, _FOTO_CALIDAD);
  } catch (err) {
    _mostrarErrorEnt(err.message || 'No se pudo usar esa imagen. Prueba con otra.');
    return;
  }
  _guardarFotoEnt(destino.orden, destino.tipo, destino.idx, blob);
}

function _guardarFotoEnt(orden, tipo, idx, blob) {
  if (!blob || _entOrden !== orden || _entGuardando) return;

  var b = _borradorEnt(orden.id);
  if (tipo === 'foto_no_entregado') {
    var lista = b.fotos.foto_no_entregado || (b.fotos.foto_no_entregado = []);
    if (idx != null && idx < lista.length) lista[idx] = blob;
    else if (lista.length < _ENT_MAX_FOTOS_DETALLE) lista.push(blob);
  } else {
    b.fotos[tipo] = blob;
  }
  _repintarSeccionEnt();
}

function _mostrarErrorEnt(msg) {
  var el = document.getElementById('entrega-error');
  if (!el) return;
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
  if (msg) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* Arma el pedido y la lista de fotos que van a la cola, según el modo */
function _pedidoResolverEnt(o, b, modo) {
  if (modo === 'completar') {
    var fotos = [['foto_entrega', b.fotos.foto_entrega]];
    if (o.condicionEspecial) fotos.push(['foto_cambio', b.fotos.foto_cambio]);
    var medio = o.metodo_pago === 'contraentrega' ? b.medioPago : null;
    if (medio && _ENT_MEDIOS_CON_FOTO.indexOf(medio) !== -1) fotos.push(['evidencia_medio_pago', b.fotos.evidencia_medio_pago]);
    return { cuerpo: { resultado: 'entregado', medioPago: medio }, fotos: fotos, aviso: 'Entrega completada' };
  }
  if (modo === 'otros') {
    var x = _ENT_OTROS.find(function(y) { return y.value === b.otro; });
    return { cuerpo: { resultado: x.value, motivo: (b.motivoOtros || '').trim() }, fotos: [[x.foto, b.fotos[x.foto]]], aviso: 'Orden marcada como ' + x.label.toLowerCase() };
  }
  return {
    cuerpo: { resultado: 'no-entregado', motivo: _motivoDetalleEnt(b) },
    fotos: (b.fotos.foto_no_entregado || []).map(function(blob) { return ['foto_no_entregado', blob]; }),
    aviso: 'Orden marcada como no entregada',
  };
}

/* Cierra la orden: PATCH /resolver y, si salió bien, las fotos a la
   cola y directo a la siguiente orden. Si falla, la pantalla queda
   como estaba (con las fotos) para reintentar. */
window.confirmarEntrega = async function(modo) {
  if (!_entOrden || _entGuardando) return;
  var o = _entOrden;
  var b = _borradorEnt(o.id);
  var pedido = _pedidoResolverEnt(o, b, modo);
  if (pedido.fotos.some(function(f) { return !f[1]; })) return; /* el botón ya lo impide */

  var btn = document.getElementById('btn-entrega-confirmar');
  var textoBtn = btn ? btn.innerHTML : '';
  _entGuardando = true;
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader"></i> Guardando...'; }
  _mostrarErrorEnt('');

  var cuerpo = Object.assign({ ifVersion: o.version || undefined }, pedido.cuerpo);
  var r, data;
  try {
    r = await fetch(API + '/ordenes/' + o.id + '/resolver', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    data = await r.json().catch(function() { return {}; });
  } catch (err) {
    _entGuardando = false;
    if (btn) { btn.disabled = false; btn.innerHTML = textoBtn; }
    _mostrarErrorEnt('Sin conexión: no se guardó. Tus fotos siguen acá; prueba de nuevo cuando tengas señal.');
    return;
  }

  if (!r.ok) {
    _entGuardando = false;
    /* Ya la cerró alguien (la oficina, u otra pestaña): se saca de la
       lista y se pasa a la siguiente sin subir estas fotos */
    if (r.status === 409 && data.yaResuelta) {
      if (typeof showNotif === 'function') showNotif(data.error || 'Esta orden ya estaba cerrada', 4000);
      _soltarUrlsEnt(b);
      delete _entBorradores[o.id];
      return _irASiguienteEnt(o.id);
    }
    /* Otro usuario la modificó: se toma la versión nueva para que el
       reintento no vuelva a chocar, y se avisa */
    if (r.status === 409 && data.orden) {
      Object.assign(o, data.orden);
      _pintarOverlayEnt();
      _mostrarErrorEnt('La oficina modificó esta orden mientras la llenabas. Revisa los datos y confirma de nuevo.');
      return;
    }
    if (btn) { btn.disabled = false; btn.innerHTML = textoBtn; }
    _mostrarErrorEnt(data.error || 'No se pudo guardar. Prueba de nuevo.');
    return;
  }

  /* Orden cerrada: recién ahora las fotos van a la cola, que las sube
     sola en segundo plano */
  var sinGuardar = 0;
  for (var i = 0; i < pedido.fotos.length; i++) {
    try {
      var enCola = await encolarFoto(o.id, pedido.fotos[i][0], pedido.fotos[i][1], o.codigo);
      if (!enCola.persistente) sinGuardar++;
    } catch (errFoto) {
      console.error('Cola de fotos (entrega):', errFoto);
      sinGuardar++;
    }
  }
  _entGuardando = false;
  _soltarUrlsEnt(b);
  delete _entBorradores[o.id];

  if (typeof showNotif === 'function') {
    showNotif(sinGuardar
      ? pedido.aviso + ' · ojo: ' + sinGuardar + ' foto(s) no se pudieron guardar en el teléfono, no cierres Velox hasta que suban'
      : pedido.aviso + ' · las fotos se suben solas', sinGuardar ? 6000 : 2500);
  }

  /* La tabla de abajo y el resumen se alimentan de lo que se cerró */
  if (typeof _renderTablaResumen === 'function') _renderTablaResumen();
  if (typeof _refrescarPanelDetalleSiAbierto === 'function') _refrescarPanelDetalleSiAbierto();

  _irASiguienteEnt(o.id);
};

/* Modo app: abre directo la siguiente orden pendiente. Sin pendientes,
   vuelve a la lista (que muestra que se terminó el día). */
async function _irASiguienteEnt(idCerrada) {
  var anterior = _entPendientes.map(function(x) { return x.id; });
  try {
    _entPendientes = await _cargarPendientesHoy();
  } catch (err) {
    /* Sin red para recargar: se sigue con la lista que había */
    _entPendientes = _entPendientes.filter(function(x) { return x.id != idCerrada; });
  }
  _entUltimoHtml = null;
  _recargarEntregasHoy(false);

  /* La que seguía en la lista; si ya no está, la primera que quede */
  var desde = anterior.indexOf(idCerrada);
  var siguiente = null;
  for (var i = desde + 1; i < anterior.length && !siguiente; i++) {
    siguiente = _entPendientes.find(function(x) { return x.id == anterior[i]; }) || null;
  }
  siguiente = siguiente || _entPendientes.find(function(x) { return x.id != idCerrada; }) || null;

  if (siguiente) {
    empezarEntrega(siguiente.id);
  } else {
    volverAListaEntregas();
    if (typeof showNotif === 'function') showNotif('¡Terminaste las entregas de hoy!', 3500);
  }
}
