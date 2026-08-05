/* ============================================================
   server/middleware/auth.js
   Autenticación por JWT en cookie httpOnly + autorización por rol.

   - El token solo guarda el id del usuario.
   - Los datos (rol, id_tienda, id_motorizado, activo) se leen de la
     BD en CADA petición: así, desactivar un usuario lo deja fuera
     al instante, sin esperar a que expire el token.
   ============================================================ */

const jwt = require('jsonwebtoken');
const { getPool, sql } = require('../db');

const COOKIE_NAME = 'velox_token';
const DURACION    = '12h';   // vida del token
const MAX_AGE_MS  = 12 * 60 * 60 * 1000;

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error('JWT_SECRET no está definido en .env (o es demasiado corto)');
  }
  return s;
}

/* ── Crea el token y lo deja en una cookie httpOnly ── */
function emitirCookieSesion(res, usuario) {
  const token = jwt.sign({ uid: usuario.id }, getSecret(), { expiresIn: DURACION });

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,                                  // el JS del navegador NO puede leerla
    secure:   process.env.NODE_ENV === 'production', // solo por HTTPS en producción
    sameSite: 'lax',                                 // frena CSRF básico
    maxAge:   MAX_AGE_MS,
    path:     '/',
  });
}

/* ── Borra la cookie (logout) ── */
function limpiarCookieSesion(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

/* ── Exige sesión válida. Deja el usuario en req.usuario ── */
async function requireAuth(req, res, next) {
  try {
    const token = req.cookies && req.cookies[COOKIE_NAME];
    if (!token) {
      return res.status(401).json({ error: 'No autenticado' });
    }

    let payload;
    try {
      payload = jwt.verify(token, getSecret());
    } catch (e) {
      limpiarCookieSesion(res);
      return res.status(401).json({ error: 'Sesión inválida o expirada' });
    }

    const pool = await getPool();
    const r = await pool.request()
      .input('id', sql.Int, payload.uid)
      .query(`SELECT id, nombre, email, rol, activo, id_motorizado, id_tienda
              FROM usuarios WHERE id = @id`);

    const u = r.recordset[0];
    if (!u || !u.activo) {
      limpiarCookieSesion(res);
      return res.status(401).json({ error: 'Usuario inactivo o inexistente' });
    }

    req.usuario = {
      id:            u.id,
      nombre:        u.nombre,
      email:         u.email,
      rol:           u.rol,
      id_motorizado: u.id_motorizado,
      id_tienda:     u.id_tienda,
    };
    next();
  } catch (err) {
    console.error('requireAuth:', err.message);
    res.status(500).json({ error: 'Error de autenticación' });
  }
}

/* ── Exige uno de los roles indicados. Usar SIEMPRE después de requireAuth ──
   Ej: router.post('/', requireAuth, requireRol('admin','operador'), handler) */
function requireRol(...roles) {
  return function (req, res, next) {
    if (!req.usuario) {
      return res.status(401).json({ error: 'No autenticado' });
    }
    if (!roles.includes(req.usuario.rol)) {
      return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    }
    next();
  };
}

module.exports = {
  requireAuth,
  requireRol,
  emitirCookieSesion,
  limpiarCookieSesion,
  COOKIE_NAME,
};
