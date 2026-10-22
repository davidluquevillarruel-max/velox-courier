/* ============================================================
   scripts/leer-xlsx.js — Lector mínimo de .xlsx sin dependencias
   Un .xlsx es un zip con XML adentro: se lee el directorio central
   del zip, se descomprime cada parte con zlib y se sacan las celdas
   de la primera hoja. Alcanza para planillas simples (texto,
   números y fechas); no evalúa fórmulas (usa el valor guardado).
   ============================================================ */
const fs   = require('fs');
const zlib = require('zlib');

function leerZip(buf) {
  /* Fin del directorio central: firma 0x06054b50, desde el final */
  let fin = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error('El archivo no es un .xlsx válido (zip)');

  const total  = buf.readUInt16LE(fin + 10);
  let   pos    = buf.readUInt32LE(fin + 16);
  const partes = {};
  for (let n = 0; n < total; n++) {
    const metodo   = buf.readUInt16LE(pos + 10);
    const tamComp  = buf.readUInt32LE(pos + 20);
    const largoNom = buf.readUInt16LE(pos + 28);
    const largoExt = buf.readUInt16LE(pos + 30);
    const largoCom = buf.readUInt16LE(pos + 32);
    const local    = buf.readUInt32LE(pos + 42);
    const nombre   = buf.toString('utf8', pos + 46, pos + 46 + largoNom);

    const inicio = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const datos  = buf.subarray(inicio, inicio + tamComp);
    partes[nombre] = () => (metodo === 0 ? datos : zlib.inflateRawSync(datos)).toString('utf8');

    pos += 46 + largoNom + largoExt + largoCom;
  }
  return partes;
}

const desescapar = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');

/* Texto de un <si> o <is>: puede venir partido en varios <t> (rich text) */
const textoDe = xml => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => desescapar(m[1])).join('');

/* "AB12" → índice de columna 27 (base 0) */
function columna(ref) {
  const letras = ref.match(/^[A-Z]+/)[0];
  let n = 0;
  for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/* Devuelve la primera hoja como matriz de filas (arrays de celdas).
   Números como Number, texto como String, celdas vacías como ''. */
function leerPrimeraHoja(rutaArchivo) {
  const partes = leerZip(fs.readFileSync(rutaArchivo));

  const compartidos = partes['xl/sharedStrings.xml']
    ? [...partes['xl/sharedStrings.xml']().matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => textoDe(m[1]))
    : [];

  /* Primera hoja según workbook.xml (no siempre es sheet1.xml) */
  const libro  = partes['xl/workbook.xml']();
  const rId    = libro.match(/<sheet\b[^>]*r:id="([^"]+)"/)[1];
  const rels   = partes['xl/_rels/workbook.xml.rels']();
  const relTag = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m => m[0]).find(t => t.includes(`Id="${rId}"`));
  let destino  = relTag.match(/Target="([^"]+)"/)[1].replace(/^\/?xl\//, '');
  const hoja   = partes['xl/' + destino]();

  const filas = [];
  for (const mf of hoja.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const fila = [];
    for (const mc of (mf[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = mc[1];
      const cuerpo = mc[2] || '';
      const ref  = attrs.match(/\br="([A-Z]+\d+)"/)[1];
      const tipo = (attrs.match(/\bt="([^"]+)"/) || [])[1];
      const v    = (cuerpo.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let valor = '';
      if (tipo === 's')              valor = compartidos[+v] ?? '';
      else if (tipo === 'inlineStr') valor = textoDe(cuerpo);
      else if (tipo === 'str' || tipo === 'e') valor = v !== undefined ? desescapar(v) : '';
      else if (tipo === 'b')         valor = v === '1';
      else if (v !== undefined)      valor = Number(v);
      fila[columna(ref)] = valor;
    }
    for (let i = 0; i < fila.length; i++) if (fila[i] === undefined) fila[i] = '';
    filas.push(fila);
  }
  return filas;
}

/* Número de serie de Excel (días desde 1899-12-30) → 'YYYY-MM-DD' */
function fechaDeSerieExcel(n) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86400000));
  return d.toISOString().slice(0, 10);
}

module.exports = { leerPrimeraHoja, fechaDeSerieExcel };
