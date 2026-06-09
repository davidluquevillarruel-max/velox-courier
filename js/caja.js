/* ============================================================
   caja.js — Módulo de Caja
   Estados con cobro: entregado, ausente
   Estados sin cobro: todo lo demás
   ============================================================ */
var API = '/api';
var _cajaFiltroDesde = '';
var _cajaFiltroHasta = '';
var _EC = ['entregado', 'ausente'];

function _fechaDisplayCaja(f) {
  if (!f) return '—';
  var p = (f.substring?f:String(f)).substring(0,10).split('-');
  var meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return p[2]+' '+meses[parseInt(p[1])-1]+' '+p[0];
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

/* ── Filtros ── */
window.aplicarFiltroTiendas = function() {
  _cajaFiltroDesde = document.getElementById('filtro-desde').value;
  _cajaFiltroHasta = document.getElementById('filtro-hasta').value;
  renderTiendasCaja();
};
window.limpiarFiltroTiendas = function() {
  _cajaFiltroDesde = ''; _cajaFiltroHasta = '';
  document.getElementById('filtro-desde').value = '';
  document.getElementById('filtro-hasta').value = '';
  renderTiendasCaja();
};

/* ════════════════════════════════════════════
   TAB TIENDAS
   Delivery cobrable − Cobrado = Saldo
   + = tienda nos debe
   − = nosotros le debemos
════════════════════════════════════════════ */
window.renderTiendasCaja = async function() {
  var tbody = document.getElementById('tbody-tiendas-caja');
  if (!tbody) return;

  var url = API + '/caja/tiendas';
  var params = [];
  if (_cajaFiltroDesde) params.push('desde='+_cajaFiltroDesde);
  if (_cajaFiltroHasta) params.push('hasta='+_cajaFiltroHasta);
  if (params.length) url += '?' + params.join('&');

  try {
    var r    = await fetch(url);
    var data = await r.json();

    /* KPIs */
    var totalPorCobrar=0, totalPorDev=0, alDia=0, conSaldo=0;
    var resumenT = {};
    data.forEach(function(f) {
      var saldo = parseFloat(f.saldo_neto||0);
      if (!resumenT[f.tienda]) resumenT[f.tienda] = 0;
      if (!f.pagado) resumenT[f.tienda] += saldo;
    });
    Object.values(resumenT).forEach(function(s) {
      if (s > 0)      { totalPorCobrar += s; conSaldo++; }
      else if (s < 0) { totalPorDev += Math.abs(s); conSaldo++; }
      else              alDia++;
    });

    var set = function(id,v){ var el=document.getElementById(id); if(el) el.textContent=v; };
    set('kpi-cobrar',   'S/ '+totalPorCobrar.toFixed(2));
    set('kpi-devolver', 'S/ '+totalPorDev.toFixed(2));
    set('kpi-aldia',    alDia);
    set('kpi-consaldo', conSaldo);

    /* Agrupar por tienda */
    var porTienda = {};
    data.forEach(function(f) {
      if (!porTienda[f.tienda]) porTienda[f.tienda] = { id:f.id, ciclo:f.ciclo_pago, dias:[] };
      porTienda[f.tienda].dias.push(f);
    });

    var html = '';
    Object.keys(porTienda).sort().forEach(function(nombre) {
      var g       = porTienda[nombre];
      var rowspan = g.dias.length;

      g.dias.forEach(function(f, i) {
        var saldo    = parseFloat(f.saldo_neto||0);
        var delivery = parseFloat(f.delivery_cobrable||0);
        var cobrado  = parseFloat(f.cobrado||0);

        var saldoHTML = saldo > 0
          ? '<span style="color:var(--color-green);font-weight:600">S/ '+saldo.toFixed(2)+' — tienda nos debe</span>'
          : saldo < 0
          ? '<span style="color:var(--color-red-text);font-weight:600">S/ '+Math.abs(saldo).toFixed(2)+' — le debemos</span>'
          : '<span style="color:var(--color-text-secondary)">S/ 0.00</span>';

        var estadoDeuda, accion;
        if (saldo === 0) {
          estadoDeuda = '<span class="badge-pago-si">✓ Sin deuda</span>';
          accion = '—';
        } else if (f.pagado) {
          estadoDeuda = '<span class="badge-pago-si">✓ Pagado</span>';
          accion = '<span style="font-size:12px;color:var(--color-text-tertiary)">Liquidado</span>';
        } else {
          estadoDeuda = '<span class="badge-pago-no">✗ Pendiente</span>';
          accion = '<button class="btn-pagar" onclick="marcarTiendaPagada(\''+f.id+'\',\''+f.fecha+'\')">Marcar pagado</button>';
        }

        var celdaTienda = i===0
          ? '<td rowspan="'+rowspan+'" style="vertical-align:top;padding-top:13px"><strong>'+nombre+'</strong><br><span style="font-size:11px;color:var(--color-text-secondary)">'+g.ciclo+'</span></td>'
          : '';
        var celdaVer = i===0
          ? '<td rowspan="'+rowspan+'" style="vertical-align:top;padding-top:10px"><button class="btn btn-sm" onclick="verDetalleTiendaCaja(\''+nombre+'\')"><i class="ti ti-eye"></i></button></td>'
          : '';

        html += '<tr>'+celdaTienda+
          '<td style="font-size:12px;color:var(--color-text-secondary)">'+_fechaDisplayCaja(f.fecha)+'</td>'+
          '<td style="font-weight:500">S/ '+delivery.toFixed(2)+'</td>'+
          '<td style="font-weight:500">S/ '+cobrado.toFixed(2)+'</td>'+
          '<td>'+saldoHTML+'</td>'+
          '<td>'+estadoDeuda+'</td>'+
          '<td>'+accion+'</td>'+
          celdaVer+'</tr>';
      });
    });

    tbody.innerHTML = html || '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--color-text-tertiary)">Sin registros para el período</td></tr>';

  } catch(err) { console.error('Error caja tiendas:', err); }
};

window.marcarTiendaPagada = async function(idTienda, fecha) {
  try {
    await fetch(API+'/caja/tiendas/pagar', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ id_tienda: parseInt(idTienda), fecha: fecha }),
    });
    renderTiendasCaja();
    if (typeof showNotif==='function') showNotif('Pago registrado · '+_fechaDisplayCaja(fecha));
  } catch(err) { console.error(err); }
};

window.verDetalleTiendaCaja = async function(nombreTienda) {
  var el = document.getElementById('titulo-detalle-tienda');
  if (el) el.textContent = 'Detalle · ' + nombreTienda;
  try {
    var rT = await fetch(API + '/tiendas');
    var tiendas = await rT.json();
    var t = tiendas.find(function(x){ return x.nombre===nombreTienda; });
    if (!t) return;

    var r = await fetch(API + '/tiendas/' + t.id + '/ordenes');
    var ordenes = await r.json();

    var tbody = document.getElementById('tbody-detalle-tienda-caja');
    if (!tbody) return;

    var badgeMap = {
      'entregado':'entregado','no-entregado':'no-entregado','ausente':'ausente',
      'en-proceso':'pendiente','reprogramado':'reprogramado','cancelado':'no-entregado',
      'cambio':'ausente','devolucion':'ausente','recojo':'pendiente',
    };

    tbody.innerHTML = ordenes.map(function(o) {
      var tieneCobro = _EC.includes(o.estado);
      var delivery   = tieneCobro ? parseFloat(o.delivery_total||0) : 0;
      var cobrado    = tieneCobro ? parseFloat(o.monto_cobrado||0)  : 0;
      var saldo      = delivery - cobrado;
      var saldoClass = saldo>0?'balance-pos':saldo<0?'balance-neg':'balance-zero';
      var dStr = tieneCobro ? 'S/ '+delivery.toFixed(2) : '<span style="color:var(--color-text-tertiary)">S/ 0.00</span>';
      var cStr = tieneCobro ? 'S/ '+cobrado.toFixed(2)  : '<span style="color:var(--color-text-tertiary)">S/ 0.00</span>';
      return '<tr>' +
        '<td><strong>#'+o.codigo+'</strong></td>' +
        '<td>'+(o.dest_nombre||'—')+'</td>' +
        '<td>'+o.distrito+'</td>' +
        '<td><span class="badge '+(badgeMap[o.estado]||'pendiente')+'">'+o.estado+'</span></td>' +
        '<td>'+dStr+'</td><td>'+cStr+'</td>' +
        '<td class="'+saldoClass+'">'+
          (tieneCobro?(saldo>0?'S/ '+saldo.toFixed(2):saldo<0?'− S/ '+Math.abs(saldo).toFixed(2):'S/ 0.00'):'<span style="color:var(--color-text-tertiary)">S/ 0.00</span>')+
        '</td>' +
        '<td style="font-size:12px;color:var(--color-text-secondary)">'+_fechaDisplayCaja(o.fecha)+'</td>' +
      '</tr>';
    }).join('') || '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--color-text-tertiary)">Sin órdenes</td></tr>';

    var detalle = document.getElementById('detalle-tienda-caja');
    if (detalle) { detalle.style.display='block'; setTimeout(function(){ detalle.scrollIntoView({behavior:'smooth',block:'start'}); },50); }
  } catch(err) { console.error(err); }
};

window.cerrarDetalleTienda = function() {
  var el=document.getElementById('detalle-tienda-caja'); if(el) el.style.display='none';
};

/* ════════════════════════════════════════════
   TAB LIQUIDEZ DIARIA — filtro de fechas
════════════════════════════════════════════ */
window.limpiarFiltroLiquidez = function() {
  var d = document.getElementById('filtro-liquidez-desde');
  var h = document.getElementById('filtro-liquidez-hasta');
  if (d) d.value = '';
  if (h) h.value = '';
  renderLiquidez();
};

/* ════════════════════════════════════════════
   TAB LIQUIDEZ DIARIA
   Bruto = delivery estados con cobro
   Pago motos = pago_moto estados con cobro
   Productos = monto_producto
   Líquido = Bruto − Pago motos − Productos
════════════════════════════════════════════ */
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

    tbody.innerHTML = rows || '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--color-text-tertiary)">Sin datos</td></tr>';

    var set = function(id,v){ var el=document.getElementById(id); if(el) el.textContent=v; };
    set('kpi-bruto', 'S/ '+totBruto.toFixed(2));
    set('kpi-motos', 'S/ '+totMotos.toFixed(2));
    set('kpi-devol', 'S/ '+totProd.toFixed(2));
    set('kpi-neto',  'S/ '+totNeto.toFixed(2));
  } catch(err) { console.error('Error liquidez:', err); }
};

/* ════════════════════════════════════════════
   TAB MOTORIZADOS
   Cobrado − Pago moto = Saldo
   + = motorizado debe a Velox
   − = Velox le debe al motorizado
════════════════════════════════════════════ */
window.renderMotosCaja = async function() {
  var tbody = document.getElementById('tbody-motos-caja');
  if (!tbody) return;
  try {
    var r    = await fetch(API+'/caja/motorizados');
    var data = await r.json();

    var porMoto = {};
    data.forEach(function(d) {
      if (!porMoto[d.motorizado]) porMoto[d.motorizado] = { id:d.id_motorizado, dias:[] };
      porMoto[d.motorizado].dias.push(d);
    });

    tbody.innerHTML = Object.keys(porMoto).sort().map(function(nombre) {
      var g         = porMoto[nombre];
      var pagoTotal = g.dias.reduce(function(s,d){ return s+parseFloat(d.pago_moto||0); }, 0);
      var cobTotal  = g.dias.reduce(function(s,d){ return s+parseFloat(d.cobrado||0); }, 0);
      var saldo     = cobTotal - pagoTotal;
      var pendientes= g.dias.filter(function(d){ return !d.pagado && (parseFloat(d.pago_moto||0)>0||parseFloat(d.cobrado||0)>0); }).length;

      var saldoLabel = saldo > 0
        ? '<span style="color:var(--color-green);font-weight:600">S/ '+saldo.toFixed(2)+' — debe a Velox</span>'
        : saldo < 0
        ? '<span style="color:var(--color-red-text);font-weight:600">S/ '+Math.abs(saldo).toFixed(2)+' — Velox le debe</span>'
        : '<span style="color:var(--color-text-secondary)">S/ 0.00</span>';

      var estadoDeuda = pendientes > 0
        ? '<span class="badge-pago-no">✗ '+pendientes+' día(s) pendiente(s)</span>'
        : '<span class="badge-pago-si">✓ Al día</span>';

      return '<tr>' +
        '<td><strong>'+nombre+'</strong></td>' +
        '<td>'+saldoLabel+'</td>' +
        '<td>'+estadoDeuda+'</td>' +
        '<td><button class="btn btn-sm btn-primary" onclick="verDetalleMotoCaja(\''+nombre+'\',\''+g.id+'\')"><i class="ti ti-eye"></i> Ver detalle</button></td>' +
      '</tr>';
    }).join('') || '<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--color-text-tertiary)">Sin datos</td></tr>';

  } catch(err) { console.error('Error motos caja:', err); }
};

window.verDetalleMotoCaja = async function(nombreMoto, idMoto) {
  var el = document.getElementById('titulo-detalle-moto');
  if (el) el.textContent = 'Detalle · '+nombreMoto;
  try {
    var r    = await fetch(API+'/caja/motorizados');
    var data = await r.json();
    var diasMoto = data.filter(function(d){ return d.motorizado===nombreMoto; });

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
        estadoDeuda = '<span class="badge-pago-si">✓ Pagado</span>';
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
    }).join('') || '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--color-text-tertiary)">Sin datos</td></tr>';

    var detalle = document.getElementById('detalle-moto-caja');
    if (detalle) { detalle.style.display='block'; setTimeout(function(){ detalle.scrollIntoView({behavior:'smooth',block:'start'}); },50); }
  } catch(err) { console.error(err); }
};

window.marcarMotoDia = async function(idMoto, fecha) {
  try {
    await fetch(API+'/caja/motorizados/pagar', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ id_motorizado: parseInt(idMoto), fecha: fecha }),
    });
    verDetalleMotoCaja(document.getElementById('titulo-detalle-moto').textContent.replace('Detalle · ',''));
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
  ['tiendas','liquidez','motorizados'].forEach(function(t){
    var el = document.getElementById('tab-'+t);
    if (el) el.style.display = t==='tiendas' ? 'block' : 'none';
  });
  renderTiendasCaja();
};
