/* ============================================================
   utils.js — Funciones utilitarias globales
   CourierAdmin · Sistema de gestión interna
   ============================================================ */

/**
 * Muestra la fecha actual en el footer del sidebar.
 */
/* ============================================================
   AUTENTICACIÓN POR COOKIE — interceptor global de fetch
   Pegar este bloque al INICIO de utils.js (después de la cabecera).

   Hace tres cosas, para TODAS las llamadas fetch del sistema, sin
   tener que tocar cada archivo:
     1. Envía siempre la cookie de sesión (credentials: 'include').
     2. Si el servidor responde 401 (sesión caída/inválida),
        limpia la sesión local y manda al login.
     3. Evita bucles: no redirige si ya estamos en login.html.
   ============================================================ */
(function() {
  var _fetch = window.fetch;

  window.fetch = function(url, options) {
    options = options || {};
    /* Adjuntar la cookie en cada petición al mismo origen */
    if (options.credentials === undefined) {
      options.credentials = 'include';
    }

    return _fetch(url, options).then(function(res) {
      /* Sesión expirada o no autenticado → volver al login */
      if (res.status === 401) {
        var enLogin = window.location.pathname.indexOf('login.html') !== -1;
        if (!enLogin) {
          localStorage.removeItem('velox_usuario');
          window.location.href = 'login.html';
        }
      }
      return res;
    });
  };

  /* Cerrar sesión: borra la cookie en el servidor y limpia local */
  window.cerrarSesion = async function() {
    try {
      await _fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (e) { /* ignorar: igual limpiamos y salimos */ }
    localStorage.removeItem('velox_usuario');
    window.location.href = 'login.html';
  };
})();



(function initFecha() {
  const hoy = new Date();
  const el = document.getElementById('fecha-hoy');
  if (el) {
    el.textContent = hoy.toLocaleDateString('es-PE', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  }
})();

/**
 * Muestra una notificación flotante temporal.
 * @param {string} msg - Texto a mostrar
 * @param {number} duracion - Milisegundos antes de ocultarse (default: 2500)
 */
function showNotif(msg, duracion = 2500) {
  const n = document.getElementById('notif');
  if (!n) return;
  n.textContent = msg;
  n.style.display = 'block';
  clearTimeout(n._timer);
  n._timer = setTimeout(() => { n.style.display = 'none'; }, duracion);
}

/* ============================================================
   COMPRESIÓN DE IMÁGENES EN EL NAVEGADOR
   Requisito no negociable del módulo de fotos (DECISIONES.md
   D-003): sin comprimir antes de subir, el almacenamiento sale
   caro con el volumen de fotos del negocio. ~1280px de ancho y
   calidad 0.7 deja archivos de ~250 KB.
   La usan la evidencia del medio de pago (js/motorizados.js) y la
   foto del producto al crear la orden (js/pedidos.js).
   ============================================================ */
function comprimirImagenJPEG(file, maxAncho, calidad) {
  maxAncho = maxAncho || 1280;
  calidad  = calidad  || 0.7;

  return new Promise(function(resolve, reject) {
    var img = new Image();
    var url = URL.createObjectURL(file);

    img.onload = function() {
      URL.revokeObjectURL(url);
      var escala = img.width > maxAncho ? maxAncho / img.width : 1;
      var canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width  * escala);
      canvas.height = Math.round(img.height * escala);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(function(blob) {
        if (blob) resolve(blob); else reject(new Error('No se pudo procesar la imagen'));
      }, 'image/jpeg', calidad);
    };

    img.onerror = function() {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer el archivo como imagen'));
    };

    img.src = url;
  });
}

/* ============================================================
   REFRESCO AUTOMÁTICO COMPARTIDO
   Varios usuarios con su propio login trabajan sobre la misma
   base al mismo tiempo — esto hace que los cambios de uno
   aparezcan solos en la pantalla de los demás, sin que nadie
   tenga que recargar. Nunca reemplaza la página entera: cada
   callback repinta solo su tabla (su <tbody>), así que un modal
   abierto (ej. "Actualizar orden") no se ve afectado — vive en
   su propio overlay, aparte del <tbody> que se repinta.

   Se autolimpia: para cuando `elementoGuardia` deja de existir
   en el DOM (o sea, cuando se navegó a otra página — showPage
   reemplaza #main-content). No hace falta acordarse de pararlo.
   ============================================================ */
function iniciarRefrescoAutomatico(elementoGuardia, callback, intervalMs) {
  intervalMs = intervalMs || 8000;
  var id = setInterval(async function() {
    if (!document.getElementById(elementoGuardia)) {
      clearInterval(id);
      return;
    }
    try { await callback(); } catch (err) { console.error('Error en refresco automático:', err); }
  }, intervalMs);
  return id;
}
