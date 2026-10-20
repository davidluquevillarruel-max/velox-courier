/* ============================================================
   cola-fotos.js — Cola de subida de fotos (señal inestable)
   Pensado para el motorizado en la calle: la foto se guarda
   PRIMERO en el teléfono (IndexedDB) y recién después se intenta
   subir. Si no hay señal, queda en la cola y se reintenta sola.

   Cuándo se intenta subir:
     · Apenas se encola.
     · Cuando el navegador avisa que volvió la conexión ('online').
     · Cuando la app vuelve a primer plano (se desbloqueó el
       teléfono o se volvió desde otra app).
     · Al abrir Velox de nuevo (si se había cerrado el navegador).
     · Con reintentos programados mientras la app está abierta
       (5 s, 15 s, 30 s, 60 s y después cada 2 min).

   Límite honesto: con la pantalla bloqueada o el navegador cerrado
   el JavaScript no corre, así que la foto NO sube en ese momento;
   queda guardada y sale en cuanto la app vuelve a estar activa.

   No duplica: cada foto lleva un idSubida (UUID) que el servidor
   reconoce si un reintento llega después de que la foto ya se
   guardó (ver velox_agregar_id_subida.sql).

   Sirve igual con R2 o en MODO PRUEBA: en cada intento pide una
   URL firmada nueva (vencen a los 5 min, no se guardan) y, si R2
   no está configurado (503), manda los bytes al disco local.

   Foto en ráfaga (encolarFotoRafaga): la foto entra a la cola SIN
   orden todavía. Al procesarla, la cola primero crea la orden
   (POST /ordenes/rafaga) y recién después sube la foto. El orden de
   la cola se respeta, así que los códigos salen en el orden en que
   se tomaron las fotos. Tampoco duplica la orden: cada foto lleva un
   idCreacion (UUID) que el servidor reconoce si el reintento llega
   después de que la orden ya se creó (ver velox_agregar_rafaga.sql).

   Avisa a la interfaz con tres eventos en window:
     · 'velox:cola-fotos'  → cambió la cola (detail: { pendientes, errores })
     · 'velox:foto-subida' → una foto llegó al servidor
                             (detail: { idSubida, ordenId, tipo, url })
     · 'velox:orden-rafaga-creada' → la cola creó la orden de una foto
                             en ráfaga (detail: { idSubida, ordenId, codigo })
   ============================================================ */

var API = '/api';

var _COLA_DB          = 'velox_cola_fotos';
var _COLA_STORE       = 'fotos';
var _COLA_ESPERAS     = [5, 15, 30, 60, 120];  /* segundos entre reintentos */
var _COLA_TIMEOUT_JSON = 30000;  /* pedidos chicos (URL firmada, registrar) */
var _COLA_TIMEOUT_FOTO = 90000;  /* subir los bytes con señal mala */

/* Errores del servidor que no se arreglan reintentando: la orden ya
   no es del motorizado, no existe, la foto vino mal, etc. */
var _COLA_ESTADOS_PERMANENTES = [400, 403, 404, 409, 413, 415];

var _colaDbPromesa    = null;
var _colaMemoria      = new Map();  /* respaldo si IndexedDB falla */
var _colaProcesando   = false;
var _colaOtraPasada   = false;
var _colaOtraForzada  = false;
var _colaTimer        = null;
var _colaPausaHasta   = 0;          /* sin señal: no insistir antes de esto */
var _colaPersistenciaPedida = false;

/* ── Almacenamiento (IndexedDB, con respaldo en memoria) ───── */

function _colaAbrirDB() {
  if (_colaDbPromesa) return _colaDbPromesa;
  _colaDbPromesa = new Promise(function(resolve, reject) {
    if (!window.indexedDB) return reject(new Error('IndexedDB no disponible'));
    var req = indexedDB.open(_COLA_DB, 1);
    req.onupgradeneeded = function() {
      req.result.createObjectStore(_COLA_STORE, { keyPath: 'idSubida' });
    };
    req.onsuccess = function() {
      var db = req.result;
      /* Si el navegador cierra la conexión, la próxima vez se reabre */
      db.onclose = function() { _colaDbPromesa = null; };
      db.onversionchange = function() { db.close(); _colaDbPromesa = null; };
      resolve(db);
    };
    req.onerror = function() { reject(req.error || new Error('No se pudo abrir IndexedDB')); };
  }).catch(function(err) {
    console.warn('Cola de fotos: sin IndexedDB, las fotos quedan solo en memoria.', err && err.message);
    return null;
  });
  return _colaDbPromesa;
}

/* Corre una operación sobre el store y resuelve con su resultado
   recién cuando la transacción terminó (o sea, ya está en disco) */
function _colaOperar(db, modo, fn) {
  return new Promise(function(resolve, reject) {
    var tx  = db.transaction(_COLA_STORE, modo);
    var req = fn(tx.objectStore(_COLA_STORE));
    tx.oncomplete = function() { resolve(req ? req.result : undefined); };
    tx.onerror = tx.onabort = function() { reject(tx.error || new Error('Error de IndexedDB')); };
  });
}

/* Guarda (o actualiza) un ítem. Devuelve true si quedó en el
   teléfono, false si solo quedó en memoria (se pierde al cerrar). */
async function _colaGuardar(item) {
  if (!item.enMemoria) {
    var db = await _colaAbrirDB();
    if (db) {
      try {
        await _colaOperar(db, 'readwrite', function(s) { return s.put(item); });
        return true;
      } catch (err) {
        console.warn('Cola de fotos: no se pudo guardar en el teléfono.', err && err.message);
      }
    }
  }
  item.enMemoria = true;
  _colaMemoria.set(item.idSubida, item);
  return false;
}

async function _colaLeerTodas() {
  var items = [];
  var db = await _colaAbrirDB();
  if (db) {
    try {
      items = await _colaOperar(db, 'readonly', function(s) { return s.getAll(); }) || [];
    } catch (err) {
      console.warn('Cola de fotos: no se pudo leer la cola.', err && err.message);
    }
  }
  _colaMemoria.forEach(function(item) { items.push(item); });
  return items;
}

async function _colaBorrar(idSubida) {
  _colaMemoria.delete(idSubida);
  var db = await _colaAbrirDB();
  if (db) await _colaOperar(db, 'readwrite', function(s) { return s.delete(idSubida); });
}

/* ── Utilidades ────────────────────────────────────────────── */

function _colaUsuarioActual() {
  try {
    var u = JSON.parse(localStorage.getItem('velox_usuario'));
    return (u && u.id) ? u.id : null;
  } catch (e) { return null; }
}

/* UUID v4. crypto.randomUUID solo existe en HTTPS/localhost; al
   probar desde el celular por IP de la red local se arma a mano */
function _colaNuevoId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  var b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  var h = Array.prototype.map.call(b, function(x) { return (x + 0x100).toString(16).slice(1); }).join('');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
}

/* fetch con tiempo máximo: con señal mala un pedido puede quedar
   colgado para siempre sin fallar nunca */
function _colaFetch(url, opciones, timeoutMs) {
  var ctrl = new AbortController();
  var t = setTimeout(function() { ctrl.abort(); }, timeoutMs);
  opciones.signal = ctrl.signal;
  return fetch(url, opciones).then(
    function(res) { clearTimeout(t); return res; },
    function(err) {
      clearTimeout(t);
      throw new Error(err && err.name === 'AbortError' ? 'Sin respuesta (señal débil)' : 'Sin conexión');
    }
  );
}

async function _colaErrorHttp(res, mensaje) {
  var data = await res.json().catch(function() { return {}; });
  var err = new Error(data.error || (mensaje + ' (' + res.status + ')'));
  err.status = res.status;
  err.permanente = _COLA_ESTADOS_PERMANENTES.indexOf(res.status) !== -1;
  return err;
}

/* ── Subida de una foto ────────────────────────────────────────
   El mismo camino que tenía _subirFotoProducto (js/pedidos.js),
   generalizado a los dos tipos de foto y con idSubida. */
async function _colaSubir(item) {
  var blob = new Blob([item.datos], { type: 'image/jpeg' });
  var base = API + '/ordenes/' + item.ordenId;

  var rPre = await _colaFetch(base + '/evidencia/presigned', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType: 'image/jpeg', tipo: item.tipo, idSubida: item.idSubida }),
  }, _COLA_TIMEOUT_JSON);

  if (rPre.ok) {
    var pre = await rPre.json();

    /* Sin credentials: R2 no es nuestro servidor. Si falla (incluso
       por firma vencida) se reintenta: cada intento pide una nueva */
    var rPut = await _colaFetch(pre.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: blob,
      credentials: 'omit',
    }, _COLA_TIMEOUT_FOTO);
    if (!rPut.ok) throw new Error('El almacenamiento rechazó la foto (' + rPut.status + ')');

    var rReg = await _colaFetch(base + '/foto/registrar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: pre.publicUrl, tipo: item.tipo, idSubida: item.idSubida }),
    }, _COLA_TIMEOUT_JSON);
    if (!rReg.ok) throw await _colaErrorHttp(rReg, 'No se pudo asociar la foto a la orden');
    return await rReg.json();
  }

  /* 503 = R2 sin configurar todavía → modo prueba (disco local) */
  if (rPre.status !== 503) throw await _colaErrorHttp(rPre, 'No se pudo preparar la subida');

  var rLocal = await _colaFetch(base + '/foto/local?tipo=' + encodeURIComponent(item.tipo) +
    '&idSubida=' + encodeURIComponent(item.idSubida), {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg' },
    body: blob,
  }, _COLA_TIMEOUT_FOTO);
  if (!rLocal.ok) throw await _colaErrorHttp(rLocal, 'No se pudo guardar la foto');
  return await rLocal.json();
}

/* ── Creación de la orden de una foto en ráfaga ────────────────
   Si la respuesta se pierde, el próximo intento manda el mismo
   idCreacion y el servidor devuelve la orden que ya había creado. */
async function _colaCrearOrdenRafaga(item) {
  var r = await _colaFetch(API + '/ordenes/rafaga', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idCreacion: item.rafaga.idCreacion,
      fecha:      item.rafaga.fecha,
      hora:       item.rafaga.hora,
    }),
  }, _COLA_TIMEOUT_JSON);
  if (!r.ok) throw await _colaErrorHttp(r, 'No se pudo crear la orden de la foto');
  var data = await r.json();

  /* Se guarda ya: si la subida de la foto falla, el reintento va
     directo a subirla (sin volver a pedir la orden) */
  item.ordenId     = parseInt(data.id, 10);
  item.codigoOrden = data.codigo || '';
  await _colaGuardar(item);

  window.dispatchEvent(new CustomEvent('velox:orden-rafaga-creada', {
    detail: { idSubida: item.idSubida, ordenId: item.ordenId, codigo: item.codigoOrden },
  }));
}

/* ── Procesamiento de la cola ──────────────────────────────── */

function _colaEsperaMs(intentos) {
  var i = Math.min(Math.max(intentos - 1, 0), _COLA_ESPERAS.length - 1);
  return _COLA_ESPERAS[i] * 1000;
}

/* Solo las fotos del usuario con sesión: si el teléfono se comparte,
   las fotos de otro motorizado esperan a que él vuelva a entrar */
async function _colaDelUsuario() {
  var usuario = _colaUsuarioActual();
  if (!usuario) return [];
  var todas = await _colaLeerTodas();
  return todas
    .filter(function(it) { return it.idUsuario === usuario; })
    .sort(function(a, b) { return a.creada - b.creada; });
}

async function _colaNotificarCambio() {
  var items = await _colaDelUsuario();
  var pendientes = items.filter(function(it) { return it.estado === 'pendiente'; }).length;
  window.dispatchEvent(new CustomEvent('velox:cola-fotos', {
    detail: { pendientes: pendientes, errores: items.length - pendientes },
  }));
}

function _colaProgramar(items) {
  clearTimeout(_colaTimer);
  _colaTimer = null;
  var proximos = items
    .filter(function(it) { return it.estado === 'pendiente'; })
    .map(function(it) { return Math.max(it.proximoIntento || 0, _colaPausaHasta); });
  if (!proximos.length) return;
  var espera = Math.max(Math.min.apply(null, proximos) - Date.now(), 1000);
  _colaTimer = setTimeout(function() { procesarColaFotos(); }, espera);
}

/* Una pasada por la cola, de a una foto (con señal mala, subir
   varias a la vez solo hace que fallen todas).
   forzar = ignorar las esperas (volvió la señal / volvió la app). */
async function _colaPasada(forzar) {
  if (forzar) _colaPausaHasta = 0;
  var items = await _colaDelUsuario();

  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (item.estado !== 'pendiente') continue;
    if (!forzar && Math.max(item.proximoIntento || 0, _colaPausaHasta) > Date.now()) continue;

    try {
      if (!item.ordenId && item.rafaga) await _colaCrearOrdenRafaga(item);
      var res = await _colaSubir(item);
      await _colaBorrar(item.idSubida);
      window.dispatchEvent(new CustomEvent('velox:foto-subida', {
        detail: { idSubida: item.idSubida, ordenId: item.ordenId, tipo: item.tipo, url: res.url },
      }));
    } catch (err) {
      /* 401: el interceptor de utils.js ya manda al login. La foto
         no se toca y sigue cuando vuelva a iniciar sesión. */
      if (err.status === 401) return;

      item.intentos = (item.intentos || 0) + 1;
      item.ultimoError = err.message || 'Error desconocido';
      if (err.permanente) {
        /* No se reintenta sola: queda a la vista para reintentar a
           mano o descartar (ver reintentarColaFotos / descartarFotoEnCola) */
        item.estado = 'error';
        await _colaGuardar(item);
        continue;
      }
      /* Sin señal: tampoco tiene sentido probar las que siguen ahora */
      item.proximoIntento = Date.now() + _colaEsperaMs(item.intentos);
      _colaPausaHasta = item.proximoIntento;
      await _colaGuardar(item);
      return;
    }
  }
}

/* Corre una pasada, sin pisarse con otra de esta pestaña ni (si el
   navegador soporta Web Locks) con otra pestaña de Velox abierta.
   Si llega un pedido mientras hay una pasada en curso, se encadena
   otra al terminar para no perder la foto recién encolada. */
async function procesarColaFotos(opciones) {
  var forzar = !!(opciones && opciones.forzar);
  if (!_colaUsuarioActual()) return;

  if (_colaProcesando) {
    _colaOtraPasada  = true;
    _colaOtraForzada = _colaOtraForzada || forzar;
    return;
  }
  _colaProcesando = true;
  clearTimeout(_colaTimer);

  try {
    if (navigator.locks && navigator.locks.request) {
      await navigator.locks.request('velox-cola-fotos', { ifAvailable: true }, function(lock) {
        return lock ? _colaPasada(forzar) : null;
      });
    } else {
      await _colaPasada(forzar);
    }
  } catch (err) {
    console.error('Cola de fotos:', err);
  } finally {
    _colaProcesando = false;
    var items = await _colaDelUsuario().catch(function() { return []; });
    _colaProgramar(items);
    _colaNotificarCambio();
    if (_colaOtraPasada) {
      var f = _colaOtraForzada;
      _colaOtraPasada = _colaOtraForzada = false;
      procesarColaFotos({ forzar: f });
    }
  }
}

/* ── API pública ───────────────────────────────────────────── */

/**
 * Guarda la foto en el teléfono y la pone en la cola de subida.
 * @param {number} ordenId - La orden ya tiene que existir en el servidor.
 * @param {string} tipo    - 'foto_producto' o 'evidencia_medio_pago'.
 * @param {Blob}   blob    - JPEG ya comprimido (comprimirImagenJPEG).
 * @param {string} [codigoOrden] - Código visible (ej. "C-1234"), solo para
 *   mostrarlo en el indicador (js/indicador-fotos.js). Opcional.
 * @returns {Promise<{idSubida: string, persistente: boolean}>}
 *   persistente = false si no se pudo guardar en el teléfono (solo
 *   quedó en memoria: si se cierra la app antes de subir, se pierde).
 */
async function encolarFoto(ordenId, tipo, blob, codigoOrden) {
  var item = await _colaNuevoItem(ordenId, tipo, blob, codigoOrden);
  return _colaAgregar(item);
}

/**
 * Foto en ráfaga: guarda la foto en el teléfono SIN orden todavía.
 * La cola crea la orden (sin datos, "Por completar") y después sube
 * la foto, todo en segundo plano. No espera a la red: se puede
 * llamar una vez por foto, seguido, aunque no haya señal.
 * @param {Blob} blob - JPEG ya comprimido.
 * @param {{fecha: string, hora: string}} momento - Cuándo se tomó
 *   la foto ('YYYY-MM-DD' y 'HH:MM', hora local del teléfono).
 * @returns {Promise<{idSubida: string, persistente: boolean}>}
 */
async function encolarFotoRafaga(blob, momento) {
  var item = await _colaNuevoItem(null, 'foto_producto', blob, '');
  item.rafaga = {
    idCreacion: _colaNuevoId(),
    fecha:      momento && momento.fecha,
    hora:       momento && momento.hora,
  };
  return _colaAgregar(item);
}

/* Arma un ítem de la cola (compartido por encolarFoto y encolarFotoRafaga) */
async function _colaNuevoItem(ordenId, tipo, blob, codigoOrden) {
  /* Pedir que el navegador no borre la cola si el teléfono se
     queda sin espacio. Puede decir que no; no es bloqueante. */
  if (!_colaPersistenciaPedida && navigator.storage && navigator.storage.persist) {
    _colaPersistenciaPedida = true;
    navigator.storage.persist().catch(function() {});
  }

  return {
    idSubida:       _colaNuevoId(),
    idUsuario:      _colaUsuarioActual(),
    ordenId:        ordenId ? parseInt(ordenId, 10) : null,
    codigoOrden:    codigoOrden || '',
    tipo:           tipo,
    /* ArrayBuffer y no Blob: algunos Safari viejos no guardan Blobs
       en IndexedDB (y tampoco tienen blob.arrayBuffer(), por eso Response) */
    datos:          await new Response(blob).arrayBuffer(),
    creada:         Date.now(),
    intentos:       0,
    proximoIntento: 0,
    estado:         'pendiente',
    ultimoError:    '',
  };
}

async function _colaAgregar(item) {
  var persistente = await _colaGuardar(item);
  /* Avisar ya (el indicador de js/indicador-fotos.js la muestra al
     instante), sin esperar a que termine el intento de subida */
  _colaNotificarCambio();
  procesarColaFotos();  /* sin await: la subida sigue en segundo plano */
  return { idSubida: item.idSubida, persistente: persistente };
}

/* Fotos en cola del usuario actual, sin los bytes (para mostrarlas) */
async function obtenerColaFotos() {
  var items = await _colaDelUsuario();
  return items.map(function(it) {
    return {
      idSubida: it.idSubida, ordenId: it.ordenId, codigoOrden: it.codigoOrden || '', tipo: it.tipo, estado: it.estado,
      intentos: it.intentos, ultimoError: it.ultimoError, creada: it.creada,
      enMemoria: !!it.enMemoria,
      /* Foto en ráfaga: true mientras la orden todavía no se creó */
      ordenPorCrear: !!it.rafaga && !it.ordenId,
      esRafaga: !!it.rafaga,
    };
  });
}

/* Botón "Reintentar ahora": también vuelve a probar las que
   quedaron con error. Con idSubida, reintenta solo esa foto (botón
   "Reintentar" de cada foto con error en js/indicador-fotos.js). */
async function reintentarColaFotos(idSubida) {
  var items = await _colaDelUsuario();
  for (var i = 0; i < items.length; i++) {
    if (idSubida && items[i].idSubida !== idSubida) continue;
    if (items[i].estado === 'error' || items[i].proximoIntento) {
      items[i].estado = 'pendiente';
      items[i].proximoIntento = 0;
      await _colaGuardar(items[i]);
    }
  }
  return procesarColaFotos({ forzar: true });
}

async function descartarFotoEnCola(idSubida) {
  await _colaBorrar(idSubida);
  _colaNotificarCambio();
}

/* ── Disparadores ──────────────────────────────────────────── */
(function _colaIniciar() {
  window.addEventListener('online', function() { procesarColaFotos({ forzar: true }); });

  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') procesarColaFotos({ forzar: true });
  });

  /* Al abrir Velox: retomar lo que quedó de antes. Con un pequeño
     margen para no competir con la carga inicial de la página. */
  setTimeout(function() { procesarColaFotos({ forzar: true }); }, 1500);
})();
