/* ============================================================
   exportar-pedidos.js — "Descargar Excel" / "Descargar CSV" en
   "Todos los pedidos"
   Exporta EXACTAMENTE las filas que se ven en la tabla en ese
   momento: la fecha la filtra el servidor y el resto de los filtros
   (js/filters.js) ocultan filas, así que se toman las <tr> visibles
   y se buscan sus órdenes en _ordenesCache (js/pedidos.js) por su
   data-id. Sin librerías: el CSV y el .xlsx se arman a mano.

   Las columnas son las mismas del Excel de importación
   (server/scripts/importar-ordenes-excel.js), en el mismo orden, así
   un archivo exportado se puede volver a importar.
   ============================================================ */

var _EXPORT_COLUMNAS = [
  'FECHA DE CREACION', 'REPROGRAMADOS PARA HOY', 'TIENDA', 'ORIGEN', 'NOMBRE', 'DISTRITO',
  'CAMBIO/ESCOJE TALLA', 'MONTO POR COBRAR', 'MOTORIZADO', 'METODO DE PAGO', 'ESTADO',
  'PRODUCTO ESPECIAL', 'MONTO ADICIONAL AL DELIVERY BASE', 'PAGO ADICIONAL MOTORIZADO', 'MONTO'
];

/* Estado guardado → etiqueta del Excel */
var _EXPORT_ESTADOS = {
  'entregado': 'ENTREGADO', 'reprogramado': 'REPROGRAMADOS', 'cancelado': 'CANCELADO',
  'no-entregado': 'NO ENTREGADO', 'ausente': 'AUSENTE', 'devolucion': 'DEVOLUCION',
  'en-proceso': 'EN PROCESO'
};

/* Medio de pago guardado → etiqueta del Excel (los dos últimos no
   estaban en el Excel original) */
var _EXPORT_MEDIOS = {
  'yape-motorizado': 'YAPE MOTORIZADO', 'pago-tienda': 'PAGO TIENDA',
  'efectivo-motorizado': 'EFECTIVO MOTORIZADO', 'pago-empresa': 'PAGO VELOX'
};

/* Notas que deja el import en observaciones (ver armarOrden en
   server/scripts/importar-ordenes-excel.js) */
var _NOTA_REPROGRAMADO = 'reprogramado para hoy';
var _NOTA_CAMBIO_TALLA = 'cambio/escoge talla';

function _tieneNota(o, nota) {
  return String(o.observaciones || '').toLowerCase().indexOf(nota) !== -1;
}

/* Montos en 0 van vacíos, como en el Excel original */
function _montoOVacio(valor) {
  var n = Math.round((parseFloat(valor) || 0) * 100) / 100;
  return n === 0 ? '' : n;
}

/* Orden (como la devuelve GET /api/ordenes) → fila de 15 celdas.
   La fecha va como 'YYYY-MM-DD'; cada formato la escribe a su modo. */
function filaExportOrden(o) {
  /* Reprogramada para hoy: la nota del import, o asignada un día
     después del de su creación (las que se reprograman desde el
     sistema vuelven a Asignación y toman el día nuevo) */
  var reprogramada = _tieneNota(o, _NOTA_REPROGRAMADO) ||
    (!!o.fecha_asignacion && !!o.fecha && o.fecha_asignacion > o.fecha);
  var cambioTalla = o.condicionEspecial === 'cambio' || o.condicionEspecial === 'escoge-talla' ||
    _tieneNota(o, _NOTA_CAMBIO_TALLA);

  var metodo = '';
  if (o.metodo_pago === 'sin-cobro') metodo = 'SIN COBRO';
  else if (_EXPORT_MEDIOS[o.medio_pago]) metodo = _EXPORT_MEDIOS[o.medio_pago];

  var pagoMotoAdic = _montoOVacio(o.pago_moto_adicional);

  return [
    o.fecha || '',
    reprogramada ? 'SI' : '',
    o.tienda || '',
    o.origen || '',
    o.dest_nombre || '',
    o.distrito || '',
    cambioTalla ? 'SI' : '',
    _montoOVacio(o.monto_cobrado),
    o.motorizado || '',
    metodo,
    _EXPORT_ESTADOS[o.estado] || String(o.estado || '').toUpperCase(),
    o.producto_especial ? 'SI' : '',
    _montoOVacio(o.monto_adicional),
    pagoMotoAdic === '' ? '' : 'SI',
    pagoMotoAdic
  ];
}

/* 'YYYY-MM-DD' → 'DD/MM/YYYY' */
function _fechaDMY(yyyymmdd) {
  var p = String(yyyymmdd).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(yyyymmdd);
}

/* ════════════════════════════════════════════
   CSV (comillas como RFC 4180)
   Separado por punto y coma: en Windows en español de Perú el
   separador de listas es ";" y Excel abre un CSV con comas todo en
   una sola columna. El decimal es "." así que los montos no chocan.
════════════════════════════════════════════ */
var _CSV_SEPARADOR = ';';

function _celdaCsv(v) {
  var s = String(v);
  return /[";,\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function generarCsvPedidos(filas) {
  var lineas = [_EXPORT_COLUMNAS.map(_celdaCsv).join(_CSV_SEPARADOR)];
  filas.forEach(function(f) {
    var celdas = f.slice();
    if (celdas[0]) celdas[0] = _fechaDMY(celdas[0]);
    lineas.push(celdas.map(_celdaCsv).join(_CSV_SEPARADOR));
  });
  /* BOM: sin él, Excel abre el CSV como ANSI y rompe tildes y Ñ */
  return '﻿' + lineas.join('\r\n') + '\r\n';
}

/* ════════════════════════════════════════════
   XLSX (zip sin comprimir con el XML mínimo)
   Un .xlsx es un zip; con método 0 ("store") no hace falta
   comprimir, solo calcular el CRC32 de cada parte.
════════════════════════════════════════════ */
var _CRC_TABLA = null;
function _crc32(bytes) {
  if (!_CRC_TABLA) {
    _CRC_TABLA = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      _CRC_TABLA[n] = c >>> 0;
    }
  }
  var crc = 0xFFFFFFFF;
  for (var i = 0; i < bytes.length; i++) crc = _CRC_TABLA[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function _zipSinComprimir(partes) {
  var enc = new TextEncoder();
  var locales = [], centrales = [], offset = 0;

  partes.forEach(function(p) {
    var nombre = enc.encode(p.nombre);
    var datos  = enc.encode(p.contenido);
    var crc    = _crc32(datos);

    var local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);              /* versión necesaria */
    local.setUint16(8, 0, true);               /* método 0 = store */
    local.setUint16(12, 0x0021, true);         /* fecha 1980-01-01 */
    local.setUint32(14, crc, true);
    local.setUint32(18, datos.length, true);
    local.setUint32(22, datos.length, true);
    local.setUint16(26, nombre.length, true);
    locales.push(new Uint8Array(local.buffer), nombre, datos);

    var central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(14, 0x0021, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, datos.length, true);
    central.setUint32(24, datos.length, true);
    central.setUint16(28, nombre.length, true);
    central.setUint32(42, offset, true);
    centrales.push(new Uint8Array(central.buffer), nombre);

    offset += 30 + nombre.length + datos.length;
  });

  var tamCentral = centrales.reduce(function(s, b) { return s + b.length; }, 0);
  var fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(8, partes.length, true);
  fin.setUint16(10, partes.length, true);
  fin.setUint32(12, tamCentral, true);
  fin.setUint32(16, offset, true);

  var bloques = locales.concat(centrales, [new Uint8Array(fin.buffer)]);
  var total = bloques.reduce(function(s, b) { return s + b.length; }, 0);
  var salida = new Uint8Array(total), pos = 0;
  bloques.forEach(function(b) { salida.set(b, pos); pos += b.length; });
  return salida;
}

/* Escapa para XML y quita los caracteres de control que XML no admite */
function _xml(s) {
  return String(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* 0 → A, 25 → Z, 26 → AA */
function _letraColumna(i) {
  var s = '';
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s;
  return s;
}

/* 'YYYY-MM-DD' → número de serie de Excel (días desde 1899-12-30) */
function _serieExcel(yyyymmdd) {
  var p = String(yyyymmdd).split('-');
  return Math.round((Date.UTC(+p[0], +p[1] - 1, +p[2]) - Date.UTC(1899, 11, 30)) / 86400000);
}

function generarXlsxPedidos(filas) {
  /* Estilos: s="1" = fecha dd/mm/yyyy, s="2" = encabezado en negrita */
  var celda = function(ref, v, estilo) {
    var s = estilo ? ' s="' + estilo + '"' : '';
    if (v === '' || v === null || v === undefined) return '';
    if (typeof v === 'number') return '<c r="' + ref + '"' + s + '><v>' + v + '</v></c>';
    return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + _xml(v) + '</t></is></c>';
  };

  var filasXml = ['<row r="1">' + _EXPORT_COLUMNAS.map(function(t, i) {
    return celda(_letraColumna(i) + '1', t, 2);
  }).join('') + '</row>'];

  filas.forEach(function(f, n) {
    var r = n + 2;
    filasXml.push('<row r="' + r + '">' + f.map(function(v, i) {
      var ref = _letraColumna(i) + r;
      if (i === 0 && /^\d{4}-\d{2}-\d{2}$/.test(v)) return celda(ref, _serieExcel(v), 1);
      return celda(ref, v);
    }).join('') + '</row>');
  });

  var anchos = [12, 12, 22, 12, 22, 24, 12, 12, 18, 18, 16, 12, 14, 14, 10];
  var cols = anchos.map(function(w, i) {
    return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
  }).join('');

  var NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  var NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var cabecera = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  return _zipSinComprimir([
    { nombre: '[Content_Types].xml', contenido: cabecera +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>' },
    { nombre: '_rels/.rels', contenido: cabecera +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="' + NS_R + '/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>' },
    { nombre: 'xl/workbook.xml', contenido: cabecera +
      '<workbook xmlns="' + NS + '" xmlns:r="' + NS_R + '">' +
      '<sheets><sheet name="Pedidos" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { nombre: 'xl/_rels/workbook.xml.rels', contenido: cabecera +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="' + NS_R + '/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="' + NS_R + '/styles" Target="styles.xml"/>' +
      '</Relationships>' },
    { nombre: 'xl/styles.xml', contenido: cabecera +
      '<styleSheet xmlns="' + NS + '">' +
      '<numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>' +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="3">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
      '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>' },
    { nombre: 'xl/worksheets/sheet1.xml', contenido: cabecera +
      '<worksheet xmlns="' + NS + '">' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<cols>' + cols + '</cols>' +
      '<sheetData>' + filasXml.join('') + '</sheetData></worksheet>' }
  ]);
}

/* ════════════════════════════════════════════
   BOTONES (solo en el navegador)
════════════════════════════════════════════ */

/* Órdenes de las filas visibles de la tabla, en el orden de pantalla */
function _ordenesVisiblesPedidos() {
  var porId = {};
  (typeof _ordenesCache !== 'undefined' ? _ordenesCache : []).forEach(function(o) { porId[o.id] = o; });
  var filas = document.querySelectorAll('#tbody-pedidos tr[data-id]');
  var visibles = [];
  filas.forEach(function(tr) {
    if (tr.style.display === 'none') return;
    var o = porId[tr.getAttribute('data-id')];
    if (o) visibles.push(o);
  });
  return visibles;
}

/* pedidos_<filtro>_<hoy>: la fecha que se ve (o "todos"), el estado
   si hay uno elegido, y "filtrado" si hay otro filtro activo */
function _nombreArchivoPedidos(extension) {
  var val = function(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
  var chk = function(id) { var el = document.getElementById(id); return el ? el.checked : false; };
  var slug = function(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  };

  var partes = [(typeof _filtroFecha !== 'undefined' && _filtroFecha) ? _filtroFecha : 'todos'];
  if (val('f-filtro-estado-pedidos')) partes.push(slug(val('f-filtro-estado-pedidos')));
  if (val('f-buscar-pedidos') || val('f-filtro-tienda-pedidos') || val('f-filtro-motorizado-pedidos') ||
      val('f-filtro-subestado-pedidos') || chk('f-filtro-pendiente-devolucion') || chk('f-filtro-condicion-especial')) {
    partes.push('filtrado');
  }
  return 'pedidos_' + partes.join('_') + '_' + _hoy() + '.' + extension;
}

function _descargarArchivo(contenido, tipo, nombre) {
  var url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  var a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}

window.exportarPedidos = function(formato) {
  var ordenes = _ordenesVisiblesPedidos();
  if (ordenes.length === 0) {
    if (typeof showNotif === 'function') showNotif('No hay órdenes en la tabla para descargar.');
    return;
  }
  var filas = ordenes.map(filaExportOrden);
  if (formato === 'csv') {
    _descargarArchivo(generarCsvPedidos(filas), 'text/csv;charset=utf-8', _nombreArchivoPedidos('csv'));
  } else {
    _descargarArchivo(generarXlsxPedidos(filas),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', _nombreArchivoPedidos('xlsx'));
  }
  if (typeof showNotif === 'function') {
    showNotif('Descargando ' + ordenes.length + (ordenes.length === 1 ? ' orden' : ' órdenes'));
  }
};

/* Para probar el mapeo y los generadores desde Node, sin navegador */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { filaExportOrden: filaExportOrden, generarCsvPedidos: generarCsvPedidos,
                     generarXlsxPedidos: generarXlsxPedidos, COLUMNAS: _EXPORT_COLUMNAS };
}
