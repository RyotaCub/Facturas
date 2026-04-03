/**
 * Pool dinámico con soporte para dos bases de datos: prueba / real.
 * Exporta un proxy — todas las rutas existentes funcionan sin cambios.
 */
const { Pool } = require('pg');
require('dotenv').config();

let activeDB = 'prueba';
const pools = {};

function createPool(dbName) {
  const p = new Pool({
    host:     process.env.DB_HOST,
    port:     parseInt(process.env.DB_PORT) || 5432,
    database: dbName,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    max:                     20,
    idleTimeoutMillis:       30000,
    connectionTimeoutMillis: 5000,
  });
  p.on('connect', () => console.log(`✅ PostgreSQL conectado [${dbName}]`));
  p.on('error',  (err) => console.error(`❌ Error pool [${dbName}]:`, err.message));
  return p;
}

function getPool() {
  if (!pools[activeDB]) {
    const dbName = activeDB === 'real'
      ? process.env.DB_NAME_REAL
      : (process.env.DB_NAME_PRUEBA || process.env.DB_NAME);
    if (!dbName) throw new Error(`Variable DB_NAME_${activeDB.toUpperCase()} no configurada`);
    pools[activeDB] = createPool(dbName);
  }
  return pools[activeDB];
}

// Proxy: todas las rutas usan pool.query / pool.connect sin cambios
const poolProxy = {
  query:   (...args) => getPool().query(...args),
  connect: (...args) => getPool().connect(...args),
  end:     (...args) => getPool().end(...args),
  on:      (...args) => getPool().on(...args),
};

poolProxy.switchDB    = (target) => {
  if (target !== 'prueba' && target !== 'real') throw new Error('BD inválida. Usar "prueba" o "real".');
  activeDB = target;
};
poolProxy.getActiveDB = () => activeDB;

module.exports = poolProxy;
