/* ============================================================
   asignacion.js — Asignación y reasignación de órdenes
   Fuente de datos: ORDENES (pedidos.js) + MOTORIZADOS (motorizados.js)
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
   VARIABLES INTERNAS
════════════════════════════════════════════ */
var _reasignandoOrdenId = null; /* ID de la orden en proceso de reasignación */

/* ════════════════════════════════════════════
   INIT
════════════════════════════════════════════ */
window.initAsignacion = function() {
  _poblarSelectMotorizados();
  _renderPoolPendientes();
  _renderPoolAsignados();
  _actualizarContadores();
};

/* ════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════ */
function _hoyAsig() {
  var d  = new Date();
  var mm = ('0'+(d.getMonth()+1)).slice(-2);
  var dd = ('0'+d.getDate()).slice(-2);
  return d.getFullYear() + '-' + mm + '-' + dd;
}

/* Pendiente = sin motorizado asignado (independientemente del estado)
   Un reprogramado ya asignado NO aparece aquí */
function _getOrdenesPendientes() {
  if (typeof ORDENES === 'undefined') return [];
  return ORDENES.filter(function(o) {
    return !o.motorizado || o.motorizado.trim() === '';
  });
}

/* Ordenes asignadas al motorizado seleccionado */
function _getOrdenesAsignadas(nombreMoto) {
  if (!nombreMoto || typeof ORDENES === 'undefined') return [];
  return ORDENES.filter(function(o) {
    /* Asignada = tiene motorizado, sin importar estado activo */
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
   RENDER — SELECT DE MOTORIZADOS
════════════════════════════════════════════ */
function _poblarSelectMotorizados() {
  var sel = document.getElementById('moto-select');
  if (!sel || typeof MOTORIZADOS === 'undefined') return;
  var valorActual = sel.value;
  sel.innerHTML = '<option value="">Seleccionar motorizado...</option>';
  MOTORIZADOS.filter(function(m){ return m.activo; }).forEach(function(m) {
    var opt = document.createElement('option');
    opt.value       = m.nombre;
    opt.textContent = m.nombre + (m.zona ? ' — ' + m.zona : '');
    sel.appendChild(opt);
  });
  if (valorActual) sel.value = valorActual;
}

/* ════════════════════════════════════════════
   RENDER — POOL PENDIENTES (izquierda)
════════════════════════════════════════════ */
function _renderPoolPendientes() {
  var pool = document.getElementById('pool-libre');
  if (!pool) return;

  var pendientes = _getOrdenesPendientes();
  pool.innerHTML = '';

  if (pendientes.length === 0) {
    pool.innerHTML =
      '<div style="padding:24px;text-align:center;color:var(--color-text-tertiary);font-size:13px">' +
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
        '<div class="assign-code">#' + o.id + ' ' + reprogTag + '</div>' +
        '<div class="assign-dest" style="font-size:11px">' + o.tienda + '</div>' +
        '<div class="assign-dest" style="font-size:11px;color:var(--color-text-tertiary)">' +
          o.distrito + (o.dest ? ' · ' + o.dest : '') +
        '</div>' +
      '</div>' +
      '<button class="btn btn-primary btn-sm" onclick="asignarOrden(\'' + o.id + '\')">' +
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

  /* Limpiar ítems anteriores pero no el mensaje vacío */
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

  asignadas.forEach(function(o) {
    var item = document.createElement('div');
    item.className = 'assign-item';
    item.dataset.id = o.id;
    item.innerHTML =
      '<div class="assign-info" style="flex:1">' +
        '<div class="assign-code">#' + o.id + '</div>' +
        '<div class="assign-dest" style="font-size:11px">' + o.tienda + ' · ' + o.distrito + '</div>' +
        '<div style="margin-top:3px">' + _badgeEstadoAsig(o.estado) + '</div>' +
      '</div>' +
      '<div style="display:flex;gap:4px;flex-shrink:0">' +
        '<button class="btn btn-sm" style="font-size:11px;padding:4px 8px;color:var(--color-amber-text);border-color:#fcd34d" ' +
          'onclick="abrirReasignar(\'' + o.id + '\')" title="Reasignar a otro motorizado">' +
          '<i class="ti ti-arrows-exchange"></i> Reasignar' +
        '</button>' +
        '<button class="btn btn-danger btn-sm" style="font-size:11px;padding:4px 8px" ' +
          'onclick="desasignarOrden(\'' + o.id + '\')" title="Quitar asignación">' +
          '<i class="ti ti-x"></i>' +
        '</button>' +
      '</div>';
    pool.appendChild(item);
  });
}

/* ════════════════════════════════════════════
   ASIGNAR — asigna una orden al motorizado seleccionado
════════════════════════════════════════════ */
window.asignarOrden = function(ordenId) {
  var sel        = document.getElementById('moto-select');
  var nombreMoto = sel ? sel.value : '';

  if (!nombreMoto) {
    if (typeof showNotif === 'function') showNotif('Selecciona un motorizado primero');
    return;
  }

  var orden = ORDENES.find(function(o){ return o.id === ordenId; });
  if (!orden) return;

  orden.motorizado = nombreMoto;
  if (orden.estado === 'reprogramado' || !orden.estado || orden.estado === '') {
    orden.estado = 'en-proceso';
  }

  _renderPoolPendientes();
  _renderPoolAsignados();
  _actualizarContadores();
  if (typeof showNotif === 'function') showNotif('#' + ordenId + ' asignado a ' + nombreMoto);
};

/* ════════════════════════════════════════════
   DESASIGNAR — quita el motorizado de una orden
════════════════════════════════════════════ */
window.desasignarOrden = function(ordenId) {
  var orden = ORDENES.find(function(o){ return o.id === ordenId; });
  if (!orden) return;
  orden.motorizado = '';
  orden.estado     = 'en-proceso';

  _renderPoolPendientes();
  _renderPoolAsignados();
  _actualizarContadores();
  if (typeof showNotif === 'function') showNotif('#' + ordenId + ' desasignado');
};

/* ════════════════════════════════════════════
   AUTOASIGNAR — distribuye todos los pendientes
   por zona entre motorizados activos
════════════════════════════════════════════ */
window.autoAsignar = function() {
  if (typeof MOTORIZADOS === 'undefined' || typeof ORDENES === 'undefined') return;

  var activos    = MOTORIZADOS.filter(function(m){ return m.activo; });
  /* Solo órdenes sin motorizado */
  var pendientes = ORDENES.filter(function(o){
    return !o.motorizado || o.motorizado.trim() === '';
  });

  if (pendientes.length === 0) {
    if (typeof showNotif === 'function') showNotif('No hay pedidos pendientes');
    return;
  }
  if (activos.length === 0) {
    if (typeof showNotif === 'function') showNotif('No hay motorizados activos');
    return;
  }

  /* Índice de turno por zona para repartir equitativamente */
  var turnoZona = {};

  pendientes.forEach(function(orden) {
    var zonaDistr = (ZONA_DISTRITO[orden.distrito.toUpperCase()] || '').toLowerCase();

    /* Motorizados de esa zona */
    var candidatos = activos.filter(function(m){
      return m.zona && m.zona.toLowerCase().replace('/','') === zonaDistr.replace('/','');
    });

    /* Si no hay de esa zona, usar todos */
    if (candidatos.length === 0) candidatos = activos;

    var key = zonaDistr || 'todos';
    if (!turnoZona[key]) turnoZona[key] = 0;

    var motoAsignado = candidatos[turnoZona[key] % candidatos.length];
    turnoZona[key]++;

    orden.motorizado = motoAsignado.nombre;
    if (!orden.estado || orden.estado === 'reprogramado') orden.estado = 'en-proceso';
  });

  _renderPoolPendientes();
  _renderPoolAsignados();
  _actualizarContadores();
  if (typeof showNotif === 'function') showNotif(pendientes.length + ' pedidos autoasignados');
};

/* ════════════════════════════════════════════
   REASIGNAR — abre modal con lista de motorizados
════════════════════════════════════════════ */
window.abrirReasignar = function(ordenId) {
  _reasignandoOrdenId = ordenId;
  var orden = ORDENES.find(function(o){ return o.id === ordenId; });
  if (!orden) return;

  /* Rellenar lista de motorizados en el modal */
  var lista = document.getElementById('reasignar-lista');
  if (!lista) return;

  lista.innerHTML = '';
  var activos = MOTORIZADOS.filter(function(m){
    return m.activo && m.nombre.toUpperCase() !== (orden.motorizado||'').toUpperCase();
  });

  activos.forEach(function(m) {
    /* Contar cuántas órdenes activas tiene ese motorizado */
    var carga = ORDENES.filter(function(o){
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
        '<div class="avatar ' + m.color + '" style="width:32px;height:32px;font-size:12px">' + m.iniciales + '</div>' +
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

  /* Info de la orden */
  var info = document.getElementById('reasignar-orden-info');
  if (info) {
    info.textContent = '#' + orden.id + ' · ' + orden.tienda + ' → ' + orden.distrito;
  }

  document.getElementById('modal-reasignar').style.display = 'flex';
};

window.confirmarReasignar = function(nuevoMotoNombre) {
  var orden = ORDENES.find(function(o){ return o.id === _reasignandoOrdenId; });
  if (!orden) return;

  var anteriorMoto = orden.motorizado;
  orden.motorizado = nuevoMotoNombre;
  orden.estado     = 'en-proceso';

  cerrarModalReasignar();
  _renderPoolPendientes();
  _renderPoolAsignados();
  _actualizarContadores();
  if (typeof showNotif === 'function') {
    showNotif('#' + orden.id + ' reasignado a ' + nuevoMotoNombre);
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

/* Cuando cambia el motorizado seleccionado */
window.onMotoSelectChange = function() {
  _renderPoolAsignados();
  _actualizarContadores();
};
