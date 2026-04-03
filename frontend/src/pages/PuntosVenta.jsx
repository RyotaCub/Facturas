import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';
import { fmt } from '../lib/utils.js';
import { Btn, Input, Alert, Card, Badge } from '../components/UI.jsx';

const CATEGORIA_OPTS = [
  { value: 'carnicos', label: 'Cárnicos', icon: '🥩', bg: '#2a1a0a', border: '#8a4a1a', color: '#f2994a' },
  { value: 'otros',   label: 'Otros',    icon: '📦', bg: '#0a1a2a', border: '#1a4a6a', color: '#7eb8f7' },
];

function CategoriaSelector({ selected, onChange, small = false }) {
  return (
    <div style={{ display: 'flex', gap: small ? 6 : 10, flexWrap: 'wrap' }}>
      {CATEGORIA_OPTS.map(opt => {
        const active = selected.includes(opt.value);
        return (
          <button key={opt.value} type="button"
            onClick={() => {
              const next = active
                ? selected.filter(x => x !== opt.value)
                : [...selected, opt.value];
              onChange(next.length ? next : ['otros']);
            }}
            style={{
              padding: small ? '4px 12px' : '9px 20px',
              borderRadius: small ? 6 : 9,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: small ? 11 : 13,
              fontWeight: 700,
              background: active ? opt.bg : '#0a0d12',
              border: `1.5px solid ${active ? opt.border : '#1e2530'}`,
              color: active ? opt.color : '#3a4a5a',
              transition: 'all 0.15s',
            }}>
            {opt.icon} {small ? opt.value.charAt(0).toUpperCase() + opt.value.slice(1) : opt.label}
          </button>
        );
      })}
    </div>
  );
}

export default function PuntosVenta() {
  const [puntosVenta, setPuntosVenta] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ nombre: '', porcentaje_asignado: 0, categorias: ['otros'] });
  const [editing, setEditing] = useState(null);
  const [totalPorcentaje, setTotalPorcentaje] = useState(0);

  const loadPuntosVenta = async () => {
    try {
      const data = await api.getPuntosVenta();
      setPuntosVenta(data);
      const total = data.filter(pv => pv.activo).reduce((sum, pv) => sum + (Number(pv.porcentaje_asignado) || 0), 0);
      setTotalPorcentaje(total);
    } catch (e) {
      toast.error('Error al cargar puntos de venta');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadPuntosVenta(); }, []);

  const crear = async () => {
    if (!form.nombre.trim()) {
      toast.error('El nombre es requerido');
      return;
    }
    try {
      await api.createPuntoVenta(form);
      toast.success('Punto de venta creado');
      setForm({ nombre: '', porcentaje_asignado: 0, categorias: ['otros'] });
      loadPuntosVenta();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const actualizar = async (id, updates) => {
    try {
      await api.updatePuntoVenta(id, updates);
      toast.success('Punto de venta actualizado');
      setEditing(null);
      loadPuntosVenta();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const eliminar = async (id, nombre) => {
    if (!confirm(`¿Eliminar el punto de venta "${nombre}"? Esta acción no se puede deshacer.`)) return;
    try {
      await api.deletePuntoVenta(id);
      toast.success('Punto de venta eliminado');
      loadPuntosVenta();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const toggleActivo = async (pv) => {
    await actualizar(pv.id, { activo: !pv.activo });
  };

  const puntosActivos    = useMemo(() => puntosVenta.filter(pv => pv.activo), [puntosVenta]);
  const porcentajeValido = useMemo(() => totalPorcentaje === 100, [totalPorcentaje]);
  const disponible       = useMemo(() => 100 - totalPorcentaje, [totalPorcentaje]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#3a4a5a' }}>Cargando...</div>;

  return (
    <div className="fade-in">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, fontFamily: "'Syne', sans-serif", fontWeight: 800, color: '#e8f0fe' }}>
          Puntos de Venta Minoristas
        </h1>
        <p style={{ color: '#3a4a5a', fontSize: 13, marginTop: 4 }}>
          Configura los puntos de venta y sus porcentajes de distribución
        </p>
      </div>

      {/* Alert de validación */}
      {!porcentajeValido && (
        <Alert type={totalPorcentaje > 100 ? 'error' : 'warning'} style={{ marginBottom: 20 }}>
          {totalPorcentaje > 100 
            ? `⚠️ El total de porcentajes excede el 100% (${totalPorcentaje}%). Ajusta los porcentajes.`
            : `⚠️ Porcentaje disponible: ${disponible}%. Los porcentajes deben sumar exactamente 100% para poder distribuir.`
          }
        </Alert>
      )}

      {porcentajeValido && (
        <Alert type="success" style={{ marginBottom: 20 }}>
          ✅ Configuración válida - Los porcentajes suman 100%
        </Alert>
      )}

      {/* Formulario de crear */}
      <Card style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 15, color: '#7eb8f7', marginBottom: 16, fontFamily: "'Syne', sans-serif" }}>
          Agregar Punto de Venta
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: 12, alignItems: 'end' }}>
          <Input 
            label="Nombre del punto de venta" 
            value={form.nombre} 
            onChange={v => setForm(p => ({ ...p, nombre: v }))}
            placeholder="ej. El Gustazo"
          />
          <Input 
            label={`Porcentaje (${disponible}% disponible)`}
            type="number" 
            min="0" 
            max={disponible}
            value={form.porcentaje_asignado} 
            onChange={v => setForm(p => ({ ...p, porcentaje_asignado: Math.min(Math.max(0, parseInt(v) || 0), disponible) }))}
          />
          <Btn onClick={crear} variant="primary" disabled={!form.nombre.trim() || form.porcentaje_asignado < 0}>
            ➕ Agregar
          </Btn>
        </div>
        {/* Categorías del nuevo PV */}
        <div style={{ marginTop: 14 }}>
          <label style={{ display: 'block', marginBottom: 8, fontSize: 11, color: '#8899bb', letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: 600 }}>
            Categorías que maneja este PV
          </label>
          <CategoriaSelector
            selected={form.categorias}
            onChange={cats => setForm(p => ({ ...p, categorias: cats }))}
          />
          <div style={{ marginTop: 6, fontSize: 11, color: '#3a4a5a' }}>
            Este PV solo recibirá productos de las categorías seleccionadas.
          </div>
        </div>
      </Card>

      {/* Lista de puntos de venta */}
      <Card>
        <h3 style={{ fontSize: 15, color: '#6fcf97', marginBottom: 16, fontFamily: "'Syne', sans-serif" }}>
          Puntos de Venta Configurados
        </h3>
        
        {puntosVenta.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#3a4a5a', padding: '40px 20px' }}>
            No hay puntos de venta configurados
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #1e2530' }}>
                  <th style={{ padding: '10px 12px', textAlign: 'left', color: '#3a4a5a', fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase' }}>
                    Nombre
                  </th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', color: '#3a4a5a', fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase' }}>
                    Porcentaje
                  </th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', color: '#3a4a5a', fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase' }}>
                    Categorías
                  </th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', color: '#3a4a5a', fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase' }}>
                    Estado
                  </th>
                  <th style={{ padding: '10px 12px', textAlign: 'right', color: '#3a4a5a', fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase' }}>
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody>
                {puntosVenta.map(pv => (
                  <tr key={pv.id} style={{ borderBottom: '1px solid #0e1117' }}>
                    <td style={{ padding: '11px 12px' }}>
                      {editing === pv.id ? (
                        <input 
                          type="text" 
                          defaultValue={pv.nombre}
                          onBlur={(e) => actualizar(pv.id, { nombre: e.target.value })}
                          style={{ 
                            background: '#1a2a3a', 
                            border: '1px solid #2a4060', 
                            borderRadius: 6, 
                            padding: '6px 10px', 
                            color: '#e8f0fe',
                            fontSize: 13,
                            width: '100%'
                          }}
                        />
                      ) : (
                        <div style={{ color: '#e8f0fe', fontWeight: 600 }}>{pv.nombre}</div>
                      )}
                    </td>
                    <td style={{ padding: '11px 12px', textAlign: 'center' }}>
                      {editing === pv.id ? (
                        <input 
                          type="number" 
                          min="0"
                          max="100"
                          defaultValue={pv.porcentaje_asignado}
                          onBlur={(e) => actualizar(pv.id, { porcentaje_asignado: parseInt(e.target.value) || 0 })}
                          style={{ 
                            background: '#1a2a3a', 
                            border: '1px solid #2a4060', 
                            borderRadius: 6, 
                            padding: '6px 10px', 
                            color: '#e8f0fe',
                            fontSize: 13,
                            width: 80,
                            textAlign: 'center'
                          }}
                        />
                      ) : (
                        <span style={{ color: '#f2c94c', fontWeight: 700, fontSize: 16 }}>
                          {pv.porcentaje_asignado}%
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '11px 12px' }}>
                      {editing === pv.id ? (
                        <CategoriaSelector
                          selected={pv.categorias || ['otros']}
                          onChange={cats => actualizar(pv.id, { categorias: cats })}
                          small
                        />
                      ) : (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {(pv.categorias || ['otros']).map(cat => {
                            const cfg = cat === 'carnicos'
                              ? { bg: '#2a1a0a', border: '#8a4a1a', color: '#f2994a', icon: '🥩' }
                              : { bg: '#0a1a2a', border: '#1a4a6a', color: '#7eb8f7', icon: '📦' };
                            return (
                              <span key={cat} style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color, borderRadius: 5, padding: '3px 9px', fontSize: 11, fontWeight: 700 }}>
                                {cfg.icon} {cat.charAt(0).toUpperCase() + cat.slice(1)}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '11px 12px', textAlign: 'center' }}>
                      <Badge color={pv.activo ? 'green' : 'gray'}>
                        {pv.activo ? 'Activo' : 'Inactivo'}
                      </Badge>
                    </td>
                    <td style={{ padding: '11px 12px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        {editing === pv.id ? (
                          <Btn onClick={() => setEditing(null)} variant="ghost" small>
                            ✓ Listo
                          </Btn>
                        ) : (
                          <Btn onClick={() => setEditing(pv.id)} variant="ghost" small>
                            ✏️ Editar
                          </Btn>
                        )}
                        <Btn 
                          onClick={() => toggleActivo(pv)} 
                          variant={pv.activo ? 'warning' : 'success'} 
                          small
                        >
                          {pv.activo ? '⏸️ Desactivar' : '▶️ Activar'}
                        </Btn>
                        <Btn onClick={() => eliminar(pv.id, pv.nombre)} variant="danger" small>
                          🗑️ Eliminar
                        </Btn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Resumen */}
        <div style={{ 
          marginTop: 20, 
          padding: '16px 20px', 
          background: '#1a2a3a', 
          borderRadius: 10, 
          border: `2px solid ${porcentajeValido ? '#6fcf97' : '#f2c94c'}`
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 11, color: '#3a4a5a', marginBottom: 4 }}>PUNTOS ACTIVOS</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#e8f0fe', fontFamily: "'Syne', sans-serif" }}>
                {puntosActivos.length}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#3a4a5a', marginBottom: 4 }}>PORCENTAJE ASIGNADO</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: porcentajeValido ? '#6fcf97' : '#f2c94c', fontFamily: "'Syne', sans-serif" }}>
                {totalPorcentaje}%
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#3a4a5a', marginBottom: 4 }}>DISPONIBLE</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: disponible === 0 ? '#6fcf97' : '#8899bb', fontFamily: "'Syne', sans-serif" }}>
                {disponible}%
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}