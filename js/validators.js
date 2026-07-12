/* ============================================================
   validators.js — Validaciones reutilizables de formularios
   Velox Courier
   ============================================================ */

/* ── Teléfono peruano: exactamente 9 dígitos, solo números ── */
function validarTelefono(valor) {
  if (!valor) return { ok: true }; /* opcional en varios formularios */
  var limpio = valor.replace(/[\s\-()]/g, '');
  if (!/^[0-9]+$/.test(limpio)) {
    return { ok: false, msg: 'El teléfono solo debe contener números.' };
  }
  if (limpio.length !== 9) {
    return { ok: false, msg: 'El teléfono debe tener exactamente 9 dígitos.' };
  }
  return { ok: true, valor: limpio };
}

/* ── Teléfono obligatorio (para destinatario de pedido) ── */
function validarTelefonoObligatorio(valor) {
  if (!valor) return { ok: false, msg: 'El teléfono es obligatorio.' };
  return validarTelefono(valor);
}

/* ── Correo electrónico: formato válido + dominios conocidos ── */
var _DOMINIOS_EMAIL_VALIDOS = [
  'gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'yahoo.es',
  'icloud.com', 'live.com', 'msn.com', 'protonmail.com', 'aol.com',
  'hotmail.es', 'outlook.es',
];
function validarEmail(valor, opciones) {
  opciones = opciones || {};
  if (!valor) {
    return opciones.obligatorio
      ? { ok: false, msg: 'El correo es obligatorio.' }
      : { ok: true };
  }
  var regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!regex.test(valor)) {
    return { ok: false, msg: 'Ingresa un correo válido (ej: nombre@gmail.com).' };
  }
  var dominio = valor.split('@')[1].toLowerCase();
  if (!_DOMINIOS_EMAIL_VALIDOS.includes(dominio)) {
    return { ok: false, msg: 'Usa un dominio de correo conocido (gmail, hotmail, outlook, yahoo, etc).' };
  }
  return { ok: true };
}

/* ── Texto con límite de longitud (nombre, dirección, etc.) ── */
function validarTexto(valor, opciones) {
  opciones = opciones || {};
  var min = opciones.min || 0;
  var max = opciones.max || 200;
  var nombreCampo = opciones.nombreCampo || 'Este campo';

  if (!valor && opciones.obligatorio) {
    return { ok: false, msg: nombreCampo + ' es obligatorio.' };
  }
  if (valor && valor.length < min) {
    return { ok: false, msg: nombreCampo + ' debe tener al menos ' + min + ' caracteres.' };
  }
  if (valor && valor.length > max) {
    return { ok: false, msg: nombreCampo + ' no puede superar los ' + max + ' caracteres.' };
  }
  return { ok: true };
}

/* ── RUC peruano: exactamente 11 dígitos numéricos ── */
function validarRUC(valor, opciones) {
  opciones = opciones || {};
  if (!valor) {
    return opciones.obligatorio
      ? { ok: false, msg: 'El RUC es obligatorio.' }
      : { ok: true };
  }
  if (!/^[0-9]+$/.test(valor)) {
    return { ok: false, msg: 'El RUC solo debe contener números.' };
  }
  if (valor.length !== 11) {
    return { ok: false, msg: 'El RUC debe tener exactamente 11 dígitos.' };
  }
  return { ok: true };
}

/* ── DNI peruano: exactamente 8 dígitos numéricos ── */
function validarDNI(valor, opciones) {
  opciones = opciones || {};
  if (!valor) {
    return opciones.obligatorio
      ? { ok: false, msg: 'El DNI es obligatorio.' }
      : { ok: true };
  }
  if (!/^[0-9]+$/.test(valor)) {
    return { ok: false, msg: 'El DNI solo debe contener números.' };
  }
  if (valor.length !== 8) {
    return { ok: false, msg: 'El DNI debe tener exactamente 8 dígitos.' };
  }
  return { ok: true };
}

/* ── Placa de vehículo: formato peruano ABC-123 o ABC-12D ── */
function validarPlaca(valor, opciones) {
  opciones = opciones || {};
  if (!valor) {
    return opciones.obligatorio
      ? { ok: false, msg: 'La placa es obligatoria.' }
      : { ok: true };
  }
  var limpio = valor.toUpperCase().replace(/\s/g, '');
  if (!/^[A-Z0-9]{3}-?[A-Z0-9]{3}$/.test(limpio)) {
    return { ok: false, msg: 'Formato de placa inválido (ej: ABC-123).' };
  }
  return { ok: true };
}

/* ════════════════════════════════════════════
   Helper: ejecuta una lista de validaciones y
   muestra el primer error en el elemento dado.
   Devuelve true si todo pasó, false si hay error.
════════════════════════════════════════════ */
function ejecutarValidaciones(validaciones, errEl) {
  for (var i = 0; i < validaciones.length; i++) {
    var res = validaciones[i];
    if (!res.ok) {
      if (errEl) { errEl.textContent = res.msg; errEl.style.display = 'block'; }
      return false;
    }
  }
  if (errEl) errEl.style.display = 'none';
  return true;
}

/* ── Contraseña fuerte: mínimo 8 caracteres, mayúscula, minúscula, número y símbolo ── */
function validarPasswordFuerte(valor, opciones) {
  opciones = opciones || {};
  if (!valor) {
    return opciones.obligatorio
      ? { ok: false, msg: 'La contraseña es obligatoria.' }
      : { ok: true };
  }
  if (valor.length < 8) {
    return { ok: false, msg: 'La contraseña debe tener al menos 8 caracteres.' };
  }
  if (!/[A-Z]/.test(valor)) {
    return { ok: false, msg: 'La contraseña debe incluir al menos una letra mayúscula.' };
  }
  if (!/[a-z]/.test(valor)) {
    return { ok: false, msg: 'La contraseña debe incluir al menos una letra minúscula.' };
  }
  if (!/[0-9]/.test(valor)) {
    return { ok: false, msg: 'La contraseña debe incluir al menos un número.' };
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(valor)) {
    return { ok: false, msg: 'La contraseña debe incluir al menos un carácter especial (ej: !).' };
  }
  return { ok: true };
}

/* ── Email institucional Velox: debe terminar en @velox.pe ── */
function validarEmailVelox(valor, opciones) {
  opciones = opciones || {};
  if (!valor) {
    return opciones.obligatorio
      ? { ok: false, msg: 'El correo es obligatorio.' }
      : { ok: true };
  }
  var regex = /^[^\s@]+@velox\.pe$/i;
  if (!regex.test(valor)) {
    return { ok: false, msg: 'El correo debe tener el formato nombre@velox.pe' };
  }
  return { ok: true };
}

/* ════════════════════════════════════════════
   ELIMINACIÓN FÍSICA — modal reutilizable
   Pide la clave de seguridad antes de ejecutar
   un DELETE permanente contra la BD.
════════════════════════════════════════════ */
var _CLAVE_ELIMINACION = 'AlexVelox2026!';
var _eliminarFisicoCallback = null;

function abrirConfirmarEliminacionFisica(nombreItem, urlDelete, onExito) {
  _eliminarFisicoCallback = { urlDelete: urlDelete, onExito: onExito };

  var overlay = document.getElementById('elim-fisica-modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'elim-fisica-modal-overlay';
    overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:1200;align-items:center;justify-content:center';
    document.body.appendChild(overlay);
  }

  overlay.innerHTML =
    '<div style="background:var(--color-bg-primary);border-radius:var(--radius-lg);padding:24px;width:400px;max-width:95vw;box-shadow:0 8px 32px rgba(0,0,0,0.25)">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">' +
        '<div style="background:#FCEBEB;border-radius:50%;width:38px;height:38px;display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
          '<i class="ti ti-alert-triangle" style="color:#A32D2D;font-size:18px"></i>' +
        '</div>' +
        '<div>' +
          '<div style="font-size:15px;font-weight:600">Eliminar permanentemente</div>' +
          '<div style="font-size:12px;color:var(--color-text-secondary)">Esta acción no se puede deshacer</div>' +
        '</div>' +
      '</div>' +
      '<div style="font-size:13px;color:var(--color-text-secondary);margin-bottom:14px">' +
        'Estás a punto de eliminar <strong>' + nombreItem + '</strong> de forma permanente de la base de datos. ' +
        'Esto no es lo mismo que desactivar — el registro desaparecerá por completo.' +
      '</div>' +
      '<div>' +
        '<label style="font-size:12px;color:var(--color-text-secondary);display:block;margin-bottom:4px">Clave de seguridad</label>' +
        '<input id="elim-fisica-clave" type="password" class="search-box" style="width:100%" placeholder="Ingresa la clave de eliminación" />' +
      '</div>' +
      '<div id="elim-fisica-error" style="display:none;color:#A32D2D;font-size:12px;padding:8px 12px;background:#FCEBEB;border-radius:var(--radius-md);margin-top:10px"></div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px">' +
        '<button class="btn btn-sm" onclick="cerrarConfirmarEliminacionFisica()">Cancelar</button>' +
        '<button class="btn btn-sm" style="background:#A32D2D;color:#fff;border-color:#A32D2D" onclick="ejecutarEliminacionFisica()">' +
          '<i class="ti ti-trash"></i> Eliminar definitivamente' +
        '</button>' +
      '</div>' +
    '</div>';

  overlay.style.display = 'flex';

  var inputClave = document.getElementById('elim-fisica-clave');
  if (inputClave) {
    inputClave.focus();
    inputClave.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') ejecutarEliminacionFisica();
    });
  }
}

function cerrarConfirmarEliminacionFisica() {
  var overlay = document.getElementById('elim-fisica-modal-overlay');
  if (overlay) overlay.style.display = 'none';
  _eliminarFisicoCallback = null;
}

async function ejecutarEliminacionFisica() {
  var clave = document.getElementById('elim-fisica-clave').value;
  var errEl = document.getElementById('elim-fisica-error');

  if (clave !== _CLAVE_ELIMINACION) {
    errEl.textContent = 'Clave incorrecta. No se realizó ninguna eliminación.';
    errEl.style.display = 'block';
    return;
  }
  if (!_eliminarFisicoCallback) return;

  try {
    var r = await fetch(_eliminarFisicoCallback.urlDelete, { method: 'DELETE' });
    var data = await r.json().catch(function(){ return {}; });

    if (!r.ok) {
      errEl.textContent = data.error || 'No se pudo eliminar el registro.';
      errEl.style.display = 'block';
      return;
    }

    var onExito = _eliminarFisicoCallback.onExito;
    cerrarConfirmarEliminacionFisica();
    if (typeof onExito === 'function') onExito();
    if (typeof showNotif === 'function') showNotif('Eliminado permanentemente');

  } catch (err) {
    errEl.textContent = 'Error de conexión al eliminar.';
    errEl.style.display = 'block';
  }
}
