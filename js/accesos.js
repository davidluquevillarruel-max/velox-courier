/* ============================================================
   accesos.js — Crear usuarios de acceso en masa (tiendas y motorizados)
   Un solo flujo para los dos catálogos:
     1. Lista las tiendas / motorizados ACTIVOS sin usuario
        (GET /auth/tiendas-libres o /auth/motorizados-libres: "sin
        usuario" se decide por el vínculo id_tienda / id_motorizado, no
        por el correo), con casillas para elegir.
     2. Crea cada usuario con POST /auth/usuarios (el mismo endpoint del
        alta individual): correo armado con el nombre (con un número si
        ya está tomado) y contraseña ALEATORIA y fuerte.
     3. Muestra correo y contraseña UNA sola vez, con "Copiar" y
        "Descargar CSV" para entregarlas. No se guardan en ningún lado:
        al cerrar la ventana se pierden (en la BD queda solo el hash).
   Lo usan el catálogo de tiendas (js/tiendas.js: "Crear accesos" y
   "Crear acceso" de cada fila) y la página Usuarios (js/usuarios.js:
   motorizados). Solo admin (el servidor lo exige).

   resetearAccesos() deja listo el reseteo en masa de contraseñas
   (Fase 4: los usuarios de tienda viejos tienen contraseña de fórmula):
   misma pantalla de resultados, con PATCH /auth/usuarios/:id/password.
   ============================================================ */

var _ACC_MAYUS   = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   /* sin I ni O */
var _ACC_MINUS   = 'abcdefghijkmnpqrstuvwxyz';   /* sin l */
var _ACC_DIGITOS = '23456789';                   /* sin 0 ni 1 */
var _ACC_SIMBOLOS = '!#$%*+?';                   /* aceptados por passwordEsFuerte */
var _ACC_LARGO   = 12;

var _accFilas      = [];     /* { id, nombre, email, elegida } del paso 1 */
var _accResultados = [];     /* { nombre, email, password, ok, error } del paso 3 */
var _accTipo       = null;   /* 'tienda' | 'motorizado' | 'reseteo' */
var _accEntregado  = false;  /* ya se copió o descargó */
var _accTrabajando = false;
var _accAlTerminar = null;

function _escAcc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* Entero al azar en [0, n) con el generador criptográfico del navegador */
function _azarAcc(n) {
  var buf = new Uint32Array(1);
  var limite = Math.floor(0x100000000 / n) * n;   /* sin sesgo */
  do { crypto.getRandomValues(buf); } while (buf[0] >= limite);
  return buf[0] % n;
}

/* Contraseña aleatoria: al menos una mayúscula, minúscula, dígito y
   símbolo; sin caracteres que se confunden al dictarla (0/O, 1/l/I) */
function generarPasswordSegura() {
  var todos = _ACC_MAYUS + _ACC_MINUS + _ACC_DIGITOS + _ACC_SIMBOLOS;
  var chars = [
    _ACC_MAYUS[_azarAcc(_ACC_MAYUS.length)],
    _ACC_MINUS[_azarAcc(_ACC_MINUS.length)],
    _ACC_DIGITOS[_azarAcc(_ACC_DIGITOS.length)],
    _ACC_SIMBOLOS[_azarAcc(_ACC_SIMBOLOS.length)],
  ];
  while (chars.length < _ACC_LARGO) chars.push(todos[_azarAcc(todos.length)]);
  for (var i = chars.length - 1; i > 0; i--) {   /* Fisher-Yates */
    var j = _azarAcc(i + 1);
    var t = chars[i]; chars[i] = chars[j]; chars[j] = t;
  }
  return chars.join('');
}

/* "Moda Perú S.A.C." → "modaperusac" */
function _prefijoCorreoAcc(nombre) {
  return String(nombre || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .substring(0, 30);
}

/* Correo libre: el prefijo, o prefijo2, prefijo3... si ya está tomado */
function _correoLibreAcc(nombre, respaldo, tomados) {
  var base = _prefijoCorreoAcc(nombre) || respaldo;
  var email = base + '@velox.pe';
  for (var n = 2; tomados.has(email); n++) email = base + n + '@velox.pe';
  tomados.add(email);
  return email;
}

/* ── Ventana ───────────────────────────────────────────────── */

function _overlayAcc() {
  var ov = document.getElementById('accesos-overlay');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.id = 'accesos-overlay';
  ov.className = 'accesos-overlay';
  document.body.appendChild(ov);
  return ov;
}

function _pintarAcc(titulo, cuerpo, pie) {
  _overlayAcc().innerHTML =
    '<div class="accesos-panel">' +
      '<div class="accesos-head">' +
        '<span class="accesos-titulo">' + titulo + '</span>' +
        '<button type="button" class="accesos-cerrar" onclick="cerrarAccesos()" title="Cerrar"><i class="ti ti-x"></i></button>' +
      '</div>' +
      '<div class="accesos-cuerpo">' + cuerpo + '</div>' +
      '<div class="accesos-pie">' + pie + '</div>' +
    '</div>';
  _overlayAcc().style.display = 'flex';
}

/**
 * Abre "Crear accesos".
 * @param {'tienda'|'motorizado'} tipo
 * @param {Array<number>} [soloIds] - Para crear el de una sola fila
 *        (botón "Crear acceso" del catálogo).
 * @param {function} [alTerminar] - Se llama al cerrar, si se creó alguno.
 */
window.abrirCrearAccesos = async function(tipo, soloIds, alTerminar) {
  _accTipo = tipo;
  _accFilas = [];
  _accResultados = [];
  _accEntregado = false;
  _accTrabajando = false;
  _accAlTerminar = alTerminar || null;
  var titulo = tipo === 'tienda' ? 'Crear accesos de tiendas' : 'Crear accesos de motorizados';
  _pintarAcc(titulo, '<div class="accesos-ayuda"><i class="ti ti-loader"></i> Buscando quiénes no tienen usuario...</div>', '');

  var libres, usuarios;
  try {
    var r = await Promise.all([
      fetch(API + (tipo === 'tienda' ? '/auth/tiendas-libres' : '/auth/motorizados-libres')),
      fetch(API + '/auth/usuarios'),
    ]);
    if (!r[0].ok || !r[1].ok) throw new Error('El servidor no respondió bien');
    libres = await r[0].json();
    usuarios = await r[1].json();
  } catch (err) {
    _pintarAcc(titulo, '<div class="accesos-error">No se pudo cargar la lista: ' + _escAcc(err.message) + '</div>',
      '<button class="btn btn-sm" onclick="cerrarAccesos()">Cerrar</button>');
    return;
  }

  if (soloIds && soloIds.length) {
    libres = libres.filter(function(x) { return soloIds.indexOf(x.id) !== -1; });
  }
  var tomados = new Set(usuarios.map(function(u) { return String(u.email || '').toLowerCase(); }));
  _accFilas = libres.map(function(x) {
    return { id: x.id, nombre: x.nombre, email: _correoLibreAcc(x.nombre, tipo + x.id, tomados), elegida: true };
  });

  if (!_accFilas.length) {
    _pintarAcc(titulo,
      '<div class="accesos-ayuda"><i class="ti ti-circle-check"></i> ' +
        (soloIds ? 'Ya tiene usuario de acceso (o está inactiva).' :
          tipo === 'tienda' ? 'Todas las tiendas activas ya tienen usuario de acceso.' : 'Todos los motorizados activos ya tienen usuario de acceso.') +
      '</div>',
      '<button class="btn btn-sm" onclick="cerrarAccesos()">Cerrar</button>');
    return;
  }
  _pintarListaAcc();
};

function _pintarListaAcc() {
  var titulo = _accTipo === 'tienda' ? 'Crear accesos de tiendas' : 'Crear accesos de motorizados';
  var elegidas = _accFilas.filter(function(f) { return f.elegida; }).length;
  var cuerpo =
    '<div class="accesos-ayuda">' +
      (_accFilas.length === 1
        ? 'Se va a crear este usuario con una contraseña aleatoria.'
        : _accFilas.length + (_accTipo === 'tienda' ? ' tiendas activas' : ' motorizados activos') + ' sin usuario. Elige a quiénes crearles acceso.') +
      ' La contraseña se genera al azar y se muestra <strong>una sola vez</strong> al terminar.' +
    '</div>' +
    '<table class="accesos-tabla"><thead><tr>' +
      '<th style="width:28px">' + (_accFilas.length > 1
        ? '<input type="checkbox" ' + (elegidas === _accFilas.length ? 'checked ' : '') + 'onchange="elegirTodasAcc(this.checked)" title="Todas">'
        : '') + '</th>' +
      '<th>' + (_accTipo === 'tienda' ? 'Tienda' : 'Motorizado') + '</th><th>Correo de acceso</th>' +
    '</tr></thead><tbody>' +
    _accFilas.map(function(f, i) {
      return '<tr>' +
        '<td><input type="checkbox" ' + (f.elegida ? 'checked ' : '') + 'onchange="elegirFilaAcc(' + i + ', this.checked)"></td>' +
        '<td>' + _escAcc(f.nombre) + '</td>' +
        '<td class="accesos-mono">' + _escAcc(f.email) + '</td>' +
      '</tr>';
    }).join('') +
    '</tbody></table>';
  var pie =
    '<button class="btn btn-sm" onclick="cerrarAccesos()">Cancelar</button>' +
    '<button class="btn btn-primary btn-sm" id="btn-accesos-crear" onclick="confirmarCrearAccesos()" ' + (elegidas ? '' : 'disabled') + '>' +
      '<i class="ti ti-user-plus"></i> Crear ' + elegidas + (elegidas === 1 ? ' acceso' : ' accesos') +
    '</button>';
  _pintarAcc(titulo, cuerpo, pie);
}

window.elegirFilaAcc = function(i, si) {
  _accFilas[i].elegida = si;
  _pintarListaAcc();
};
window.elegirTodasAcc = function(si) {
  _accFilas.forEach(function(f) { f.elegida = si; });
  _pintarListaAcc();
};

/* Recorre las filas de a una (el servidor hashea cada contraseña) y
   arma _accResultados. enviar(fila, password) → Promise<Response>. */
async function _procesarAcc(filas, titulo, enviar) {
  _accTrabajando = true;
  _accResultados = [];
  for (var i = 0; i < filas.length; i++) {
    _pintarAcc(titulo,
      '<div class="accesos-ayuda"><i class="ti ti-loader"></i> Procesando ' + (i + 1) + ' de ' + filas.length + '... no cierres esta ventana.</div>', '');
    var f = filas[i];
    var password = generarPasswordSegura();
    var res = { nombre: f.nombre, email: f.email, password: password, ok: false, error: '' };
    try {
      var r = await enviar(f, password);
      var data = await r.json().catch(function() { return {}; });
      res.ok = r.ok && !!data.ok;
      if (!res.ok) res.error = data.error || ('Error ' + r.status);
    } catch (err) {
      res.error = 'Sin conexión';
    }
    if (!res.ok) res.password = '';
    _accResultados.push(res);
  }
  _accTrabajando = false;
  _pintarResultadosAcc(titulo);
}

window.confirmarCrearAccesos = function() {
  var filas = _accFilas.filter(function(f) { return f.elegida; });
  if (!filas.length) return;
  var rol = _accTipo;
  _procesarAcc(filas, _accTipo === 'tienda' ? 'Crear accesos de tiendas' : 'Crear accesos de motorizados', function(f, password) {
    var cuerpo = { nombre: f.nombre, email: f.email, password: password, rol: rol };
    if (rol === 'tienda') cuerpo.id_tienda = f.id; else cuerpo.id_motorizado = f.id;
    return fetch(API + '/auth/usuarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
  });
};

/**
 * Fase 4 (todavía sin botón): resetea la contraseña de varios usuarios
 * a una aleatoria y muestra el mismo resultado (una sola vez, Copiar /
 * CSV). usuarios = [{ id, nombre, email }] (ej. de GET /auth/usuarios).
 */
window.resetearAccesos = function(usuarios, alTerminar) {
  _accTipo = 'reseteo';
  _accEntregado = false;
  _accAlTerminar = alTerminar || null;
  _procesarAcc(usuarios, 'Resetear contraseñas', function(u, password) {
    return fetch(API + '/auth/usuarios/' + u.id + '/password', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password }),
    });
  });
};

function _pintarResultadosAcc(titulo) {
  var buenos = _accResultados.filter(function(r) { return r.ok; });
  var malos  = _accResultados.filter(function(r) { return !r.ok; });
  var cuerpo = '';
  if (buenos.length) {
    cuerpo +=
      '<div class="accesos-aviso"><i class="ti ti-alert-triangle"></i> ' +
        '<span><strong>Copia o descarga estas contraseñas ahora.</strong> No se guardan en ningún lado y no se vuelven a mostrar: ' +
        'si se pierden, hay que resetearlas.</span>' +
      '</div>' +
      '<table class="accesos-tabla"><thead><tr><th>Nombre</th><th>Correo</th><th>Contraseña</th></tr></thead><tbody>' +
      buenos.map(function(r) {
        return '<tr><td>' + _escAcc(r.nombre) + '</td><td class="accesos-mono">' + _escAcc(r.email) + '</td>' +
          '<td class="accesos-mono accesos-pwd">' + _escAcc(r.password) + '</td></tr>';
      }).join('') +
      '</tbody></table>';
  }
  if (malos.length) {
    cuerpo += '<div class="accesos-error"><strong>' + malos.length + ' no se pudieron procesar:</strong><br>' +
      malos.map(function(r) { return _escAcc(r.nombre) + ': ' + _escAcc(r.error); }).join('<br>') + '</div>';
  }
  var resumen = buenos.length + (_accTipo === 'reseteo' ? ' contraseña(s) reseteada(s)' : ' acceso(s) creado(s)');
  var pie =
    '<span class="accesos-resumen">' + resumen + '</span>' +
    (buenos.length
      ? '<button class="btn btn-sm" onclick="copiarAccesos(this)"><i class="ti ti-copy"></i> Copiar</button>' +
        '<button class="btn btn-sm" onclick="descargarAccesosCSV()"><i class="ti ti-download"></i> Descargar CSV</button>'
      : '') +
    '<button class="btn btn-primary btn-sm" onclick="cerrarAccesos()">Cerrar</button>';
  _pintarAcc(titulo, cuerpo, pie);
}

/* Texto para pegar en WhatsApp o en una nota: una línea por usuario */
window.copiarAccesos = async function(btn) {
  var texto = _accResultados.filter(function(r) { return r.ok; }).map(function(r) {
    return r.nombre + ' — usuario: ' + r.email + ' — contraseña: ' + r.password;
  }).join('\n');
  try {
    await navigator.clipboard.writeText(texto);
  } catch (err) {
    /* Sin permiso de portapapeles (http por IP): copia a la antigua */
    var ta = document.createElement('textarea');
    ta.value = texto;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* nada más que hacer */ }
    ta.remove();
  }
  _accEntregado = true;
  if (btn) btn.innerHTML = '<i class="ti ti-check"></i> Copiado';
};

/* CSV con BOM y ';' (Excel en Windows es-PE, igual que el export de pedidos) */
window.descargarAccesosCSV = function() {
  var celda = function(v) { return '"' + String(v).replace(/"/g, '""') + '"'; };
  var lineas = ['Nombre;Correo;Contraseña'].concat(
    _accResultados.filter(function(r) { return r.ok; }).map(function(r) {
      return [celda(r.nombre), celda(r.email), celda(r.password)].join(';');
    }));
  var blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'accesos-velox-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
  _accEntregado = true;
};

window.cerrarAccesos = function() {
  if (_accTrabajando) return;   /* a mitad de camino se perderían las contraseñas */
  var hayPasswords = _accResultados.some(function(r) { return r.ok; });
  if (hayPasswords && !_accEntregado &&
      !confirm('No copiaste ni descargaste las contraseñas. Si cierras, no se pueden volver a ver. ¿Cerrar igual?')) {
    return;
  }
  var ov = document.getElementById('accesos-overlay');
  if (ov) { ov.style.display = 'none'; ov.innerHTML = ''; }
  _accResultados = [];
  _accFilas = [];
  var cb = _accAlTerminar;
  _accAlTerminar = null;
  if (hayPasswords && typeof cb === 'function') cb();
};
