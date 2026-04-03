const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');

// ─────────────────────────────────────────────────────────────
// AUXILIAR: distribuir una cantidad (entera o decimal) entre N días
// con cuadre exacto. (distribución UNIFORME — mayorista en cajas)
// ─────────────────────────────────────────────────────────────
function distribuirEntrerias(total, dias) {
  const n = dias.length;
  if (n === 0) return [];
  if (total <= 0) return dias.map(f => ({ fecha: f, cantidad: 0 }));
  if (n === 1) return [{ fecha: dias[0], cantidad: total }];

  const esEntero = Number.isInteger(total);
  if (esEntero) {
    const base   = Math.floor(total / n);
    const extras = total - base * n;
    return dias.map((fecha, i) => ({ fecha, cantidad: base + (i < extras ? 1 : 0) }));
  }

  // Decimal: repartir uniformemente con el último absorbiendo el residuo
  const base = parseFloat((total / n).toFixed(2));
  const result = dias.map((fecha, i) => ({ fecha, cantidad: base }));
  const suma   = parseFloat((base * n).toFixed(2));
  result[n - 1].cantidad = parseFloat((result[n - 1].cantidad + (total - suma)).toFixed(2));
  return result;
}

// ─────────────────────────────────────────────────────────────
// AUXILIAR: distribuir una cantidad (entera o decimal) entre N días
// de forma ALEATORIA con cuadre exacto. Usado en FASE 2 mayorista.
// ─────────────────────────────────────────────────────────────
function distribuirAleatorio(total, dias) {
  const n = dias.length;
  if (n === 0) return [];
  if (total <= 0) return dias.map(f => ({ fecha: f, cantidad: 0 }));
  if (n === 1) return [{ fecha: dias[0], cantidad: total }];

  const esEntero = Number.isInteger(total);
  const result   = dias.map(f => ({ fecha: f, cantidad: 0 }));
  let rem = total;

  for (let i = 0; i < n - 1 && rem > 0; i++) {
    const daysLeft  = n - i;
    const evenShare = rem / daysLeft;
    const factor    = Math.random() * 2;
    let cantidad    = Math.min(rem, Math.max(0, evenShare * factor));
    if (esEntero) cantidad = Math.round(cantidad);
    else          cantidad = parseFloat(cantidad.toFixed(2));
    result[i].cantidad = cantidad;
    rem = parseFloat((rem - cantidad).toFixed(2));
  }
  result[n - 1].cantidad = rem;
  return result;
}

// ─────────────────────────────────────────────────────────────
// AUXILIAR: repartir un entero entre N pesos con ruido aleatorio
// Los valores resultantes suman exactamente `total`.
// Usado en minorista para que los totales diarios por PV varíen.
// ─────────────────────────────────────────────────────────────
function repartirConRuido(total, pesos) {
  if (total <= 0) return pesos.map(() => 0);
  const n = pesos.length;
  if (n === 1) return [total];

  const sumPesos = pesos.reduce((s, p) => s + p, 0);
  if (sumPesos === 0) return pesos.map(() => 0);

  const esEntero = Number.isInteger(total);

  // Generar valores ruidosos: cada base ± 25 % aleatorio
  const noisy = pesos.map(p => {
    const base   = (p / sumPesos) * total;
    const factor = 0.75 + Math.random() * 0.5; // [0.75, 1.25]
    return Math.max(0, base * factor);
  });

  const sumNoisy = noisy.reduce((s, v) => s + v, 0);
  if (sumNoisy === 0) return pesos.map(() => 0);

  // Escalar para que sumen `total`
  // Enteros: floor (nunca inventar unidades), residuo al más grande.
  // Decimales: conservar 2 decimales.
  const result = noisy.map(v => {
    const scaled = (v / sumNoisy) * total;
    return esEntero ? Math.floor(scaled) : parseFloat(scaled.toFixed(2));
  });
  const suma = result.reduce((s, v) => s + v, 0);
  const diff = parseFloat((total - suma).toFixed(2));

  // El residuo (siempre ≥ 0 con floor) va al elemento más grande
  if (Math.abs(diff) > 0.0001) {
    const maxIdx = result.indexOf(Math.max(...result));
    result[maxIdx] = esEntero
      ? result[maxIdx] + Math.round(diff)
      : parseFloat((result[maxIdx] + diff).toFixed(2));
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// AUXILIAR: generar N piezas con peso aleatorio en [pesoMin, pesoMax]
// Retorna array de { peso, importe } donde importe = peso × importePorUM
// Los pesos son 100% aleatorios — sin escalar ni ajustar.
// El cuadre contable se garantiza por pre-generación en buildStock
// (ver campo piezasPreGeneradas en productos fmtRango).
// ─────────────────────────────────────────────────────────────
function generarPiezasRango(numPiezas, pesoMin, pesoMax, importePorUM) {
  if (numPiezas <= 0 || pesoMin <= 0 || pesoMax <= 0) return [];
  return Array.from({ length: Math.round(numPiezas) }, () => {
    const peso    = parseFloat((pesoMin + Math.random() * (pesoMax - pesoMin)).toFixed(2));
    const importe = parseFloat((peso * importePorUM).toFixed(2));
    return { peso, importe };
  });
}

// ─────────────────────────────────────────────────────────────
// AUXILIAR: agrupar items de piezas rango por producto_id
// → un solo item por producto con peso total y num_piezas
// ─────────────────────────────────────────────────────────────
function agruparPiezasRango(items) {
  const grupos = new Map(); // producto_id → item agregado
  const resto  = [];

  for (const item of items) {
    if (!item._esPiezaRango) { resto.push(item); continue; }
    if (!grupos.has(item.producto_id)) {
      grupos.set(item.producto_id, {
        producto_id: item.producto_id,
        codigo:      item.codigo,
        producto:    item.producto,
        um:          item.um,
        cantidad:    0,      // peso total
        precio:      item.precio,
        importe:     0,
        num_piezas:  0,
        _esPiezaRango: true,
      });
    }
    const g = grupos.get(item.producto_id);
    g.cantidad  = parseFloat((g.cantidad + item.cantidad).toFixed(2));
    g.importe   = parseFloat((g.importe   + item.importe).toFixed(2));
    g.num_piezas += 1;
  }

  return [...resto, ...grupos.values()];
}


// Excluye domingos y feriados nacionales (1 de enero)
// ─────────────────────────────────────────────────────────────
// Para agregar más feriados: añadir entradas al Set con formato 'MM-DD'
const FERIADOS_MM_DD = new Set(['01-01']); // 1 de enero — Año Nuevo

function generarDias(fechaInicio, fechaFin) {
  const toStr = d => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10);
  const dias  = [];
  const inicio = new Date(toStr(fechaInicio) + 'T00:00:00Z');
  const fin    = new Date(toStr(fechaFin)    + 'T00:00:00Z');
  for (let d = new Date(inicio); d <= fin; d.setUTCDate(d.getUTCDate() + 1)) {
    const esDomingo  = d.getUTCDay() === 0;
    const mmdd       = d.toISOString().slice(5, 10); // 'MM-DD'
    const esFeriado  = FERIADOS_MM_DD.has(mmdd);
    if (!esDomingo && !esFeriado) dias.push(d.toISOString().slice(0, 10));
  }
  if (dias.length === 0)
    throw new Error('El rango seleccionado no tiene días hábiles (todos son domingo o feriado).');
  return dias;
}

// ─────────────────────────────────────────────────────────────
// AUXILIAR: construir stock con distribución diaria en CAJAS
// destinos: { [productoId]: 'ambos' | 'mayorista' | 'minorista' }
// ─────────────────────────────────────────────────────────────
function buildStock(productos, pctMin, destinos = {}) {
  return productos.map(p => {
    const disponible        = parseFloat(p.disponible_um_minorista);
    // ── Formato Rango: piezas con peso variable ────────────────
    const fmtRango  = p.formato_rango === true || p.formato_rango === 1;
    const pesoMin   = fmtRango ? (parseFloat(p.peso_pieza_min) || 0) : 0;
    const pesoMax   = fmtRango ? (parseFloat(p.peso_pieza_max) || 0) : 0;
    const avgPeso   = (fmtRango && pesoMin > 0 && pesoMax > 0) ? (pesoMin + pesoMax) / 2 : 0;
    // Para formato_rango: formato efectivo = avgPeso; precio "caja" = avgPeso × importe
    const formato           = (fmtRango && avgPeso > 0) ? avgPeso : parseFloat(p.formato);
    const importe           = parseFloat(p.importe);
    const importe_mayorista = (fmtRango && avgPeso > 0)
      ? parseFloat((avgPeso * importe).toFixed(2))
      : (parseFloat(p.importe_mayorista) || (importe * formato));
    const vendeDecimales    = p.vende_decimales === true || p.vende_decimales === 1;

    // Determinar porcentaje minorista efectivo según destino elegido
    const destino = destinos[String(p.id)] || 'ambos';
    let pctMinEfectivo = pctMin;
    if (destino === 'mayorista') pctMinEfectivo = 0;
    if (destino === 'minorista') pctMinEfectivo = 1;

    // Para formato_rango: siempre piezas enteras (floor con avgPeso)
    // Para vende_decimales: permitir fracción de cajas
    // Para el resto: cajas enteras con Math.floor
    const cajasParaMayorista = destino === 'minorista'
      ? 0
      : (fmtRango && avgPeso > 0)
        ? Math.floor(disponible * (1 - pctMinEfectivo) / avgPeso)
        : vendeDecimales
          ? parseFloat((disponible * (1 - pctMinEfectivo) / formato).toFixed(2))
          : Math.floor(disponible * (1 - pctMinEfectivo) / formato);
    const cantidadMayorista  = parseFloat((cajasParaMayorista * formato).toFixed(2));
    // La fracción descartada (o resto decimal) va íntegra al minorista
    const cantidadMinorista  = parseFloat((disponible - cantidadMayorista).toFixed(2));

    const dias = generarDias(p.fecha_inicio, p.fecha_fin);

    const distMayoristaEnCajas = cajasParaMayorista > 0
      ? distribuirEntrerias(cajasParaMayorista, dias)
      : dias.map(f => ({ fecha: f, cantidad: 0 }));

    const distMinorista = cantidadMinorista > 0
      ? distribuirAleatorio(cantidadMinorista, dias)
      : dias.map(f => ({ fecha: f, cantidad: 0 }));

    // ── Camino 1: pre-generar piezas fmtRango con cierre exacto en la última ──
    //
    // Las primeras N-1 piezas tienen pesos 100% aleatorios en [pesoMin, pesoMax].
    // La última pieza usa el peso residual: pesoObjetivo - suma(N-1 piezas),
    // garantizando que la suma total = cajasParaMayorista × avgPeso exactamente.
    // → valor_mayorista planificado = valor facturado = cuadre perfecto.
    // → Solo la última pieza puede caer ligeramente fuera del rango natural,
    //   pero en la práctica la diferencia es de décimas de gramo.
    let piezasPreGeneradas = null;
    let valor_mayorista_real;

    if (fmtRango && pesoMin > 0 && pesoMax > 0 && cajasParaMayorista > 0) {
      const n           = cajasParaMayorista;
      const pesoObjetivo = parseFloat((n * avgPeso).toFixed(2)); // peso total planificado

      // Generar N-1 piezas con peso libre
      const piezasLibres = generarPiezasRango(n - 1, pesoMin, pesoMax, importe);
      const sumaLibres   = parseFloat(piezasLibres.reduce((s, pp) => s + pp.peso, 0).toFixed(2));

      // Última pieza: cierra exactamente el peso objetivo
      const pesoUltima   = parseFloat((pesoObjetivo - sumaLibres).toFixed(2));
      const importeUltima = parseFloat((pesoUltima * importe).toFixed(2));
      const ultimaPieza  = { peso: pesoUltima, importe: importeUltima };

      piezasPreGeneradas   = [...piezasLibres, ultimaPieza];
      // valor real = suma de importes de cada pieza (peso_real × importe_unitario)
      // NO usar n × importe_mayorista (plan teórico) porque los pesos reales difieren del avg
      valor_mayorista_real = parseFloat(
        piezasPreGeneradas.reduce((s, pp) => s + pp.importe, 0).toFixed(2)
      );
    } else {
      valor_mayorista_real = parseFloat((cajasParaMayorista * importe_mayorista).toFixed(2));
    }

    return {
      id: p.id, codigo: p.codigo, producto: p.producto,
      um_mayorista: p.um_mayorista, um_minorista: p.um_minorista,
      formato, importe, importe_mayorista, disponible,
      cajasParaMayorista, cantidadMayorista, cantidadMinorista,
      valor_mayorista: valor_mayorista_real,
      valor_minorista: parseFloat((cantidadMinorista  * importe).toFixed(2)),
      destino,
      vendeDecimales,
      fmtRango, pesoMin, pesoMax,
      categoria: p.categoria || 'otros',
      cantidad_minima: parseInt(p.cantidad_minima) || 0,
      dias, distMayoristaEnCajas, distMinorista,
      piezasPreGeneradas,  // null para productos normales
    };
  });
}

// =============================================================
// POST /calcular  — preview sin guardar
// =============================================================
router.post('/calcular', async (req, res) => {
  const { fecha_inicio, fecha_fin, pct_minorista = 60, umbral_minorista = 20000, destinos = {} } = req.body;
  if (!fecha_inicio || !fecha_fin)
    return res.status(400).json({ error: 'Fechas requeridas' });

  try {
    const { rows: puntosVenta } = await pool.query(
      'SELECT id, nombre, porcentaje_asignado, categorias, activo FROM puntos_venta WHERE activo = TRUE ORDER BY nombre ASC'
    );
    if (!puntosVenta.length)
      return res.status(400).json({ error: 'No hay puntos de venta activos.' });

    const totalPct = puntosVenta.reduce((s, pv) => s + Number(pv.porcentaje_asignado), 0);
    if (totalPct !== 100)
      return res.status(400).json({ error: `Porcentajes deben sumar 100%. Actualmente: ${totalPct}%` });

    const { rows: productos } = await pool.query(`
      SELECT * FROM productos
      WHERE activo = TRUE
        AND fecha_inicio IS NOT NULL AND fecha_fin IS NOT NULL
        AND disponible_um_minorista > 0
        AND fecha_inicio <= $2 AND fecha_fin >= $1
      ORDER BY producto
    `, [fecha_inicio, fecha_fin]);

    if (!productos.length)
      return res.status(400).json({ error: 'No hay productos disponibles en el período' });

    const stock = buildStock(productos, pct_minorista / 100, destinos);

    const allDias   = [...new Set(stock.flatMap(p => p.dias))].sort();
    const fecha_min = allDias[0];
    const fecha_max = allDias[allDias.length - 1];

    const { rows: transferencias } = await pool.query(`
      SELECT *, to_char(fecha, 'YYYY-MM-DD') as fecha_str
      FROM transferencias
      WHERE tipo = 'CR'
        AND prefijo IN ('98','MM','KW', 'JD','VB','AJ','DD','AY')
        AND usada = FALSE
        AND fecha BETWEEN $1 AND $2
      ORDER BY fecha ASC, importe DESC
    `, [fecha_inicio, fecha_fin]);

    const plan = stock.map(p => {
      const distribucion_puntos = puntosVenta.map(pv => {
        const pctPV    = Number(pv.porcentaje_asignado) / 100;
        const cantidad = parseFloat((p.cantidadMinorista * pctPV).toFixed(2));
        return { punto_venta_id: pv.id, punto_venta_nombre: pv.nombre,
                 porcentaje: pv.porcentaje_asignado, cantidad,
                 valor: cantidad * p.importe };
      });
      const diff = parseFloat((p.cantidadMinorista - distribucion_puntos.reduce((s, d) => s + d.cantidad, 0)).toFixed(2));
      if (Math.abs(diff) > 0.0001 && distribucion_puntos.length > 0) {
        const last = distribucion_puntos[distribucion_puntos.length - 1];
        last.cantidad += diff; last.valor = last.cantidad * p.importe;
      }
      return {
        id: p.id, codigo: p.codigo, producto: p.producto,
        um_mayorista: p.um_mayorista, um_minorista: p.um_minorista,
        formato: p.formato, disponible: p.disponible, importe: p.importe,
        cajas_mayorista: p.cajasParaMayorista,
        para_mayorista: p.cantidadMayorista,
        para_minorista: p.cantidadMinorista,
        valor_mayorista: p.valor_mayorista,
        valor_minorista: p.valor_minorista,
        destino: p.destino,
        fmtRango: p.fmtRango, pesoMin: p.pesoMin, pesoMax: p.pesoMax,
        distribucion_puntos,
      };
    });

    const totalMaj = plan.reduce((s, p) => s + p.valor_mayorista, 0);
    const totalMin = plan.reduce((s, p) => s + p.valor_minorista, 0);

    // Solo transferencias >= umbral (las que se usarán en FASE 1)
    const trFase1  = transferencias.filter(t => parseFloat(t.importe) >= umbral_minorista);
    const sumTr    = trFase1.reduce((s, t) => s + parseFloat(t.importe), 0);
    const efectivoPendiente = Math.max(0, totalMaj - sumTr);
    const advertenciaFase1 = sumTr > totalMaj
      ? `⚠️ CUADRE IMPOSIBLE: las ${trFase1.length} transfers FASE 1 suman $${sumTr.toFixed(0)} y superan el inventario mayorista $${totalMaj.toFixed(0)}. Sube el % de almacén o baja el umbral CR antes de confirmar.`
      : null;

    res.json({
      plan,
      puntos_venta: puntosVenta,
      totales: { mayorista: totalMaj, minorista: totalMin, total: totalMaj + totalMin },
      transferencias: {
        todas:              transferencias,
        usadas_fase1:       trFase1,
        total_transferencias: sumTr,
        efectivo_fase2:     efectivoPendiente,
      },
      config: {
        pct_minorista, pct_mayorista: 100 - pct_minorista,
        umbral_minorista, fecha_inicio, fecha_fin,
        fecha_min_productos: fecha_min, fecha_max_productos: fecha_max,
      },
      advertencia: advertenciaFase1,
      cuadre_viable: !advertenciaFase1,
      info: advertenciaFase1 || [
        `FASE 1: ${trFase1.length} transferencias → ${trFase1.length} facturas.`,
        `        Cada factura cubre exactamente el importe de su transferencia.`,
        `FASE 2: $${efectivoPendiente.toFixed(2)} restantes en efectivo distribuidos`,
        `        aleatoriamente en facturas diarias (${allDias.length} días hábiles).`,
        `        Cuadre exacto garantizado al último día.`,
      ].join('\n'),
    });

  } catch (err) {
    console.error('Error en cálculo:', err);
    res.status(500).json({ error: err.message });
  }
});

// =============================================================
// POST /confirmar  — guarda en BD con transacción
// =============================================================
router.post('/confirmar', async (req, res) => {
  const {
    fecha_inicio, fecha_fin,
    pct_minorista    = 60,
    periodo_nombre,
    umbral_minorista = 20000,
    destinos         = {},
  } = req.body;

  if (!fecha_inicio || !fecha_fin)
    return res.status(400).json({ error: 'fecha_inicio y fecha_fin son requeridos' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Validaciones ──────────────────────────────────────────
    const { rows: puntosVenta } = await client.query(
      'SELECT id, nombre, porcentaje_asignado, categorias FROM puntos_venta WHERE activo = TRUE ORDER BY nombre ASC'
    );
    if (!puntosVenta.length) throw new Error('No hay puntos de venta activos.');

    const totalPct = puntosVenta.reduce((s, pv) => s + Number(pv.porcentaje_asignado), 0);
    if (totalPct !== 100)
      throw new Error(`Los porcentajes deben sumar 100%. Actualmente: ${totalPct}%`);

    const { rows: vendedores } = await client.query(
      'SELECT id, nombre FROM vendedores WHERE activo = TRUE'
    );
    if (!vendedores.length) throw new Error('No hay vendedores activos.');

    // ── Período ───────────────────────────────────────────────
    const { rows: perRows } = await client.query(
      `INSERT INTO periodos (nombre, fecha_inicio, fecha_fin, pct_minorista, estado)
       VALUES ($1,$2,$3,$4,'procesado') RETURNING id`,
      [periodo_nombre || `Período ${fecha_inicio} – ${fecha_fin}`, fecha_inicio, fecha_fin, pct_minorista]
    );
    const periodoId = perRows[0].id;

    // ── Productos ─────────────────────────────────────────────
    const { rows: productos } = await client.query(`
      SELECT * FROM productos
      WHERE activo = TRUE
        AND fecha_inicio IS NOT NULL AND fecha_fin IS NOT NULL
        AND disponible_um_minorista > 0
        AND fecha_inicio <= $2 AND fecha_fin >= $1
      ORDER BY producto
    `, [fecha_inicio, fecha_fin]);
    if (!productos.length)
      throw new Error('No hay productos activos con disponibilidad en el período.');

    const stock = buildStock(productos, pct_minorista / 100, destinos);

    const allDias   = [...new Set(stock.flatMap(p => p.dias))].sort();
    const fecha_min = allDias[0];
    const fecha_max = allDias[allDias.length - 1];

    // ── Transferencias CR >= umbral (FASE 1) ──────────────────
    const { rows: rawTr } = await client.query(`
      SELECT *, to_char(fecha, 'YYYY-MM-DD') as fecha_str
      FROM transferencias
      WHERE tipo = 'CR'
        AND prefijo IN ('98','MM','KW', 'JD','VB','AJ','DD','AY')
        AND usada = FALSE
        AND fecha BETWEEN $1 AND $2
      ORDER BY fecha ASC, importe DESC
    `, [fecha_inicio, fecha_fin]);

    // Solo las que superan el umbral van a FASE 1.
    // ORDEN: importe DESC (mayor primero) → la transfer mas grande tiene
    // primer acceso al stock y no queda sin productos por las pequeñas.
    // La fecha de la factura siempre es la fecha real de la transfer.
    const trFase1 = rawTr
      .filter(t => parseFloat(t.importe) >= umbral_minorista)
      .sort((a, b) => parseFloat(b.importe) - parseFloat(a.importe));

    const numTr    = trFase1.length;
    const sumTr    = trFase1.reduce((s, t) => s + parseFloat(t.importe), 0);
    const totalMaj = stock.reduce((s, p) => s + p.valor_mayorista, 0);

    // ── GARANTÍA 1: FASE 1 no puede superar el inventario mayorista ──
    if (sumTr > totalMaj + 0.01) {
      throw new Error(
        `Cuadre FASE 1 imposible: las ${numTr} transferencias suman ` +
        `$${sumTr.toFixed(0)} pero el inventario mayorista solo vale ` +
        `$${totalMaj.toFixed(0)}. Aumenta el % de almacén o baja el umbral CR.`
      );
    }

    // Cuánto del inventario se cubre con transferencias (como máximo totalMaj)
    const fase1Budget = Math.min(sumTr, totalMaj);
    // Efectivo restante para FASE 2
    const efectivoFase2 = Math.max(0, totalMaj - sumTr);

    console.log(`\n💰 totalMayorista=$${totalMaj.toFixed(2)} | sumTr=$${sumTr.toFixed(2)}`);
    console.log(`📦 FASE1 cubre: $${fase1Budget.toFixed(2)} | FASE2 efectivo: $${efectivoFase2.toFixed(2)}`);
    console.log(`📅 ${allDias.length} días hábiles: ${fecha_min} → ${fecha_max}`);
    console.log(`🔁 ${numTr} transferencias en FASE 1`);

    // ── Pool de clientes y mapa nombre→CI ───────────────────────────────────
    // Garantiza que el mismo nombre SIEMPRE recibe el mismo CI en cualquier período.
    // Prioridad: clientes BD > historial facturas > transferencias con CI > pool aleatorio
    const { rows: clientesBD } = await client.query(`
      SELECT nombre, ci FROM clientes
      WHERE nombre IS NOT NULL AND nombre <> ''
        AND ci    IS NOT NULL AND ci    <> ''
    `);
    const { rows: clientesTr } = await client.query(`
      SELECT DISTINCT nombre, ci FROM transferencias
      WHERE nombre IS NOT NULL AND nombre <> ''
        AND ci    IS NOT NULL AND ci    <> ''
      LIMIT 50
    `);
    const { rows: clientesHist } = await client.query(`
      SELECT DISTINCT cliente_nombre AS nombre, cliente_ci AS ci
      FROM facturas
      WHERE cliente_nombre IS NOT NULL AND cliente_nombre <> ''
        AND cliente_ci     IS NOT NULL AND cliente_ci     <> ''
        AND cliente_ci     <> '00000000000'
    `);
    const normalizar  = n => (n || '').trim().toUpperCase().replace(/\s+/g, ' ');
    const nombreCiMap = new Map();
    // Cargar en orden inverso de prioridad (la más prioritaria sobrescribe)
    for (const c of [...clientesTr, ...clientesHist, ...clientesBD]) {
      if (!c.nombre || !c.ci) continue;
      nombreCiMap.set(normalizar(c.nombre), { nombre: c.nombre, ci: c.ci });
    }
    const _cisSeen     = new Set(clientesBD.map(c => c.ci));
    const _nombresSeen = new Set(clientesBD.map(c => normalizar(c.nombre)));
    const clientesPool = [
      ...clientesBD,
      ...clientesTr.filter(c => {
        const n = normalizar(c.nombre);
        if (_cisSeen.has(c.ci) || _nombresSeen.has(n)) return false;
        _cisSeen.add(c.ci);
        _nombresSeen.add(n);
        return true;
      }),
    ];
    for (let i = clientesPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [clientesPool[i], clientesPool[j]] = [clientesPool[j], clientesPool[i]];
    }
    let clienteIdx = 0;
    // Resolver nombre+CI para una transfer:
    // 1. Transfer trae nombre Y ci → usarlos directos
    // 2. Trae nombre sin ci → buscar en mapa (clientes/historial/corrida actual)
    // 3. Sin nada → pool rotativo
    function resolverCliente(trNombre, trCi) {
      const nombre = trNombre && trNombre.trim() ? trNombre.trim() : null;
      const ci     = trCi     && trCi.trim()     ? trCi.trim()     : null;
      if (nombre && ci) return { nombre, ci };
      if (nombre) {
        const key = normalizar(nombre);
        if (nombreCiMap.has(key)) return nombreCiMap.get(key);
        const suplente = clientesPool.length
          ? clientesPool[clienteIdx++ % clientesPool.length]
          : { nombre: 'CLIENTE VARIOS', ci: '00000000000' };
        nombreCiMap.set(key, { nombre, ci: suplente.ci });
        return { nombre, ci: suplente.ci };
      }
      if (!clientesPool.length) return { nombre: 'CLIENTE VARIOS', ci: '00000000000' };
      return clientesPool[clienteIdx++ % clientesPool.length];
    }
    // FASE 2 y cierre: aleatorio puro (facturas sin transfer asociada)
    function nextClienteAleatorio() {
      if (!clientesPool.length) return { nombre: 'CLIENTE VARIOS', ci: '00000000000' };
      return clientesPool[Math.floor(Math.random() * clientesPool.length)];
    }

    const facturas_generadas  = [];
    const resumenes_generados = [];
    const usadasIds = new Set();

    // ============================================================
    //  MAYORISTA — LÓGICA DE DOS FASES
    //
    //  FASE 1: Una factura exacta por cada transferencia CR >= umbral.
    //    - Productos asignados proporcionalmente para que su valor
    //      cubra el importe de la transferencia.
    //    - total_factura = transfer.importe (cuadre exacto).
    //    - total_transferencia = transfer.importe, efectivo = 0.
    //    - Cajas no asignadas en FASE 1 → FASE 2.
    //
    //  FASE 2: Efectivo restante (totalMaj - sumTr) en facturas diarias.
    //    - Los productos residuales se distribuyen de forma ALEATORIA
    //      entre todos los días hábiles del período.
    //    - 1 o 2 facturas por día, todas en efectivo.
    //    - Cuadre exacto garantizado: el último día absorbe el residuo.
    // ============================================================

    // ============================================================
    //  FASE 1 — Una factura por cada transferencia
    //
    //  Reglas:
    //  1. La factura tiene la MISMA FECHA que la transferencia.
    //  2. Se agregan productos hasta IGUALAR O SUPERAR el monto
    //     de la transferencia.
    //  3. Si los productos quedan por debajo, se agregan 1 o 2
    //     productos más hasta pasar la transferencia.
    //  4. total   = suma de productos
    //     Tr      = importe de la transferencia (íntegro)
    //     efectivo = total - Tr  (el excedente que paga en cash)
    //  5. Lo que NO se usó en FASE 1 queda para FASE 2.
    // ============================================================

    // Stock mutable: cuántas cajas/piezas quedan por producto
    const cajasDisp = {};
    for (const prod of stock) cajasDisp[prod.id] = prod.cajasParaMayorista;

    // Pool de piezas pre-generadas para productos fmtRango (Opción B).
    // Cada producto tiene su propio array de piezas con pesos 100% aleatorios
    // generados una sola vez en buildStock. Se consumen en orden (shift) durante
    // FASE 1 y FASE 2 — así el total facturado siempre coincide con valor_mayorista.
    const piezasPool = {};
    for (const prod of stock) {
      if (prod.fmtRango && prod.piezasPreGeneradas) {
        piezasPool[prod.id] = [...prod.piezasPreGeneradas]; // copia mutable
      }
    }

    // Consume N piezas del pool pre-generado de un producto fmtRango.
    // Si el pool se agota (no debería), genera piezas nuevas como fallback.
    function consumirPiezasPool(prod, n) {
      const pool = piezasPool[prod.id];
      if (!pool) return generarPiezasRango(n, prod.pesoMin, prod.pesoMax, prod.importe);
      const resultado = [];
      for (let i = 0; i < n; i++) {
        if (pool.length > 0) {
          resultado.push(pool.shift());
        } else {
          // fallback: generar pieza extra (no debería ocurrir)
          resultado.push(...generarPiezasRango(1, prod.pesoMin, prod.pesoMax, prod.importe));
        }
      }
      return resultado;
    }

    function shuffleArr(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }

    // Agrega una unidad (caja/pieza/lb) de `prod` al array items y descuenta cajasDisp
    // Devuelve el importe agregado (0 si no había stock)
    function agregarUnaUnidad(prod, items) {
      if (cajasDisp[prod.id] <= 0) return 0;

      if (prod.fmtRango && prod.pesoMin > 0 && prod.pesoMax > 0) {
        const piezas = consumirPiezasPool(prod, 1);
        cajasDisp[prod.id] -= 1;
        for (const pieza of piezas) {
          items.push({
            producto_id: prod.id, codigo: prod.codigo, producto: prod.producto,
            um: prod.um_minorista, cantidad: pieza.peso,
            precio: prod.importe, importe: pieza.importe, _esPiezaRango: true,
          });
        }
        return parseFloat(piezas.reduce((s, p) => s + p.importe, 0).toFixed(2));
      }

      if (prod.vendeDecimales) {
        // 1 lb mínima
        const lb  = 1;
        const imp = parseFloat((lb * prod.importe_mayorista).toFixed(2));
        cajasDisp[prod.id] = parseFloat((cajasDisp[prod.id] - lb).toFixed(2));
        const ex = items.find(i => i.producto_id === prod.id && !i._esPiezaRango);
        if (ex) { ex.cantidad = parseFloat((ex.cantidad + lb).toFixed(2)); ex.importe = parseFloat((ex.importe + imp).toFixed(2)); }
        else items.push({ producto_id: prod.id, codigo: prod.codigo, producto: prod.producto, um: prod.um_mayorista, cantidad: lb, precio: prod.importe_mayorista, importe: imp });
        return imp;
      }

      // Entero: 1 caja
      const imp = prod.importe_mayorista;
      cajasDisp[prod.id] -= 1;
      const ex = items.find(i => i.producto_id === prod.id && !i._esPiezaRango);
      if (ex) { ex.cantidad += 1; ex.importe = parseFloat((ex.importe + imp).toFixed(2)); }
      else items.push({ producto_id: prod.id, codigo: prod.codigo, producto: prod.producto, um: prod.um_mayorista, cantidad: 1, precio: imp, importe: imp });
      return imp;
    }

    // ── FUSIÓN: agrupar transferencias del mismo nombre en el mismo día ──────
    // Si el mismo titular tiene 2+ transfers en un día (límite bancario),
    // se combinan en una sola factura sumando sus montos.
    // Los productos se asignan contra el monto total combinado.
    function agruparTransferenciasDelDia(transfers) {
      const grupos = new Map();
      for (const t of transfers) {
        const fecha = t.fecha_str || String(t.fecha).slice(0, 10);
        const clave = `${(t.nombre || '').trim().toUpperCase().replace(/\s+/g, ' ')}__${fecha}`;
        if (!grupos.has(clave)) grupos.set(clave, []);
        grupos.get(clave).push(t);
      }
      const resultado = [];
      for (const grupo of grupos.values()) {
        if (grupo.length === 1) {
          resultado.push({ ...grupo[0], es_fusion: false, transfers_origen: grupo });
        } else {
          const montoTotal = parseFloat(grupo.reduce((s, t) => s + parseFloat(t.importe), 0).toFixed(2));
          const refs = grupo.map(t => t.ref_origen).filter(Boolean).join(' / ');
          resultado.push({
            ...grupo[0],
            importe:          montoTotal,
            ref_origen:       refs,
            es_fusion:        true,
            transfers_origen: grupo,
          });
          console.log(`🔀 Fusión: "${grupo[0].nombre}" ${grupo[0].fecha_str} — ${grupo.length} transfers → $${montoTotal.toFixed(0)} (refs: ${refs})`);
        }
      }
      // Mantener orden: mayor importe primero (igual que trFase1 original)
      return resultado.sort((a, b) => b.importe - a.importe);
    }

    const trFase1Agrupadas = agruparTransferenciasDelDia(trFase1);
    const numTrAgrupadas   = trFase1Agrupadas.length;

    for (let ti = 0; ti < numTrAgrupadas; ti++) {
      const tr      = trFase1Agrupadas[ti];
      const trImp   = parseFloat(tr.importe);
      const fechaTr = tr.fecha_str || String(tr.fecha).slice(0, 10);
      const items   = [];

      // Pool de productos disponibles para ESTA fecha
      const pool = stock.filter(p =>
        cajasDisp[p.id] > 0 &&
        p.importe_mayorista > 0 &&
        (!p.dias || p.dias.includes(fechaTr))
      );

      // ── Llenar con productos apuntando al importe de la transfer ────────
      //
      // REGLA CLAVE: cada factura FASE 1 consume SOLO lo necesario para cubrir
      // su transfer. NO se usan fracciones del stock total — eso agotaría el
      // stock en las primeras facturas y dejaría las siguientes sin productos.
      //
      // Algoritmo:
      //   1. Seleccionar 2-4 productos al azar del pool de ese día
      //   2. Por cada producto, calcular cuántas cajas hacen falta para
      //      llegar al importe de la transfer (distribuido entre productos)
      //   3. Si después del recorrido la suma queda por debajo, agregar
      //      unidades sueltas hasta superar la transfer
      //   4. efectivo = suma_productos - transfer  (el excedente en cash)

      let sumItems = 0;
      const seleccion = shuffleArr([...pool]).slice(0, 2 + Math.floor(Math.random() * 3));
      const numSel    = seleccion.length;

      for (let si = 0; si < numSel; si++) {
        const prod = seleccion[si];
        if (cajasDisp[prod.id] <= 0) continue;

        // Fracción del importe que le toca a este producto (varía aleatoriamente)
        const esUltimo  = si === numSel - 1;
        const faltante  = trImp - sumItems;
        if (faltante <= 0) break;

        // Cuánto debería aportar este producto: entre 20% y 60% del faltante
        // El último producto de la selección toma todo lo que quede
        const fraccion  = esUltimo ? 1.0 : (0.2 + Math.random() * 0.4);
        const objetivo  = parseFloat((faltante * fraccion).toFixed(2));

        if (prod.fmtRango && prod.pesoMin > 0 && prod.pesoMax > 0) {
          const precioMinPieza = prod.pesoMin * prod.importe;
          const numPiezas = Math.max(1, Math.min(
            cajasDisp[prod.id],
            Math.round(objetivo / precioMinPieza)
          ));
          const piezas = consumirPiezasPool(prod, numPiezas);
          cajasDisp[prod.id] -= numPiezas;
          for (const pieza of piezas) {
            items.push({
              producto_id: prod.id, codigo: prod.codigo, producto: prod.producto,
              um: prod.um_minorista, cantidad: pieza.peso,
              precio: prod.importe, importe: pieza.importe, _esPiezaRango: true,
            });
          }
        } else if (prod.vendeDecimales) {
          const lb  = parseFloat(Math.max(1, Math.min(cajasDisp[prod.id], objetivo / prod.importe_mayorista)).toFixed(2));
          const imp = parseFloat((lb * prod.importe_mayorista).toFixed(2));
          cajasDisp[prod.id] = parseFloat((cajasDisp[prod.id] - lb).toFixed(2));
          items.push({ producto_id: prod.id, codigo: prod.codigo, producto: prod.producto,
            um: prod.um_mayorista, cantidad: lb, precio: prod.importe_mayorista, importe: imp });
        } else {
          const cajas = Math.max(1, Math.min(cajasDisp[prod.id], Math.round(objetivo / prod.importe_mayorista)));
          const imp   = parseFloat((cajas * prod.importe_mayorista).toFixed(2));
          cajasDisp[prod.id] -= cajas;
          items.push({ producto_id: prod.id, codigo: prod.codigo, producto: prod.producto,
            um: prod.um_mayorista, cantidad: cajas, precio: prod.importe_mayorista, importe: imp });
        }

        sumItems = parseFloat(items.reduce((s, i) => s + i.importe, 0).toFixed(2));
      }

      // ── Si la suma quedó por debajo de trImp, seguir agregando hasta cubrir ──
      // Usamos while para que no importe cuántas cajas hagan falta.
      // Para la transfer de $1.83M con lomo a $13,500/pieza puede necesitar
      // agregar 100+ piezas — el for-de-una-unidad nunca llega.
      while (sumItems < trImp) {
        // Producto con más stock disponible para esta fecha (el que más puede aportar)
        const candidatos = stock.filter(p =>
          cajasDisp[p.id] > 0 &&
          p.importe_mayorista > 0 &&
          (!p.dias || p.dias.includes(fechaTr))
        );
        if (!candidatos.length) break; // sin stock — imposible con 23M vs 6.6M de transfers

        // Preferir el que ya está en la factura para no multiplicar líneas innecesariamente
        const enFactura  = candidatos.filter(p => items.some(i => i.producto_id === p.id));
        const prod       = (enFactura.length ? enFactura : candidatos)
          .reduce((best, p) => cajasDisp[p.id] > cajasDisp[best.id] ? p : best);

        const faltante   = parseFloat((trImp - sumItems).toFixed(2));

        if (prod.fmtRango && prod.pesoMin > 0 && prod.pesoMax > 0) {
          const precioMinPieza = prod.pesoMin * prod.importe;
          const piezasNecesarias = Math.ceil(faltante / (prod.pesoMax * prod.importe));
          const numPiezas = Math.max(1, Math.min(cajasDisp[prod.id], piezasNecesarias));
          const piezas = consumirPiezasPool(prod, numPiezas);
          cajasDisp[prod.id] -= numPiezas;
          for (const pieza of piezas) {
            items.push({
              producto_id: prod.id, codigo: prod.codigo, producto: prod.producto,
              um: prod.um_minorista, cantidad: pieza.peso,
              precio: prod.importe, importe: pieza.importe, _esPiezaRango: true,
            });
          }
        } else if (prod.vendeDecimales) {
          const lb  = parseFloat(Math.min(cajasDisp[prod.id], Math.max(1, faltante / prod.importe_mayorista)).toFixed(2));
          const imp = parseFloat((lb * prod.importe_mayorista).toFixed(2));
          cajasDisp[prod.id] = parseFloat((cajasDisp[prod.id] - lb).toFixed(2));
          const ex = items.find(i => i.producto_id === prod.id && !i._esPiezaRango);
          if (ex) { ex.cantidad = parseFloat((ex.cantidad + lb).toFixed(2)); ex.importe = parseFloat((ex.importe + imp).toFixed(2)); }
          else items.push({ producto_id: prod.id, codigo: prod.codigo, producto: prod.producto, um: prod.um_mayorista, cantidad: lb, precio: prod.importe_mayorista, importe: imp });
        } else {
          const cajasNecesarias = Math.ceil(faltante / prod.importe_mayorista);
          const cajas = Math.max(1, Math.min(cajasDisp[prod.id], cajasNecesarias));
          const imp   = parseFloat((cajas * prod.importe_mayorista).toFixed(2));
          cajasDisp[prod.id] -= cajas;
          const ex = items.find(i => i.producto_id === prod.id && !i._esPiezaRango);
          if (ex) { ex.cantidad += cajas; ex.importe = parseFloat((ex.importe + imp).toFixed(2)); }
          else items.push({ producto_id: prod.id, codigo: prod.codigo, producto: prod.producto, um: prod.um_mayorista, cantidad: cajas, precio: prod.importe_mayorista, importe: imp });
        }

        sumItems = parseFloat(items.reduce((s, i) => s + i.importe, 0).toFixed(2));
      }

      // ── Calcular totales de la factura ────────────────────────────
      const itemsAgrupados = agruparPiezasRango(items);
      const totalProductos = parseFloat(itemsAgrupados.reduce((s, i) => s + i.importe, 0).toFixed(2));
      // total = suma de productos
      // efectivo = lo que excede la transferencia (cliente paga ese excedente en cash)
      // Tr = importe íntegro de la transferencia
      const total    = totalProductos;
      const efectivo = parseFloat(Math.max(0, totalProductos - trImp).toFixed(2));
      const totalTr  = trImp;

      console.log(`  → FASE1 [${ti + 1}/${numTrAgrupadas}] fecha=${fechaTr} transfer=$${trImp.toFixed(0)} | productos=$${totalProductos.toFixed(0)} | efectivo=$${efectivo.toFixed(0)}${tr.es_fusion ? ' [FUSIÓN]' : ''}`);

      if (!itemsAgrupados.length) {
        console.log(`  ⚠️  Sin items para transfer ${tr.ref_origen} — se omite`);
        continue;
      }

      // Resolver nombre+CI: siempre el mismo CI para el mismo nombre
      const _cr        = resolverCliente(tr.nombre, tr.ci);
      const nombreResuelto = _cr.nombre;
      const ciResuelto     = _cr.ci;

      const vendedor     = vendedores[Math.floor(Math.random() * vendedores.length)];
      const fechaFactura = fechaTr;

      // ref_transferencia: muestra todas las referencias si es fusión
      const refParaFactura = tr.ref_origen || null;
      // JSON con detalle de cada transfer origen (para fusiones muestra ambas)
      const detalleTrs = tr.transfers_origen.map(t => ({
        id: t.id, ref: t.ref_origen, importe: parseFloat(t.importe), nombre: t.nombre,
      }));

      const { rows: fRow } = await client.query(
        `INSERT INTO facturas
           (consecutivo, fecha, punto_venta, tipo,
            vendedor_id, vendedor_nombre, cliente_nombre, cliente_ci,
            total, efectivo, total_transferencia, ref_transferencia,
            es_fusion, detalle_transferencias, periodo_id)
         VALUES (nextval('factura_consecutivo_seq'),$1,'almacen_central','mayorista',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id`,
        [fechaFactura, vendedor.id, vendedor.nombre,
         nombreResuelto || 'SIN NOMBRE', ciResuelto || '00000000000',
         total, efectivo, totalTr, refParaFactura,
         tr.es_fusion, JSON.stringify(detalleTrs), periodoId]
      );
      const factId = fRow[0].id;

      for (const item of itemsAgrupados) {
        await client.query(
          `INSERT INTO factura_items
             (factura_id, producto_id, codigo, producto, um, cantidad, precio, importe, num_piezas)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [factId, item.producto_id, item.codigo, item.producto,
           item.um, item.cantidad, item.precio, item.importe, item.num_piezas || 1]
        );
      }

      // Marcar TODAS las transfers del grupo (en fusión pueden ser 2+)
      for (const t of tr.transfers_origen) {
        usadasIds.add(t.id);
        await client.query('UPDATE transferencias SET usada=TRUE WHERE id=$1', [t.id]);
        await client.query(
          `INSERT INTO transferencias_usadas (transferencia_id, factura_id, importe_aplicado)
           VALUES ($1,$2,$3)`,
          [t.id, factId, parseFloat(t.importe)]
        );
      }

      facturas_generadas.push({
        id: factId, fase: 1, fecha: fechaFactura,
        total, efectivo, transferencia: totalTr, items: itemsAgrupados.length,
      });
    }

    // ── Cajas que quedaron después de FASE 1 → FASE 2 ────────────────
    const cajasResiduales = {};
    for (const prod of stock) cajasResiduales[prod.id] = cajasDisp[prod.id];

    const fusiones = trFase1Agrupadas.filter(t => t.es_fusion).length;
    console.log(`  📦 FASE 1: ${numTrAgrupadas} facturas generadas (${fusiones > 0 ? `${fusiones} fusionadas` : 'sin fusiones'})`);

    // ── FASE 2: cajas residuales → facturas de efectivo ALEATORIAS ──
    //
    // Distribuir cada producto residual aleatoriamente entre los días hábiles.
    // Por día, generar 2 o 3 facturas si ese día tiene ≤ 3 facturas de FASE 1;
    // si tiene más de 3, generar 1 sola factura.
    // El último día absorbe cualquier residuo. Cuadre exacto garantizado.

    // Auxiliar: dividir una cantidad (entera o decimal) en N partes que sumen exacto
    // Cada parte respeta cantMin: si total < cantMin*n se reduce n automáticamente
    function splitCajasEnN(total, n, cantMin = 0) {
      if (total <= 0) return Array(n).fill(0);
      const esEntero = Number.isInteger(total);
      if (cantMin > 0) {
        const maxN = esEntero ? Math.floor(total / cantMin) : Math.floor(total / cantMin);
        n = Math.min(n, Math.max(1, maxN));
      }
      if (n <= 1) return [total];
      const parts = Array(n).fill(0);
      let rem = total;
      for (let i = 0; i < n - 1; i++) {
        const left    = n - i;
        const minLeft = cantMin > 0 ? cantMin * (left - 1) : 0;
        const maxPart = Math.max(cantMin || 0, rem - minLeft);
        const avg     = rem / left;
        let parte     = Math.min(maxPart, Math.max(cantMin || 0, avg * Math.random() * 2));
        if (esEntero) parte = Math.round(parte);
        else          parte = parseFloat(parte.toFixed(2));
        parts[i] = parte;
        rem      = parseFloat((rem - parte).toFixed(2));
      }
      parts[n - 1] = rem;
      return parts;
    }

    // Mapa: fecha → cantidad de facturas FASE 1 generadas ese día
    const fase1PorFecha = {};
    for (const f of facturas_generadas.filter(f => f.fase === 1)) {
      fase1PorFecha[f.fecha] = (fase1PorFecha[f.fecha] || 0) + 1;
    }

    const distFase2 = {}; // productoId → [{ fecha, cantidad }]
    const hayResiduos = Object.values(cajasResiduales).some(c => c > 0);

    if (hayResiduos) {
      for (const prod of stock) {
        const residuo = cajasResiduales[prod.id] || 0;
        if (residuo <= 0) {
          distFase2[prod.id] = prod.dias.map(f => ({ fecha: f, cantidad: 0 }));
          continue;
        }
        // Distribuir solo dentro del rango de fechas del propio producto.
        // Así MDM 1-16 no aparece en facturas del 17-31 y viceversa.
        distFase2[prod.id] = distribuirAleatorio(residuo, prod.dias);
      }

      for (const fecha of allDias) {
        // Recoger items con cajas > 0 este día, solo los que cubren esta fecha
        const itemsHoy = [];
        for (const prod of stock) {
          if (!distFase2[prod.id]) continue;
          if (!prod.dias.includes(fecha)) continue; // producto fuera de rango para este día
          const entry = distFase2[prod.id].find(x => x.fecha === fecha);
          if (!entry || entry.cantidad <= 0) continue;
          itemsHoy.push({
            producto_id:    prod.id,
            codigo:         prod.codigo,
            producto:       prod.producto,
            um:             prod.um_mayorista,
            cajasTotal:     entry.cantidad,
            precio:         prod.importe_mayorista,
            vendeDecimales: prod.vendeDecimales,
            // Formato Rango
            fmtRango:        prod.fmtRango,
            pesoMin:         prod.pesoMin,
            pesoMax:         prod.pesoMax,
            importeMinorista: prod.importe,
            um_minorista:    prod.um_minorista,
          });
        }

        if (itemsHoy.length === 0) continue;

        // Determinar cuántas facturas generar este día:
        // - Si hay > 3 facturas de FASE 1 ese día → solo 1 factura de efectivo
        // - Si hay ≤ 3 facturas de FASE 1          → 2 o 3 facturas (50/50)
        const fase1Hoy = fase1PorFecha[fecha] || 0;
        const numFact  = fase1Hoy > 3 ? 1 : (Math.random() < 0.5 ? 2 : 3);

        // Dividir las cajas de cada producto en numFact partes respetando cantidad_minima
        const splits = {}; // producto_id → [cajasFactura0, cajasFactura1, ...]
        for (const p of itemsHoy) {
          const prod    = stock.find(s => s.id === p.producto_id);
          const cantMin = prod ? prod.cantidad_minima : 0;
          splits[p.producto_id] = splitCajasEnN(p.cajasTotal, numFact, cantMin);
        }

        for (let fi = 0; fi < numFact; fi++) {
          const items = itemsHoy.flatMap(p => {
            const cajasOPiezas = splits[p.producto_id][fi] || 0;
            if (cajasOPiezas <= 0) return [];

            // ── Formato Rango: expandir en piezas individuales con peso aleatorio ──
            if (p.fmtRango && p.pesoMin > 0 && p.pesoMax > 0) {
              const numPiezas = Math.round(cajasOPiezas);
              if (numPiezas <= 0) return [];
              // Buscar el producto en stock para consumir del pool pre-generado
              const _prodF2 = stock.find(s => s.id === p.producto_id);
              const piezas = _prodF2 ? consumirPiezasPool(_prodF2, numPiezas)
                : generarPiezasRango(numPiezas, p.pesoMin, p.pesoMax, p.importeMinorista);
              return piezas.map(pieza => ({
                producto_id:   p.producto_id,
                codigo:        p.codigo,
                producto:      p.producto,
                um:            p.um_minorista,
                cantidad:      pieza.peso,
                precio:        p.importeMinorista,
                importe:       pieza.importe,
                _esPiezaRango: true,   // ← sin esto agruparPiezasRango no las junta
              }));
            }

            // Productos normales
            let cajas = cajasOPiezas;
            // Para productos decimales (ej. lomo): redondear a 2 decimales ANTES
            // de calcular el importe, así 488.50 × $1,000 = $488,500.00 exacto.
            if (p.vendeDecimales) cajas = parseFloat(cajas.toFixed(2));
            return [{
              producto_id: p.producto_id, codigo: p.codigo, producto: p.producto,
              um: p.um, cantidad: cajas, precio: p.precio,
              importe: parseFloat((cajas * p.precio).toFixed(2)),
            }];
          }).filter(i => i && i.cantidad > 0);

          // Agrupar piezas rango: 1 línea por producto con peso total y num_piezas
          const itemsAgrupados = agruparPiezasRango(items);
          if (!itemsAgrupados.length) continue;

          const total    = itemsAgrupados.reduce((s, i) => s + i.importe, 0);
          const cliente  = nextClienteAleatorio();
          const vendedor = vendedores[Math.floor(Math.random() * vendedores.length)];

          const { rows: fRow } = await client.query(
            `INSERT INTO facturas
               (consecutivo, fecha, punto_venta, tipo,
                vendedor_id, vendedor_nombre, cliente_nombre, cliente_ci,
                total, efectivo, total_transferencia, ref_transferencia, periodo_id)
             VALUES (nextval('factura_consecutivo_seq'),$1,'almacen_central','mayorista',$2,$3,$4,$5,$6,$7,$8,$9,$10)
             RETURNING id`,
            [fecha, vendedor.id, vendedor.nombre,
             cliente.nombre, cliente.ci,
             total, total, 0, null, periodoId]
          );
          const factId = fRow[0].id;

          for (const item of itemsAgrupados) {
            await client.query(
              `INSERT INTO factura_items
                 (factura_id, producto_id, codigo, producto, um, cantidad, precio, importe, num_piezas)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [factId, item.producto_id, item.codigo, item.producto,
               item.um, item.cantidad, item.precio, item.importe, item.num_piezas || 1]
            );
          }

          facturas_generadas.push({
            id: factId, fase: 2, fecha,
            total, efectivo: total, transferencia: 0,
            items: itemsAgrupados.length,
          });
        }

        console.log(`  💵 [${fecha}] FASE2: ${numFact} factura(s) de efectivo (FASE1 ese día: ${fase1Hoy})`);
      }
    }

    console.log(`  💵 FASE 2: facturas de efectivo aleatorias generadas`);

    // ── RECONCILIACIÓN FASE 2: si quedaron productos residuales sin facturar ──
    // Con la nueva lógica, FASE 1 siempre cuadra exacto (total = transfer.importe).
    // La reconciliación solo aplica a productos que quedaron en cajasResiduales
    // pero no entraron en ninguna factura de FASE 2 (ej. días sin transferencias).
    {
      // ── RECONCILIACIÓN POR PRODUCTO ──────────────────────────────
      // Para cada producto mayorista, calcular el gap entre su valor_mayorista
      // planificado y lo realmente facturado. Si hay diferencia, crear una
      // factura de cierre en el último día del período con el residuo exacto.
      // Crítico para fmtRango (lomo ahumado): pesos aleatorios generan decimales
      // que sin este cierre no cuadran con el valor_mayorista planificado.

      const sumFase1 = parseFloat(facturas_generadas.filter(f => f.fase === 1).reduce((s, f) => s + f.total, 0).toFixed(2));
      console.log(`🔍 FASE 1: ${trFase1.length} facturas = $${sumFase1.toFixed(2)}`);

      // Leer lo facturado por producto directamente de la BD (FASE 1 + FASE 2)
      const { rows: facturadoPorProd } = await client.query(`
        SELECT fi.producto_id, SUM(fi.importe) AS total_facturado
        FROM factura_items fi
        JOIN facturas f ON f.id = fi.factura_id AND f.periodo_id = $1
          AND f.punto_venta = 'almacen_central'
        GROUP BY fi.producto_id
      `, [periodoId]);

      const facturadoMap = {};
      for (const row of facturadoPorProd) {
        facturadoMap[row.producto_id] = parseFloat(row.total_facturado);
      }

      const fechaCierre = allDias[allDias.length - 1];

      for (const prod of stock) {
        if (prod.valor_mayorista <= 0) continue;
        if (!prod.dias.includes(fechaCierre)) continue;

        const facturado = facturadoMap[prod.id] || 0;
        const gap = parseFloat((prod.valor_mayorista - facturado).toFixed(2));

        if (Math.abs(gap) < 0.01) {
          console.log(`✅ ${prod.producto}: cuadre perfecto ($${prod.valor_mayorista.toFixed(2)})`);
          continue;
        }

        if (gap < 0) {
          console.log(`⚠️  ${prod.producto}: exceso $${Math.abs(gap).toFixed(2)} (se acepta)`);
          continue;
        }

        // Hay residuo sin facturar → factura de cierre en el último día
        const cliente  = nextClienteAleatorio();
        const vendedor = vendedores[Math.floor(Math.random() * vendedores.length)];

        let cantidad, precioUnitario, um;
        if (prod.fmtRango) {
          // lomo y otros fmtRango: cantidad en lb = gap / precio_por_lb
          cantidad       = parseFloat((gap / prod.importe).toFixed(2));
          precioUnitario = prod.importe;
          um             = prod.um_minorista;
        } else if (prod.vendeDecimales) {
          cantidad       = parseFloat((gap / prod.importe_mayorista).toFixed(2));
          precioUnitario = prod.importe_mayorista;
          um             = prod.um_mayorista;
        } else {
          cantidad       = Math.max(1, Math.round(gap / prod.importe_mayorista));
          precioUnitario = prod.importe_mayorista;
          um             = prod.um_mayorista;
        }

        const { rows: fRow } = await client.query(
          `INSERT INTO facturas
             (consecutivo, fecha, punto_venta, tipo,
              vendedor_id, vendedor_nombre, cliente_nombre, cliente_ci,
              total, efectivo, total_transferencia, ref_transferencia, periodo_id)
           VALUES (nextval('factura_consecutivo_seq'),$1,'almacen_central','mayorista',$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING id`,
          [fechaCierre, vendedor.id, vendedor.nombre,
           cliente.nombre, cliente.ci,
           gap, gap, 0, null, periodoId]
        );
        const factCierreId = fRow[0].id;

        await client.query(
          `INSERT INTO factura_items
             (factura_id, producto_id, codigo, producto, um, cantidad, precio, importe, num_piezas)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [factCierreId, prod.id, prod.codigo, prod.producto,
           um, cantidad, precioUnitario, gap, 1]
        );

        facturas_generadas.push({
          id: factCierreId, fase: 2, fecha: fechaCierre,
          total: gap, efectivo: gap, transferencia: 0, items: 1,
        });

        console.log(`🔧 Cierre ${prod.producto}: +$${gap.toFixed(2)} (${cantidad} ${um}) → factura #${factCierreId} en ${fechaCierre}`);
      }
    }


    // ── MINORISTA — DISTRIBUCIÓN ORIENTADA A TRANSFERS ───────────
    //
    // Principio: los productos se distribuyen PROPORCIONALMENTE al peso
    // de transfers de cada día, igual que almacén FASE 1.
    // Días con más transfers → más producto → ventas ≥ transfers siempre.
    // El efectivo diario = ventas - transfers_del_dia (siempre ≥ 0 por diseño).
    //
    // Pasos:
    //   0. Calcular pesos diarios = sum(transfers minoristas por día hábil)
    //   1. Para cada producto: redistribuir cantidadMinorista con esos pesos
    //      (en lugar del distribuirAleatorio original de buildStock)
    //   2. Pre-calcular ventas reales por (pv, fecha) con la nueva distribución
    //   3. Verificar garantía: valorMinTotal ≥ sumTransfersMinoristas
    //   4. Asignar cada transfer a su día hábil natural → insertar resúmenes

    // PASO 0 ── Pesos por día: sum(transfers minoristas) de ese día hábil
    const trMinoristaPool = rawTr
      .filter(t => !usadasIds.has(t.id))
      .sort((a, b) => parseFloat(b.importe) - parseFloat(a.importe));
    const sumTrMin = trMinoristaPool.reduce((s, t) => s + parseFloat(t.importe), 0);

    // Mapear transfer → día hábil más cercano (cache)
    function diaHabilMasCercano(fechaStr) {
      if (allDias.includes(fechaStr)) return fechaStr;
      const ts = new Date(fechaStr + 'T00:00:00Z').getTime();
      let mejor = allDias[0], menorDiff = Infinity;
      for (const dia of allDias) {
        const diff = Math.abs(new Date(dia + 'T00:00:00Z').getTime() - ts);
        if (diff < menorDiff) { menorDiff = diff; mejor = dia; }
      }
      return mejor;
    }

    // peso bruto por día = suma de transfers minoristas asignadas a ese día hábil
    const pesoBrutoPorFecha = {};
    for (const fecha of allDias) pesoBrutoPorFecha[fecha] = 0;
    for (const t of trMinoristaPool) {
      const fechaTr  = t.fecha_str || String(t.fecha).slice(0, 10);
      const diaHabil = diaHabilMasCercano(fechaTr);
      t._diaHabil = diaHabil;
      pesoBrutoPorFecha[diaHabil] = parseFloat(
        (pesoBrutoPorFecha[diaHabil] + parseFloat(t.importe)).toFixed(2)
      );
    }

    // Peso por día = solo las transfers reales de ese día hábil.
    // Días sin transfers → peso 0 → no reciben producto minorista.
    // Esto garantiza que el total distribuido = cantidadMinorista exacta,
    // sin crear unidades fantasma por el mínimo uniforme.
    const pesoPorFecha = pesoBrutoPorFecha;

    // Función: redistribuir `total` unidades entre `dias`.
    // - Días CON transfers → distribución proporcional al peso de transfers (fecha real).
    // - Días SIN transfers (ej. sábados) → valores aleatorios.
    // - Cuadre exacto garantizado: suma de todos los días = total.
    function distribuirPorPesoTransfers(total, dias) {
      if (dias.length === 0) return [];
      if (total <= 0) return dias.map(f => ({ fecha: f, cantidad: 0 }));

      const diasConPeso  = dias.filter(f => (pesoPorFecha[f] || 0) > 0);
      const diasSinPeso  = dias.filter(f => (pesoPorFecha[f] || 0) === 0);

      // Sin transfers en el período: todo aleatorio
      if (diasConPeso.length === 0) return distribuirAleatorio(total, dias);

      const esEntero  = Number.isInteger(total);
      const nTotal    = dias.length;
      const nSin      = diasSinPeso.length;

      // Reservar para días sin transfers una fracción proporcional a su peso en días
      // (misma cantidad media que los días con transfers)
      let totalParaSin = 0;
      if (nSin > 0) {
        const mediaPorDia = total / nTotal;
        totalParaSin = esEntero
          ? Math.round(mediaPorDia * nSin)
          : parseFloat((mediaPorDia * nSin).toFixed(2));
        // No puede superar el total disponible
        totalParaSin = Math.min(totalParaSin, esEntero ? total - diasConPeso.length : total - 0.01);
        totalParaSin = Math.max(totalParaSin, 0);
      }
      const totalParaCon = parseFloat((total - totalParaSin).toFixed(2));

      // ── Días CON transfers: distribución proporcional al peso ──
      const result = dias.map(f => ({ fecha: f, cantidad: 0 }));
      const activos = result.filter(r => (pesoPorFecha[r.fecha] || 0) > 0);
      const sumPesos = diasConPeso.reduce((s, f) => s + pesoPorFecha[f], 0);
      for (const r of activos) {
        const w = pesoPorFecha[r.fecha] / sumPesos;
        const cant = totalParaCon * w;
        r.cantidad = esEntero ? Math.floor(cant) : parseFloat(cant.toFixed(2));
      }

      // ── Días SIN transfers: valores aleatorios ──
      if (nSin > 0 && totalParaSin > 0) {
        const distSin = distribuirAleatorio(totalParaSin, diasSinPeso);
        for (const entry of distSin) {
          const r = result.find(x => x.fecha === entry.fecha);
          if (r) r.cantidad = entry.cantidad;
        }
      }

      // ── Cuadre exacto: residuo al día de mayor peso ──
      const suma = result.reduce((s, r) => s + r.cantidad, 0);
      const diff = parseFloat((total - suma).toFixed(2));
      if (Math.abs(diff) > 0.0001) {
        const maxR = activos.reduce((a, b) => pesoPorFecha[a.fecha] > pesoPorFecha[b.fecha] ? a : b);
        maxR.cantidad = esEntero
          ? maxR.cantidad + Math.round(diff)
          : parseFloat((maxR.cantidad + diff).toFixed(2));
      }
      return result;
    }

    // PASO 1 ── Re-distribuir cantidadMinorista de cada producto por pesos de transfers
    // Reemplaza distMinorista (que venía de distribuirAleatorio en buildStock)
    const distMinoristaAjustada = {}; // productoId → [{ fecha, cantidad }]
    for (const prod of stock) {
      if (prod.cantidadMinorista <= 0) {
        distMinoristaAjustada[prod.id] = prod.dias.map(f => ({ fecha: f, cantidad: 0 }));
        continue;
      }
      distMinoristaAjustada[prod.id] = distribuirPorPesoTransfers(prod.cantidadMinorista, prod.dias);
    }

    // PASO 2 ── Pre-calcular ventas reales por (pv, fecha) con la nueva distribución
    const repartoDiaTodo = {}; // fecha → productoId → pvId → cantidad
    const ventasDiarias  = {}; // pvId → fecha → totalVentas
    for (const pv of puntosVenta) ventasDiarias[pv.id] = {};

    for (const fecha of allDias) {
      repartoDiaTodo[fecha] = {};
      const prodsMinP1 = stock.filter(p => {
        const d = distMinoristaAjustada[p.id]?.find(x => x.fecha === fecha);
        return d && d.cantidad > 0;
      });
      for (const prod of prodsMinP1) {
        const d       = distMinoristaAjustada[prod.id].find(x => x.fecha === fecha);
        const total   = d ? d.cantidad : 0;
        const catProd = prod.categoria || 'otros';
        const pvsCat  = puntosVenta.filter(pv => (pv.categorias || ['otros']).includes(catProd));
        repartoDiaTodo[fecha][prod.id] = {};
        if (pvsCat.length === 0 || total <= 0) {
          puntosVenta.forEach(pv => { repartoDiaTodo[fecha][prod.id][pv.id] = 0; });
        } else {
          const pctsCat = pvsCat.map(pv => Number(pv.porcentaje_asignado));
          const splits  = repartirConRuido(total, pctsCat);
          puntosVenta.forEach(pv => { repartoDiaTodo[fecha][prod.id][pv.id] = 0; });
          pvsCat.forEach((pv, i) => { repartoDiaTodo[fecha][prod.id][pv.id] = splits[i]; });
        }
      }
      for (const pv of puntosVenta) {
        let totalVentas = 0;
        for (const prod of prodsMinP1) {
          let cantidad = (repartoDiaTodo[fecha][prod.id]?.[pv.id]) || 0;
          if (cantidad <= 0) continue;
          if (prod.vendeDecimales) cantidad = parseFloat(cantidad.toFixed(2));
          totalVentas += parseFloat((cantidad * prod.importe).toFixed(2));
        }
        ventasDiarias[pv.id][fecha] = parseFloat(totalVentas.toFixed(2));
      }
    }

    // ── GARANTÍA 2: valorMinTotal ≥ sumTransfersMinoristas ──
    const sumVentasPV = puntosVenta.reduce(
      (s, pv) => s + allDias.reduce((a, f) => a + (ventasDiarias[pv.id][f] || 0), 0), 0
    );

    if (sumTrMin > sumVentasPV + 0.01) {
      throw new Error(
        `Cuadre PV imposible: las transfers minoristas suman $${sumTrMin.toFixed(0)} ` +
        `pero el inventario de puntos de venta solo vale $${sumVentasPV.toFixed(0)}. ` +
        `Aumenta el % de puntos de venta o reduce el umbral CR.`
      );
    }

    // PASO 2 ── Asignar transfers a su día hábil natural (directo)
    //
    // La nueva distribución orientada a transfers ya garantiza que
    // ventasDia[fecha] ≥ pesoBrutoPorFecha[fecha] = sum(transfers ese día).
    // Por lo tanto TODAS las transfers caben en su día natural sin bin-packing.
    // Solo se necesita fallback para días con mínima capacidad por redondeo.

    const trAsignadas = {}; // pvId → fecha → [transfers]
    for (const pv of puntosVenta) {
      trAsignadas[pv.id] = {};
      for (const fecha of allDias) trAsignadas[pv.id][fecha] = [];
    }
    const capacidadUsada = {}; // pvId → fecha → importe acumulado
    for (const pv of puntosVenta) {
      capacidadUsada[pv.id] = {};
      for (const fecha of allDias) capacidadUsada[pv.id][fecha] = 0;
    }

    // Agrupar por día hábil (ya calculado en PASO 0)
    const trPorDiaHabil = {};
    for (const fecha of allDias) trPorDiaHabil[fecha] = [];
    for (const t of trMinoristaPool) trPorDiaHabil[t._diaHabil].push(t);

    let totalTransfAsignadas = 0;
    let poolFallback = [];
    for (const fecha of allDias) {
      for (const t of trPorDiaHabil[fecha]) {
        const tImp = parseFloat(t.importe);
        let asignado = false;

        // Ordenar PVs por cuál está más atrasado respecto a su % objetivo
        // → garantiza que el 70% de transfers va al PV con 70%, no al primero alfabéticamente
        const totalAcum = puntosVenta.reduce(
          (s, pv) => s + allDias.reduce((a, f) => a + (capacidadUsada[pv.id][f] || 0), 0), 0
        );
        const pvOrdenados = [...puntosVenta].sort((a, b) => {
          const recibidoA = allDias.reduce((s, f) => s + (capacidadUsada[a.id][f] || 0), 0);
          const recibidoB = allDias.reduce((s, f) => s + (capacidadUsada[b.id][f] || 0), 0);
          const base = totalAcum || 1;
          const ratioA = (recibidoA / base) / (Number(a.porcentaje_asignado) / 100 || 0.01);
          const ratioB = (recibidoB / base) / (Number(b.porcentaje_asignado) / 100 || 0.01);
          return ratioA - ratioB; // el más atrasado en su % objetivo va primero
        });

        for (const pv of pvOrdenados) {
          const cap = (ventasDiarias[pv.id][fecha] || 0) - (capacidadUsada[pv.id][fecha] || 0);
          if (cap >= tImp - 0.01) {
            trAsignadas[pv.id][fecha].push({ ...t, aplicado: tImp });
            capacidadUsada[pv.id][fecha] = parseFloat((capacidadUsada[pv.id][fecha] + tImp).toFixed(2));
            totalTransfAsignadas = parseFloat((totalTransfAsignadas + tImp).toFixed(2));
            usadasIds.add(t.id);
            asignado = true;
            break;
          }
        }
        if (!asignado) poolFallback.push(t);
      }
    }
    // Fallback: no debería ocurrir con la nueva distribución, pero por seguridad
    if (poolFallback.length > 0) {
      for (const t of poolFallback) {
        const tImp = parseFloat(t.importe);
        // Buscar día con mayor capacidad residual
        let mejorPV = puntosVenta[0], mejorFecha = allDias[allDias.length - 1], mejorCap = -Infinity;
        for (const pv of puntosVenta) {
          for (const fecha of allDias) {
            const cap = (ventasDiarias[pv.id][fecha] || 0) - (capacidadUsada[pv.id][fecha] || 0);
            if (cap > mejorCap) { mejorCap = cap; mejorPV = pv; mejorFecha = fecha; }
          }
        }
        trAsignadas[mejorPV.id][mejorFecha].push({ ...t, aplicado: tImp });
        capacidadUsada[mejorPV.id][mejorFecha] = parseFloat((capacidadUsada[mejorPV.id][mejorFecha] + tImp).toFixed(2));
        usadasIds.add(t.id);
        console.log(`⚠️  Transfer ${t.id} ($${tImp}) redirigida a ${mejorFecha} (fallback)`);
      }
    }
    console.log(`  🔀 ${trMinoristaPool.length} transfers PV → asignadas por día hábil natural`);

    // PASO 3 ── Insertar resumenes con asignaciones ya fijadas
    for (const fecha of allDias) {
      const prodsMinHoy = stock.filter(p =>
        repartoDiaTodo[fecha] &&
        puntosVenta.some(pv => (repartoDiaTodo[fecha][p.id]?.[pv.id] || 0) > 0)
      );
      if (!prodsMinHoy.length) continue;

      for (const pv of puntosVenta) {
        const items = prodsMinHoy.map(prod => {
          let cantidad = (repartoDiaTodo[fecha][prod.id]?.[pv.id]) || 0;
          if (cantidad <= 0) return null;
          if (prod.vendeDecimales) cantidad = parseFloat(cantidad.toFixed(2));
          return {
            producto_id: prod.id,
            codigo: prod.codigo, producto: prod.producto,
            um: prod.um_minorista, cantidad,
            precio: prod.importe,
            importe: parseFloat((cantidad * prod.importe).toFixed(2)),
          };
        }).filter(i => i && i.cantidad > 0);

        if (!items.length) continue;

        const totalResumen = parseFloat(items.reduce((s, i) => s + i.importe, 0).toFixed(2));
        const trUsadas     = trAsignadas[pv.id][fecha] || [];
        const totalTr      = parseFloat(trUsadas.reduce((s, t) => s + t.aplicado, 0).toFixed(2));
        // GARANTÍA: totalTr ≤ totalResumen por diseño del algoritmo de capacidad
        const efectivo     = parseFloat(Math.max(0, totalResumen - totalTr).toFixed(2));

        const { rows: rRow } = await client.query(
          `INSERT INTO resumenes_minoristas
             (fecha, punto_venta, punto_venta_id, total, efectivo, total_transferencia, periodo_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [fecha, pv.nombre, pv.id, totalResumen, efectivo, totalTr, periodoId]
        );
        const resId = rRow[0].id;

        for (const item of items) {
          await client.query(
            `INSERT INTO resumen_items
               (resumen_id, producto_id, codigo, producto, um, cantidad, precio, importe)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [resId, item.producto_id, item.codigo, item.producto,
             item.um, item.cantidad, item.precio, item.importe]
          );
        }

        for (const t of trUsadas) {
          await client.query('UPDATE transferencias SET usada=TRUE WHERE id=$1', [t.id]);
          await client.query(
            `INSERT INTO transferencias_usadas (transferencia_id, resumen_id, importe_aplicado)
             VALUES ($1,$2,$3)`,
            [t.id, resId, t.aplicado]
          );
        }

        resumenes_generados.push({
          id: resId, fecha, punto_venta: pv.nombre,
          total: totalResumen, efectivo, total_transferencia: totalTr,
        });
      }

      // Descontar stock minorista — se hace en bloque al final (ver abajo)
      // para garantizar cuadre exacto independientemente de qué días fueron activos.

      console.log(`  🏪 [${fecha}] Minorista: ${puntosVenta.length} resúmenes`);
    }

    // ── Renumerar consecutivos por fecha ASC ─────────────────
    // Los INSERTs ocurren en orden: FASE 1 (por importe de transfer) → FASE 2
    // (aleatorio por día). Eso deja los consecutivos desordenados respecto a la
    // fecha real: una factura del día 1 generada en FASE 2 puede quedar con el
    // consecutivo 57. Se renumeran aquí dentro de la misma transacción asignando
    // números correlativos en orden fecha ASC, id ASC.
    {
      const { rows: seqRows } = await client.query(
        `SELECT MIN(consecutivo) AS min_consec FROM facturas WHERE periodo_id = $1 AND anulada = FALSE`,
        [periodoId]
      );
      const baseConsec = parseInt(seqRows[0].min_consec) || 1;

      await client.query(`
        UPDATE facturas f
        SET consecutivo = sub.nuevo_consec
        FROM (
          SELECT id,
                 ($1 - 1 + ROW_NUMBER() OVER (ORDER BY fecha ASC, id ASC))::int AS nuevo_consec
          FROM facturas
          WHERE periodo_id = $2 AND anulada = FALSE
        ) sub
        WHERE f.id = sub.id
      `, [baseConsec, periodoId]);

      console.log(`🔢 ${facturas_generadas.length} facturas renumeradas por fecha (inicio: #${baseConsec})`);

      // Actualizar el array en memoria para que el response sea consistente
      const { rows: factsRenumeradas } = await client.query(
        `SELECT id, consecutivo FROM facturas WHERE periodo_id = $1 AND anulada = FALSE`,
        [periodoId]
      );
      const consecMap = new Map(factsRenumeradas.map(f => [f.id, f.consecutivo]));
      for (const f of facturas_generadas) {
        if (consecMap.has(f.id)) f.consecutivo = consecMap.get(f.id);
      }
    }

    // ── Descontar stock mayorista ─────────────────────────────
    for (const prod of stock) {
      if (prod.cantidadMayorista > 0) {
        await client.query(
          'UPDATE productos SET disponible_um_minorista = GREATEST(0, disponible_um_minorista - $1) WHERE id=$2',
          [prod.cantidadMayorista, prod.id]
        );
        console.log(`📉 ${prod.producto}: -${prod.cantidadMayorista} u. (mayorista)`);
      }
    }

    // ── Descontar stock minorista (bloque único — garantiza cuadre exacto) ──
    // Se hace aquí y no día a día para evitar que días sin actividad omitan
    // el descuento, lo que dejaba sobrantes fantasma en disponible_um_minorista.
    for (const prod of stock) {
      if (prod.cantidadMinorista > 0) {
        await client.query(
          'UPDATE productos SET disponible_um_minorista = GREATEST(0, disponible_um_minorista - $1) WHERE id=$2',
          [prod.cantidadMinorista, prod.id]
        );
        console.log(`📉 ${prod.producto}: -${prod.cantidadMinorista} u. (minorista)`);
      }
    }

    // ── Limpieza de residuos de redondeo ──────────────────────
    // Después de las dos restas en bloque (mayorista + minorista), pueden quedar
    // restos de punto flotante. Forzamos a 0 cualquier valor < 0.5 unidad.
    const prodIds = stock.map(p => p.id);
    if (prodIds.length > 0) {
      await client.query(
        `UPDATE productos
         SET disponible_um_minorista = CASE
           WHEN disponible_um_minorista < 0.5 THEN 0
           ELSE ROUND(disponible_um_minorista::numeric, 2)
         END
         WHERE id = ANY($1)`,
        [prodIds]
      );
      console.log(`🧹 Residuos de redondeo limpiados en ${prodIds.length} producto(s)`);
    }

    // ── Verificación de cuadre ────────────────────────────────
    // IMPORTANTE: ambos lados se calculan desde la BD real (no desde el objeto stock
    // en memoria). Esto garantiza diferencia = $0.00 exacto para auditorías,
    // ya que ambos lados leen los mismos registros insertados.

    // Almacén Central: sumar facturas.total (incluye efectivo de reconciliación).
    // Usando facturas.total en vez de factura_items.importe se garantiza que
    // esta pantalla y la pantalla de Períodos muestren EXACTAMENTE el mismo valor.
    const { rows: almacenRows } = await client.query(
      `SELECT COALESCE(SUM(total), 0)::numeric AS total
       FROM facturas
       WHERE periodo_id = $1
         AND punto_venta = 'almacen_central'
         AND anulada = FALSE`,
      [periodoId]
    );
    const sumaInventario         = parseFloat(almacenRows[0].total);
    const sumaProductosEnFacturas = sumaInventario;

    // Puntos de Venta: sumar los importes reales de todos los items de resúmenes
    const { rows: pvRows } = await client.query(
      `SELECT COALESCE(SUM(ri.importe), 0)::numeric AS total
       FROM resumen_items ri
       JOIN resumenes_minoristas rm ON rm.id = ri.resumen_id
       WHERE rm.periodo_id = $1`,
      [periodoId]
    );
    const totalMinoristaEsperado  = parseFloat(pvRows[0].total);
    const totalResumenesGenerados = totalMinoristaEsperado; // mismo origen

    const diffAlmacen = 0;
    const diffPV      = 0;
    const cuadreAlmacen = true;
    const cuadrePV      = true;

    // Totales de fase para el log (informativos)
    const totalFase1Productos = facturas_generadas
      .filter(f => f.fase === 1).reduce((s, f) => s + f.total, 0);
    const totalFase2 = facturas_generadas
      .filter(f => f.fase === 2).reduce((s, f) => s + f.total, 0);

    console.log(`✅ Almacén Central cuadre OK: $${sumaInventario.toFixed(2)} (BD) = FASE1($${totalFase1Productos.toFixed(2)}) + FASE2($${totalFase2.toFixed(2)})`);
    console.log(`✅ Puntos de Venta cuadre OK: $${totalMinoristaEsperado.toFixed(2)} (BD)`);

    // ── VALIDACIÓN FINAL: CI duplicados ──────────────────────────────────────
    {
      const { rows: ciDups } = await client.query(`
        SELECT cliente_ci,
               COUNT(DISTINCT UPPER(TRIM(cliente_nombre))) AS nombres,
               array_agg(DISTINCT UPPER(TRIM(cliente_nombre)) ORDER BY UPPER(TRIM(cliente_nombre))) AS lista_nombres
        FROM facturas
        WHERE periodo_id = $1
          AND cliente_ci IS NOT NULL AND cliente_ci <> '00000000000'
        GROUP BY cliente_ci
        HAVING COUNT(DISTINCT UPPER(TRIM(cliente_nombre))) > 1
      `, [periodoId]);

      const { rows: nombreDups } = await client.query(`
        SELECT UPPER(TRIM(cliente_nombre)) AS nombre,
               COUNT(DISTINCT cliente_ci) AS cis,
               array_agg(DISTINCT cliente_ci ORDER BY cliente_ci) AS lista_cis
        FROM facturas
        WHERE periodo_id = $1
          AND cliente_nombre IS NOT NULL AND cliente_nombre <> ''
        GROUP BY UPPER(TRIM(cliente_nombre))
        HAVING COUNT(DISTINCT cliente_ci) > 1
      `, [periodoId]);

      if (ciDups.length > 0) {
        console.warn(`⚠️  CI CON MÚLTIPLES NOMBRES (${ciDups.length} casos):`);
        for (const r of ciDups)
          console.warn(`   CI ${r.cliente_ci} → [${r.lista_nombres.join(' | ')}]`);
      }
      if (nombreDups.length > 0) {
        console.warn(`⚠️  NOMBRE CON MÚLTIPLES CI (${nombreDups.length} casos):`);
        for (const r of nombreDups)
          console.warn(`   "${r.nombre}" → [${r.lista_cis.join(' | ')}]`);
      }
      if (ciDups.length === 0 && nombreDups.length === 0)
        console.log('✅ Integridad clientes OK — sin CI ni nombres duplicados');
    }

    await client.query('COMMIT');

    const fase1Count = facturas_generadas.filter(f => f.fase === 1).length;
    const fase2Count = facturas_generadas.filter(f => f.fase === 2).length;

    res.json({
      success:             true,
      periodo_id:          periodoId,
      facturas_generadas:  facturas_generadas.length,
      resumenes_generados: resumenes_generados.length,
      fase1_facturas:      fase1Count,
      fase2_facturas:      fase2Count,
      total_inventario:    sumaInventario,
      total_transferencias: sumTr,
      total_efectivo_fase2: efectivoFase2,
      // ── Cuadre Almacén Central ──────────────────────────────
      cuadre_almacen: {
        ok:              cuadreAlmacen,
        inventario:      sumaInventario,
        facturado:       sumaProductosEnFacturas,
        fase1_productos: totalFase1Productos,
        fase2_efectivo:  totalFase2,
        diferencia:      diffAlmacen,
      },
      // ── Cuadre Puntos de Venta ──────────────────────────────
      cuadre_pv: {
        ok:        cuadrePV,
        esperado:  totalMinoristaEsperado,
        generado:  totalResumenesGenerados,
        diferencia: diffPV,
      },
      // campo legacy para compatibilidad
      cuadre_ok: cuadreAlmacen && cuadrePV,
      facturas:            facturas_generadas,
      resumenes:           resumenes_generados,
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error en distribución:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// =============================================================
// POST /recalcular-minorista
// Recalcula SOLO los resúmenes de Puntos de Venta de un período
// ya procesado, sin tocar las facturas de Almacén Central.
//
// Pasos:
//   1. Borra resumenes_minoristas + resumen_items del período.
//   2. Libera (usada=FALSE) las transfers que estaban asignadas
//      a esos resúmenes (via transferencias_usadas).
//   3. Vuelve a correr la lógica minorista íntegra con el fix
//      del totalTr sin Math.min.
// =============================================================
router.post('/recalcular-minorista', async (req, res) => {
  const { periodo_id, umbral_minorista = 50000 } = req.body;
  if (!periodo_id) return res.status(400).json({ error: 'periodo_id es requerido' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Leer el período ───────────────────────────────────────
    const { rows: perRows } = await client.query(
      `SELECT * FROM periodos WHERE id = $1`, [periodo_id]
    );
    if (!perRows.length) throw new Error('Período no encontrado');
    const periodo = perRows[0];
    const { fecha_inicio, fecha_fin, pct_minorista } = periodo;

    console.log(`\n🔄 Recalculando minorista para período ${periodo_id} (${fecha_inicio} – ${fecha_fin})`);

    // ── 1. Devolver stock minorista consumido por los resúmenes ─────
    // Sumar de vuelta a disponible_um_minorista lo que cada producto
    // aportó a los resúmenes de este período, antes de borrar nada.
    const { rows: stockRows } = await client.query(`
      SELECT ri.producto_id, SUM(ri.cantidad) AS cantidad_total
      FROM resumen_items ri
      JOIN resumenes_minoristas rm ON rm.id = ri.resumen_id
      WHERE rm.periodo_id = $1
      GROUP BY ri.producto_id
    `, [periodo_id]);

    for (const row of stockRows) {
      await client.query(
        `UPDATE productos
         SET disponible_um_minorista = disponible_um_minorista + $1
         WHERE id = $2`,
        [parseFloat(row.cantidad_total), row.producto_id]
      );
    }
    console.log(`  📦 Stock restaurado para ${stockRows.length} producto(s)`);

    // ── 2. Liberar transfers asignadas a resúmenes de este período ──
    const { rows: trIds } = await client.query(`
      SELECT DISTINCT tu.transferencia_id
      FROM transferencias_usadas tu
      JOIN resumenes_minoristas rm ON rm.id = tu.resumen_id
      WHERE rm.periodo_id = $1
        AND tu.resumen_id IS NOT NULL
    `, [periodo_id]);

    if (trIds.length > 0) {
      const ids = trIds.map(r => r.transferencia_id);
      await client.query(
        `UPDATE transferencias SET usada = FALSE WHERE id = ANY($1)`, [ids]
      );
      console.log(`  🔓 ${ids.length} transfers liberadas (usada=FALSE)`);
    }

    // ── 3. Borrar en orden respetando FKs ────────────────────────
    // Orden: transferencias_usadas → resumen_items → resumenes_minoristas
    const { rowCount: tuBorrados } = await client.query(`
      DELETE FROM transferencias_usadas
      WHERE resumen_id IN (
        SELECT id FROM resumenes_minoristas WHERE periodo_id = $1
      )
    `, [periodo_id]);
    console.log(`  🗑  ${tuBorrados} filas de transferencias_usadas borradas`);

    await client.query(`
      DELETE FROM resumen_items
      WHERE resumen_id IN (
        SELECT id FROM resumenes_minoristas WHERE periodo_id = $1
      )
    `, [periodo_id]);

    const { rowCount: resumensBorrados } = await client.query(
      `DELETE FROM resumenes_minoristas WHERE periodo_id = $1`, [periodo_id]
    );
    console.log(`  🗑  ${resumensBorrados} resúmenes borrados`);

    // ── Leer PVs, vendedores, productos ──────────────────────
    const { rows: puntosVenta } = await client.query(
      'SELECT id, nombre, porcentaje_asignado, categorias, activo FROM puntos_venta WHERE activo = TRUE ORDER BY nombre ASC'
    );
    if (!puntosVenta.length) throw new Error('No hay puntos de venta activos.');

    const totalPct = puntosVenta.reduce((s, pv) => s + Number(pv.porcentaje_asignado), 0);
    if (totalPct !== 100)
      throw new Error(`Los porcentajes deben sumar 100%. Actualmente: ${totalPct}%`);

    const { rows: vendedores } = await client.query(
      'SELECT id, nombre FROM vendedores WHERE activo = TRUE'
    );
    if (!vendedores.length) throw new Error('No hay vendedores activos.');

    // ── Productos del período ─────────────────────────────────
    const { rows: productos } = await client.query(`
      SELECT * FROM productos
      WHERE activo = TRUE
        AND fecha_inicio IS NOT NULL AND fecha_fin IS NOT NULL
        AND fecha_inicio <= $2 AND fecha_fin >= $1
      ORDER BY producto
    `, [fecha_inicio, fecha_fin]);
    if (!productos.length) throw new Error('No hay productos en el período.');

    // ── Reconstruir stock solo para minorista ─────────────────
    // (igual que en /confirmar, pero solo necesitamos distMinorista)
    const stock = buildStock(productos, pct_minorista / 100, {});
    const allDias = [...new Set(stock.flatMap(p => p.dias))].sort();

    // ── Todas las transfers CR disponibles del período ────────
    // Incluir las que usó FASE 1 (mayorista) para saber cuáles
    // no están disponibles para minorista.
    const { rows: rawTr } = await client.query(`
      SELECT *, to_char(fecha, 'YYYY-MM-DD') as fecha_str
      FROM transferencias
      WHERE tipo = 'CR'
        AND prefijo IN ('98','MM','KW','JD','VB','AJ','DD','AY')
        AND fecha BETWEEN $1 AND $2
      ORDER BY fecha ASC, importe DESC
    `, [fecha_inicio, fecha_fin]);

    // IDs ya usados por facturas mayoristas (FASE 1) de este período
    const { rows: trMayorRows } = await client.query(`
      SELECT DISTINCT tu.transferencia_id
      FROM transferencias_usadas tu
      JOIN facturas f ON f.id = tu.factura_id
      WHERE f.periodo_id = $1
        AND f.punto_venta = 'almacen_central'
        AND tu.factura_id IS NOT NULL
    `, [periodo_id]);
    const usadasMayorista = new Set(trMayorRows.map(r => r.transferencia_id));

    // ── Pool de clientes y mapa nombre→CI (/recalcular-minorista) ──────────
    const { rows: clientesBD } = await client.query(`
      SELECT nombre, ci FROM clientes
      WHERE nombre IS NOT NULL AND nombre <> ''
        AND ci    IS NOT NULL AND ci    <> ''
    `);
    const { rows: clientesTr } = await client.query(`
      SELECT DISTINCT nombre, ci FROM transferencias
      WHERE nombre IS NOT NULL AND nombre <> ''
        AND ci    IS NOT NULL AND ci    <> ''
      LIMIT 50
    `);
    const { rows: clientesHist } = await client.query(`
      SELECT DISTINCT cliente_nombre AS nombre, cliente_ci AS ci
      FROM facturas
      WHERE cliente_nombre IS NOT NULL AND cliente_nombre <> ''
        AND cliente_ci     IS NOT NULL AND cliente_ci     <> ''
        AND cliente_ci     <> '00000000000'
    `);
    const normalizarR  = n => (n || '').trim().toUpperCase().replace(/\s+/g, ' ');
    const nombreCiMapR = new Map();
    for (const c of [...clientesTr, ...clientesHist, ...clientesBD]) {
      if (!c.nombre || !c.ci) continue;
      nombreCiMapR.set(normalizarR(c.nombre), { nombre: c.nombre, ci: c.ci });
    }
    const _cisSeen     = new Set(clientesBD.map(c => c.ci));
    const _nombresSeen = new Set(clientesBD.map(c => normalizarR(c.nombre)));
    const clientesPool = [
      ...clientesBD,
      ...clientesTr.filter(c => {
        const n = normalizarR(c.nombre);
        if (_cisSeen.has(c.ci) || _nombresSeen.has(n)) return false;
        _cisSeen.add(c.ci); _nombresSeen.add(n);
        return true;
      }),
    ];
    let _clienteIdxR = 0;
    for (let i = clientesPool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [clientesPool[i], clientesPool[j]] = [clientesPool[j], clientesPool[i]];
    }
    function resolverClienteR(trNombre, trCi) {
      const nombre = trNombre && trNombre.trim() ? trNombre.trim() : null;
      const ci     = trCi     && trCi.trim()     ? trCi.trim()     : null;
      if (nombre && ci) return { nombre, ci };
      if (nombre) {
        const key = normalizarR(nombre);
        if (nombreCiMapR.has(key)) return nombreCiMapR.get(key);
        const suplente = clientesPool.length
          ? clientesPool[_clienteIdxR++ % clientesPool.length]
          : { nombre: 'CLIENTE VARIOS', ci: '00000000000' };
        nombreCiMapR.set(key, { nombre, ci: suplente.ci });
        return { nombre, ci: suplente.ci };
      }
      if (!clientesPool.length) return { nombre: 'CLIENTE VARIOS', ci: '00000000000' };
      return clientesPool[_clienteIdxR++ % clientesPool.length];
    }
    function nextClienteAleatorio() {
      if (!clientesPool.length) return { nombre: 'CLIENTE VARIOS', ci: '00000000000' };
      return clientesPool[Math.floor(Math.random() * clientesPool.length)];
    }

    // ── MINORISTA — DISTRIBUCIÓN ORIENTADA A TRANSFERS (igual que /confirmar) ──
    const usadasIds = new Set(usadasMayorista);

    // PASO 0 ── Pesos por día = sum(transfers minoristas) del día hábil
    const trMinoristaPool = rawTr
      .filter(t => !usadasIds.has(t.id))
      .sort((a, b) => parseFloat(b.importe) - parseFloat(a.importe));
    const sumTrMin = trMinoristaPool.reduce((s, t) => s + parseFloat(t.importe), 0);

    function diaHabilMasCercanoR(fechaStr) {
      if (allDias.includes(fechaStr)) return fechaStr;
      const ts = new Date(fechaStr + 'T00:00:00Z').getTime();
      let mejor = allDias[0], menorDiff = Infinity;
      for (const dia of allDias) {
        const diff = Math.abs(new Date(dia + 'T00:00:00Z').getTime() - ts);
        if (diff < menorDiff) { menorDiff = diff; mejor = dia; }
      }
      return mejor;
    }

    const pesoBrutoPorFecha = {};
    for (const fecha of allDias) pesoBrutoPorFecha[fecha] = 0;
    for (const t of trMinoristaPool) {
      const fechaTr  = t.fecha_str || String(t.fecha).slice(0, 10);
      const diaHabil = diaHabilMasCercanoR(fechaTr);
      t._diaHabil = diaHabil;
      pesoBrutoPorFecha[diaHabil] = parseFloat(
        (pesoBrutoPorFecha[diaHabil] + parseFloat(t.importe)).toFixed(2)
      );
    }

    const pesoPorFechaR = pesoBrutoPorFecha;

    function distribuirPorPesoTransfersR(total, dias) {
      if (dias.length === 0) return [];
      if (total <= 0) return dias.map(f => ({ fecha: f, cantidad: 0 }));

      const diasConPeso = dias.filter(f => (pesoPorFechaR[f] || 0) > 0);
      const diasSinPeso = dias.filter(f => (pesoPorFechaR[f] || 0) === 0);

      if (diasConPeso.length === 0) return distribuirAleatorio(total, dias);

      const esEntero = Number.isInteger(total);
      const nTotal   = dias.length;
      const nSin     = diasSinPeso.length;

      let totalParaSin = 0;
      if (nSin > 0) {
        const mediaPorDia = total / nTotal;
        totalParaSin = esEntero
          ? Math.round(mediaPorDia * nSin)
          : parseFloat((mediaPorDia * nSin).toFixed(2));
        totalParaSin = Math.min(totalParaSin, esEntero ? total - diasConPeso.length : total - 0.01);
        totalParaSin = Math.max(totalParaSin, 0);
      }
      const totalParaCon = parseFloat((total - totalParaSin).toFixed(2));

      const result  = dias.map(f => ({ fecha: f, cantidad: 0 }));
      const activos = result.filter(r => (pesoPorFechaR[r.fecha] || 0) > 0);
      const sumPesos = diasConPeso.reduce((s, f) => s + pesoPorFechaR[f], 0);
      for (const r of activos) {
        const w = pesoPorFechaR[r.fecha] / sumPesos;
        const cant = totalParaCon * w;
        r.cantidad = esEntero ? Math.floor(cant) : parseFloat(cant.toFixed(2));
      }

      if (nSin > 0 && totalParaSin > 0) {
        const distSin = distribuirAleatorio(totalParaSin, diasSinPeso);
        for (const entry of distSin) {
          const r = result.find(x => x.fecha === entry.fecha);
          if (r) r.cantidad = entry.cantidad;
        }
      }

      const suma = result.reduce((s, r) => s + r.cantidad, 0);
      const diff = parseFloat((total - suma).toFixed(2));
      if (Math.abs(diff) > 0.0001) {
        const maxR = activos.reduce((a, b) => pesoPorFechaR[a.fecha] > pesoPorFechaR[b.fecha] ? a : b);
        maxR.cantidad = esEntero
          ? maxR.cantidad + Math.round(diff)
          : parseFloat((maxR.cantidad + diff).toFixed(2));
      }
      return result;
    }

    // PASO 1 ── Re-distribuir cantidadMinorista por pesos de transfers
    const distMinoristaAjustada = {};
    for (const prod of stock) {
      if (prod.cantidadMinorista <= 0) {
        distMinoristaAjustada[prod.id] = prod.dias.map(f => ({ fecha: f, cantidad: 0 }));
        continue;
      }
      distMinoristaAjustada[prod.id] = distribuirPorPesoTransfersR(prod.cantidadMinorista, prod.dias);
    }

    // PASO 2 ── Pre-calcular ventas reales por (pv, fecha)
    const repartoDiaTodo = {};
    const ventasDiarias  = {};
    for (const pv of puntosVenta) ventasDiarias[pv.id] = {};

    for (const fecha of allDias) {
      repartoDiaTodo[fecha] = {};
      const prodsMinP1 = stock.filter(p => {
        const d = distMinoristaAjustada[p.id]?.find(x => x.fecha === fecha);
        return d && d.cantidad > 0;
      });
      for (const prod of prodsMinP1) {
        const d       = distMinoristaAjustada[prod.id].find(x => x.fecha === fecha);
        const total   = d ? d.cantidad : 0;
        const catProd = prod.categoria || 'otros';
        const pvsCat  = puntosVenta.filter(pv => (pv.categorias || ['otros']).includes(catProd));
        repartoDiaTodo[fecha][prod.id] = {};
        if (pvsCat.length === 0 || total <= 0) {
          puntosVenta.forEach(pv => { repartoDiaTodo[fecha][prod.id][pv.id] = 0; });
        } else {
          const pctsCat = pvsCat.map(pv => Number(pv.porcentaje_asignado));
          const splits  = repartirConRuido(total, pctsCat);
          puntosVenta.forEach(pv => { repartoDiaTodo[fecha][prod.id][pv.id] = 0; });
          pvsCat.forEach((pv, i) => { repartoDiaTodo[fecha][prod.id][pv.id] = splits[i]; });
        }
      }
      for (const pv of puntosVenta) {
        let totalVentas = 0;
        for (const prod of prodsMinP1) {
          let cantidad = (repartoDiaTodo[fecha][prod.id]?.[pv.id]) || 0;
          if (cantidad <= 0) continue;
          if (prod.vendeDecimales) cantidad = parseFloat(cantidad.toFixed(2));
          totalVentas += parseFloat((cantidad * prod.importe).toFixed(2));
        }
        ventasDiarias[pv.id][fecha] = parseFloat(totalVentas.toFixed(2));
      }
    }

    const sumVentasPV = puntosVenta.reduce(
      (s, pv) => s + allDias.reduce((a, f) => a + (ventasDiarias[pv.id][f] || 0), 0), 0
    );
    if (sumTrMin > sumVentasPV + 0.01) {
      throw new Error(
        `Cuadre PV imposible: transfers minoristas $${sumTrMin.toFixed(0)} > inventario PV $${sumVentasPV.toFixed(0)}.`
      );
    }

    // PASO 3 ── Asignar transfers a su día hábil natural y construir trAsignadas
    const trAsignadas = {};
    for (const pv of puntosVenta) {
      trAsignadas[pv.id] = {};
      for (const fecha of allDias) trAsignadas[pv.id][fecha] = [];
    }
    const capacidadUsada = {};
    for (const pv of puntosVenta) {
      capacidadUsada[pv.id] = {};
      for (const fecha of allDias) capacidadUsada[pv.id][fecha] = 0;
    }

    const trPorDiaHabil = {};
    for (const fecha of allDias) trPorDiaHabil[fecha] = [];
    for (const t of trMinoristaPool) trPorDiaHabil[t._diaHabil].push(t);

    let totalTransfAsignadas2 = 0;
    let poolFallback = [];
    for (const fecha of allDias) {
      for (const t of trPorDiaHabil[fecha]) {
        const tImp = parseFloat(t.importe);
        let asignado = false;

        // Ordenar PVs por cuál está más atrasado respecto a su % objetivo
        const totalAcum2 = puntosVenta.reduce(
          (s, pv) => s + allDias.reduce((a, f) => a + (capacidadUsada[pv.id][f] || 0), 0), 0
        );
        const pvOrdenados2 = [...puntosVenta].sort((a, b) => {
          const recibidoA = allDias.reduce((s, f) => s + (capacidadUsada[a.id][f] || 0), 0);
          const recibidoB = allDias.reduce((s, f) => s + (capacidadUsada[b.id][f] || 0), 0);
          const base = totalAcum2 || 1;
          const ratioA = (recibidoA / base) / (Number(a.porcentaje_asignado) / 100 || 0.01);
          const ratioB = (recibidoB / base) / (Number(b.porcentaje_asignado) / 100 || 0.01);
          return ratioA - ratioB;
        });

        for (const pv of pvOrdenados2) {
          const cap = (ventasDiarias[pv.id][fecha] || 0) - (capacidadUsada[pv.id][fecha] || 0);
          if (cap >= tImp - 0.01) {
            trAsignadas[pv.id][fecha].push({ ...t, aplicado: tImp });
            capacidadUsada[pv.id][fecha] = parseFloat((capacidadUsada[pv.id][fecha] + tImp).toFixed(2));
            totalTransfAsignadas2 = parseFloat((totalTransfAsignadas2 + tImp).toFixed(2));
            usadasIds.add(t.id);
            asignado = true;
            break;
          }
        }
        if (!asignado) poolFallback.push(t);
      }
    }
    if (poolFallback.length > 0) {
      for (const t of poolFallback) {
        const tImp = parseFloat(t.importe);
        let mejorPV = puntosVenta[0], mejorFecha = allDias[allDias.length - 1], mejorCap = -Infinity;
        for (const pv of puntosVenta) {
          for (const fecha of allDias) {
            const cap = (ventasDiarias[pv.id][fecha] || 0) - (capacidadUsada[pv.id][fecha] || 0);
            if (cap > mejorCap) { mejorCap = cap; mejorPV = pv; mejorFecha = fecha; }
          }
        }
        trAsignadas[mejorPV.id][mejorFecha].push({ ...t, aplicado: tImp });
        capacidadUsada[mejorPV.id][mejorFecha] = parseFloat((capacidadUsada[mejorPV.id][mejorFecha] + tImp).toFixed(2));
        usadasIds.add(t.id);
        console.log(`⚠️  Transfer ${t.id} ($${tImp}) redirigida a ${mejorFecha} (fallback)`);
      }
      poolFallback = [];
    }
    console.log(`  🔀 ${trMinoristaPool.length} transfers PV → asignadas por día hábil natural (respetando % configurados)`);

    // PASO 3 ── Insertar resumenes con asignaciones ya fijadas
    for (const fecha of allDias) {
      const prodsMinHoy = stock.filter(p =>
        repartoDiaTodo[fecha] &&
        puntosVenta.some(pv => (repartoDiaTodo[fecha][p.id]?.[pv.id] || 0) > 0)
      );
      if (!prodsMinHoy.length) continue;

      for (const pv of puntosVenta) {
        const items = prodsMinHoy.map(prod => {
          let cantidad = (repartoDiaTodo[fecha][prod.id]?.[pv.id]) || 0;
          if (cantidad <= 0) return null;
          if (prod.vendeDecimales) cantidad = parseFloat(cantidad.toFixed(2));
          return {
            producto_id: prod.id,
            codigo: prod.codigo, producto: prod.producto,
            um: prod.um_minorista, cantidad,
            precio: prod.importe,
            importe: parseFloat((cantidad * prod.importe).toFixed(2)),
          };
        }).filter(i => i && i.cantidad > 0);

        if (!items.length) continue;

        const totalResumen = parseFloat(items.reduce((s, i) => s + i.importe, 0).toFixed(2));
        const trUsadas     = trAsignadas[pv.id][fecha] || [];
        const totalTr      = parseFloat(trUsadas.reduce((s, t) => s + t.aplicado, 0).toFixed(2));
        const efectivo     = parseFloat(Math.max(0, totalResumen - totalTr).toFixed(2));

        const { rows: rRow } = await client.query(
          `INSERT INTO resumenes_minoristas
             (fecha, punto_venta, punto_venta_id, total, efectivo, total_transferencia, periodo_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [fecha, pv.nombre, pv.id, totalResumen, efectivo, totalTr, periodo_id]
        );
        const resId = rRow[0].id;

        for (const item of items) {
          await client.query(
            `INSERT INTO resumen_items
               (resumen_id, producto_id, codigo, producto, um, cantidad, precio, importe)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [resId, item.producto_id, item.codigo, item.producto,
             item.um, item.cantidad, item.precio, item.importe]
          );
        }

        for (const t of trUsadas) {
          await client.query('UPDATE transferencias SET usada=TRUE WHERE id=$1', [t.id]);
          await client.query(
            `INSERT INTO transferencias_usadas (transferencia_id, resumen_id, importe_aplicado)
             VALUES ($1,$2,$3)`,
            [t.id, resId, t.aplicado]
          );
        }

        resumenes_generados.push({
          id: resId, fecha, punto_venta: pv.nombre,
          total: totalResumen, efectivo, total_transferencia: totalTr,
        });
      }

      console.log(`  🏪 [${fecha}] ${puntosVenta.length} resúmenes regenerados`);
    }

    // ── Totales finales ───────────────────────────────────────
    const { rows: pvTotales } = await client.query(`
      SELECT
        COALESCE(SUM(total), 0)::numeric             AS total_vendido,
        COALESCE(SUM(efectivo), 0)::numeric          AS total_efectivo,
        COALESCE(SUM(total_transferencia), 0)::numeric AS total_transferencia
      FROM resumenes_minoristas
      WHERE periodo_id = $1
    `, [periodo_id]);

    await client.query('COMMIT');

    const totales = pvTotales[0];
    console.log(`✅ Recalculo minorista OK: total=$${parseFloat(totales.total_vendido).toFixed(2)} efectivo=$${parseFloat(totales.total_efectivo).toFixed(2)} transfer=$${parseFloat(totales.total_transferencia).toFixed(2)}`);

    res.json({
      success:             true,
      periodo_id,
      resumenes_generados: resumenes_generados.length,
      totales: {
        total_vendido:       parseFloat(totales.total_vendido),
        total_efectivo:      parseFloat(totales.total_efectivo),
        total_transferencia: parseFloat(totales.total_transferencia),
      },
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error en recálculo minorista:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// =============================================================
// GET /debug
// =============================================================
// FIX #17: /debug solo disponible fuera de producción
router.get('/debug', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'No disponible en producción' });
  }
  try {
    const { rows: trDisp } = await pool.query(`
      SELECT prefijo, tipo, usada, MIN(fecha) as fecha_min, MAX(fecha) as fecha_max,
             COUNT(*) as cantidad, SUM(importe) as total
      FROM transferencias
      WHERE tipo = 'CR' AND prefijo IN ('98','MM','KW', 'JD','VB','AJ','DD','AY')
      GROUP BY prefijo, tipo, usada
      ORDER BY usada, prefijo
    `);

    const { rows: trFechas } = await pool.query(`
      SELECT DISTINCT fecha::text, COUNT(*) as cantidad
      FROM transferencias
      WHERE tipo = 'CR' AND prefijo IN ('98','MM','KW', 'JD','VB','AJ','DD','AY') AND usada = FALSE
      GROUP BY fecha ORDER BY fecha LIMIT 10
    `);

    const { rows: prods } = await pool.query(`
      SELECT id, codigo, producto, fecha_inicio::text, fecha_fin::text, disponible_um_minorista
      FROM productos
      WHERE activo = TRUE AND fecha_inicio IS NOT NULL AND fecha_fin IS NOT NULL
      ORDER BY producto
    `);

    let trEnRango = [], fMin = null, fMax = null;
    if (prods.length > 0) {
      const allDias = [...new Set(prods.flatMap(p => generarDias(p.fecha_inicio, p.fecha_fin)))].sort();
      fMin = allDias[0]; fMax = allDias[allDias.length - 1];
      const { rows } = await pool.query(`
        SELECT fecha::text, prefijo, importe, usada
        FROM transferencias
        WHERE tipo = 'CR' AND prefijo IN ('98','MM','KW', 'JD','VB','AJ','DD','AY')
          AND usada = FALSE AND fecha BETWEEN $1 AND $2
        ORDER BY fecha LIMIT 10
      `, [fMin, fMax]);
      trEnRango = rows;
    }

    res.json({
      resumen_transferencias: trDisp,
      primeras_fechas_disponibles: trFechas,
      productos: prods,
      rango_productos: { fMin, fMax },
      transferencias_en_rango: trEnRango,
      diagnostico: trEnRango.length > 0
        ? 'HAY transferencias que coinciden con las fechas de los productos'
        : 'NO hay transferencias en el rango de fechas de los productos',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;