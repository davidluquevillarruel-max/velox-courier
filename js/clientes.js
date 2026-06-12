/* ============================================================
   clientes.js — Conectado a la API REST
   ============================================================ */
var API = '/api';
var TIENDAS_REGISTRO = [];
var _tiendaEditId = null;
var _tiendaElimId = null;
var _filtroFechaClientes = '';
var _filtroTiendaClientes = '';

function _fechaDisplayCli(yyyymmdd) {
  if (!yyyymmdd) return '—';
  var p = yyyymmdd.split('-');
  var meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return p[2] + ' ' + meses[parseInt(p[1])-1] + ' ' + p[0];
}

function _badgeEstadoTienda(est) {
  var map = { 'Al día':'entregado', 'Dev. pendiente':'ausente', 'Deuda':'no-entregado' };
  return '<span class="badge ' + (map[est]||'pendiente') + '">' + est + '</span>';
}

/* ── Cargar tiendas desde API ── */
async function _cargarTiendas() {
  try {
    var r = await fetch(API + '/tiendas');
    TIENDAS_REGISTRO = await r.json();
    /* Sincronizar catálogo compartido con pedidos.js */
    if (typeof CATALOGO_TIENDAS !== 'undefined') {
      CATALOGO_TIENDAS.length = 0;
      TIENDAS_REGISTRO.filter(function(t){ return t.activa; }).forEach(function(t) {
        CATALOGO_TIENDAS.push({ id: t.id, nombre: t.nombre });
      });
    }
  } catch(err) { console.error('Error cargando tiendas:', err); }
}

/* ── Calcular stats de tienda desde API ── */
async function _calcularStatsTienda(idTienda, fecha) {
  try {
    var url = API + '/tiendas/' + idTienda + '/ordenes' + (fecha ? '?fecha=' + fecha : '');
    var r   = await fetch(url);
    var ordenes = await r.json();
    if (!ordenes.length) return null;
    var entregados   = ordenes.filter(function(o){ return o.estado==='entregado'; }).length;
    var noEntregados = ordenes.filter(function(o){ return o.estado==='no-entregado'; }).length;
    var reprog       = ordenes.filter(function(o){ return o.estado==='reprogramado'; }).length;
    var porCobrar    = ordenes.reduce(function(s,o){
      return s + (['entregado','no-entregado'].includes(o.estado) ? parseFloat(o.delivery_total||0) : 0);
    }, 0);
    var porDevolver  = ordenes.reduce(function(s,o){ return s + (parseFloat(o.monto_producto)||0); }, 0);
    return { total: ordenes.length, entregados, noEntregados, reprog,
             porCobrar, porDevolver, saldoNeto: porCobrar - porDevolver };
  } catch(err) { return null; }
}

/* ── Render principal ── */
window.renderClientes = async function() {
  await _cargarTiendas();
  var fecha = _filtroFechaClientes;
  var lbl = document.getElementById('lbl-fecha-clientes');
  if (lbl) lbl.textContent = fecha ? 'Mostrando: ' + _fechaDisplayCli(fecha) : 'Mostrando: todos los días';

  var tbody = document.getElementById('tbody-clientes');
  if (!tbody) return;

  var filas = await Promise.all(TIENDAS_REGISTRO.map(async function(t) {
    var s = fecha ? await _calcularStatsTienda(t.id, fecha) : null;
    /* Si hay filtro de fecha y la tienda no tiene órdenes ese día, no mostrarla */
    if (fecha && (!s || s.total === 0)) return null;
    var porCobrar   = s ? (s.saldoNeto>0?s.saldoNeto:0) : 0;
    var porDevolver = s ? (s.saldoNeto<0?Math.abs(s.saldoNeto):0) : 0;
    var pedidos     = s ? s.total : 0;
    var entregados  = s ? s.entregados : 0;
    var noEntregados= s ? s.noEntregados : 0;
    var reprog      = s ? s.reprog : 0;

    var saldoHTML = '';
    if (porCobrar>0)   saldoHTML += '<span class="balance-pos">S/ ' + porCobrar.toFixed(2) + '</span>';
    if (porDevolver>0) saldoHTML += (saldoHTML?'<br>':'') + '<span class="balance-neg">− S/ ' + porDevolver.toFixed(2) + '</span>';
    if (!saldoHTML)     saldoHTML  = '<span class="balance-zero">S/ 0.00</span>';

    var estadoCli = (porCobrar>0||porDevolver>0) ? (porCobrar>0?'Deuda':'Dev. pendiente') : 'Al día';

    var html = '<tr>' +
      '<td><div style="font-weight:500">' + t.nombre + '</div>' +
        '<div style="font-size:11px;color:var(--color-text-secondary)">' +
          (t.ruc?'RUC: '+t.ruc+' · ':'') + t.ciclo_pago +
        '</div></td>' +
      '<td style="font-size:12px">' + (t.contacto||'—') +
        (t.telefono?'<br><span style="color:var(--color-text-secondary)">'+t.telefono+'</span>':'') + '</td>' +
      '<td><strong>' + pedidos + '</strong></td>' +
      '<td style="color:var(--color-green);font-weight:600">' + entregados + '</td>' +
      '<td style="color:var(--color-red-text);font-weight:600">' + noEntregados + '</td>' +
      '<td style="color:var(--color-purple-text);font-weight:600">' + reprog + '</td>' +
      '<td>' + saldoHTML + '</td>' +
      '<td>' + _badgeEstadoTienda(estadoCli) + '</td>' +
      '<td><div style="display:flex;gap:4px">' +
        '<button class="btn btn-sm" onclick="abrirDetalleTienda(\'' + t.id + '\')" title="Ver detalle"><i class="ti ti-eye"></i></button>' +
        '<button class="btn btn-sm" onclick="editarTienda(' + t.id + ')" title="Editar"><i class="ti ti-pencil"></i></button>' +
        '<button class="btn btn-sm" onclick="confirmarEliminarTienda(' + t.id + ')" style="color:#A32D2D;border-color:#F09595"><i class="ti ti-trash"></i></button>' +
      '</div></td>' +
    '</tr>';

    return { nombre: t.nombre, html: html };
  }));

  filas = filas.filter(Boolean);

  /* ── Chips de tiendas (solo si hay filtro de fecha) ── */
  var chipsContainer = document.getElementById('tiendas-chips-clientes');
  if (chipsContainer) {
    if (fecha && filas.length > 0) {
      var chips = '<div style="display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 14px">';
      chips += '<button class="chip-tienda' + (_filtroTiendaClientes===''?' active':'') + '" onclick="filtrarPorTiendaClientes(\'\')">Todos</button>';
      filas.forEach(function(f) {
        var activo = _filtroTiendaClientes === f.nombre ? ' active' : '';
        chips += '<button class="chip-tienda' + activo + '" onclick="filtrarPorTiendaClientes(\'' + f.nombre.replace(/'/g,"\\'") + '\')">' + f.nombre + '</button>';
      });
      chips += '</div>';
      chipsContainer.innerHTML = chips;
    } else {
      chipsContainer.innerHTML = '';
      _filtroTiendaClientes = '';
    }
  }

  /* ── Filtrar por tienda seleccionada (si aplica) ── */
  var filasVisibles = filas;
  if (fecha && _filtroTiendaClientes) {
    filasVisibles = filas.filter(function(f){ return f.nombre === _filtroTiendaClientes; });
  }

  tbody.innerHTML = filasVisibles.map(function(f){ return f.html; }).join('') ||
    '<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--color-text-tertiary)">Sin tiendas registradas</td></tr>';

  /* KPIs */
  var set = function(id,v){ var el=document.getElementById(id); if(el) el.textContent=v; };
  set('kpi-cli-cobrar',   '—');
  set('kpi-cli-devolver', '—');
  set('kpi-cli-aldia',    '—');
  set('kpi-cli-saldo',    '—');
};

/* ── Filtro por chip de tienda ── */
window.filtrarPorTiendaClientes = function(nombre) {
  _filtroTiendaClientes = nombre;
  renderClientes();
};

window.aplicarFiltroClientes = function() {
  var inp = document.getElementById('filtro-fecha-clientes');
  _filtroFechaClientes = inp ? inp.value : '';
  _filtroTiendaClientes = '';
  renderClientes();
};

window.limpiarFiltroClientes = function() {
  _filtroFechaClientes = '';
  _filtroTiendaClientes = '';
  var inp = document.getElementById('filtro-fecha-clientes');
  if (inp) inp.value = '';
  var chipsContainer = document.getElementById('tiendas-chips-clientes');
  if (chipsContainer) chipsContainer.innerHTML = '';
  renderClientes();
};

/* ── Detalle tienda ── */
/* Cambiar tab de fecha en detalle tienda */
window.cambiarDiaTienda = function(idx) {
  document.querySelectorAll('.dia-tab-tienda').forEach(function(t){ t.classList.remove('active'); });
  document.querySelectorAll('.tabla-dia-tienda').forEach(function(t){ t.classList.remove('active'); });
  document.querySelectorAll('.dia-tab-tienda')[idx].classList.add('active');
  document.querySelectorAll('.tabla-dia-tienda')[idx].classList.add('active');
};

window.renderDetalleTienda = async function(tiendaId) {
  var container = document.getElementById('detalle-tienda-root');
  if (!container) return;
  container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--color-text-secondary)"><i class="ti ti-loader" style="font-size:32px"></i> Cargando...</div>';

  if (!TIENDAS_REGISTRO.length) await _cargarTiendas();
  var tienda = TIENDAS_REGISTRO.find(function(t){ return t.id == tiendaId; });
  if (!tienda) { container.innerHTML = '<div style="padding:40px">Tienda no encontrada.</div>'; return; }

  var r = await fetch(API + '/tiendas/' + tiendaId + '/ordenes');
  var ordenes = await r.json();

  /* Calcular totales generales solo con estados que generan cobro */
  var _ec = ['entregado','ausente'];
  var tot = { total:ordenes.length,
    entregados:   ordenes.filter(function(o){return o.estado==='entregado';}).length,
    noEntregados: ordenes.filter(function(o){return o.estado==='no-entregado';}).length,
    reprog:       ordenes.filter(function(o){return o.estado==='reprogramado';}).length,
    costoDeliv:   ordenes.reduce(function(s,o){return s+(_ec.includes(o.estado)?parseFloat(o.delivery_total||0):0);},0),
    cobrado:      ordenes.reduce(function(s,o){return s+(_ec.includes(o.estado)?parseFloat(o.monto_cobrado||0):0);},0),
  };
  tot.saldo = tot.costoDeliv - tot.cobrado;

  /* Agrupar por fecha */
  var mapaFecha = {};
  ordenes.forEach(function(o) {
    if (!mapaFecha[o.fecha]) mapaFecha[o.fecha] = [];
    mapaFecha[o.fecha].push(o);
  });
  var fechas = Object.keys(mapaFecha).sort().reverse();
  if (_filtroFechaClientes && mapaFecha[_filtroFechaClientes]) {
    fechas = [_filtroFechaClientes].concat(fechas.filter(function(f){ return f !== _filtroFechaClientes; }));
  }

  var estadoT  = tot.saldo > 0 ? 'Deuda' : tot.saldo < 0 ? 'Dev. pendiente' : 'Al día';
  var badgeEstadoMap = { 'Al día':'entregado', 'Dev. pendiente':'ausente', 'Deuda':'no-entregado' };
  var saldoColor = tot.saldo > 0 ? 'var(--color-green)' : tot.saldo < 0 ? 'var(--color-red-text)' : 'var(--color-text-secondary)';
  var saldoMsg   = tot.saldo > 0
    ? 'En resumen debe la tienda a Velox: S/ ' + tot.saldo.toFixed(2)
    : tot.saldo < 0
    ? 'En resumen se le debe a la tienda: S/ ' + Math.abs(tot.saldo).toFixed(2)
    : 'Saldo en cero';

  /* Encabezado */
  var html =
    '<div class="detalle-header">' +
      '<div class="detalle-header-left">' +
        '<button class="btn-back" onclick="showPage(\'clientes\')"><i class="ti ti-arrow-left"></i> Volver</button>' +
        '<div><div class="detalle-nombre">' + tienda.nombre + '</div>' +
          '<div class="detalle-meta">' +
            (tienda.ruc ? '<span><i class="ti ti-id-badge"></i> RUC: '+tienda.ruc+'</span>' : '') +
            (tienda.contacto ? '<span><i class="ti ti-mail"></i> '+tienda.contacto+'</span>' : '') +
            '<span><span class="badge ' + (badgeEstadoMap[estadoT]||'pendiente') + '">' + estadoT + '</span></span>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    /* Resumen general */
    '<div class="resumen-dia" style="grid-template-columns:repeat(5,1fr)">' +
      '<div class="resumen-item"><div class="resumen-label">Total órdenes</div><div class="resumen-val blue">' + tot.total + '</div></div>' +
      '<div class="resumen-item"><div class="resumen-label">Entregados</div><div class="resumen-val green">' + tot.entregados + '</div></div>' +
      '<div class="resumen-item"><div class="resumen-label">No entregados</div><div class="resumen-val red">' + tot.noEntregados + '</div></div>' +
      '<div class="resumen-item"><div class="resumen-label">Costo delivery</div><div class="resumen-val blue">S/ ' + tot.costoDeliv.toFixed(2) + '</div></div>' +
      '<div class="resumen-item"><div class="resumen-label">Cobrado</div><div class="resumen-val green">S/ ' + tot.cobrado.toFixed(2) + '</div></div>' +
    '</div>' +

    /* Banner resumen financiero */
    '<div style="background:var(--color-bg-secondary);border-radius:var(--radius-lg);padding:16px 20px;' +
      'margin-bottom:16px;border-left:5px solid ' + saldoColor + ';display:flex;align-items:center;gap:14px">' +
      '<div style="background:' + saldoColor + ';border-radius:50%;width:38px;height:38px;display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
        '<i class="ti ti-calculator" style="color:#fff;font-size:17px"></i>' +
      '</div>' +
      '<div>' +
        '<div style="font-size:11px;color:var(--color-text-secondary);font-weight:500;margin-bottom:2px">RESUMEN FINANCIERO TOTAL</div>' +
        '<div style="font-size:15px;font-weight:700;color:' + saldoColor + '">' + saldoMsg + '</div>' +
      '</div>' +
    '</div>';

  /* Tabs de fechas */
  if (fechas.length === 0) {
    html += '<div style="padding:40px;text-align:center;color:var(--color-text-tertiary)">Sin órdenes registradas.</div>';
    container.innerHTML = html;
    return;
  }

  html += '<div class="dias-tabs">';
  fechas.forEach(function(fecha, i) {
    html += '<div class="dia-tab-tienda dia-tab' + (i===0?' active':'') + '" data-dia="' + fecha + '" onclick="cambiarDiaTienda(' + i + ')">' + _fechaDisplayCli(fecha) + '</div>';
  });
  html += '</div>';

  /* Tabla por fecha */
  fechas.forEach(function(fecha, i) {
    var ordsDia  = mapaFecha[fecha] || [];
    var diaDeliv = ordsDia.reduce(function(s,o){return s+(_ec.includes(o.estado)?parseFloat(o.delivery_total||0):0);},0);
    var diaCobr  = ordsDia.reduce(function(s,o){return s+(_ec.includes(o.estado)?parseFloat(o.monto_cobrado||0):0);},0);
    var diaSaldo = diaDeliv - diaCobr;
    var diaColor = diaSaldo > 0 ? 'var(--color-green)' : diaSaldo < 0 ? 'var(--color-red-text)' : 'var(--color-text-secondary)';
    var diaMsg   = diaSaldo > 0
      ? 'En resumen debe la tienda a Velox: S/ ' + diaSaldo.toFixed(2)
      : diaSaldo < 0
      ? 'En resumen se le debe a la tienda: S/ ' + Math.abs(diaSaldo).toFixed(2)
      : 'Saldo en cero';

    html += '<div class="tabla-dia-tienda tabla-dia' + (i===0?' active':'') + '">';

    /* Mini resumen del día */
    html +=
      '<div class="resumen-dia" style="grid-template-columns:repeat(5,1fr);margin-bottom:12px">' +
        '<div class="resumen-item"><div class="resumen-label">Total</div><div class="resumen-val blue">' + ordsDia.length + '</div></div>' +
        '<div class="resumen-item"><div class="resumen-label">Entregados</div><div class="resumen-val green">' + ordsDia.filter(function(o){return o.estado==='entregado';}).length + '</div></div>' +
        '<div class="resumen-item"><div class="resumen-label">Reprogramados</div><div class="resumen-val purple">' + ordsDia.filter(function(o){return o.estado==='reprogramado';}).length + '</div></div>' +
        '<div class="resumen-item"><div class="resumen-label">Delivery cobrable</div><div class="resumen-val blue">S/ ' + diaDeliv.toFixed(2) + '</div></div>' +
        '<div class="resumen-item"><div class="resumen-label">Cobrado</div><div class="resumen-val green">S/ ' + diaCobr.toFixed(2) + '</div></div>' +
      '</div>' +
      '<div style="background:var(--color-bg-secondary);border-radius:var(--radius-lg);padding:14px 18px;' +
        'margin-bottom:14px;border-left:5px solid ' + diaColor + ';display:flex;align-items:center;gap:12px">' +
        '<div style="background:' + diaColor + ';border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
          '<i class="ti ti-calculator" style="color:#fff;font-size:15px"></i>' +
        '</div>' +
        '<div>' +
          '<div style="font-size:11px;color:var(--color-text-secondary);font-weight:500;margin-bottom:1px">RESUMEN DEL DÍA</div>' +
          '<div style="font-size:14px;font-weight:700;color:' + diaColor + '">' + diaMsg + '</div>' +
        '</div>' +
      '</div>';

    html +=
      '<div class="card"><div class="card-head">' +
        '<span class="card-title">Órdenes del ' + _fechaDisplayCli(fecha) + '</span>' +
        '<span style="font-size:12px;color:var(--color-text-secondary)">' + ordsDia.length + ' registros</span>' +
      '</div><div class="table-wrap"><table><thead><tr>' +
        '<th>Código</th><th>Destinatario</th><th>Distrito</th><th>Motorizado</th>' +
        '<th>Estado</th><th>Delivery</th><th>Cobrado</th><th>Saldo</th>' +
      '</tr></thead><tbody>' +
      ordsDia.map(function(o) {
        var badgeE = {
          'entregado':'<span class="badge entregado">Entregado</span>',
          'no-entregado':'<span class="badge no-entregado">No entregado</span>',
          'ausente':'<span class="badge ausente">Ausente</span>',
          'en-proceso':'<span class="badge pendiente">En proceso</span>',
          'reprogramado':'<span class="badge reprogramado">Reprogramado</span>',
          'cancelado':'<span class="badge no-entregado">Cancelado</span>',
          'cambio':'<span class="badge ausente">Cambio</span>',
          'devolucion':'<span class="badge ausente">Devolución</span>',
          'recojo':'<span class="badge pendiente">Recojo</span>',
        };
        var tieneCobro = _ec.includes(o.estado);
        var delivery   = tieneCobro ? parseFloat(o.delivery_total||0) : 0;
        var cobrado    = tieneCobro ? parseFloat(o.monto_cobrado||0)  : 0;
        var saldoO     = delivery - cobrado;
        var dStr = tieneCobro ? 'S/ '+delivery.toFixed(2) : '<span style="color:var(--color-text-tertiary)">S/ 0.00</span>';
        var cStr = tieneCobro ? 'S/ '+cobrado.toFixed(2)  : '<span style="color:var(--color-text-tertiary)">S/ 0.00</span>';
        var sStr = tieneCobro
          ? (saldoO>0 ? '<span class="balance-pos">S/ '+saldoO.toFixed(2)+'</span>'
            : saldoO<0 ? '<span class="balance-neg">− S/ '+Math.abs(saldoO).toFixed(2)+'</span>'
            : '<span class="balance-zero">S/ 0.00</span>')
          : '<span style="color:var(--color-text-tertiary)">S/ 0.00</span>';
        return '<tr>' +
          '<td><strong>#'+o.codigo+'</strong></td>' +
          '<td>'+(o.dest_nombre||'—')+'</td>' +
          '<td>'+o.distrito+'</td>' +
          '<td>'+(o.motorizado||'—')+'</td>' +
          '<td>'+(badgeE[o.estado]||o.estado)+'</td>' +
          '<td>'+dStr+'</td><td>'+cStr+'</td><td>'+sStr+'</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div></div>';

    html += '</div>'; /* /tabla-dia-tienda */
  });

  container.innerHTML = html;
};

/* ── Modal tienda ── */
window.abrirModalTienda = function() {
  _tiendaEditId = null;
  document.getElementById('tienda-modal-titulo').textContent = 'Agregar tienda cliente';
  document.getElementById('btn-guardar-tienda').innerHTML = '<i class="ti ti-plus"></i> Agregar';
  ['f-tienda-nombre','f-tienda-ruc','f-tienda-contacto','f-tienda-telefono','f-tienda-direccion','f-tienda-obs'].forEach(function(id){
    var el = document.getElementById(id); if(el) el.value='';
  });
  document.getElementById('f-tienda-ciclo').value  = 'semanal';
  document.getElementById('f-tienda-activa').value = 'true';
  document.getElementById('tienda-modal-error').style.display   = 'none';
  document.getElementById('tienda-modal-overlay').style.display = 'flex';
};

window.editarTienda = function(id) {
  var t = TIENDAS_REGISTRO.find(function(x){ return x.id==id; });
  if (!t) return;
  _tiendaEditId = id;
  document.getElementById('tienda-modal-titulo').textContent = 'Editar tienda cliente';
  document.getElementById('btn-guardar-tienda').innerHTML = '<i class="ti ti-check"></i> Guardar cambios';
  document.getElementById('f-tienda-nombre').value    = t.nombre;
  document.getElementById('f-tienda-ruc').value       = t.ruc||'';
  document.getElementById('f-tienda-contacto').value  = t.contacto||'';
  document.getElementById('f-tienda-telefono').value  = t.telefono||'';
  document.getElementById('f-tienda-direccion').value = t.direccion||'';
  document.getElementById('f-tienda-ciclo').value     = t.ciclo_pago||'semanal';
  document.getElementById('f-tienda-activa').value    = t.activa?'true':'false';
  document.getElementById('f-tienda-obs').value       = t.observaciones||'';
  document.getElementById('tienda-modal-error').style.display   = 'none';
  document.getElementById('tienda-modal-overlay').style.display = 'flex';
};

window.cerrarModalTienda = function() {
  document.getElementById('tienda-modal-overlay').style.display = 'none';
};

window.guardarTienda = async function() {
  var nombre    = document.getElementById('f-tienda-nombre').value.trim();
  var ruc       = document.getElementById('f-tienda-ruc').value.trim();
  var contacto  = document.getElementById('f-tienda-contacto').value.trim();
  var telefono  = document.getElementById('f-tienda-telefono').value.trim();
  var direccion = document.getElementById('f-tienda-direccion').value.trim();
  var ciclo     = document.getElementById('f-tienda-ciclo').value;
  var activa    = document.getElementById('f-tienda-activa').value === 'true';
  var obs       = document.getElementById('f-tienda-obs').value.trim();
  var errEl     = document.getElementById('tienda-modal-error');

  if (!nombre) { errEl.textContent='El nombre es obligatorio.'; errEl.style.display='block'; return; }

  var body   = { nombre, ruc, contacto, telefono, direccion, ciclo_pago: ciclo, activa, observaciones: obs };
  var url    = API + '/tiendas' + (_tiendaEditId ? '/' + _tiendaEditId : '');
  var method = _tiendaEditId ? 'PUT' : 'POST';

  try {
    var r = await fetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    if (!r.ok) { var e=await r.json(); errEl.textContent=e.error||'Error'; errEl.style.display='block'; return; }
    cerrarModalTienda();
    renderClientes();
    if (typeof showNotif==='function') showNotif(_tiendaEditId?'Tienda actualizada':'Tienda agregada: '+nombre);
  } catch(err) { errEl.textContent='Error de conexión.'; errEl.style.display='block'; }
};

window.confirmarEliminarTienda = function(id) {
  var t = TIENDAS_REGISTRO.find(function(x){ return x.id==id; });
  if (!t) return;
  _tiendaElimId = id;
  document.getElementById('confirm-tienda-nombre').textContent   = t.nombre;
  document.getElementById('tienda-confirm-overlay').style.display = 'flex';
};

window.cerrarConfirmTienda = function() {
  document.getElementById('tienda-confirm-overlay').style.display = 'none';
  _tiendaElimId = null;
};

window.ejecutarEliminarTienda = async function() {
  try {
    await fetch(API + '/tiendas/' + _tiendaElimId, { method: 'DELETE' });
    cerrarConfirmTienda();
    renderClientes();
    if (typeof showNotif==='function') showNotif('Tienda eliminada');
  } catch(err) { console.error(err); }
};

window.exportarTiendas = function() {
  var csv = 'Nombre,RUC,Contacto,Teléfono,Dirección,Ciclo\n';
  TIENDAS_REGISTRO.forEach(function(t) {
    csv += [t.nombre,t.ruc,t.contacto,t.telefono,'"'+t.direccion+'"',t.ciclo_pago].join(',') + '\n';
  });
  var blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'tiendas.csv'; a.click();
};

window.initClientes = function() {
  /* NO resetear _filtroFechaClientes para mantener la fecha al volver del detalle */
  renderClientes();
  /* Restaurar el input de fecha si existe */
  var inp = document.getElementById('filtro-fecha-clientes');
  if (inp && _filtroFechaClientes) inp.value = _filtroFechaClientes;
};
