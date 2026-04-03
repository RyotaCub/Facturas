const pool = require('./pool');

async function initDB() {
  const client = await pool.connect();
  try {
    console.log('🔧 Inicializando base de datos...');

    await client.query('BEGIN');

    // Tabla de transferencias (ya existe por el extractor, solo verificamos)
    await client.query(`
      CREATE TABLE IF NOT EXISTS transferencias (
        id SERIAL PRIMARY KEY,
        fecha DATE NOT NULL,
        ref_origen VARCHAR(50) NOT NULL,
        prefijo VARCHAR(10),
        importe DECIMAL(12,2) NOT NULL,
        tipo VARCHAR(2) NOT NULL CHECK (tipo IN ('CR','DB')),
        nombre VARCHAR(200),
        ci VARCHAR(20),
        fecha_procesamiento TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        usada BOOLEAN DEFAULT FALSE,
        CONSTRAINT uq_transferencias UNIQUE(fecha, ref_origen, importe, tipo)
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_fecha ON transferencias(fecha)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ci ON transferencias(ci)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tipo ON transferencias(tipo)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_usada ON transferencias(usada)`);

    // FIX #21: Índice compuesto para la query más frecuente en distribución
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tr_cr_activas
      ON transferencias(tipo, prefijo, usada, fecha)
      WHERE tipo = 'CR' AND usada = FALSE
    `);

    // Tabla de productos
    await client.query(`
      CREATE TABLE IF NOT EXISTS productos (
        id SERIAL PRIMARY KEY,
        codigo VARCHAR(50) NOT NULL UNIQUE,
        producto VARCHAR(200) NOT NULL,
        um_mayorista VARCHAR(100) NOT NULL,
        um_minorista VARCHAR(100) NOT NULL,
        formato DECIMAL(10,2) NOT NULL DEFAULT 1,
        disponible_um_minorista DECIMAL(12,2) NOT NULL DEFAULT 0,
        disponible_original DECIMAL(12,2) NOT NULL DEFAULT 0,
        fecha_inicio DATE,
        fecha_fin DATE,
        importe_mayorista DECIMAL(12,2) NOT NULL DEFAULT 0,
        importe DECIMAL(12,2) NOT NULL DEFAULT 0,
        valor_real DECIMAL(14,2) GENERATED ALWAYS AS (importe_mayorista * (disponible_um_minorista / NULLIF(formato, 0))) STORED,
        activo BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Migración: agregar importe_mayorista a instalaciones existentes
    await client.query(`
      ALTER TABLE productos ADD COLUMN IF NOT EXISTS importe_mayorista DECIMAL(12,2) NOT NULL DEFAULT 0
    `);

    // Migración: corrección fórmula valor_real → importe_mayorista × cajas (cantidad_mayorista)
    await client.query(`
      ALTER TABLE productos DROP COLUMN IF EXISTS valor_real
    `);
    await client.query(`
      ALTER TABLE productos ADD COLUMN IF NOT EXISTS valor_real DECIMAL(14,2)
        GENERATED ALWAYS AS (importe_mayorista * (disponible_um_minorista / NULLIF(formato, 0))) STORED
    `);

    // Migración: agregar cantidad_minima (mínimo de cajas a incluir en una factura)
    await client.query(`
      ALTER TABLE productos ADD COLUMN IF NOT EXISTS cantidad_minima INTEGER NOT NULL DEFAULT 0
    `);

    // Migración: agregar vende_decimales (productos que se despachan en cantidades decimales, ej. lomo ahumado)
    await client.query(`
      ALTER TABLE productos ADD COLUMN IF NOT EXISTS vende_decimales BOOLEAN NOT NULL DEFAULT FALSE
    `);

    // Migración: peso_pieza_min / peso_pieza_max — rango de peso por pieza (ej. lomo 12-15 lb)
    await client.query(`
      ALTER TABLE productos ADD COLUMN IF NOT EXISTS peso_pieza_min DECIMAL(10,4)
    `);
    await client.query(`
      ALTER TABLE productos ADD COLUMN IF NOT EXISTS peso_pieza_max DECIMAL(10,4)
    `);

    // Migración: formato_rango — si true, el formato se toma del rango peso_pieza_min/max en distribución
    await client.query(`
      ALTER TABLE productos ADD COLUMN IF NOT EXISTS formato_rango BOOLEAN NOT NULL DEFAULT FALSE
    `);

    // Migración: categoria — categoría del producto (ej. 'carnicos', 'otros')
    await client.query(`
      ALTER TABLE productos ADD COLUMN IF NOT EXISTS categoria VARCHAR(50) NOT NULL DEFAULT 'otros'
    `);

    // Migración: categorias en puntos_venta — array de categorías que maneja el PV
    await client.query(`
      ALTER TABLE puntos_venta ADD COLUMN IF NOT EXISTS categorias TEXT[] NOT NULL DEFAULT '{otros}'
    `);

    // Tabla de vendedores
    await client.query(`
      CREATE TABLE IF NOT EXISTS vendedores (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(200) NOT NULL UNIQUE,
        activo BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabla de puntos de venta minoristas
    await client.query(`
      CREATE TABLE IF NOT EXISTS puntos_venta (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL UNIQUE,
        porcentaje_asignado INTEGER NOT NULL DEFAULT 0 CHECK (porcentaje_asignado >= 0 AND porcentaje_asignado <= 100),
        activo BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insertar punto de venta por defecto si no existe
    await client.query(`
      INSERT INTO puntos_venta (nombre, porcentaje_asignado, activo)
      VALUES ('El Gustazo', 100, TRUE)
      ON CONFLICT (nombre) DO NOTHING
    `);

    // Tabla de períodos de distribución
    await client.query(`
      CREATE TABLE IF NOT EXISTS periodos (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100),
        fecha_inicio DATE NOT NULL,
        fecha_fin DATE NOT NULL,
        pct_minorista INTEGER NOT NULL DEFAULT 60,
        estado VARCHAR(20) DEFAULT 'pendiente' CHECK (estado IN ('pendiente','procesado','cerrado')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabla de facturas (Almacén Central - mayorista)
    await client.query(`
      CREATE TABLE IF NOT EXISTS facturas (
        id SERIAL PRIMARY KEY,
        consecutivo INTEGER NOT NULL,
        fecha DATE NOT NULL,
        punto_venta VARCHAR(50) NOT NULL DEFAULT 'almacen_central',
        tipo VARCHAR(20) NOT NULL DEFAULT 'mayorista',
        vendedor_id INTEGER REFERENCES vendedores(id),
        vendedor_nombre VARCHAR(200),
        cliente_nombre VARCHAR(200),
        cliente_ci VARCHAR(20),
        total DECIMAL(14,2) NOT NULL DEFAULT 0,
        efectivo DECIMAL(14,2) NOT NULL DEFAULT 0,
        total_transferencia DECIMAL(14,2) NOT NULL DEFAULT 0,
        ref_transferencia VARCHAR(100),
        periodo_id INTEGER REFERENCES periodos(id),
        anulada BOOLEAN DEFAULT FALSE,
        anulada_at TIMESTAMP,
        anulada_motivo TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`CREATE SEQUENCE IF NOT EXISTS factura_consecutivo_seq START 1`);

    // Tabla de items de factura
    await client.query(`
      CREATE TABLE IF NOT EXISTS factura_items (
        id SERIAL PRIMARY KEY,
        factura_id INTEGER NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
        producto_id INTEGER REFERENCES productos(id),
        codigo VARCHAR(50),
        producto VARCHAR(200),
        um VARCHAR(100),
        cantidad DECIMAL(12,2) NOT NULL,
        precio DECIMAL(12,2) NOT NULL,
        importe DECIMAL(14,2) NOT NULL
      )
    `);

    // Migración: num_piezas en factura_items — para productos formato_rango agrupa piezas en 1 sola línea
    await client.query(`
      ALTER TABLE factura_items ADD COLUMN IF NOT EXISTS num_piezas INTEGER NOT NULL DEFAULT 1
    `);

    // Tabla de resúmenes minoristas diarios
    await client.query(`
      CREATE TABLE IF NOT EXISTS resumenes_minoristas (
        id SERIAL PRIMARY KEY,
        fecha DATE NOT NULL,
        punto_venta VARCHAR(50),
        punto_venta_id INTEGER REFERENCES puntos_venta(id),
        total DECIMAL(14,2) NOT NULL DEFAULT 0,
        efectivo DECIMAL(14,2) NOT NULL DEFAULT 0,
        total_transferencia DECIMAL(14,2) NOT NULL DEFAULT 0,
        periodo_id INTEGER REFERENCES periodos(id),
        anulado BOOLEAN DEFAULT FALSE,
        anulado_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Migración: agregar columna anulado si no existe (para instalaciones previas)
    await client.query(`ALTER TABLE resumenes_minoristas ADD COLUMN IF NOT EXISTS anulado BOOLEAN DEFAULT FALSE`);
    await client.query(`ALTER TABLE resumenes_minoristas ADD COLUMN IF NOT EXISTS anulado_at TIMESTAMP`);

    // Items del resumen minorista
    await client.query(`
      CREATE TABLE IF NOT EXISTS resumen_items (
        id SERIAL PRIMARY KEY,
        resumen_id INTEGER NOT NULL REFERENCES resumenes_minoristas(id) ON DELETE CASCADE,
        producto_id INTEGER REFERENCES productos(id),
        codigo VARCHAR(50),
        producto VARCHAR(200),
        um VARCHAR(100),
        cantidad DECIMAL(12,2) NOT NULL,
        precio DECIMAL(12,2) NOT NULL,
        importe DECIMAL(14,2) NOT NULL
      )
    `);

    // Tabla de relación transferencias usadas en facturas/resúmenes
    await client.query(`
      CREATE TABLE IF NOT EXISTS transferencias_usadas (
        id SERIAL PRIMARY KEY,
        transferencia_id INTEGER NOT NULL REFERENCES transferencias(id),
        factura_id INTEGER REFERENCES facturas(id),
        resumen_id INTEGER REFERENCES resumenes_minoristas(id),
        importe_aplicado DECIMAL(14,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabla de clientes (pool de nombres/CI para facturas sin transferencia)
    await client.query(`
      CREATE TABLE IF NOT EXISTS clientes (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(200) NOT NULL,
        ci VARCHAR(20) NOT NULL UNIQUE,
        fuente VARCHAR(50) DEFAULT 'transferencia',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Sync clientes desde transferencias:
    // Solo CR < 10000 y que no sean prefijo 98 (sin carnet asociado)
    await client.query(`
      INSERT INTO clientes (nombre, ci, fuente)
      SELECT DISTINCT nombre, ci, 'transferencia'
      FROM transferencias
      WHERE nombre IS NOT NULL AND nombre <> ''
        AND ci IS NOT NULL AND ci <> ''
        AND tipo = 'CR'
        AND importe < 10000
        AND (prefijo IS NULL OR prefijo NOT LIKE '98%')
      ON CONFLICT (ci) DO NOTHING
    `);

    // Función para actualizar updated_at
    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    await client.query(`
      DROP TRIGGER IF EXISTS productos_updated_at ON productos;
      CREATE TRIGGER productos_updated_at
        BEFORE UPDATE ON productos
        FOR EACH ROW EXECUTE FUNCTION update_updated_at()
    `);

    await client.query(`
      DROP TRIGGER IF EXISTS puntos_venta_updated_at ON puntos_venta;
      CREATE TRIGGER puntos_venta_updated_at
        BEFORE UPDATE ON puntos_venta
        FOR EACH ROW EXECUTE FUNCTION update_updated_at()
    `);

    await client.query('COMMIT');
    console.log('✅ Base de datos inicializada correctamente');
    console.log('📋 Tablas creadas: transferencias, productos, vendedores, puntos_venta, periodos, facturas, factura_items, resumenes_minoristas, resumen_items, transferencias_usadas, clientes');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error al inicializar DB:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

initDB().catch(console.error);