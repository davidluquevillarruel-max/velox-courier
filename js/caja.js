/* ============================================================
   caja.js — Módulo de Caja
   El cálculo de la plata está en el servidor (server/caja-motor.js);
   acá solo se pinta.
   ============================================================ */
var API = '/api';
var _cajaFiltroDesde = '';
var _cajaFiltroHasta = '';
var _cajaFiltroPago  = 'pendientes';
var _motoFiltroDesde = '';
var _motoFiltroHasta = '';
var _motoFiltroPago  = 'pendientes';

function _fechaDisplayCaja(f) {
  if (!f) return '—';
  var p = (f.substring?f:String(f)).substring(0,10).split('-');
  var meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return p[2]+' '+meses[parseInt(p[1])-1]+' '+p[0];
}

/* ── Rangos rápidos (mismo cálculo que en Clientes: semana lunes-sábado) ── */
function _formatFechaCaja(d) {
  var mm = ('0'+(d.getMonth()+1)).slice(-2);
  var dd = ('0'+d.getDate()).slice(-2);
  return d.getFullYear() + '-' + mm + '-' + dd;
}

function _lunesDeSemanaCaja(d) {
  var dia = d.getDay(); /* 0=domingo,1=lunes,...,6=sábado */
  var offset = dia === 0 ? -6 : 1 - dia;
  var lunes = new Date(d);
  lunes.setDate(d.getDate() + offset);
  return lunes;
}

function _rangoSemanaActualCaja() {
  var hoy = new Date();
  var lunes = _lunesDeSemanaCaja(hoy);
  var sabado = new Date(lunes);
  sabado.setDate(lunes.getDate() + 5);
  var fin = hoy > sabado ? sabado : hoy;
  return { desde: _formatFechaCaja(lunes), hasta: _formatFechaCaja(fin) };
}

function _rangoSemanaPasadaCaja() {
  var hoy = new Date();
  var lunesEsta = _lunesDeSemanaCaja(hoy);
  var lunesPasada = new Date(lunesEsta);
  lunesPasada.setDate(lunesEsta.getDate() - 7);
  var sabadoPasada = new Date(lunesPasada);
  sabadoPasada.setDate(lunesPasada.getDate() + 5);
  return { desde: _formatFechaCaja(lunesPasada), hasta: _formatFechaCaja(sabadoPasada) };
}

function _rangoMesActualCaja() {
  var hoy = new Date();
  var inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  return { desde: _formatFechaCaja(inicio), hasta: _formatFechaCaja(hoy) };
}

function _rangoMesPasadoCaja() {
  var hoy = new Date();
  var inicio = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  var fin    = new Date(hoy.getFullYear(), hoy.getMonth(), 0); /* día 0 = último día del mes anterior */
  return { desde: _formatFechaCaja(inicio), hasta: _formatFechaCaja(fin) };
}

function _rangoPorTipoCaja(tipo) {
  if (tipo === 'semana')             return _rangoSemanaActualCaja();
  if (tipo === 'semana-pasada')      return _rangoSemanaPasadaCaja();
  if (tipo === 'mes')                return _rangoMesActualCaja();
  if (tipo === 'mes-pasado')         return _rangoMesPasadoCaja();
  return null;
}

/* prefijo: 'tiendas' | 'liquidez' | 'motos' — ids esperados: btn-<tipo>-<prefijo> */
function _marcarBotonActivoCaja(prefijo, tipo) {
  ['semana','semana-pasada','mes','mes-pasado'].forEach(function(t) {
    var el = document.getElementById('btn-'+t+'-'+prefijo);
    if (el) el.classList.toggle('active', tipo === t);
  });
}

/* ── Tabs ── */
window.cambiarTab = function(id, btn) {
  ['tiendas','liquidez','motorizados'].forEach(function(t){
    var el = document.getElementById('tab-'+t);
    if (el) el.style.display = 'none';
  });
  document.querySelectorAll('.caja-tab').forEach(function(b){ b.classList.remove('active'); });
  var target = document.getElementById('tab-'+id);
  if (target) target.style.display = 'block';
  if (btn) btn.classList.add('active');
  if (id === 'liquidez')    renderLiquidez();
  if (id === 'motorizados') renderMotosCaja();
  if (id === 'tiendas')     renderTiendasCaja();
};

/* ── Filtros tiendas ── */
window.aplicarFiltroTiendas = function() {
  _cajaFiltroDesde = document.getElementById('filtro-desde').value;
  _cajaFiltroHasta = document.getElementById('filtro-hasta').value;
  _marcarBotonActivoCaja('tiendas', null);
  renderTiendasCaja();
};
window.limpiarFiltroTiendas = function() {
  _cajaFiltroDesde = ''; _cajaFiltroHasta = '';
  document.getElementById('filtro-desde').value = '';
  document.getElementById('filtro-hasta').value = '';
  _marcarBotonActivoCaja('tiendas', null);
  renderTiendasCaja();
};
window.filtroRapidoTiendas = function(tipo) {
  var rango = _rangoPorTipoCaja(tipo);
  if (!rango) return;
  _cajaFiltroDesde = rango.desde;
  _cajaFiltroHasta = rango.hasta;
  var inpD = document.getElementById('filtro-desde');
  var inpH = document.getElementById('filtro-hasta');
  if (inpD) inpD.value = rango.desde;
  if (inpH) inpH.value = rango.hasta;
  _marcarBotonActivoCaja('tiendas', tipo);
  renderTiendasCaja();
};

/* Pendientes / Pagados / Todos */
window.filtroPagoTiendas = function(estado) {
  _cajaFiltroPago = estado;
  ['pendientes','pagados','todos'].forEach(function(e) {
    var b = document.getElementById('btn-pago-'+e);
    if (b) b.classList.toggle('active', e === estado);
  });
  renderTiendasCaja();
};

/* ════════════════════════════════════════════
   TAB TIENDAS
   El cálculo (delivery, retenido, saldo) lo hace el servidor con el
   motor (server/caja-motor.js); acá solo se pinta. El saldo de un día
   pagado es el guardado al pagar, no se recalcula. El detalle por pedido se abre inline debajo de la
   tienda (ojito) y queda abierto entre refrescos.
════════════════════════════════════════════ */
var _cajaResumenTiendas = null;   /* última respuesta de GET /caja/tiendas */
var _cajaDetallesTienda = {};     /* idTienda → respuesta de /detalle (las abiertas) */
var _cajaFirmaTiendas   = '';
var _cajaSecTiendas     = 0;

function _escCaja(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function _solesCaja(v) { return 'S/ ' + Math.abs(parseFloat(v) || 0).toFixed(2); }

function _paramsCajaTiendas() {
  var p = ['estado=' + _cajaFiltroPago];
  if (_cajaFiltroDesde) p.push('desde=' + _cajaFiltroDesde);
  if (_cajaFiltroHasta) p.push('hasta=' + _cajaFiltroHasta);
  return '?' + p.join('&');
}

/* Saldo con su sentido: > 0 nos debe (verde) · < 0 le debemos (ámbar) */
function _saldoCajaHTML(saldo, grande) {
  saldo = parseFloat(saldo) || 0;
  var clase = saldo > 0 ? 'pos' : saldo < 0 ? 'neg' : 'cero';
  var texto = saldo > 0 ? 'nos debe' : saldo < 0 ? 'le debemos' : 'saldado';
  if (!grande) {
    return '<span class="caja-saldo ' + clase + '" style="font-size:12px">' + (saldo < 0 ? '− ' : '') + _solesCaja(saldo) +
      ' <span style="font-weight:500">· ' + texto + '</span></span>';
  }
  return '<div class="caja-saldo ' + clase + '">' + _solesCaja(saldo) + '<small>' + texto + '</small></div>';
}

var _MEDIO_PAGO_CAJA = {
  'yape-motorizado': 'Yape moto', 'efectivo-motorizado': 'Efectivo moto',
  'pago-tienda': 'Pago tienda', 'pago-empresa': 'Pago Velox',
};
function _medioPagoCajaHTML(p) {
  if (p.metodo_pago !== 'contraentrega') return '<span class="caja-tenue">Sin cobro</span>';
  if (!p.medio_pago) return '<span class="caja-medio-falta">Por definir</span>';
  return _escCaja(_MEDIO_PAGO_CAJA[p.medio_pago] || p.medio_pago);
}

var _ESTADO_CAJA_LABEL = { entregado: 'Entregado', ausente: 'Ausente', devolucion: 'Devolución' };

/* Días pagados cuyo saldo guardado no coincide con lo que dan hoy sus pedidos */
function _diasDifierenHTML(dias) {
  var lista = (dias || []).filter(function(d) { return d.difiere; });
  if (!lista.length) return '';
  var monto = function(v) { return (v < 0 ? '− ' : '') + _solesCaja(v); };
  return '<div class="caja-difiere-lista"><div class="caja-difiere"><i class="ti ti-alert-triangle"></i> Difiere de lo pagado</div>' +
    lista.map(function(d) {
      return '<div>' + _fechaDisplayCaja(d.fecha) + ': se guardó ' + monto(d.saldo_pagado) +
        ', sus pedidos hoy dan ' + monto(d.saldo_hoy) + '. Los totales usan lo guardado.</div>';
    }).join('') + '</div>';
}

function _detalleTiendaHTML(idTienda) {
  var d = _cajaDetallesTienda[idTienda];
  if (!d || d.cargando) {
    return '<div class="caja-detalle" style="padding:14px 24px;color:var(--color-text-tertiary);font-size:12px">Cargando pedidos…</div>';
  }
  if (d.error) {
    return '<div class="caja-detalle" style="padding:14px 24px;color:var(--color-red-text);font-size:12px">No se pudo cargar el detalle.</div>';
  }
  var filas = d.pedidos.map(function(p) {
    return '<tr>' +
      '<td><strong>#' + _escCaja(p.codigo) + '</strong><div class="caja-tenue" style="font-size:11px">' + _escCaja(p.dest_nombre || '—') + '</div></td>' +
      '<td style="white-space:nowrap">' + _fechaDisplayCaja(p.fecha) + '</td>' +
      '<td><span class="caja-estado ' + _escCaja(p.estado) + '">' + _escCaja(_ESTADO_CAJA_LABEL[p.estado] || p.estado) + '</span></td>' +
      '<td>' + _medioPagoCajaHTML(p) + '</td>' +
      '<td>' + _solesCaja(p.delivery) + '</td>' +
      '<td>' + (p.retenido ? _solesCaja(p.retenido) : '<span class="caja-tenue">S/ 0.00</span>') + '</td>' +
      '<td>' + _saldoCajaHTML(p.saldo, false) + '</td>' +
      '<td>' + (p.pago_oficina === 'pre' ? 'Prepago' : 'Postpago') + '</td>' +
      '<td><span class="caja-chip ' + (p.pago === 'PAGADO' ? 'pagado">PAGADO' : 'pendiente">Pendiente') + '</span></td>' +
      '<td><button class="btn btn-sm" title="Editar orden" onclick="editarOrdenDesdeCaja(' + p.id + ',' + (p.dia_pagado ? 1 : 0) + ',\'' + p.fecha + '\')">' +
        '<i class="ti ti-pencil"></i> Editar orden</button></td>' +
    '</tr>';
  }).join('');
  if (!filas) {
    filas = '<tr><td colspan="10" style="text-align:center;padding:16px;color:var(--color-text-tertiary)">Sin pedidos en este filtro</td></tr>';
  }
  var t = d.totales;
  return _liquidacionesHTML(d.liquidaciones) + _diasDifierenHTML(d.dias_pagados) + '<div class="caja-detalle"><table>' +
    '<thead><tr><th>N° pedido</th><th>Fecha</th><th>Estado</th><th>Medio de pago</th><th>Delivery</th>' +
      '<th>Retenido</th><th>Saldo</th><th>Pre/Post</th><th>Pago</th><th></th></tr></thead>' +
    '<tbody>' + filas +
      '<tr class="caja-totales"><td colspan="4">TOTALES · ' + t.pedidos + ' pedido' + (t.pedidos === 1 ? '' : 's') + '</td>' +
        '<td>' + _solesCaja(t.delivery) + '</td><td>' + _solesCaja(t.retenido) + '</td>' +
        '<td colspan="4">' + _saldoCajaHTML(t.saldo, false) + '</td></tr>' +
    '</tbody></table></div>';
}

/* Pinta KPIs + lista con lo que ya está en memoria (el buscador usa
   esto directo, sin volver a pedir). No repinta si nada cambió. */
window.pintarTiendasCaja = function() {
  var tbody = document.getElementById('tbody-tiendas-caja');
  if (!tbody || !_cajaResumenTiendas) return;
  var k = _cajaResumenTiendas.kpis;

  var set = function(id, v){ var el = document.getElementById(id); if (el) el.textContent = v; };
  set('kpi-cobrar',   _solesCaja(k.por_cobrar));
  set('kpi-devolver', _solesCaja(k.por_devolver));
  set('kpi-neta',     _solesCaja(k.posicion_neta));
  set('kpi-neta-nota', k.posicion_neta > 0 ? 'nos deben' : k.posicion_neta < 0 ? 'le debemos' : 'saldado');
  var elNeta = document.getElementById('kpi-neta');
  if (elNeta) elNeta.className = 'metric-val ' + (k.posicion_neta > 0 ? 'green' : k.posicion_neta < 0 ? 'amber' : '');
  set('kpi-aldia',    k.al_dia);
  set('kpi-consaldo', k.con_saldo);

  var inpBuscar = document.getElementById('caja-buscar-tienda');
  var buscar = (inpBuscar && inpBuscar.value || '').trim().toLowerCase();
  var tiendas = _cajaResumenTiendas.tiendas.filter(function(t) {
    return !buscar || String(t.tienda).toLowerCase().indexOf(buscar) !== -1;
  });

  var html = tiendas.map(function(t) {
    var abierta = !!_cajaDetallesTienda[t.id];
    var estado = t.estado === 'pagado'
      ? '<span class="caja-chip pagado">Pagado</span>' +
        (t.ultimo_pago ? '<div class="caja-tenue" style="font-size:11px;margin-top:3px">' + _fechaDisplayCaja(t.ultimo_pago) + '</div>' : '')
      : '<span class="caja-chip pendiente">Pendiente</span>' +
        '<div class="caja-tenue" style="font-size:11px;margin-top:3px">' + t.dias_pendientes + ' día' + (t.dias_pendientes === 1 ? '' : 's') + '</div>';
    var accion = t.dias_pendientes > 0
      ? '<button class="btn-pagar" onclick="marcarTiendaPagada(' + t.id + ')">Marcar pagado</button>'
      : '<span class="caja-tenue" style="font-size:12px">Liquidado</span>';
    var fila = '<tr class="' + (abierta ? 'caja-fila-abierta' : '') + '">' +
      '<td><strong>' + _escCaja(t.tienda) + '</strong><br><span class="caja-ciclo">' + _escCaja(t.ciclo_pago || '—') + '</span></td>' +
      '<td>' + t.pedidos + '</td>' +
      '<td style="font-weight:500">' + _solesCaja(t.delivery) + '</td>' +
      '<td style="font-weight:500">' + _solesCaja(t.retenido) + '</td>' +
      '<td>' + _saldoCajaHTML(t.saldo, true) +
        (t.dias_difieren ? '<div class="caja-difiere"><i class="ti ti-alert-triangle"></i> Difiere de lo pagado</div>' : '') + '</td>' +
      '<td>' + estado + '</td>' +
      '<td>' + accion + '</td>' +
      '<td class="col-ver-tienda-fijo"><button class="btn btn-sm" title="' + (abierta ? 'Ocultar pedidos' : 'Ver pedidos') + '" onclick="toggleDetalleTiendaCaja(' + t.id + ')">' +
        '<i class="ti ' + (abierta ? 'ti-eye-off' : 'ti-eye') + '"></i></button></td>' +
    '</tr>';
    if (abierta) fila += '<tr><td colspan="8" class="caja-detalle-celda">' + _detalleTiendaHTML(t.id) + '</td></tr>';
    return fila;
  }).join('');

  if (!html) {
    var msg = buscar ? 'Ninguna tienda coincide con la búsqueda'
            : _cajaFiltroPago === 'pagados' ? 'No hay pagos registrados en el período'
            : _cajaFiltroPago === 'pendientes' ? 'No hay pendientes — todo al día ✓'
            : 'Sin pedidos cobrables en el período';
    html = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--color-text-tertiary)">' + msg + '</td></tr>';
  }
  if (html === _cajaFirmaTiendas) return;
  _cajaFirmaTiendas = html;
  tbody.innerHTML = html;
};

async function _cargarDetalleTiendaCaja(idTienda) {
  try {
    var r = await fetch(API + '/caja/tiendas/' + idTienda + '/detalle' + _paramsCajaTiendas());
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } catch (err) {
    console.error('Error detalle caja tienda:', err);
    return { error: true };
  }
}

/* Trae resumen + el detalle de las tiendas abiertas y repinta. Si
   llega una respuesta vieja (otro filtro ya pidió después), se ignora. */
window.renderTiendasCaja = async function() {
  if (!document.getElementById('tbody-tiendas-caja')) return;
  var sec = ++_cajaSecTiendas;
  try {
    var r = await fetch(API + '/caja/tiendas' + _paramsCajaTiendas());
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var resumen = await r.json();

    var abiertas = Object.keys(_cajaDetallesTienda);
    var detalles = await Promise.all(abiertas.map(_cargarDetalleTiendaCaja));
    if (sec !== _cajaSecTiendas) return;

    _cajaResumenTiendas = resumen;
    abiertas.forEach(function(id, i) {
      if (_cajaDetallesTienda[id]) _cajaDetallesTienda[id] = detalles[i]; /* si no la cerraron mientras tanto */
    });
    pintarTiendasCaja();
  } catch (err) { console.error('Error caja tiendas:', err); }
};

window.toggleDetalleTiendaCaja = async function(idTienda) {
  if (_cajaDetallesTienda[idTienda]) {
    delete _cajaDetallesTienda[idTienda];
    pintarTiendasCaja();
    return;
  }
  _cajaDetallesTienda[idTienda] = { cargando: true };
  pintarTiendasCaja();
  var d = await _cargarDetalleTiendaCaja(idTienda);
  if (!_cajaDetallesTienda[idTienda]) return; /* la cerraron mientras cargaba */
  _cajaDetallesTienda[idTienda] = d;
  pintarTiendasCaja();
};

/* ════════════════════════════════════════════
   MARCAR PAGADO con foto del pago (tiendas y motorizados)
   1) Paso de foto: cámara (pedirFoto) o "Subir imagen", mín. 1 y
      hasta 5; las fotos quedan en memoria, ya comprimidas.
   2) Confirmación de días + monto (la de siempre).
   3) POST /caja/.../pagar → crea la liquidación (necesita señal).
   4) Recién ahí cada foto entra a la cola (encolarFotoPagoTienda /
      encolarFotoPagoMoto): el await solo espera IndexedDB, la subida
      sigue en segundo plano.
   Si el POST falla, la ventana sigue abierta con las fotos.
════════════════════════════════════════════ */
var _MAX_FOTOS_PAGO = 5;
var _pagoFotos = null;  /* { tipo: 'tienda'|'moto', id, nombre, fotos: [{ blob, url }] } */

function _tiendaCaja(idTienda) {
  return _cajaResumenTiendas && _cajaResumenTiendas.tiendas.find(function(x) { return x.id === idTienda; });
}

function _pintarFotosPago() {
  if (!_pagoFotos) return;
  var grilla = document.getElementById('pago-foto-grilla');
  if (grilla) {
    grilla.innerHTML = _pagoFotos.fotos.map(function(f, i) {
      return '<div class="pago-foto-mini"><img src="' + f.url + '" alt="Foto ' + (i + 1) + '" />' +
        '<button type="button" title="Quitar" onclick="quitarFotoPagoTienda(' + i + ')"><i class="ti ti-x"></i></button></div>';
    }).join('');
  }
  var n = _pagoFotos.fotos.length;
  var lleno = n >= _MAX_FOTOS_PAGO;
  var set = function(id, prop, v) { var el = document.getElementById(id); if (el) el[prop] = v; };
  set('pago-foto-contador', 'textContent', n + ' de ' + _MAX_FOTOS_PAGO);
  set('pago-foto-btn-camara', 'disabled', lleno);
  set('pago-foto-btn-galeria', 'disabled', lleno);
  set('pago-foto-btn-continuar', 'disabled', n === 0);
}

function _agregarFotoPago(blob) {
  if (!_pagoFotos || !blob) return false;
  if (_pagoFotos.fotos.length >= _MAX_FOTOS_PAGO) return false;
  _pagoFotos.fotos.push({ blob: blob, url: URL.createObjectURL(blob) });
  _pintarFotosPago();
  return true;
}

function _cerrarFotosPago() {
  if (_pagoFotos) _pagoFotos.fotos.forEach(function(f) { URL.revokeObjectURL(f.url); });
  _pagoFotos = null;
  var ov = document.getElementById('pago-foto-overlay');
  if (ov) ov.style.display = 'none';
}

function _abrirPasoFotoPago(tipo, id, nombre, subtitulo) {
  _cerrarFotosPago();
  _pagoFotos = { tipo: tipo, id: id, nombre: nombre, fotos: [] };
  var titulo = document.getElementById('pago-foto-titulo');
  if (titulo) titulo.textContent = 'Foto del pago · ' + nombre;
  var sub = document.getElementById('pago-foto-sub');
  if (sub) sub.textContent = subtitulo;
  _pintarFotosPago();
  var ov = document.getElementById('pago-foto-overlay');
  if (ov) ov.style.display = 'flex';
}

/* "Marcar pagado": primero el paso de foto */
window.marcarTiendaPagada = function(idTienda) {
  var t = _tiendaCaja(idTienda);
  if (!t) return;
  var saldo = parseFloat(t.saldo_pendiente) || 0;
  _abrirPasoFotoPago('tienda', idTienda, t.tienda,
    t.dias_pendientes + ' día' + (t.dias_pendientes === 1 ? '' : 's') + ' pendiente' + (t.dias_pendientes === 1 ? '' : 's') + ' · ' +
    (saldo > 0 ? 'La tienda nos paga ' : saldo < 0 ? 'Le pagamos ' : 'Saldo ') + _solesCaja(saldo));
};

window.tomarFotoPagoTienda = async function() {
  if (!_pagoFotos || typeof pedirFoto !== 'function') return;
  var actual = _pagoFotos;
  var blob = await pedirFoto({ titulo: 'Foto del pago · ' + actual.nombre, textoOk: 'Agregar foto' });
  if (blob && _pagoFotos === actual) _agregarFotoPago(blob);
};

/* "Subir imagen": varias de la galería; se comprimen de a una */
window.onImagenesPagoTienda = async function(input) {
  var archivos = Array.prototype.slice.call(input.files || []);
  input.value = ''; /* permite volver a elegir las mismas */
  if (!_pagoFotos || !archivos.length) return;
  var actual = _pagoFotos;
  var sobran = 0;
  for (var i = 0; i < archivos.length; i++) {
    if (_pagoFotos !== actual) return;  /* cerraron la ventana mientras tanto */
    if (actual.fotos.length >= _MAX_FOTOS_PAGO) { sobran = archivos.length - i; break; }
    try {
      _agregarFotoPago(await comprimirImagenJPEG(archivos[i], _FOTO_MAX_ANCHO, _FOTO_CALIDAD));
    } catch (err) {
      if (typeof showNotif === 'function') showNotif(err.message || 'No se pudo procesar una imagen');
    }
  }
  if (sobran && typeof showNotif === 'function') {
    showNotif('Máximo ' + _MAX_FOTOS_PAGO + ' fotos: ' + sobran + ' imagen(es) no se agregaron');
  }
};

window.quitarFotoPagoTienda = function(i) {
  if (!_pagoFotos || !_pagoFotos.fotos[i]) return;
  URL.revokeObjectURL(_pagoFotos.fotos[i].url);
  _pagoFotos.fotos.splice(i, 1);
  _pintarFotosPago();
};

window.cancelarFotoPagoTienda = function() { _cerrarFotosPago(); };

/* Con al menos 1 foto: confirmación de días + monto, y liquida */
window.continuarPagoTienda = async function() {
  if (!_pagoFotos || !_pagoFotos.fotos.length) return;
  if (_pagoFotos.tipo === 'moto') return _continuarPagoMoto();
  var actual = _pagoFotos;
  var t = _tiendaCaja(actual.id);
  if (!t) { _cerrarFotosPago(); return; }
  var periodo = _cajaFiltroDesde && _cajaFiltroHasta
      ? 'del ' + _fechaDisplayCaja(_cajaFiltroDesde) + ' al ' + _fechaDisplayCaja(_cajaFiltroHasta)
    : _cajaFiltroDesde ? 'del ' + _fechaDisplayCaja(_cajaFiltroDesde)
    : _cajaFiltroHasta ? 'hasta el ' + _fechaDisplayCaja(_cajaFiltroHasta)
    : 'de todas las fechas';
  var saldo = parseFloat(t.saldo_pendiente) || 0;
  var sentido = saldo > 0 ? 'La tienda nos paga ' + _solesCaja(saldo)
              : saldo < 0 ? 'Le pagamos a la tienda ' + _solesCaja(saldo)
              : 'Saldo pendiente S/ 0.00';
  var nFotos = actual.fotos.length;
  if (!confirm('Marcar pagado ' + t.tienda + ': ' + t.dias_pendientes + ' día(s) pendiente(s) ' + periodo + '.\n' +
               sentido + '.\n' + nFotos + ' foto(s) del pago.\n\nLa Caja no tiene "desmarcar". ¿Continuar?')) return;

  var btn = document.getElementById('pago-foto-btn-continuar');
  if (btn) btn.disabled = true;  /* evita un doble "Marcar pagado" mientras responde */
  var json;
  try {
    var resp = await fetch(API + '/caja/tiendas/pagar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_tienda: actual.id, desde: _cajaFiltroDesde, hasta: _cajaFiltroHasta, fotos: nFotos }),
    });
    json = await resp.json().catch(function() { return {}; });
    if (!resp.ok || !json.ok) {
      if (btn) btn.disabled = false;
      if (typeof showNotif === 'function') showNotif('Error: ' + (json.error || 'No se pudo marcar pagado'));
      if (resp.status === 409) renderTiendasCaja();
      return;
    }
  } catch (err) {
    /* Sin señal: no se liquidó nada; la ventana y las fotos siguen */
    console.error(err);
    if (btn) btn.disabled = false;
    if (typeof showNotif === 'function') showNotif('Sin conexión: el pago no se registró. Las fotos siguen acá, vuelve a intentar.', 5000);
    return;
  }

  /* La liquidación ya existe: las fotos entran a la cola (solo espera
     el guardado en el teléfono) y suben solas */
  var fallaronCola = 0;
  for (var i = 0; i < actual.fotos.length; i++) {
    try {
      await encolarFotoPagoTienda(json.id_liquidacion, actual.fotos[i].blob, t.tienda);
    } catch (errCola) {
      console.error('Cola de fotos (pago tienda):', errCola);
      fallaronCola++;
    }
  }
  _cerrarFotosPago();
  renderTiendasCaja();
  if (typeof showNotif === 'function') {
    showNotif(fallaronCola
      ? 'Pago registrado, pero ' + fallaronCola + ' foto(s) no se pudieron guardar en este dispositivo.'
      : 'Pago registrado · ' + t.tienda + ' · ' + json.dias + ' día(s)', fallaronCola ? 5000 : 2500);
  }
};

/* ── Historial: pagos registrados con sus fotos ── */
var _cajaLiqAbiertas = {};

window.toggleFotosLiquidacion = function(clave) {
  if (_cajaLiqAbiertas[clave]) delete _cajaLiqAbiertas[clave];
  else _cajaLiqAbiertas[clave] = true;
  pintarTiendasCaja();
  pintarMotosCaja();
};

window.verFotoPagoGrande = function(url) {
  var ov = document.getElementById('caja-foto-grande');
  var img = document.getElementById('caja-foto-grande-img');
  if (!ov || !img) return;
  img.src = url;
  ov.style.display = 'flex';
};
window.cerrarFotoPagoGrande = function() {
  var ov = document.getElementById('caja-foto-grande');
  if (ov) ov.style.display = 'none';
};

function _liquidacionesHTML(liqs, tipo) {
  if (!liqs || !liqs.length) return '';
  return '<div class="caja-liqs"><div class="caja-liqs-titulo"><i class="ti ti-receipt"></i> Pagos registrados</div>' +
    liqs.map(function(l) {
      var clave = (tipo || 'tienda') + '-' + l.id;
      var abierta = !!_cajaLiqAbiertas[clave];
      var dias = l.primer_dia === l.ultimo_dia
        ? _fechaDisplayCaja(l.primer_dia)
        : _fechaDisplayCaja(l.primer_dia) + ' – ' + _fechaDisplayCaja(l.ultimo_dia);
      var faltan = Math.max((l.fotos_declaradas || 0) - l.fotos.length, 0);
      var fotos = '';
      if (abierta) {
        fotos = '<div class="caja-liq-fotos">' +
          l.fotos.map(function(f, i) {
            var u = _escCaja(f.url);
            return '<img src="' + u + '" loading="lazy" alt="Foto del pago ' + (i + 1) + '" onclick="verFotoPagoGrande(\'' + u + '\')" />';
          }).join('') +
          (l.fotos.length ? '' : '<span class="caja-tenue">Sin fotos todavía</span>') +
        '</div>';
      }
      return '<div class="caja-liq"><div class="caja-liq-fila">' +
        '<span class="caja-chip pagado">Pagado ' + _fechaDisplayCaja(l.fecha_pago) + '</span>' +
        '<span>' + l.dias + ' día' + (l.dias === 1 ? '' : 's') + ' · ' + dias + '</span>' +
        '<span class="caja-saldo ' + (l.neto > 0 ? 'pos' : l.neto < 0 ? 'neg' : 'cero') + '" style="font-size:12px">' +
          (l.neto > 0 ? (tipo === 'moto' ? 'Nos rindió ' : 'Nos pagó ') : l.neto < 0 ? 'Le pagamos ' : 'Saldado ') + _solesCaja(l.neto) + '</span>' +
        (tipo === 'moto' ? '<span class="caja-tenue">Efectivo ' + _solesCaja(l.monto_efectivo) + ' · Yape ' + _solesCaja(l.monto_yape) + ' · Su pago ' + _solesCaja(l.monto_a_pagar) + '</span>' : '') +
        (l.usuario ? '<span class="caja-tenue">por ' + _escCaja(l.usuario) + '</span>' : '') +
        (faltan ? '<span class="caja-medio-falta">' + faltan + ' foto' + (faltan === 1 ? '' : 's') + ' por subir</span>' : '') +
        '<button class="btn btn-sm" style="margin-left:auto" onclick="toggleFotosLiquidacion(\'' + _escCaja(clave) + '\')">' +
          '<i class="ti ' + (abierta ? 'ti-eye-off' : 'ti-photo') + '"></i> ' + (abierta ? 'Ocultar' : 'Ver') + ' fotos (' + l.fotos.length + ')</button>' +
      '</div>' + fotos + '</div>';
    }).join('') + '</div>';
}

/* ════════════════════════════════════════════
   TAB LIQUIDEZ DIARIA
════════════════════════════════════════════ */
window.limpiarFiltroLiquidez = function() {
  var d = document.getElementById('filtro-liquidez-desde');
  var h = document.getElementById('filtro-liquidez-hasta');
  if (d) d.value = '';
  if (h) h.value = '';
  _marcarBotonActivoCaja('liquidez', null);
  renderLiquidez();
};

window.aplicarFiltroLiquidezManual = function() {
  _marcarBotonActivoCaja('liquidez', null);
  renderLiquidez();
};

window.filtroRapidoLiquidez = function(tipo) {
  var rango = _rangoPorTipoCaja(tipo);
  if (!rango) return;
  var inpD = document.getElementById('filtro-liquidez-desde');
  var inpH = document.getElementById('filtro-liquidez-hasta');
  if (inpD) inpD.value = rango.desde;
  if (inpH) inpH.value = rango.hasta;
  _marcarBotonActivoCaja('liquidez', tipo);
  renderLiquidez();
};

/* Monto con signo: − S/ 10.00 */
function _solesSigno(v) { v = parseFloat(v) || 0; return (v < 0 ? '− ' : '') + _solesCaja(v); }

function _metricaHTML(etiqueta, valor, clase, nota) {
  return '<div class="metric"><div class="metric-label">' + etiqueta + '</div>' +
    '<div class="metric-val ' + (clase || '') + '">' + _solesSigno(valor) + '</div>' +
    (nota ? '<div class="caja-kpi-nota">' + nota + '</div>' : '') + '</div>';
}
function _claseSigno(v) { return v > 0 ? 'green' : v < 0 ? 'red' : ''; }

/* Control de cuadre del período */
function _cuadreHTML(c) {
  var sinMoto = c.sin_motorizado && c.sin_motorizado.length
    ? ' · ' + c.sin_motorizado.length + ' cobrable(s) sin motorizado: ' +
      c.sin_motorizado.slice(0, 5).map(function(o) { return '#' + _escCaja(o.codigo); }).join(', ')
    : '';
  var detalle = 'Motos ' + _solesSigno(c.saldo_motos) + ' + Tiendas ' + _solesSigno(c.saldo_tiendas) +
    ' + Pago Velox ' + _solesCaja(c.pago_velox) + ' + Prepagos ' + _solesCaja(c.prepagos) +
    ' = ' + _solesSigno(c.izquierda) + ' · Delivery ' + _solesCaja(c.delivery) + ' − Pago motos ' + _solesCaja(c.pago_motos) +
    ' = ' + _solesSigno(c.derecha);
  return '<div class="caja-cuadre ' + (c.ok ? 'ok' : 'mal') + '">' +
    '<strong><i class="ti ' + (c.ok ? 'ti-circle-check' : 'ti-alert-triangle') + '"></i> ' +
      (c.ok ? 'Cuadre OK' : 'No cuadra: diferencia ' + _solesSigno(c.diferencia)) + '</strong>' +
    '<span>' + detalle + sinMoto + '</span></div>';
}

/* Caja real: plata que ya cambió de mano */
function _cajaRealHTML(r) {
  var v = r.vias;
  return '<div class="card" style="margin-top:16px">' +
      '<div class="card-head"><span class="card-title">Caja real (Velox)</span></div>' +
      '<div class="metrics caja-kpis-real">' +
        _metricaHTML('Neto con motorizados', r.neto_motorizados, _claseSigno(r.neto_motorizados)) +
        _metricaHTML('Neto con tiendas', r.neto_tiendas, _claseSigno(r.neto_tiendas)) +
        _metricaHTML('Pago Velox', r.pago_velox, _claseSigno(r.pago_velox)) +
        _metricaHTML('Prepagos', r.prepagos, _claseSigno(r.prepagos)) +
        _metricaHTML('Prepagos no cobrables', r.prepagos_no_cobrables, _claseSigno(r.prepagos_no_cobrables), 'en proceso, canceladas…') +
        _metricaHTML('Caja real total', r.caja_real, _claseSigno(r.caja_real)) +
      '</div>' +
      '<div class="caja-vias-titulo">Ingresos por vía</div>' +
      '<div class="metrics caja-kpis-vias">' +
        _metricaHTML('Efectivo', v.efectivo) + _metricaHTML('Yape', v.yape) + _metricaHTML('Depósito', v.deposito) +
        (v.prepago_sin_metodo ? _metricaHTML('Prepago sin método', v.prepago_sin_metodo) : '') +
        (v.sin_desglose ? _metricaHTML('Sin desglose', v.sin_desglose, '', 'días del moto pagados antes de guardar la vía') : '') +
      '</div>' +
      '<div class="caja-nota-card">' +
        'Motos y tiendas: lo ya marcado pagado, con el monto guardado y por su fecha de pago. Pago Velox y prepagos: por su fecha de reparto. ' +
        'Las vías son cómo pagó el cliente: efectivo y Yape cuentan cuando el moto los rinde, sin descontar su pago. Lo que pagan las tiendas al liquidar no entra en las vías.' +
      '</div>' +
    '</div>';
}

var _liquidezFirma = '';
var _liquidezSec = 0;

window.renderLiquidez = async function() {
  var tbody = document.getElementById('tbody-liquidez');
  if (!tbody) return;
  var sec = ++_liquidezSec;
  try {
    var desde = document.getElementById('filtro-liquidez-desde');
    var hasta = document.getElementById('filtro-liquidez-hasta');
    var params = [];
    if (desde && desde.value) params.push('desde=' + desde.value);
    if (hasta && hasta.value) params.push('hasta=' + hasta.value);
    var q = params.length ? '?' + params.join('&') : '';

    var respuestas = await Promise.all([fetch(API + '/caja/liquidez' + q), fetch(API + '/caja/real' + q)]);
    if (!respuestas[0].ok || !respuestas[1].ok) throw new Error('HTTP ' + respuestas[0].status + '/' + respuestas[1].status);
    var data = await respuestas[0].json();
    var real = await respuestas[1].json();
    if (sec !== _liquidezSec) return;

    var firma = JSON.stringify([data, real]);
    if (firma === _liquidezFirma) return;
    _liquidezFirma = firma;

    var t = data.totales;
    var claseG = function(v) { return v >= 0 ? 'color:var(--color-green)' : 'color:var(--color-red-text)'; };
    var fila = function(d, etiqueta, estilo) {
      return '<tr' + (estilo || '') + '>' +
        '<td style="font-weight:' + (estilo ? 700 : 500) + '">' + etiqueta + '</td>' +
        '<td>' + d.pedidos + '</td>' +
        '<td style="font-weight:600">' + _solesCaja(d.delivery) + '</td>' +
        '<td style="color:var(--color-purple-text);font-weight:600">' + _solesCaja(d.pago_motos) + '</td>' +
        '<td style="' + claseG(d.ganancia) + ';font-weight:700">' + _solesSigno(d.ganancia) + '</td>' +
        '<td>' + _solesCaja(d.retenido) + '</td>' +
        '<td>' + _solesCaja(d.efectivo) + '</td>' +
        '<td>' + _solesCaja(d.yape) + '</td>' +
        '<td>' + _solesCaja(d.deposito) + '</td>' +
      '</tr>';
    };
    tbody.innerHTML = data.dias.length
      ? data.dias.map(function(d) { return fila(d, _fechaDisplayCaja(d.fecha)); }).join('') +
        fila(t, 'TOTAL', ' style="background:var(--color-bg-secondary);border-top:2px solid var(--color-border-secondary)"')
      : '<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--color-text-tertiary)">Sin datos para el período seleccionado</td></tr>';

    var set = function(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
    set('kpi-liq-delivery', _solesCaja(t.delivery));
    set('kpi-liq-motos',    _solesCaja(t.pago_motos));
    set('kpi-liq-ganancia', _solesSigno(t.ganancia));
    set('kpi-liq-retenido', _solesCaja(t.retenido));
    var elG = document.getElementById('kpi-liq-ganancia');
    if (elG) elG.className = 'metric-val ' + (t.ganancia >= 0 ? 'green' : 'red');

    var elCuadre = document.getElementById('cuadre-liquidez');
    if (elCuadre) {
      elCuadre.innerHTML = _cuadreHTML(data.cuadre) +
        (t.prepago_sin_metodo
          ? '<div class="caja-kpi-nota" style="margin-top:6px">Además, ' + _solesCaja(t.prepago_sin_metodo) + ' de prepagos sin método, que no están en ninguna columna de vía.</div>'
          : '');
    }
    var elReal = document.getElementById('balance-periodo-liquidez');
    if (elReal) elReal.innerHTML = _cajaRealHTML(real);
  } catch (err) { console.error('Error liquidez:', err); }
};

/* ════════════════════════════════════════════
   TAB MOTORIZADOS
   Mismo patrón que Caja Tienda. Saldo del moto = plata que pasó por sus
   manos (efectivo + Yape) − su pago. El cálculo es del servidor.
════════════════════════════════════════════ */
var _motoResumen  = null;  /* última respuesta de GET /caja/motorizados */
var _motoDetalles = {};    /* idMoto → respuesta de /detalle (las abiertas) */
var _motoFirma    = '';
var _motoSec      = 0;

window.filtroRapidoMotosCaja = function(tipo) {
  var rango = _rangoPorTipoCaja(tipo);
  if (!rango) return;
  _motoFiltroDesde = rango.desde;
  _motoFiltroHasta = rango.hasta;
  var inpD = document.getElementById('filtro-motos-desde');
  var inpH = document.getElementById('filtro-motos-hasta');
  if (inpD) inpD.value = rango.desde;
  if (inpH) inpH.value = rango.hasta;
  _marcarBotonActivoCaja('motos', tipo);
  renderMotosCaja();
};

window.aplicarFiltroMotosCaja = function() {
  var inpD = document.getElementById('filtro-motos-desde');
  var inpH = document.getElementById('filtro-motos-hasta');
  _motoFiltroDesde = inpD ? inpD.value : '';
  _motoFiltroHasta = inpH ? inpH.value : '';
  _marcarBotonActivoCaja('motos', null);
  renderMotosCaja();
};

window.limpiarFiltroMotosCaja = function() {
  _motoFiltroDesde = '';
  _motoFiltroHasta = '';
  var inpD = document.getElementById('filtro-motos-desde');
  var inpH = document.getElementById('filtro-motos-hasta');
  if (inpD) inpD.value = '';
  if (inpH) inpH.value = '';
  _marcarBotonActivoCaja('motos', null);
  renderMotosCaja();
};

window.filtroPagoMotos = function(estado) {
  _motoFiltroPago = estado;
  ['pendientes','pagados','todos'].forEach(function(e) {
    var b = document.getElementById('btn-moto-' + e);
    if (b) b.classList.toggle('active', e === estado);
  });
  renderMotosCaja();
};

function _paramsCajaMotos() {
  var p = ['estado=' + _motoFiltroPago];
  if (_motoFiltroDesde) p.push('desde=' + _motoFiltroDesde);
  if (_motoFiltroHasta) p.push('hasta=' + _motoFiltroHasta);
  return '?' + p.join('&');
}

function _motoCaja(idMoto) {
  return _motoResumen && _motoResumen.motorizados.find(function(x) { return x.id === idMoto; });
}

function _detalleMotoHTML(idMoto) {
  var d = _motoDetalles[idMoto];
  if (!d || d.cargando) {
    return '<div class="caja-detalle" style="padding:14px 24px;color:var(--color-text-tertiary);font-size:12px">Cargando pedidos…</div>';
  }
  if (d.error) {
    return '<div class="caja-detalle" style="padding:14px 24px;color:var(--color-red-text);font-size:12px">No se pudo cargar el detalle.</div>';
  }
  var filas = d.pedidos.map(function(p) {
    return '<tr>' +
      '<td><strong>#' + _escCaja(p.codigo) + '</strong><div class="caja-tenue" style="font-size:11px">' + _escCaja(p.dest_nombre || '—') + '</div></td>' +
      '<td style="white-space:nowrap">' + _fechaDisplayCaja(p.fecha) + '</td>' +
      '<td>' + _escCaja(p.tienda) + '</td>' +
      '<td><span class="caja-estado ' + _escCaja(p.estado) + '">' + _escCaja(_ESTADO_CAJA_LABEL[p.estado] || p.estado) + '</span></td>' +
      '<td>' + _medioPagoCajaHTML(p) +
        (p.cobrado && !p.en_mano ? '<div class="caja-tenue" style="font-size:11px">cobró ' + _solesCaja(p.cobrado) + ', no pasó por el moto</div>' : '') + '</td>' +
      '<td>' + (p.en_mano ? _solesCaja(p.en_mano) : '<span class="caja-tenue">S/ 0.00</span>') + '</td>' +
      '<td>' + _solesCaja(p.pago_moto) + '</td>' +
      '<td>' + _saldoCajaHTML(p.saldo, false) + '</td>' +
      '<td><span class="caja-chip ' + (p.dia_pagado ? 'pagado">PAGADO' : 'pendiente">Pendiente') + '</span></td>' +
      '<td><button class="btn btn-sm" title="Editar orden" onclick="editarOrdenDesdeCaja(' + p.id + ',' + (p.dia_pagado ? 1 : 0) + ',\'' + p.fecha + '\',\'moto\')">' +
        '<i class="ti ti-pencil"></i> Editar orden</button></td>' +
    '</tr>';
  }).join('');
  if (!filas) {
    filas = '<tr><td colspan="10" style="text-align:center;padding:16px;color:var(--color-text-tertiary)">Sin pedidos en este filtro</td></tr>';
  }
  var abiertos = (d.dias_abiertos || []).length
    ? '<div class="caja-difiere-lista"><div class="caja-difiere"><i class="ti ti-clock"></i> Con órdenes en proceso</div>' +
        d.dias_abiertos.map(_fechaDisplayCaja).join(', ') + ': no se liquidan hasta cerrarlas.</div>'
    : '';
  var t = d.totales;
  return _liquidacionesHTML(d.liquidaciones, 'moto') + _diasDifierenHTML(d.dias_pagados) + abiertos + '<div class="caja-detalle"><table>' +
    '<thead><tr><th>N° pedido</th><th>Fecha</th><th>Tienda</th><th>Estado</th><th>Medio de pago</th>' +
      '<th>En mano</th><th>Su pago</th><th>Saldo</th><th>Pago</th><th></th></tr></thead>' +
    '<tbody>' + filas +
      '<tr class="caja-totales"><td colspan="5">TOTALES · ' + t.pedidos + ' pedido' + (t.pedidos === 1 ? '' : 's') +
          ' · Efectivo ' + _solesCaja(t.efectivo) + ' · Yape ' + _solesCaja(t.yape) + '</td>' +
        '<td>' + _solesCaja(t.efectivo + t.yape) + '</td><td>' + _solesCaja(t.pago) + '</td>' +
        '<td colspan="3">' + _saldoCajaHTML(t.saldo, false) + '</td></tr>' +
    '</tbody></table></div>';
}

/* Pinta KPIs + lista con lo que ya está en memoria. No repinta si nada cambió. */
window.pintarMotosCaja = function() {
  var tbody = document.getElementById('tbody-motos-caja');
  if (!tbody || !_motoResumen) return;
  var k = _motoResumen.kpis;

  var set = function(id, v){ var el = document.getElementById(id); if (el) el.textContent = v; };
  set('kpi-moto-cobrar',  _solesCaja(k.por_cobrar));
  set('kpi-moto-pagar',   _solesCaja(k.por_pagar));
  set('kpi-moto-neta',    _solesCaja(k.posicion_neta));
  set('kpi-moto-neta-nota', k.posicion_neta > 0 ? 'nos deben' : k.posicion_neta < 0 ? 'les debemos' : 'saldado');
  var elNeta = document.getElementById('kpi-moto-neta');
  if (elNeta) elNeta.className = 'metric-val ' + (k.posicion_neta > 0 ? 'green' : k.posicion_neta < 0 ? 'amber' : '');
  set('kpi-moto-aldia',   k.al_dia);
  set('kpi-moto-consaldo', k.con_saldo);

  var inpBuscar = document.getElementById('caja-buscar-moto');
  var buscar = (inpBuscar && inpBuscar.value || '').trim().toLowerCase();
  var motos = _motoResumen.motorizados.filter(function(m) {
    return !buscar || String(m.motorizado).toLowerCase().indexOf(buscar) !== -1;
  });
  motos.sort(function(a, b) { return String(a.motorizado).localeCompare(String(b.motorizado)); });

  var html = motos.map(function(m) {
    var abierta = !!_motoDetalles[m.id];
    var estado = m.estado === 'pagado'
      ? '<span class="caja-chip pagado">Pagado</span>' +
        (m.ultimo_pago ? '<div class="caja-tenue" style="font-size:11px;margin-top:3px">' + _fechaDisplayCaja(m.ultimo_pago) + '</div>' : '')
      : '<span class="caja-chip pendiente">Pendiente</span>' +
        '<div class="caja-tenue" style="font-size:11px;margin-top:3px">' + m.dias_pendientes + ' día' + (m.dias_pendientes === 1 ? '' : 's') + '</div>' +
        (m.dias_abiertos ? '<div class="caja-difiere">' + m.dias_abiertos + ' en proceso</div>' : '');
    var accion = m.dias_liquidables > 0
      ? '<button class="btn-pagar" onclick="marcarMotoPagado(' + m.id + ')">Marcar pagado</button>'
      : m.dias_pendientes > 0
        ? '<span class="caja-tenue" style="font-size:12px">Hay que cerrar sus órdenes</span>'
        : '<span class="caja-tenue" style="font-size:12px">Liquidado</span>';
    var fila = '<tr class="' + (abierta ? 'caja-fila-abierta' : '') + '">' +
      '<td><strong>' + _escCaja(m.motorizado) + '</strong>' +
        (m.medios_por_definir ? '<div class="caja-medio-falta" style="font-size:11px;margin-top:3px">' + m.medios_por_definir + ' medio' + (m.medios_por_definir === 1 ? '' : 's') + ' por definir</div>' : '') + '</td>' +
      '<td>' + m.pedidos + '</td>' +
      '<td style="font-weight:500">' + _solesCaja(m.efectivo) + '</td>' +
      '<td style="font-weight:500">' + _solesCaja(m.yape) + '</td>' +
      '<td style="font-weight:500">' + _solesCaja(m.pago) + '</td>' +
      '<td>' + _saldoCajaHTML(m.saldo, true) +
        (m.dias_difieren ? '<div class="caja-difiere"><i class="ti ti-alert-triangle"></i> Difiere de lo pagado</div>' : '') + '</td>' +
      '<td>' + estado + '</td>' +
      '<td>' + accion + '</td>' +
      '<td class="col-ver-tienda-fijo"><button class="btn btn-sm" title="' + (abierta ? 'Ocultar pedidos' : 'Ver pedidos') + '" onclick="toggleDetalleMotoCaja(' + m.id + ')">' +
        '<i class="ti ' + (abierta ? 'ti-eye-off' : 'ti-eye') + '"></i></button></td>' +
    '</tr>';
    if (abierta) fila += '<tr><td colspan="9" class="caja-detalle-celda">' + _detalleMotoHTML(m.id) + '</td></tr>';
    return fila;
  }).join('');

  if (!html) {
    var msg = buscar ? 'Ningún motorizado coincide con la búsqueda'
            : _motoFiltroPago === 'pagados' ? 'No hay pagos registrados en el período'
            : _motoFiltroPago === 'pendientes' ? 'No hay pendientes — todo al día ✓'
            : 'Sin pedidos cobrables en el período';
    html = '<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--color-text-tertiary)">' + msg + '</td></tr>';
  }
  if (html === _motoFirma) return;
  _motoFirma = html;
  tbody.innerHTML = html;
};

async function _cargarDetalleMotoCaja(idMoto) {
  try {
    var r = await fetch(API + '/caja/motorizados/' + idMoto + '/detalle' + _paramsCajaMotos());
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } catch (err) {
    console.error('Error detalle caja moto:', err);
    return { error: true };
  }
}

/* Trae resumen + el detalle de los motos abiertos y repinta. Si llega
   una respuesta vieja (otro filtro ya pidió después), se ignora. */
window.renderMotosCaja = async function() {
  if (!document.getElementById('tbody-motos-caja')) return;
  var sec = ++_motoSec;
  try {
    var r = await fetch(API + '/caja/motorizados' + _paramsCajaMotos());
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var resumen = await r.json();

    var abiertas = Object.keys(_motoDetalles);
    var detalles = await Promise.all(abiertas.map(_cargarDetalleMotoCaja));
    if (sec !== _motoSec) return;

    _motoResumen = resumen;
    abiertas.forEach(function(id, i) {
      if (_motoDetalles[id]) _motoDetalles[id] = detalles[i];
    });
    pintarMotosCaja();
  } catch (err) { console.error('Error motos caja:', err); }
};

window.toggleDetalleMotoCaja = async function(idMoto) {
  if (_motoDetalles[idMoto]) {
    delete _motoDetalles[idMoto];
    pintarMotosCaja();
    return;
  }
  _motoDetalles[idMoto] = { cargando: true };
  pintarMotosCaja();
  var d = await _cargarDetalleMotoCaja(idMoto);
  if (!_motoDetalles[idMoto]) return; /* lo cerraron mientras cargaba */
  _motoDetalles[idMoto] = d;
  pintarMotosCaja();
};

/* "Marcar pagado" del moto: mismo paso de foto que el de tiendas */
window.marcarMotoPagado = function(idMoto) {
  var m = _motoCaja(idMoto);
  if (!m) return;
  var saldo = parseFloat(m.saldo_liquidable) || 0;
  _abrirPasoFotoPago('moto', idMoto, m.motorizado,
    m.dias_liquidables + ' día' + (m.dias_liquidables === 1 ? '' : 's') + ' por liquidar · ' +
    (saldo > 0 ? 'El moto nos rinde ' : saldo < 0 ? 'Le pagamos ' : 'Saldo ') + _solesCaja(saldo));
};

async function _continuarPagoMoto() {
  var actual = _pagoFotos;
  var m = _motoCaja(actual.id);
  if (!m) { _cerrarFotosPago(); return; }
  var periodo = _motoFiltroDesde && _motoFiltroHasta
      ? 'del ' + _fechaDisplayCaja(_motoFiltroDesde) + ' al ' + _fechaDisplayCaja(_motoFiltroHasta)
    : _motoFiltroDesde ? 'del ' + _fechaDisplayCaja(_motoFiltroDesde)
    : _motoFiltroHasta ? 'hasta el ' + _fechaDisplayCaja(_motoFiltroHasta)
    : 'de todas las fechas';
  var saldo = parseFloat(m.saldo_liquidable) || 0;
  var sentido = saldo > 0 ? 'El moto nos rinde ' + _solesCaja(saldo)
              : saldo < 0 ? 'Le pagamos al moto ' + _solesCaja(saldo)
              : 'Saldo S/ 0.00';
  var aviso = m.dias_abiertos
    ? '\n' + m.dias_abiertos + ' día(s) con órdenes en proceso no se liquidan.'
    : '';
  var nFotos = actual.fotos.length;
  if (!confirm('Marcar pagado ' + m.motorizado + ': ' + m.dias_liquidables + ' día(s) ' + periodo + '.\n' +
               sentido + '.' + aviso + '\n' + nFotos + ' foto(s) del pago.\n\nLa Caja no tiene "desmarcar". ¿Continuar?')) return;

  var btn = document.getElementById('pago-foto-btn-continuar');
  if (btn) btn.disabled = true;
  var json;
  try {
    var resp = await fetch(API + '/caja/motorizados/pagar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_motorizado: actual.id, desde: _motoFiltroDesde, hasta: _motoFiltroHasta, fotos: nFotos }),
    });
    json = await resp.json().catch(function() { return {}; });
    if (!resp.ok || !json.ok) {
      if (btn) btn.disabled = false;
      if (typeof showNotif === 'function') showNotif('Error: ' + (json.error || 'No se pudo marcar pagado'));
      if (resp.status === 409) renderMotosCaja();
      return;
    }
  } catch (err) {
    console.error(err);
    if (btn) btn.disabled = false;
    if (typeof showNotif === 'function') showNotif('Sin conexión: el pago no se registró. Las fotos siguen acá, vuelve a intentar.', 5000);
    return;
  }

  var fallaronCola = 0;
  for (var i = 0; i < actual.fotos.length; i++) {
    try {
      await encolarFotoPagoMoto(json.id_liquidacion, actual.fotos[i].blob, m.motorizado);
    } catch (errCola) {
      console.error('Cola de fotos (pago moto):', errCola);
      fallaronCola++;
    }
  }
  _cerrarFotosPago();
  renderMotosCaja();
  if (typeof showNotif === 'function') {
    showNotif(fallaronCola
      ? 'Pago registrado, pero ' + fallaronCola + ' foto(s) no se pudieron guardar en este dispositivo.'
      : 'Pago registrado · ' + m.motorizado + ' · ' + json.dias + ' día(s)', fallaronCola ? 5000 : 2500);
  }
}

/* ── Init ── */
window.initCaja = function() {
  _cajaFiltroDesde = ''; _cajaFiltroHasta = '';
  _cajaFiltroPago  = 'pendientes';
  _cajaResumenTiendas = null; _cajaDetallesTienda = {}; _cajaFirmaTiendas = '';
  _cerrarFotosPago(); _cajaLiqAbiertas = {};
  _motoFiltroDesde = ''; _motoFiltroHasta = '';
  _motoFiltroPago  = 'pendientes';
  _motoResumen = null; _motoDetalles = {}; _motoFirma = '';
  _liquidezFirma = '';
  ['tiendas','liquidez','motorizados'].forEach(function(t){
    var el = document.getElementById('tab-'+t);
    if (el) el.style.display = t==='tiendas' ? 'block' : 'none';
  });
  renderTiendasCaja();

  /* _refrescarCajaActual() ya repinta las 3 tabs y cualquier panel de
     detalle abierto sin importar cuál esté activa — un solo refresco
     cubre toda la página (tbody-tiendas-caja existe siempre, tab
     activa o no, así que sirve de guardia para las 3). */
  if (typeof iniciarRefrescoAutomatico === 'function') {
    iniciarRefrescoAutomatico('tbody-tiendas-caja', _refrescarCajaActual);
  }
};

/* Llegó una foto de un pago: el historial abierto la muestra sin
   esperar el refresco de 8 s (no hace nada fuera de Caja) */
window.addEventListener('velox:foto-subida', function(e) {
  if (!e.detail || !document.getElementById('tbody-tiendas-caja')) return;
  if (e.detail.tipo === 'foto_pago_tienda') renderTiendasCaja();
  if (e.detail.tipo === 'foto_pago_moto') renderMotosCaja();
});

/* ── Editar orden desde Caja ── */
window.editarOrdenDesdeCaja = function(ordenId, diaPagado, fecha, tipo) {
  /* Reutiliza el mismo modal "Actualizar orden" de Todos los pedidos. El
     refresco de caja al guardar ya lo hace guardarActualizarEstadoOrden()
     por su cuenta (ver _refrescarCajaActual más abajo). Si su día ya se
     liquidó, se avisa antes: cambiar montos o estado descuadra lo pagado. */
  if (diaPagado && !confirm('El ' + _fechaDisplayCaja(fecha) + ' ya está marcado como pagado para ' + (tipo === 'moto' ? 'este motorizado' : 'esta tienda') + '.\n' +
      'Editar la orden puede descuadrar esa liquidación (la Caja no tiene "desmarcar").\n\n¿Editar igual?')) {
    return;
  }
  if (typeof abrirActualizarEstadoOrden === 'function') {
    abrirActualizarEstadoOrden(ordenId);
  }
};

/* ── Refresca todo lo que dependa de órdenes dentro de Caja ──
   Se llama desde guardarActualizarEstadoOrden() (js/motorizados.js)
   cada vez que se guarda una orden, sin importar desde qué página se
   abrió el modal. Si Caja no está en pantalla, los guards de cada
   render (if (!tbody) return) hacen que esto no haga nada. */
window._refrescarCajaActual = function() {
  if (typeof renderTiendasCaja === 'function') renderTiendasCaja();
  if (typeof renderMotosCaja   === 'function') renderMotosCaja();
  if (typeof renderLiquidez    === 'function') renderLiquidez();
  /* renderTiendasCaja y renderMotosCaja ya recargan los detalles abiertos */
};