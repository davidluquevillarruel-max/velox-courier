/* ============================================================
   login.js — Lógica de inicio de sesión
   ============================================================ */
var API = '/api';

/* Si ya hay sesión guardada, ir directo al sistema */
(function() {
  var sesion = localStorage.getItem('velox_usuario');
  if (sesion) {
    window.location.href = 'index.html';
  }
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
      body: JSON.stringify({ email: email, password: password }),
    });
    var data = await r.json();

    if (!data.ok) {
      errorBox.textContent = data.error || 'Usuario o contraseña incorrectos.';
      errorBox.style.display = 'block';
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-login"></i> Iniciar sesión';
      return;
    }

    /* Guardar sesión localmente */
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
