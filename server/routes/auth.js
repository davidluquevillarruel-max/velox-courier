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
      .query(`SELECT id, nombre, email, password_hash, rol, activo
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
      usuario: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
