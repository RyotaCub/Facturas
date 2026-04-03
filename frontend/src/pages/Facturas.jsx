import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';
import { fmt, fmtDate } from '../lib/utils.js';
import { Badge, Spinner, StatCard, Btn } from '../components/UI.jsx';

// ─── CSS compartido para impresión ───────────────────────────────────────────
const PRINT_STYLES = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:monospace;padding:20px;color:#111;font-size:12px}
  .factura{max-width:580px;margin:0 auto;padding-bottom:24px;border-bottom:2px dashed #ccc;margin-bottom:24px;page-break-inside:avoid}
  .factura:last-child{border-bottom:none;margin-bottom:0}
  .h{text-align:center;border-bottom:2px solid #000;padding-bottom:10px;margin-bottom:12px}
  .h h2{font-size:17px;letter-spacing:2px;margin-bottom:3px}
  .h p{font-size:11px;color:#555}
  .r{display:flex;justify-content:space-between;margin:4px 0;font-size:12px}
  .sep{border:none;border-top:1px dashed #999;margin:8px 0}
  table{width:100%;border-collapse:collapse;margin:10px 0}
  th{background:#eee;padding:6px 8px;font-size:10px;text-align:left;border:1px solid #ccc;text-transform:uppercase;letter-spacing:0.5px}
  td{border:1px solid #ddd;padding:6px 8px;font-size:11px}
  .tot{font-weight:700;font-size:14px;border-top:2px solid #000;margin-top:8px;padding-top:8px}
  .sub{font-size:11px;color:#555;margin-top:4px}
  .stamp{text-align:center;margin-top:24px;color:#888;font-size:10px}
  @page{margin:10mm;size:auto}
  @media print{body{padding:10px}.factura{border-bottom:2px dashed #aaa}}
`;

// ─── Genera el HTML de UNA factura ───────────────────────────────────────────
function facturaHTML(f) {
  const items = (f.items || []).filter(i => i && i.producto);
  return `
    <div class="factura">
      <div class="h">
        <h2>Mulata Bonita</h2>
        <p>ALMACÉN CENTRAL — VENTA MAYORISTA</p>
        <p style="margin-top:5px;font-size:10px">No. ${f.consecutivo} &nbsp;|&nbsp; Fecha: ${fmtDate(f.fecha)}</p>
      </div>
      <div class="r"><span>Cliente:</span><strong>${f.cliente_nombre || '—'}</strong></div>
      <div class="r"><span>CI:</span><span>${f.cliente_ci || '—'}</span></div>
      <div class="r"><span>Vendedor:</span><span>${f.vendedor_nombre || '—'}</span></div>
      ${f.ref_transferencia ? `<div class="r"><span>Ref. Transferencia:</span><span>${f.ref_transferencia}</span></div>` : ''}
      ${f.es_fusion && f.detalle_transferencias ? (() => {
        let detalles;
        try { detalles = typeof f.detalle_transferencias === 'string' ? JSON.parse(f.detalle_transferencias) : f.detalle_transferencias; } catch { detalles = []; }
        if (!detalles || detalles.length < 2) return '';
        return `<div style="margin:6px 0;padding:6px 8px;border:1px dashed #aaa;font-size:11px">
          <strong>Transferencias combinadas:</strong><br>
          ${detalles.map(t => `${t.ref || '—'}: $${t.importe?.toLocaleString?.() ?? t.importe}`).join('<br>')}
        </div>`;
      })() : ''}
      <hr class="sep">
      <table>
        <thead><tr><th>Producto</th><th>Cant.</th><th>UM</th><th>Precio</th><th>Importe</th></tr></thead>
        <tbody>
          ${items.map(i => `
            <tr>
              <td>${i.producto}<br><small style="color:#888">${i.codigo || ''}</small></td>
              <td style="text-align:center">${i.cantidad}</td>
              <td>${i.um}</td>
              <td style="text-align:right">$${fmt(i.precio)}</td>
              <td style="text-align:right"><strong>$${fmt(i.importe)}</strong></td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div class="tot r"><span>TOTAL:</span><span>$${fmt(f.total)}</span></div>
      <div class="sub r"><span>En efectivo:</span><span>$${fmt(f.efectivo)}</span></div>
      ${parseFloat(f.total_transferencia || 0) > 0
        ? `<div class="sub r"><span>Por transferencia:</span><span>$${fmt(f.total_transferencia)}</span></div>` : ''}
      <div class="stamp">
        <p>_____________________________ &nbsp;&nbsp; _____________________________</p>
        <p style="margin-top:5px">Firma Vendedor &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Firma Cliente</p>
      </div>
    </div>`;
}

// ─── Imprimir una sola factura ────────────────────────────────────────────────
function printFactura(f) {
  const w = window.open('', '_blank', 'width=680,height=900');
  w.document.write(`<!DOCTYPE html><html lang="es"><head>
    <meta charset="UTF-8"><title>Factura #${f.consecutivo}</title>
    <style>${PRINT_STYLES}</style>
  </head><body>${facturaHTML(f)}</body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 300);
}

// ─── Imprimir TODAS las facturas del filtro activo ───────────────────────────
async function printTodas(filtroPeriodo, periodos, setPrintLoading) {
  setPrintLoading(true);
  try {
    const params = { page: 1, limit: 9999 };
    if (filtroPeriodo) params.periodo_id = filtroPeriodo;
    const resp  = await api.getFacturas(params);
    const todas = (resp.data ?? resp).sort((a, b) => {
      const d = new Date(a.fecha) - new Date(b.fecha);
      return d !== 0 ? d : (parseInt(a.consecutivo) || 0) - (parseInt(b.consecutivo) || 0);
    });

    if (!todas.length) { toast.error('No hay facturas para imprimir'); return; }

    // Título del lote
    const periodo = periodos.find(p => String(p.id) === String(filtroPeriodo));
    const titulo  = periodo ? periodo.nombre : 'Todos los períodos';
    const totalGeneral = todas.reduce((s, f) => s + parseFloat(f.total || 0), 0);

    const w = window.open('', '_blank', 'width=720,height=960');
    w.document.write(`<!DOCTYPE html><html lang="es"><head>
      <meta charset="UTF-8"><title>Facturas — ${titulo}</title>
      <style>
        ${PRINT_STYLES}
        .portada{text-align:center;padding:40px 20px;border-bottom:3px solid #000;margin-bottom:30px;page-break-after:always}
        .portada h1{font-size:22px;letter-spacing:3px;margin-bottom:8px}
        .portada p{font-size:13px;color:#555;margin:4px 0}
        .portada .total{font-size:18px;font-weight:700;margin-top:16px}
      </style>
    </head><body>
      <div class="portada">
        <h1>Mulata Bonita</h1>
        <p>ALMACÉN CENTRAL — VENTA MAYORISTA</p>
        <p style="margin-top:10px">Período: <strong>${titulo}</strong></p>
        <p>${todas.length} facturas · del #${todas[0].consecutivo} al #${todas[todas.length - 1].consecutivo}</p>
        <div class="total">Total facturado: $${fmt(totalGeneral)}</div>
      </div>
      ${todas.map(facturaHTML).join('')}
    </body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 500);
  } catch (e) {
    toast.error('Error al cargar facturas: ' + e.message);
  } finally {
    setPrintLoading(false);
  }
}

// ─── Imprimir facturas de UN vendedor ────────────────────────────────────────
async function printPorVendedor(vendedor, filtroPeriodo, periodos, setPrintLoading) {
  setPrintLoading(true);
  try {
    const params = { page: 1, limit: 9999 };
    if (filtroPeriodo) params.periodo_id = filtroPeriodo;
    const resp  = await api.getFacturas(params);
    const todas = (resp.data ?? resp).filter(f =>
      (f.vendedor_nombre || '').trim().toUpperCase() === vendedor.trim().toUpperCase()
    ).sort((a, b) => {
      const d = new Date(a.fecha) - new Date(b.fecha);
      return d !== 0 ? d : (parseInt(a.consecutivo) || 0) - (parseInt(b.consecutivo) || 0);
    });

    if (!todas.length) { toast.error(`No hay facturas para ${vendedor}`); return; }

    const periodo = periodos.find(p => String(p.id) === String(filtroPeriodo));
    const titulo  = periodo ? periodo.nombre : 'Todos los períodos';
    const totalGeneral   = todas.reduce((s, f) => s + parseFloat(f.total || 0), 0);
    const totalEfectivo  = todas.reduce((s, f) => s + parseFloat(f.efectivo || 0), 0);
    const totalTransf    = todas.reduce((s, f) => s + parseFloat(f.total_transferencia || 0), 0);

    const w = window.open('', '_blank', 'width=720,height=960');
    w.document.write(`<!DOCTYPE html><html lang="es"><head>
      <meta charset="UTF-8"><title>Facturas — ${vendedor}</title>
      <style>
        ${PRINT_STYLES}
        .portada{text-align:center;padding:40px 20px;border-bottom:3px solid #000;margin-bottom:30px;page-break-after:always}
        .portada h1{font-size:22px;letter-spacing:3px;margin-bottom:8px}
        .portada .vendedor-badge{display:inline-block;background:#000;color:#fff;padding:6px 22px;border-radius:99px;font-size:16px;font-weight:700;letter-spacing:1px;margin:14px 0}
        .portada p{font-size:13px;color:#555;margin:4px 0}
        .portada .total{font-size:18px;font-weight:700;margin-top:16px}
        .portada .subtotales{font-size:12px;color:#555;margin-top:6px}
      </style>
    </head><body>
      <div class="portada">
        <h1>Mulata Bonita</h1>
        <p>ALMACÉN CENTRAL — VENTA MAYORISTA</p>
        <div class="vendedor-badge">Vendedor: ${vendedor}</div>
        <p style="margin-top:8px">Período: <strong>${titulo}</strong></p>
        <p>${todas.length} facturas · del #${todas[0].consecutivo} al #${todas[todas.length - 1].consecutivo}</p>
        <div class="total">Total: $${fmt(totalGeneral)}</div>
        <div class="subtotales">Efectivo: $${fmt(totalEfectivo)} &nbsp;|&nbsp; Transferencia: $${fmt(totalTransf)}</div>
      </div>
      ${todas.map(facturaHTML).join('')}
    </body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 500);
  } catch (e) {
    toast.error('Error al cargar facturas: ' + e.message);
  } finally {
    setPrintLoading(false);
  }
}

// ─── Banner de recordatorio de numeración ─────────────────────────────────────
function BannerNumeracion({ facturas, periodos }) {
  if (!facturas.length) return null;

  const maxConsecutivo = Math.max(...facturas.map(f => parseInt(f.consecutivo) || 0));
  const ultimaFecha    = new Date(facturas[facturas.length - 1]?.fecha || new Date());
  const hoy            = new Date();
  const mesActual      = hoy.getMonth();
  const mesFact        = ultimaFecha.getMonth();
  const anoActual      = hoy.getFullYear();
  const anoFact        = ultimaFecha.getFullYear();

  // Solo mostrar si el último mes con facturas NO es el mes actual
  const esOtroMes = mesFact !== mesActual || anoFact !== anoActual;
  if (!esOtroMes) return null;

  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const nombreMes = meses[mesFact];
  const proximoAno = anoFact + 1;
  const esFinDeAno = mesFact === 11; // diciembre

  return (
    <div style={{
      background: 'rgba(242,201,76,0.08)', border: '1px solid rgba(242,201,76,0.35)',
      borderRadius: 12, padding: '14px 18px', marginBottom: 20,
      display: 'flex', alignItems: 'flex-start', gap: 12,
    }}>
      <span style={{ fontSize: 20, flexShrink: 0 }}>📋</span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#f2c94c', marginBottom: 4 }}>
          Recordatorio de numeración — {nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1)} {anoFact}
        </div>
        <div style={{ fontSize: 12, color: '#c8a820', lineHeight: 1.6 }}>
          El último mes cerró en la factura <strong style={{ color: '#f2c94c' }}>#{maxConsecutivo}</strong>.
          {esFinDeAno ? (
            <> El próximo mes es <strong>enero {proximoAno}</strong> — la numeración <strong>se reinicia en #1</strong> al comenzar el nuevo año.</>
          ) : (
            <> El próximo mes <strong>continúa desde #{maxConsecutivo + 1}</strong>. La numeración solo se reinicia en enero de cada año.</>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function Facturas() {
  const [facturas, setFacturas]           = useState([]);
  const [todasFacturas, setTodasFacturas] = useState([]); // para el banner de numeración
  const [loading, setLoading]             = useState(true);
  const [periodos, setPeriodos]           = useState([]);
  const [filtroPeriodo, setFiltroPeriodo] = useState('');
  const [mostrarAnuladas, setMostrarAnuladas] = useState(false);
  const [anuladas, setAnuladas]           = useState([]);
  const [motivoAnulacion, setMotivoAnulacion] = useState('');
  const [anulando, setAnulando]           = useState(null);
  const [page, setPage]                   = useState(1);
  const [pagination, setPagination]       = useState({ total: 0, totalPages: 1 });
  const [printLoading, setPrintLoading]   = useState(false);
  const [showVendedorMenu, setShowVendedorMenu] = useState(false);
  const LIMIT = 25;

  const load = () => {
    setLoading(true);
    const params = { page, limit: LIMIT };
    if (filtroPeriodo) params.periodo_id = filtroPeriodo;

    // También carga todas (sin paginar) para calcular el banner de numeración
    const paramsTodas = { page: 1, limit: 9999 };
    if (filtroPeriodo) paramsTodas.periodo_id = filtroPeriodo;

    Promise.all([
      api.getFacturas(params),
      api.getPeriodos(),
      api.getFacturas(paramsTodas),
    ])
      .then(([resp, p, respTodas]) => {
        const lista = (resp.data ?? resp).sort((a, b) => {
          const d = new Date(a.fecha) - new Date(b.fecha);
          return d !== 0 ? d : (parseInt(a.consecutivo) || 0) - (parseInt(b.consecutivo) || 0);
        });
        const listaTodas = (respTodas.data ?? respTodas).sort((a, b) =>
          (parseInt(a.consecutivo) || 0) - (parseInt(b.consecutivo) || 0)
        );
        setFacturas(lista);
        setTodasFacturas(listaTodas);
        setPagination({ total: resp.total ?? lista.length, totalPages: resp.totalPages ?? 1 });
        setPeriodos(p);
      })
      .catch(e => toast.error(e.message))
      .finally(() => setLoading(false));
  };

  const loadAnuladas = () => {
    api.getFacturasAnuladas().then(setAnuladas).catch(e => toast.error(e.message));
  };

  useEffect(() => { setPage(1); }, [filtroPeriodo]);
  useEffect(load, [filtroPeriodo, page]);
  useEffect(() => { if (mostrarAnuladas) loadAnuladas(); }, [mostrarAnuladas]);

  const iniciarAnulacion = (id) => { setAnulando(id); setMotivoAnulacion(''); };

  const confirmarAnulacion = async (id, consecutivo) => {
    if (!confirm(`¿Anular la factura #${consecutivo}? Se revertirá el inventario y quedará en el historial de anuladas.`)) return;
    try {
      await api.deleteFactura(id, motivoAnulacion);
      toast.success('Factura anulada. Inventario revertido.');
      setAnulando(null);
      load();
    } catch (e) {
      toast.error(e.message);
    }
  };

  // Totales calculados sobre TODAS las facturas del período, no solo la página actual
  const totalEf  = useMemo(() => todasFacturas.reduce((s, f) => s + parseFloat(f.efectivo || 0), 0), [todasFacturas]);
  const totalTr  = useMemo(() => todasFacturas.reduce((s, f) => s + parseFloat(f.total_transferencia || 0), 0), [todasFacturas]);
  const totalGen = useMemo(() => todasFacturas.reduce((s, f) => s + parseFloat(f.total || 0), 0), [todasFacturas]);

  // Agrupado por producto + índice inverso: key → facturas que lo contienen
  const { totalesPorProducto, facturasPorProducto } = useMemo(() => {
    const mapa   = new Map();
    const indice = new Map(); // key → [{ consecutivo, fecha, total, itemCantidad, itemImporte }]
    for (const f of todasFacturas) {
      for (const item of (f.items || [])) {
        if (!item?.producto) continue;
        const key = item.codigo || item.producto;
        if (!mapa.has(key)) {
          mapa.set(key, { producto: item.producto, codigo: item.codigo, um: item.um, cantidad: 0, importe: 0, facturas: 0 });
          indice.set(key, []);
        }
        const g = mapa.get(key);
        g.cantidad += parseFloat(item.cantidad || 0);
        g.importe  += parseFloat(item.importe  || 0);
        g.facturas += 1;
        indice.get(key).push({
          consecutivo: f.consecutivo,
          fecha:       f.fecha,
          total:       parseFloat(f.total || 0),
          itemCantidad: parseFloat(item.cantidad || 0),
          itemImporte:  parseFloat(item.importe  || 0),
          um:           item.um,
        });
      }
    }
    return {
      totalesPorProducto: [...mapa.values()].sort((a, b) => b.importe - a.importe),
      facturasPorProducto: indice,
    };
  }, [todasFacturas]);

  const [productoSeleccionado, setProductoSeleccionado] = useState(null); // key del producto
  const [stockCollapsed, setStockCollapsed]             = useState(false);
  const [mostrarDuplicados, setMostrarDuplicados] = useState(false);

  // Clientes con nombre duplicado entre facturas del período activo
  const duplicadosCliente = useMemo(() => {
    const mapa = new Map(); // nombre_normalizado → [{ consecutivo, fecha, cliente_ci, id }]
    for (const f of todasFacturas) {
      if (!f.cliente_nombre) continue;
      const key = f.cliente_nombre.trim().toUpperCase();
      if (!mapa.has(key)) mapa.set(key, []);
      mapa.get(key).push({
        consecutivo: f.consecutivo,
        fecha:       f.fecha,
        cliente_ci:  f.cliente_ci,
        total:       parseFloat(f.total || 0),
        id:          f.id,
        nombre_original: f.cliente_nombre,
      });
    }
    return [...mapa.entries()]
      .filter(([, facts]) => facts.length > 1)
      .map(([nombre, facts]) => ({ nombre, facts: facts.sort((a,b) => a.consecutivo - b.consecutivo) }))
      .sort((a, b) => b.facts.length - a.facts.length);
  }, [todasFacturas]);

  // Vendedores únicos extraídos de las facturas del período activo
  const vendedoresUnicos = useMemo(() => [...new Set(
    todasFacturas.map(f => f.vendedor_nombre).filter(Boolean)
  )].sort(), [todasFacturas]);

  // Map pre-calculado vendedor → { cuenta, total } para O(1) en el menú de impresión
  const statsPorVendedor = useMemo(() => {
    const map = new Map();
    for (const f of todasFacturas) {
      if (!f.vendedor_nombre) continue;
      if (!map.has(f.vendedor_nombre)) map.set(f.vendedor_nombre, { cuenta: 0, total: 0 });
      const s = map.get(f.vendedor_nombre);
      s.cuenta += 1;
      s.total  += parseFloat(f.total || 0);
    }
    return map;
  }, [todasFacturas]);

  const btnStyle = (active) => ({
    padding: '7px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 12,
    fontFamily: 'inherit', fontWeight: 600,
    border: active ? '1px solid #2563eb' : '1px solid #1e2530',
    background: active ? '#1a2540' : 'none',
    color: active ? '#7eb8f7' : '#7dd3fc',
  });

  return (
    <div className="fade-in">

      {/* Encabezado + botones de impresión */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 26, fontFamily: "'Syne', sans-serif", fontWeight: 800, color: '#e8f0fe' }}>Facturas Mayoristas</h1>
          <p style={{ color: '#7dd3fc', fontSize: 13, marginTop: 4 }}>Almacén Central — comprobantes de venta</p>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Imprimir por vendedor */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowVendedorMenu(v => !v)}
              disabled={printLoading || !vendedoresUnicos.length}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: '#1a2a1a', border: '1px solid #2a5030', borderRadius: 10,
                padding: '10px 20px', color: '#6fcf97',
                cursor: (printLoading || !vendedoresUnicos.length) ? 'not-allowed' : 'pointer',
                fontSize: 13, fontFamily: 'inherit', fontWeight: 700,
                opacity: (!vendedoresUnicos.length) ? 0.4 : 1,
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { if (vendedoresUnicos.length) e.currentTarget.style.background = '#1e3020'; }}
              onMouseLeave={e => { if (vendedoresUnicos.length) e.currentTarget.style.background = '#1a2a1a'; }}
            >
              🖨 Por vendedor {vendedoresUnicos.length > 0 && `(${vendedoresUnicos.length})`} <span style={{ fontSize: 10 }}>▼</span>
            </button>

            {showVendedorMenu && (
              <>
                {/* Capa para cerrar al hacer click fuera */}
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 999 }}
                  onClick={() => setShowVendedorMenu(false)}
                />
                <div style={{
                  position: 'absolute', top: '110%', right: 0,
                  background: '#0e1117', border: '1px solid #2a3a4a',
                  borderRadius: 12, padding: 8, zIndex: 1000, minWidth: 220,
                  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                }}>
                  <div style={{ fontSize: 10, color: '#7dd3fc', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700, padding: '4px 10px 8px' }}>
                    Seleccionar vendedor
                  </div>
                  {vendedoresUnicos.map(v => {
                    const { cuenta = 0, total = 0 } = statsPorVendedor.get(v) ?? {};
                    return (
                      <button
                        key={v}
                        onClick={() => {
                          setShowVendedorMenu(false);
                          printPorVendedor(v, filtroPeriodo, periodos, setPrintLoading);
                        }}
                        className="hover-bg-dark"
                        style={{
                          width: '100%', background: 'none', border: 'none',
                          padding: '10px 12px', cursor: 'pointer', borderRadius: 8,
                          textAlign: 'left', fontFamily: 'inherit',
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          gap: 12, transition: 'background 0.1s',
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#e8f0fe' }}>{v}</div>
                          <div style={{ fontSize: 11, color: '#3a5a3a', marginTop: 1 }}>${fmt(total)}</div>
                        </div>
                        <span style={{
                          background: '#1a3020', border: '1px solid #2a5030',
                          borderRadius: 6, padding: '3px 9px',
                          fontSize: 11, fontWeight: 700, color: '#6fcf97',
                        }}>{cuenta}</span>
                      </button>
                    );
                  })}
                  <div style={{ borderTop: '1px solid #1e2530', margin: '6px 0 2px' }} />
                  <button
                    onClick={() => {
                      setShowVendedorMenu(false);
                      // Imprimir cada vendedor en ventanas separadas con delay
                      vendedoresUnicos.forEach((v, i) => {
                        setTimeout(() => printPorVendedor(v, filtroPeriodo, periodos, setPrintLoading), i * 800);
                      });
                    }}
                    className="hover-bg-dark"
                    style={{
                      width: '100%', background: 'none', border: 'none',
                      padding: '8px 12px', cursor: 'pointer', borderRadius: 8,
                      textAlign: 'left', fontFamily: 'inherit', fontSize: 12,
                      color: '#4a7a6a', fontWeight: 600, transition: 'background 0.1s',
                    }}
                  >
                    🖨 Imprimir todos los vendedores
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Imprimir todas */}
          <button
            onClick={() => printTodas(filtroPeriodo, periodos, setPrintLoading)}
            disabled={printLoading || !pagination.total}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: printLoading ? '#141920' : '#1a2a3a',
              border: '1px solid #2a5080', borderRadius: 10,
              padding: '10px 20px', color: printLoading ? '#7dd3fc' : '#7eb8f7',
              cursor: printLoading || !pagination.total ? 'not-allowed' : 'pointer',
              fontSize: 13, fontFamily: 'inherit', fontWeight: 700,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (!printLoading) e.currentTarget.style.background = '#1e3248'; }}
            onMouseLeave={e => { e.currentTarget.style.background = printLoading ? '#141920' : '#1a2a3a'; }}
          >
            🖨 {printLoading ? 'Preparando...' : `Imprimir todas (${pagination.total})`}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 24 }}>
        <StatCard label="Total Facturado" value={`$${fmt(totalGen)}`} sub={`${pagination.total} facturas`} color="#65fd00" />
        <StatCard label="En Efectivo"     value={`$${fmt(totalEf)}`}  sub="Cobrado en caja"  color="#6fcf97" />
        <StatCard label="Por Transferencia" value={`$${fmt(totalTr)}`} sub="Cobrado por banco" color="#bb87fc" />
      </div>

      {/* Resumen de stock por producto */}
      {totalesPorProducto.length > 0 && (
        <div style={{ background: '#0a0d12', border: '1px solid #1e2530', borderRadius: 12, padding: '16px 20px', marginBottom: 20 }}>
          <div
            onClick={() => setStockCollapsed(v => !v)}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
          >
            <div style={{ fontSize: 11, color: '#8899bb', textTransform: 'uppercase', letterSpacing: 0.9, fontWeight: 700 }}>
              📦 Stock facturado — {totalesPorProducto.length} producto{totalesPorProducto.length !== 1 ? 's' : ''}
            </div>
            <span style={{ fontSize: 13, color: '#7dd3fc', transition: 'transform 0.2s', display: 'inline-block', transform: stockCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
          </div>
          {!stockCollapsed && (
          <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, color: '#ffffff', marginBottom: 12 }}>Haz click en una fila para ver las facturas que contienen ese producto</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1e2530' }}>
                  {['Producto', 'Total cantidad', 'UM', 'Total importe', 'Facturas'].map(h => (
                    <th key={h} style={{ padding: '6px 10px', textAlign: h === 'Total importe' || h === 'Total cantidad' ? 'right' : 'left', color: '#7dd3fc', fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {totalesPorProducto.map((p, i) => {
                  const key = p.codigo || p.producto;
                  const seleccionado = productoSeleccionado === key;
                  const detalle = facturasPorProducto.get(key) || [];
                  return (
                    <>
                      <tr
                        key={key}
                        onClick={() => setProductoSeleccionado(seleccionado ? null : key)}
                        style={{ borderBottom: seleccionado ? 'none' : '1px solid #0e1117', cursor: 'pointer', background: seleccionado ? '#0e1520' : 'transparent', transition: 'background 0.12s' }}
                        onMouseEnter={e => { if (!seleccionado) e.currentTarget.style.background = '#0c1018'; }}
                        onMouseLeave={e => { if (!seleccionado) e.currentTarget.style.background = 'transparent'; }}
                      >
                        <td style={{ padding: '8px 10px' }}>
                          <span style={{ color: seleccionado ? '#7eb8f7' : '#e8f0fe', fontWeight: 600 }}>{p.producto}</span>
                          {p.codigo && <span style={{ color: '#7dd3fc', fontSize: 11, marginLeft: 6 }}>{p.codigo}</span>}
                          <span style={{ marginLeft: 8, fontSize: 11, color: seleccionado ? '#4a7abf' : '#2a3a4a' }}>{seleccionado ? '▲' : '▼'}</span>
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: '#f2c94c', fontWeight: 700 }}>{fmt(p.cantidad)}</td>
                        <td style={{ padding: '8px 10px', color: '#7dd3fc', fontSize: 11 }}>{p.um}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: '#7eb8f7', fontWeight: 700 }}>${fmt(p.importe)}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                          <span style={{ background: seleccionado ? '#1a3050' : '#1a2030', border: `1px solid ${seleccionado ? '#2a5080' : '#2a3040'}`, borderRadius: 5, padding: '2px 8px', fontSize: 11, color: seleccionado ? '#7eb8f7' : '#8899bb' }}>{p.facturas}</span>
                        </td>
                      </tr>
                      {seleccionado && (
                        <tr key={key + '_detalle'} style={{ borderBottom: '1px solid #0e1117' }}>
                          <td colSpan={5} style={{ padding: '0 10px 12px 10px', background: '#0e1520' }}>
                            <div style={{ borderTop: '1px solid #1a2535', paddingTop: 10 }}>
                              <div style={{ fontSize: 10, color: '#4a6a8a', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, fontWeight: 700 }}>
                                Facturas que contienen {p.producto}
                              </div>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
                                {detalle.sort((a, b) => a.consecutivo - b.consecutivo).map((d, di) => (
                                  <div key={di} style={{ background: '#0a0f18', border: '1px solid #1a2535', borderRadius: 8, padding: '8px 12px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                      <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, color: '#7eb8f7', fontSize: 13 }}>#{d.consecutivo}</span>
                                      <span style={{ fontSize: 11, color: '#7dd3fc' }}>{fmtDate(d.fecha)}</span>
                                    </div>
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
                  <td colSpan={3} style={{ padding: '8px 10px', color: '#7dd3fc', fontSize: 11, fontWeight: 700 }}>TOTAL GENERAL</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: '#6fcf97', fontWeight: 800, fontSize: 14 }}>${fmt(totalGen)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          </div>
          )}
        </div>
      )}

      {/* Panel de clientes duplicados */}
      {duplicadosCliente.length > 0 && (
        <div style={{ background: '#100a0a', border: '1.5px solid #5a2a2a', borderRadius: 12, padding: '14px 18px', marginBottom: 20 }}>
          <button
            onClick={() => setMostrarDuplicados(v => !v)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: 0 }}
          >
            <span style={{ fontSize: 16 }}>⚠️</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#eb5757', fontFamily: "'Syne', sans-serif", flex: 1, textAlign: 'left' }}>
              {duplicadosCliente.length} nombre{duplicadosCliente.length !== 1 ? 's' : ''} de cliente duplicado{duplicadosCliente.length !== 1 ? 's' : ''} en este período
            </span>
            <span style={{ fontSize: 11, color: '#5a3a3a', marginRight: 4 }}>
              {mostrarDuplicados ? '▲ Ocultar' : '▼ Ver detalle'}
            </span>
          </button>

          {mostrarDuplicados && (
            <div style={{ marginTop: 14, borderTop: '1px solid #3a1a1a', paddingTop: 14 }}>
              <p style={{ fontSize: 12, color: '#5a3a3a', marginBottom: 14 }}>
                Estos nombres aparecen en más de una factura. Pueden ser el mismo cliente registrado con variaciones de nombre o CI.
              </p>
              {duplicadosCliente.map(({ nombre, facts }) => (
                <div key={nombre} style={{ background: '#130e0e', border: '1px solid #3a1a1a', borderRadius: 10, padding: '12px 16px', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#eb5757', fontFamily: "'Syne', sans-serif" }}>
                      {facts[0].nombre_original}
                    </span>
                    <span style={{ background: '#3a1010', border: '1px solid #5a2020', borderRadius: 5, padding: '2px 9px', fontSize: 11, fontWeight: 700, color: '#eb5757' }}>
                      {facts.length} facturas
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 8 }}>
                    {facts.map((d, i) => (
                      <div key={i} style={{ background: '#0e0a0a', border: '1px solid #2a1010', borderRadius: 8, padding: '8px 12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, color: '#7eb8f7', fontSize: 13 }}>
                            #{d.consecutivo}
                          </span>
                          <span style={{ fontSize: 11, color: '#3a2a2a' }}>{fmtDate(d.fecha)}</span>
                        </div>
                        <div style={{ fontSize: 11, color: '#5a3a3a', marginBottom: 2 }}>
                          CI: <span style={{ color: '#8a5a5a' }}>{d.cliente_ci || '—'}</span>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#f2c94c', marginTop: 4 }}>
                          ${d.total.toLocaleString('es-CU', { minimumFractionDigits: 2 })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Banner de numeración */}
      <BannerNumeracion facturas={todasFacturas} periodos={periodos} />

      {/* Filtros de período */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <button onClick={() => setFiltroPeriodo('')} style={btnStyle(!filtroPeriodo)}>
          Todos los períodos
        </button>
        {periodos.map(p => (
          <button key={p.id} onClick={() => setFiltroPeriodo(String(p.id))} style={btnStyle(filtroPeriodo === String(p.id))}>
            {p.nombre}
          </button>
        ))}
      </div>

      {/* Lista de facturas */}
      {loading ? <Spinner /> : (
        <>
          {(filtroPeriodo ? todasFacturas : facturas).map(f => (
            <div key={f.id}
              style={{ background: '#0e1117', border: '1px solid #1e2530', borderRadius: 12, padding: 20, marginBottom: 14, transition: 'border-color 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = '#2a3040'}
              onMouseLeave={e => e.currentTarget.style.borderColor = '#1e2530'}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                    <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 16, fontWeight: 800, color: '#7eb8f7' }}>
                      Factura #{f.consecutivo}
                    </span>
                    <Badge color="blue">{fmtDate(f.fecha)}</Badge>
                    {f.ref_transferencia && <Badge color="purple">Transf: {f.ref_transferencia}</Badge>}
                    {f.es_fusion && <Badge color="orange">🔀 Fusión</Badge>}
                  </div>
                  <div style={{ fontSize: 12, color: '#7dd3fc' }}>
                    Cliente: <span style={{ color: '#8899bb' }}>{f.cliente_nombre}</span>
                    {' · '}CI: <span style={{ color: '#8899bb' }}>{f.cliente_ci}</span>
                    {' · '}Vendedor: <span style={{ color: '#8899bb' }}>{f.vendedor_nombre}</span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, fontWeight: 800, color: '#6fcf97' }}>
                      ${fmt(f.total)}
                    </div>
                    <div style={{ fontSize: 11, color: '#ffffff' }}>
                      Ef: ${fmt(f.efectivo)} · Tr: ${fmt(f.total_transferencia)}
                    </div>
                  </div>

                  {/* Imprimir individual */}
                  <button
                    onClick={() => printFactura(f)}
                    style={{ background: '#1a2a3a', border: '1px solid #2a4060', borderRadius: 8, padding: '8px 14px', color: '#7eb8f7', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: 600 }}>
                    🖨 Imprimir
                  </button>

                  {/* Anular */}
                  {anulando === f.id ? (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <input
                        placeholder="Motivo de anulación (opcional)"
                        value={motivoAnulacion}
                        onChange={e => setMotivoAnulacion(e.target.value)}
                        style={{ background: '#0e1117', border: '1px solid #5a2a2a', borderRadius: 7, padding: '6px 10px', color: '#e8f0fe', fontSize: 12, fontFamily: 'inherit', outline: 'none', width: 200 }}
                        autoFocus
                      />
                      <Btn onClick={() => confirmarAnulacion(f.id, f.consecutivo)} variant="danger" small>Confirmar</Btn>
                      <Btn onClick={() => setAnulando(null)} small>Cancelar</Btn>
                    </div>
                  ) : (
                    <Btn onClick={() => iniciarAnulacion(f.id)} variant="danger" small>🗑️ Anular</Btn>
                  )}
                </div>
              </div>

              {/* Items */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
                {(f.items || []).filter(i => i && i.producto).map((item, j) => (
                  <div key={j} style={{ background: '#141920', border: '1px solid #1e2530', borderRadius: 8, padding: '10px 14px' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#e8f0fe', marginBottom: 2 }}>{item.producto}</div>
                    {item.num_piezas > 1 ? (
                      <>
                        <div style={{ fontSize: 12, color: '#eb8c34', fontWeight: 700, marginBottom: 2 }}>
                          {item.num_piezas} piezas · {fmt(item.cantidad)} {item.um} total
                        </div>
                        <div style={{ fontSize: 11, color: '#7dd3fc' }}>${fmt(item.precio)}/{item.um}</div>
                      </>
                    ) : (
                      <div style={{ fontSize: 11, color: '#7dd3fc' }}>{item.cantidad} {item.um} × ${fmt(item.precio)}</div>
                    )}
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#f2c94c', marginTop: 4 }}>${fmt(item.importe)}</div>
                  </div>
                ))}
              </div>

              {/* Detalle de transferencias fusionadas */}
              {f.es_fusion && (() => {
                let detalles;
                try { detalles = typeof f.detalle_transferencias === 'string' ? JSON.parse(f.detalle_transferencias) : f.detalle_transferencias; } catch { detalles = []; }
                if (!detalles || detalles.length < 2) return null;
                return (
                  <div style={{ marginTop: 10, padding: '8px 12px', background: '#0e1520', border: '1px dashed #2a4060', borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: '#5a7a9a', marginBottom: 6, fontWeight: 600 }}>TRANSFERENCIAS COMBINADAS</div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {detalles.map((t, i) => (
                        <div key={i} style={{ fontSize: 12, color: '#7eb8f7', background: '#141f2e', borderRadius: 6, padding: '4px 10px' }}>
                          <span style={{ color: '#5a7a9a' }}>Ref:</span> {t.ref || '—'} &nbsp;
                          <span style={{ color: '#6fcf97', fontWeight: 700 }}>${fmt(t.importe)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          ))}

          {(filtroPeriodo ? todasFacturas : facturas).length === 0 && (
            <div style={{ background: '#0e1117', border: '1px solid #1e2530', borderRadius: 12, padding: 48, textAlign: 'center', color: '#2a3a4a' }}>
              No hay facturas para mostrar. Use Distribución para generarlas.
            </div>
          )}

          {/* Paginación — solo cuando no hay período seleccionado */}
          {!filtroPeriodo && pagination.totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 20, padding: '14px 0' }}>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                style={{ background: page === 1 ? '#0e1117' : '#141920', border: '1px solid #1e2530', borderRadius: 8, padding: '7px 16px', color: page === 1 ? '#2a3a4a' : '#7eb8f7', cursor: page === 1 ? 'not-allowed' : 'pointer', fontSize: 13, fontFamily: 'inherit', fontWeight: 600 }}>
                « Anterior
              </button>
              <span style={{ color: '#7dd3fc', fontSize: 13 }}>
                Página <strong style={{ color: '#e8f0fe' }}>{page}</strong> de <strong style={{ color: '#e8f0fe' }}>{pagination.totalPages}</strong>
                <span style={{ marginLeft: 10, color: '#2a3a4a' }}>({pagination.total} facturas)</span>
              </span>
              <button
                onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                disabled={page === pagination.totalPages}
                style={{ background: page === pagination.totalPages ? '#0e1117' : '#141920', border: '1px solid #1e2530', borderRadius: 8, padding: '7px 16px', color: page === pagination.totalPages ? '#2a3a4a' : '#7eb8f7', cursor: page === pagination.totalPages ? 'not-allowed' : 'pointer', fontSize: 13, fontFamily: 'inherit', fontWeight: 600 }}>
                Siguiente »
              </button>
            </div>
          )}
        </>
      )}

      {/* Historial de anuladas */}
      <div style={{ marginTop: 32, borderTop: '1px solid #1e2530', paddingTop: 20 }}>
        <button
          onClick={() => setMostrarAnuladas(v => !v)}
          style={{ background: 'none', border: '1px solid #3a2a2a', borderRadius: 8, padding: '8px 16px', color: '#eb5757', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: 600 }}>
          {mostrarAnuladas ? '▲ Ocultar historial de anuladas' : '▼ Ver historial de anuladas'}
        </button>

        {mostrarAnuladas && (
          <div style={{ marginTop: 16 }}>
            <p style={{ color: '#7dd3fc', fontSize: 12, marginBottom: 12 }}>
              Las facturas anuladas mantienen su registro contable. El inventario fue revertido en el momento de la anulación.
            </p>
            {anuladas.length === 0 ? (
              <div style={{ color: '#2a3a4a', fontSize: 13, padding: '20px 0' }}>No hay facturas anuladas.</div>
            ) : anuladas.map(f => (
              <div key={f.id} style={{ background: '#130e0e', border: '1px solid #3a1a1a', borderRadius: 10, padding: '14px 18px', marginBottom: 10, opacity: 0.75 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 14, fontWeight: 700, color: '#eb5757' }}>Factura #{f.consecutivo}</span>
                    <span style={{ marginLeft: 12, color: '#5a3a3a', fontSize: 12 }}>{fmtDate(f.fecha)} — Cliente: {f.cliente_nombre || '—'}</span>
                    {f.anulada_motivo && <span style={{ marginLeft: 12, color: '#5a3a3a', fontSize: 12, fontStyle: 'italic' }}>Motivo: {f.anulada_motivo}</span>}
                  </div>
                  <div style={{ color: '#eb5757', fontWeight: 700, fontSize: 15 }}>${fmt(f.total)}</div>
                </div>
                {f.anulada_at && (
                  <div style={{ fontSize: 11, color: '#3a2a2a', marginTop: 4 }}>
                    Anulada el {new Date(f.anulada_at).toLocaleString('es-ES')}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}