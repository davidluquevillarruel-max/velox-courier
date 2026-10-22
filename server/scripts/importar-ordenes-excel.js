/* ============================================================
   scripts/importar-ordenes-excel.js — Importa órdenes desde un Excel
   Resuelve tienda, distrito y motorizado POR NOMBRE al momento de
   correr (sin ids fijos), así sirve igual en local que en el
   servidor. Usa la conexión de server/.env (db.js).

   Uso (desde server/):
     node scripts/importar-ordenes-excel.js "<ruta.xlsx>"
         → solo valida, no escribe nada
     node scripts/importar-ordenes-excel.js "<ruta.xlsx>" --insertar --fecha-asignacion=2026-10-20
         → crea tiendas / motorizados / distritos que falten e inserta
           todas las órdenes, en UNA transacción (todo o nada)

   Los nombres se comparan sin distinguir mayúsculas, tildes ni
   espacios de más.

   Montos: el POST /api/ordenes no los calcula (los manda el
   formulario). Acá se reproduce lo que hace el sistema:
   · delivery_base y pago_moto_base = tarifa del distrito
     (onDistritoChange en js/pedidos.js)
   · monto_producto = cobrado − (delivery + adicional), mínimo 0
     (_recalcularValorProductoUpdate en js/motorizados.js)
   · delivery_total / pago_moto_total son columnas calculadas
   ============================================================ */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { getPool, sql } = require('../db');
const { leerPrimeraHoja, fechaDeSerieExcel } = require('./leer-xlsx');

/* Distritos que se pueden crear si faltan: la tarifa no se puede
   adivinar, así que un distrito que falte y no esté acá frena todo */
const DISTRITOS_NUEVOS = {
  'LURIGANCHO - CHOSICA': { delivery: 25, moto: 15, zona: 'Norte/Este' },
};

/* Nunca se crean ni se usan desde el Excel */
const COMODIN_SIN_DEFINIR = 'SIN DEFINIR';

/* Encabezados del Excel → clave interna */
const COLUMNAS = {
  'FECHA DE CREACION':                'fecha',
  'REPROGRAMADOS PARA HOY':           'reprogramadoParaHoy',
  'TIENDA':                           'tienda',
  'ORIGEN':                           'origen',
  'NOMBRE':                           'dest',
  'DISTRITO':                         'distrito',
  'CAMBIO/ESCOJE TALLA':              'cambioTalla',
  'MONTO POR COBRAR':                 'cobrado',
  'MOTORIZADO':                       'motorizado',
  'METODO DE PAGO':                   'metodoPago',
  'ESTADO':                           'estado',
  'PRODUCTO ESPECIAL':                'productoEspecial',
  'MONTO ADICIONAL AL DELIVERY BASE': 'montoAdicional',
  'PAGO ADICIONAL MOTORIZADO':        'pagoMotoAdicSi',
  'MONTO':                            'pagoMotoAdic',
};

const normalizar = s => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/\s+/g, ' ').trim();

const esVacio = v => v === '' || v === null || v === undefined;

function leerExcel(ruta) {
  const filas = leerPrimeraHoja(ruta);
  const encabezado = filas[0].map(normalizar);
  const indice = {};
  for (const [titulo, clave] of Object.entries(COLUMNAS)) {
    const i = encabezado.indexOf(normalizar(titulo));
    if (i < 0) throw new Error(`Falta la columna "${titulo}" en el Excel`);
    indice[clave] = i;
  }
  return filas.slice(1)
    .map((f, n) => ({ celdas: f, filaExcel: n + 2 }))
    .filter(({ celdas }) => celdas.some(c => !esVacio(c)))
    .map(({ celdas, filaExcel }) => {
      const r = { filaExcel };
      for (const [clave, i] of Object.entries(indice)) {
        r[clave] = typeof celdas[i] === 'string' ? celdas[i].trim() : celdas[i];
      }
      if (typeof r.fecha === 'number') r.fecha = fechaDeSerieExcel(r.fecha);
      return r;
    });
}

/* Índice nombre normalizado → filas de la tabla (puede haber más de
   una si dos nombres solo se diferencian por tildes o mayúsculas) */
async function cargarCatalogo(pool, consulta) {
  const r = await pool.request().query(consulta);
  const mapa = new Map();
  for (const fila of r.recordset) {
    const k = normalizar(fila.nombre);
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(fila);
  }
  return mapa;
}

async function cargarCatalogos(pool) {
  return {
    tiendas:     await cargarCatalogo(pool, `SELECT id, nombre, activa AS activo FROM tiendas`),
    distritos:   await cargarCatalogo(pool, `SELECT id, nombre, activo, precio_delivery, pago_motorizado FROM distritos`),
    motorizados: await cargarCatalogo(pool, `SELECT id, nombre, activo FROM motorizados`),
    origenes:    await cargarCatalogo(pool, `SELECT id, nombre, activo FROM origenes`),
  };
}

/* ── Validación: nombres que no existen + filas raras ────────── */
function validar(filas, cat) {
  const faltan = { tiendas: new Map(), distritos: new Map(), motorizados: new Map(), origenes: new Map() };
  const avisos = []; /* { filaExcel, tipo, detalle } */
  const aviso  = (r, tipo, detalle) => avisos.push({ filaExcel: r.filaExcel, tipo, detalle });

  const revisarNombre = (r, campo, catalogo, destino) => {
    const k = normalizar(r[campo]);
    if (!k) return;
    const hallados = catalogo.get(k);
    if (!hallados) {
      if (!destino.has(r[campo])) destino.set(r[campo], []);
      destino.get(r[campo]).push(r.filaExcel);
    } else if (hallados.length > 1) {
      aviso(r, `${campo} ambiguo`, `"${r[campo]}" coincide con ${hallados.map(h => `${h.nombre} (id ${h.id})`).join(', ')}`);
    } else if (hallados[0].activo === false) {
      aviso(r, `${campo} inactivo`, `"${hallados[0].nombre}" (id ${hallados[0].id}) está desactivado en la base`);
    }
  };

  const NOMBRES_SOSPECHOSOS = ['VERIFICAR', 'SIN DEFINIR', 'PRUEBA', 'X', '?', '-'];
  const METODOS  = ['YAPE MOTORIZADO', 'SIN COBRO', 'PAGO TIENDA'];
  const ESTADOS  = ['ENTREGADO', 'REPROGRAMADOS', 'CANCELADO'];
  const vistos   = new Map();

  for (const r of filas) {
    if (esVacio(r.tienda))   aviso(r, 'sin tienda', '');
    if (esVacio(r.distrito)) aviso(r, 'sin distrito', '');
    if (esVacio(r.estado))   aviso(r, 'sin estado', '');
    for (const campo of ['tienda', 'distrito', 'motorizado']) {
      if (NOMBRES_SOSPECHOSOS.includes(normalizar(r[campo]))) aviso(r, `${campo} sospechoso`, `"${r[campo]}"`);
    }

    revisarNombre(r, 'tienda',   cat.tiendas,   faltan.tiendas);
    revisarNombre(r, 'distrito', cat.distritos, faltan.distritos);
    revisarNombre(r, 'origen',   cat.origenes,  faltan.origenes);
    revisarNombre(r, 'motorizado', cat.motorizados, faltan.motorizados);

    if (!(r.fecha && /^\d{4}-\d{2}-\d{2}$/.test(r.fecha))) aviso(r, 'fecha no válida', JSON.stringify(r.fecha));

    const metodo = normalizar(r.metodoPago);
    const estado = normalizar(r.estado);
    if (metodo && !METODOS.includes(metodo)) aviso(r, 'método de pago desconocido', `"${r.metodoPago}"`);
    if (estado && !ESTADOS.includes(estado)) aviso(r, 'estado desconocido', `"${r.estado}"`);

    for (const campo of ['cobrado', 'montoAdicional', 'pagoMotoAdic']) {
      if (!esVacio(r[campo]) && typeof r[campo] !== 'number') aviso(r, `${campo} no es número`, JSON.stringify(r[campo]));
    }
    const cobrado = Number(r.cobrado) || 0;
    if (metodo === 'SIN COBRO' && cobrado > 0) aviso(r, 'SIN COBRO con monto', `cobrar ${cobrado}`);
    if ((metodo === 'YAPE MOTORIZADO' || metodo === 'PAGO TIENDA') && cobrado === 0) aviso(r, `${r.metodoPago} sin monto`, '');
    if (!metodo && estado === 'ENTREGADO') aviso(r, 'entregado sin método de pago', cobrado ? `cobrar ${cobrado}` : '');
    if (!esVacio(r.pagoMotoAdicSi) && normalizar(r.pagoMotoAdicSi) !== 'SI') aviso(r, 'PAGO ADICIONAL MOTORIZADO raro', `"${r.pagoMotoAdicSi}"`);
    if (normalizar(r.pagoMotoAdicSi) === 'SI' && esVacio(r.pagoMotoAdic)) aviso(r, 'pago adicional moto "SI" sin MONTO', '');
    if (normalizar(r.pagoMotoAdicSi) !== 'SI' && !esVacio(r.pagoMotoAdic)) aviso(r, 'MONTO sin "SI" en pago adicional moto', `${r.pagoMotoAdic}`);
    if (Number(r.montoAdicional) < 0) aviso(r, 'adicional al delivery negativo', `${r.montoAdicional}`);
    if (Number(r.pagoMotoAdic) < 0)   aviso(r, 'pago adicional moto negativo', `${r.pagoMotoAdic}`);
    if (!esVacio(r.productoEspecial) && normalizar(r.productoEspecial) !== 'SI') aviso(r, 'PRODUCTO ESPECIAL raro', `"${r.productoEspecial}"`);
    if (!esVacio(r.reprogramadoParaHoy) && normalizar(r.reprogramadoParaHoy) !== 'SI') aviso(r, 'REPROGRAMADOS PARA HOY raro', `"${r.reprogramadoParaHoy}"`);
    if (esVacio(r.dest) || String(r.dest).trim().length < 2) aviso(r, 'sin nombre de destinatario', JSON.stringify(r.dest));

    /* Posibles duplicados: misma tienda + destinatario + distrito */
    if (!esVacio(r.dest)) {
      const clave = [r.tienda, r.dest, r.distrito].map(normalizar).join('|');
      if (vistos.has(clave)) aviso(r, 'posible duplicado', `igual a la fila ${vistos.get(clave)} (${r.tienda} / ${r.dest} / ${r.distrito})`);
      else vistos.set(clave, r.filaExcel);
    }
  }
  return { faltan, avisos };
}

function imprimirValidacion(filas, { faltan, avisos }) {
  console.log(`\nFilas con datos en el Excel: ${filas.length}`);
  for (const [nombre, mapa] of Object.entries(faltan)) {
    console.log(`\n── ${nombre.toUpperCase()} que NO existen en la base: ${mapa.size}`);
    for (const [valor, filasExcel] of [...mapa].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`   · "${valor}" — ${filasExcel.length} orden(es), filas ${filasExcel.join(', ')}`);
    }
  }
  const porTipo = new Map();
  for (const a of avisos) {
    if (!porTipo.has(a.tipo)) porTipo.set(a.tipo, []);
    porTipo.get(a.tipo).push(a);
  }
  console.log(`\n── FILAS RARAS (${avisos.length} avisos)`);
  for (const [tipo, lista] of porTipo) {
    console.log(`\n   ${tipo} (${lista.length}):`);
    for (const a of lista) console.log(`     fila ${a.filaExcel}${a.detalle ? ': ' + a.detalle : ''}`);
  }
}

/* ── Creación de lo que falta (dentro de la transacción) ─────── */

/* Mismos valores por defecto que POST /api/tiendas */
async function crearTienda(tx, nombre) {
  const r = await new sql.Request(tx)
    .input('nombre', sql.NVarChar, nombre)
    .query(`
      INSERT INTO tiendas (nombre, ruc, contacto, telefono, yape, direccion, ciclo_pago, activa, observaciones)
      VALUES (@nombre, '', '', '', '', '', 'semanal', 1, '');
      SELECT SCOPE_IDENTITY() AS id;
    `);
  return { id: r.recordset[0].id, nombre, activo: true };
}

/* Solo nombre e inicial; el resto se completa desde el sistema
   (mismos valores por defecto que POST /api/motorizados) */
async function crearMotorizado(tx, nombre) {
  const r = await new sql.Request(tx)
    .input('nombre',    sql.NVarChar, nombre)
    .input('iniciales', sql.NVarChar, normalizar(nombre).charAt(0))
    .query(`
      INSERT INTO motorizados (nombre, iniciales, id_zona, telefono, yape, dni, placa, referencia, color_avatar, activo)
      VALUES (@nombre, @iniciales, NULL, '', '', '', '', '', 'av-blue', 1);
      SELECT SCOPE_IDENTITY() AS id;
    `);
  return { id: r.recordset[0].id, nombre, activo: true };
}

/* Igual que POST /api/tarifas */
async function crearDistrito(tx, nombre, t) {
  const z = await new sql.Request(tx)
    .input('zona', sql.NVarChar, t.zona)
    .query(`SELECT id FROM zonas WHERE nombre = @zona`);
  if (!z.recordset.length) throw new Error(`Zona no encontrada: ${t.zona}`);
  const r = await new sql.Request(tx)
    .input('nombre',   sql.NVarChar,      nombre)
    .input('id_zona',  sql.Int,           z.recordset[0].id)
    .input('delivery', sql.Decimal(10,2), t.delivery)
    .input('moto',     sql.Decimal(10,2), t.moto)
    .query(`
      INSERT INTO distritos (nombre, id_zona, precio_delivery, pago_motorizado)
      VALUES (@nombre, @id_zona, @delivery, @moto);
      SELECT SCOPE_IDENTITY() AS id;
    `);
  return { id: r.recordset[0].id, nombre, activo: true, precio_delivery: t.delivery, pago_motorizado: t.moto };
}

/* ── Fila del Excel → columnas de la orden ───────────────────── */
const ESTADOS = { 'ENTREGADO': 'entregado', 'REPROGRAMADOS': 'reprogramado', 'CANCELADO': 'cancelado' };

const redondear = n => Math.round(n * 100) / 100;
const uno = (catalogo, nombre) => catalogo.get(normalizar(nombre))[0];

function armarOrden(r, cat, fechaAsignacion) {
  const tienda   = uno(cat.tiendas, r.tienda);
  const distrito = uno(cat.distritos, r.distrito);
  const origen   = uno(cat.origenes, r.origen || 'GAMARRA');
  const moto     = esVacio(r.motorizado) ? null : uno(cat.motorizados, r.motorizado);

  const cobrado   = redondear(Number(r.cobrado) || 0);
  const delivery  = redondear(Number(distrito.precio_delivery) || 0);
  const adicional = redondear(Number(r.montoAdicional) || 0);
  /* Pago al moto como en el formulario: tarifa del distrito + el
     adicional del Excel (puede ser negativo, se respeta tal cual) */
  const pagoMoto   = redondear(Number(distrito.pago_motorizado) || 0);
  const pagoMotoAd = normalizar(r.pagoMotoAdicSi) === 'SI' ? redondear(Number(r.pagoMotoAdic) || 0) : 0;

  const resto = cobrado - (delivery + adicional);

  /* metodo_pago = si se cobra o no; medio_pago = cómo entró la plata */
  let metodo, medio = null;
  switch (normalizar(r.metodoPago)) {
    case 'YAPE MOTORIZADO': metodo = 'contraentrega'; medio = 'yape-motorizado'; break;
    case 'PAGO TIENDA':     metodo = 'contraentrega'; medio = 'pago-tienda';     break;
    case 'SIN COBRO':       metodo = 'sin-cobro'; break;
    default:                metodo = cobrado > 0 ? 'contraentrega' : 'sin-cobro';
  }

  const obs = [];
  if (normalizar(r.reprogramadoParaHoy) === 'SI') obs.push('Reprogramado para hoy');
  else if (!esVacio(r.reprogramadoParaHoy))      obs.push(String(r.reprogramadoParaHoy));
  if (normalizar(r.cambioTalla) === 'SI')         obs.push('Cambio/escoge talla');

  return {
    fecha:        r.fecha,
    id_tienda:    tienda.id,
    id_origen:    origen.id,
    id_distrito:  distrito.id,
    id_moto:      moto ? moto.id : null,
    fecha_asig:   moto ? fechaAsignacion : null,
    dest_nombre:  esVacio(r.dest) ? '' : String(r.dest),
    estado:       ESTADOS[normalizar(r.estado)],
    metodo, medio,
    delivery, adicional, cobrado,
    producto:     redondear(resto > 0 ? resto : 0),
    pagoMoto, pagoMotoAd,
    especial:     normalizar(r.productoEspecial) === 'SI',
    obs:          obs.join(' · '),
  };
}

/* Mismo INSERT que POST /api/ordenes, con lo que ese flujo completa
   después en "Actualizar orden" (estado, medio de pago) y en
   /asignar (fecha_asignacion) puesto de una vez */
async function insertarOrden(tx, codigo, o) {
  const r = await new sql.Request(tx)
    .input('codigo',       sql.NVarChar,      codigo)
    .input('fecha',        sql.Date,          o.fecha)
    .input('id_tienda',    sql.Int,           o.id_tienda)
    .input('id_origen',    sql.Int,           o.id_origen)
    .input('id_distrito',  sql.Int,           o.id_distrito)
    .input('id_moto',      sql.Int,           o.id_moto)
    .input('fecha_asig',   sql.Date,          o.fecha_asig)
    .input('dest_nombre',  sql.NVarChar,      o.dest_nombre)
    .input('estado',       sql.NVarChar,      o.estado)
    .input('metodo',       sql.NVarChar,      o.metodo)
    .input('medio',        sql.NVarChar,      o.medio)
    .input('delivery',     sql.Decimal(10,2), o.delivery)
    .input('adicional',    sql.Decimal(10,2), o.adicional)
    .input('cobrado',      sql.Decimal(10,2), o.cobrado)
    .input('producto',     sql.Decimal(10,2), o.producto)
    .input('pago_moto',    sql.Decimal(10,2), o.pagoMoto)
    .input('pago_moto_ad', sql.Decimal(10,2), o.pagoMotoAd)
    .input('especial',     sql.Bit,           o.especial ? 1 : 0)
    .input('obs',          sql.NVarChar,      o.obs)
    .query(`
      INSERT INTO ordenes (
        codigo, fecha, hora_asignacion, fecha_asignacion,
        id_tienda, id_origen, id_distrito, id_motorizado,
        dest_nombre, dest_telefono, dest_telefono_2, dest_direccion,
        estado, condicion_especial, pago_velox, pago_velox_metodo, metodo_pago, medio_pago,
        delivery_base, monto_adicional, monto_cobrado, monto_producto,
        pago_moto_base, pago_moto_adicional,
        producto_especial, observaciones
      ) VALUES (
        @codigo, @fecha, NULL, @fecha_asig,
        @id_tienda, @id_origen, @id_distrito, @id_moto,
        @dest_nombre, '', '', '',
        @estado, NULL, 'PENDIENTE', NULL, @metodo, @medio,
        @delivery, @adicional, @cobrado, @producto,
        @pago_moto, @pago_moto_ad,
        @especial, @obs
      );
      SELECT SCOPE_IDENTITY() AS id;
    `);
  return r.recordset[0].id;
}

async function importar(pool, filas, cat, faltan, fechaAsignacion, forzar) {
  /* Antes de abrir la transacción: lo que no se puede crear solo */
  for (const nombre of faltan.distritos.keys()) {
    if (!DISTRITOS_NUEVOS[normalizar(nombre)]) {
      throw new Error(`Falta el distrito "${nombre}" y no tiene tarifa en DISTRITOS_NUEVOS: agregalo ahí primero.`);
    }
  }
  if (faltan.origenes.size) throw new Error(`Faltan orígenes: ${[...faltan.origenes.keys()].join(', ')}`);
  for (const mapa of [faltan.tiendas, faltan.distritos, faltan.motorizados]) {
    for (const nombre of mapa.keys()) {
      if (normalizar(nombre) === COMODIN_SIN_DEFINIR) throw new Error('El Excel usa "SIN DEFINIR": corregí esas filas.');
    }
  }

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    /* Bloquea ordenes hasta el final: nadie calcula un código C-xxxx
       mientras tanto, y si corre dos veces la segunda espera */
    const previas = await new sql.Request(tx)
      .input('dia', sql.Date, fechaAsignacion)
      .query(`
        SELECT COUNT(*) AS n FROM ordenes WITH (TABLOCKX, HOLDLOCK)
        WHERE fecha = @dia OR fecha_asignacion = @dia
      `);
    if (previas.recordset[0].n > 0 && !forzar) {
      throw new Error(`Ya hay ${previas.recordset[0].n} órdenes del ${fechaAsignacion}: ¿ya se importó? (--forzar para importar igual)`);
    }

    const creados = { tiendas: [], motorizados: [], distritos: [] };
    for (const nombre of faltan.tiendas.keys()) {
      const t = await crearTienda(tx, nombre);
      cat.tiendas.set(normalizar(nombre), [t]); creados.tiendas.push(`${nombre} (id ${t.id})`);
    }
    for (const nombre of faltan.motorizados.keys()) {
      const m = await crearMotorizado(tx, nombre);
      cat.motorizados.set(normalizar(nombre), [m]); creados.motorizados.push(`${nombre} (id ${m.id})`);
    }
    for (const nombre of faltan.distritos.keys()) {
      const d = await crearDistrito(tx, nombre, DISTRITOS_NUEVOS[normalizar(nombre)]);
      cat.distritos.set(normalizar(nombre), [d]); creados.distritos.push(`${nombre} (id ${d.id})`);
    }

    /* Mismo cálculo de código que insertarConCodigoNuevo (MAX + 1) */
    const cod = await new sql.Request(tx).query(`
      SELECT ISNULL(MAX(CAST(SUBSTRING(codigo,3,LEN(codigo)) AS INT)),1000) AS ultimo
      FROM ordenes WHERE codigo LIKE 'C-%'
    `);
    let siguiente = cod.recordset[0].ultimo + 1;

    let insertadas = 0;
    for (const r of filas) {
      try {
        await insertarOrden(tx, `C-${siguiente++}`, armarOrden(r, cat, fechaAsignacion));
        insertadas++;
      } catch (err) {
        throw new Error(`Fila ${r.filaExcel} del Excel: ${err.message}`);
      }
    }

    await tx.commit();
    console.log('\n✅ Importación terminada');
    for (const [k, lista] of Object.entries(creados)) {
      console.log(`   ${k} creados (${lista.length}): ${lista.join(', ') || '—'}`);
    }
    console.log(`   órdenes insertadas: ${insertadas}`);
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw new Error(`${err.message}\n   (se deshizo todo: no se creó ni insertó nada)`);
  }
}

async function main() {
  const [ruta, ...flags] = process.argv.slice(2);
  if (!ruta) throw new Error('Uso: node scripts/importar-ordenes-excel.js "<ruta.xlsx>" [--insertar --fecha-asignacion=YYYY-MM-DD]');

  const filas = leerExcel(ruta);
  const pool  = await getPool();
  const cat   = await cargarCatalogos(pool);
  const resultado = validar(filas, cat);
  imprimirValidacion(filas, resultado);

  if (flags.includes('--insertar')) {
    const arg = flags.find(f => f.startsWith('--fecha-asignacion='));
    const fechaAsignacion = arg && arg.split('=')[1];
    if (!fechaAsignacion || !/^\d{4}-\d{2}-\d{2}$/.test(fechaAsignacion)) {
      throw new Error('Con --insertar hay que indicar --fecha-asignacion=YYYY-MM-DD (el día de reparto).');
    }
    await importar(pool, filas, cat, resultado.faltan, fechaAsignacion, flags.includes('--forzar'));
  }
}

/* Exportado para poder comparar una base ya importada contra lo que
   calcularía el script (sin correr main) */
module.exports = { leerExcel, cargarCatalogos, armarOrden, normalizar, crearMotorizado };

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(err => { console.error('\n❌', err.message); process.exit(1); });
}
