/**
 * FIX #9: Pool con max conexiones, timeouts y manejo de errores.
 */
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,

  // FIX: límites y timeouts
  max:                    20,    // máximo 20 conexiones simultáneas
  idleTimeoutMillis:      30000, // cerrar conexiones ociosas tras 30s
  connectionTimeoutMillis: 5000, // error si no hay conexión en 5s
});

pool.on('connect', () => {
  console.log('✅ PostgreSQL conectado');
});

pool.on('error', (err) => {
  console.error('❌ Error en pool de PostgreSQL:', err.message);
  // No salir del proceso — el pool se recupera solo
});

module.exports = pool;
