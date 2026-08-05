/* ============================================================
   login.js — Lógica de inicio de sesión (sesión por cookie httpOnly)
   ============================================================ */
var API = '/api';

/* Si ya hay una cookie de sesión válida, ir directo al sistema.
   Se pregunta al servidor: localStorage por sí solo ya no basta,
   porque la cookie es la única fuente de verdad. */
(function() {
  fetch(API + '/auth/me', { credentials: 'include' })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
      if (data && data.ok) {
        localStorage.setItem('velox_usuario', JSON.stringify(data.usuario));
        window.location.href = 'index.html';
      } else {
        localStorage.removeItem('velox_usuario');
      }
    })
    .catch(function() { /* sin conexión: quedarse en login */ });
})();

window.hacerLogin = async function() {
  var email    = document.getElementById('login-email').value.trim();
  var password = document.getElementById('login-password').value;
  var errorBox = document.getElementById('login-error');
  var btn      = document.getElementById('login-btn');

  errorBox.style.display = 'none';

  if (!email || !password) {
    errorBox.textContent = 'Completa correo y contraseña.';
    errorBox.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader"></i> Verificando...';

  try {
    var r = await fetch(API + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',                 // ← permite recibir la cookie de sesión
      body: JSON.stringify({ email: email, password: password }),
    });
    var data = await r.json();

    if (!r.ok || !data.ok) {
      errorBox.textContent = data.error || 'Usuario o contraseña incorrectos.';
      errorBox.style.display = 'block';
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-login"></i> Iniciar sesión';
      return;
    }

    /* Guardar datos del usuario solo para pintar el menú por rol.
       La autorización real la hace el servidor con la cookie. */
    localStorage.setItem('velox_usuario', JSON.stringify(data.usuario));
    window.location.href = 'index.html';

  } catch (err) {
    errorBox.textContent = 'No se pudo conectar con el servidor.';
    errorBox.style.display = 'block';
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-login"></i> Iniciar sesión';
  }
};

/* Permitir enviar con Enter */
document.addEventListener('DOMContentLoaded', function() {
  var pass = document.getElementById('login-password');
  if (pass) {
    pass.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') hacerLogin();
    });
  }
});
