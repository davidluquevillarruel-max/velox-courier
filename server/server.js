/* ============================================================
   server.js — Servidor principal de Velox Courier API
   Iniciar: node server.js
   ============================================================ */

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app = express();

/* ── Middleware ── */
app.use(cors());
app.use(express.json());

/* ── Servir el frontend desde la carpeta raíz del proyecto ── */
/* La carpeta server/ está dentro de courier-velox/           */
app.use(express.static(path.join(__dirname, '..')));

/* ── Rutas de la API ── */
app.use('/api/auth',         require('./routes/auth'));
app.use('/api/ordenes',      require('./routes/ordenes'));
app.use('/api/motorizados',  require('./routes/motorizados'));
app.use('/api/tiendas',      require('./routes/tiendas'));
app.use('/api/tarifas',      require('./routes/tarifas'));
app.use('/api/caja',         require('./routes/caja'));

/* ── Ruta de salud ── */
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, mensaje: 'Velox Courier API funcionando', fecha: new Date() });
});

/* ── Iniciar servidor ── */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Velox Courier API corriendo en http://localhost:${PORT}`);
  console.log(`📂 Frontend en:  http://localhost:${PORT}/index.html`);
  console.log(`🔌 API base en:  http://localhost:${PORT}/api\n`);
});
