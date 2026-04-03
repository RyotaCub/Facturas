import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';
import { fmt, fmtDate } from '../lib/utils.js';
import { Badge, Spinner, StatCard, Table, Tr, Td } from '../components/UI.jsx';

// ─── Panel de resumen de productos de un período ───────────────────────────
function ResumenProductos({ periodo, onClose }) {
  const [data, setData]         = useState(null);
  const [loadingResumen, setLoadingResumen] = useState(true);
  const [tab, setTab]           = useState('todos'); // 'todos' | 'mayorista' | 'minorista'
  const [titulares, setTitulares] = useState([]);

  useEffect(() => {
    setLoadingResumen(true);

    // Cargar facturas mayoristas y resúmenes minoristas del período en paralelo
    // Fetch titulares BANDEC para el rango de fechas del período
    const fi = periodo.fecha_inicio ? periodo.fecha_inicio.split('T')[0] : '';
    const ff = periodo.fecha_fin    ? periodo.fecha_fin.split('T')[0]    : '';
    if (fi && ff) {
      api.getBandecTitulares(fi, ff)
        .then(d => setTitulares(d.titulares || []))
        .catch(() => setTitulares([]));
    }

    Promise.all([
      api.getFacturas({ periodo_id: periodo.id, page: 1, limit: 9999 }),
      api.getResumenesMinoristas({ periodo_id: periodo.id }),
    ])
      .then(([respFact, respRes]) => {
        const facturas  = respFact.data ?? respFact;
        const resumenes = respRes.data ?? respRes;

        // ── Productos mayoristas (de facturas) ────────────────────────
        const mapaMay = new Map();
        for (const f of facturas) {
          for (const item of (f.items || [])) {
            if (!item?.producto) continue;
            const key = item.codigo || item.producto;
            if (!mapaMay.has(key)) {
              mapaMay.set(key, {
                producto: item.producto,
                codigo:   item.codigo || '',
                um:       item.um     || '',
                cantidad: 0,
                importe:  0,
                facturas: 0,
              });
            }
            const g = mapaMay.get(key);
            g.cantidad += parseFloat(item.cantidad || 0);
            g.importe  += parseFloat(item.importe  || 0);
            g.facturas += 1;
          }
        }

        // ── Productos minoristas (de resúmenes) ───────────────────────
        const mapaMin = new Map();
        for (const r of resumenes) {
          for (const item of (r.items || r.productos || [])) {
            if (!item?.producto) continue;
            const key = item.codigo || item.producto;
            if (!mapaMin.has(key)) {
              mapaMin.set(key, {
                producto: item.producto,
                codigo:   item.codigo || '',
                um:       item.um     || '',
                cantidad: 0,
                importe:  0,
                resumenes: 0,
              });
            }
            const g = mapaMin.get(key);
            g.cantidad  += parseFloat(item.cantidad || 0);
            g.importe   += parseFloat(item.importe  || item.total || 0);
            g.resumenes += 1;
          }
        }

        // ── Combinar para tabla "todos" ────────────────────────────────
        const allKeys = new Set([...mapaMay.keys(), ...mapaMin.keys()]);
        const combinado = [...allKeys].map(key => {
          const m = mapaMay.get(key);
          const n = mapaMin.get(key);
          return {
            producto:        (m || n).producto,
            codigo:          (m || n).codigo,
            um:              (m || n).um,
            cant_may:        m?.cantidad || 0,
            imp_may:         m?.importe  || 0,
            cant_min:        n?.cantidad || 0,
            imp_min:         n?.importe  || 0,
            cant_total:      (m?.cantidad || 0) + (n?.cantidad || 0),
            imp_total:       (m?.importe  || 0) + (n?.importe  || 0),
          };
        }).sort((a, b) => b.imp_total - a.imp_total);

        // ── Transferencias almacén (mayorista) ───────────────────────────
        // Contar transferencias individuales desde transferencias_detalle
        let transfMayTotal = 0;
        let transfMayCount = 0;
        for (const f of facturas) {
          const detalle = f.transferencias_detalle || [];
          if (detalle.length > 0) {
            transfMayCount += detalle.length;
            transfMayTotal += detalle.reduce((s, t) => s + parseFloat(t.importe || 0), 0);
          }
        }

        // ── Transferencias PV (minorista) ─────────────────────────────────
        // Contar transferencias individuales desde transferencias_detalle de cada resumen
        let transfMinTotal = 0;
        let transfMinCount = 0;
        for (const r of resumenes) {
          const detalle = r.transferencias_detalle || [];
          if (detalle.length > 0) {
            transfMinCount += detalle.length;
            transfMinTotal += detalle.reduce((s, t) => s + parseFloat(t.importe || 0), 0);
          }
        }

        // ── Resumen por Punto de Venta (para impresión) ──────────────────
        const pvMap = new Map();
        // Almacén Central (mayorista)
        const almacenKey = 'Almacén Central';
        pvMap.set(almacenKey, {
          nombre: almacenKey,
          tipo: 'Mayorista',
          total: 0,
          efectivo: 0,
          totalTransf: 0,
          numTransf: 0,
          numDocs: 0,
        });
        for (const f of facturas) {
          const pv = pvMap.get(almacenKey);
          pv.total += parseFloat(f.total || 0);
          pv.efectivo += parseFloat(f.efectivo || 0);
          const detalle = f.transferencias_detalle || [];
          pv.totalTransf += detalle.reduce((s, t) => s + parseFloat(t.importe || 0), 0);
          pv.numTransf += detalle.length;
          pv.numDocs += 1;
        }
        // Puntos de venta minoristas
        for (const r of resumenes) {
          const pvNombre = r.punto_venta_nombre || r.punto_venta || 'Sin PV';
          if (!pvMap.has(pvNombre)) {
            pvMap.set(pvNombre, {
              nombre: pvNombre,
              tipo: 'Minorista',
              total: 0,
              efectivo: 0,
              totalTransf: 0,
              numTransf: 0,
              numDocs: 0,
            });
          }
          const pv = pvMap.get(pvNombre);
          pv.total += parseFloat(r.total || 0);
          pv.efectivo += parseFloat(r.efectivo || 0);
          const detalle = r.transferencias_detalle || [];
          pv.totalTransf += detalle.reduce((s, t) => s + parseFloat(t.importe || 0), 0);
          pv.numTransf += detalle.length;
          pv.numDocs += 1;
        }

        setData({
          mayorista: [...mapaMay.values()].sort((a, b) => b.importe - a.importe),
          minorista: [...mapaMin.values()].sort((a, b) => b.importe - a.importe),
          combinado,
          totalMay:       facturas.reduce((s, f) => s + parseFloat(f.total || 0), 0),
          totalMin:       resumenes.reduce((s, r) => s + parseFloat(r.total || 0), 0),
          numFact:        facturas.length,
          numRes:         resumenes.length,
          transfMayTotal,
          transfMayCount,
          transfMinTotal,
          transfMinCount,
          pvResumen: [...pvMap.values()],
        });
      })
      .catch(e => toast.error(e.message))
      .finally(() => setLoadingResumen(false));
  }, [periodo.id]);

  const tabStyle = (active) => ({
    padding: '7px 18px',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'inherit',
    fontWeight: 700,
    border: active ? '1px solid #2563eb' : '1px solid #1e2530',
    background: active ? '#1a2540' : 'none',
    color: active ? '#7eb8f7' : '#7dd3fc',
    transition: 'all 0.15s',
  });

  const rows = tab === 'mayorista'
    ? (data?.mayorista || [])
    : tab === 'minorista'
    ? (data?.minorista || [])
    : (data?.combinado || []);

  const handlePrint = () => {
    if (!data) return;
    const pvRows = data.pvResumen || [];
    const totalGeneral = pvRows.reduce((s, pv) => s + pv.total, 0);
    const totalEfectivo = pvRows.reduce((s, pv) => s + pv.efectivo, 0);
    const totalTransf = pvRows.reduce((s, pv) => s + pv.totalTransf, 0);
    const totalNumTransf = pvRows.reduce((s, pv) => s + pv.numTransf, 0);

    const pvTableRows = pvRows.map(pv => `
      <tr>
        <td><strong>${pv.nombre}</strong></td>
        <td class="tag ${pv.tipo === 'Mayorista' ? 'may' : 'min'}">${pv.tipo}</td>
        <td class="num">${pv.numDocs}</td>
        <td class="num">$${fmt(pv.efectivo)}</td>
        <td class="num">$${fmt(pv.totalTransf)}</td>
        <td class="num">${pv.numTransf}</td>
        <td class="num bold green">$${fmt(pv.total)}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html><html lang="es"><head>
      <meta charset="UTF-8">
      <title>Resumen — ${periodo.nombre}</title>
      <style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'Segoe UI',Arial,sans-serif;padding:20px;color:#111;font-size:12px}
        h1{font-size:18px;margin-bottom:4px}
        .sub{color:#555;font-size:11px;margin-bottom:16px}
        .stats{display:flex;gap:24px;margin-bottom:14px;padding:10px 0;border-top:1px solid #ccc;border-bottom:1px solid #ccc;flex-wrap:wrap}
        .stat label{font-size:10px;text-transform:uppercase;color:#888;letter-spacing:.5px}
        .stat .val{font-size:15px;font-weight:700;margin-top:2px}
        .transf{display:flex;gap:16px;margin-bottom:18px;padding:10px 0;border-bottom:1px solid #ccc}
        .transf-box{flex:1;background:#f8f8ff;border:1px solid #ccd;border-radius:6px;padding:8px 12px}
        .transf-box h3{font-size:10px;text-transform:uppercase;color:#558;letter-spacing:.5px;margin-bottom:6px}
        .transf-box .amount{font-size:14px;font-weight:700;color:#224488}
        .transf-box .count{font-size:11px;color:#668;margin-top:2px}
        .transf-box.min .amount{color:#664400}
        .transf-box.min{background:#fffcf0;border-color:#ddc}
        table{width:100%;border-collapse:collapse;margin-top:8px}
        th{background:#eee;padding:8px 10px;font-size:10px;text-align:left;border:1px solid #ccc;text-transform:uppercase;letter-spacing:.5px}
        th.num{text-align:right}
        td{border:1px solid #ddd;padding:7px 10px}
        td.num{text-align:right;font-variant-numeric:tabular-nums}
        td.bold{font-weight:700}
        td.green{color:#1a6a2a;font-weight:700}
        td.tag{font-size:10px;font-weight:700;text-align:center;letter-spacing:.5px}
        td.tag.may{background:#eef4ff;color:#2255aa}
        td.tag.min{background:#fffbee;color:#886600}
        tfoot td{font-weight:700;background:#f5f5f5;border-top:2px solid #999}
        .section-title{font-size:13px;font-weight:700;margin:18px 0 6px;padding-bottom:4px;border-bottom:1px solid #ddd}
        @page{margin:10mm;size:auto}
      </style>
    </head><body>
      <h1>Mulata Bonita — Resumen de Período</h1>
      <div class="sub">${periodo.nombre} · ${fmtDate(periodo.fecha_inicio)} — ${fmtDate(periodo.fecha_fin)} · ${periodo.pct_minorista}% minorista</div>
      <div class="stats">
        <div class="stat"><label>Mayorista</label><div class="val">$${fmt(data.totalMay)} <small style="font-size:10px;color:#888">(${data.numFact} facturas)</small></div></div>
        <div class="stat"><label>Minorista</label><div class="val">$${fmt(data.totalMin)} <small style="font-size:10px;color:#888">(${data.numRes} resúmenes)</small></div></div>
        <div class="stat"><label>Total</label><div class="val">$${fmt(data.totalMay + data.totalMin)}</div></div>
        <div class="stat"><label>Productos</label><div class="val">${data.combinado.length}</div></div>
      </div>
      <div class="transf">
        <div class="transf-box">
          <h3>Transferencias — Almacén (Mayorista)</h3>
          <div class="amount">$${fmt(data.transfMayTotal)}</div>
          <div class="count">${data.transfMayCount} transferencia${data.transfMayCount !== 1 ? 's' : ''}</div>
        </div>
        <div class="transf-box min">
          <h3>Transferencias — Puntos de Venta (Minorista)</h3>
          <div class="amount">$${fmt(data.transfMinTotal)}</div>
          <div class="count">${data.transfMinCount} transferencia${data.transfMinCount !== 1 ? 's' : ''}</div>
        </div>
      </div>
      <div class="section-title">Totales por Punto de Venta</div>
      <table>
        <thead>
          <tr>
            <th>Punto de Venta</th>
            <th>Tipo</th>
            <th class="num">Docs.</th>
            <th class="num">Efectivo</th>
            <th class="num">Transferencias $</th>
            <th class="num">Cant. Transf.</th>
            <th class="num">Total</th>
          </tr>
        </thead>
        <tbody>${pvTableRows}</tbody>
        <tfoot>
          <tr>
            <td colspan="2">TOTALES</td>
            <td class="num">${data.numFact + data.numRes}</td>
            <td class="num">$${fmt(totalEfectivo)}</td>
            <td class="num">$${fmt(totalTransf)}</td>
            <td class="num">${totalNumTransf}</td>
            <td class="num green">$${fmt(totalGeneral)}</td>
          </tr>
        </tfoot>
      </table>
    ${titulares.length > 0 ? `
      <div class="section-title">Transferencias BANDEC por Titular</div>
      <table>
        <thead>
          <tr>
            <th>Titular</th>
            <th class="num">Transferencias</th>
            <th class="num">Total $</th>
          </tr>
        </thead>
        <tbody>
          ${titulares.map(t => `
            <tr>
              <td><strong>${t.titular}</strong></td>
              <td class="num">${t.num_transferencias}</td>
              <td class="num bold green">$${fmt(t.total_importe)}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td>TOTAL</td>
            <td class="num">${titulares.reduce((s,t) => s + t.num_transferencias, 0)}</td>
            <td class="num green">$${fmt(titulares.reduce((s,t) => s + t.total_importe, 0))}</td>
          </tr>
        </tfoot>
      </table>` : ''}
    </body></html>`;

    const w = window.open('', '_blank', 'width=900,height=700');
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 300);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.75)',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      padding: '24px 16px',
      overflowY: 'auto',
    }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#0a0d12',
          border: '1px solid #1e2530',
          borderRadius: 16,
          width: '100%',
          maxWidth: 860,
          maxHeight: 'calc(100vh - 48px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          margin: 'auto',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px 14px',
          borderBottom: '1px solid #1e2530',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexShrink: 0,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3 }}>
              <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 19, fontWeight: 800, color: '#e8f0fe', margin: 0, whiteSpace: 'nowrap' }}>
                {periodo.nombre}
              </h2>
              <Badge color={periodo.estado === 'cerrado' ? 'gray' : periodo.estado === 'procesado' ? 'green' : 'yellow'}>
                {periodo.estado}
              </Badge>
            </div>
            <p style={{ color: '#7dd3fc', fontSize: 12, margin: 0 }}>
              {fmtDate(periodo.fecha_inicio)} — {fmtDate(periodo.fecha_fin)}
              {' · '}{periodo.pct_minorista}% minorista
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            {/* Botón imprimir */}
            <button
              onClick={handlePrint}
              disabled={!data}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: data ? '#1a2a3a' : '#0e1117',
                border: '1px solid #2a5080',
                borderRadius: 8, padding: '7px 14px',
                color: data ? '#7eb8f7' : '#2a3a4a',
                cursor: data ? 'pointer' : 'not-allowed',
                fontSize: 12, fontFamily: 'inherit', fontWeight: 700,
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { if (data) e.currentTarget.style.background = '#1e3248'; }}
              onMouseLeave={e => { if (data) e.currentTarget.style.background = '#1a2a3a'; }}
            >
              🖨 Imprimir
            </button>
            {/* Botón cerrar */}
            <button
              onClick={onClose}
              style={{
                background: 'none', border: '1px solid #2a3a4a', borderRadius: 8,
                padding: '7px 13px', color: '#6478a0', cursor: 'pointer',
                fontSize: 16, lineHeight: 1, fontFamily: 'inherit',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#eb5757'; e.currentTarget.style.color = '#eb5757'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a3a4a'; e.currentTarget.style.color = '#6478a0'; }}
            >✕</button>
          </div>
        </div>

        {loadingResumen ? (
          <div style={{ padding: 60, display: 'flex', justifyContent: 'center' }}>
            <Spinner />
          </div>
        ) : (
          <>
            {/* Stats rápidos */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 12,
              padding: '16px 20px',
              borderBottom: '1px solid #1e2530',
              flexShrink: 0,
            }}>
              {[
                { label: 'Mayorista',  value: `$${fmt(data.totalMay)}`, sub: `${data.numFact} facturas`,  color: '#7eb8f7' },
                { label: 'Minorista',  value: `$${fmt(data.totalMin)}`, sub: `${data.numRes} resúmenes`, color: '#f2c94c' },
                { label: 'Total',      value: `$${fmt(data.totalMay + data.totalMin)}`, sub: 'combinado', color: '#6fcf97' },
                { label: 'Productos',  value: data.combinado.length, sub: 'distintos',                   color: '#bb87fc' },
              ].map(s => (
                <div key={s.label} style={{
                  background: '#0e1117', border: '1px solid #1e2530',
                  borderRadius: 10, padding: '12px 14px',
                }}>
                  <div style={{ fontSize: 10, color: '#7dd3fc', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>
                    {s.label}
                  </div>
                  <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 18, fontWeight: 800, color: s.color }}>
                    {s.value}
                  </div>
                  <div style={{ fontSize: 11, color: '#2a3a4a', marginTop: 2 }}>{s.sub}</div>
                </div>
              ))}
            </div>

            {/* Bloque de transferencias */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
              padding: '14px 20px',
              borderBottom: '1px solid #1e2530',
              flexShrink: 0,
              background: 'rgba(90,60,160,0.04)',
            }}>
              {/* Almacén (mayorista) */}
              <div style={{
                background: '#0e1117', border: '1px solid #1a2a4a',
                borderRadius: 10, padding: '12px 16px',
                display: 'flex', alignItems: 'center', gap: 14,
              }}>
                <div style={{ fontSize: 22, flexShrink: 0 }}>🏦</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: '#7dd3fc', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4, fontWeight: 700 }}>
                    Transferencias — Almacén (Mayorista)
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 18, fontWeight: 800, color: '#7eb8f7' }}>
                      ${fmt(data.transfMayTotal)}
                    </span>
                    <span style={{
                      background: '#1a2a40', border: '1px solid #2a4060',
                      borderRadius: 6, padding: '2px 8px',
                      fontSize: 11, color: '#4a8abf', fontWeight: 700,
                    }}>
                      {data.transfMayCount} {data.transfMayCount === 1 ? 'transferencia' : 'transferencias'}
                    </span>
                  </div>
                </div>
              </div>

              {/* PV (minorista) */}
              <div style={{
                background: '#0e1117', border: '1px solid #2a1a4a',
                borderRadius: 10, padding: '12px 16px',
                display: 'flex', alignItems: 'center', gap: 14,
              }}>
                <div style={{ fontSize: 22, flexShrink: 0 }}>🏪</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: '#7dd3fc', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4, fontWeight: 700 }}>
                    Transferencias — Puntos de Venta (Minorista)
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 18, fontWeight: 800, color: '#f2c94c' }}>
                      ${fmt(data.transfMinTotal)}
                    </span>
                    <span style={{
                      background: '#2a1a40', border: '1px solid #4a2a60',
                      borderRadius: 6, padding: '2px 8px',
                      fontSize: 11, color: '#a060c0', fontWeight: 700,
                    }}>
                      {data.transfMinCount} {data.transfMinCount === 1 ? 'transferencia' : 'transferencias'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Titulares BANDEC */}
            {titulares.length > 0 && (
              <div style={{
                padding: '14px 20px',
                borderBottom: '1px solid #1e2530',
                flexShrink: 0,
              }}>
                <div style={{
                  fontSize: 10, color: '#7dd3fc', textTransform: 'uppercase',
                  letterSpacing: 0.8, fontWeight: 700, marginBottom: 10,
                }}>
                  🏦 Transferencias BANDEC por Titular
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #1e2530' }}>
                        <th style={{ padding: '6px 12px', textAlign: 'left', color: '#2a3a4a', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>Titular</th>
                        <th style={{ padding: '6px 12px', textAlign: 'right', color: '#2a3a4a', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>Transferencias</th>
                        <th style={{ padding: '6px 12px', textAlign: 'right', color: '#2a3a4a', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>Total $</th>
                      </tr>
                    </thead>
                    <tbody>
                      {titulares.map((t, i) => (
                        <tr key={i}
                          style={{ borderBottom: '1px solid #0e1117' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#0e1520'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          <td style={{ padding: '8px 12px', color: '#e8f0fe', fontWeight: 600 }}>
                            {t.titular}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            <span style={{
                              background: '#1a2a40', border: '1px solid #2a4060',
                              borderRadius: 5, padding: '2px 8px',
                              fontSize: 11, color: '#4a8abf', fontWeight: 700,
                            }}>
                              {t.num_transferencias}
                            </span>
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', color: '#6fcf97', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                            ${fmt(t.total_importe)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '2px solid #1e2530', background: '#0a0d12' }}>
                        <td style={{ padding: '8px 12px', color: '#7dd3fc', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                          TOTAL
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: '#4a8abf', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                          {titulares.reduce((s, t) => s + t.num_transferencias, 0)}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: '#6fcf97', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                          ${fmt(titulares.reduce((s, t) => s + t.total_importe, 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 8, padding: '12px 24px', borderBottom: '1px solid #1e2530', flexShrink: 0 }}>
              <button style={tabStyle(tab === 'todos')}      onClick={() => setTab('todos')}>
                📦 Todos ({data.combinado.length})
              </button>
              <button style={tabStyle(tab === 'mayorista')}  onClick={() => setTab('mayorista')}>
                🏭 Mayorista ({data.mayorista.length})
              </button>
              <button style={tabStyle(tab === 'minorista')}  onClick={() => setTab('minorista')}>
                🛒 Minorista ({data.minorista.length})
              </button>
            </div>

            {/* Tabla de productos */}
            <div style={{ overflowY: 'auto', flex: 1 ,  minHeight: 0}}>
              {rows.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#2a3a4a', fontSize: 13 }}>
                  No hay datos para mostrar en esta vista
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #1e2530', position: 'sticky', top: 0, background: '#0a0d12', zIndex: 1 }}>
                      <th style={thStyle('left')}>Producto</th>
                      <th style={thStyle('left')}>Código / UM</th>

                      {tab === 'todos' && <>
                        <th style={thStyle('right')}>Cant. May.</th>
                        <th style={thStyle('right')}>Importe May.</th>
                        <th style={thStyle('right')}>Cant. Min.</th>
                        <th style={thStyle('right')}>Importe Min.</th>
                        <th style={thStyle('right')}>Total Cant.</th>
                        <th style={thStyle('right')}>Total $</th>
                      </>}

                      {tab === 'mayorista' && <>
                        <th style={thStyle('right')}>Cantidad</th>
                        <th style={thStyle('right')}>Importe</th>
                        <th style={thStyle('right')}>Facturas</th>
                      </>}

                      {tab === 'minorista' && <>
                        <th style={thStyle('right')}>Cantidad</th>
                        <th style={thStyle('right')}>Importe</th>
                        <th style={thStyle('right')}>Resúmenes</th>
                      </>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((item, i) => (
                      <tr
                        key={i}
                        style={{
                          borderBottom: '1px solid #0e1117',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = '#0e1520'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <td style={{ padding: '10px 16px', color: '#e8f0fe', fontWeight: 600 }}>
                          {item.producto}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          {item.codigo && (
                            <span style={{ color: '#7dd3fc', marginRight: 6 }}>{item.codigo}</span>
                          )}
                          <span style={{ color: '#2a3a4a', fontSize: 11 }}>{item.um}</span>
                        </td>

                        {tab === 'todos' && <>
                          <td style={tdNum(item.cant_may > 0 ? '#7eb8f7' : '#1e2530')}>{item.cant_may > 0 ? fmt(item.cant_may) : '—'}</td>
                          <td style={tdNum(item.imp_may  > 0 ? '#7eb8f7' : '#1e2530')}>{item.imp_may  > 0 ? `$${fmt(item.imp_may)}` : '—'}</td>
                          <td style={tdNum(item.cant_min > 0 ? '#f2c94c' : '#1e2530')}>{item.cant_min > 0 ? fmt(item.cant_min) : '—'}</td>
                          <td style={tdNum(item.imp_min  > 0 ? '#f2c94c' : '#1e2530')}>{item.imp_min  > 0 ? `$${fmt(item.imp_min)}` : '—'}</td>
                          <td style={tdNum('#a0c0e0', true)}>{fmt(item.cant_total)}</td>
                          <td style={tdNum('#6fcf97', true)}>${fmt(item.imp_total)}</td>
                        </>}

                        {tab === 'mayorista' && <>
                          <td style={tdNum('#a0c0e0')}>{fmt(item.cantidad)}</td>
                          <td style={tdNum('#7eb8f7', true)}>${fmt(item.importe)}</td>
                          <td style={tdNum('#7dd3fc')}>{item.facturas}</td>
                        </>}

                        {tab === 'minorista' && <>
                          <td style={tdNum('#e0c080')}>{fmt(item.cantidad)}</td>
                          <td style={tdNum('#f2c94c', true)}>${fmt(item.importe)}</td>
                          <td style={tdNum('#7dd3fc')}>{item.resumenes}</td>
                        </>}
                      </tr>
                    ))}
                  </tbody>

                  {/* Totales */}
                  <tfoot>
                    <tr style={{ borderTop: '2px solid #1e2530', background: '#0a0d12' }}>
                      <td colSpan={2} style={{ padding: '10px 16px', color: '#7dd3fc', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                        TOTALES
                      </td>

                      {tab === 'todos' && <>
                        <td style={tdNum('#7eb8f7', true)}>{fmt(rows.reduce((s,r) => s + r.cant_may, 0))}</td>
                        <td style={tdNum('#7eb8f7', true)}>${fmt(rows.reduce((s,r) => s + r.imp_may,  0))}</td>
                        <td style={tdNum('#f2c94c', true)}>{fmt(rows.reduce((s,r) => s + r.cant_min, 0))}</td>
                        <td style={tdNum('#f2c94c', true)}>${fmt(rows.reduce((s,r) => s + r.imp_min,  0))}</td>
                        <td style={tdNum('#a0c0e0', true)}>{fmt(rows.reduce((s,r) => s + r.cant_total, 0))}</td>
                        <td style={tdNum('#6fcf97', true)}>${fmt(rows.reduce((s,r) => s + r.imp_total,  0))}</td>
                      </>}

                      {tab === 'mayorista' && <>
                        <td style={tdNum('#a0c0e0', true)}>{fmt(rows.reduce((s,r) => s + r.cantidad, 0))}</td>
                        <td style={tdNum('#7eb8f7', true)}>${fmt(rows.reduce((s,r) => s + r.importe,  0))}</td>
                        <td />
                      </>}

                      {tab === 'minorista' && <>
                        <td style={tdNum('#e0c080', true)}>{fmt(rows.reduce((s,r) => s + r.cantidad, 0))}</td>
                        <td style={tdNum('#f2c94c', true)}>${fmt(rows.reduce((s,r) => s + r.importe,  0))}</td>
                        <td />
                      </>}
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Helpers de estilo de tabla
const thStyle = (align) => ({
  padding: '8px 12px',
  textAlign: align,
  color: '#7dd3fc',
  fontSize: 10,
  letterSpacing: 0.8,
  textTransform: 'uppercase',
  fontWeight: 700,
});

const tdNum = (color, bold = false) => ({
  padding: '10px 12px',
  textAlign: 'right',
  color,
  fontWeight: bold ? 700 : 400,
  fontVariantNumeric: 'tabular-nums',
});

// ─── Componente principal ─────────────────────────────────────────────────────
export default function Periodos() {
  const [periodos, setPeriodos]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [periodoAbierto, setPeriodoAbierto] = useState(null);

  useEffect(() => {
    api.getPeriodos()
      .then(setPeriodos)
      .catch(e => toast.error(e.message))
      .finally(() => setLoading(false));
  }, []);

  const totalGeneral = periodos.reduce(
    (s, p) => s + parseFloat(p.total_mayorista || 0) + parseFloat(p.total_minorista || 0), 0
  );

  return (
    <div className="fade-in">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, fontFamily: "'Syne', sans-serif", fontWeight: 800, color: '#e8f0fe' }}>
          Períodos de Distribución
        </h1>
        <p style={{ color: '#7dd3fc', fontSize: 13, marginTop: 4 }}>
          Historial de todas las distribuciones realizadas · Haz click en una fila para ver el resumen de productos
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 24 }}>
        <StatCard label="Períodos Totales"  value={periodos.length} color="#56cfe1" />
        <StatCard label="Facturación Total" value={`$${fmt(totalGeneral)}`} sub="Mayorista + Minorista" color="#6fcf97" />
        <StatCard label="Total Facturas"    value={periodos.reduce((s, p) => s + parseInt(p.num_facturas || 0), 0)} sub="Comprobantes generados" color="#7eb8f7" />
      </div>

      {loading ? <Spinner /> : (
        <div style={{ background: '#0e1117', border: '1px solid #1e2530', borderRadius: 12, overflow: 'hidden' }}>
          <Table headers={['Período','Fechas','% Min','Facturas','Resúmenes','Mayorista','Minorista','Total','Estado']}>
            {periodos.map(p => (
              <Tr
                key={p.id}
                onClick={() => setPeriodoAbierto(p)}
                style={{ cursor: 'pointer' }}
              >
                <Td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#2a4a6a', fontSize: 11 }}>🔍</span>
                    <strong>{p.nombre}</strong>
                  </div>
                </Td>
                <Td color="#7dd3fc">{fmtDate(p.fecha_inicio)} — {fmtDate(p.fecha_fin)}</Td>
                <Td align="right">{p.pct_minorista}%</Td>
                <Td align="right" color="#7eb8f7">{p.num_facturas}</Td>
                <Td align="right" color="#f2c94c">{p.num_resumenes}</Td>
                <Td align="right" color="#7eb8f7">${fmt(p.total_mayorista)}</Td>
                <Td align="right" color="#f2c94c">${fmt(p.total_minorista)}</Td>
                <Td align="right" color="#6fcf97" bold>
                  ${fmt(parseFloat(p.total_mayorista || 0) + parseFloat(p.total_minorista || 0))}
                </Td>
                <Td>
                  <Badge color={p.estado === 'cerrado' ? 'gray' : p.estado === 'procesado' ? 'green' : 'yellow'}>
                    {p.estado}
                  </Badge>
                </Td>
              </Tr>
            ))}
            {periodos.length === 0 && (
              <tr>
                <td colSpan={9} style={{ padding: 40, textAlign: 'center', color: '#2a3a4a' }}>
                  No hay períodos registrados
                </td>
              </tr>
            )}
          </Table>
        </div>
      )}

      {/* Modal resumen */}
      {periodoAbierto && (
        <ResumenProductos
          periodo={periodoAbierto}
          onClose={() => setPeriodoAbierto(null)}
        />
      )}
    </div>
  );
}