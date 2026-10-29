/* ============================================================
   accesos.js — Usuarios de acceso en masa (tiendas y motorizados)
   Dos flujos con la misma ventana:
   · CREAR (abrirCrearAccesos):
     1. Lista las tiendas / motorizados ACTIVOS sin usuario
        (GET /auth/tiendas-libres o /auth/motorizados-libres: "sin
        usuario" se decide por el vínculo id_tienda / id_motorizado, no
        por el correo), con casillas para elegir.
     2. Crea cada usuario con POST /auth/usuarios (el mismo endpoint del
        alta individual): correo armado con el nombre (con un número si
        ya está tomado) y contraseña ALEATORIA y fuerte.
   · RESETEAR (abrirResetearAccesos): lista los usuarios de tienda /
     motorizado que YA existen, se eligen, se confirma (la contraseña
     anterior deja de funcionar) y a cada uno se le pone una contraseña
     aleatoria nueva con PATCH /auth/usuarios/:id/password. No toca
     nada más del usuario (ni el correo, ni el estado, ni el vínculo).
   En los dos, al terminar se muestran correo y contraseña UNA sola vez,
   con "Copiar" y "Descargar CSV" para entregarlas. No se guardan en
   ningún lado: al cerrar la ventana se pierden (en la BD queda solo el
   hash).
   Lo usan el catálogo de tiendas (js/tiendas.js) y la página Usuarios
   (js/usuarios.js). Solo admin (el servidor lo exige).
   ============================================================ */

var _ACC_MAYUS   = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   /* sin I ni O */
var _ACC_MINUS   = 'abcdefghijkmnpqrstuvwxyz';   /* sin l */
var _ACC_DIGITOS = '23456789';                   /* sin 0 ni 1 */
var _ACC_SIMBOLOS = '!#$%*+?';                   /* aceptados por passwordEsFuerte */
var _ACC_LARGO   = 12;

/* Desde cuántas filas la lista muestra el buscador */
var _ACC_FILAS_CON_BUSCADOR = 8;

var _accFilas      = [];     /* { id, nombre, email, elegida, vinculo?, activo? } de la lista */
var _accResultados = [];     /* { nombre, email, password, ok, error } del final */
var _accTipo       = null;   /* 'tienda' | 'motorizado' | 'reseteo' */
var _accBusqueda   = '';
var _accEntregado  = false;  /* ya se copió o descargó */
var _accTrabajando = false;
var _accAlTerminar = null;

var _ACC_ROLES = { tienda: 'Tienda', motorizado: 'Motorizado' };

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

function _tituloAcc() {
  if (_accTipo === 'reseteo') return 'Resetear contraseñas';
  return _accTipo === 'tienda' ? 'Crear accesos de tiendas' : 'Crear accesos de motorizados';
}

function _empezarAcc(tipo, alTerminar) {
  _accTipo = tipo;
  _accFilas = [];
  _accResultados = [];
  _accBusqueda = '';
  _accEntregado = false;
  _accTrabajando = false;
  _accAlTerminar = alTerminar || null;
}

function _avisoFinalAcc(texto) {
  _pintarAcc(_tituloAcc(), '<div class="accesos-ayuda"><i class="ti ti-circle-check"></i> ' + texto + '</div>',
    '<button class="btn btn-sm" onclick="cerrarAccesos()">Cerrar</button>');
}

function _errorCargaAcc(err) {
  _pintarAcc(_tituloAcc(), '<div class="accesos-error">No se pudo cargar la lista: ' + _escAcc(err.message) + '</div>',
    '<button class="btn btn-sm" onclick="cerrarAccesos()">Cerrar</button>');
}

/**
 * Abre "Crear accesos".
 * @param {'tienda'|'motorizado'} tipo
 * @param {Array<number>} [soloIds] - Para crear el de una sola fila
 *        (botón "Crear acceso" del catálogo).
 * @param {function} [alTerminar] - Se llama al cerrar, si se creó alguno.
 */
window.abrirCrearAccesos = async function(tipo, soloIds, alTerminar) {
  _empezarAcc(tipo, alTerminar);
  _pintarAcc(_tituloAcc(), '<div class="accesos-ayuda"><i class="ti ti-loader"></i> Buscando quiénes no tienen usuario...</div>', '');

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
    return _errorCargaAcc(err);
  }

  if (soloIds && soloIds.length) {
    libres = libres.filter(function(x) { return soloIds.indexOf(x.id) !== -1; });
  }
  var tomados = new Set(usuarios.map(function(u) { return String(u.email || '').toLowerCase(); }));
  _accFilas = libres.map(function(x) {
    return { id: x.id, nombre: x.nombre, email: _correoLibreAcc(x.nombre, tipo + x.id, tomados), elegida: true };
  });

  if (!_accFilas.length) {
    return _avisoFinalAcc(soloIds ? 'Ya tiene usuario de acceso (o está inactiva).' :
      tipo === 'tienda' ? 'Todas las tiendas activas ya tienen usuario de acceso.' : 'Todos los motorizados activos ya tienen usuario de acceso.');
  }
  _pintarListaAcc();
};

/**
 * Abre "Resetear contraseñas" (solo usuarios de tienda y motorizado).
 * @param {Object} opciones
 * @param {Array<string>} opciones.roles - ['tienda'], ['motorizado'] o los dos.
 * @param {number} [opciones.idUsuario] - Resetear solo ese usuario.
 * @param {number} [opciones.idTienda]  - Resetear el usuario de esa tienda.
 * @param {function} [alTerminar] - Se llama al cerrar, si se reseteó alguno.
 */
window.abrirResetearAccesos = async function(opciones, alTerminar) {
  opciones = opciones || {};
  var roles = opciones.roles || ['tienda', 'motorizado'];
  _empezarAcc('reseteo', alTerminar);
  _pintarAcc(_tituloAcc(), '<div class="accesos-ayuda"><i class="ti ti-loader"></i> Cargando usuarios...</div>', '');

  var usuarios;
  try {
    var r = await fetch(API + '/auth/usuarios');
    if (!r.ok) throw new Error('El servidor no respondió bien');
    usuarios = await r.json();
  } catch (err) {
    return _errorCargaAcc(err);
  }

  var uno = opciones.idUsuario != null || opciones.idTienda != null;
  _accFilas = usuarios.filter(function(u) {
    if (roles.indexOf(u.rol) === -1) return false;
    if (opciones.idUsuario != null && u.id != opciones.idUsuario) return false;
    if (opciones.idTienda != null && u.id_tienda != opciones.idTienda) return false;
    return true;
  }).map(function(u) {
    return {
      id: u.id, nombre: u.nombre, email: u.email, activo: !!u.activo,
      vinculo: (_ACC_ROLES[u.rol] || u.rol) + (u.tienda_nombre || u.motorizado_nombre ? ': ' + (u.tienda_nombre || u.motorizado_nombre) : ''),
      /* De a uno ya viene elegido; en masa se elige a mano */
      elegida: uno,
    };
  });

  if (!_accFilas.length) {
    return _avisoFinalAcc(uno ? 'No se encontró su usuario de acceso.' : 'No hay usuarios para resetear.');
  }
  _pintarListaAcc();
};

/* ── Lista con casillas (crear y resetear) ───────────────────── */

function _filasVisiblesAcc() {
  var texto = _accBusqueda.toLowerCase().trim();
  if (!texto) return _accFilas;
  return _accFilas.filter(function(f) {
    return (f.nombre + ' ' + f.email + ' ' + (f.vinculo || '')).toLowerCase().indexOf(texto) !== -1;
  });
}

function _pintarListaAcc() {
  var reseteo = _accTipo === 'reseteo';
  var ayuda;
  if (reseteo) {
    ayuda = _accFilas.length === 1
      ? 'Se le va a poner una contraseña nueva, aleatoria, a este usuario.'
      : _accFilas.length + ' usuarios. Elige a quiénes resetearles la contraseña.';
    ayuda += ' La anterior deja de funcionar. La nueva se muestra <strong>una sola vez</strong> al terminar.';
  } else {
    ayuda = (_accFilas.length === 1
      ? 'Se va a crear este usuario con una contraseña aleatoria.'
      : _accFilas.length + (_accTipo === 'tienda' ? ' tiendas activas' : ' motorizados activos') + ' sin usuario. Elige a quiénes crearles acceso.') +
      ' La contraseña se genera al azar y se muestra <strong>una sola vez</strong> al terminar.';
  }
  var buscador = _accFilas.length > _ACC_FILAS_CON_BUSCADOR
    ? '<div class="search-wrap"><i class="ti ti-search search-icon"></i>' +
        '<input id="accesos-buscar" class="search-box" style="width:100%" placeholder="Buscar..." value="' + _escAcc(_accBusqueda) + '" oninput="buscarAcc(this.value)" />' +
      '</div>'
    : '';
  var cabecera = reseteo
    ? '<th>Nombre</th><th>Vinculado a</th><th>Correo</th><th>Estado</th>'
    : '<th>' + (_accTipo === 'tienda' ? 'Tienda' : 'Motorizado') + '</th><th>Correo de acceso</th>';

  _pintarAcc(_tituloAcc(),
    '<div class="accesos-ayuda">' + ayuda + '</div>' + buscador +
    '<table class="accesos-tabla"><thead><tr>' +
      '<th style="width:28px">' + (_accFilas.length > 1 ? '<input type="checkbox" id="accesos-todas" onchange="elegirTodasAcc(this.checked)" title="Todas">' : '') + '</th>' +
      cabecera +
    '</tr></thead><tbody id="accesos-tbody"></tbody></table>',
    '<span class="accesos-resumen" id="accesos-elegidas"></span>' +
    '<button class="btn btn-sm" onclick="cerrarAccesos()">Cancelar</button>' +
    '<button class="btn btn-primary btn-sm" id="btn-accesos-crear" onclick="' + (reseteo ? 'confirmarResetearAccesos()' : 'confirmarCrearAccesos()') + '"></button>');
  _actualizarListaAcc();
}

/* Repinta solo las filas, la casilla "todas" y el botón: así el
   buscador no pierde el foco mientras se escribe */
function _actualizarListaAcc() {
  var reseteo = _accTipo === 'reseteo';
  var visibles = _filasVisiblesAcc();
  var tbody = document.getElementById('accesos-tbody');
  if (tbody) {
    tbody.innerHTML = visibles.length ? visibles.map(function(f) {
      var i = _accFilas.indexOf(f);
      var celdas = reseteo
        ? '<td>' + _escAcc(f.nombre) + '</td><td>' + _escAcc(f.vinculo) + '</td><td class="accesos-mono">' + _escAcc(f.email) + '</td>' +
          '<td>' + (f.activo ? 'Activo' : '<span style="color:var(--color-text-secondary)">Inactivo</span>') + '</td>'
        : '<td>' + _escAcc(f.nombre) + '</td><td class="accesos-mono">' + _escAcc(f.email) + '</td>';
      return '<tr><td><input type="checkbox" ' + (f.elegida ? 'checked ' : '') + 'onchange="elegirFilaAcc(' + i + ', this.checked)"></td>' + celdas + '</tr>';
    }).join('') : '<tr><td colspan="5" style="color:var(--color-text-tertiary)">Nada coincide con la búsqueda.</td></tr>';
  }
  var todas = document.getElementById('accesos-todas');
  if (todas) todas.checked = visibles.length > 0 && visibles.every(function(f) { return f.elegida; });

  var elegidas = _accFilas.filter(function(f) { return f.elegida; }).length;
  var resumen = document.getElementById('accesos-elegidas');
  if (resumen) resumen.textContent = _accFilas.length > 1 ? elegidas + ' de ' + _accFilas.length + ' elegidos' : '';
  var btn = document.getElementById('btn-accesos-crear');
  if (btn) {
    btn.disabled = elegidas === 0;
    btn.innerHTML = reseteo
      ? '<i class="ti ti-key"></i> Resetear ' + elegidas + (elegidas === 1 ? ' contraseña' : ' contraseñas')
      : '<i class="ti ti-user-plus"></i> Crear ' + elegidas + (elegidas === 1 ? ' acceso' : ' accesos');
  }
}

window.buscarAcc = function(texto) {
  _accBusqueda = texto || '';
  _actualizarListaAcc();
};
window.elegirFilaAcc = function(i, si) {
  _accFilas[i].elegida = si;
  _actualizarListaAcc();
};
/* "Todas" marca o desmarca las que se ven (con búsqueda, solo esas) */
window.elegirTodasAcc = function(si) {
  _filasVisiblesAcc().forEach(function(f) { f.elegida = si; });
  _actualizarListaAcc();
};

/* Recorre las filas de a una (el servidor hashea cada contraseña) y
   arma _accResultados. enviar(fila, password) → Promise<Response>. */
async function _procesarAcc(filas, enviar) {
  _accTrabajando = true;
  _accResultados = [];
  for (var i = 0; i < filas.length; i++) {
    _pintarAcc(_tituloAcc(),
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
  _pintarResultadosAcc();
}

window.confirmarCrearAccesos = function() {
  var filas = _accFilas.filter(function(f) { return f.elegida; });
  if (!filas.length) return;
  var rol = _accTipo;
  _procesarAcc(filas, function(f, password) {
    var cuerpo = { nombre: f.nombre, email: f.email, password: password, rol: rol };
    if (rol === 'tienda') cuerpo.id_tienda = f.id; else cuerpo.id_motorizado = f.id;
    return fetch(API + '/auth/usuarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
  });
};

window.confirmarResetearAccesos = function() {
  var filas = _accFilas.filter(function(f) { return f.elegida; });
  if (!filas.length) return;
  var quien = filas.length === 1 ? filas[0].nombre + ' (' + filas[0].email + ')' : filas.length + ' usuarios';
  if (!confirm('Se va a poner una contraseña nueva a ' + quien + '.\n\n' +
               'La contraseña anterior dejará de funcionar: hasta que le entregues la nueva, no podrá entrar a Velox.\n\n¿Resetear?')) {
    return;
  }
  resetearAccesos(filas.map(function(f) { return { id: f.id, nombre: f.nombre, email: f.email }; }), _accAlTerminar);
};

/**
 * Resetea la contraseña de varios usuarios a una aleatoria y muestra el
 * resultado (una sola vez, Copiar / CSV). usuarios = [{ id, nombre, email }].
 * Solo cambia la contraseña (PATCH /auth/usuarios/:id/password, que el
 * admin puede usar sin la actual). Sin confirmación: la pide quien llama
 * (ver confirmarResetearAccesos).
 */
window.resetearAccesos = function(usuarios, alTerminar) {
  _accTipo = 'reseteo';
  _accEntregado = false;
  _accAlTerminar = alTerminar || null;
  _procesarAcc(usuarios, function(u, password) {
    return fetch(API + '/auth/usuarios/' + u.id + '/password', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password }),
    });
  });
};

function _pintarResultadosAcc() {
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
  _pintarAcc(_tituloAcc(), cuerpo, pie);
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
  a.download = (_accTipo === 'reseteo' ? 'contrasenas-nuevas-velox-' : 'accesos-velox-') + new Date().toISOString().slice(0, 10) + '.csv';
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
