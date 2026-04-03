/**
 * FIX #3:  /api/reset bloqueado en NODE_ENV=production.
 * FIX #11: Health check verifica conexión real a la BD.
 * FIX #20: Logging con timestamp, nivel y path.
 */
const express = require('express');
const cors    = require('cors');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3001;
const pool = require('./db/pool');

// Middleware
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Logger estructurado
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms  = Date.now() - start;
    const lvl = res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'INFO';
    console.log(`[${new Date().toISOString()}] ${lvl} ${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
  });
  next();
});

const { requireAuth, requireRole } = require('./middleware/auth');
const isProd = process.env.NODE_ENV === 'production';

// Rutas públicas
app.use('/api/auth', require('./routes/auth'));

// Rutas protegidas — solo admin
app.use('/api/productos',    requireAuth, requireRole('admin'), require('./routes/productos'));
app.use('/api/vendedores',   requireAuth, requireRole('admin'), require('./routes/vendedores'));
app.use('/api/puntos-venta', requireAuth, requireRole('admin'), require('./routes/puntos-venta'));
app.use('/api/distribucion', requireAuth, requireRole('admin'), require('./routes/distribucion'));
app.use('/api/clientes',     requireAuth, requireRole('admin'), require('./routes/clientes'));
app.use('/api/facturas',     requireAuth, requireRole('admin'), require('./routes/facturas'));
app.use('/api/bandec',       requireAuth, requireRole('admin'), require('./routes/bandec'));

// Rutas de transferencias — admin y viewer (PATCH restringido dentro de la ruta)
app.use('/api/transferencias', requireAuth, require('./routes/transferencias'));

// FIX #3: /api/reset bloqueado en producción
app.use('/api/reset', requireAuth, (req, res, next) => {
  if (isProd) {
    return res.status(403).json({
      error: 'La ruta /api/reset no está disponible en producción.',
    });
  }
  next();
}, require('./routes/reset'));

// FIX #11: Health check real — verifica la BD
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({
      status:    'ok',
      db:        'connected',
      timestamp: new Date().toISOString(),
      version:   '1.0.0',
      env:       process.env.NODE_ENV || 'development',
    });
  } catch (err) {
    console.error('[HEALTH] BD no disponible:', err.message);
    res.status(503).json({
      status:    'error',
      db:        'disconnected',
      timestamp: new Date().toISOString(),
    });
  }
});

// Error handler global
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] ERROR ${req.method} ${req.path}:`, err.message);
  // En producción no exponer detalles internos
  res.status(500).json({
    error:   'Error interno del servidor',
    details: isProd ? undefined : err.message,
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀 GestDist API en http://localhost:${PORT}`);
  console.log(`🌍 Entorno: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔒 /api/reset: ${isProd ? 'BLOQUEADO (producción)' : 'habilitado (desarrollo)'}`);
  console.log(`📊 Health: http://localhost:${PORT}/api/health\n`);
});

module.exports = app;