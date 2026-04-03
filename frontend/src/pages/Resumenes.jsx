import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';
import { fmt, fmtDate } from '../lib/utils.js';
import { Badge, Spinner, StatCard, Btn } from '../components/UI.jsx';

export default function Resumenes() {
  const [resumenes, setResumenes] = useState([]);
  const [periodos, setPeriodos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroPeriodo, setFiltroPeriodo] = useState('');

  const load = () => {
    setLoading(true);
    const params = {};
    if (filtroPeriodo) params.periodo_id = filtroPeriodo;
    Promise.all([api.getResumenesMinoristas(params), api.getPeriodos()])
      .then(([r, p]) => { setResumenes(r); setPeriodos(p); })
      .catch(e => toast.error(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [filtroPeriodo]);

  const eliminar = async (id, fecha, puntoVenta) => {
    if (!confirm(`¿Eliminar el resumen del ${fmtDate(fecha)} - ${puntoVenta}? Esta acción no se puede deshacer y revertirá los cambios en el inventario.`)) return;
    try {
      await api.deleteResumenMinorista(id);
      toast.success('Resumen eliminado correctamente');
      load();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const printResumen = (r) => {
    const pv    = r.punto_venta_nombre || r.punto_venta || 'Punto de Venta';
    const fecha = fmtDate(r.fecha);
    const items = (r.items || []).filter(i => i && i.producto);
    const transferencias = (r.transferencias_detalle || []).filter(t => t && t.ref);

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>Resumen ${pv} — ${fecha}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #111; background: #fff; padding: 28px 32px; }
    h1 { font-size: 20px; font-weight: 800; margin-bottom: 2px; }
    .sub { font-size: 12px; color: #666; margin-bottom: 18px; }
    .totales { display: flex; gap: 28px; margin-bottom: 20px; padding: 12px 16px; background: #f4f6f9; border-radius: 8px; }
    .totales div { text-align: center; }
    .totales .val { font-size: 18px; font-weight: 800; }
    .totales .lbl { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: 0.6px; margin-top: 2px; }
    h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; color: #555; margin-bottom: 8px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; color: #888; padding: 5px 8px; border-bottom: 2px solid #ddd; }
    th.r, td.r { text-align: right; }
    td { padding: 7px 8px; border-bottom: 1px solid #eee; font-size: 13px; }
    td .code { font-size: 10px; color: #888; display: block; margin-top: 1px; }
    .total-row td { font-weight: 800; font-size: 14px; border-top: 2px solid #222; border-bottom: none; padding-top: 10px; }
    .transf { display: flex; flex-wrap: wrap; gap: 8px; }
    .transf span { background: #f0f0ff; border: 1px solid #ccd; border-radius: 5px; padding: 3px 10px; font-size: 12px; }
    .footer { margin-top: 32px; padding-top: 14px; border-top: 1px solid #ddd; font-size: 11px; color: #aaa; display: flex; justify-content: space-between; }
    @media print { body { padding: 12px 16px; } }
  </style>
</head>
<body>
  <h1>📋 Resumen de Venta Minorista</h1>
  <div class="sub">${pv} &nbsp;·&nbsp; ${fecha}</div>

  <div class="totales">
    <div><div class="val">$${r.total ? parseFloat(r.total).toLocaleString('es-CU',{minimumFractionDigits:2}) : '0.00'}</div><div class="lbl">Total</div></div>
    <div><div class="val">$${r.efectivo ? parseFloat(r.efectivo).toLocaleString('es-CU',{minimumFractionDigits:2}) : '0.00'}</div><div class="lbl">Efectivo</div></div>
    <div><div class="val">$${r.total_transferencia ? parseFloat(r.total_transferencia).toLocaleString('es-CU',{minimumFractionDigits:2}) : '0.00'}</div><div class="lbl">Transferencia</div></div>
  </div>

  <h2>Productos</h2>
  <table>
    <thead><tr>
      <th>Producto</th>
      <th class="r">Cant.</th>
      <th>UM</th>
      <th class="r">Precio</th>
      <th class="r">Importe</th>
    </tr></thead>
    <tbody>
      ${items.map(i => `
      <tr>
        <td>${i.producto}${i.codigo ? `<span class="code">${i.codigo}</span>` : ''}</td>
        <td class="r">${parseFloat(i.cantidad).toLocaleString('es-CU',{minimumFractionDigits:2})}</td>
        <td>${i.um || ''}</td>
        <td class="r">$${parseFloat(i.precio).toLocaleString('es-CU',{minimumFractionDigits:2})}</td>
        <td class="r">$${parseFloat(i.importe).toLocaleString('es-CU',{minimumFractionDigits:2})}</td>
      </tr>`).join('')}
    </tbody>
    <tfoot>
      <tr class="total-row">
        <td colspan="4">TOTAL</td>
        <td class="r">$${r.total ? parseFloat(r.total).toLocaleString('es-CU',{minimumFractionDigits:2}) : '0.00'}</td>
      </tr>
    </tfoot>
  </table>

  ${transferencias.length > 0 ? `
  <h2>Transferencias Aplicadas</h2>
  <div class="transf">
    ${transferencias.map(t => `<span><strong>${t.ref}</strong> (${t.prefijo}) — $${parseFloat(t.importe).toLocaleString('es-CU',{minimumFractionDigits:2})}</span>`).join('')}
  </div>` : ''}

  <div class="footer">
    <span>Sistema GestDist</span>
    <span>Impreso: ${new Date().toLocaleString('es-CU')}</span>
  </div>
</body>
</html>`;

    const win = window.open('', '_blank', 'width=700,height=900');
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  };

  const totalEf  = useMemo(() => resumenes.reduce((s, r) => s + parseFloat(r.efectivo || 0), 0), [resumenes]);
  const totalTr  = useMemo(() => resumenes.reduce((s, r) => s + parseFloat(r.total_transferencia || 0), 0), [resumenes]);
  const totalGen = useMemo(() => resumenes.reduce((s, r) => s + parseFloat(r.total || 0), 0), [resumenes]);

  // Totales por Punto de Venta (para el panel resumen de período)
  const totalesPorPV = useMemo(() => {
    const map = new Map();
    for (const r of resumenes) {
      const pv = r.punto_venta_nombre || r.punto_venta || 'Punto de Venta';
      if (!map.has(pv)) map.set(pv, { pv, total: 0, efectivo: 0, transferencia: 0, dias: 0 });
      const g = map.get(pv);
      g.total         += parseFloat(r.total || 0);
      g.efectivo      += parseFloat(r.efectivo || 0);
      g.transferencia += parseFloat(r.total_transferencia || 0);
      g.dias          += 1;
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [resumenes]);

  // Agrupado por producto + índice inverso: key → resúmenes que lo contienen
  const { totalesPorProducto, resumenesPorProducto } = useMemo(() => {
    const mapa   = new Map();
    const indice = new Map();
    for (const r of resumenes) {
      for (const item of (r.items || [])) {
        if (!item?.producto) continue;
        const key = item.codigo || item.producto;
        if (!mapa.has(key)) {
          mapa.set(key, { producto: item.producto, codigo: item.codigo, um: item.um, cantidad: 0, importe: 0, lineas: 0 });
          indice.set(key, []);
        }
        const g = mapa.get(key);
        g.cantidad += parseFloat(item.cantidad || 0);
        g.importe  += parseFloat(item.importe  || 0);
        g.lineas   += 1;
        indice.get(key).push({
          fecha:        r.fecha,
          puntoVenta:   r.punto_venta_nombre || r.punto_venta || 'Punto de Venta',
          itemCantidad: parseFloat(item.cantidad || 0),
          itemImporte:  parseFloat(item.importe  || 0),
          um:           item.um,
        });
      }
    }
    return {
      totalesPorProducto: [...mapa.values()].sort((a, b) => b.importe - a.importe),
      resumenesPorProducto: indice,
    };
  }, [resumenes]);

  const [productoSeleccionado, setProductoSeleccionado] = useState(null);
  const [stockCollapsed, setStockCollapsed]             = useState(false);
  const [productsCollapsed, setProductsCollapsed]       = useState({});
  const [daysCollapsed, setDaysCollapsed]               = useState({});

  const toggleProducts = (id) => setProductsCollapsed(prev => ({ ...prev, [id]: !prev[id] }));
  const toggleDay      = (id) => setDaysCollapsed(prev => ({ ...prev, [id]: !prev[id] }));
  const collapseAll    = () => setDaysCollapsed(Object.fromEntries(resumenes.map(r => [r.id, true])));
  const expandAll      = () => setDaysCollapsed({});

  return (
    <div className="fade-in">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, fontFamily: "'Syne', sans-serif", fontWeight: 800, color: '#e8f0fe' }}>Resúmenes Minoristas</h1>
        <p style={{ color: '#3a4a5a', fontSize: 13, marginTop: 4 }}>Puntos de Venta — resúmenes diarios de ventas</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 24 }}>
        <StatCard label="Total Vendido" value={`$${fmt(totalGen)}`} sub={`${resumenes.length} días`} color="#f2c94c" />
        <StatCard label="En Efectivo" value={`$${fmt(totalEf)}`} color="#6fcf97" />
        <StatCard label="Por Transferencia" value={`$${fmt(totalTr)}`} color="#bb87fc" />
      </div>

      {/* ── Resumen por Punto de Venta ─────────────────────────── */}
      {totalesPorPV.length > 0 && (
        <div style={{ background: '#0a0d12', border: '1px solid #1e2530', borderRadius: 12, padding: '16px 20px', marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: '#8899bb', textTransform: 'uppercase', letterSpacing: 0.9, fontWeight: 700, marginBottom: 14 }}>
            🏬 Ventas por Punto de Venta {filtroPeriodo ? `— ${periodos.find(p => String(p.id) === filtroPeriodo)?.nombre || ''}` : ''}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1e2530' }}>
                {['Punto de Venta', 'Días', 'Efectivo', 'Transferencia', 'Total'].map((h, i) => (
                  <th key={h} style={{ padding: '6px 12px', textAlign: i === 0 ? 'left' : 'right', fontSize: 10, color: '#3a4a5a', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {totalesPorPV.map((row, i) => (
                <tr key={row.pv} style={{ borderBottom: i < totalesPorPV.length - 1 ? '1px solid #0e1117' : 'none' }}>
                  <td style={{ padding: '10px 12px', color: '#c8d8f0', fontWeight: 600 }}>{row.pv}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#4a6a8a', fontSize: 12 }}>{row.dias}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#6fcf97', fontWeight: 700 }}>${fmt(row.efectivo)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#bb87fc', fontWeight: 700 }}>
                    {row.transferencia > 0 ? `$${fmt(row.transferencia)}` : <span style={{ color: '#2a3a4a' }}>—</span>}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#f2c94c', fontWeight: 800, fontSize: 14 }}>${fmt(row.total)}</td>
                </tr>
              ))}
            </tbody>
            {totalesPorPV.length > 1 && (
              <tfoot>
                <tr style={{ borderTop: '2px solid #1e2530' }}>
                  <td style={{ padding: '10px 12px', color: '#4a6a8a', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>TOTAL GENERAL</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#4a6a8a', fontSize: 12 }}>{resumenes.length}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#6fcf97', fontWeight: 800 }}>${fmt(totalEf)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#bb87fc', fontWeight: 800 }}>{totalTr > 0 ? `$${fmt(totalTr)}` : <span style={{ color: '#2a3a4a' }}>—</span>}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#f2c94c', fontWeight: 800, fontSize: 15 }}>${fmt(totalGen)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Totales por producto */}
      {totalesPorProducto.length > 0 && (
        <div style={{ background: '#0a0d12', border: '1px solid #1e2530', borderRadius: 12, padding: '16px 20px', marginBottom: 20 }}>
          <div
            onClick={() => setStockCollapsed(v => !v)}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
          >
            <div style={{ fontSize: 11, color: '#8899bb', textTransform: 'uppercase', letterSpacing: 0.9, fontWeight: 700 }}>
              🏪 Stock distribuido — {totalesPorProducto.length} producto{totalesPorProducto.length !== 1 ? 's' : ''}
            </div>
            <span style={{ fontSize: 13, color: '#3a4a5a', transition: 'transform 0.2s', display: 'inline-block', transform: stockCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
          </div>
          {!stockCollapsed && (
            <div style={{ overflowX: 'auto', marginTop: 12 }}>
              <div style={{ fontSize: 11, color: '#2a3a4a', marginBottom: 8 }}>Haz click en una fila para ver los resúmenes que contienen ese producto</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1e2530' }}>
                  {['Producto', 'Total cantidad', 'UM', 'Total importe', 'Líneas'].map(h => (
                    <th key={h} style={{ padding: '6px 10px', textAlign: h === 'Total importe' || h === 'Total cantidad' ? 'right' : 'left', color: '#3a4a5a', fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {totalesPorProducto.map((p, i) => {
                  const key = p.codigo || p.producto;
                  const seleccionado = productoSeleccionado === key;
                  const detalle = resumenesPorProducto.get(key) || [];
                  return (
                    <>
                      <tr
                        key={key}
                        onClick={() => setProductoSeleccionado(seleccionado ? null : key)}
                        style={{ borderBottom: seleccionado ? 'none' : '1px solid #0e1117', cursor: 'pointer', background: seleccionado ? '#120e08' : 'transparent', transition: 'background 0.12s' }}
                        onMouseEnter={e => { if (!seleccionado) e.currentTarget.style.background = '#0e0c08'; }}
                        onMouseLeave={e => { if (!seleccionado) e.currentTarget.style.background = 'transparent'; }}
                      >
                        <td style={{ padding: '8px 10px' }}>
                          <span style={{ color: seleccionado ? '#f2c94c' : '#e8f0fe', fontWeight: 600 }}>{p.producto}</span>
                          {p.codigo && <span style={{ color: '#3a4a5a', fontSize: 11, marginLeft: 6 }}>{p.codigo}</span>}
                          <span style={{ marginLeft: 8, fontSize: 11, color: seleccionado ? '#c8a820' : '#2a3a4a' }}>{seleccionado ? '▲' : '▼'}</span>
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: '#f2c94c', fontWeight: 700 }}>{fmt(p.cantidad)}</td>
                        <td style={{ padding: '8px 10px', color: '#3a4a5a', fontSize: 11 }}>{p.um}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: '#7eb8f7', fontWeight: 700 }}>${fmt(p.importe)}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                          <span style={{ background: seleccionado ? '#2a1a00' : '#1a2030', border: `1px solid ${seleccionado ? '#8a6a00' : '#2a3040'}`, borderRadius: 5, padding: '2px 8px', fontSize: 11, color: seleccionado ? '#f2c94c' : '#8899bb' }}>{p.lineas}</span>
                        </td>
                      </tr>
                      {seleccionado && (
                        <tr key={key + '_detalle'} style={{ borderBottom: '1px solid #0e1117' }}>
                          <td colSpan={5} style={{ padding: '0 10px 12px 10px', background: '#120e08' }}>
                            <div style={{ borderTop: '1px solid #2a1e08', paddingTop: 10 }}>
                              <div style={{ fontSize: 10, color: '#7a5a20', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, fontWeight: 700 }}>
                                Resúmenes que contienen {p.producto}
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
                                {detalle.sort((a, b) => new Date(a.fecha) - new Date(b.fecha)).map((d, di) => (
                                  <div key={di} style={{ background: '#0a0800', border: '1px solid #2a1e08', borderRadius: 8, padding: '8px 12px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                      <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, color: '#f2c94c', fontSize: 13 }}>{fmtDate(d.fecha)}</span>
                                    </div>
                                    <div style={{ fontSize: 11, color: '#8899bb', marginBottom: 4 }}>{d.puntoVenta}</div>
                                    <div style={{ fontSize: 12, color: '#f2c94c', fontWeight: 700 }}>{fmt(d.itemCantidad)} {d.um}</div>
                                    <div style={{ fontSize: 11, color: '#6fcf97', fontWeight: 700, marginTop: 2 }}>${fmt(d.itemImporte)}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid #1e2530' }}>
                  <td colSpan={3} style={{ padding: '8px 10px', color: '#3a4a5a', fontSize: 11, fontWeight: 700 }}>TOTAL GENERAL</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: '#6fcf97', fontWeight: 800, fontSize: 14 }}>${fmt(totalGen)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
            </div>
          )}
        </div>
      )}

      {/* Filtros + colapsar/expandir */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => setFiltroPeriodo('')}
          style={{ padding: '7px 16px', borderRadius: 8, border: !filtroPeriodo ? '1px solid #2563eb' : '1px solid #1e2530', background: !filtroPeriodo ? '#1a2540' : 'none', color: !filtroPeriodo ? '#7eb8f7' : '#3a4a5a', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: 600 }}>
          Todos
        </button>
        {periodos.map(p => (
          <button key={p.id} onClick={() => setFiltroPeriodo(String(p.id))}
            style={{ padding: '7px 16px', borderRadius: 8, border: filtroPeriodo === String(p.id) ? '1px solid #2563eb' : '1px solid #1e2530', background: filtroPeriodo === String(p.id) ? '#1a2540' : 'none', color: filtroPeriodo === String(p.id) ? '#7eb8f7' : '#3a4a5a', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: 600 }}>
            {p.nombre}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button onClick={collapseAll} style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid #1e2530', background: 'none', color: '#3a4a5a', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit', fontWeight: 600 }}>⊖ Colapsar todo</button>
          <button onClick={expandAll}   style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid #1e2530', background: 'none', color: '#3a4a5a', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit', fontWeight: 600 }}>⊕ Expandir todo</button>
        </div>
      </div>

      {loading ? <Spinner /> : (
        <>
          {[...resumenes]
            .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
            .map(r => {
              const dayCollapsed = !!daysCollapsed[r.id];
              return (
                <div key={r.id} style={{ background: '#0e1117', border: '1px solid #1e2530', borderRadius: 12, padding: 20, marginBottom: 14 }}>

                  {/* Header del día — clickeable para colapsar */}
                  <div
                    onClick={() => toggleDay(r.id)}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: dayCollapsed ? 0 : 14, cursor: 'pointer', userSelect: 'none' }}
                  >
                    <div>
                      <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 16, fontWeight: 800, color: '#f2c94c', marginBottom: 4 }}>
                        📅 {fmtDate(r.fecha)}
                      </div>
                      <div style={{ fontSize: 12, color: '#3a4a5a' }}>
                        {r.punto_venta_nombre || r.punto_venta || 'Punto de Venta'} — Venta Minorista
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, fontWeight: 800, color: '#6fcf97' }}>${fmt(r.total)}</div>
                        <div style={{ fontSize: 11, color: '#3a4a5a', marginTop: 2 }}>
                          💵 ${fmt(r.efectivo)} · 🏦 ${fmt(r.total_transferencia)}
                        </div>
                      </div>
                      <div onClick={e => e.stopPropagation()}>
                        <Btn onClick={() => printResumen(r)} variant="ghost" small>🖨️ Imprimir</Btn>
                        <Btn onClick={() => eliminar(r.id, r.fecha, r.punto_venta_nombre || r.punto_venta)} variant="danger" small>
                          🗑️ Eliminar
                        </Btn>
                      </div>
                      <span style={{ fontSize: 14, color: '#3a4a5a', display: 'inline-block', transition: 'transform 0.2s', transform: dayCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
                    </div>
                  </div>

                  {/* Cuerpo colapsable */}
                  {!dayCollapsed && (<>

                    {/* Productos */}
                    <div style={{ marginBottom: 12 }}>
                      <div
                        onClick={() => toggleProducts(r.id)}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none', padding: '6px 0', borderBottom: '1px solid #1e2530', marginBottom: productsCollapsed[r.id] ? 0 : 10 }}
                      >
                        <div style={{ fontSize: 11, color: '#4a6a8a', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                          📦 Productos ({(r.items || []).filter(i => i && i.producto).length})
                        </div>
                        <span style={{ fontSize: 12, color: '#3a4a5a', display: 'inline-block', transition: 'transform 0.2s', transform: productsCollapsed[r.id] ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
                      </div>
                      {!productsCollapsed[r.id] && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8, marginTop: 8 }}>
                          {(r.items || []).filter(i => i && i.producto).map((item, j) => (
                            <div key={j} style={{ background: '#141920', border: '1px solid #1e2530', borderRadius: 8, padding: '10px 14px' }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: '#e8f0fe' }}>{item.producto}</div>
                              {item.codigo && <div style={{ fontSize: 10, color: '#4a6a8a', fontWeight: 700, marginTop: 1 }}>{item.codigo}</div>}
                              <div style={{ fontSize: 11, color: '#3a4a5a', marginTop: 3 }}>{fmt(item.cantidad)} {item.um} × ${fmt(item.precio)}</div>
                              <div style={{ fontSize: 14, fontWeight: 700, color: '#f2c94c', marginTop: 4 }}>${fmt(item.importe)}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Transferencias usadas */}
                    {(r.transferencias_detalle || []).filter(t => t && t.ref).length > 0 && (
                      <div style={{ borderTop: '1px solid #1e2530', paddingTop: 10 }}>
                        <div style={{ fontSize: 11, color: '#3a4a5a', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 }}>Transferencias Aplicadas</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {(r.transferencias_detalle || []).filter(t => t && t.ref).map((t, i) => (
                            <div key={i} style={{ background: '#1a1a3a', border: '1px solid #2a2a5a', borderRadius: 6, padding: '5px 10px', fontSize: 12 }}>
                              <span style={{ color: '#bb87fc' }}>{t.ref}</span>
                              <span style={{ color: '#3a4a5a' }}> ({t.prefijo})</span>
                              <span style={{ color: '#6fcf97', marginLeft: 6, fontWeight: 700 }}>${fmt(t.importe)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>)}
                </div>
              );
            })}
          {resumenes.length === 0 && (
            <div style={{ background: '#0e1117', border: '1px solid #1e2530', borderRadius: 12, padding: 48, textAlign: 'center', color: '#2a3a4a' }}>
              No hay resúmenes para mostrar. Use Distribución para generarlos.
            </div>
          )}
        </>
      )}
    </div>
  );
}