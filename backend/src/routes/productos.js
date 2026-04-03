/**
 * FIX #22: PUT no actualiza disponible_original (solo se toca al crear
 *          o al hacer reset — no en edición manual del usuario).
 * FIX #5:  Validación de tipos en los campos numéricos del body.
 */
const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');

// GET all productos
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT *,
        CASE
          WHEN fecha_inicio IS NULL OR fecha_fin IS NULL THEN 'sin_fechas'
          WHEN CURRENT_DATE < fecha_inicio THEN 'pendiente'
          WHEN CURRENT_DATE > fecha_fin    THEN 'expirado'
          ELSE 'activo'
        END AS estado
       FROM productos WHERE activo = TRUE ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /resumen-mensual — DEBE ir antes de /:id
router.get('/resumen-mensual', async (req, res) => {
  try {
    const { rows: productos } = await pool.query(`
      SELECT id, codigo, producto, disponible_um_minorista, importe,
             fecha_inicio, fecha_fin,
             (disponible_um_minorista * importe) AS valor_real
      FROM productos
      WHERE activo = TRUE
        AND fecha_inicio IS NOT NULL AND fecha_fin IS NOT NULL
        AND disponible_um_minorista > 0
      ORDER BY fecha_inicio ASC
    `);
    if (!productos.length) return res.json({ meses: [], total_productos: 0 });

    const ymKey = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`;
    let minDate = null, maxDate = null;
    for (const p of productos) {
      const fi = new Date(p.fecha_inicio + 'T00:00:00Z');
      const ff = new Date(p.fecha_fin    + 'T00:00:00Z');
      if (!minDate || fi < minDate) minDate = fi;
      if (!maxDate || ff > maxDate) maxDate = ff;
    }
    const meses = [];
    const cur = new Date(Date.UTC(minDate.getUTCFullYear(), minDate.getUTCMonth(), 1));
    const end = new Date(Date.UTC(maxDate.getUTCFullYear(), maxDate.getUTCMonth(), 1));
    while (cur <= end) {
      meses.push(ymKey(cur.getUTCFullYear(), cur.getUTCMonth()));
      cur.setUTCMonth(cur.getUTCMonth() + 1);
    }
    const resumen = meses.map(mes => {
      const [y, m] = mes.split('-').map(Number);
      const inicioMes = new Date(Date.UTC(y, m - 1, 1));
      const finMes    = new Date(Date.UTC(y, m, 0));
      const productosActivos = productos.filter(p => {
        const fi = new Date(p.fecha_inicio + 'T00:00:00Z');
        const ff = new Date(p.fecha_fin    + 'T00:00:00Z');
        return fi <= finMes && ff >= inicioMes;
      });
      const total   = productosActivos.reduce((s, p) => s + parseFloat(p.valor_real), 0);
      const detalle = productosActivos.map(p => ({
        id: p.id, codigo: p.codigo, producto: p.producto,
        valor_real: parseFloat(p.valor_real),
      }));
      return { mes, total, cantidad_productos: productosActivos.length, detalle };
    });
    res.json({ meses: resumen, total_productos: productos.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single producto
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM productos WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create producto
router.post('/', async (req, res) => {
  const {
    codigo, producto, um_mayorista, um_minorista,
    formato, disponible_um_minorista, fecha_inicio, fecha_fin,
    importe_mayorista, importe, activo,
    cantidad_minima, vende_decimales, peso_pieza_min, peso_pieza_max, formato_rango,
    categoria,
  } = req.body;

  if (!codigo || !producto || !um_mayorista || !um_minorista) {
    return res.status(400).json({ error: 'Campos requeridos: codigo, producto, um_mayorista, um_minorista' });
  }

  const fmt_       = parseFloat(formato) || 1;
  const impMay     = parseFloat(importe_mayorista) || 0;
  const impMin     = parseFloat(importe) > 0 ? parseFloat(importe) : (impMay > 0 ? impMay / fmt_ : 0);
  const cantMin    = parseInt(cantidad_minima) || 0;
  const venDec     = vende_decimales === true || vende_decimales === 1;
  const pMin       = peso_pieza_min  ? parseFloat(peso_pieza_min)  : null;
  const pMax       = peso_pieza_max  ? parseFloat(peso_pieza_max)  : null;
  const fmtRango   = formato_rango === true || formato_rango === 1;
  const disponible = parseFloat(disponible_um_minorista) || 0;
  const cat        = categoria || 'otros';

  try {
    const { rows } = await pool.query(
      `INSERT INTO productos
         (codigo, producto, um_mayorista, um_minorista, formato,
          disponible_um_minorista, disponible_original,
          fecha_inicio, fecha_fin, importe_mayorista, importe, activo,
          cantidad_minima, vende_decimales, peso_pieza_min, peso_pieza_max, formato_rango, categoria)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [codigo, producto, um_mayorista, um_minorista, fmt_,
       disponible, fecha_inicio || null, fecha_fin || null,
       impMay, impMin, activo !== undefined ? activo : true,
       cantMin, venDec, pMin, pMax, fmtRango, cat]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe un producto con ese código' });
    res.status(500).json({ error: err.message });
  }
});

// PUT update producto
// FIX #22: NO actualiza disponible_original — solo disponible_um_minorista.
// disponible_original solo cambia al crear o al hacer reset.
router.put('/:id', async (req, res) => {
  const {
    codigo, producto, um_mayorista, um_minorista,
    formato, disponible_um_minorista, fecha_inicio, fecha_fin,
    importe_mayorista, importe, activo,
    cantidad_minima, vende_decimales, peso_pieza_min, peso_pieza_max, formato_rango,
    categoria,
  } = req.body;

  const fmt_     = parseFloat(formato) || 1;
  const impMay   = parseFloat(importe_mayorista) || 0;
  const impMin   = parseFloat(importe) > 0 ? parseFloat(importe) : (impMay > 0 ? impMay / fmt_ : 0);
  const cantMin  = parseInt(cantidad_minima) || 0;
  const venDec   = vende_decimales === true || vende_decimales === 1;
  const pMin     = peso_pieza_min  ? parseFloat(peso_pieza_min)  : null;
  const pMax     = peso_pieza_max  ? parseFloat(peso_pieza_max)  : null;
  const fmtRango = formato_rango === true || formato_rango === 1;
  const cat      = categoria || 'otros';

  try {
    const { rows } = await pool.query(
      `UPDATE productos
       SET codigo=$1, producto=$2, um_mayorista=$3, um_minorista=$4, formato=$5,
           disponible_um_minorista=$6,
           fecha_inicio=$7, fecha_fin=$8,
           importe_mayorista=$9, importe=$10, activo=$11,
           cantidad_minima=$12, vende_decimales=$13,
           peso_pieza_min=$14, peso_pieza_max=$15, formato_rango=$16,
           categoria=$17,
           updated_at=CURRENT_TIMESTAMP
       WHERE id=$18
       RETURNING *`,
      [codigo, producto, um_mayorista, um_minorista, fmt_,
       parseFloat(disponible_um_minorista) || 0,
       fecha_inicio || null, fecha_fin || null,
       impMay, impMin, activo !== undefined ? activo : true,
       cantMin, venDec, pMin, pMax, fmtRango, cat, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe un producto con ese código' });
    res.status(500).json({ error: err.message });
  }
});

// DELETE producto (hard delete — solo si no está referenciado en facturas)
router.delete('/:id', async (req, res) => {
  try {
    const { rows: refs } = await pool.query(
      'SELECT COUNT(*) AS total FROM factura_items WHERE producto_id = $1', [req.params.id]
    );
    if (parseInt(refs[0].total) > 0) {
      return res.status(409).json({
        error: 'No se puede eliminar: el producto está referenciado en facturas. Desactívalo en su lugar.',
      });
    }
    const { rows } = await pool.query(
      'DELETE FROM productos WHERE id=$1 RETURNING id', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json({ message: 'Producto eliminado', id: rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;