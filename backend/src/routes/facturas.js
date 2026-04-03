/**
 * FIX #12: Anulación de factura ahora revierte también disponible_original.
 * FIX #13: Soft-delete consistente — resúmenes minoristas también usan soft-delete.
 */
const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');

// GET all facturas mayoristas (con paginación)
router.get('/', async (req, res) => {
  try {
    const { periodo_id, fecha_inicio, fecha_fin } = req.query;
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(9999, Math.max(1, parseInt(req.query.limit) || 25));
    const offset = (page - 1) * limit;

    let whereClause = `WHERE f.anulada = FALSE`;
    const params = [];
    let i = 1;
    if (periodo_id)   { whereClause += ` AND f.periodo_id = $${i++}`;  params.push(periodo_id); }
    if (fecha_inicio) { whereClause += ` AND f.fecha >= $${i++}`;       params.push(fecha_inicio); }
    if (fecha_fin)    { whereClause += ` AND f.fecha <= $${i++}`;       params.push(fecha_fin); }

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) AS total FROM facturas f ${whereClause}`, params
    );
    const total = parseInt(countRows[0].total);

    const dataParams = [...params, limit, offset];
    const q = `
      SELECT f.*,
        (
          SELECT json_agg(json_build_object(
            'id', fi.id, 'producto', fi.producto, 'codigo', fi.codigo,
            'um', fi.um, 'cantidad', fi.cantidad, 'precio', fi.precio,
            'importe', fi.importe, 'num_piezas', fi.num_piezas
          ) ORDER BY fi.id)
          FROM factura_items fi WHERE fi.factura_id = f.id
        ) AS items,
        (
          SELECT json_agg(json_build_object(
            'ref', t.ref_origen, 'prefijo', t.prefijo, 'importe', tu.importe_aplicado
          ))
          FROM transferencias_usadas tu
          JOIN transferencias t ON t.id = tu.transferencia_id
          WHERE tu.factura_id = f.id
        ) AS transferencias_detalle
      FROM facturas f
      ${whereClause}
      ORDER BY f.fecha ASC, f.consecutivo ASC
      LIMIT $${i++} OFFSET $${i++}
    `;
    const { rows } = await pool.query(q, dataParams);
    res.json({ data: rows, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single factura
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT f.*,
        (
          SELECT json_agg(json_build_object(
            'id', fi.id, 'producto', fi.producto, 'codigo', fi.codigo,
            'um', fi.um, 'cantidad', fi.cantidad, 'precio', fi.precio,
            'importe', fi.importe, 'num_piezas', fi.num_piezas
          ) ORDER BY fi.id)
          FROM factura_items fi WHERE fi.factura_id = f.id
        ) AS items,
        (
          SELECT json_agg(json_build_object(
            'ref', t.ref_origen, 'prefijo', t.prefijo, 'importe', tu.importe_aplicado,
            'nombre', t.nombre, 'ci', t.ci
          ))
          FROM transferencias_usadas tu
          JOIN transferencias t ON t.id = tu.transferencia_id
          WHERE tu.factura_id = f.id
        ) AS transferencias_detalle
      FROM facturas f
      WHERE f.id = $1
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Factura no encontrada' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET resúmenes minoristas
router.get('/resumenes/minoristas', async (req, res) => {
  try {
    const { periodo_id } = req.query;
    let q = `
      SELECT rm.*,
        pv.nombre as punto_venta_nombre,
        (
          SELECT json_agg(producto_agrupado ORDER BY producto_agrupado->>'producto')
          FROM (
            SELECT json_build_object(
              'id', MIN(ri.id), 'producto', ri.producto, 'codigo', ri.codigo,
              'um', ri.um, 'cantidad', SUM(ri.cantidad),
              'precio', ri.precio, 'importe', SUM(ri.importe)
            ) as producto_agrupado
            FROM resumen_items ri
            WHERE ri.resumen_id = rm.id
            GROUP BY ri.producto, ri.codigo, ri.um, ri.precio
          ) productos_agrupados
        ) AS items,
        json_agg(json_build_object(
          'ref', t.ref_origen, 'prefijo', t.prefijo, 'importe', tu.importe_aplicado
        )) FILTER (WHERE t.id IS NOT NULL) AS transferencias_detalle
      FROM resumenes_minoristas rm
      LEFT JOIN puntos_venta pv ON pv.id = rm.punto_venta_id
      LEFT JOIN transferencias_usadas tu ON tu.resumen_id = rm.id
      LEFT JOIN transferencias t ON t.id = tu.transferencia_id
      WHERE rm.anulado = FALSE
    `;
    const params = [];
    if (periodo_id) { q += ` AND rm.periodo_id = $1`; params.push(periodo_id); }
    q += ` GROUP BY rm.id, pv.nombre ORDER BY rm.fecha DESC, pv.nombre`;
    const { rows } = await pool.query(q, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET períodos
router.get('/periodos/list', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*,
        COALESCE(f.num_facturas, 0)     AS num_facturas,
        COALESCE(rm.num_resumenes, 0)   AS num_resumenes,
        COALESCE(f.total_mayorista, 0)  AS total_mayorista,
        COALESCE(rm.total_minorista, 0) AS total_minorista
      FROM periodos p
      LEFT JOIN (
        SELECT periodo_id, COUNT(*) AS num_facturas, SUM(total) AS total_mayorista
        FROM facturas WHERE anulada = FALSE GROUP BY periodo_id
      ) f ON f.periodo_id = p.id
      LEFT JOIN (
        SELECT periodo_id, COUNT(*) AS num_resumenes, SUM(total) AS total_minorista
        FROM resumenes_minoristas WHERE anulado = FALSE GROUP BY periodo_id
      ) rm ON rm.periodo_id = p.id
      ORDER BY p.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE factura — soft-delete: marca como anulada y revierte inventario
router.delete('/:id', async (req, res) => {
  const { id }   = req.params;
  const motivo   = req.body?.motivo || null;
  const client   = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: facturaRows } = await client.query(
      'SELECT * FROM facturas WHERE id = $1', [id]
    );
    if (!facturaRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Factura no encontrada' });
    }
    if (facturaRows[0].anulada) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'La factura ya está anulada' });
    }

    // Revertir stock: tanto disponible_um_minorista como disponible_original
    // FIX #12: Ahora también restaura disponible_original para que el reset
    // futuro devuelva el valor correcto
    const { rows: items } = await client.query(
      'SELECT * FROM factura_items WHERE factura_id = $1', [id]
    );
    for (const item of items) {
      await client.query(
        `UPDATE productos
         SET disponible_um_minorista = disponible_um_minorista + $1,
             disponible_original     = disponible_original + $1,
             updated_at              = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [item.cantidad, item.producto_id]
      );
    }

    // Desmarcar transferencias usadas
    await client.query(
      'UPDATE transferencias SET usada = FALSE WHERE id IN (SELECT transferencia_id FROM transferencias_usadas WHERE factura_id = $1)',
      [id]
    );
    await client.query('DELETE FROM transferencias_usadas WHERE factura_id = $1', [id]);

    // Soft-delete
    await client.query(
      `UPDATE facturas SET anulada = TRUE, anulada_at = CURRENT_TIMESTAMP, anulada_motivo = $2 WHERE id = $1`,
      [id, motivo]
    );

    await client.query('COMMIT');
    res.json({ success: true, message: 'Factura anulada. El inventario fue revertido.' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /facturas/anuladas — historial
router.get('/anuladas/lista', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT f.*,
        json_agg(json_build_object(
          'id', fi.id, 'producto', fi.producto, 'codigo', fi.codigo,
          'um', fi.um, 'cantidad', fi.cantidad, 'precio', fi.precio,
          'importe', fi.importe, 'num_piezas', fi.num_piezas
        ) ORDER BY fi.id) FILTER (WHERE fi.id IS NOT NULL) AS items
      FROM facturas f
      LEFT JOIN factura_items fi ON fi.factura_id = f.id
      WHERE f.anulada = TRUE
      GROUP BY f.id
      ORDER BY f.anulada_at DESC NULLS LAST
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE resumen minorista — FIX #13: soft-delete (anulado = TRUE en vez de DELETE)
router.delete('/resumenes/minoristas/:id', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: resumenRows } = await client.query(
      'SELECT * FROM resumenes_minoristas WHERE id = $1', [id]
    );
    if (!resumenRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Resumen no encontrado' });
    }
    if (resumenRows[0].anulado) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'El resumen ya está anulado' });
    }

    // Revertir stock (disponible_um_minorista y disponible_original)
    const { rows: items } = await client.query(
      'SELECT * FROM resumen_items WHERE resumen_id = $1', [id]
    );
    for (const item of items) {
      await client.query(
        `UPDATE productos
         SET disponible_um_minorista = disponible_um_minorista + $1,
             disponible_original     = disponible_original + $1
         WHERE id = $2`,
        [item.cantidad, item.producto_id]
      );
    }

    // Desmarcar transferencias usadas
    await client.query(
      'UPDATE transferencias SET usada = FALSE WHERE id IN (SELECT transferencia_id FROM transferencias_usadas WHERE resumen_id = $1)',
      [id]
    );
    await client.query('DELETE FROM transferencias_usadas WHERE resumen_id = $1', [id]);

    // Soft-delete del resumen
    await client.query(
      `UPDATE resumenes_minoristas SET anulado = TRUE, anulado_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id]
    );

    await client.query('COMMIT');
    res.json({ success: true, message: 'Resumen anulado y stock revertido.' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;