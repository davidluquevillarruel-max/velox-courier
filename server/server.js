/* ============================================================
   server.js — Servidor principal de Velox Courier API
   Iniciar: node server.js
   ============================================================ */

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const cookieParser = require('cookie-parser');

const app = express();

/* ── Middleware ── */
/* CORS: solo orígenes propios. En local, mismo-origen no dispara CORS;
   en producción, solo se acepta el dominio del sistema. */
const ORIGENES_PERMITIDOS = [
  'http://localhost:3000',
  'https://sistema.veloxcourierperu.com',
];
app.use(cors({
  origin: function (origin, callback) {
    // Peticiones del mismo origen (o curl/Postman) no traen 'origin'
    if (!origin || ORIGENES_PERMITIDOS.indexOf(origin) !== -1) {
      return callback(null, true);
    }
    return callback(new Error('Origen no permitido por CORS'));
  },
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

/* ── Servir el frontend desde la carpeta raíz del proyecto ── */
/* La carpeta server/ está dentro de courier-velox/           */
app.use(express.static(path.join(__dirname, '..')));

/* ── Rutas de la API ── */
/* Antes de todas: a la tienda y al motorizado no les sale ningún campo
   con el que puedan calcular el margen (middleware/recortar-por-rol.js) */
app.use('/api', require('./middleware/recortar-por-rol').recortarPorRol);
app.use('/api/auth',         require('./routes/auth'));
app.use('/api/ordenes',      require('./routes/ordenes'));
app.use('/api/motorizados',  require('./routes/motorizados'));
app.use('/api/tiendas',      require('./routes/tiendas'));
app.use('/api/tarifas',      require('./routes/tarifas'));
app.use('/api/caja',         require('./routes/caja'));
app.use('/api/notificaciones', require('./routes/notificaciones'));
app.use('/api/reasignaciones', require('./routes/reasignaciones'));

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
