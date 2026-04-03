const pool = require('../db/pool');

/**
 * Script para validar que las transferencias coincidan con las fechas de disponibilidad de productos
 * 
 * Esto asegura que solo se puedan usar transferencias que estén dentro del período
 * de disponibilidad de los productos activos.
 */

async function validateTransferencias() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 Validando transferencias vs fechas de productos...\n');

    // Obtener rango de fechas de productos activos
    const { rows: rangoProductos } = await client.query(`
      SELECT 
        MIN(fecha_inicio) as fecha_min,
        MAX(fecha_fin) as fecha_max,
        COUNT(*) as total_productos
      FROM productos 
      WHERE activo = TRUE 
        AND fecha_inicio IS NOT NULL 
        AND fecha_fin IS NOT NULL
    `);

    if (!rangoProductos[0].total_productos) {
      console.log('⚠️  No hay productos con fechas definidas.');
      return;
    }

    const { fecha_min, fecha_max, total_productos } = rangoProductos[0];
    console.log(`📦 Productos activos: ${total_productos}`);
    console.log(`📅 Rango de fechas de productos: ${fecha_min} → ${fecha_max}\n`);

    // Contar transferencias fuera del rango
    const { rows: stats } = await client.query(`
      SELECT 
        COUNT(*) FILTER (WHERE fecha < $1) as antes,
        COUNT(*) FILTER (WHERE fecha > $2) as despues,
        COUNT(*) FILTER (WHERE fecha BETWEEN $1 AND $2) as dentro,
        COUNT(*) as total
      FROM transferencias
      WHERE tipo = 'CR'
    `, [fecha_min, fecha_max]);

    console.log('📊 Estadísticas de transferencias CR:');
    console.log(`   Total: ${stats[0].total}`);
    console.log(`   Dentro del rango: ${stats[0].dentro} ✓`);
    console.log(`   Antes del rango: ${stats[0].antes} ${stats[0].antes > 0 ? '⚠️' : ''}`);
    console.log(`   Después del rango: ${stats[0].despues} ${stats[0].despues > 0 ? '⚠️' : ''}\n`);

    // Mostrar transferencias problemáticas
    if (parseInt(stats[0].antes) > 0 || parseInt(stats[0].despues) > 0) {
      console.log('⚠️  Transferencias fuera del rango de productos:\n');
      
      const { rows: problematicas } = await client.query(`
        SELECT fecha, ref_origen, importe, nombre
        FROM transferencias
        WHERE tipo = 'CR'
          AND (fecha < $1 OR fecha > $2)
        ORDER BY fecha
        LIMIT 10
      `, [fecha_min, fecha_max]);

      problematicas.forEach(t => {
        const fuera = new Date(t.fecha) < new Date(fecha_min) ? 'ANTES' : 'DESPUÉS';
        console.log(`   ${fuera} | ${t.fecha} | ${t.ref_origen} | $${t.importe} | ${t.nombre || 'N/A'}`);
      });

      if (problematicas.length === 10) {
        console.log('   ... (mostrando solo las primeras 10)');
      }

      console.log('\n💡 Sugerencia: Ajusta las fechas de tus productos para incluir estas transferencias,');
      console.log('   o ajusta las fechas de las transferencias para que coincidan con los productos.\n');
    } else {
      console.log('✅ Todas las transferencias CR están dentro del rango de fechas de productos.\n');
    }

    // Verificar si hay transferencias usadas fuera del rango
    const { rows: usadas } = await client.query(`
      SELECT COUNT(*) as count
      FROM transferencias t
      WHERE tipo = 'CR' 
        AND usada = TRUE
        AND (fecha < $1 OR fecha > $2)
    `, [fecha_min, fecha_max]);

    if (parseInt(usadas[0].count) > 0) {
      console.log(`⚠️  Hay ${usadas[0].count} transferencias USADAS fuera del rango.`);
      console.log('   Considera resetear el sistema si esto no es correcto.\n');
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

// Ejecutar si se llama directamente
if (require.main === module) {
  validateTransferencias().catch(console.error);
}

module.exports = { validateTransferencias };
