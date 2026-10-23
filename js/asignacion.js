/* ============================================================
   asignacion.js — Asignación y reasignación de órdenes
   Carga sus propios datos desde la API (no depende de haber
   visitado antes la página de Pedidos) y cada acción hace un
   PATCH real contra la BD, igual que el resto del sistema.
   ============================================================ */

/* ════════════════════════════════════════════
   MAPA ZONA POR DISTRITO
   Se usa para el autoasignar
════════════════════════════════════════════ */
var ZONA_DISTRITO = {
  /* Norte/Este */
  'INDEPENDENCIA':'Norte/Este','LOS OLIVOS':'Norte/Este','SAN MARTÍN DE PORRES':'Norte/Este',
  'COMAS':'Norte/Este','CARABAYLLO':'Norte/Este','PUENTE PIEDRA':'Norte/Este',
  'PTE. PIEDRA':'Norte/Este','RÍMAC':'Norte/Este','SAN JUAN DE LURIGANCHO':'Norte/Este',
  'EL AGUSTINO':'Norte/Este','ATE':'Norte/Este','ATE - SANTA CLARA':'Norte/Este',
  'ATE - SALAMANCA':'Norte/Este','ATE - HUACHIPA':'Norte/Este','ATE - VITARTE':'Norte/Este',
  'ATE - GLORIA GRANDE':'Norte/Este','SANTA ANITA':'Norte/Este',
  'LURIGANCHO - CHOSICA':'Norte/Este','LURIGANCHO CAMPOY':'Norte/Este',
  'LURIGANCHO':'Norte/Este','HUAYCAN':'Norte/Este','ANCON':'Norte/Este',
  'ZAPALLAL':'Norte/Este','CHOSICA':'Norte/Este','HUACHIPA':'Norte/Este',
  'SJL MARISCAL':'Norte/Este','SJL MONTE NEGRO':'Norte/Este','SJL JICAMARCA':'Norte/Este',
  'SJL MOTUPE':'Norte/Este','SJL HUASCAR':'Norte/Este','SJL BAYOBAR':'Norte/Este',
  /* Sur */
  'BARRANCO':'Sur','CHORRILLOS':'Sur','SAN JUAN DE MIRAFLORES':'Sur',
  'VILLA MARÍA DEL TRIUNFO':'Sur','VILLA EL SALVADOR':'Sur','LURÍN':'Sur',
  'MANCHAY':'Sur','SANTIAGO DE SURCO':'Sur','SURQUILLO':'Sur','SAN LUIS':'Sur',
  'VMT JOSE GALVEZ':'Sur','PUNTA HERMOSA':'Sur','CIENEGUILLA':'Sur',
  /* Centro */
  'MIRAFLORES':'Centro','SAN ISIDRO':'Centro','SAN BORJA':'Centro','SAN MIGUEL':'Centro',
  'JESÚS MARÍA':'Centro','MAGDALENA DEL MAR':'Centro','PUEBLO LIBRE':'Centro',
  'LINCE':'Centro','BREÑA':'Centro','LA VICTORIA':'Centro','LA MOLINA':'Centro',
  'LIMA':'Centro','CDO DE LIMA':'Centro',
  /* Callao */
  'CALLAO':'Callao','CARMEN DE LA LEGUA':'Callao','VENTANILLA':'Callao','OQUENDO':'Callao',
  'LA PERLA':'Callao',
};

/* ════════════════════════════════════════════
   DATOS — cargados desde la API
════════════════════════════════════════════ */
var ORDENES_ASIG     = [];
var MOTORIZADOS_ASIG = [];
var TIENDAS_ASIG     = [];
var _reasignandoOrdenId = null;
var _comboMotoAsig = null; /* combobox buscable de js/combobox.js */

/* Refresco automático del pool de pendientes: si otro motorizado
   conectado al mismo tiempo se autoasigna una orden, acá se entera
   solo (sin recargar la página) en vez de recién notarlo al hacer
   clic y recibir el error del servidor. Se detiene solo si la
   página de Asignación ya no está en pantalla (ver _sondearAsignacion). */
var _INTERVALO_SONDEO_ASIG_MS = 10000;
var _sondeoAsignacionId = null;

async function _cargarDatosAsignacion() {
  try {
    var [rO, rM, rT] = await Promise.all([
      fetch(API + '/ordenes'),
      fetch(API + '/motorizados'),
      fetch(API + '/tiendas'),
    ]);
    /* Las órdenes de foto en ráfaga con datos pendientes no se
       reparten hasta que se completan (botón "Pendiente" en "Todos
       los pedidos"). El servidor ya rechaza asignarlas y al
       motorizado ni se las manda; esto las saca de la pantalla
       para admin / operador. */
    ORDENES_ASIG     = (await rO.json()).filter(function(o) { return !o.datos_pendientes; });
    MOTORIZADOS_ASIG = await rM.json();
    TIENDAS_ASIG      = (await rT.json()).filter(function(t){ return t.activa; });
  } catch (err) {
    console.error('Error cargando datos de asignación:', err);
    ORDENES_ASIG = []; MOTORIZADOS_ASIG = []; TIENDAS_ASIG = [];
  }
}

/* ════════════════════════════════════════════
   INIT
════════════════════════════════════════════ */
window.initAsignacion = async function() {
  var pool = document.getElementById('pool-libre');
  if (pool) pool.innerHTML = '<div style="padding:24px;text-align:center;color:var(--color-text-tertiary);font-size:13px"><i class="ti ti-loader"></i> Cargando...</div>';

  await _cargarDatosAsignacion();
  _initComboMotoAsig();
  _initFiltrosAsignacion();

  /* Si es motorizado, pre-seleccionar su nombre, bloquear el campo, y
     ocultar "Autoasignar todos" (acción de gestores — ver PATCH /asignar) */
  var sesion = _obtenerSesionAsig();
  if (sesion && sesion.rol === 'motorizado' && sesion.nombre) {
    var sel = document.getElementById('moto-select');
    if (sel) {
      if (_comboMotoAsig) _comboMotoAsig.setValor(sesion.nombre);
      sel.disabled = true; /* no puede cambiar a otro motorizado */
    }
    var btnAuto = document.getElementById('btn-autoasignar');
    if (btnAuto) btnAuto.style.display = 'none';
    /* El motorizado que se autoasigna siempre reparte hoy (lo decide
       el servidor): no elige fecha */
    var bloqueFecha = document.getElementById('bloque-fecha-reparto-asig');
    if (bloqueFecha) bloqueFecha.style.display = 'none';
  }
  _initFechaRepartoAsig();

  _renderPoolPendientes();
  _renderPoolAsignados();
  _actualizarContadores();

  _sondearAsignacion();
};

/* Repite la carga cada _INTERVALO_SONDEO_ASIG_MS mientras el usuario
   siga en esta página. Los filtros (texto/tienda/distrito) y el
   motorizado elegido no se tocan — viven en los inputs, así que se
   respetan solos en cada repintado. */
function _sondearAsignacion() {
  if (_sondeoAsignacionId) clearInterval(_sondeoAsignacionId);

  _sondeoAsignacionId = setInterval(async function() {
    if (!document.getElementById('pool-libre')) {
      /* Se navegó a otra página: esta ya no existe en el DOM */
      clearInterval(_sondeoAsignacionId);
      _sondeoAsignacionId = null;
      return;
    }
    await _cargarDatosAsignacion();
    _renderPoolPendientes();
    _renderPoolAsignados();
    _actualizarContadores();
  }, _INTERVALO_SONDEO_ASIG_MS);
}

/* Helper para obtener sesión dentro de asignacion.js */
function _obtenerSesionAsig() {
  var raw = localStorage.getItem('velox_usuario');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch(e) { return null; }
}

/* ════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════ */
function _hoyAsig() {
  var d  = new Date();
  var mm = ('0'+(d.getMonth()+1)).slice(-2);
  var dd = ('0'+d.getDate()).slice(-2);
  return d.getFullYear() + '-' + mm + '-' + dd;
}

/* Fecha de reparto para lo que se asigne desde esta página: hoy por
   defecto, hasta 7 días adelante (el servidor valida igual, y además
   que no sea antes de la creación de cada orden) */
function _initFechaRepartoAsig() {
  var inp = document.getElementById('f-fecha-reparto-asig');
  if (!inp) return;
  var max = new Date();
  max.setDate(max.getDate() + 7);
  inp.max = max.getFullYear() + '-' + ('0'+(max.getMonth()+1)).slice(-2) + '-' + ('0'+max.getDate()).slice(-2);
  if (!inp.value) inp.value = _hoyAsig();
}

/* Cuerpo del PATCH /asignar: el motorizado y, si la eligió un
   gestor, la fecha de reparto (el motorizado no la manda) */
function _cuerpoAsignar(nombreMoto) {
  var cuerpo = { motorizado: nombreMoto };
  var bloque = document.getElementById('bloque-fecha-reparto-asig');
  var inp    = document.getElementById('f-fecha-reparto-asig');
  if (inp && inp.value && !(bloque && bloque.style.display === 'none')) cuerpo.fechaReparto = inp.value;
  return cuerpo;
}

/* Mensaje del servidor si lo hay (fecha fuera de rango, día ya pagado
   en la Caja...), si no el genérico */
async function _errorAsignar(r, generico) {
  var data = await r.json().catch(function() { return {}; });
  return new Error(data.error || generico);
}

/* Pendiente = sin motorizado asignado (independientemente del estado).
   SIN filtrar — la usa "Autoasignar todos" y el contador de arriba,
   que deben seguir contando/tomando TODOS los pendientes sin importar
   el filtro de búsqueda que esté activo (ver _getOrdenesPendientesFiltradas). */
function _getOrdenesPendientes() {
  return ORDENES_ASIG.filter(function(o) {
    return !o.motorizado || o.motorizado.trim() === '';
  });
}

/* Lee los filtros de búsqueda actuales del pool de pendientes.
   Viven solo en este navegador — no se guardan ni comparten entre
   sesiones, así que cada motorizado conectado tiene los suyos. */
function _filtrosPoolAsig() {
  var val = function(id) { var el = document.getElementById(id); return el ? el.value : ''; };
  return {
    texto:    val('f-buscar-asignacion').toLowerCase().trim(),
    tienda:   val('f-filtro-tienda-asignacion').trim(),
    distrito: val('f-filtro-distrito-asignacion').trim(),
  };
}

/* Igual que _getOrdenesPendientes() pero aplicando los filtros — es
   lo único que usa el render del pool en pantalla. */
function _getOrdenesPendientesFiltradas() {
  var f = _filtrosPoolAsig();
  return _getOrdenesPendientes().filter(function(o) {
    if (f.tienda && o.tienda !== f.tienda) return false;
    if (f.distrito && o.distrito !== f.distrito) return false;
    if (f.texto) {
      var texto = ((o.codigo||'') + ' ' + (o.dest_nombre||'') + ' ' + (o.tienda||'') + ' ' + (o.distrito||'')).toLowerCase();
      if (texto.indexOf(f.texto) === -1) return false;
    }
    return true;
  });
}

/* Catálogo de distritos para el combobox de filtro — se arma solo con
   los distritos que aparecen entre las órdenes ya cargadas, no hace
   falta pedirle nada aparte al servidor. */
function _distritosDesdeOrdenesAsig() {
  var set = {};
  ORDENES_ASIG.forEach(function(o) { if (o.distrito) set[o.distrito] = true; });
  return Object.keys(set).sort();
}

/* Comboboxes buscables de tienda y distrito (js/combobox.js) —
   igual que los de "Todos los pedidos" */
function _initFiltrosAsignacion() {
  initComboBuscable('f-filtro-tienda-asignacion', function() {
    return TIENDAS_ASIG.map(function(t) { return { value: t.nombre, label: t.nombre }; });
  }, function() { filtrarPoolAsignacion(); });

  initComboBuscable('f-filtro-distrito-asignacion', function() {
    return _distritosDesdeOrdenesAsig().map(function(d) { return { value: d, label: d }; });
  }, function() { filtrarPoolAsignacion(); });
}

window.filtrarPoolAsignacion = function() {
  _renderPoolPendientes();
};

/* Ordenes asignadas al motorizado seleccionado */
function _getOrdenesAsignadas(nombreMoto) {
  if (!nombreMoto) return [];
  return ORDENES_ASIG.filter(function(o) {
    return o.motorizado && o.motorizado.trim().toUpperCase() === nombreMoto.trim().toUpperCase()
      && o.estado !== 'entregado'
      && o.estado !== 'cancelado';
  });
}

function _badgeEstadoAsig(estado) {
  var map = {
    'en-proceso':   '<span class="badge pendiente">En proceso</span>',
    'reprogramado': '<span class="badge reprogramado">Reprogramado</span>',
    'entregado':    '<span class="badge entregado">Entregado</span>',
    'ausente':      '<span class="badge ausente">Ausente</span>',
    'no-entregado': '<span class="badge no-entregado">No entregado</span>',
    'cancelado':    '<span class="badge no-entregado">Cancelado</span>',
  };
  return map[estado] || '<span class="badge pendiente">' + estado + '</span>';
}

/* ════════════════════════════════════════════
   COMBOBOX BUSCABLE — SELECTOR DE MOTORIZADO
════════════════════════════════════════════ */
function _initComboMotoAsig() {
  _comboMotoAsig = initComboBuscable('moto-select', function() {
    return MOTORIZADOS_ASIG.filter(function(m){ return m.activo; }).map(function(m) {
      return { value: m.nombre, label: m.nombre + (m.zona ? ' — ' + m.zona : '') };
    });
  }, function() {
    _renderPoolAsignados();
    _actualizarContadores();
  });
}

/* ════════════════════════════════════════════
   RENDER — POOL PENDIENTES (izquierda)
════════════════════════════════════════════ */
function _renderPoolPendientes() {
  var pool = document.getElementById('pool-libre');
  if (!pool) return;

  var pendientes = _getOrdenesPendientesFiltradas();
  pool.innerHTML = '';

  if (pendientes.length === 0) {
    var hayFiltro = _getOrdenesPendientes().length > 0; /* hay pendientes, pero el filtro no encontró ninguno */
    pool.innerHTML = hayFiltro
      ? '<div style="padding:24px;text-align:center;color:var(--color-text-tertiary);font-size:13px">' +
        '<i class="ti ti-search-off" style="font-size:24px;display:block;margin-bottom:8px"></i>' +
        'Ningún pendiente coincide con el filtro</div>'
      : '<div style="padding:24px;text-align:center;color:var(--color-text-tertiary);font-size:13px">' +
        '<i class="ti ti-check" style="font-size:24px;display:block;margin-bottom:8px"></i>' +
        'Todos los pedidos están asignados</div>';
    return;
  }

  pendientes.forEach(function(o) {
    var reprogTag = o.estado === 'reprogramado'
      ? '<span class="badge reprogramado" style="font-size:10px">Reprogramado</span> '
      : '';
    var item = document.createElement('div');
    item.className = 'assign-item';
    item.dataset.id = o.id;
    item.innerHTML =
      '<div class="assign-info">' +
        '<div class="assign-code">#' + o.codigo + ' ' + reprogTag + '</div>' +
        '<div class="assign-dest" style="font-size:11px">' + o.tienda + '</div>' +
        '<div class="assign-dest" style="font-size:11px;color:var(--color-text-tertiary)">' +
          o.distrito + (o.dest_nombre ? ' · ' + o.dest_nombre : '') +
        '</div>' +
      '</div>' +
      '<button class="btn btn-primary btn-sm" onclick="asignarOrden(' + o.id + ')">' +
        'Asignar <i class="ti ti-arrow-right"></i>' +
      '</button>';
    pool.appendChild(item);
  });
}

/* ════════════════════════════════════════════
   RENDER — POOL ASIGNADOS (derecha)
════════════════════════════════════════════ */
function _renderPoolAsignados() {
  var pool     = document.getElementById('pool-asig');
  var emptyMsg = document.getElementById('empty-asig');
  if (!pool) return;

  var sel        = document.getElementById('moto-select');
  var nombreMoto = sel ? sel.value : '';

  Array.from(pool.querySelectorAll('.assign-item')).forEach(function(el){ el.remove(); });

  if (!nombreMoto) {
    if (emptyMsg) emptyMsg.style.display = 'block';
    return;
  }

  var asignadas = _getOrdenesAsignadas(nombreMoto);

  if (asignadas.length === 0) {
    if (emptyMsg) {
      emptyMsg.textContent = 'Sin órdenes asignadas a ' + nombreMoto;
      emptyMsg.style.display = 'block';
    }
    return;
  }

  if (emptyMsg) emptyMsg.style.display = 'none';

  /* Reasignar/desasignar son acciones de gestores — un motorizado
     no puede tocar la asignación una vez hecha (ver PATCH /asignar) */
  var sesionAsig = _obtenerSesionAsig();
  var esGestorAsig = !sesionAsig || sesionAsig.rol !== 'motorizado';

  asignadas.forEach(function(o) {
    var item = document.createElement('div');
    item.className = 'assign-item';
    item.dataset.id = o.id;
    item.innerHTML =
      '<div class="assign-info" style="flex:1">' +
        '<div class="assign-code">#' + o.codigo + '</div>' +
        '<div class="assign-dest" style="font-size:11px">' + o.tienda + ' · ' + o.distrito + '</div>' +
        '<div style="margin-top:3px">' + _badgeEstadoAsig(o.estado) + '</div>' +
      '</div>' +
      (esGestorAsig
        ? '<div style="display:flex;gap:4px;flex-shrink:0">' +
            '<button class="btn btn-sm" style="font-size:11px;padding:4px 8px;color:var(--color-amber-text);border-color:#fcd34d" ' +
              'onclick="abrirReasignar(' + o.id + ')" title="Reasignar a otro motorizado">' +
              '<i class="ti ti-arrows-exchange"></i> Reasignar' +
            '</button>' +
            '<button class="btn btn-danger btn-sm" style="font-size:11px;padding:4px 8px" ' +
              'onclick="desasignarOrden(' + o.id + ')" title="Quitar asignación">' +
              '<i class="ti ti-x"></i>' +
            '</button>' +
          '</div>'
        : '');
    pool.appendChild(item);
  });
}

/* ════════════════════════════════════════════
   ASIGNAR — asigna una orden al motorizado seleccionado
   Hace PATCH real contra la BD (tabla ordenes)
════════════════════════════════════════════ */
window.asignarOrden = async function(ordenId) {
  var sel        = document.getElementById('moto-select');
  var nombreMoto = sel ? sel.value : '';

  if (!nombreMoto) {
    if (typeof showNotif === 'function') showNotif('Selecciona un motorizado primero');
    return;
  }

  try {
    var r = await fetch(API + '/ordenes/' + ordenId + '/asignar', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_cuerpoAsignar(nombreMoto)),
    });
    if (!r.ok) throw await _errorAsignar(r, 'Error al asignar el pedido');

    /* Volver a cargar desde la BD para reflejar el cambio real */
    await _cargarDatosAsignacion();
    _renderPoolPendientes();
    _renderPoolAsignados();
    _actualizarContadores();
    if (typeof showNotif === 'function') showNotif('#' + ordenId + ' asignado a ' + nombreMoto);
  } catch (err) {
    if (typeof showNotif === 'function') showNotif(err.message || 'Error al asignar el pedido', 5000);
  }
};

/* ════════════════════════════════════════════
   DESASIGNAR — quita el motorizado de una orden
════════════════════════════════════════════ */
window.desasignarOrden = async function(ordenId) {
  try {
    var r = await fetch(API + '/ordenes/' + ordenId + '/asignar', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motorizado: null }),
    });
    if (!r.ok) throw await _errorAsignar(r, 'Error al desasignar el pedido');

    await _cargarDatosAsignacion();
    _renderPoolPendientes();
    _renderPoolAsignados();
    _actualizarContadores();
    if (typeof showNotif === 'function') showNotif('#' + ordenId + ' desasignado');
  } catch (err) {
    if (typeof showNotif === 'function') showNotif(err.message || 'Error al desasignar el pedido', 5000);
  }
};

/* ════════════════════════════════════════════
   AUTOASIGNAR — distribuye todos los pendientes
   por zona entre motorizados activos.
   Hace un PATCH por cada orden contra la BD.
════════════════════════════════════════════ */
window.autoAsignar = async function() {
  var activos    = MOTORIZADOS_ASIG.filter(function(m){ return m.activo; });
  var pendientes = _getOrdenesPendientes();

  if (pendientes.length === 0) {
    if (typeof showNotif === 'function') showNotif('No hay pedidos pendientes');
    return;
  }
  if (activos.length === 0) {
    if (typeof showNotif === 'function') showNotif('No hay motorizados activos');
    return;
  }

  var turnoZona = {};
  var asignaciones = []; /* { ordenId, nombreMoto } */

  pendientes.forEach(function(orden) {
    var zonaDistr = (ZONA_DISTRITO[(orden.distrito||'').toUpperCase()] || '').toLowerCase();

    var candidatos = activos.filter(function(m){
      return m.zona && m.zona.toLowerCase().replace('/','') === zonaDistr.replace('/','');
    });
    if (candidatos.length === 0) candidatos = activos;

    var key = zonaDistr || 'todos';
    if (!turnoZona[key]) turnoZona[key] = 0;

    var motoAsignado = candidatos[turnoZona[key] % candidatos.length];
    turnoZona[key]++;

    asignaciones.push({ ordenId: orden.id, nombreMoto: motoAsignado.nombre });
  });

  try {
    var respuestas = await Promise.all(asignaciones.map(function(a) {
      return fetch(API + '/ordenes/' + a.ordenId + '/asignar', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(_cuerpoAsignar(a.nombreMoto)),
      });
    }));
    /* Alguna puede rechazarse (p. ej. la fecha de reparto es anterior a
       la creación de esa orden): se avisa cuántas, no se dan por hechas */
    var rechazadas = respuestas.filter(function(r) { return !r.ok; });
    var mensaje = rechazadas.length
      ? (await _errorAsignar(rechazadas[0], 'Error al autoasignar')).message
      : '';

    await _cargarDatosAsignacion();
    _renderPoolPendientes();
    _renderPoolAsignados();
    _actualizarContadores();
    if (typeof showNotif === 'function') {
      showNotif(rechazadas.length
        ? (asignaciones.length - rechazadas.length) + ' autoasignados, ' + rechazadas.length + ' no: ' + mensaje
        : asignaciones.length + ' pedidos autoasignados', rechazadas.length ? 6000 : undefined);
    }
  } catch (err) {
    if (typeof showNotif === 'function') showNotif('Error al autoasignar');
  }
};

/* ════════════════════════════════════════════
   REASIGNAR — abre modal con lista de motorizados
════════════════════════════════════════════ */
window.abrirReasignar = function(ordenId) {
  _reasignandoOrdenId = ordenId;
  var orden = ORDENES_ASIG.find(function(o){ return o.id === ordenId; });
  if (!orden) return;

  var lista = document.getElementById('reasignar-lista');
  if (!lista) return;

  lista.innerHTML = '';
  var activos = MOTORIZADOS_ASIG.filter(function(m){
    return m.activo && m.nombre.toUpperCase() !== (orden.motorizado||'').toUpperCase();
  });

  activos.forEach(function(m) {
    var carga = ORDENES_ASIG.filter(function(o){
      return o.motorizado && o.motorizado.toUpperCase() === m.nombre.toUpperCase()
        && (o.estado === 'en-proceso' || o.estado === 'reprogramado');
    }).length;

    var fila = document.createElement('div');
    fila.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;' +
      'padding:10px 12px;border-radius:var(--radius-md);border:1px solid var(--color-border-tertiary);' +
      'margin-bottom:6px;cursor:pointer;transition:background 0.15s';
    fila.onmouseover = function(){ this.style.background = 'var(--color-bg-secondary)'; };
    fila.onmouseout  = function(){ this.style.background = ''; };
    fila.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px">' +
        '<div class="avatar ' + m.color_avatar + '" style="width:32px;height:32px;font-size:12px">' + m.iniciales + '</div>' +
        '<div>' +
          '<div style="font-size:13px;font-weight:600">' + m.nombre + '</div>' +
          '<div style="font-size:11px;color:var(--color-text-secondary)">' +
            (m.zona || 'Sin zona') + ' · ' + carga + ' orden' + (carga !== 1 ? 'es' : '') + ' activa' + (carga !== 1 ? 's' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<button class="btn btn-primary btn-sm" onclick="confirmarReasignar(\'' + m.nombre + '\')">' +
        '<i class="ti ti-check"></i> Seleccionar' +
      '</button>';
    lista.appendChild(fila);
  });

  var info = document.getElementById('reasignar-orden-info');
  if (info) {
    info.textContent = '#' + orden.codigo + ' · ' + orden.tienda + ' → ' + orden.distrito;
  }

  document.getElementById('modal-reasignar').style.display = 'flex';
};

window.confirmarReasignar = async function(nuevoMotoNombre) {
  var orden = ORDENES_ASIG.find(function(o){ return o.id === _reasignandoOrdenId; });
  if (!orden) return;

  try {
    var r = await fetch(API + '/ordenes/' + orden.id + '/asignar', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      /* Sin fecha: pasarla a otro motorizado conserva su día de
         reparto (para cambiarlo, "Actualizar orden") */
      body: JSON.stringify({ motorizado: nuevoMotoNombre }),
    });
    if (!r.ok) throw await _errorAsignar(r, 'Error al reasignar el pedido');

    cerrarModalReasignar();
    await _cargarDatosAsignacion();
    _renderPoolPendientes();
    _renderPoolAsignados();
    _actualizarContadores();
    if (typeof showNotif === 'function') {
      showNotif('#' + orden.codigo + ' reasignado a ' + nuevoMotoNombre);
    }
  } catch (err) {
    if (typeof showNotif === 'function') showNotif(err.message || 'Error al reasignar el pedido', 5000);
  }
};

window.cerrarModalReasignar = function() {
  document.getElementById('modal-reasignar').style.display = 'none';
  _reasignandoOrdenId = null;
};

/* ════════════════════════════════════════════
   CONTADORES
════════════════════════════════════════════ */
function _actualizarContadores() {
  var pendientes = _getOrdenesPendientes().length;
  var sel        = document.getElementById('moto-select');
  var asignadas  = sel && sel.value ? _getOrdenesAsignadas(sel.value).length : 0;

  var elLib  = document.getElementById('count-libre');
  var elAsig = document.getElementById('count-asig');
  if (elLib)  elLib.textContent  = pendientes;
  if (elAsig) elAsig.textContent = asignadas;
}
