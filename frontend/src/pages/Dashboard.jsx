import { useState, useEffect, useMemo } from 'react';
import { api } from '../lib/api.js';
import { fmt, fmtDate } from '../lib/utils.js';
import { StatCard, Spinner, Card, Btn, Alert } from '../components/UI.jsx';
import toast from 'react-hot-toast';

// ── Modal de confirmación de reset ────────────────────────────────────────────
function ResetModal({ onConfirm, onCancel, resetting }) {
  const [fechaIni, setFechaIni] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [confirmText, setConfirmText] = useState('');

  const valid = fechaIni && fechaFin && fechaIni <= fechaFin && confirmText === 'RESETEAR';

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        background: '#0e1117', border: '1px solid #3a1a1a', borderRadius: 16,
        padding: 32, width: 460, maxWidth: '95vw',
      }}>
        <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, color: '#eb5757', marginBottom: 8 }}>
          🔄 Resetear Período
        </h2>
        <p style={{ color: '#3a4a5a', fontSize: 13, marginBottom: 24, lineHeight: 1.6 }}>
          Se eliminarán <strong style={{ color: '#e8f0fe' }}>todas las facturas, resúmenes y períodos</strong> dentro
          del rango seleccionado. Las transferencias quedarán libres y los productos se reactivarán.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#3a4a5a', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
              Fecha Inicio
            </label>
            <input
              type="date"
              value={fechaIni}
              onChange={e => setFechaIni(e.target.value)}
              style={{
                width: '100%', background: '#141920', border: '1px solid #2a3040',
                borderRadius: 8, padding: '9px 12px', color: '#e8f0fe',
                fontSize: 13, fontFamily: 'inherit', outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#3a4a5a', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
              Fecha Fin
            </label>
            <input
              type="date"
              value={fechaFin}
              onChange={e => setFechaFin(e.target.value)}
              style={{
                width: '100%', background: '#141920', border: '1px solid #2a3040',
                borderRadius: 8, padding: '9px 12px', color: '#e8f0fe',
                fontSize: 13, fontFamily: 'inherit', outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

        {fechaIni && fechaFin && fechaIni > fechaFin && (
          <p style={{ color: '#eb5757', fontSize: 12, marginBottom: 14 }}>
            ⚠ La fecha de inicio no puede ser mayor que la fecha fin.
          </p>
        )}

        <div style={{ marginBottom: 24 }}>
          <label style={{ display: 'block', fontSize: 11, color: '#3a4a5a', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
            Escribe <strong style={{ color: '#eb5757' }}>RESETEAR</strong> para confirmar
          </label>
          <input
            type="text"
            value={confirmText}
            onChange={e => setConfirmText(e.target.value)}
            placeholder="RESETEAR"
            autoFocus
            style={{
              width: '100%', background: '#141920',
              border: `1px solid ${confirmText === 'RESETEAR' ? '#6fcf97' : '#3a1a1a'}`,
              borderRadius: 8, padding: '9px 12px', color: '#e8f0fe',
              fontSize: 13, fontFamily: 'inherit', outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <Btn onClick={onCancel} disabled={resetting}>Cancelar</Btn>
          <Btn
            onClick={() => onConfirm(fechaIni, fechaFin)}
            variant="danger"
            disabled={!valid || resetting}
          >
            {resetting ? '⏳ Reseteando...' : '🔄 Confirmar Reset'}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function Dashboard() {
  const [stats, setStats]               = useState(null);
  const [productos, setProductos]       = useState([]);
  const [periodos, setPeriodos]         = useState([]);
  const [loading, setLoading]           = useState(true);
  const [resetting, setResetting]       = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);

  const loadData = () => {
    setLoading(true);
    Promise.all([
      api.getTransferenciasStats(),
      api.getProductos(),
      api.getPeriodos(),
    ]).then(([s, p, per]) => {
      setStats(s);
      setProductos(p);
      setPeriodos(per);
    }).catch(e => toast.error(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadData(); }, []);

  const handleConfirmReset = async (fechaIni, fechaFin) => {
    setResetting(true);
    try {
      const result = await api.resetSystem(fechaIni, fechaFin);
      const r = result.resumen;
      toast.success(
        `✅ Reset completado: ${r.periodosEliminados} período(s), ${r.facturasEliminadas} facturas, ${r.resumenesEliminados} resúmenes eliminados. Productos reactivados.`,
        { duration: 6000 }
      );
      setShowResetModal(false);
      setTimeout(loadData, 500);
    } catch (err) {
      toast.error(`Error al resetear: ${err.message}`);
    } finally {
      setResetting(false);
    }
  };

  const activos   = useMemo(() => productos.filter(p => p.estado === 'activo'),   [productos]);
  const sinFechas = useMemo(() => productos.filter(p => p.estado === 'sin_fechas'), [productos]);
  const totalDisp = useMemo(() => productos.reduce((s, p) => s + parseFloat(p.disponible_um_minorista || 0), 0), [productos]);

  if (loading) return <Spinner />;

  return (
    <div className="fade-in">
      {showResetModal && (
        <ResetModal
          onConfirm={handleConfirmReset}
          onCancel={() => setShowResetModal(false)}
          resetting={resetting}
        />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 28, fontFamily: "'Syne', sans-serif", fontWeight: 800, color: '#e8f0fe' }}>Dashboard</h1>
          <p style={{ color: '#3a4a5a', fontSize: 13, marginTop: 4 }}>{new Date().toLocaleDateString('es-CU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
        <Btn onClick={() => setShowResetModal(true)} variant="danger" disabled={resetting}>
          🔄 Resetear Sistema
        </Btn>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14, marginBottom: 28 }}>
        <StatCard label="Créditos Disponibles" value={`$${fmt(stats?.monto_disponible)}`} sub={`${stats?.cr_disponibles || 0} transferencias`} color="#6fcf97" icon="🏦" />
        <StatCard label="Total Créditos (CR)" value={`$${fmt(stats?.monto_cr)}`} sub={`${stats?.total_cr || 0} operaciones`} color="#7eb8f7" icon="↑" />
        <StatCard label="Productos Activos" value={activos.length} sub={`de ${productos.length} total`} color="#f2c94c" icon="▤" />
        <StatCard label="Disponibilidad Total" value={fmt(totalDisp)} sub="Unidades minoristas" color="#bb87fc" icon="◈" />
        <StatCard label="Períodos Procesados" value={periodos.length} sub="Distribuciones" color="#56cfe1" icon="◷" />
        <StatCard label="Sin Fechas" value={sinFechas.length} sub="Productos sin configurar" color="#eb5757" icon="⚠" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        {/* Últimos períodos */}
        <Card>
          <h3 style={{ fontSize: 14, color: '#7eb8f7', marginBottom: 16, fontFamily: "'Syne', sans-serif" }}>Últimos Períodos</h3>
          {periodos.length === 0 ? (
            <p style={{ color: '#3a4a5a', fontSize: 13 }}>No hay períodos procesados aún.</p>
          ) : (
            periodos.slice(0, 5).map(p => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #1e2530' }}>
                <div>
                  <div style={{ fontSize: 13, color: '#e8f0fe', fontWeight: 600 }}>{p.nombre}</div>
                  <div style={{ fontSize: 11, color: '#3a4a5a', marginTop: 2 }}>{fmtDate(p.fecha_inicio)} — {fmtDate(p.fecha_fin)}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 13, color: '#6fcf97', fontWeight: 700 }}>${fmt(parseFloat(p.total_mayorista || 0) + parseFloat(p.total_minorista || 0))}</div>
                  <div style={{ fontSize: 11, color: '#3a4a5a' }}>{p.num_facturas} fact · {p.num_resumenes} res</div>
                </div>
              </div>
            ))
          )}
        </Card>

        {/* Productos */}
        <Card>
          <h3 style={{ fontSize: 14, color: '#f2c94c', marginBottom: 16, fontFamily: "'Syne', sans-serif" }}>Productos Activos</h3>
          {activos.length === 0 ? (
            <p style={{ color: '#3a4a5a', fontSize: 13 }}>No hay productos activos.</p>
          ) : (
            activos.slice(0, 6).map(p => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid #1e2530' }}>
                <div>
                  <div style={{ fontSize: 13, color: '#e8f0fe', fontWeight: 600 }}>{p.producto}</div>
                  <div style={{ fontSize: 11, color: '#3a4a5a' }}>{p.codigo}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 13, color: '#6fcf97', fontWeight: 700 }}>{fmt(p.disponible_um_minorista)} {p.um_minorista}</div>
                  <div style={{ fontSize: 11, color: '#3a4a5a' }}>${fmt(p.importe)}/{p.um_minorista}</div>
                </div>
              </div>
            ))
          )}
        </Card>
      </div>

      {sinFechas.length > 0 && (
        <Card style={{ borderColor: '#3a2a1a' }}>
          <h3 style={{ fontSize: 13, color: '#f2c94c', marginBottom: 12 }}>⚠ Productos sin fechas ({sinFechas.length})</h3>
          <p style={{ color: '#3a4a5a', fontSize: 12, marginBottom: 12 }}>
            Estos productos no podrán usarse en distribuciones hasta que se configuren las fechas.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {sinFechas.map(p => (
              <span key={p.id} style={{ background: '#2a2a1a', border: '1px solid #3a3a2a', borderRadius: 6, padding: '4px 10px', fontSize: 12, color: '#f2c94c' }}>
                {p.codigo} — {p.producto}
              </span>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}