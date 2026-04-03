import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';
import { fmt, fmtDate } from '../lib/utils.js';
import { Btn, Input, Select, Alert, Card, Spinner, Badge, StatCard } from '../components/UI.jsx';

export default function Distribucion() {
  const [form, setForm] = useState({ fecha_inicio: '', fecha_fin: '', pct_minorista: 60, periodo_nombre: '', umbral_minorista: 20000 });
  const [preview, setPreview] = useState(null);
  const [calculating, setCalculating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [recalculando, setRecalculando] = useState(false);
  const [recalcResult, setRecalcResult] = useState(null);
  const [error, setError] = useState('');
  const [resultado, setResultado] = useState(null);
  const [productos, setProductos] = useState([]);
  // destinos: { [productoId]: 'ambos' | 'mayorista' | 'minorista' }
  const [destinos, setDestinos] = useState({});

  const f = (k) => (v) => setForm(p => ({ ...p, [k]: v }));

  // Cargar productos SOLO cuando ambas fechas están completas,
  // mostrando únicamente los que tienen rango activo dentro del período.
  useEffect(() => {
    if (!form.fecha_inicio || !form.fecha_fin) {
      setProductos([]);
      return;
    }
    const inicio = new Date(form.fecha_inicio + 'T00:00:00Z');
    const fin    = new Date(form.fecha_fin    + 'T00:00:00Z');
    if (fin < inicio) return;

    api.getProductos()
      .then(ps => {
        const enRango = ps.filter(p => {
          if (!p.activo) return false;
          if (!p.fecha_inicio || !p.fecha_fin) return false;
          const pInicio = new Date(String(p.fecha_inicio).slice(0, 10) + 'T00:00:00Z');
          const pFin    = new Date(String(p.fecha_fin).slice(0, 10)    + 'T00:00:00Z');
          return pInicio <= fin && pFin >= inicio;
        });
        setProductos(enRango);
        setDestinos(prev => {
          const init = { ...prev };
          enRango.forEach(p => {
            if (!init[String(p.id)]) {
              // Productos de categoría 'otros' van automáticamente a PV
              init[String(p.id)] = (p.categoria === 'otros') ? 'minorista' : 'ambos';
            }
          });
          return init;
        });
      })
      .catch(e => toast.error(e.message));
  }, [form.fecha_inicio, form.fecha_fin]);

  // Estado local para escritura libre de porcentajes
  const [rawMin, setRawMin] = useState('60');
  const [rawMaj, setRawMaj] = useState('40');

  const commitMin = (raw) => {
    const v = parseInt(raw);
    const clamped = isNaN(v) ? 60 : Math.min(90, Math.max(10, v));
    f('pct_minorista')(clamped);
    setRawMin(String(clamped));
    setRawMaj(String(100 - clamped));
  };
  const commitMaj = (raw) => {
    const v = parseInt(raw);
    const clamped = isNaN(v) ? 40 : Math.min(90, Math.max(10, v));
    f('pct_minorista')(100 - clamped);
    setRawMaj(String(clamped));
    setRawMin(String(100 - clamped));
  };

  const cambiarDestino = (productoId, nuevoDestino) => {
    setDestinos(prev => ({ ...prev, [String(productoId)]: nuevoDestino }));
  };

  const calcular = async () => {
    setError('');
    if (!form.fecha_inicio || !form.fecha_fin) { setError('Seleccione el período de distribución'); return; }
    setCalculating(true);
    try {
      const result = await api.calcularDistribucion({
        fecha_inicio: form.fecha_inicio,
        fecha_fin: form.fecha_fin,
        pct_minorista: form.pct_minorista,
        umbral_minorista: form.umbral_minorista,
        destinos,
      });
      setPreview(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setCalculating(false);
    }
  };

  const confirmar = async () => {
    if (!confirm('¿Confirmar la distribución? Esta acción modificará las disponibilidades de los productos y marcará las transferencias como usadas. Los vendedores se asignarán automáticamente de forma aleatoria.')) return;
    setConfirming(true);
    try {
      const result = await api.confirmarDistribucion({
        fecha_inicio: form.fecha_inicio,
        fecha_fin: form.fecha_fin,
        pct_minorista: form.pct_minorista,
        umbral_minorista: form.umbral_minorista,
        periodo_nombre: form.periodo_nombre || `Período ${form.fecha_inicio} — ${form.fecha_fin}`,
        destinos,
      });
      setResultado(result);
      setPreview(null);
      setForm(p => ({ ...p, fecha_inicio: '', fecha_fin: '', periodo_nombre: '' }));
      toast.success('Distribución confirmada correctamente');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setConfirming(false);
    }
  };

  const recalcularMinorista = async () => {
    if (!resultado?.periodo_id) return;
    if (!confirm('¿Recalcular los resúmenes de Puntos de Venta? Se borrarán los resúmenes actuales y se regenerarán con la distribución de transferencias corregida. Las facturas de Almacén Central no se tocan.')) return;
    setRecalculando(true);
    setRecalcResult(null);
    try {
      const r = await api.recalcularMinorista({
        periodo_id: resultado.periodo_id,
        umbral_minorista: form.umbral_minorista,
      });
      setRecalcResult(r);
      toast.success(`Resúmenes PV regenerados — ${r.resumenes_generados} resúmenes`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setRecalculando(false);
    }
  };

  return (
    <div className="fade-in">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, fontFamily: "'Syne', sans-serif", fontWeight: 800, color: '#e8f0fe' }}>Gestión de Distribución</h1>
        <p style={{ color: '#7dd3fc', fontSize: 13, marginTop: 4 }}>
          Distribución entre <strong style={{ color: '#7eb8f7' }}>Almacén Central</strong> (mayorista) y <strong style={{ color: '#f2c94c' }}>Puntos de Venta</strong> (minoristas)
        </p>
      </div>

      {/* Panel de Resultados tras confirmar */}
      {resultado && (
        <div className="fade-in" style={{ marginBottom: 28 }}>
          <Card style={{ border: resultado.cuadre_ok ? '1.5px solid #1a4a2a' : '1.5px solid #4a2a1a', background: resultado.cuadre_ok ? '#0a1a0f' : '#1a0f0a' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <h3 style={{ fontSize: 16, color: resultado.cuadre_ok ? '#6fcf97' : '#f2994a', fontFamily: "'Syne', sans-serif", margin: 0 }}>
                {resultado.cuadre_ok ? '✅ Distribución completada — Cuadre perfecto' : '⚠️ Distribución completada — Revisar cuadres'}
              </h3>
              <button
                onClick={() => setResultado(null)}
                style={{ background: 'none', border: 'none', color: '#7dd3fc', cursor: 'pointer', fontSize: 18, padding: '0 4px' }}
              >✕</button>
            </div>

            {/* Resumen de facturas y resúmenes */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
              {[
                { label: 'Facturas totales', value: resultado.facturas_generadas, color: '#7eb8f7' },
                { label: 'Fase 1 (transferencia)', value: resultado.fase1_facturas, color: '#bb87fc' },
                { label: 'Fase 2 (efectivo)', value: resultado.fase2_facturas, color: '#f2c94c' },
                { label: 'Resúmenes PV', value: resultado.resumenes_generados, color: '#6fcf97' },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ background: '#0a0f18', border: '1px solid #1e2530', borderRadius: 8, padding: '12px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#7dd3fc', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color, fontFamily: "'Syne', sans-serif" }}>{value}</div>
                </div>
              ))}
            </div>

            {/* Cuadre Almacén Central */}
            {resultado.cuadre_almacen && (
              <div style={{ marginBottom: 14, background: '#0a0f18', border: `1.5px solid ${resultado.cuadre_almacen.ok ? '#1a4a2a' : '#6b3a1a'}`, borderRadius: 10, padding: '14px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 16 }}>{resultado.cuadre_almacen.ok ? '✅' : '❌'}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: resultado.cuadre_almacen.ok ? '#6fcf97' : '#f2994a', fontFamily: "'Syne', sans-serif" }}>
                    Almacén Central
                  </span>
                  {!resultado.cuadre_almacen.ok && (
                    <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: '#eb5757', background: '#2a1010', borderRadius: 6, padding: '2px 10px' }}>
                      DIFERENCIA: ${Math.abs(resultado.cuadre_almacen.diferencia).toLocaleString('es-CU', { minimumFractionDigits: 2 })}
                    </span>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, fontSize: 12 }}>
                  <div>
                    <div style={{ color: '#7dd3fc', marginBottom: 2 }}>Inventario esperado</div>
                    <div style={{ color: '#7eb8f7', fontWeight: 700 }}>${resultado.cuadre_almacen.inventario.toLocaleString('es-CU', { minimumFractionDigits: 2 })}</div>
                  </div>
                  <div>
                    <div style={{ color: '#7dd3fc', marginBottom: 2 }}>Total facturado (productos)</div>
                    <div style={{ color: '#7eb8f7', fontWeight: 700 }}>${resultado.cuadre_almacen.facturado.toLocaleString('es-CU', { minimumFractionDigits: 2 })}</div>
                  </div>
                  <div>
                    <div style={{ color: '#7dd3fc', marginBottom: 2 }}>Desglose F1 + F2</div>
                    <div style={{ color: '#8899bb', fontSize: 11 }}>
                      F1: ${resultado.cuadre_almacen.fase1_productos.toLocaleString('es-CU', { minimumFractionDigits: 2 })} &nbsp;+&nbsp;
                      F2: ${resultado.cuadre_almacen.fase2_efectivo.toLocaleString('es-CU', { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Cuadre Puntos de Venta */}
            {resultado.cuadre_pv && (
              <div style={{ background: '#0a0f18', border: `1.5px solid ${resultado.cuadre_pv.ok ? '#1a4a2a' : '#6b3a1a'}`, borderRadius: 10, padding: '14px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 16 }}>{resultado.cuadre_pv.ok ? '✅' : '❌'}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: resultado.cuadre_pv.ok ? '#6fcf97' : '#f2994a', fontFamily: "'Syne', sans-serif" }}>
                    Puntos de Venta
                  </span>
                  {!resultado.cuadre_pv.ok && (
                    <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: '#eb5757', background: '#2a1010', borderRadius: 6, padding: '2px 10px' }}>
                      DIFERENCIA: ${Math.abs(resultado.cuadre_pv.diferencia).toLocaleString('es-CU', { minimumFractionDigits: 2 })}
                    </span>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 12 }}>
                  <div>
                    <div style={{ color: '#7dd3fc', marginBottom: 2 }}>Minorista esperado</div>
                    <div style={{ color: '#f2c94c', fontWeight: 700 }}>${resultado.cuadre_pv.esperado.toLocaleString('es-CU', { minimumFractionDigits: 2 })}</div>
                  </div>
                  <div>
                    <div style={{ color: '#7dd3fc', marginBottom: 2 }}>Total resúmenes generados</div>
                    <div style={{ color: '#f2c94c', fontWeight: 700 }}>${resultado.cuadre_pv.generado.toLocaleString('es-CU', { minimumFractionDigits: 2 })}</div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Botón Recalcular Puntos de Venta ── */}
            <div style={{ marginTop: 18, borderTop: '1px solid #1e2530', paddingTop: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12, color: '#8899bb', fontWeight: 600, marginBottom: 3 }}>
                    🔄 Recalcular resúmenes de Puntos de Venta
                  </div>
                  <div style={{ fontSize: 11, color: '#7dd3fc', maxWidth: 460 }}>
                    Regenera solo los resúmenes PV corrigiendo la distribución de transferencias. Las facturas del Almacén Central no se modifican.
                  </div>
                </div>
                <button
                  onClick={recalcularMinorista}
                  disabled={recalculando}
                  style={{
                    background: recalculando ? '#1a2a1a' : '#0f2a1a',
                    border: `1.5px solid ${recalculando ? '#2a4a2a' : '#2a6a3a'}`,
                    borderRadius: 8,
                    color: recalculando ? '#3a6a4a' : '#6fcf97',
                    fontSize: 13,
                    fontWeight: 700,
                    padding: '9px 20px',
                    cursor: recalculando ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s',
                  }}
                >
                  {recalculando
                    ? <><span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⏳</span> Recalculando...</>
                    : '🔄 Recalcular PV'}
                </button>
              </div>

              {/* Resultado del recálculo */}
              {recalcResult && (
                <div className="fade-in" style={{
                  marginTop: 14,
                  background: '#0a1a0a',
                  border: '1px solid #1a4a2a',
                  borderRadius: 8,
                  padding: '12px 16px',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 10,
                  fontSize: 12,
                }}>
                  <div>
                    <div style={{ color: '#7dd3fc', marginBottom: 3 }}>Total vendido PV</div>
                    <div style={{ color: '#f2c94c', fontWeight: 700, fontSize: 14 }}>
                      ${recalcResult.totales.total_vendido.toLocaleString('es-CU', { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#7dd3fc', marginBottom: 3 }}>Por transferencia</div>
                    <div style={{ color: '#bb87fc', fontWeight: 700, fontSize: 14 }}>
                      ${recalcResult.totales.total_transferencia.toLocaleString('es-CU', { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#7dd3fc', marginBottom: 3 }}>En efectivo</div>
                    <div style={{ color: '#6fcf97', fontWeight: 700, fontSize: 14 }}>
                      ${recalcResult.totales.total_efectivo.toLocaleString('es-CU', { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div style={{ gridColumn: '1 / -1', borderTop: '1px solid #1a3a1a', paddingTop: 8, marginTop: 4, fontSize: 11, color: '#3a6a4a' }}>
                    ✅ {recalcResult.resumenes_generados} resúmenes regenerados · período #{recalcResult.periodo_id}
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Configuración */}
      <Card style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 15, color: '#7eb8f7', marginBottom: 20, fontFamily: "'Syne', sans-serif" }}>Configuración del Período</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 20px' }}>
          <Input label="Fecha inicio período" value={form.fecha_inicio} onChange={f('fecha_inicio')} type="date" required />
          <Input label="Fecha fin período" value={form.fecha_fin} onChange={f('fecha_fin')} type="date" required />
          <Input label="Nombre del período (opcional)" value={form.periodo_nombre} onChange={f('periodo_nombre')} placeholder="ej. Enero 2025" />
          <div>
            <label style={{ display: 'block', marginBottom: 6, fontSize: 11, color: '#8899bb', letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: 600 }}>
              Umbral CR → Minoristas (≤)
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#8899bb', fontSize: 18 }}>$</span>
              <input
                type="number"
                min={1}
                step={1000}
                value={form.umbral_minorista}
                onChange={e => {
                  const v = parseInt(e.target.value);
                  if (!isNaN(v) && v > 0) f('umbral_minorista')(v);
                }}
                style={{
                  background: '#0a0f18', border: '1.5px solid #1e3050', borderRadius: 8,
                  color: '#f2c94c', fontSize: 18, fontWeight: 700,
                  padding: '8px 12px', width: '100%', outline: 'none',
                }}
              />
            </div>
            <div style={{ fontSize: 11, color: '#7dd3fc', marginTop: 5 }}>
              CR &lt; ${form.umbral_minorista.toLocaleString()} → Puntos de Venta &nbsp;|&nbsp; CR ≥ ${form.umbral_minorista.toLocaleString()} → Almacén Central
            </div>
          </div>
        </div>

        <Alert type="info" style={{ marginTop: 12, marginBottom: 16 }}>
          ℹ️ Los vendedores se asignarán <strong>automáticamente de forma aleatoria</strong> a cada factura generada.
        </Alert>

        <div style={{ marginBottom: 24 }}>
          <label style={{ display: 'block', marginBottom: 14, fontSize: 11, color: '#8899bb', letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: 600 }}>
            Distribución de disponibilidad
          </label>

          {/* Slider full-width */}
          <input
            type="range" min={10} max={90} value={form.pct_minorista}
            onChange={e => {
              const v = Number(e.target.value);
              f('pct_minorista')(v);
              setRawMin(String(v));
              setRawMaj(String(100 - v));
            }}
            style={{ width: '80%', accentColor: '#2563eb', cursor: 'pointer', marginBottom: 6 }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#2a3a4a', marginBottom: 20 }}>
            <span>10%</span><span>50%</span><span>90%</span>
          </div>

          {/* Dos cajas de input */}
          <style>{`
            .pct-input::-webkit-outer-spin-button,
            .pct-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
            .pct-input { -moz-appearance: textfield; }
            .pct-box:focus-within { border-color: #4a7abf !important; }
          `}</style>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

            <div className="pct-box" style={{ background: '#0a0f18', border: '2px solid #1e3050', borderRadius: 14, padding: '20px 24px', transition: 'border-color 0.15s', textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: '#6a7a8a', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16 }}>
                📦 Puntos de Venta
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <input
                  className="pct-input"
                  type="text"
                  inputMode="numeric"
                  value={rawMin}
                  onChange={e => {
                    const raw = e.target.value.replace(/[^0-9]/g, '').slice(0, 2);
                    setRawMin(raw);
                    const v = parseInt(raw);
                    if (!isNaN(v) && v >= 10 && v <= 90) {
                      f('pct_minorista')(v);
                      setRawMaj(String(100 - v));
                    }
                  }}
                  onBlur={() => commitMin(rawMin)}
                  style={{
                    background: 'none', border: 'none', outline: 'none',
                    color: '#f2c94c', fontSize: 52, fontWeight: 400,
                    fontFamily: "'Syne', sans-serif",
                    width: 80, padding: 0, lineHeight: 1,
                  }}
                />
                <span style={{ color: '#f2c94c', fontSize: 36, fontWeight: 700, marginLeft: 2 }}>%</span>
              </div>
              <div style={{ fontSize: 12, color: '#2a3a4a', marginTop: 10 }}>del stock disponible</div>
            </div>

            <div className="pct-box" style={{ background: '#0a0f18', border: '2px solid #1a2e44', borderRadius: 14, padding: '20px 24px', transition: 'border-color 0.15s', textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: '#6a7a8a', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16 }}>
                🏭 Almacén Central
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <input
                  className="pct-input"
                  type="text"
                  inputMode="numeric"
                  value={rawMaj}
                  onChange={e => {
                    const raw = e.target.value.replace(/[^0-9]/g, '').slice(0, 2);
                    setRawMaj(raw);
                    const v = parseInt(raw);
                    if (!isNaN(v) && v >= 10 && v <= 90) {
                      f('pct_minorista')(100 - v);
                      setRawMin(String(100 - v));
                    }
                  }}
                  onBlur={() => commitMaj(rawMaj)}
                  style={{
                    background: 'none', border: 'none', outline: 'none',
                    color: '#7eb8f7', fontSize: 52, fontWeight: 400,
                    fontFamily: "'Syne', sans-serif",
                    width: 80, padding: 0, lineHeight: 1,
                  }}
                />
                <span style={{ color: '#7eb8f7', fontSize: 36, fontWeight: 700, marginLeft: 2 }}>%</span>
              </div>
              <div style={{ fontSize: 12, color: '#2a3a4a', marginTop: 10 }}>del stock disponible</div>
            </div>

          </div>
        </div>

        {error && <Alert type="error">{error}</Alert>}

        {/* Selector de destinos por producto */}
        {(!form.fecha_inicio || !form.fecha_fin) ? (
          <div style={{ fontSize: 12, color: '#7dd3fc', fontStyle: 'italic', marginBottom: 20, paddingLeft: 4 }}>
            📅 Completá el rango de fechas para ver los productos disponibles en ese período.
          </div>
        ) : productos.length === 0 ? (
          <div style={{ fontSize: 12, color: '#f2994a', marginBottom: 20, paddingLeft: 4 }}>
            ⚠️ No hay productos activos con disponibilidad en el rango seleccionado.
          </div>
        ) : (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: '#8899bb', letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: 600, marginBottom: 12 }}>
              Destino por producto
            </div>
            <div style={{ background: '#0a0d12', border: '1px solid #1e2530', borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #1e2530', background: '#060810' }}>
                    <th style={{ padding: '8px 14px', textAlign: 'left', fontSize: 11, color: '#7dd3fc', letterSpacing: 0.8, textTransform: 'uppercase' }}>Producto</th>
                    <th style={{ padding: '8px 14px', textAlign: 'left', fontSize: 11, color: '#7dd3fc', letterSpacing: 0.8, textTransform: 'uppercase' }}>Destino</th>
                  </tr>
                </thead>
                <tbody>
                  {productos.map((p, i) => {
                    const dest = destinos[String(p.id)] || (p.categoria === 'otros' ? 'minorista' : 'ambos');
                    const esOtros = p.categoria === 'otros';
                    const btnBase = { border: 'none', borderRadius: 5, padding: '4px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s' };
                    return (
                      <tr key={p.id} style={{ borderBottom: i < productos.length - 1 ? '1px solid #0e1117' : 'none' }}>
                        <td style={{ padding: '9px 14px' }}>
                          <span style={{ color: '#e8f0fe', fontWeight: 600 }}>{p.producto}</span>
                          <span style={{ color: '#7dd3fc', fontSize: 11, marginLeft: 8 }}>{p.codigo}</span>
                          {esOtros && (
                            <span style={{ marginLeft: 8, fontSize: 10, background: 'rgba(187,135,252,0.12)', color: '#bb87fc', border: '1px solid rgba(187,135,252,0.25)', borderRadius: 4, padding: '1px 6px', fontWeight: 700 }}>
                              📦 auto→PV
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '9px 14px' }}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => cambiarDestino(p.id, 'mayorista')}
                              style={{ ...btnBase,
                                background: dest === 'mayorista' ? '#1a4a7a' : '#0e1420',
                                color:      dest === 'mayorista' ? '#7eb8f7' : '#2a4a6a',
                                border:     dest === 'mayorista' ? '1.5px solid #2a6aaa' : '1.5px solid #1a2535',
                              }}>🏭 Central</button>
                            <button onClick={() => cambiarDestino(p.id, 'ambos')}
                              style={{ ...btnBase,
                                background: dest === 'ambos' ? '#1a3a1a' : '#0e1420',
                                color:      dest === 'ambos' ? '#6fcf97' : '#2a4a2a',
                                border:     dest === 'ambos' ? '1.5px solid #2a6a2a' : '1.5px solid #1a2535',
                              }}>🔄 Ambos</button>
                            <button onClick={() => cambiarDestino(p.id, 'minorista')}
                              style={{ ...btnBase,
                                background: dest === 'minorista' ? '#3a2a0a' : '#0e1420',
                                color:      dest === 'minorista' ? '#f2c94c' : '#4a3a1a',
                                border:     dest === 'minorista' ? '1.5px solid #8a6a1a' : '1.5px solid #1a2535',
                              }}>📦 PV</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <Btn onClick={calcular} variant="warning" disabled={calculating}>
          {calculating ? '⏳ Calculando...' : '⚡ Calcular Distribución'}
        </Btn>
      </Card>

      {/* Preview */}
      {preview && (
        <div className="fade-in">
          {/* Info sobre fechas de productos */}
          {preview.info && (
            <Alert type="info" style={{ marginBottom: 20 }}>
              <strong>ℹ️ Filtro automático:</strong> {preview.info}
              {preview.config.fecha_min_productos && preview.config.fecha_max_productos && (
                <div style={{ marginTop: 8, fontSize: 12 }}>
                  <strong>Rango de productos:</strong> {fmtDate(preview.config.fecha_min_productos)} → {fmtDate(preview.config.fecha_max_productos)}
                </div>
              )}
            </Alert>
          )}

          {/* Totales */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 20 }}>
            <StatCard label="Total Mayorista" value={`$${fmt(preview.totales.mayorista)}`} sub="Almacén Central" color="#7eb8f7" />
            <StatCard label="Total Minorista" value={`$${fmt(preview.totales.minorista)}`} sub="Puntos de Venta" color="#f2c94c" />
            <StatCard label="Total General" value={`$${fmt(preview.totales.total)}`} sub={`${preview.transferencias.todas.length} transf. disponibles`} color="#6fcf97" />
          </div>

          {/* Totales por punto de venta */}
          {preview.totales_por_punto && preview.totales_por_punto.length > 0 && (
            <Card style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 14, color: '#f2c94c', marginBottom: 14, fontFamily: "'Syne', sans-serif" }}>Distribución por Punto de Venta</h3>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(preview.totales_por_punto.length, 4)}, 1fr)`, gap: 12 }}>
                {preview.totales_por_punto.map(pv => (
                  <div key={pv.punto_venta_id} style={{ background: '#1a2a2a', border: '1px solid #2a4040', borderRadius: 8, padding: '12px 16px' }}>
                    <div style={{ fontSize: 11, color: '#7dd3fc', marginBottom: 4 }}>{pv.punto_venta_nombre}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#f2c94c', marginBottom: 2 }}>${fmt(pv.total)}</div>
                    <div style={{ fontSize: 12, color: '#8899bb' }}>{pv.porcentaje}% del minorista</div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Resumen transferencias */}
<Card style={{ marginBottom: 20 }}>
  <h3 style={{ fontSize: 14, color: '#bb87fc', marginBottom: 14, fontFamily: "'Syne', sans-serif" }}>Transferencias CR Disponibles en el Período</h3>
  <div style={{ display: 'flex', gap: 14, marginBottom: 14 }}>
    <div style={{ background: '#1a2a2a', border: '1px solid #2a4040', borderRadius: 8, padding: '10px 16px' }}>
      <div style={{ fontSize: 11, color: '#7dd3fc', marginBottom: 4 }}>CR &lt; ${(preview.config.umbral_minorista || 20000).toLocaleString()} → Puntos de Venta</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#f2c94c' }}>
        {preview.transferencias.todas.filter(t => parseFloat(t.importe) < (preview.config.umbral_minorista || 20000)).length} transf. / 
        ${fmt(preview.transferencias.todas.filter(t => parseFloat(t.importe) < (preview.config.umbral_minorista || 20000)).reduce((s, t) => s + parseFloat(t.importe), 0))}
      </div>
    </div>
    <div style={{ background: '#1a2a3a', border: '1px solid #2a4060', borderRadius: 8, padding: '10px 16px' }}>
      <div style={{ fontSize: 11, color: '#7dd3fc', marginBottom: 4 }}>CR ≥ ${(preview.config.umbral_minorista || 20000).toLocaleString()} → Almacén Central</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#7eb8f7' }}>
        {preview.transferencias.todas.filter(t => parseFloat(t.importe) >= (preview.config.umbral_minorista || 20000)).length} transf. / 
        ${fmt(preview.transferencias.todas.filter(t => parseFloat(t.importe) >= (preview.config.umbral_minorista || 20000)).reduce((s, t) => s + parseFloat(t.importe), 0))}
      </div>
    </div>
  </div>
</Card>

          {/* Plan de productos */}
          <Card style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 14, color: '#6fcf97', fontFamily: "'Syne', sans-serif", margin: '0 0 14px 0' }}>Plan de Distribución por Producto</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #1e2530' }}>
                    {['Producto', 'Destino', 'Almacén Central', 'Valor Mayorista', 'Puntos de Venta (UM min)', 'Valor Minorista'].map(h => (
                      <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: '#7dd3fc', fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.plan.map(p => {
                    const dest = p.destino || destinos[String(p.id)] || 'ambos';
                    const destLabel = dest === 'mayorista' ? { icon: '🏭', label: 'Central',   color: '#7eb8f7', bg: '#1a4a7a' }
                                    : dest === 'minorista' ? { icon: '📦', label: 'PV',         color: '#f2c94c', bg: '#3a2a0a' }
                                    :                        { icon: '🔄', label: 'Ambos',       color: '#6fcf97', bg: '#1a3a1a' };
                    return (
                      <tr key={p.id} style={{ borderBottom: '1px solid #0e1117' }}>
                        <td style={{ padding: '11px 12px' }}>
                          <div style={{ color: '#e8f0fe', fontWeight: 600 }}>{p.producto}</div>
                          <div style={{ fontSize: 11, color: '#7dd3fc' }}>{p.codigo}</div>
                        </td>
                        <td style={{ padding: '11px 12px' }}>
                          <span style={{ background: destLabel.bg, color: destLabel.color, borderRadius: 5, padding: '3px 10px', fontSize: 11, fontWeight: 700 }}>
                            {destLabel.icon} {destLabel.label}
                          </span>
                        </td>
                        <td style={{ padding: '11px 12px', opacity: dest === 'minorista' ? 0.3 : 1 }}>
                          {p.fmtRango ? (
                            <>
                              <span style={{ color: '#f2c94c', fontWeight: 700 }}>{p.cajas_mayorista} piezas</span>
                              <span style={{ color: '#7dd3fc', fontSize: 11 }}> ({fmt(p.para_mayorista)} {p.um_minorista})</span>
                              <div style={{ fontSize: 10, color: '#eb8c34', marginTop: 2 }}>★ rango {p.pesoMin}–{p.pesoMax} {p.um_minorista}</div>
                            </>
                          ) : (
                            <>
                              <span style={{ color: '#7eb8f7', fontWeight: 700 }}>{p.cajas_mayorista} cajas</span>
                              <span style={{ color: '#7dd3fc', fontSize: 11 }}> ({fmt(p.para_mayorista)} {p.um_minorista})</span>
                            </>
                          )}
                        </td>
                        <td style={{ padding: '11px 12px', color: '#7eb8f7', fontWeight: 700, opacity: dest === 'minorista' ? 0.3 : 1 }}>${fmt(p.valor_mayorista)}</td>
                        <td style={{ padding: '11px 12px', opacity: dest === 'mayorista' ? 0.3 : 1 }}>
                          <span style={{ color: '#f2c94c', fontWeight: 700 }}>{fmt(p.para_minorista)} {p.um_minorista}</span>
                        </td>
                        <td style={{ padding: '11px 12px', color: '#f2c94c', fontWeight: 700, opacity: dest === 'mayorista' ? 0.3 : 1 }}>${fmt(p.valor_minorista)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Reglas recordatorio */}
          <Alert type="info">
            <strong>Reglas aplicadas:</strong> Cajas distribuidas como enteros exactos por día. Transferencias CR ≥ ${form.umbral_minorista.toLocaleString()} → Almacén Central; ${form.umbral_minorista.toLocaleString()} → Puntos de Venta. <strong>Solo se usan las transferencias del día exacto en que se realizaron.</strong> Si no hay transferencia ese día, el pago va íntegro a efectivo. Los vendedores se asignan aleatoriamente.
          </Alert>

          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <Btn onClick={confirmar} variant="success" disabled={confirming}>
              {confirming ? '⏳ Procesando...' : '✅ Confirmar y Generar Facturas'}
            </Btn>
            <Btn onClick={() => setPreview(null)} variant="ghost">Cancelar</Btn>
          </div>
        </div>
      )}
    </div>
  );
}