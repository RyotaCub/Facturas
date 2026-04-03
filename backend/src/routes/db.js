const router = require('express').Router();
const pool   = require('../db/pool');

// GET /api/db/status — devuelve la BD activa
router.get('/status', (req, res) => {
  res.json({ db: pool.getActiveDB() });
});

// POST /api/db/switch — cambia la BD activa { db: 'prueba' | 'real' }
router.post('/switch', (req, res) => {
  const { db } = req.body;
  try {
    pool.switchDB(db);
    console.log(`[DB] Cambio de BD → ${db} (usuario: ${req.user?.username})`);
    res.json({ db: pool.getActiveDB() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
