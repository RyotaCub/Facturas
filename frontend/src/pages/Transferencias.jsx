import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api.js';
import { fmt, fmtDate, useDebounce } from '../lib/utils.js';
import { Badge, Input, Table, Tr, Td, Spinner, StatCard } from '../components/UI.jsx';
import { T as C } from '../lib/theme.js';
import { NOMBRES } from '../constants/nombres.js';

/* ══════════════════════════════════════════════════════════════════════════
   LÓGICA DE REPARACIÓN
   Dos comprobaciones por cada par de tokens:
   1. DICCIONARIO: si token+siguiente forma un nombre conocido → fusionar
   2. REGLA DE LONGITUD: fragmentos cortos por ancho de línea del PDF
══════════════════════════════════════════════════════════════════════════ */
const STOP = new Set(['DE', 'DEL', 'LA', 'LAS', 'LO', 'LOS', 'EL', 'E', 'MC', 'SANTA']);
const esInicial = t => /^[A-ZÁÉÍÓÚÑ]\.$/.test(t);
const intocable = (t, isFirst) => {
  if (t === 'Y') return !isFirst;
  return STOP.has(t) || esInicial(t);
};

function repararNombre(raw) {
  if (!raw || !raw.trim()) return raw;
  const tokens = raw.trim().toUpperCase().split(/\s+/);
  if (tokens.length < 2) return tokens[0];

  const out = [];
  let i = 0;
  while (i < tokens.length) {
    let word           = tokens[i];
    const prevOut      = out.length > 0 ? out[out.length - 1] : '';
    const afterStop    = STOP.has(prevOut) || (prevOut === 'Y' && out.length > 1);
    const likelyInit   = word.length === 1 && prevOut.length >= 5;
    const isFirst      = out.length === 0;

    if (!intocable(word, isFirst) && !afterStop && !likelyInit) {
      const next = i + 1 < tokens.length ? tokens[i + 1] : null;
      if (next) {
        const fused = word + next;
        const w = word.length, n = next.length;
        // Diccionario: override incluso si next es stop-word (ARI+EL→ARIEL, RAUD+EL→RAUDEL)
        const porDiccionario = NOMBRES.has(fused);
        // Longitud: solo si next NO es stop-word
        const porLongitud    = !intocable(next, false) && (w <= 2 || (w === 3 && n <= 6) || (w === 4 && n <= 3));
        if (porDiccionario || porLongitud) { i++; word = fused; }
      }
    } else if (!likelyInit) {
      // El token actual es stop-word o intocable, pero puede ser un fragmento si
      // la fusión con el siguiente forma un nombre conocido (LA+RITZA→LARITZA, DE+LIS→DELIS)
      const next = i + 1 < tokens.length ? tokens[i + 1] : null;
      if (next && NOMBRES.has(word + next)) { i++; word = word + next; }
    }
    out.push(word);
    i++;
  }
  return out.join(' ');
}

function esFragmentado(nombre) {
  if (!nombre || !nombre.trim()) return false;
  return repararNombre(nombre) !== nombre.trim().toUpperCase();
}


const btnSm = color => ({
  padding: '6px 14px', borderRadius: 7, fontFamily: 'inherit',
  fontSize: 12, cursor: 'pointer', fontWeight: 600,
  border: `1px solid ${color}55`, background: 'none', color,
});

/* ══════════════════════════════════════════════════════════════════════════
   MODAL DE REPARACIÓN
══════════════════════════════════════════════════════════════════════════ */
function RepararModal({ transferencias, onClose, onDone }) {
  const [items, setItems] = useState(() => {
    try {
      console.log('[Reparar] Total transferencias:', transferencias.length);
      // Agrupar por nombre original — un solo checkbox por nombre único
      const grupos = {};
      for (const t of transferencias) {
        if (!t.nombre || !esFragmentado(t.nombre)) continue;
        const key = t.nombre.trim().toUpperCase();
        if (!grupos[key]) {
          grupos[key] = { original: key, propuesto: repararNombre(t.nombre), ids: [], checked: true };
        }
        grupos[key].ids.push(t.id);
      }
      const candidatos = Object.values(grupos);
      console.log('[Reparar] Grupos únicos:', candidatos.length, '| Registros totales:', candidatos.reduce((s,g) => s + g.ids.length, 0));
      return candidatos;
    } catch (e) {
      console.error('[Reparar] ERROR calculando candidatos:', e);
      return [];
    }
  });

  const [fase, setFase]           = useState('preview');
  const [progreso, setProgreso]   = useState(0);
  const [total, setTotal]         = useState(0);
  const [resultado, setResultado] = useState({ ok: 0, err: 0 });

  const seleccionados  = items.filter(it => it.checked);
  const totalRegistros = seleccionados.reduce((s, it) => s + it.ids.length, 0);
  const toggleItem  = original => setItems(p => p.map(it => it.original === original ? { ...it, checked: !it.checked } : it));
  const toggleTodos = val      => setItems(p => p.map(it => ({ ...it, checked: val })));

  const aplicar = async () => {
    const sel = items.filter(it => it.checked);
    if (!sel.length) return;
    // Aplanar todos los ids a actualizar
    const tareas = sel.flatMap(it => it.ids.map(id => ({ id, propuesto: it.propuesto, original: it.original })));
    setTotal(tareas.length);
    setFase('saving');

    const updates = [];
    let ok = 0, err = 0;
    for (let idx = 0; idx < tareas.length; idx++) {
      const { id, propuesto, original } = tareas[idx];
      try {
        console.log('[Reparar] Guardando', id, original, '→', propuesto);
        const updated = await api.updateTransferencia(id, { nombre: propuesto });
        updates.push({ id, nombre: propuesto, updated });
        ok++;
      } catch (e) {
        console.error('[Reparar] Error id:', id, e);
        err++;
      }
      setProgreso(idx + 1);
    }
    setResultado({ ok, err });
    setFase('done');
    onDone(updates);
  };

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 99999,
        background: 'rgba(0,0,0,0.82)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: '#111827', border: '1px solid #374151', borderRadius: 16,
        width: '100%', maxWidth: 660, minHeight: 220, maxHeight: '88vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 32px 80px rgba(0,0,0,0.75)',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #374151', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#f0f6ff', fontFamily: "'Syne', sans-serif" }}>
              🔧 Reparar nombres fragmentados
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
              Nombres cortados por el ancho de línea del PDF del banco puede existir falsos positivos revisar las correciones
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#0b56eb', fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: '4px 8px' }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>

          {items.length === 0 && (
            <div style={{ padding: '40px 0', textAlign: 'center', color: C.muted }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>✅</div>
              <div style={{ fontSize: 14 }}>No se detectaron nombres fragmentados.</div>
            </div>
          )}

          {fase === 'done' && (
            <div style={{ padding: '40px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.green }}>
                {resultado.ok} nombre{resultado.ok !== 1 ? 's' : ''} reparado{resultado.ok !== 1 ? 's' : ''}
              </div>
              {resultado.err > 0 && <div style={{ fontSize: 13, color: C.red, marginTop: 6 }}>{resultado.err} errores</div>}
            </div>
          )}

          {fase === 'saving' && (
            <div style={{ padding: '30px 0' }}>
              <div style={{ fontSize: 13, color: C.muted, textAlign: 'center', marginBottom: 16 }}>
                Guardando {progreso} de {total}…
              </div>
              <div style={{ height: 8, background: '#1f2937', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', background: C.green, borderRadius: 99,
                  width: `${(progreso / total) * 100}%`, transition: 'width 0.25s ease',
                }} />
              </div>
            </div>
          )}

          {fase === 'preview' && items.length > 0 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <button onClick={() => toggleTodos(true)}  style={btnSm(C.accent)}>✓ Todos</button>
                <button onClick={() => toggleTodos(false)} style={btnSm(C.muted)}>Ninguno</button>
                <span style={{ fontSize: 11, color: C.muted, marginLeft: 'auto' }}>
                  {seleccionados.length} nombre{seleccionados.length !== 1 ? 's' : ''} únicos
                  · {totalRegistros} registro{totalRegistros !== 1 ? 's' : ''} a actualizar
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {items.map(it => (
                  <div
                    key={it.original}
                    onClick={() => toggleItem(it.original)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
                      border: `1px solid ${it.checked ? '#3b82f6' : '#374151'}`,
                      background: it.checked ? 'rgba(59,130,246,0.07)' : 'transparent',
                      transition: 'all 0.12s',
                    }}
                  >
                    <div style={{
                      width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                      border: `2px solid ${it.checked ? '#3b82f6' : '#6b7280'}`,
                      background: it.checked ? '#3b82f6' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {it.checked && <span style={{ color: '#fff', fontSize: 11 }}>✓</span>}
                    </div>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minWidth: 0 }}>
                      <span style={{ fontSize: 12, color: '#f87171', fontFamily: 'monospace', background: 'rgba(248,113,113,0.1)', borderRadius: 4, padding: '2px 8px', textDecoration: 'line-through' }}>
                        {it.original}
                      </span>
                      <span style={{ color: C.muted, fontSize: 13, flexShrink: 0 }}>→</span>
                      <span style={{ fontSize: 12, color: '#4ade80', fontFamily: 'monospace', background: 'rgba(74,222,128,0.1)', borderRadius: 4, padding: '2px 8px', fontWeight: 700 }}>
                        {it.propuesto}
                      </span>
                      {it.ids.length > 1 && (
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
                          background: 'rgba(126,184,247,0.15)', color: C.accent, flexShrink: 0,
                        }}>
                          ×{it.ids.length}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 20px', borderTop: '1px solid #374151', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, flexShrink: 0 }}>
          {(fase === 'done' || items.length === 0) ? (
            <button onClick={onClose} style={btnSm(C.accent)}>Cerrar</button>
          ) : fase === 'preview' ? (
            <>
              <button onClick={onClose} style={btnSm(C.muted)}>Cancelar</button>
              <button
                onClick={aplicar}
                disabled={totalRegistros === 0}
                style={{
                  padding: '9px 22px', borderRadius: 8, fontFamily: 'inherit',
                  fontWeight: 700, fontSize: 13,
                  cursor: totalRegistros === 0 ? 'not-allowed' : 'pointer',
                  border: `1px solid ${totalRegistros === 0 ? '#374151' : '#16a34a'}`,
                  background: totalRegistros === 0 ? 'none' : 'rgba(22,163,74,0.15)',
                  color: totalRegistros === 0 ? C.muted : C.green,
                  transition: 'all 0.15s',
                }}
              >
                ✓ Aplicar {totalRegistros > 0 ? `${totalRegistros} registro${totalRegistros !== 1 ? 's' : ''}` : ''}
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   CELDA DE NOMBRE EDITABLE
══════════════════════════════════════════════════════════════════════════ */
function NombreCell({ id, value, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value || '');
  const [saving, setSaving]   = useState(false);
  const [flash, setFlash]     = useState(null);
  const inputRef = useRef();

  useEffect(() => { if (!editing) setDraft(value || ''); }, [value, editing]);

  const startEdit = () => { setDraft(value || ''); setFlash(null); setEditing(true); setTimeout(() => inputRef.current?.select(), 30); };
  const cancel    = () => { setEditing(false); setDraft(value || ''); };

  const save = useCallback(async () => {
    const trimmed = draft.trim();
    if (trimmed === (value || '').trim()) { setEditing(false); return; }
    setSaving(true);
    try {
      const updated = await api.updateTransferencia(id, { nombre: trimmed || null });
      setFlash('ok'); setEditing(false); onSaved(updated);
      setTimeout(() => setFlash(null), 1800);
    } catch {
      setFlash('err');
      setTimeout(() => setFlash(null), 2000);
    } finally { setSaving(false); }
  }, [draft, value, id, onSaved]);

  const onKeyDown = e => {
    if (e.key === 'Enter')  { e.preventDefault(); save(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  };

  if (editing) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 180 }}>
      <input
        ref={inputRef} value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={save} onKeyDown={onKeyDown} disabled={saving}
        placeholder="Nombre del titular"
        style={{
          flex: 1, background: '#0a0e14', border: `1px solid ${C.accent}`, borderRadius: 6,
          color: C.text, fontSize: 12, padding: '4px 8px', fontFamily: 'inherit', outline: 'none', minWidth: 0,
        }}
      />
      {saving && <span style={{ fontSize: 12, color: C.muted }}>⏳</span>}
    </div>
  );

  const hasName = value && value.trim();
  return (
    <div
      onClick={startEdit}
      title="Click para editar nombre"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        cursor: 'pointer', borderRadius: 5, padding: '3px 6px',
        border: '1px solid transparent', transition: 'all 0.15s', maxWidth: 220,
      }}
      onMouseEnter={e => { e.currentTarget.style.border = `1px solid ${C.border}`; e.currentTarget.style.background = 'rgba(126,184,247,0.04)'; }}
      onMouseLeave={e => { e.currentTarget.style.border = '1px solid transparent'; e.currentTarget.style.background = 'transparent'; }}
    >
      {flash === 'ok'  && <span style={{ color: C.green, fontSize: 11 }}>✓</span>}
      {flash === 'err' && <span style={{ color: C.red,   fontSize: 11 }}>✗</span>}
      {hasName
        ? <span style={{ color: C.text,  fontSize: 12 }}>{value}</span>
        : <span style={{ color: C.muted, fontSize: 12, fontStyle: 'italic' }}>— editar</span>}
      <span style={{ color: C.muted, fontSize: 10, opacity: 0.5 }}>✎</span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   MODAL ELIMINAR — componente separado para no re-renderizar la tabla
══════════════════════════════════════════════════════════════════════════ */
function EliminarModal({ open, onClose, onDone, prefijos, initialFechaIni, initialFechaFin, initialPrefijo }) {
  const [elimFechaIni, setElimFechaIni] = useState(initialFechaIni || '');
  const [elimFechaFin, setElimFechaFin] = useState(initialFechaFin || '');
  const [elimPrefijo,  setElimPrefijo]  = useState(initialPrefijo  || '');
  const [eliminando,   setEliminando]   = useState(false);

  // Sincronizar valores iniciales cuando el modal se abre
  useEffect(() => {
    if (open) {
      setElimFechaIni(initialFechaIni || '');
      setElimFechaFin(initialFechaFin || '');
      setElimPrefijo(initialPrefijo   || '');
    }
  }, [open, initialFechaIni, initialFechaFin, initialPrefijo]);

  const confirmar = async () => {
    if (!elimFechaIni && !elimFechaFin && !elimPrefijo) return;
    const descripcion = [
      (elimFechaIni || elimFechaFin) ? `fechas: ${elimFechaIni || '…'} → ${elimFechaFin || '…'}` : null,
      elimPrefijo ? `prefijo: ${elimPrefijo}` : null,
    ].filter(Boolean).join(' + ');
    if (!confirm(`¿Eliminar las transferencias disponibles (no usadas) con ${descripcion}?\n\nEsta acción no se puede deshacer.`)) return;
    setEliminando(true);
    try {
      const body = {};
      if (elimFechaIni) body.fecha_inicio = elimFechaIni;
      if (elimFechaFin) body.fecha_fin    = elimFechaFin;
      if (elimPrefijo)  body.prefijo      = elimPrefijo;
      const res = await api.deleteTransferenciasBulk(body);
      alert(res.message);
      onClose();
      onDone();
    } catch (e) {
      alert('Error: ' + e.message);
    } finally {
      setEliminando(false);
    }
  };

  if (!open) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#0e1117', border: '1.5px solid #5a2a2a', borderRadius: 16, padding: 28, width: '100%', maxWidth: 460 }}>
        <h3 style={{ fontSize: 16, fontFamily: "'Syne', sans-serif", fontWeight: 800, color: C.red, marginBottom: 6 }}>
          🗑️ Eliminar transferencias
        </h3>
        <p style={{ fontSize: 12, color: C.muted, marginBottom: 20, lineHeight: 1.6 }}>
          Solo se eliminan las transferencias <strong style={{ color: '#e8f0fe' }}>no usadas</strong>. Las que ya fueron aplicadas a facturas no se tocan.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 }}>Desde</div>
            <input type="date" value={elimFechaIni} onChange={e => setElimFechaIni(e.target.value)}
              style={{ background: '#0a0e14', border: `1px solid ${C.border}`, borderRadius: 8, color: '#e8f0fe', padding: '8px 12px', fontSize: 13, fontFamily: 'inherit', width: '100%', outline: 'none' }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 }}>Hasta</div>
            <input type="date" value={elimFechaFin} onChange={e => setElimFechaFin(e.target.value)}
              style={{ background: '#0a0e14', border: `1px solid ${C.border}`, borderRadius: 8, color: '#e8f0fe', padding: '8px 12px', fontSize: 13, fontFamily: 'inherit', width: '100%', outline: 'none' }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 }}>Prefijo (opcional)</div>
            <select value={elimPrefijo} onChange={e => setElimPrefijo(e.target.value)}
              style={{ background: '#0a0e14', border: `1px solid ${C.border}`, borderRadius: 8, color: elimPrefijo ? '#e8f0fe' : C.muted, padding: '8px 12px', fontSize: 13, fontFamily: 'inherit', width: '100%', outline: 'none' }}>
              <option value="">— Todos los prefijos —</option>
              {prefijos.map(({ prefijo }) => (
                <option key={prefijo} value={prefijo}>{prefijo}</option>
              ))}
            </select>
          </div>
        </div>
        {!elimFechaIni && !elimFechaFin && !elimPrefijo && (
          <p style={{ fontSize: 11, color: '#f2994a', marginTop: 14 }}>⚠️ Debes indicar al menos un filtro antes de eliminar.</p>
        )}
        <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
          <button
            onClick={confirmar}
            disabled={eliminando || (!elimFechaIni && !elimFechaFin && !elimPrefijo)}
            style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid #7a2a2a', background: eliminando ? '#1a0a0a' : '#2a0e0e', color: eliminando ? '#5a3a3a' : C.red, cursor: eliminando ? 'not-allowed' : 'pointer', fontSize: 13, fontFamily: 'inherit', fontWeight: 700 }}>
            {eliminando ? '⏳ Eliminando...' : '🗑️ Confirmar eliminación'}
          </button>
          <button onClick={onClose} disabled={eliminando}
            style={{ padding: '10px 20px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'none', color: C.muted, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   PÁGINA PRINCIPAL
══════════════════════════════════════════════════════════════════════════ */
export default function Transferencias() {
  const [transferencias, setTransferencias] = useState([]);
  const [stats, setStats]           = useState(null);
  const [loading, setLoading]       = useState(true);
  const [filtro, setFiltro]         = useState({ tipo: 'CR', usada: '', search: '', prefijo: '' });
  const debouncedSearch             = useDebounce(filtro.search);
  const [prefijos, setPrefijos]     = useState([]); // [{prefijo, total}]
  const [modalAbierto, setModalAbierto] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin]       = useState('');
  const [rangoActivo, setRangoActivo] = useState(false);

  const [modalEliminar, setModalEliminar]   = useState(false);
  const [elimInitial, setElimInitial]       = useState({ fechaIni: '', fechaFin: '', prefijo: '' });

  // Estado para meses colapsados
  const [mesesColapsados, setMesesColapsados] = useState({});

  // Estado para selección de filas
  const [modoSeleccion, setModoSeleccion]     = useState(false);
  const [selectedIds, setSelectedIds]          = useState(new Set());
  const [eliminandoSel, setEliminandoSel]     = useState(false);
  const [pendienteConfirmar, setPendienteConfirmar] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const params = { page: 1, limit: 99999 };
    if (filtro.tipo)         params.tipo    = filtro.tipo;
    if (filtro.prefijo)      params.prefijo = filtro.prefijo;
    if (filtro.usada !== '') params.usada   = filtro.usada;
    if (rangoActivo && fechaInicio) params.fecha_inicio = fechaInicio;
    if (rangoActivo && fechaFin)    params.fecha_fin    = fechaFin;

    Promise.all([api.getTransferencias(params), api.getTransferenciasStats()])
      .then(([resp, st]) => {
        const lista = resp.data ?? resp;
        setTransferencias(lista);
        setTotalCount(resp.total ?? lista.length);
        setStats(st);
      })
      .catch(e => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [filtro.tipo, filtro.usada, filtro.prefijo, rangoActivo, fechaInicio, fechaFin]);

  // Cargar prefijos disponibles una sola vez al montar
  useEffect(() => {
    api.getTransferenciasPrefijos().then(setPrefijos).catch(e => toast.error(e.message));
  }, []);

  // Recargar cuando cambian filtros
  useEffect(load, [filtro.tipo, filtro.usada, filtro.prefijo, rangoActivo]);

  const aplicarRango = () => { if (!fechaInicio && !fechaFin) return; setRangoActivo(true); load(); };
  const limpiarRango = () => { setFechaInicio(''); setFechaFin(''); setRangoActivo(false); };

  const abrirModalEliminar = () => {
    // Pre-rellenar con los filtros activos si los hay
    setElimInitial({
      fechaIni: rangoActivo && fechaInicio ? fechaInicio : '',
      fechaFin: rangoActivo && fechaFin    ? fechaFin    : '',
      prefijo:  filtro.prefijo || '',
    });
    setModalEliminar(true);
  };

  const handleSaved = useCallback(updated =>
    setTransferencias(prev => prev.map(t => t.id === updated.id ? { ...t, nombre: updated.nombre, ci: updated.ci } : t))
  , []);

  const handleRepararDone = useCallback(updates => {
    setTransferencias(prev =>
      prev.map(t => {
        const u = updates.find(r => r.id === t.id);
        return u ? { ...t, nombre: u.nombre } : t;
      })
    );
  }, []);

  // Función para alternar el estado de un mes
  const toggleMes = (key) => {
    setMesesColapsados(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  // ── Helpers de selección ──────────────────────────────────────────────────
  const toggleSeleccion = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSeleccionMes = (items) => {
    const ids = items.filter(t => !t.usada).map(t => t.id);
    const todosSeleccionados = ids.every(id => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (todosSeleccionados) { ids.forEach(id => next.delete(id)); }
      else                    { ids.forEach(id => next.add(id)); }
      return next;
    });
  };

  const toggleSeleccionTodos = () => {
    const disponibles = filtered.filter(t => !t.usada).map(t => t.id);
    const todosSeleccionados = disponibles.every(id => selectedIds.has(id));
    if (todosSeleccionados) setSelectedIds(new Set());
    else                    setSelectedIds(new Set(disponibles));
  };

  const salirModoSeleccion = () => {
    setModoSeleccion(false);
    setSelectedIds(new Set());
    setPendienteConfirmar(false);
  };

  const pedirConfirmacionEliminar = () => {
    if (selectedIds.size === 0) return;
    setPendienteConfirmar(true);
  };

  const ejecutarEliminarSeleccion = async () => {
    if (selectedIds.size === 0) return;
    setPendienteConfirmar(false);
    setEliminandoSel(true);
    try {
      const res = await api.deleteTransferenciasByIds([...selectedIds]);
      alert(res.message);
      salirModoSeleccion();
      load();
    } catch (e) {
      alert('Error: ' + e.message);
    } finally {
      setEliminandoSel(false);
    }
  };

  const filtered = useMemo(() => transferencias.filter(t => {
    if (!debouncedSearch) return true;
    const q = debouncedSearch.toLowerCase();
    return (
      t.ref_origen?.toLowerCase().includes(q) ||
      t.prefijo?.toLowerCase().includes(q) ||
      t.nombre?.toLowerCase().includes(q) ||
      t.ci?.includes(debouncedSearch)
    );
  }), [transferencias, debouncedSearch]);

  const totalRangoCR = useMemo(() => filtered.filter(t => t.tipo === 'CR').reduce((s, t) => s + parseFloat(t.importe || 0), 0), [filtered]);
  const totalRangoDb = useMemo(() => filtered.filter(t => t.tipo === 'DB').reduce((s, t) => s + parseFloat(t.importe || 0), 0), [filtered]);

  // Agrupar por mes: [{ key: '2025-01', label: 'Enero 2025', items: [...] }]
  const MESES_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const mesesAgrupados = useMemo(() => {
    const map = {};
    for (const t of filtered) {
      const fecha = t.fecha ? String(t.fecha).slice(0, 10) : '';
      const key = fecha.slice(0, 7); // YYYY-MM
      if (!key) continue;
      if (!map[key]) {
        const [y, m] = key.split('-');
        map[key] = { key, label: `${MESES_ES[parseInt(m) - 1]} ${y}`, items: [] };
      }
      map[key].items.push(t);
    }
    return Object.values(map).sort((a, b) => a.key.localeCompare(b.key));
  }, [filtered]);

  const numFragmentados = transferencias.filter(t => t.nombre && esFragmentado(t.nombre)).length;

  const descargarCSV = () => {
    const cols = ['fecha','referencia','prefijo','tipo','importe','nombre','ci','estado'];
    const rows = filtered.map(t => [
      t.fecha ? String(t.fecha).slice(0, 10) : '',
      t.ref_origen || '',
      t.prefijo || '',
      t.tipo || '',
      t.importe || '0',
      t.nombre || '',
      t.ci || '',
      t.tipo === 'CR' ? (t.usada ? 'Usada' : 'Disponible') : 'N/A',
    ]);
    const csv = [cols, ...rows]
      .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    const desde = fechaInicio || (filtered[0]?.fecha ? String(filtered[0].fecha).slice(0,10) : 'todas');
    const hasta = fechaFin    || (filtered[filtered.length-1]?.fecha ? String(filtered[filtered.length-1].fecha).slice(0,10) : '');
    a.download = `transferencias_${desde}${hasta && hasta !== desde ? '_' + hasta : ''}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const inputStyle = {
    background: '#0e1117', border: '1px solid #1e2530', borderRadius: 8,
    padding: '7px 12px', color: '#e8f0fe', fontSize: 12, fontFamily: 'inherit',
    outline: 'none', colorScheme: 'dark',
  };

  const disponiblesEnVista = filtered.filter(t => !t.usada);
  const todosSeleccionados = disponiblesEnVista.length > 0 && disponiblesEnVista.every(t => selectedIds.has(t.id));
  const algunoSeleccionado = disponiblesEnVista.some(t => selectedIds.has(t.id));

  const HEADERS = [
    ...(modoSeleccion ? [{
      label: (
        <div
          onClick={toggleSeleccionTodos}
          title={todosSeleccionados ? 'Deseleccionar todos' : 'Seleccionar todos (disponibles)'}
          style={{
            width: 18, height: 18, borderRadius: 4, cursor: 'pointer', flexShrink: 0,
            border: `2px solid ${todosSeleccionados ? C.red : algunoSeleccionado ? '#f59e0b' : '#6b7280'}`,
            background: todosSeleccionados ? C.red : algunoSeleccionado ? 'rgba(245,158,11,0.2)' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto',
          }}
        >
          {(todosSeleccionados || algunoSeleccionado) && <span style={{ color: '#fff', fontSize: 11 }}>{todosSeleccionados ? '✓' : '–'}</span>}
        </div>
      ),
      align: 'center',
    }] : []),
    { label: 'Fecha' }, { label: 'Referencia' }, { label: 'Prefijo' },
    { label: 'Tipo' }, { label: 'Importe', align: 'right' },
    { label: 'Nombre ✎' }, { label: 'CI' }, { label: 'Estado' },
  ];

  return (
    <div className="fade-in">
      {modalAbierto && (
        <RepararModal
          transferencias={transferencias}
          onClose={() => setModalAbierto(false)}
          onDone={updates => { handleRepararDone(updates); setModalAbierto(false); }}
        />
      )}

      {/* Título + botón */}
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 26, fontFamily: "'Syne', sans-serif", fontWeight: 800, color: '#e8f0fe' }}>
            Transferencias BANDEC
          </h1>
          <p style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>
            Estado de cuenta importado — haz click en cualquier nombre para editarlo
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={descargarCSV}
            disabled={filtered.length === 0}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '9px 18px', borderRadius: 10, cursor: filtered.length === 0 ? 'not-allowed' : 'pointer',
              border: '1px solid rgba(86,207,225,0.4)',
              background: 'rgba(86,207,225,0.07)',
              color: '#56cfe1', fontFamily: 'inherit', fontWeight: 700, fontSize: 13,
              whiteSpace: 'nowrap', opacity: filtered.length === 0 ? 0.4 : 1,
            }}
            onMouseEnter={e => { if (filtered.length > 0) e.currentTarget.style.background = 'rgba(86,207,225,0.16)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(86,207,225,0.07)'; }}
          >
            ⬇ CSV
            <span style={{ background: '#56cfe1', color: '#0a0e14', borderRadius: 99, fontSize: 10, fontWeight: 900, padding: '2px 8px' }}>
              {filtered.length}
            </span>
          </button>

          {numFragmentados > 0 && (
          <button
            onClick={() => setModalAbierto(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '9px 18px', borderRadius: 10, cursor: 'pointer',
              border: 'rgba(242,201,76,0.4) 1px solid',
              background: 'rgba(242,201,76,0.08)',
              color: C.yellow, fontFamily: 'inherit', fontWeight: 700, fontSize: 13,
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(242,201,76,0.18)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(242,201,76,0.08)'; }}
          >
            🔧 Reparar nombres
            <span style={{ background: C.yellow, color: '#111', borderRadius: 99, fontSize: 10, fontWeight: 900, padding: '2px 8px' }}>
              {numFragmentados}
            </span>
          </button>
          )}
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 14, marginBottom: 24 }}>
          <StatCard label="CR Disponibles"  value={`$${fmt(stats.monto_disponible)}`} sub={`${stats.cr_disponibles} transferencias`} color={C.green} />
          <StatCard label="CR Usadas"       value={stats.cr_usadas}                   sub={`de ${stats.total_cr} CR total`}          color={C.red} />
          <StatCard label="Total Créditos"  value={`$${fmt(stats.monto_cr)}`}         sub={`${stats.total_cr} ops`}                  color={C.accent} />
          <StatCard label="Clientes Únicos" value={stats.clientes_unicos}             sub="Con CI registrado"                        color={C.purple} />
          <StatCard label="Período"         value={stats.fecha_fin ? fmtDate(stats.fecha_fin) : '—'} sub={fmtDate(stats.fecha_inicio)} color="#56cfe1" />
        </div>
      )}

      {/* Rango de fechas */}
      <div style={{ background: '#0e1117', border: `1px solid ${rangoActivo ? '#2563eb' : C.border}`, borderRadius: 12, padding: '14px 18px', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: C.muted, fontWeight: 700, whiteSpace: 'nowrap' }}>📅 Rango de fechas:</span>
        <input type="date" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)} style={inputStyle} />
        <span style={{ color: C.muted, fontSize: 12 }}>hasta</span>
        <input type="date" value={fechaFin}    onChange={e => setFechaFin(e.target.value)}    style={inputStyle} />
        <button onClick={aplicarRango} style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid #2563eb', background: '#1a2540', color: C.accent, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: 700 }}>
          Buscar
        </button>
        <button onClick={abrirModalEliminar} style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid #5a2a2a', background: '#1a0e0e', color: C.red, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: 700 }}>
          🗑️ Eliminar
        </button>
        <button
          onClick={() => { setModoSeleccion(m => !m); setSelectedIds(new Set()); }}
          style={{ padding: '7px 16px', borderRadius: 8, border: `1px solid ${modoSeleccion ? '#7c3aed' : C.border}`, background: modoSeleccion ? 'rgba(124,58,237,0.18)' : 'none', color: modoSeleccion ? '#a78bfa' : C.muted, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: 700 }}>
          {modoSeleccion ? '✕ Cancelar selección' : '☑ Seleccionar'}
        </button>
        {rangoActivo && (
          <>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', background: '#0a0e14', border: '1px solid #1a2540', borderRadius: 10, padding: '8px 16px', flexWrap: 'wrap' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8 }}>Créditos</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: C.green, fontFamily: "'Syne', sans-serif" }}>${fmt(totalRangoCR)}</div>
              </div>
              {filtro.tipo !== 'CR' && (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8 }}>Débitos</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: C.red, fontFamily: "'Syne', sans-serif" }}>${fmt(totalRangoDb)}</div>
                </div>
              )}
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8 }}>Operaciones</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: C.accent, fontFamily: "'Syne', sans-serif" }}>{filtered.length}</div>
              </div>
            </div>
            <span style={{ fontSize: 11, color: C.accent, background: '#1a2540', border: '1px solid #2563eb', borderRadius: 6, padding: '3px 10px' }}>
              {fechaInicio && fechaFin ? `${fmtDate(fechaInicio)} → ${fmtDate(fechaFin)}` : fechaInicio ? `Desde ${fmtDate(fechaInicio)}` : `Hasta ${fmtDate(fechaFin)}`}
            </span>
            <button onClick={limpiarRango} style={{ padding: '5px 12px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'none', color: C.muted, cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}>
              ✕ Limpiar
            </button>
          </>
        )}
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '0 0 auto' }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 }}>Tipo</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[['', 'Todos'], ['CR', 'Créditos'], ['DB', 'Débitos']].map(([v, l]) => (
              <button key={v} onClick={() => setFiltro(f => ({ ...f, tipo: v }))}
                style={{ padding: '8px 16px', borderRadius: 8, border: filtro.tipo === v ? '1px solid #2563eb' : `1px solid ${C.border}`, background: filtro.tipo === v ? '#1a2540' : 'none', color: filtro.tipo === v ? C.accent : C.muted, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: 600 }}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div style={{ flex: '0 0 auto' }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 }}>Estado</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[['', 'Todas'], ['false', 'Disponibles'], ['true', 'Usadas']].map(([v, l]) => (
              <button key={v} onClick={() => setFiltro(f => ({ ...f, usada: v }))}
                style={{ padding: '8px 16px', borderRadius: 8, border: filtro.usada === v ? '1px solid #2563eb' : `1px solid ${C.border}`, background: filtro.usada === v ? '#1a2540' : 'none', color: filtro.usada === v ? C.accent : C.muted, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: 600 }}>
                {l}
              </button>
            ))}
          </div>
        </div>
        {prefijos.length > 0 && (
          <div style={{ flex: '0 0 auto' }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 }}>Prefijo</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button
                onClick={() => setFiltro(f => ({ ...f, prefijo: '' }))}
                style={{ padding: '8px 14px', borderRadius: 8, border: filtro.prefijo === '' ? '1px solid #2563eb' : `1px solid ${C.border}`, background: filtro.prefijo === '' ? '#1a2540' : 'none', color: filtro.prefijo === '' ? C.accent : C.muted, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: 600 }}>
                Todos
              </button>
              {prefijos.map(({ prefijo, total }) => (
                <button
                  key={prefijo}
                  onClick={() => setFiltro(f => ({ ...f, prefijo: f.prefijo === prefijo ? '' : prefijo }))}
                  style={{ padding: '8px 14px', borderRadius: 8, border: filtro.prefijo === prefijo ? '1px solid #a78bfa' : `1px solid ${C.border}`, background: filtro.prefijo === prefijo ? 'rgba(167,139,250,0.12)' : 'none', color: filtro.prefijo === prefijo ? '#a78bfa' : C.muted, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {prefijo}
                  <span style={{ fontSize: 10, background: filtro.prefijo === prefijo ? 'rgba(167,139,250,0.25)' : 'rgba(255,255,255,0.06)', borderRadius: 99, padding: '1px 6px' }}>{total}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div style={{ flex: 1, minWidth: 200 }}>
          <Input placeholder="Buscar por referencia, nombre o CI..." value={filtro.search} onChange={v => setFiltro(f => ({ ...f, search: v }))} />
        </div>
      </div>

      {/* Leyenda */}
      <div style={{ marginBottom: 10, fontSize: 11, color: C.muted, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>✎ Click en cualquier nombre para editarlo ·</span>
        <kbd style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 3, padding: '1px 5px', fontSize: 10 }}>Enter</kbd>
        <span>guarda ·</span>
        <kbd style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 3, padding: '1px 5px', fontSize: 10 }}>Esc</kbd>
        <span>cancela · Click en cualquier mes para colapsar/expandir</span>
      </div>

      {/* Barra de acciones flotante cuando hay selección */}
      {modoSeleccion && selectedIds.size > 0 && (
        <div style={{
          position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)',
          zIndex: 500, display: 'flex', alignItems: 'center', gap: 14,
          background: pendienteConfirmar ? '#1a0a0a' : '#111827',
          border: `1.5px solid ${pendienteConfirmar ? C.red : '#7c3aed'}`,
          borderRadius: 14, padding: '12px 22px',
          boxShadow: pendienteConfirmar ? '0 8px 40px rgba(235,87,87,0.35)' : '0 8px 40px rgba(124,58,237,0.35)',
          transition: 'all 0.15s',
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: pendienteConfirmar ? C.red : '#a78bfa', fontFamily: "'Syne', sans-serif" }}>
            {pendienteConfirmar
              ? `⚠️ ¿Eliminar ${selectedIds.size} transferencia${selectedIds.size !== 1 ? 's' : ''}?`
              : `${selectedIds.size} seleccionada${selectedIds.size !== 1 ? 's' : ''}`}
          </span>
          {!pendienteConfirmar ? (
            <button
              onClick={pedirConfirmacionEliminar}
              disabled={eliminandoSel}
              style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid #7a2a2a', background: '#2a0e0e', color: C.red, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', fontWeight: 700 }}>
              🗑️ Eliminar seleccionadas
            </button>
          ) : (
            <>
              <button
                onClick={ejecutarEliminarSeleccion}
                disabled={eliminandoSel}
                style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid #7a2a2a', background: eliminandoSel ? '#1a0a0a' : '#3a0e0e', color: eliminandoSel ? '#5a3a3a' : C.red, cursor: eliminandoSel ? 'not-allowed' : 'pointer', fontSize: 13, fontFamily: 'inherit', fontWeight: 700 }}>
                {eliminandoSel ? '⏳ Eliminando...' : '✓ Confirmar'}
              </button>
              <button
                onClick={() => setPendienteConfirmar(false)}
                disabled={eliminandoSel}
                style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'none', color: C.muted, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
                No, cancelar
              </button>
            </>
          )}
          {!pendienteConfirmar && (
            <button
              onClick={salirModoSeleccion}
              style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'none', color: C.muted, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
              Cancelar
            </button>
          )}
        </div>
      )}

      {/* Tabla */}
      {loading ? <Spinner /> : (
        <div style={{ background: '#0e1117', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, fontSize: 12, color: C.muted, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span>
              {filtro.search
                ? `${filtered.length} resultado${filtered.length !== 1 ? 's' : ''} (filtro local)`
                : `${totalCount} transferencia${totalCount !== 1 ? 's' : ''} · ${mesesAgrupados.length} mes${mesesAgrupados.length !== 1 ? 'es' : ''}`}
              {rangoActivo && <span style={{ marginLeft: 12, color: C.green, fontWeight: 700 }}>· Total CR en rango: ${fmt(totalRangoCR)}</span>}
            </span>
          </div>
          <Table headers={HEADERS}>
            {mesesAgrupados.length === 0 && (
              <tr><td colSpan={8} style={{ padding: 40, textAlign: 'center', color: '#2a3a4a' }}>
                {rangoActivo ? 'No hay transferencias en ese rango de fechas.' : 'Sin resultados'}
              </td></tr>
            )}
            {mesesAgrupados.map(({ key, label, items }) => {
              const totalCR = items.filter(t => t.tipo === 'CR').reduce((s, t) => s + parseFloat(t.importe || 0), 0);
              const totalDB = items.filter(t => t.tipo === 'DB').reduce((s, t) => s + parseFloat(t.importe || 0), 0);
              const colapsado = mesesColapsados[key];
              const disponiblesMes = items.filter(t => !t.usada);
              const todosMesSeleccionados = disponiblesMes.length > 0 && disponiblesMes.every(t => selectedIds.has(t.id));
              const algunoMesSeleccionado = disponiblesMes.some(t => selectedIds.has(t.id));
              
              return (
                <React.Fragment key={key}>
                  {/* Separador de mes */}
                  <tr 
                    onClick={() => toggleMes(key)}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(126,184,247,0.05)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    {modoSeleccion && (
                      <td style={{ padding: '10px 10px', textAlign: 'center', width: 38, borderTop: '2px solid #1e2530' }}
                        onClick={e => { e.stopPropagation(); toggleSeleccionMes(items); }}>
                        {disponiblesMes.length > 0 && (
                          <div style={{
                            width: 16, height: 16, borderRadius: 3, cursor: 'pointer', margin: '0 auto',
                            border: `2px solid ${todosMesSeleccionados ? C.red : algunoMesSeleccionado ? '#f59e0b' : '#6b7280'}`,
                            background: todosMesSeleccionados ? C.red : algunoMesSeleccionado ? 'rgba(245,158,11,0.2)' : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            {(todosMesSeleccionados || algunoMesSeleccionado) && <span style={{ color: '#fff', fontSize: 10 }}>{todosMesSeleccionados ? '✓' : '–'}</span>}
                          </div>
                        )}
                      </td>
                    )}
                    <td colSpan={modoSeleccion ? 8 : 8} style={{
                      padding: '10px 16px',
                      background: 'linear-gradient(90deg, #0f1520 0%, #0a0e14 100%)',
                      borderTop: '2px solid #1e2530',
                      borderBottom: colapsado ? '2px solid #1e2530' : '1px solid #1e2530',
                      transition: 'all 0.15s',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                        <span style={{ 
                          fontSize: 13, 
                          fontWeight: 800, 
                          color: C.accent, 
                          fontFamily: "'Syne', sans-serif", 
                          letterSpacing: 0.5,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8
                        }}>
                          <span style={{ 
                            display: 'inline-block',
                            transform: colapsado ? 'rotate(-90deg)' : 'rotate(0deg)',
                            transition: 'transform 0.2s ease',
                            fontSize: 16,
                            color: C.muted
                          }}>
                            ▼
                          </span>
                          📅 {label}
                        </span>
                        <span style={{ fontSize: 11, color: '#3a4a5a' }}>
                          {items.length} op{items.length !== 1 ? 's' : ''}
                        </span>
                        {totalCR > 0 && (
                          <span style={{ fontSize: 11, color: C.green, background: 'rgba(111,207,151,0.1)', borderRadius: 6, padding: '2px 10px', fontWeight: 700 }}>
                            CR ${fmt(totalCR)}
                          </span>
                        )}
                        {totalDB > 0 && (
                          <span style={{ fontSize: 11, color: C.red, background: 'rgba(235,87,87,0.1)', borderRadius: 6, padding: '2px 10px', fontWeight: 700 }}>
                            DB ${fmt(totalDB)}
                          </span>
                        )}
                        {modoSeleccion && disponiblesMes.length > 0 && (
                          <span style={{ fontSize: 10, color: algunoMesSeleccionado ? '#a78bfa' : C.muted, background: algunoMesSeleccionado ? 'rgba(167,139,250,0.12)' : 'rgba(255,255,255,0.04)', borderRadius: 4, padding: '2px 8px' }}
                            onClick={e => { e.stopPropagation(); toggleSeleccionMes(items); }}>
                            {todosMesSeleccionados ? '✓ Mes seleccionado' : algunoMesSeleccionado ? `${disponiblesMes.filter(t => selectedIds.has(t.id)).length}/${disponiblesMes.length} selec.` : `Seleccionar mes (${disponiblesMes.length})`}
                          </span>
                        )}
                        {colapsado && (
                          <span style={{ 
                            fontSize: 10, 
                            color: C.muted, 
                            background: 'rgba(255,255,255,0.05)', 
                            borderRadius: 4, 
                            padding: '2px 8px',
                            marginLeft: 'auto'
                          }}>
                            {items.length} ocultas · click para expandir
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                  {/* Filas del mes - solo se muestran si no está colapsado */}
                  {!colapsado && items.map(t => {
                    const isSelected = selectedIds.has(t.id);
                    const esDisponible = !t.usada;
                    return (
                      <Tr key={t.id} style={modoSeleccion && isSelected ? { background: 'rgba(124,58,237,0.08)', outline: '1px solid rgba(124,58,237,0.25)' } : {}}>
                        {modoSeleccion && (
                          <td style={{ padding: '8px 10px', textAlign: 'center', width: 38 }}
                            onClick={() => esDisponible && toggleSeleccion(t.id)}>
                            <div style={{
                              width: 16, height: 16, borderRadius: 3, margin: '0 auto',
                              cursor: esDisponible ? 'pointer' : 'not-allowed',
                              border: `2px solid ${isSelected ? C.red : esDisponible ? '#6b7280' : '#2a3040'}`,
                              background: isSelected ? C.red : 'transparent',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              opacity: esDisponible ? 1 : 0.3,
                              transition: 'all 0.12s',
                            }}>
                              {isSelected && <span style={{ color: '#fff', fontSize: 10 }}>✓</span>}
                            </div>
                          </td>
                        )}
                        <Td color={C.muted}>{fmtDate(t.fecha)}</Td>
                        <Td color={C.accent}><strong>{t.ref_origen}</strong></Td>
                        <Td color="#8899bb">{t.prefijo}</Td>
                        <Td><Badge color={t.tipo === 'CR' ? 'green' : 'red'}>{t.tipo}</Badge></Td>
                        <Td align="right" color={t.tipo === 'CR' ? C.green : C.red}><strong>${fmt(t.importe)}</strong></Td>
                        <Td><NombreCell id={t.id} value={t.nombre} onSaved={handleSaved} /></Td>
                        <Td color={C.muted}>{t.ci || '—'}</Td>
                        <Td>
                          {t.tipo === 'CR'
                            ? <Badge color={t.usada ? 'gray' : 'green'}>{t.usada ? 'Usada' : 'Disponible'}</Badge>
                            : <Badge color="gray">N/A</Badge>}
                        </Td>
                      </Tr>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </Table>
        </div>
      )}

      {/* Modal eliminar transferencias — componente separado para evitar re-renders */}
      <EliminarModal
        open={modalEliminar}
        onClose={() => setModalEliminar(false)}
        onDone={load}
        prefijos={prefijos}
        initialFechaIni={elimInitial.fechaIni}
        initialFechaFin={elimInitial.fechaFin}
        initialPrefijo={elimInitial.prefijo}
      />
    </div>
  );
}