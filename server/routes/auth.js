/* ============================================================
   routes/auth.js — Autenticación con usuarios + roles
   Usa crypto (PBKDF2) nativo de Node, sin dependencias extra.
   Sesión por JWT en cookie httpOnly (ver middleware/auth.js).
   ============================================================ */
const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const { getPool, sql } = require('../db');
const {
  requireAuth,
  requireRol,
  emitirCookieSesion,
  limpiarCookieSesion,
} = require('../middleware/auth');

/* Verificar contraseña contra hash almacenado "salt:hash" */
function verifyPassword(password, stored) {
  if (!stored || stored.indexOf(':') === -1) return false;
  const [salt, hash] = stored.split(':');
  const hashVerify = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return hash === hashVerify;
}

/* Generar hash nuevo "salt:hash" para guardar en la BD */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return salt + ':' + hash;
}

/* Validación de contraseña fuerte (debe coincidir con validators.js del frontend) */
function passwordEsFuerte(password) {
  if (!password || password.length < 8) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) return false;
  return true;
}

/* ════════════════════════════════════════════
   FRENO A FUERZA BRUTA
   Máx. 10 intentos fallidos por IP cada 15 min.
   En memoria: se reinicia con el proceso, suficiente
   para este caso de uso.
════════════════════════════════════════════ */
const intentos = new Map();
const MAX_INTENTOS = 10;
const VENTANA_MS   = 15 * 60 * 1000;

function ipDe(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'desconocida';
}
function bloqueado(ip) {
  const reg = intentos.get(ip);
  if (!reg) return false;
  if (Date.now() - reg.desde > VENTANA_MS) { intentos.delete(ip); return false; }
  return reg.n >= MAX_INTENTOS;
}
function sumarFallo(ip) {
  const reg = intentos.get(ip);
  if (!reg || Date.now() - reg.desde > VENTANA_MS) intentos.set(ip, { n: 1, desde: Date.now() });
  else reg.n++;
}

/* ── POST /api/auth/login ─────────────────── */
router.post('/login', async (req, res) => {
  try {
    const ip = ipDe(req);
    if (bloqueado(ip)) {
      return res.status(429).json({ ok: false, error: 'Demasiados intentos fallidos. Espera 15 minutos.' });
    }

    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'Email y contraseña requeridos' });
    }

    const pool = await getPool();
    const result = await pool.request()
      .input('email', sql.NVarChar, email.trim().toLowerCase())
      .query(`SELECT id, nombre, email, password_hash, rol, activo, id_motorizado, id_tienda
              FROM usuarios WHERE LOWER(email) = @email`);

    const user = result.recordset[0];
    if (!user || !user.activo || !verifyPassword(password, user.password_hash)) {
      sumarFallo(ip);
      return res.status(401).json({ ok: false, error: 'Usuario o contraseña incorrectos' });
    }

    intentos.delete(ip);

    /* Actualizar último acceso */
    await pool.request()
      .input('id', sql.Int, user.id)
      .query('UPDATE usuarios SET ultimo_acceso = GETDATE() WHERE id = @id');

    /* Sesión: cookie httpOnly firmada */
    emitirCookieSesion(res, user);

    res.json({
      ok: true,
      usuario: {
        id: user.id, nombre: user.nombre, email: user.email,
        rol: user.rol, id_motorizado: user.id_motorizado, id_tienda: user.id_tienda
      }
    });
  } catch (err) {
    console.error('POST /auth/login:', err.message);
    res.status(500).json({ ok: false, error: 'Error al iniciar sesión' });
  }
});

/* ── POST /api/auth/logout ────────────────── */
router.post('/logout', (req, res) => {
  limpiarCookieSesion(res);
  res.json({ ok: true });
});

/* ── GET /api/auth/me — Quién soy (según la cookie) ── */
router.get('/me', requireAuth, (req, res) => {
  res.json({ ok: true, usuario: req.usuario });
});

/* ── GET /api/auth/usuarios — Listar usuarios ──
   Admin ve todos. Motorizado y tienda ven SOLO el suyo.
   El filtro se hace aquí, no en el navegador. */
router.get('/usuarios', requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const esAdmin = req.usuario.rol === 'admin';

    const request = pool.request();
    let filtro = '';
    if (!esAdmin) {
      request.input('yo', sql.Int, req.usuario.id);
      filtro = 'WHERE u.id = @yo';
    }

    const result = await request.query(`
      SELECT u.id, u.nombre, u.email, u.rol, u.activo,
             CONVERT(varchar,u.ultimo_acceso,20) AS ultimo_acceso,
             u.id_motorizado, m.nombre AS motorizado_nombre
      FROM usuarios u
      LEFT JOIN motorizados m ON m.id = u.id_motorizado
      ${filtro}
      ORDER BY u.rol, u.nombre
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error('GET /auth/usuarios:', err.message);
    res.status(500).json({ error: 'Error al listar usuarios' });
  }
});

/* ── GET /api/auth/motorizados-libres — solo admin ── */
router.get('/motorizados-libres', requireAuth, requireRol('admin'), async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT m.id, m.nombre
      FROM motorizados m
      WHERE m.activo = 1
        AND NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.id_motorizado = m.id)
      ORDER BY m.nombre
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error('GET /auth/motorizados-libres:', err.message);
    res.status(500).json({ error: 'Error al listar motorizados' });
  }
});

/* ── POST /api/auth/usuarios — Crear usuario (solo admin) ── */
router.post('/usuarios', requireAuth, requireRol('admin'), async (req, res) => {
  try {
    const { nombre, email, password, rol, id_motorizado } = req.body;

    if (!nombre || !email || !password || !rol) {
      return res.status(400).json({ error: 'Nombre, email, contraseña y rol son obligatorios' });
    }
    const ROLES_VALIDOS = ['admin', 'operador', 'visor', 'motorizado', 'tienda'];
    if (!ROLES_VALIDOS.includes(rol)) {
      return res.status(400).json({ error: 'Rol no válido' });
    }
    if (!/^[^\s@]+@velox\.pe$/i.test(email)) {
      return res.status(400).json({ error: 'El correo debe tener el formato nombre@velox.pe' });
    }
    if (!passwordEsFuerte(password)) {
      return res.status(400).json({ error: 'La contraseña no cumple los requisitos de seguridad (8+ caracteres, mayúscula, minúscula, número y símbolo)' });
    }
    if (rol === 'motorizado' && !id_motorizado) {
      return res.status(400).json({ error: 'Debes vincular este usuario a un motorizado' });
    }
    if (rol === 'tienda' && !req.body.id_tienda) {
      return res.status(400).json({ error: 'Debes vincular este usuario a una tienda' });
    }

    const pool = await getPool();

    const existe = await pool.request()
      .input('email', sql.NVarChar, email.trim().toLowerCase())
      .query('SELECT id FROM usuarios WHERE LOWER(email) = @email');
    if (existe.recordset.length > 0) {
      return res.status(400).json({ error: 'Ya existe un usuario con ese correo' });
    }

    if (rol === 'motorizado') {
      const yaVinculado = await pool.request()
        .input('idm', sql.Int, id_motorizado)
        .query('SELECT id FROM usuarios WHERE id_motorizado = @idm');
      if (yaVinculado.recordset.length > 0) {
        return res.status(400).json({ error: 'Ese motorizado ya tiene un usuario vinculado' });
      }
    }

    const hash = hashPassword(password);
    const id_tienda = req.body.id_tienda || null;

    await pool.request()
      .input('nombre',    sql.NVarChar, nombre)
      .input('email',     sql.NVarChar, email.trim().toLowerCase())
      .input('hash',      sql.NVarChar, hash)
      .input('rol',       sql.NVarChar, rol)
      .input('idm',       sql.Int,      rol === 'motorizado' ? id_motorizado : null)
      .input('id_tienda', sql.Int,      rol === 'tienda' ? id_tienda : null)
      .query(`
        INSERT INTO usuarios (nombre, email, password_hash, rol, activo, id_motorizado, id_tienda)
        VALUES (@nombre, @email, @hash, @rol, 1, @idm, @id_tienda)
      `);

    res.json({ ok: true });
  } catch (err) {
    console.error('POST /auth/usuarios:', err.message);
    res.status(500).json({ error: 'Error al crear el usuario' });
  }
});

/* ── PATCH /api/auth/usuarios/:id/estado — solo admin ── */
router.patch('/usuarios/:id/estado', requireAuth, requireRol('admin'), async (req, res) => {
  try {
    const { activo } = req.body;
    const id = parseInt(req.params.id, 10);

    /* No permitir que el admin se desactive a sí mismo */
    if (id === req.usuario.id && !activo) {
      return res.status(400).json({ error: 'No puedes desactivar tu propio usuario' });
    }

    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, id)
      .input('activo', sql.Bit, activo ? 1 : 0)
      .query('UPDATE usuarios SET activo = @activo WHERE id = @id');
    res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /auth/usuarios/:id/estado:', err.message);
    res.status(500).json({ error: 'Error al actualizar el estado' });
  }
});

/* ── DELETE /api/auth/usuarios/:id/permanente — solo admin ── */
router.delete('/usuarios/:id/permanente', requireAuth, requireRol('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (id === req.usuario.id) {
      return res.status(400).json({ error: 'No puedes eliminar tu propio usuario' });
    }

    const pool = await getPool();
    const userRes = await pool.request()
      .input('id', sql.Int, id)
      .query(`SELECT rol FROM usuarios WHERE id = @id`);

    if (userRes.recordset.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (userRes.recordset[0].rol === 'admin') {
      const countAdmins = await pool.request()
        .query(`SELECT COUNT(*) AS total FROM usuarios WHERE rol = 'admin' AND activo = 1`);
      if (countAdmins.recordset[0].total <= 1) {
        return res.status(400).json({ error: 'No puedes eliminar el único administrador del sistema.' });
      }
    }

    await pool.request()
      .input('id', sql.Int, id)
      .query(`DELETE FROM usuarios WHERE id = @id`);

    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /auth/usuarios/:id/permanente:', err.message);
    res.status(500).json({ error: 'Error al eliminar el usuario' });
  }
});

/* ── PATCH /api/auth/usuarios/:id/password — Cambiar contraseña ──
   · Admin: puede cambiar la de cualquiera (para resetear).
   · Cualquier otro: SOLO la suya, y debe enviar la contraseña actual. */
router.patch('/usuarios/:id/password', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { password, passwordActual } = req.body;
    const esAdmin  = req.usuario.rol === 'admin';
    const esElMio  = id === req.usuario.id;

    if (!esAdmin && !esElMio) {
      return res.status(403).json({ error: 'Solo puedes cambiar tu propia contraseña' });
    }
    if (!passwordEsFuerte(password)) {
      return res.status(400).json({ error: 'La contraseña debe tener 8+ caracteres, mayúscula, minúscula, número y símbolo' });
    }

    const pool = await getPool();

    /* Si no es admin, verificar la contraseña actual */
    if (!esAdmin) {
      if (!passwordActual) {
        return res.status(400).json({ error: 'Debes ingresar tu contraseña actual' });
      }
      const r = await pool.request()
        .input('id', sql.Int, id)
        .query('SELECT password_hash FROM usuarios WHERE id = @id');
      if (!r.recordset[0] || !verifyPassword(passwordActual, r.recordset[0].password_hash)) {
        return res.status(401).json({ error: 'La contraseña actual no es correcta' });
      }
    }

    await pool.request()
      .input('id',   sql.Int,      id)
      .input('hash', sql.NVarChar, hashPassword(password))
      .query('UPDATE usuarios SET password_hash = @hash WHERE id = @id');

    res.json({ ok: true });
  } catch (err) {
    console.error('PATCH /auth/usuarios/:id/password:', err.message);
    res.status(500).json({ error: 'Error al cambiar la contraseña' });
  }
});

module.exports = router;
