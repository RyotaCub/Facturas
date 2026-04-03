/**
 * FIX #4:  Contraseña sin fallback inseguro — falla al arrancar si no hay credenciales.
 * FIX #7:  Rate limiting en /login (10 intentos por 15 min por IP).
 */
const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const { sign } = require('../lib/jwt');

// ── Validación de arranque ────────────────────────────────────────────────
const ADMIN_USER  = process.env.ADMIN_USER;
const ADMIN_HASH  = process.env.ADMIN_PASS_HASH || null;
const ADMIN_PASS  = process.env.ADMIN_PASS || null;
const VIEWER_USER = process.env.VIEWER_USER || null;
const VIEWER_PASS = process.env.VIEWER_PASS || null;

if (!ADMIN_USER) {
  console.error('FATAL: ADMIN_USER no está configurado en las variables de entorno.');
  process.exit(1);
}
if (!ADMIN_HASH && !ADMIN_PASS) {
  console.error('FATAL: Se requiere ADMIN_PASS o ADMIN_PASS_HASH en las variables de entorno.');
  console.error('       No existe contraseña por defecto por razones de seguridad.');
  process.exit(1);
}

// ── Rate limiting simple en memoria (sin dependencias externas) ───────────
// Mapa: IP → { count, resetAt }
const loginAttempts = new Map();
const MAX_ATTEMPTS  = 10;
const WINDOW_MS     = 15 * 60 * 1000; // 15 minutos

function rateLimitLogin(req, res, next) {
  const ip  = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  let entry = loginAttempts.get(ip);

  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    loginAttempts.set(ip, entry);
  }

  if (entry.count >= MAX_ATTEMPTS) {
    const waitSec = Math.ceil((entry.resetAt - now) / 1000);
    return res.status(429).json({
      error: `Demasiados intentos fallidos. Intente en ${waitSec} segundos.`,
    });
  }

  // Limpiar entradas antiguas ocasionalmente
  if (loginAttempts.size > 1000) {
    for (const [k, v] of loginAttempts) {
      if (now > v.resetAt) loginAttempts.delete(k);
    }
  }

  req._loginEntry = entry;
  next();
}

function checkPassword(input) {
  if (ADMIN_HASH) {
    const inputHash = crypto.createHash('sha256').update(input).digest('hex');
    const hashBuf   = Buffer.from(ADMIN_HASH);
    const inputBuf  = Buffer.from(inputHash);
    if (hashBuf.length !== inputBuf.length) return false;
    return crypto.timingSafeEqual(hashBuf, inputBuf);
  }
  // Comparación segura en texto plano (solo para desarrollo)
  const passBuf  = Buffer.from(ADMIN_PASS.padEnd(64));
  const inputBuf = Buffer.from(input.padEnd(64));
  return crypto.timingSafeEqual(passBuf, inputBuf);
}

// POST /api/auth/login
router.post('/login', rateLimitLogin, (req, res) => {
  const { usuario, password } = req.body;

  if (!usuario || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }

  let role = null;
  if (usuario === ADMIN_USER && checkPassword(password)) {
    role = 'admin';
  } else if (VIEWER_USER && usuario === VIEWER_USER && VIEWER_PASS) {
    const viewerBuf = Buffer.from(VIEWER_PASS.padEnd(64));
    const inputBuf  = Buffer.from(password.padEnd(64));
    if (viewerBuf.length === inputBuf.length && crypto.timingSafeEqual(viewerBuf, inputBuf)) {
      role = 'viewer';
    }
  }

  if (!role) {
    // Incrementar contador de intentos fallidos
    if (req._loginEntry) req._loginEntry.count += 1;
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }

  // Login exitoso: resetear contador
  if (req._loginEntry) req._loginEntry.count = 0;

  const token = sign({ usuario, role });
  res.json({ token, usuario, role });
});

// GET /api/auth/me — verificar token activo
router.get('/me', (req, res) => {
  const { requireAuth } = require('../middleware/auth');
  requireAuth(req, res, () => res.json({
    usuario: req.user.usuario,
    role:    req.user.role,
  }));
});

module.exports = router;
