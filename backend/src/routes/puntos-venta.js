const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');

// ─── Validador central ────────────────────────────────────────────────────────
function validarPuntoVenta(body, { requireAll = true } = {}) {
  const errores = [];
  const { nombre, porcentaje_asignado, activo, categorias } = body;

  // nombre
  if (requireAll || nombre !== undefined) {
    if (!nombre || typeof nombre !== 'string' || nombre.trim().length === 0)
      errores.push('El nombre es requerido.');
    else if (nombre.trim().length > 100)
      errores.push('El nombre no puede superar 100 caracteres.');
    else if (!/^[a-zA-ZáéíóúÁÉÍÓÚüÜñÑ0-9\s\-_.,'()]+$/.test(nombre.trim()))
      errores.push('El nombre contiene caracteres no permitidos.');
  }

  // porcentaje_asignado
  if (requireAll || porcentaje_asignado !== undefined) {
    const pct = Number(porcentaje_asignado);
    if (porcentaje_asignado === undefined || porcentaje_asignado === null || porcentaje_asignado === '')
      errores.push('El porcentaje es requerido.');
    else if (!Number.isInteger(pct))
      errores.push('El porcentaje debe ser un número entero.');
    else if (pct < 0 || pct > 100)
      errores.push('El porcentaje debe estar entre 0 y 100.');
  }

  // activo (opcional, solo validar tipo si viene)
  if (activo !== undefined && typeof activo !== 'boolean')
    errores.push('El campo "activo" debe ser true o false.');

  // categorias (opcional, solo validar si viene)
  if (categorias !== undefined) {
    if (!Array.isArray(categorias))
      errores.push('Las categorías deben ser un arreglo.');
    else if (categorias.length === 0)
      errores.push('Debe incluir al menos una categoría.');
    else if (categorias.some(c => typeof c !== 'string' || c.trim().length === 0))
      errores.push('Cada categoría debe ser un texto no vacío.');
  }

  return errores;
}

// ─── GET / — Listar todos ─────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM puntos_venta ORDER BY nombre ASC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /activos — Solo activos con validación de porcentajes ────────────────
router.get('/activos', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM puntos_venta WHERE activo = TRUE ORDER BY nombre ASC'
    );
    const totalPct = rows.reduce((s, pv) => s + Number(pv.porcentaje_asignado), 0);
    res.json({
      puntos_venta: rows,
      total_porcentaje: totalPct,
      porcentajes_validos: totalPct === 100,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST / — Crear ───────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const errores = validarPuntoVenta(req.body, { requireAll: true });
  if (errores.length) return res.status(400).json({ errores });

  const nombre     = req.body.nombre.trim();
  const porcentaje = Number(req.body.porcentaje_asignado);
  const activo     = req.body.activo !== undefined ? req.body.activo : true;
  const categorias = req.body.categorias?.map(c => c.trim()) || ['otros'];

  try {
    // Unicidad de nombre (case-insensitive)
    const { rows: existe } = await pool.query(
      'SELECT id FROM puntos_venta WHERE LOWER(nombre) = LOWER($1)',
      [nombre]
    );
    if (existe.length)
      return res.status(409).json({ errores: [`Ya existe un punto de venta con el nombre "${nombre}".`] });

    // Si va a ser activo, validar que los porcentajes sigan cuadrando
    if (activo) {
      const { rows: activos } = await pool.query(
        'SELECT SUM(porcentaje_asignado) AS total FROM puntos_venta WHERE activo = TRUE'
      );
      const totalActual = Number(activos[0].total || 0);
      if (totalActual + porcentaje > 100)
        return res.status(400).json({
          errores: [`Agregar este punto superaría 100%. Porcentaje actual de activos: ${totalActual}%.`]
        });
    }

    const { rows } = await pool.query(
      `INSERT INTO puntos_venta (nombre, porcentaje_asignado, activo, categorias)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [nombre, porcentaje, activo, categorias]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /:id — Actualizar ────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!Number.isInteger(id) || id <= 0)
    return res.status(400).json({ errores: ['ID inválido.'] });

  const errores = validarPuntoVenta(req.body, { requireAll: false });
  if (errores.length) return res.status(400).json({ errores });

  try {
    const { rows: actual } = await pool.query(
      'SELECT * FROM puntos_venta WHERE id = $1', [id]
    );
    if (!actual.length)
      return res.status(404).json({ errores: ['Punto de venta no encontrado.'] });

    const pv = actual[0];

    // Unicidad de nombre si cambia
    if (req.body.nombre !== undefined) {
      const nombre = req.body.nombre.trim();
      const { rows: existe } = await pool.query(
        'SELECT id FROM puntos_venta WHERE LOWER(nombre) = LOWER($1) AND id <> $2',
        [nombre, id]
      );
      if (existe.length)
        return res.status(409).json({ errores: [`Ya existe otro punto de venta con el nombre "${nombre}".`] });
    }

    // Validar que porcentajes de activos sigan sumando <= 100
    const nuevoActivo     = req.body.activo     !== undefined ? req.body.activo     : pv.activo;
    const nuevoPorcentaje = req.body.porcentaje_asignado !== undefined
      ? Number(req.body.porcentaje_asignado) : Number(pv.porcentaje_asignado);

    if (nuevoActivo) {
      const { rows: otros } = await pool.query(
        'SELECT SUM(porcentaje_asignado) AS total FROM puntos_venta WHERE activo = TRUE AND id <> $1',
        [id]
      );
      const totalOtros = Number(otros[0].total || 0);
      if (totalOtros + nuevoPorcentaje > 100)
        return res.status(400).json({
          errores: [`Con este cambio los porcentajes activos sumarían ${totalOtros + nuevoPorcentaje}%. Deben sumar exactamente 100%.`]
        });
    }

    // Construir SET dinámico solo con los campos enviados
    const campos   = [];
    const valores  = [];
    let   idx      = 1;

    if (req.body.nombre              !== undefined) { campos.push(`nombre = $${idx++}`);              valores.push(req.body.nombre.trim()); }
    if (req.body.porcentaje_asignado !== undefined) { campos.push(`porcentaje_asignado = $${idx++}`); valores.push(nuevoPorcentaje); }
    if (req.body.activo              !== undefined) { campos.push(`activo = $${idx++}`);              valores.push(req.body.activo); }
    if (req.body.categorias          !== undefined) { campos.push(`categorias = $${idx++}`);          valores.push(req.body.categorias.map(c => c.trim())); }

    if (!campos.length)
      return res.status(400).json({ errores: ['No se enviaron campos para actualizar.'] });

    campos.push(`updated_at = CURRENT_TIMESTAMP`);
    valores.push(id);

    const { rows } = await pool.query(
      `UPDATE puntos_venta SET ${campos.join(', ')} WHERE id = $${idx} RETURNING *`,
      valores
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /:id — Eliminar ───────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!Number.isInteger(id) || id <= 0)
    return res.status(400).json({ errores: ['ID inválido.'] });

  try {
    const { rows } = await pool.query(
      'SELECT * FROM puntos_venta WHERE id = $1', [id]
    );
    if (!rows.length)
      return res.status(404).json({ errores: ['Punto de venta no encontrado.'] });

    // Bloquear si tiene resúmenes asociados
    const { rows: resumenes } = await pool.query(
      'SELECT COUNT(*) AS total FROM resumenes_minoristas WHERE punto_venta_id = $1 AND anulado = FALSE',
      [id]
    );
    if (parseInt(resumenes[0].total) > 0)
      return res.status(409).json({
        errores: [`No se puede eliminar: tiene ${resumenes[0].total} resúmenes activos asociados. Anúlalos primero.`]
      });

    await pool.query('DELETE FROM puntos_venta WHERE id = $1', [id]);
    res.json({ success: true, message: 'Punto de venta eliminado.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /validar-porcentajes ────────────────────────────────────────────────
router.post('/validar-porcentajes', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, nombre, porcentaje_asignado FROM puntos_venta WHERE activo = TRUE'
    );
    const total = rows.reduce((s, pv) => s + Number(pv.porcentaje_asignado), 0);
    res.json({
      valido:           total === 100,
      total_porcentaje: total,
      diferencia:       100 - total,
      puntos_activos:   rows,
      mensaje: total === 100
        ? 'Los porcentajes suman exactamente 100%.'
        : `Los porcentajes suman ${total}%. Diferencia: ${100 - total}%.`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;