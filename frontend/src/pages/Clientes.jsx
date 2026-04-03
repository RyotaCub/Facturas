import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';
import { fmtDate, useDebounce } from '../lib/utils.js';
import { Badge, Btn, Input, Modal, Spinner } from '../components/UI.jsx';

const EMPTY = { nombre: '', ci: '' };

function normalize(str) {
  return str?.toLowerCase().replace(/\s+/g, ' ').trim() ?? '';
}

// Detecta nombres sospechosos: todo mayúscula incoherente, caracteres raros, muy cortos, etc.
function detectarProblema(nombre) {
  if (!nombre) return 'sin_nombre';
  const n = nombre.trim();
  if (n.length < 3)                                return 'muy_corto';
  if (/^\d+$/.test(n))                             return 'solo_numeros';
  if (/[<>{}|\\^~`]/.test(n))                     return 'caracteres_raros';
  if (/\s{2,}/.test(n))                            return 'espacios_extra';
  if (n !== n.toUpperCase() && n === n.toLowerCase()) return 'minusculas';
  return null;
}

const PROBLEMA_LABEL = {
  muy_corto:       { label: 'Muy corto',      color: '#f2c94c' },
  solo_numeros:    { label: 'Solo números',   color: '#eb5757' },
  caracteres_raros:{ label: 'Chars raros',    color: '#eb5757' },
  espacios_extra:  { label: 'Espacios extra', color: '#f2c94c' },
  minusculas:      { label: 'Minúsculas',     color: '#bb87fc' },
};

const FUENTE_COLOR = {
  transferencia: '#3a7fc1',
  manual:        '#6fcf97',
};

export default function Clientes() {
  const [clientes, setClientes]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [duplicados, setDuplicados] = useState({ mismoCI: [], ciDups: [] });
  const [search, setSearch]         = useState('');
  const debouncedSearch             = useDebounce(search);
  const [filtro, setFiltro]         = useState('todos');   // todos | problemas | duplicados
  const [showForm, setShowForm]     = useState(false);
  const [editing, setEditing]       = useState(null);
  const [form, setForm]             = useState(EMPTY);
  const [saving, setSaving]         = useState(false);
  const [syncing, setSyncing]       = useState(false);
  const [showDupsPanel, setShowDupsPanel] = useState(false);
  const [sortBy, setSortBy]         = useState('nombre');  // nombre | ci | facturas | transferencias

  const load = () => {
    setLoading(true);
    Promise.all([
      api.getClientesList(),
      api.getClientesDuplicados(),
    ])
      .then(([c, d]) => { setClientes(c); setDuplicados(d); })
      .catch(e => toast.error(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // ── Filtrado y ordenado ────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = normalize(debouncedSearch);
    return clientes
      .filter(c => {
        if (q && !normalize(c.nombre).includes(q) && !normalize(c.ci).includes(q)) return false;
        if (filtro === 'problemas') return !!detectarProblema(c.nombre);
        if (filtro === 'duplicados') {
          const cisDup = new Set(duplicados.mismoCI.map(d => d.ci));
          return cisDup.has(c.ci);
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'facturas')       return Number(b.total_facturas) - Number(a.total_facturas);
        if (sortBy === 'transferencias') return Number(b.total_transferencias) - Number(a.total_transferencias);
        if (sortBy === 'ci')             return a.ci.localeCompare(b.ci);
        return a.nombre.localeCompare(b.nombre);
      });
  }, [clientes, debouncedSearch, filtro, sortBy, duplicados]);

  const conProblemas = useMemo(() =>
    clientes.filter(c => detectarProblema(c.nombre)).length
  , [clientes]);

  // Set de CIs discrepantes para lookup O(1) en el render de la tabla
  const ciDiscrepantes = useMemo(() =>
    new Set(duplicados.mismoCI.map(d => d.ci))
  , [duplicados.mismoCI]);

  // ── Acciones ───────────────────────────────────────────────────
  const openNew  = () => { setForm(EMPTY); setEditing(null); setShowForm(true); };
  const openEdit = (c) => {
    setForm({ nombre: c.nombre, ci: c.ci });
    setEditing(c.id);
    setShowForm(true);
  };

  const save = async () => {
    if (!form.nombre.trim() || !form.ci.trim()) {
      toast.error('Nombre y CI son requeridos');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.updateCliente(editing, form);
        toast.success('Cliente actualizado');
      } else {
        await api.createCliente(form);
        toast.success('Cliente creado');
      }
      setShowForm(false);
      load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const del = async (c) => {
    if (!confirm(`¿Eliminar a "${c.nombre}" (CI: ${c.ci})? Esta acción no puede deshacerse.`)) return;
    try {
      await api.deleteCliente(c.id);
      toast.success('Cliente eliminado');
      load();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const syncClientes = async () => {
    setSyncing(true);
    try {
      const r = await api.syncClientes();
      toast.success(`Sincronización completa: ${r.insertados} nuevos clientes importados`);
      load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSyncing(false);
    }
  };

  // Aplicar corrección automática de nombre (Title Case)
  const fixNombre = async (c) => {
    const fixed = c.nombre
      .toLowerCase()
      .split(' ')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    try {
      await api.updateCliente(c.id, { nombre: fixed.toUpperCase(), ci: c.ci });
      toast.success('Nombre corregido');
      load();
    } catch (e) {
      toast.error(e.message);
    }
  };

  // ── Render ─────────────────────────────────────────────────────
  const thStyle = {
    padding: '9px 14px',
    textAlign: 'left',
    fontSize: 11,
    color: '#4a6a8a',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    userSelect: 'none',
  };

  const SortIcon = ({ col }) => sortBy === col
    ? <span style={{ color: '#7eb8f7', marginLeft: 4 }}>↓</span>
    : <span style={{ color: '#2a3a4a', marginLeft: 4 }}>⇅</span>;

  return (
    <div className="fade-in">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 26, fontFamily: "'Syne', sans-serif", fontWeight: 800, color: '#e8f0fe' }}>
            Clientes
          </h1>
          <p style={{ color: '#3a4a5a', fontSize: 13, marginTop: 4 }}>
            {clientes.length} registros
            {conProblemas > 0 && (
              <span style={{ marginLeft: 10, color: '#f2c94c', fontWeight: 600 }}>
                · ⚠ {conProblemas} con nombre sospechoso
              </span>
            )}
            {duplicados.mismoCI.length > 0 && (
              <span style={{ marginLeft: 10, color: '#eb5757', fontWeight: 600 }}>
                · ⚑ {duplicados.mismoCI.length} discrepancias de nombre
              </span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Btn onClick={syncClientes} variant="ghost" disabled={syncing}>
            {syncing ? '⟳ Sincronizando...' : '⟳ Sync desde Transferencias'}
          </Btn>
          {duplicados.mismoCI.length > 0 && (
            <Btn onClick={() => setShowDupsPanel(true)} variant="warning">
              ⚑ Ver {duplicados.mismoCI.length} discrepancias
            </Btn>
          )}
          <Btn onClick={openNew}>＋ Nuevo Cliente</Btn>
        </div>
      </div>

      {/* ── Filtros ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {[
          { key: 'todos',       label: `Todos (${clientes.length})` },
          { key: 'problemas',   label: `⚠ Problemas (${conProblemas})` },
          { key: 'duplicados',  label: `⚑ Discrepancias (${duplicados.mismoCI.length})` },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFiltro(f.key)}
            style={{
              background: filtro === f.key ? '#1a3a5c' : 'transparent',
              border: `1px solid ${filtro === f.key ? '#3a7fc1' : '#1e2530'}`,
              borderRadius: 8,
              padding: '6px 14px',
              color: filtro === f.key ? '#7eb8f7' : '#4a6a8a',
              fontSize: 12,
              fontWeight: filtro === f.key ? 700 : 400,
              cursor: 'pointer',
            }}
          >{f.label}</button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: '#4a6a8a' }}>Ordenar:</span>
          {[
            { key: 'nombre', label: 'Nombre' },
            { key: 'ci',     label: 'CI' },
            { key: 'facturas', label: 'Facturas' },
            { key: 'transferencias', label: 'Transferencias' },
          ].map(s => (
            <button
              key={s.key}
              onClick={() => setSortBy(s.key)}
              style={{
                background: sortBy === s.key ? '#1a2540' : 'transparent',
                border: `1px solid ${sortBy === s.key ? '#2a3a5a' : '#1e2530'}`,
                borderRadius: 6,
                padding: '4px 10px',
                color: sortBy === s.key ? '#7eb8f7' : '#4a6a8a',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >{s.label}</button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <Input placeholder="Buscar por nombre o CI..." value={search} onChange={setSearch} />
      </div>

      {/* ── Tabla ───────────────────────────────────────────────── */}
      {loading ? <Spinner /> : (
        <div style={{ background: '#0e1117', border: '1px solid #1e2530', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#0a0d12', borderBottom: '1px solid #1e2530' }}>
                <th style={thStyle} onClick={() => setSortBy('nombre')}>
                  Nombre <SortIcon col="nombre" />
                </th>
                <th style={thStyle} onClick={() => setSortBy('ci')}>
                  CI <SortIcon col="ci" />
                </th>
                <th style={{ ...thStyle, textAlign: 'right' }} onClick={() => setSortBy('transferencias')}>
                  Transf. <SortIcon col="transferencias" />
                </th>
                <th style={{ ...thStyle, textAlign: 'right' }} onClick={() => setSortBy('facturas')}>
                  Facturas <SortIcon col="facturas" />
                </th>
                <th style={thStyle}>Última actividad</th>
                <th style={thStyle}>Fuente</th>
                <th style={thStyle}>Estado</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: 40, textAlign: 'center', color: '#2a3a4a', fontSize: 13 }}>
                    {search ? 'Sin resultados para la búsqueda' : 'No hay clientes.'}
                  </td>
                </tr>
              )}
              {filtered.map((c, i) => {
                const problema = detectarProblema(c.nombre);
                const isDiscrepante = ciDiscrepantes.has(c.ci);
                const lastAct = c.ultima_factura || c.ultima_transferencia;
                return (
                  <tr
                    key={c.id}
                    style={{
                      borderBottom: i < filtered.length - 1 ? '1px solid #0d1218' : 'none',
                      background: problema ? 'rgba(242,201,76,0.03)' : isDiscrepante ? 'rgba(235,87,87,0.03)' : 'transparent',
                    }}
                  >
                    {/* Nombre */}
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: '#e8f0fe', fontWeight: 600, fontSize: 13 }}>
                          {c.nombre || <span style={{ color: '#3a4a5a', fontStyle: 'italic' }}>sin nombre</span>}
                        </span>
                        {problema && (
                          <span style={{
                            fontSize: 10, fontWeight: 700,
                            color: PROBLEMA_LABEL[problema].color,
                            background: `${PROBLEMA_LABEL[problema].color}18`,
                            borderRadius: 4, padding: '1px 6px',
                          }}>
                            {PROBLEMA_LABEL[problema].label}
                          </span>
                        )}
                        {isDiscrepante && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#eb5757', background: 'rgba(235,87,87,0.12)', borderRadius: 4, padding: '1px 6px' }}>
                            ⚑ discrepancia
                          </span>
                        )}
                      </div>
                    </td>

                    {/* CI */}
                    <td style={{ padding: '10px 14px', color: '#7eb8f7', fontFamily: 'monospace', fontSize: 13 }}>
                      {c.ci}
                    </td>

                    {/* Transferencias */}
                    <td style={{ padding: '10px 14px', textAlign: 'right', color: '#5a7a9a', fontSize: 13 }}>
                      {Number(c.total_transferencias) > 0
                        ? <span style={{ color: '#6fcf97', fontWeight: 600 }}>{c.total_transferencias}</span>
                        : <span style={{ color: '#2a3a4a' }}>—</span>
                      }
                    </td>

                    {/* Facturas */}
                    <td style={{ padding: '10px 14px', textAlign: 'right', color: '#5a7a9a', fontSize: 13 }}>
                      {Number(c.total_facturas) > 0
                        ? <span style={{ color: '#bb87fc', fontWeight: 600 }}>{c.total_facturas}</span>
                        : <span style={{ color: '#2a3a4a' }}>—</span>
                      }
                    </td>

                    {/* Última actividad */}
                    <td style={{ padding: '10px 14px', color: '#3a4a5a', fontSize: 12 }}>
                      {lastAct ? fmtDate(lastAct) : <span style={{ color: '#1e2530' }}>—</span>}
                    </td>

                    {/* Fuente */}
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700,
                        color: FUENTE_COLOR[c.fuente] || '#4a6a8a',
                        background: `${FUENTE_COLOR[c.fuente] || '#4a6a8a'}18`,
                        borderRadius: 4, padding: '2px 7px',
                        textTransform: 'uppercase',
                      }}>
                        {c.fuente || 'desconocida'}
                      </span>
                    </td>

                    {/* Estado */}
                    <td style={{ padding: '10px 14px' }}>
                      {Number(c.total_facturas) > 0
                        ? <Badge color="#bb87fc">Con facturas</Badge>
                        : Number(c.total_transferencias) > 0
                          ? <Badge color="#3a7fc1">Solo transf.</Badge>
                          : <Badge color="#3a4a5a">Sin actividad</Badge>
                      }
                    </td>

                    {/* Acciones */}
                    <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end' }}>
                        {problema === 'minusculas' && (
                          <Btn onClick={() => fixNombre(c)} variant="warning" small title="Corregir capitalización">
                            ✎ Fix
                          </Btn>
                        )}
                        <Btn onClick={() => openEdit(c)} variant="ghost" small>Editar</Btn>
                        <Btn onClick={() => del(c)} variant="danger" small>✕</Btn>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Footer de tabla */}
          {filtered.length > 0 && (
            <div style={{ padding: '10px 18px', borderTop: '1px solid #0d1218', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: '#2a3a4a' }}>
                Mostrando {filtered.length} de {clientes.length} clientes
              </span>
              {filtro === 'problemas' && conProblemas > 0 && (
                <span style={{ fontSize: 11, color: '#f2c94c' }}>
                  Haz clic en <strong>Editar</strong> para corregir el nombre manualmente
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Panel de Discrepancias ───────────────────────────────── */}
      {showDupsPanel && (
        <Modal title="⚑ Discrepancias de nombre — mismo CI" onClose={() => setShowDupsPanel(false)} width={760}>
          <p style={{ color: '#5a7a9a', fontSize: 12, marginBottom: 16 }}>
            Estos clientes tienen el mismo CI pero nombres distintos en la tabla de transferencias vs la tabla de clientes. Edita el cliente para unificar el nombre correcto.
          </p>
          <div style={{ background: '#0a0d12', borderRadius: 10, overflow: 'hidden', border: '1px solid #1e2530' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1e2530' }}>
                  {['CI', 'Nombre en Clientes', 'Nombre en Transferencias', 'Ocurrencias', ''].map(h => (
                    <th key={h} style={{ ...thStyle, background: '#080b0f' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {duplicados.mismoCI.map((d, i) => {
                  const cliente = clientes.find(c => c.ci === d.ci);
                  return (
                    <tr key={i} style={{ borderBottom: i < duplicados.mismoCI.length - 1 ? '1px solid #0d1218' : 'none' }}>
                      <td style={{ padding: '9px 14px', color: '#7eb8f7', fontFamily: 'monospace', fontSize: 12 }}>{d.ci}</td>
                      <td style={{ padding: '9px 14px', fontSize: 12, color: '#e8f0fe' }}>{d.nombre_clientes}</td>
                      <td style={{ padding: '9px 14px', fontSize: 12, color: '#f2c94c' }}>{d.nombre_transferencias}</td>
                      <td style={{ padding: '9px 14px', fontSize: 12, color: '#5a7a9a', textAlign: 'right' }}>{d.ocurrencias}</td>
                      <td style={{ padding: '9px 14px' }}>
                        {cliente && (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <Btn
                              small
                              variant="ghost"
                              onClick={() => { setShowDupsPanel(false); openEdit(cliente); }}
                            >
                              Editar
                            </Btn>
                            <Btn
                              small
                              variant="warning"
                              onClick={async () => {
                                try {
                                  await api.updateCliente(cliente.id, { nombre: d.nombre_transferencias, ci: cliente.ci });
                                  toast.success('Nombre actualizado al de las transferencias');
                                  load();
                                } catch (e) { toast.error(e.message); }
                              }}
                            >
                              Usar transf.
                            </Btn>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      {/* ── Modal Crear / Editar ─────────────────────────────────── */}
      {showForm && (
        <Modal
          title={editing ? 'Editar Cliente' : 'Nuevo Cliente'}
          onClose={() => setShowForm(false)}
          width={480}
        >
          <Input
            label="Nombre completo"
            value={form.nombre}
            onChange={v => setForm(p => ({ ...p, nombre: v }))}
            required
            placeholder="ej. GARCIA LOPEZ JUAN"
          />
          <Input
            label="Carnet de Identidad (CI)"
            value={form.ci}
            onChange={v => setForm(p => ({ ...p, ci: v }))}
            required
            placeholder="ej. 85012345678"
          />

          {/* Preview capitalización */}
          {form.nombre && (
            <div style={{ background: '#080b0f', border: '1px solid #1e2530', borderRadius: 8, padding: '10px 14px', marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: '#4a6a8a', marginBottom: 4, textTransform: 'uppercase', fontWeight: 700 }}>
                Se guardará como:
              </div>
              <div style={{ color: '#e8f0fe', fontSize: 14, fontWeight: 600 }}>
                {form.nombre.trim().toUpperCase()}
              </div>
            </div>
          )}

          {editing && (
            <div style={{ background: 'rgba(235,87,87,0.06)', border: '1px solid rgba(235,87,87,0.2)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: '#eb5757' }}>
              ⚠ Cambiar el nombre o CI aquí actualizará también las transferencias y facturas asociadas.
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
            <Btn onClick={() => setShowForm(false)} variant="ghost">Cancelar</Btn>
            <Btn onClick={save} variant="success" disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar'}
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}