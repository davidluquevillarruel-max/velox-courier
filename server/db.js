/* ============================================================
   db.js — Conexión a SQL Server con usuario y contraseña
   ============================================================ */
require('dotenv').config();
const sql = require('mssql');

/* La contraseña sale SOLO de server/.env. Si falta, no se arranca con
   una escrita en el código (la que había quedó en el historial de git):
   se avisa y se corta. */
if (!process.env.DB_PASSWORD) {
  console.error('❌ Falta DB_PASSWORD en server/.env: el servidor no arranca sin la contraseña de la base.');
  process.exit(1);
}

const config = {
  server:   process.env.DB_SERVER   || 'DESKTOP-ERVF8UO',
  database: process.env.DB_DATABASE || 'velox_courier',
  port:     parseInt(process.env.DB_PORT || '1433'),
  user:     process.env.DB_USER     || 'velox_user',
  password: process.env.DB_PASSWORD,
  options: {
    encrypt:                false,
    trustServerCertificate: true,
    enableArithAbort:       true,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

let pool = null;

async function getPool() {
  if (!pool) {
    pool = await sql.connect(config);
    console.log('✅ Conectado a SQL Server:', config.server);
  }
  return pool;
}

module.exports = { getPool, sql };
