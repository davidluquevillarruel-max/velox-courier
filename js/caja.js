/* ============================================================
   caja.js — Módulo de Caja
   Tiendas: entregado, ausente y devolución (cálculo en el servidor,
   calcularCajaTienda en server/routes/caja.js).
   Liquidez y motorizados: entregado, ausente.
   ============================================================ */
var API = '/api';
var _cajaFiltroDesde = '';
var _cajaFiltroHasta = '';
var _cajaFiltroPago  = 'pendientes';
var _motoFiltroDesde = '';
var _motoFiltroHasta = '';
var _mostrarPagadosMotos   = false;

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
   El cálculo (delivery, retenido, saldo) lo hace el servidor con una
   sola función (calcularCajaTienda en server/routes/caja.js); acá
   solo se pinta. El detalle por pedido se abre inline debajo de la
   tienda (ojito) y queda abierto entre refrescos.
════════════════════════════════════════════ */
var _cajaResumenTiendas = null;   /* última respuesta de GET /caja/tiendas */
var _cajaDetallesTienda = {};     /* idTienda → respuesta de /detalle (las abiertas) */
var _cajaFirmaTiendas   = '';
var _cajaSecTiendas     = 0;

function _escCaja(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function _soles(v) { return 'S/ ' + Math.abs(parseFloat(v) || 0).toFixed(2); }

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
    return '<span class="caja-saldo ' + clase + '" style="font-size:12px">' + (saldo < 0 ? '− ' : '') + _soles(saldo) +
      ' <span style="font-weight:500">· ' + texto + '</span></span>';
  }
  return '<div class="caja-saldo ' + clase + '">' + _soles(saldo) + '<small>' + texto + '</small></div>';
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
      '<td>' + _soles(p.delivery) + '</td>' +
      '<td>' + (p.retenido ? _soles(p.retenido) : '<span class="caja-tenue">S/ 0.00</span>') + '</td>' +
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
  return _liquidacionesHTML(d.liquidaciones) + '<div class="caja-detalle"><table>' +
    '<thead><tr><th>N° pedido</th><th>Fecha</th><th>Estado</th><th>Medio de pago</th><th>Delivery</th>' +
      '<th>Retenido</th><th>Saldo</th><th>Pre/Post</th><th>Pago</th><th></th></tr></thead>' +
    '<tbody>' + filas +
      '<tr class="caja-totales"><td colspan="4">TOTALES · ' + t.pedidos + ' pedido' + (t.pedidos === 1 ? '' : 's') + '</td>' +
        '<td>' + _soles(t.delivery) + '</td><td>' + _soles(t.retenido) + '</td>' +
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
  set('kpi-cobrar',   _soles(k.por_cobrar));
  set('kpi-devolver', _soles(k.por_devolver));
  set('kpi-neta',     _soles(k.posicion_neta));
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
      '<td style="font-weight:500">' + _soles(t.delivery) + '</td>' +
      '<td style="font-weight:500">' + _soles(t.retenido) + '</td>' +
      '<td>' + _saldoCajaHTML(t.saldo, true) + '</td>' +
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
   MARCAR PAGADO con foto del pago
   1) Paso de foto: cámara (pedirFoto) o "Subir imagen", mín. 1 y
      hasta 5; las fotos quedan en memoria, ya comprimidas.
   2) Confirmación de días + monto (la de siempre).
   3) POST /caja/tiendas/pagar → crea la liquidación (necesita señal).
   4) Recién ahí cada foto entra a la cola (encolarFotoPagoTienda): el
      await solo espera IndexedDB, la subida sigue en segundo plano.
   Si el POST falla, la ventana sigue abierta con las fotos.
════════════════════════════════════════════ */
var _MAX_FOTOS_PAGO = 5;
var _pagoFotos = null;  /* { idTienda, tienda, fotos: [{ blob, url }] } */

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

/* "Marcar pagado": primero el paso de foto */
window.marcarTiendaPagada = function(idTienda) {
  var t = _tiendaCaja(idTienda);
  if (!t) return;
  _cerrarFotosPago();
  _pagoFotos = { idTienda: idTienda, tienda: t.tienda, fotos: [] };
  var titulo = document.getElementById('pago-foto-titulo');
  if (titulo) titulo.textContent = 'Foto del pago · ' + t.tienda;
  var saldo = parseFloat(t.saldo_pendiente) || 0;
  var sub = document.getElementById('pago-foto-sub');
  if (sub) {
    sub.textContent = t.dias_pendientes + ' día' + (t.dias_pendientes === 1 ? '' : 's') + ' pendiente' + (t.dias_pendientes === 1 ? '' : 's') + ' · ' +
      (saldo > 0 ? 'La tienda nos paga ' : saldo < 0 ? 'Le pagamos ' : 'Saldo ') + _soles(saldo);
  }
  _pintarFotosPago();
  var ov = document.getElementById('pago-foto-overlay');
  if (ov) ov.style.display = 'flex';
};

window.tomarFotoPagoTienda = async function() {
  if (!_pagoFotos || typeof pedirFoto !== 'function') return;
  var actual = _pagoFotos;
  var blob = await pedirFoto({ titulo: 'Foto del pago · ' + actual.tienda, textoOk: 'Agregar foto' });
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
  var actual = _pagoFotos;
  var t = _tiendaCaja(actual.idTienda);
  if (!t) { _cerrarFotosPago(); return; }
  var periodo = _cajaFiltroDesde && _cajaFiltroHasta
      ? 'del ' + _fechaDisplayCaja(_cajaFiltroDesde) + ' al ' + _fechaDisplayCaja(_cajaFiltroHasta)
    : _cajaFiltroDesde ? 'del ' + _fechaDisplayCaja(_cajaFiltroDesde)
    : _cajaFiltroHasta ? 'hasta el ' + _fechaDisplayCaja(_cajaFiltroHasta)
    : 'de todas las fechas';
  var saldo = parseFloat(t.saldo_pendiente) || 0;
  var sentido = saldo > 0 ? 'La tienda nos paga ' + _soles(saldo)
              : saldo < 0 ? 'Le pagamos a la tienda ' + _soles(saldo)
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
      body: JSON.stringify({ id_tienda: actual.idTienda, desde: _cajaFiltroDesde, hasta: _cajaFiltroHasta, fotos: nFotos }),
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

window.toggleFotosLiquidacion = function(idLiq) {
  if (_cajaLiqAbiertas[idLiq]) delete _cajaLiqAbiertas[idLiq];
  else _cajaLiqAbiertas[idLiq] = true;
  pintarTiendasCaja();
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

function _liquidacionesHTML(liqs) {
  if (!liqs || !liqs.length) return '';
  return '<div class="caja-liqs"><div class="caja-liqs-titulo"><i class="ti ti-receipt"></i> Pagos registrados</div>' +
    liqs.map(function(l) {
      var abierta = !!_cajaLiqAbiertas[l.id];
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
          (l.neto > 0 ? 'Nos pagó ' : l.neto < 0 ? 'Le pagamos ' : 'Saldado ') + _soles(l.neto) + '</span>' +
        (l.usuario ? '<span class="caja-tenue">por ' + _escCaja(l.usuario) + '</span>' : '') +
        (faltan ? '<span class="caja-medio-falta">' + faltan + ' foto' + (faltan === 1 ? '' : 's') + ' por subir</span>' : '') +
        '<button class="btn btn-sm" style="margin-left:auto" onclick="toggleFotosLiquidacion(\'' + _escCaja(l.id) + '\')">' +
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

/* Caja real (ya liquidado) + Caja teórica (si todo se liquidara, sin deudas).
   Se llama con el mismo desde/hasta que ya está aplicado en Liquidez. */
window._renderBalancePeriodoLiquidez = async function(params, bruto, motos) {
  var el = document.getElementById('balance-periodo-liquidez');
  if (!el) return;

  var teorica = bruto - motos;
  var real = { neto_tiendas: 0, neto_motorizados: 0, neto_prepago: 0, caja_real: 0 };
  try {
    var urlReal = API + '/caja/real' + (params.length ? '?' + params.join('&') : '');
    var rReal = await fetch(urlReal);
    real = await rReal.json();
  } catch (e) { console.error('Error caja real:', e); }

  var claseSigno = function(v){ return v >= 0 ? 'green' : 'red'; };

  el.innerHTML =
    '<div class="card" style="margin-top:16px">' +
      '<div class="card-head"><span class="card-title">Caja real (ya liquidado)</span></div>' +
      '<div class="metrics" style="grid-template-columns:repeat(4,1fr)">' +
        '<div class="metric"><div class="metric-label">Prepagos recibidos</div><div class="metric-val ' + claseSigno(real.neto_prepago) + '">S/ ' + real.neto_prepago.toFixed(2) + '</div></div>' +
        '<div class="metric"><div class="metric-label">Neto con tiendas</div><div class="metric-val ' + claseSigno(real.neto_tiendas) + '">S/ ' + real.neto_tiendas.toFixed(2) + '</div></div>' +
        '<div class="metric"><div class="metric-label">Neto con motorizados</div><div class="metric-val ' + claseSigno(real.neto_motorizados) + '">S/ ' + real.neto_motorizados.toFixed(2) + '</div></div>' +
        '<div class="metric"><div class="metric-label">Caja real total</div><div class="metric-val ' + claseSigno(real.caja_real) + '">S/ ' + real.caja_real.toFixed(2) + '</div></div>' +
      '</div>' +
      '<div style="font-size:12px;color:var(--color-text-tertiary);padding:0 16px 14px">' +
        'Prepagos: lo que las tiendas ya pagaron en oficina antes de salir a ruta. Tiendas/Motorizados: solo lo ya marcado "pagado" — cambia en cuanto liquidás algo.' +
      '</div>' +
    '</div>' +
    '<div class="card" style="margin-top:16px">' +
      '<div class="card-head"><span class="card-title">Caja teórica (si todo se liquidara hoy, sin deudas)</span></div>' +
      '<div class="metrics" style="grid-template-columns:repeat(3,1fr)">' +
        '<div class="metric"><div class="metric-label">Delivery bruto</div><div class="metric-val blue">S/ ' + bruto.toFixed(2) + '</div></div>' +
        '<div class="metric"><div class="metric-label">Pago motorizados</div><div class="metric-val amber">S/ ' + motos.toFixed(2) + '</div></div>' +
        '<div class="metric"><div class="metric-label">Ganancia teórica</div><div class="metric-val ' + claseSigno(teorica) + '">S/ ' + teorica.toFixed(2) + '</div></div>' +
      '</div>' +
      '<div style="font-size:12px;color:var(--color-text-tertiary);padding:0 16px 14px">' +
        'Ganancia si todas las tiendas y motorizados quedaran al día — el techo teórico del período.' +
      '</div>' +
    '</div>';
};

window.renderLiquidez = async function() {
  var tbody = document.getElementById('tbody-liquidez');
  if (!tbody) return;
  try {
    var desde = document.getElementById('filtro-liquidez-desde');
    var hasta  = document.getElementById('filtro-liquidez-hasta');
    var url    = API + '/caja/liquidez';
    var params = [];
    if (desde && desde.value) params.push('desde='+desde.value);
    if (hasta  && hasta.value)  params.push('hasta='+hasta.value);
    if (params.length) url += '?' + params.join('&');

    var r = await fetch(url);
    var data = await r.json();

    if (!Array.isArray(data) || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--color-text-tertiary)">Sin datos para el período seleccionado</td></tr>';
      var set2 = function(id,v){ var el=document.getElementById(id); if(el) el.textContent=v; };
      set2('kpi-bruto','S/ 0.00'); set2('kpi-motos','S/ 0.00');
      set2('kpi-devol','S/ 0.00'); set2('kpi-neto','S/ 0.00');
      _renderBalancePeriodoLiquidez(params, 0, 0);
      return;
    }

    var totBruto=0, totMotos=0, totProd=0, totNeto=0, totPedidos=0;

    var rows = data.map(function(d) {
      var neto = parseFloat(d.liquido_neto||0);
      totBruto   += parseFloat(d.bruto||0);
      totMotos   += parseFloat(d.pago_motorizados||0);
      totProd    += parseFloat(d.devoluciones||0);
      totNeto    += neto;
      totPedidos += parseInt(d.pedidos||0);
      var ns = neto>=0 ? 'color:var(--color-green);font-weight:700' : 'color:var(--color-red-text);font-weight:700';
      return '<tr>' +
        '<td style="font-weight:500">'+_fechaDisplayCaja(d.fecha)+'</td>' +
        '<td>'+d.pedidos+'</td>' +
        '<td style="font-weight:600">S/ '+parseFloat(d.bruto||0).toFixed(2)+'</td>' +
        '<td style="color:var(--color-purple-text);font-weight:600">S/ '+parseFloat(d.pago_motorizados||0).toFixed(2)+'</td>' +
        '<td style="color:var(--color-amber-text);font-weight:600">'+(parseFloat(d.devoluciones||0)>0?'S/ '+parseFloat(d.devoluciones).toFixed(2):'—')+'</td>' +
        '<td style="'+ns+'">S/ '+neto.toFixed(2)+'</td>' +
      '</tr>';
    }).join('');

    rows += '<tr style="background:var(--color-bg-secondary);border-top:2px solid var(--color-border-secondary)">' +
      '<td style="font-weight:700">TOTAL</td><td style="font-weight:700">'+totPedidos+'</td>' +
      '<td style="font-weight:700">S/ '+totBruto.toFixed(2)+'</td>' +
      '<td style="color:var(--color-purple-text);font-weight:700">S/ '+totMotos.toFixed(2)+'</td>' +
      '<td style="color:var(--color-amber-text);font-weight:700">'+(totProd>0?'S/ '+totProd.toFixed(2):'—')+'</td>' +
      '<td style="color:var(--color-green);font-weight:700">S/ '+totNeto.toFixed(2)+'</td>' +
    '</tr>';

    tbody.innerHTML = rows;

    var set = function(id,v){ var el=document.getElementById(id); if(el) el.textContent=v; };
    set('kpi-bruto', 'S/ '+totBruto.toFixed(2));
    set('kpi-motos', 'S/ '+totMotos.toFixed(2));
    set('kpi-devol', 'S/ '+totProd.toFixed(2));
    set('kpi-neto',  'S/ '+totNeto.toFixed(2));

    _renderBalancePeriodoLiquidez(params, totBruto, totMotos);
  } catch(err) { console.error('Error liquidez:', err); }
};

/* ════════════════════════════════════════════
   TAB MOTORIZADOS
════════════════════════════════════════════ */
window.filtroRapidoMotos = function(tipo) {
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

window.aplicarFiltroMotos = function() {
  var inpD = document.getElementById('filtro-motos-desde');
  var inpH = document.getElementById('filtro-motos-hasta');
  _motoFiltroDesde = inpD ? inpD.value : '';
  _motoFiltroHasta = inpH ? inpH.value : '';
  _marcarBotonActivoCaja('motos', null);
  renderMotosCaja();
};

window.limpiarFiltroMotos = function() {
  _motoFiltroDesde = '';
  _motoFiltroHasta = '';
  var inpD = document.getElementById('filtro-motos-desde');
  var inpH = document.getElementById('filtro-motos-hasta');
  if (inpD) inpD.value = '';
  if (inpH) inpH.value = '';
  _marcarBotonActivoCaja('motos', null);
  renderMotosCaja();
};

window.renderMotosCaja = async function() {
  var tbody = document.getElementById('tbody-motos-caja');
  if (!tbody) return;
  try {
    var url = API+'/caja/motorizados';
    var params = [];
    if (_motoFiltroDesde) params.push('desde='+_motoFiltroDesde);
    if (_motoFiltroHasta) params.push('hasta='+_motoFiltroHasta);
    if (params.length) url += '?' + params.join('&');

    var r    = await fetch(url);
    var data = await r.json();

    var totalAPagar   = 0;
    var totalACobrar  = 0;
    var diasPendientes = 0;

    var porMotoKpi = {};
    data.forEach(function(d) {
      if (!porMotoKpi[d.motorizado]) porMotoKpi[d.motorizado] = 0;
      var saldo = parseFloat(d.cobrado||0) - parseFloat(d.pago_moto||0);
      if (!d.pagado) porMotoKpi[d.motorizado] += saldo;
      if (!d.pagado && (parseFloat(d.pago_moto||0)>0 || Math.abs(saldo)>0)) diasPendientes++;
    });
    Object.values(porMotoKpi).forEach(function(s) {
      if (s < 0) totalAPagar  += Math.abs(s);
      if (s > 0) totalACobrar += s;
    });

    var set = function(id,v){ var el=document.getElementById(id); if(el) el.textContent=v; };
    set('kpi-moto-pagar',     'S/ '+totalAPagar.toFixed(2));
    set('kpi-moto-cobrar',    'S/ '+totalACobrar.toFixed(2));
    set('kpi-moto-pendientes', diasPendientes + ' día(s)');

    var porMoto = {};
    data.forEach(function(d) {
      if (!porMoto[d.motorizado]) porMoto[d.motorizado] = { id:d.id_motorizado, dias:[] };
      porMoto[d.motorizado].dias.push(d);
    });

    tbody.innerHTML = Object.keys(porMoto).sort().map(function(nombre) {
      var g         = porMoto[nombre];
      var pendientes= g.dias.filter(function(d){ return !d.pagado; }).length;
      var saldoPend = 0;
      g.dias.filter(function(d){ return !d.pagado; }).forEach(function(d){
        saldoPend += parseFloat(d.cobrado||0) - parseFloat(d.pago_moto||0);
      });

      var saldoLabel = saldoPend > 0
        ? '<span style="color:var(--color-green);font-weight:600">S/ '+saldoPend.toFixed(2)+' — debe a Velox</span>'
        : saldoPend < 0
        ? '<span style="color:var(--color-red-text);font-weight:600">S/ '+Math.abs(saldoPend).toFixed(2)+' — Velox le debe</span>'
        : '<span style="color:var(--color-text-secondary)">S/ 0.00</span>';

      var estadoDeuda = pendientes > 0
        ? '<span class="badge-pago-no">✗ '+pendientes+' día(s) pendiente(s)</span>'
        : '<span class="badge-pago-si">✓ Al día</span>';

      var pagoTotal = g.dias.reduce(function(s,d){ return s+parseFloat(d.pago_moto||0); }, 0);
      var cobTotal  = g.dias.reduce(function(s,d){ return s+parseFloat(d.cobrado||0); }, 0);

      return '<tr>' +
        '<td><strong>'+nombre+'</strong></td>' +
        '<td>'+saldoLabel+'</td>' +
        '<td>'+estadoDeuda+'</td>' +
        '<td><span style="font-size:12px;color:var(--color-text-secondary)">Pago moto: S/'+pagoTotal.toFixed(2)+' · Cobrado: S/'+cobTotal.toFixed(2)+'</span></td>' +
        '<td><button class="btn btn-sm btn-primary" onclick="verDetalleMotoCaja(\''+nombre+'\',\''+g.id+'\')"><i class="ti ti-eye"></i> Ver detalle</button></td>' +
      '</tr>';
    }).join('') || '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--color-text-tertiary)">Sin datos</td></tr>';

  } catch(err) { console.error('Error motos caja:', err); }
};

var _cajaDetalleMotoCurrent = { nombre: '', id: '' };

window.verDetalleMotoCaja = async function(nombreMoto, idMoto) {
  if (_cajaDetalleMotoCurrent.nombre !== nombreMoto) _mostrarPagadosMotos = false;
  _cajaDetalleMotoCurrent = { nombre: nombreMoto, id: idMoto };
  var el = document.getElementById('titulo-detalle-moto');
  if (el) el.textContent = 'Detalle · '+nombreMoto;

  var btnH = document.getElementById('btn-historial-motos');
  if (btnH) {
    btnH.innerHTML = _mostrarPagadosMotos
      ? '<i class="ti ti-eye-off"></i> Ocultar pagados'
      : '<i class="ti ti-history"></i> Historial de pagados';
  }

  try {
    var r    = await fetch(API+'/caja/motorizados');
    var data = await r.json();
    var todosMotoDias = data.filter(function(d){ return d.motorizado===nombreMoto; });

    var diasMoto = _mostrarPagadosMotos
      ? todosMotoDias.filter(function(d){ return d.pagado; })
      : todosMotoDias.filter(function(d){ return !d.pagado; });

    var tbody = document.getElementById('tbody-detalle-moto-caja');
    if (!tbody) return;

    tbody.innerHTML = diasMoto.map(function(d) {
      var pago  = parseFloat(d.pago_moto||0);
      var cobr  = parseFloat(d.cobrado||0);
      var saldo = cobr - pago;
      var sColor = saldo>0?'var(--color-green)':saldo<0?'var(--color-red-text)':'var(--color-text-secondary)';
      var sMsg   = saldo>0 ? 'Debe a Velox: S/ '+saldo.toFixed(2)
                 : saldo<0 ? 'Velox le debe: S/ '+Math.abs(saldo).toFixed(2)
                 : 'S/ 0.00';

      var estadoDeuda, accion;
      if (saldo === 0) {
        estadoDeuda = '<span class="badge-pago-si">✓ Sin deuda</span>';
        accion = '—';
      } else if (d.pagado) {
        estadoDeuda = '<span class="badge-pago-si">✓ Pagado '+(d.fecha_pago?_fechaDisplayCaja(d.fecha_pago):'')+'</span>';
        accion = '<span style="font-size:12px;color:var(--color-text-tertiary)">Liquidado</span>';
      } else {
        estadoDeuda = '<span class="badge-pago-no">✗ Pendiente</span>';
        accion = '<button class="btn-pagar" onclick="marcarMotoDia(\''+d.id_motorizado+'\',\''+d.fecha+'\')">Marcar pagado</button>';
      }

      return '<tr>' +
        '<td style="font-weight:500">'+_fechaDisplayCaja(d.fecha)+'</td>' +
        '<td>'+d.entregas+'</td>' +
        '<td style="color:var(--color-purple-text);font-weight:600">S/ '+pago.toFixed(2)+'</td>' +
        '<td style="color:var(--color-blue-text);font-weight:600">S/ '+cobr.toFixed(2)+'</td>' +
        '<td style="color:'+sColor+';font-weight:700">'+sMsg+'</td>' +
        '<td>'+estadoDeuda+'</td>' +
        '<td>'+accion+'</td>' +
      '</tr>';
    }).join('') || '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--color-text-tertiary)">'+(_mostrarPagadosMotos?'Sin pagos registrados aún':'Sin pendientes — todo al día ✓')+'</td></tr>';

    var detalle = document.getElementById('detalle-moto-caja');
    if (detalle) { detalle.style.display='block'; setTimeout(function(){ detalle.scrollIntoView({behavior:'smooth',block:'start'}); },50); }
  } catch(err) { console.error(err); }
};

window.togglePagadosMotosActual = function() {
  _mostrarPagadosMotos = !_mostrarPagadosMotos;
  verDetalleMotoCaja(_cajaDetalleMotoCurrent.nombre, _cajaDetalleMotoCurrent.id);
};

window.marcarMotoDia = async function(idMoto, fecha) {
  try {
    var resp = await fetch(API+'/caja/motorizados/pagar', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ id_motorizado: parseInt(idMoto), fecha: fecha }),
    });
    var json = await resp.json();
    if (!json.ok) {
      if (typeof showNotif==='function') showNotif('Error: '+(json.error||'No se pudo marcar'));
      return;
    }
    /* Refrescar detalle Y resumen de motorizados */
    verDetalleMotoCaja(_cajaDetalleMotoCurrent.nombre, _cajaDetalleMotoCurrent.id);
    renderMotosCaja();
    if (typeof showNotif==='function') showNotif('Día liquidado · '+_fechaDisplayCaja(fecha));
  } catch(err) { console.error(err); }
};

window.cerrarDetalleMoto = function() {
  var el = document.getElementById('detalle-moto-caja');
  if (el) el.style.display = 'none';
};

/* ── Init ── */
window.initCaja = function() {
  _cajaFiltroDesde = ''; _cajaFiltroHasta = '';
  _cajaFiltroPago  = 'pendientes';
  _cajaResumenTiendas = null; _cajaDetallesTienda = {}; _cajaFirmaTiendas = '';
  _cerrarFotosPago(); _cajaLiqAbiertas = {};
  _motoFiltroDesde = ''; _motoFiltroHasta = '';
  _mostrarPagadosMotos   = false;
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
  if (e.detail && e.detail.tipo === 'foto_pago_tienda' && document.getElementById('tbody-tiendas-caja')) {
    renderTiendasCaja();
  }
});

/* ── Editar orden desde Caja ── */
window.editarOrdenDesdeCaja = function(ordenId, diaPagado, fecha) {
  /* Reutiliza el mismo modal "Actualizar orden" de Todos los pedidos. El
     refresco de caja al guardar ya lo hace guardarActualizarEstadoOrden()
     por su cuenta (ver _refrescarCajaActual más abajo). Si su día ya se
     liquidó, se avisa antes: cambiar montos o estado descuadra lo pagado. */
  if (diaPagado && !confirm('El ' + _fechaDisplayCaja(fecha) + ' ya está marcado como pagado para esta tienda.\n' +
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
  /* renderTiendasCaja ya recarga el detalle de las tiendas abiertas */

  var panelMoto = document.getElementById('detalle-moto-caja');
  if (panelMoto && panelMoto.style.display === 'block' && _cajaDetalleMotoCurrent.nombre) {
    verDetalleMotoCaja(_cajaDetalleMotoCurrent.nombre, _cajaDetalleMotoCurrent.id);
  }
};