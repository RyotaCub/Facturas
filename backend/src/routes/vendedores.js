const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM vendedores ORDER BY activo DESC, nombre ASC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { nombre } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO vendedores (nombre) VALUES ($1) ON CONFLICT (nombre) DO UPDATE SET activo=TRUE RETURNING *',
      [nombre.toUpperCase()]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const { nombre, activo } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    const { rows } = await pool.query(
      `UPDATE vendedores
       SET nombre = $1,
           activo = $2
       WHERE id = $3
       RETURNING *`,
      [nombre.toUpperCase(), activo !== undefined ? activo : true, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Vendedor no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('UPDATE vendedores SET activo=FALSE WHERE id=$1', [req.params.id]);
    res.json({ message: 'Vendedor eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
