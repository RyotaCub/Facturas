-- Migración: Agregar tabla de puntos de venta minoristas

-- Tabla de puntos de venta minoristas
CREATE TABLE IF NOT EXISTS puntos_venta (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL UNIQUE,
  porcentaje_asignado INTEGER NOT NULL DEFAULT 0 CHECK (porcentaje_asignado >= 0 AND porcentaje_asignado <= 100),
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Trigger para actualizar updated_at
DROP TRIGGER IF EXISTS puntos_venta_updated_at ON puntos_venta;
CREATE TRIGGER puntos_venta_updated_at
  BEFORE UPDATE ON puntos_venta
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Insertar punto de venta por defecto (El Gustazo con 100% del minorista)
INSERT INTO puntos_venta (nombre, porcentaje_asignado, activo)
VALUES ('PV 1', 100, TRUE)
ON CONFLICT (nombre) DO NOTHING;

-- Actualizar tabla resumenes_minoristas para usar punto_venta_id en lugar de string
ALTER TABLE resumenes_minoristas 
  ADD COLUMN IF NOT EXISTS punto_venta_id INTEGER REFERENCES puntos_venta(id);

-- Migrar datos existentes: buscar o crear "El Gustazo" y asignarlo
DO $$
DECLARE
  PV_1_id INTEGER;
BEGIN
  -- Obtener o crear El Gustazo
  SELECT id INTO PV_1_id FROM puntos_venta WHERE nombre = 'El Gustazo' LIMIT 1;
  
  IF el_gustazo_id IS NULL THEN
    INSERT INTO puntos_venta (nombre, porcentaje_asignado, activo)
    VALUES ('PV 1', 100, TRUE)
    RETURNING id INTO PV_1_id;
  END IF;
  
  -- Actualizar registros existentes
  UPDATE resumenes_minoristas 
  SET punto_venta_id = PV_1_id 
  WHERE punto_venta = 'PV_1' AND punto_venta_id IS NULL;
END $$;

-- Comentario para futuras referencias
COMMENT ON TABLE puntos_venta IS 'Puntos de venta minoristas con porcentajes de distribución';
COMMENT ON COLUMN puntos_venta.porcentaje_asignado IS 'Porcentaje del total minorista asignado a este punto de venta (debe sumar 100% entre todos los activos)';
