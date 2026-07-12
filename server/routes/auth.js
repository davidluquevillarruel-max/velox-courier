/* ============================================================
   routes/auth.js — Autenticación con usuarios + roles
   Usa crypto (PBKDF2) nativo de Node, sin dependencias extra.
   ============================================================ */
const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const { getPool, sql } = require('../db');

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

/* POST /api/auth/login */
router.post('/login', async (req, res) => {
  try {
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
    if (!user || !user.activo) {
      return res.status(401).json({ ok: false, error: 'Usuario o contraseña incorrectos' });
    }

    if (!verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ ok: false, error: 'Usuario o contraseña incorrectos' });
    }

    /* Actualizar último acceso */
    await pool.request()
      .input('id', sql.Int, user.id)
      .query('UPDATE usuarios SET ultimo_acceso = GETDATE() WHERE id = @id');

    res.json({
      ok: true,
      usuario: {
        id: user.id, nombre: user.nombre, email: user.email,
        rol: user.rol, id_motorizado: user.id_motorizado, id_tienda: user.id_tienda
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ── GET /api/auth/usuarios — Listar todos los usuarios (para gestión) ── */
router.get('/usuarios', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT u.id, u.nombre, u.email, u.rol, u.activo,
             CONVERT(varchar,u.ultimo_acceso,20) AS ultimo_acceso,
             u.id_motorizado, m.nombre AS motorizado_nombre
      FROM usuarios u
      LEFT JOIN motorizados m ON m.id = u.id_motorizado
      ORDER BY u.rol, u.nombre
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /api/auth/motorizados-libres — Motorizados activos sin usuario vinculado ── */
router.get('/motorizados-libres', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT m.id, m.nombre
      FROM motorizados m
      WHERE m.activo = 1
        AND NOT EXISTS (
          SELECT 1 FROM usuarios u WHERE u.id_motorizado = m.id
        )
      ORDER BY m.nombre
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /api/auth/usuarios — Crear nuevo usuario ── */
router.post('/usuarios', async (req, res) => {
  try {
    const { nombre, email, password, rol, id_motorizado } = req.body;

    if (!nombre || !email || !password || !rol) {
      return res.status(400).json({ error: 'Nombre, email, contraseña y rol son obligatorios' });
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

    /* Verificar que el email no exista ya */
    const existe = await pool.request()
      .input('email', sql.NVarChar, email.trim().toLowerCase())
      .query('SELECT id FROM usuarios WHERE LOWER(email) = @email');
    if (existe.recordset.length > 0) {
      return res.status(400).json({ error: 'Ya existe un usuario con ese correo' });
    }

    /* Si es rol motorizado, verificar que ese motorizado no tenga ya un usuario */
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
    res.status(500).json({ error: err.message });
  }
});

/* ── PATCH /api/auth/usuarios/:id/estado — Activar/desactivar usuario ── */
router.patch('/usuarios/:id/estado', async (req, res) => {
  try {
    const { activo } = req.body;
    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, req.params.id)
      .input('activo', sql.Bit, activo ? 1 : 0)
      .query('UPDATE usuarios SET activo = @activo WHERE id = @id');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* DELETE /api/auth/usuarios/:id/permanente — Eliminación física.
   No permite borrar el último usuario con rol admin (evita quedar
   sin acceso al sistema). */
router.delete('/usuarios/:id/permanente', async (req, res) => {
  try {
    const pool = await getPool();

    const userRes = await pool.request()
      .input('id', sql.Int, req.params.id)
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
      .input('id', sql.Int, req.params.id)
      .query(`DELETE FROM usuarios WHERE id = @id`);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


/* ── PATCH /api/auth/usuarios/:id/password — Cambiar contraseña ── */
router.patch('/usuarios/:id/password', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }
    const pool = await getPool();
    const hashed = hashPassword(password);
    await pool.request()
      .input('id',   sql.Int,      req.params.id)
      .input('hash', sql.NVarChar, hashed)
      .query('UPDATE usuarios SET password_hash = @hash WHERE id = @id');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
