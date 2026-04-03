const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');

// GET / — todos los clientes con estadísticas
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        c.id, c.nombre, c.ci, c.fuente, c.created_at,
        COUNT(DISTINCT t.id)  AS total_transferencias,
        COUNT(DISTINCT f.id)  AS total_facturas,
        COALESCE(SUM(DISTINCT f.total), 0) AS total_facturado,
        MAX(t.fecha) AS ultima_transferencia,
        MAX(f.fecha) AS ultima_factura
      FROM clientes c
      LEFT JOIN transferencias t ON t.ci = c.ci
      LEFT JOIN facturas f       ON f.cliente_ci = c.ci AND f.anulada = FALSE
      GROUP BY c.id
      ORDER BY c.nombre ASC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /duplicados — detecta CIs con nombres distintos y nombres similares
router.get('/duplicados', async (req, res) => {
  try {
    // Mismo CI, distintos nombres (en transferencias vs clientes)
    const { rows: mismoCI } = await pool.query(`
      SELECT
        c.ci,
        c.nombre AS nombre_clientes,
        t.nombre AS nombre_transferencias,
        COUNT(t.id) AS ocurrencias
      FROM clientes c
      JOIN transferencias t ON t.ci = c.ci AND LOWER(TRIM(t.nombre)) <> LOWER(TRIM(c.nombre))
      GROUP BY c.ci, c.nombre, t.nombre
      ORDER BY ocurrencias DESC
      LIMIT 50
    `);

    // CIs duplicados en tabla clientes (no debería pasar por UNIQUE, pero por si acaso)
    const { rows: ciDups } = await pool.query(`
      SELECT ci, COUNT(*) AS cnt, ARRAY_AGG(nombre) AS nombres
      FROM clientes
      GROUP BY ci
      HAVING COUNT(*) > 1
    `);

    res.json({ mismoCI, ciDups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM clientes WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST / — crear cliente manual
router.post('/', async (req, res) => {
  const { nombre, ci } = req.body;
  if (!nombre || !ci) return res.status(400).json({ error: 'Nombre y CI requeridos' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO clientes (nombre, ci, fuente)
       VALUES ($1, $2, 'manual') RETURNING *`,
      [nombre.trim().toUpperCase(), ci.trim()]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Ya existe un cliente con ese CI' });
    res.status(500).json({ error: err.message });
  }
});

// PUT /:id — editar nombre y/o CI
router.put('/:id', async (req, res) => {
  const { nombre, ci } = req.body;
  if (!nombre || !ci) return res.status(400).json({ error: 'Nombre y CI requeridos' });
  try {
    // Actualizar también en transferencias y facturas si el CI cambió
    const { rows: prev } = await pool.query('SELECT * FROM clientes WHERE id = $1', [req.params.id]);
    if (!prev.length) return res.status(404).json({ error: 'Cliente no encontrado' });

    const oldCI    = prev[0].ci;
    const newNombre = nombre.trim().toUpperCase();
    const newCI    = ci.trim();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Actualizar cliente
      const { rows } = await client.query(
        'UPDATE clientes SET nombre=$1, ci=$2 WHERE id=$3 RETURNING *',
        [newNombre, newCI, req.params.id]
      );

      // Propagar nombre a transferencias con el mismo CI
      await client.query(
        `UPDATE transferencias SET nombre=$1 WHERE ci=$2`,
        [newNombre, oldCI]
      );

      // Si cambió el CI también actualizar facturas y transferencias
      if (newCI !== oldCI) {
        await client.query('UPDATE transferencias SET ci=$1 WHERE ci=$2', [newCI, oldCI]);
        await client.query(
          `UPDATE facturas SET cliente_ci=$1, cliente_nombre=$2
           WHERE cliente_ci=$3`,
          [newCI, newNombre, oldCI]
        );
      } else {
        // Solo actualizar nombre en facturas
        await client.query(
          `UPDATE facturas SET cliente_nombre=$1 WHERE cliente_ci=$2`,
          [newNombre, oldCI]
        );
      }

      await client.query('COMMIT');
      res.json({ ...rows[0], updated: true });
    } catch (err2) {
      await client.query('ROLLBACK');
      throw err2;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Ya existe un cliente con ese CI' });
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:id
router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM clientes WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Cliente no encontrado' });
    await pool.query('DELETE FROM clientes WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /sync — re-importar clientes desde transferencias
router.post('/sync', async (req, res) => {
  try {
    const { rowCount } = await pool.query(`
      INSERT INTO clientes (nombre, ci, fuente)
      SELECT DISTINCT
        UPPER(TRIM(nombre)), TRIM(ci), 'transferencia'
      FROM transferencias
      WHERE nombre IS NOT NULL AND TRIM(nombre) <> ''
        AND ci IS NOT NULL AND TRIM(ci) <> ''
      ON CONFLICT (ci) DO NOTHING
    `);
    res.json({ insertados: rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;