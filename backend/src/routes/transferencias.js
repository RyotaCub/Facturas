/**
 * FIX #5: Validación de tipos en query params para evitar NaN en queries.
 */
const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');

// Helpers de validación
function parseDate(val) {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : val;
}
function parsePositiveFloat(val) {
  const n = parseFloat(val);
  return isNaN(n) || n < 0 ? null : n;
}
function parsePage(val) {
  const n = parseInt(val);
  return isNaN(n) || n < 1 ? 1 : n;
}

// GET all transferencias con filtros y paginación
router.get('/', async (req, res) => {
  try {
    const { tipo, usada, prefijo } = req.query;
    const fecha_inicio = parseDate(req.query.fecha_inicio);
    const fecha_fin    = parseDate(req.query.fecha_fin);
    const menor_que    = parsePositiveFloat(req.query.menor_que);
    const mayor_que    = parsePositiveFloat(req.query.mayor_que);

    if (req.query.fecha_inicio && !fecha_inicio)
      return res.status(400).json({ error: 'fecha_inicio no es una fecha válida' });
    if (req.query.fecha_fin && !fecha_fin)
      return res.status(400).json({ error: 'fecha_fin no es una fecha válida' });
    if (fecha_inicio && fecha_fin && fecha_inicio > fecha_fin)
      return res.status(400).json({ error: 'fecha_inicio no puede ser mayor que fecha_fin' });
    if (req.query.menor_que && menor_que === null)
      return res.status(400).json({ error: 'menor_que debe ser un número positivo' });
    if (req.query.mayor_que && mayor_que === null)
      return res.status(400).json({ error: 'mayor_que debe ser un número positivo' });

    const page   = parsePage(req.query.page);
    const limit  = Math.min(9999, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    let whereClause = `WHERE 1=1`;
    const params = [];
    let i = 1;
    if (tipo)         { whereClause += ` AND tipo = $${i++}`;    params.push(tipo); }
    if (prefijo)      { whereClause += ` AND prefijo = $${i++}`; params.push(prefijo); }
    if (usada !== undefined && usada !== '') {
      whereClause += ` AND usada = $${i++}`;
      params.push(usada === 'true');
    }
    if (fecha_inicio) { whereClause += ` AND fecha >= $${i++}`;  params.push(fecha_inicio); }
    if (fecha_fin)    { whereClause += ` AND fecha <= $${i++}`;  params.push(fecha_fin); }
    if (menor_que !== null) { whereClause += ` AND importe < $${i++}`; params.push(menor_que); }
    if (mayor_que !== null) { whereClause += ` AND importe > $${i++}`; params.push(mayor_que); }

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) AS total FROM transferencias ${whereClause}`, params
    );
    const total = parseInt(countRows[0].total);

    const dataParams = [...params, limit, offset];
    const { rows }   = await pool.query(
      `SELECT * FROM transferencias ${whereClause} ORDER BY fecha ASC, importe DESC LIMIT $${i++} OFFSET $${i++}`,
      dataParams
    );
    res.json({ data: rows, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET estadísticas
router.get('/stats', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE tipo='CR' AND prefijo IN ('98','MM','KW','JD','AY','VB','AJ','DD')) AS total_cr,
        COUNT(*) FILTER (WHERE tipo='DB') AS total_db,
        COALESCE(SUM(importe) FILTER (WHERE tipo='CR' AND prefijo IN ('98','MM','KW','JD','AY','VB','AJ','DD')), 0) AS monto_cr,
        COALESCE(SUM(importe) FILTER (WHERE tipo='DB'), 0) AS monto_db,
        COUNT(*) FILTER (WHERE tipo='CR' AND usada=TRUE  AND prefijo IN ('98','MM','KW','JD','AY','VB','AJ','DD')) AS cr_usadas,
        COUNT(*) FILTER (WHERE tipo='CR' AND usada=FALSE AND prefijo IN ('98','MM','KW','JD','AY','VB','AJ','DD')) AS cr_disponibles,
        COALESCE(SUM(importe) FILTER (WHERE tipo='CR' AND usada=FALSE AND prefijo IN ('98','MM','KW','JD','AY','VB','AJ','DD')), 0) AS monto_disponible,
        MIN(fecha) AS fecha_inicio,
        MAX(fecha) AS fecha_fin,
        COUNT(DISTINCT ci) FILTER (WHERE ci IS NOT NULL AND ci <> '') AS clientes_unicos
      FROM transferencias
    `);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET clientes pool
router.get('/clientes', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM clientes ORDER BY nombre');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /:id — actualiza nombre y/o CI
router.patch('/:id', async (req, res) => {
  try {
    const { id }     = req.params;
    const { nombre, ci } = req.body;

    const fields = [];
    const params = [];
    let i = 1;

    if (nombre !== undefined) { fields.push(`nombre = $${i++}`); params.push(nombre || null); }
    if (ci     !== undefined) { fields.push(`ci = $${i++}`);     params.push(ci     || null); }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'Nada que actualizar' });
    }

    params.push(id);
    const { rows } = await pool.query(
      `UPDATE transferencias SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Transferencia no encontrada' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /bulk — elimina transferencias por rango de fecha y/o prefijo
// Solo elimina las que NO están usadas (usada = FALSE) para no romper cuadres.
router.delete('/bulk', async (req, res) => {
  try {
    const { fecha_inicio, fecha_fin, prefijo } = req.body;

    if (!fecha_inicio && !fecha_fin && !prefijo) {
      return res.status(400).json({ error: 'Debes indicar al menos un filtro: fecha_inicio, fecha_fin o prefijo' });
    }
    if (fecha_inicio && fecha_fin && fecha_inicio > fecha_fin) {
      return res.status(400).json({ error: 'fecha_inicio no puede ser mayor que fecha_fin' });
    }

    let where = `WHERE usada = FALSE`;
    const params = [];
    let i = 1;
    if (fecha_inicio) { where += ` AND fecha >= $${i++}`; params.push(fecha_inicio); }
    if (fecha_fin)    { where += ` AND fecha <= $${i++}`; params.push(fecha_fin); }
    if (prefijo)      { where += ` AND prefijo = $${i++}`; params.push(prefijo); }

    // Primero contar cuántas se van a eliminar
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) AS total FROM transferencias ${where}`, params
    );
    const total = parseInt(countRows[0].total);

    if (total === 0) {
      return res.json({ success: true, eliminadas: 0, message: 'No hay transferencias disponibles que coincidan con los filtros.' });
    }

    const { rows } = await pool.query(
      `DELETE FROM transferencias ${where} RETURNING id`, params
    );

    res.json({
      success: true,
      eliminadas: rows.length,
      message: `${rows.length} transferencia${rows.length !== 1 ? 's' : ''} eliminada${rows.length !== 1 ? 's' : ''} correctamente.`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET prefijos distintos con conteo
router.get('/prefijos', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT prefijo, COUNT(*) AS total
      FROM transferencias
      WHERE prefijo IS NOT NULL
      GROUP BY prefijo
      ORDER BY total DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /by-ids — elimina transferencias por array de IDs (solo las no usadas)
router.delete('/by-ids', async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Debes enviar un array de ids no vacío' });
    }

    // Filtrar solo enteros válidos para evitar inyección
    const validIds = ids.map(id => parseInt(id)).filter(id => !isNaN(id));
    if (validIds.length === 0) {
      return res.status(400).json({ error: 'No se encontraron IDs válidos' });
    }

    // Solo elimina las no usadas para no romper cuadres
    const placeholders = validIds.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await pool.query(
      `DELETE FROM transferencias WHERE id IN (${placeholders}) AND usada = FALSE RETURNING id`,
      validIds
    );

    const omitidas = validIds.length - rows.length;
    res.json({
      success: true,
      eliminadas: rows.length,
      omitidas,
      message: `${rows.length} transferencia${rows.length !== 1 ? 's' : ''} eliminada${rows.length !== 1 ? 's' : ''} correctamente.${omitidas > 0 ? ` (${omitidas} omitida${omitidas !== 1 ? 's' : ''} por estar usadas)` : ''}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;