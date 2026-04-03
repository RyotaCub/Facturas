const { verify } = require('../lib/jwt');

/**
 * Middleware de autenticación.
 * Extrae el token del header Authorization: Bearer <token>
 * y lo verifica. Si es válido, adjunta el payload a req.user.
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado — token requerido' });
  }
  const token = authHeader.slice(7);
  try {
    req.user = verify(token);
    next();
  } catch (err) {
    return res.status(401).json({ error: `No autorizado — ${err.message}` });
  }
}

/**
 * Middleware de autorización por rol.
 * Uso: requireRole('admin') o requireRole('admin', 'viewer')
 * Debe usarse siempre después de requireAuth.
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Acceso denegado — permisos insuficientes' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
