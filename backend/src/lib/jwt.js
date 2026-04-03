/**
 * JWT usando crypto nativo de Node.js — HS256
 * FIX #2: exp usa segundos (estándar JWT), no milisegundos.
 * FIX #14: Falla al arrancar si JWT_SECRET no está configurado.
 */
const crypto = require('crypto');

const SECRET = process.env.JWT_SECRET;
const EXPIRES_IN_SEC = 8 * 60 * 60; // 8 horas en segundos

// ── Validación de arranque ────────────────────────────────────────────────
if (!SECRET || SECRET === 'CAMBIAR_AQUI' || SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET no está configurado o es demasiado corto (mínimo 32 caracteres).');
  console.error('       Genera uno con: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
  process.exit(1);
}

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj))
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function sign(payload) {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const body   = b64url({ ...payload, iat: nowSec, exp: nowSec + EXPIRES_IN_SEC });
  const sig    = crypto.createHmac('sha256', SECRET)
    .update(`${header}.${body}`)
    .digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${header}.${body}.${sig}`;
}

function verify(token) {
  if (!token) throw new Error('Token requerido');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Token inválido');
  const [header, body, sig] = parts;

  // Verificar firma
  const expected = crypto.createHmac('sha256', SECRET)
    .update(`${header}.${body}`)
    .digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  // Comparación segura para evitar timing attacks
  const sigBuf      = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    throw new Error('Firma inválida');
  }

  const payload = JSON.parse(Buffer.from(body, 'base64').toString());

  // FIX: comparar en segundos (estándar JWT)
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expirado');
  }

  return payload;
}

module.exports = { sign, verify };
