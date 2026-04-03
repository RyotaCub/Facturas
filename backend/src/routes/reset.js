/**
 * FIX #3: La restricción de producción se aplica en index.js
 * antes de llegar a esta ruta. Este archivo no cambia su lógica.
 */
const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');

router.post('/', async (req, res) => {
  const { fecha_inicio, fecha_fin } = req.body;

  if (!fecha_inicio || !fecha_fin) {
    return res.status(400).json({ success: false, error: 'Se requieren fecha_inicio y fecha_fin' });
  }
  if (fecha_inicio > fecha_fin) {
    return res.status(400).json({ success: false, error: 'fecha_inicio no puede ser mayor que fecha_fin' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log(`🔄 Reseteo del sistema (${fecha_inicio} → ${fecha_fin})...`);

    const { rows: periodosAfectados } = await client.query(
      `SELECT id FROM periodos WHERE fecha_inicio <= $2 AND fecha_fin >= $1`,
      [fecha_inicio, fecha_fin]
    );
    const periodosIds       = periodosAfectados.map(p => p.id);
    const periodosEliminados = periodosIds.length;

    let facturasEliminadas  = 0;
    let resumenesEliminados = 0;

    if (periodosIds.length > 0) {
      const inClause = periodosIds.map((_, i) => `$${i + 1}`).join(',');

      const { rows: factCount } = await client.query(
        `SELECT COUNT(*) AS total FROM facturas WHERE periodo_id IN (${inClause})`, periodosIds
      );
      facturasEliminadas = parseInt(factCount[0].total);

      await client.query(
        `DELETE FROM transferencias_usadas WHERE factura_id IN (SELECT id FROM facturas WHERE periodo_id IN (${inClause}))`, periodosIds
      );
      await client.query(
        `DELETE FROM factura_items WHERE factura_id IN (SELECT id FROM facturas WHERE periodo_id IN (${inClause}))`, periodosIds
      );
      await client.query(`DELETE FROM facturas WHERE periodo_id IN (${inClause})`, periodosIds);
      console.log(`✓ ${facturasEliminadas} facturas eliminadas`);

      const { rows: resCount } = await client.query(
        `SELECT COUNT(*) AS total FROM resumenes_minoristas WHERE periodo_id IN (${inClause})`, periodosIds
      );
      resumenesEliminados = parseInt(resCount[0].total);

      await client.query(
        `DELETE FROM transferencias_usadas WHERE resumen_id IN (SELECT id FROM resumenes_minoristas WHERE periodo_id IN (${inClause}))`, periodosIds
      );
      await client.query(
        `DELETE FROM resumen_items WHERE resumen_id IN (SELECT id FROM resumenes_minoristas WHERE periodo_id IN (${inClause}))`, periodosIds
      );
      await client.query(`DELETE FROM resumenes_minoristas WHERE periodo_id IN (${inClause})`, periodosIds);
      console.log(`✓ ${resumenesEliminados} resúmenes eliminados`);

      await client.query(`DELETE FROM periodos WHERE id IN (${inClause})`, periodosIds);
      console.log(`✓ ${periodosEliminados} período(s) eliminado(s)`);
    }

    await client.query(
      `UPDATE transferencias SET usada = FALSE
       WHERE usada = TRUE
         AND id NOT IN (SELECT DISTINCT transferencia_id FROM transferencias_usadas)`
    );
    console.log('✓ Transferencias liberadas');

    await client.query(`
      UPDATE productos
      SET disponible_um_minorista = disponible_original,
          updated_at = CURRENT_TIMESTAMP
      WHERE fecha_inicio <= $2 AND fecha_fin >= $1
    `, [fecha_inicio, fecha_fin]);
    console.log('✓ Productos restaurados a disponibilidad original');

    // Ajustar la secuencia siempre al último consecutivo que quede en BD
    const { rows: [{ max_consec }] } = await client.query(
      'SELECT COALESCE(MAX(consecutivo), 0) AS max_consec FROM facturas'
    );
    const siguienteVal = parseInt(max_consec) + 1;
    await client.query(
      `SELECT setval('factura_consecutivo_seq', $1, false)`,
      [siguienteVal]
    );
    console.log(`✓ Secuencia de facturas ajustada a ${siguienteVal} (último consecutivo: ${max_consec})`);

    await client.query('COMMIT');
    console.log('✅ Reseteo completado');

    res.json({
      success: true,
      message: 'Reseteo completado exitosamente',
      resumen: { periodosEliminados, facturasEliminadas, resumenesEliminados },
      timestamp: new Date().toISOString(),
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error al resetear:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;