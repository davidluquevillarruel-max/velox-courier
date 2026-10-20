/* ============================================================
   ordenes-pendientes.js — Botón "Pendiente" y su ventana
   (página "Todos los pedidos")

   Las órdenes de foto en ráfaga (botón ⚡, ver js/pedidos.js)
   nacen con su tienda pero sin los demás datos, y con la marca
   datos_pendientes. Este botón:
     · Se habilita solo si hay alguna (gris si no queda ninguna).
       Se refresca cada 8 s y cada vez que la cola crea una orden.
     · Abre una ventana con una fila por orden: la foto y al
       costado los campos que faltan, con "Guardar" por fila.
       Al guardar, la fila se va y las demás quedan.

   Qué campos se piden lo decide el servidor (CAMPOS_PENDIENTES en
   server/routes/ordenes.js, viene en GET /ordenes/pendientes-datos).
   Acá solo está cómo se dibuja y valida cada uno
   (_CAMPOS_PENDIENTES_FORM): si se saca un campo de la lista del
   servidor, desaparece solo de la ventana; para uno nuevo hay que
   agregarlo en los dos lados.

   La tienda no está en la lista: solo la piden las filas con
   falta_tienda (órdenes creadas con la tienda comodín, de antes de
   que la ráfaga pidiera la tienda). En las demás se ve en la cabecera.

   Solo admin / operador (el servidor lo exige igual).
   ============================================================ */

var _pendientesOrdenes = {};  /* id → orden, con la versión con que se abrió su fila */
var _pendientesCampos  = [];  /* claves de CAMPOS_PENDIENTES que mandó el servidor */
var _pendientesCargando = false;

var _ESTILO_INPUT_PEND = 'width:100%;border-radius:var(--radius-md);padding:8px 12px';
var _ESTILO_LABEL_PEND = 'font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:4px;font-weight:500';

/* Un campo por clave de CAMPOS_PENDIENTES:
   · input(id)  → HTML del control (id = id de la orden)
   · leer(id)   → valor escrito
   · validar(v) → { ok, msg } (mismas reglas que "Nueva orden")
   · body       → nombre del dato en PATCH /:id/completar-datos */
var _CAMPOS_PENDIENTES_FORM = {
  tienda: {
    label: 'Tienda *',
    input: function(id) {
      return '<input id="pend-tienda-' + id + '" class="search-box" style="' + _ESTILO_INPUT_PEND + '" placeholder="Escribe para buscar tienda..." />';
    },
    leer: function(id) { return _valorPend('pend-tienda-' + id); },
    validar: function(v) { return v ? { ok: true } : { ok: false, msg: 'Elegí la tienda de la lista.' }; },
    body: 'tienda',
  },
  destinatario: {
    label: 'Nombre destinatario *',
    input: function(id) {
      return '<input id="pend-dest-' + id + '" class="search-box" style="' + _ESTILO_INPUT_PEND + '" placeholder="Ej: Ana Quispe" maxlength="100" ' +
        'onkeydown="if(event.key===\'Enter\')guardarPendiente(\'' + id + '\')" />';
    },
    leer: function(id) { return _valorPend('pend-dest-' + id).trim(); },
    validar: function(v) {
      return validarTexto(v, { obligatorio: true, min: 2, max: 100, nombreCampo: 'El nombre del destinatario' });
    },
    body: 'dest',
  },
  telefono: {
    label: 'Teléfono *',
    input: function(id) {
      return '<input id="pend-telef-' + id + '" class="search-box" style="' + _ESTILO_INPUT_PEND + '" placeholder="9 dígitos" maxlength="9" inputmode="numeric" ' +
        'oninput="this.value=this.value.replace(/[^0-9]/g,\'\')" ' +
        'onkeydown="if(event.key===\'Enter\')guardarPendiente(\'' + id + '\')" />';
    },
    leer: function(id) { return _valorPend('pend-telef-' + id).trim(); },
    validar: function(v) { return validarTelefonoObligatorio(v); },
    body: 'telefDest',
  },
  /* Al guardarlo, el servidor pone delivery y pago al motorizado con
     la tarifa del distrito */
  distrito: {
    label: 'Distrito *',
    input: function(id) {
      return '<input id="pend-distrito-' + id + '" class="search-box" style="' + _ESTILO_INPUT_PEND + '" placeholder="Escribe para buscar distrito..." />';
    },
    leer: function(id) { return _valorPend('pend-distrito-' + id); },
    validar: function(v) {
      return CATALOGO_DISTRITOS.indexOf(v) !== -1 ? { ok: true } : { ok: false, msg: 'Elegí el distrito de la lista.' };
    },
    body: 'distrito',
  },
  /* Obligatorio, 0 vale (= sin cobro). El servidor pone el método de
     pago (contraentrega / sin-cobro) y el valor del producto */
  cobrado: {
    label: 'Cobrado (S/) *',
    input: function(id) {
      return '<input id="pend-cobrado-' + id + '" type="number" min="0" step="0.50" inputmode="decimal" class="search-box" style="' + _ESTILO_INPUT_PEND + '" placeholder="0 si no se cobra" ' +
        'onkeydown="if(event.key===\'Enter\')guardarPendiente(\'' + id + '\')" />';
    },
    leer: function(id) { return _valorPend('pend-cobrado-' + id).trim(); },
    validar: function(v) {
      if (v === '') return { ok: false, msg: 'Escribí el monto cobrado (0 si no se cobra).' };
      var n = Number(v);
      if (!isFinite(n) || n < 0) return { ok: false, msg: 'El monto cobrado no es válido.' };
      return { ok: true, valor: Math.round(n * 100) / 100 };
    },
    body: 'cobrado',
  },
};

/* Campos que pide la fila de una orden: los de la lista del servidor,
   y antes la tienda si la orden todavía tiene la tienda comodín */
function _camposDeFila(o) {
  return (o.falta_tienda ? ['tienda'] : []).concat(_pendientesCampos);
}

function _valorPend(idElemento) {
  var el = document.getElementById(idElemento);
  return el ? el.value : '';
}

function _escPend(txt) {
  return String(txt == null ? '' : txt)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* hora_asignacion llega como "1970-01-01T00:10:00.000Z" (TIME de SQL) */
function _horaPend(h) {
  if (!h) return '';
  var s = String(h);
  return s.indexOf('T') !== -1 ? s.substr(11, 5) : s.substr(0, 5);
}

function _modalPendientesAbierto() {
  var ov = document.getElementById('pendientes-modal-overlay');
  return !!ov && ov.style.display === 'flex';
}

/* ════════════════════════════════════════════
   BOTÓN
════════════════════════════════════════════ */
async function refrescarBotonPendientes() {
  var btn = document.getElementById('btn-pendientes-pedidos');
  if (!btn || btn.style.display === 'none') return;

  try {
    var r = await fetch(API + '/ordenes/pendientes-datos/total');
    if (!r.ok) return;
    var total = (await r.json()).total || 0;
    _pintarBotonPendientes(total);
  } catch (err) {
    /* Sin señal: el botón se queda como estaba */
  }

  if (_modalPendientesAbierto()) _sincronizarListaPendientes();
}

function _pintarBotonPendientes(total) {
  var btn = document.getElementById('btn-pendientes-pedidos');
  var lbl = document.getElementById('lbl-total-pendientes');
  if (!btn) return;
  btn.disabled = total === 0;
  btn.title = total === 0
    ? 'No hay órdenes por completar'
    : total + (total === 1 ? ' orden por completar' : ' órdenes por completar');
  if (lbl) lbl.textContent = total ? '(' + total + ')' : '';
}

/* Lo llama initPedidos (js/pedidos.js) al entrar a la página */
function initBotonPendientes() {
  var btn = document.getElementById('btn-pendientes-pedidos');
  if (!btn) return;
  if (typeof _esGestorPedidos === 'function' && !_esGestorPedidos()) {
    btn.style.display = 'none';
    return;
  }
  refrescarBotonPendientes();
  iniciarRefrescoAutomatico('btn-pendientes-pedidos', refrescarBotonPendientes);
}

/* La cola creó una orden de ráfaga, o subió una foto: el botón (y
   la ventana, si está abierta) se actualizan sin esperar los 8 s */
window.addEventListener('velox:orden-rafaga-creada', function() { refrescarBotonPendientes(); });
window.addEventListener('velox:foto-subida', function(e) {
  if (e.detail && e.detail.tipo === 'foto_producto' && _modalPendientesAbierto()) _sincronizarListaPendientes();
});

/* ════════════════════════════════════════════
   VENTANA
════════════════════════════════════════════ */
window.abrirPendientes = function() {
  _pendientesOrdenes = {};
  var lista = document.getElementById('pendientes-lista');
  if (lista) {
    lista.innerHTML = '<div style="font-size:13px;color:var(--color-text-secondary);padding:12px 0">Cargando...</div>';
  }
  document.getElementById('pendientes-modal-overlay').style.display = 'flex';
  _sincronizarListaPendientes();
};

window.cerrarPendientes = function() {
  document.getElementById('pendientes-modal-overlay').style.display = 'none';
  _pendientesOrdenes = {};
  if (typeof renderPedidos === 'function') renderPedidos();
  refrescarBotonPendientes();
};

/* Trae las pendientes y actualiza la lista SIN borrar lo que ya se
   está escribiendo: agrega las nuevas (otra ráfaga), saca las que ya
   no están pendientes (las completó otro usuario) y pone la foto
   cuando termina de subir. */
async function _sincronizarListaPendientes() {
  if (_pendientesCargando) return;
  _pendientesCargando = true;
  try {
    var r = await fetch(API + '/ordenes/pendientes-datos');
    if (!r.ok) throw new Error('No se pudieron cargar las órdenes pendientes');
    var data = await r.json();
    if (!_modalPendientesAbierto()) return;

    _pendientesCampos = (data.campos || []).filter(function(c) {
      if (c === 'tienda') return false;  /* va por fila, con falta_tienda */
      if (_CAMPOS_PENDIENTES_FORM[c]) return true;
      console.warn('Ventana "Pendiente": el campo "' + c + '" no está en _CAMPOS_PENDIENTES_FORM');
      return false;
    });

    /* Fotos que siguen en la cola de ESTE teléfono (para decir
       "subiendo" en vez de "sin foto") */
    var enCola = {};
    if (typeof obtenerColaFotos === 'function') {
      (await obtenerColaFotos()).forEach(function(it) { if (it.ordenId) enCola[it.ordenId] = true; });
    }

    var lista = document.getElementById('pendientes-lista');
    var vigentes = {};
    data.ordenes.forEach(function(o) {
      vigentes[o.id] = true;
      if (!_pendientesOrdenes[o.id]) {
        _pendientesOrdenes[o.id] = o;
        if (!lista.querySelector('[data-pendiente]')) lista.innerHTML = '';
        lista.insertAdjacentHTML('beforeend', _filaPendienteHTML(o, enCola[o.id]));
        _initFilaPendiente(o);
      } else if (o.foto_producto_url && !_pendientesOrdenes[o.id].foto_producto_url) {
        /* Llegó la foto: se cambia solo la foto, la versión de la fila no */
        _pendientesOrdenes[o.id].foto_producto_url = o.foto_producto_url;
        var foto = document.getElementById('pend-foto-' + o.id);
        if (foto) foto.innerHTML = _fotoPendienteHTML(_pendientesOrdenes[o.id], false);
      }
    });

    Object.keys(_pendientesOrdenes).forEach(function(id) {
      if (!vigentes[id]) _quitarFilaPendiente(id);
    });

    _pintarTotalesPendientes();
  } catch (err) {
    var listaErr = document.getElementById('pendientes-lista');
    if (listaErr && !Object.keys(_pendientesOrdenes).length) {
      listaErr.innerHTML = '<div style="font-size:13px;color:var(--color-red-text);padding:12px 0">' +
        _escPend(err.message || 'Sin conexión con el servidor') + '</div>';
    }
  } finally {
    _pendientesCargando = false;
  }
}

function _fotoPendienteHTML(o, subiendo) {
  var caja = 'width:110px;height:110px;border-radius:var(--radius-md);';
  if (o.foto_producto_url) {
    var url = _escPend(o.foto_producto_url);
    return '<a href="' + url + '" target="_blank" rel="noopener" title="Ver la foto en grande">' +
      '<img src="' + url + '" alt="Foto del producto" loading="lazy" style="' + caja + 'object-fit:cover;display:block;background:var(--color-bg-secondary)"></a>';
  }
  return '<div style="' + caja + 'background:var(--color-bg-secondary);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font-size:11px;color:var(--color-text-tertiary);text-align:center;padding:6px">' +
    '<i class="ti ' + (subiendo ? 'ti-cloud-upload' : 'ti-photo-off') + '" style="font-size:22px"></i>' +
    (subiendo ? 'Foto subiendo...' : 'Foto todavía no llegó') +
  '</div>';
}

function _filaPendienteHTML(o, subiendo) {
  var id = _escPend(o.id);
  var hora = _horaPend(o.hora_asignacion);
  var cabecera = '#' + _escPend(o.codigo) +
    ' <span style="font-weight:400;color:var(--color-text-tertiary)">· ' +
    (typeof _fechaDisplay === 'function' ? _fechaDisplay(o.fecha) : _escPend(o.fecha)) +
    (hora ? ' · ' + _escPend(hora) : '') + '</span>' +
    (o.falta_tienda ? '' :
      '<div style="font-size:13px;font-weight:500;margin-top:2px"><i class="ti ti-building-store"></i> ' + _escPend(o.tienda) + '</div>');

  var campos = _camposDeFila(o).map(function(c) {
    var def = _CAMPOS_PENDIENTES_FORM[c];
    return '<div><label style="' + _ESTILO_LABEL_PEND + '">' + def.label + '</label>' + def.input(id) + '</div>';
  }).join('');

  return '<div id="pend-fila-' + id + '" data-pendiente="' + id + '" ' +
    'style="display:grid;grid-template-columns:110px 1fr;gap:14px;padding:12px;border:0.5px solid var(--color-border-secondary);border-radius:var(--radius-md)">' +
    '<div id="pend-foto-' + id + '">' + _fotoPendienteHTML(o, subiendo) + '</div>' +
    '<div style="min-width:0;display:flex;flex-direction:column;gap:10px">' +
      '<div style="font-size:13px;font-weight:600">' + cabecera + '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px">' + campos + '</div>' +
      '<div style="display:flex;align-items:center;gap:10px;justify-content:flex-end;flex-wrap:wrap">' +
        '<div id="pend-error-' + id + '" style="display:none;flex:1;min-width:160px;color:var(--color-red-text);font-size:12px;padding:6px 10px;background:var(--color-red-bg);border-radius:var(--radius-md)"></div>' +
        '<button type="button" class="btn btn-primary btn-sm" id="pend-guardar-' + id + '" onclick="guardarPendiente(\'' + id + '\')">' +
          '<i class="ti ti-check"></i> Guardar' +
        '</button>' +
      '</div>' +
    '</div>' +
  '</div>';
}

/* Los combobox buscables necesitan el input ya en la página */
function _initFilaPendiente(o) {
  var campos = _camposDeFila(o);
  if (campos.indexOf('tienda') !== -1) {
    initComboBuscable('pend-tienda-' + o.id, function() {
      return CATALOGO_TIENDAS.map(function(t) { return { value: t.nombre, label: t.nombre }; });
    });
  }
  if (campos.indexOf('distrito') !== -1) {
    initComboBuscable('pend-distrito-' + o.id, function() {
      return CATALOGO_DISTRITOS.map(function(d) { return { value: d, label: d }; });
    });
  }
}

function _quitarFilaPendiente(id) {
  delete _pendientesOrdenes[id];
  var fila = document.getElementById('pend-fila-' + id);
  if (fila) fila.remove();
  _pintarTotalesPendientes();
}

function _pintarTotalesPendientes() {
  var total = Object.keys(_pendientesOrdenes).length;
  var lbl = document.getElementById('pendientes-modal-total');
  if (lbl) lbl.textContent = total ? '(' + total + ')' : '';
  _pintarBotonPendientes(total);

  var lista = document.getElementById('pendientes-lista');
  if (lista && !total) {
    lista.innerHTML =
      '<div style="text-align:center;padding:28px 12px;color:var(--color-text-secondary)">' +
        '<i class="ti ti-circle-check" style="font-size:32px;color:var(--color-green)"></i>' +
        '<div style="font-size:14px;font-weight:600;margin-top:8px;color:var(--color-text-primary)">No quedan órdenes por completar</div>' +
        '<div style="font-size:12px;margin-top:4px">Las órdenes completadas ya están en "Todos los pedidos".</div>' +
      '</div>';
  }
}

function _errorFilaPendiente(id, msg) {
  var el = document.getElementById('pend-error-' + id);
  if (!el) return;
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
}

/* Guarda una fila: los datos van a la orden de ESA fila (por su id) */
window.guardarPendiente = async function(id) {
  var orden = _pendientesOrdenes[id];
  var btn = document.getElementById('pend-guardar-' + id);
  if (!orden || !btn || btn.disabled) return;

  var body = { ifVersion: orden.version };
  var campos = _camposDeFila(orden);
  for (var i = 0; i < campos.length; i++) {
    var def = _CAMPOS_PENDIENTES_FORM[campos[i]];
    var valor = def.leer(id);
    var res = def.validar(valor);
    if (!res.ok) { _errorFilaPendiente(id, res.msg); return; }
    body[def.body] = res.valor !== undefined ? res.valor : valor;
  }
  _errorFilaPendiente(id, '');

  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader"></i> Guardando...';
  var restaurarBoton = function() {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-check"></i> Guardar';
  };

  try {
    var r = await fetch(API + '/ordenes/' + encodeURIComponent(id) + '/completar-datos', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    var data = await r.json().catch(function() { return {}; });

    if (r.status === 409 && data.orden) {
      if (!data.orden.datos_pendientes) {
        _quitarFilaPendiente(id);
        if (typeof showNotif === 'function') showNotif('La orden #' + orden.codigo + ' ya la completó otro usuario.', 4000);
        return;
      }
      /* La cambió otro usuario pero sigue pendiente: se toma la versión
         nueva y se pide guardar de nuevo, sin borrar lo escrito */
      orden.version = data.orden.version;
      _errorFilaPendiente(id, 'Otro usuario modificó esta orden mientras la completabas. Revisá y tocá "Guardar" de nuevo.');
      restaurarBoton();
      return;
    }
    if (!r.ok) {
      _errorFilaPendiente(id, data.error || 'No se pudo guardar.');
      restaurarBoton();
      return;
    }

    if (data.datos_pendientes) {
      /* No debería pasar con los campos de la ventana; por las dudas */
      orden.version = data.version;
      _errorFilaPendiente(id, 'Se guardó, pero a la orden todavía le faltan datos.');
      restaurarBoton();
      return;
    }

    _quitarFilaPendiente(id);
    if (typeof showNotif === 'function') showNotif('Orden #' + orden.codigo + ' completada');
  } catch (err) {
    _errorFilaPendiente(id, 'Sin conexión con el servidor: no se guardó. Probá de nuevo cuando haya señal.');
    restaurarBoton();
  }
};
