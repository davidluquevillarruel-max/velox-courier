/* ============================================================
   tarifas.js — Conectado a la API REST
   ============================================================ */
var API = '/api';
var TARIFAS = [];
var _editandoId  = null;
var _eliminarId  = null;
var _textoFiltro = '';
var _zonaFiltro  = '';

var ZONA_COLORS = {
  'Norte/Este': { bg:'#E6F1FB', color:'#185FA5' },
  'Sur':        { bg:'#EAF3DE', color:'#3B6D11' },
  'Centro':     { bg:'#EEEDFE', color:'#534AB7' },
  'Callao':     { bg:'#FAEEDA', color:'#854F0B' },
  'Agencia':    { bg:'#F0F0F0', color:'#555555' },
  'Otros':      { bg:'#F5F5F5', color:'#777777' },
};

async function _cargarTarifas() {
  try {
    var r = await fetch(API + '/tarifas');
    TARIFAS = await r.json();
  } catch(err) { console.error('Error cargando tarifas:', err); }
}

function _datosFiltrados() {
  return TARIFAS.filter(function(t) {
    var matchTexto = !_textoFiltro || t.distrito.toLowerCase().includes(_textoFiltro.toLowerCase());
    var matchZona  = !_zonaFiltro  || t.zona === _zonaFiltro;
    return matchTexto && matchZona;
  });
}

window.filtrarTexto = function(val) { _textoFiltro = val; renderTablaTarifas(); };
window.filtrarZona  = function() {
  var sel = document.getElementById('sel-zona');
  _zonaFiltro = sel ? sel.value : '';
  renderTablaTarifas();
};

window.renderTablaTarifas = function() {
  var datos = _datosFiltrados();
  var tbody = document.getElementById('tbody-tarifas');
  if (!tbody) return;

  var totEl = document.getElementById('total-distritos');
  if (totEl) totEl.textContent = datos.length + ' distritos';

  tbody.innerHTML = datos.map(function(t) {
    var margen = (parseFloat(t.precio_delivery||0) - parseFloat(t.pago_motorizado||0));
    var zc     = ZONA_COLORS[t.zona] || { bg:'#f0f0f0', color:'#555' };
    var fecha  = t.actualizado_en ? t.actualizado_en.substring(0,10) : '—';
    return '<tr>' +
      '<td><strong>' + t.distrito + '</strong></td>' +
      '<td><span style="background:' + zc.bg + ';color:' + zc.color + ';padding:2px 9px;border-radius:20px;font-size:11px;font-weight:500">' + t.zona + '</span></td>' +
      '<td style="font-weight:500">S/ ' + parseFloat(t.precio_delivery||0).toFixed(2) + '</td>' +
      '<td style="color:#534AB7;font-weight:500">S/ ' + parseFloat(t.pago_motorizado||0).toFixed(2) + '</td>' +
      '<td style="color:#1D9E75;font-weight:500">S/ ' + margen.toFixed(2) + '</td>' +
      '<td style="color:var(--color-text-secondary);font-size:12px">' + fecha + '</td>' +
      '<td><div style="display:flex;gap:4px">' +
        '<button class="btn btn-sm" onclick="abrirEditar(' + t.id + ')" style="padding:3px 7px"><i class="ti ti-pencil"></i></button>' +
        '<button class="btn btn-sm" onclick="abrirConfirmTarifa(' + t.id + ')" style="padding:3px 7px;color:#A32D2D;border-color:#F09595"><i class="ti ti-trash"></i></button>' +
      '</div></td>' +
    '</tr>';
  }).join('');

  _renderResumenZonas();
};

function _renderResumenZonas() {
  var el = document.getElementById('resumen-zonas');
  if (!el) return;
  var zonas = ['Norte/Este','Sur','Centro','Callao','Agencia','Otros'];
  el.innerHTML = zonas.map(function(z) {
    var count = TARIFAS.filter(function(t){ return t.zona===z; }).length;
    if (!count) return '';
    return '<div class="metric"><div class="metric-label">Zona ' + z + '</div>' +
           '<div class="metric-val blue">' + count + ' distritos</div></div>';
  }).join('');
}

window.abrirModal = function() {
  _editandoId = null;
  document.getElementById('modal-titulo').textContent = 'Agregar distrito';
  document.getElementById('btn-guardar').innerHTML    = '<i class="ti ti-plus"></i> Agregar';
  ['f-distrito','f-delivery','f-moto'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
  document.getElementById('f-zona').value = '';
  document.getElementById('preview-margen').style.display = 'none';
  document.getElementById('modal-error').style.display    = 'none';
  document.getElementById('modal-overlay').style.display  = 'flex';
};

window.abrirEditar = function(id) {
  var t = TARIFAS.find(function(x){ return x.id===id; });
  if (!t) return;
  _editandoId = id;
  document.getElementById('modal-titulo').textContent = 'Editar distrito';
  document.getElementById('btn-guardar').innerHTML    = '<i class="ti ti-check"></i> Guardar cambios';
  document.getElementById('f-distrito').value = t.distrito;
  document.getElementById('f-zona').value     = t.zona;
  document.getElementById('f-delivery').value = t.precio_delivery;
  document.getElementById('f-moto').value     = t.pago_motorizado;
  document.getElementById('modal-error').style.display = 'none';
  actualizarMargen();
  document.getElementById('modal-overlay').style.display = 'flex';
};

window.cerrarModal = function() { document.getElementById('modal-overlay').style.display = 'none'; };

window.actualizarMargen = function() {
  var d = parseFloat(document.getElementById('f-delivery').value)||0;
  var m = parseFloat(document.getElementById('f-moto').value)||0;
  var margen = d - m;
  var el = document.getElementById('preview-margen');
  document.getElementById('margen-val').textContent = 'S/ ' + margen.toFixed(2);
  document.getElementById('margen-val').style.color = margen>=0?'#1D9E75':'#A32D2D';
  el.style.display = (d>0||m>0)?'block':'none';
};

window.guardarDistrito = async function() {
  var distrito = document.getElementById('f-distrito').value.trim();
  var zona     = document.getElementById('f-zona').value;
  var delivery = parseFloat(document.getElementById('f-delivery').value);
  var moto     = parseFloat(document.getElementById('f-moto').value);
  var errEl    = document.getElementById('modal-error');

  if (!distrito||!zona||isNaN(delivery)||isNaN(moto)) {
    errEl.textContent='Completa todos los campos.'; errEl.style.display='block'; return;
  }
  if (moto>delivery) {
    errEl.textContent='El pago al motorizado no puede ser mayor al delivery.'; errEl.style.display='block'; return;
  }

  var body   = { distrito, zona, delivery, moto };
  var url    = API + '/tarifas' + (_editandoId ? '/' + _editandoId : '');
  var method = _editandoId ? 'PUT' : 'POST';

  try {
    var r = await fetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    if (!r.ok) { var e=await r.json(); errEl.textContent=e.error||'Error'; errEl.style.display='block'; return; }
    cerrarModal();
    await _cargarTarifas();
    renderTablaTarifas();
    if (typeof showNotif==='function') showNotif(_editandoId?'Distrito actualizado':'Distrito agregado');
  } catch(err) { errEl.textContent='Error de conexión.'; errEl.style.display='block'; }
};

window.abrirConfirmTarifa = function(id) {
  var t = TARIFAS.find(function(x){ return x.id===id; });
  if (!t) return;
  _eliminarId = id;
  document.getElementById('confirm-nombre').textContent     = t.distrito;
  document.getElementById('modal-confirm').style.display    = 'flex';
};

window.cerrarConfirm = function() {
  document.getElementById('modal-confirm').style.display = 'none'; _eliminarId=null;
};

window.confirmarEliminar = async function() {
  try {
    await fetch(API + '/tarifas/' + _eliminarId, { method: 'DELETE' });
    cerrarConfirm();
    await _cargarTarifas();
    renderTablaTarifas();
    if (typeof showNotif==='function') showNotif('Distrito eliminado');
  } catch(err) { console.error(err); }
};

window.descargarTarifas = function() {
  var datos = _datosFiltrados();
  var csv = 'Distrito,Zona,Delivery,Pago Moto,Margen\n';
  datos.forEach(function(t) {
    csv += [t.distrito,t.zona,t.precio_delivery,t.pago_motorizado,(t.precio_delivery-t.pago_motorizado)].join(',') + '\n';
  });
  var blob = new Blob([csv],{type:'text/csv;charset=utf-8;'});
  var a = document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='tarifas.csv'; a.click();
};

window.initTarifas = async function() {
  _textoFiltro=''; _zonaFiltro='';
  await _cargarTarifas();
  renderTablaTarifas();
};
