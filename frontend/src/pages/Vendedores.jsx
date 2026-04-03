import { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';
import { Btn, Input, Spinner } from '../components/UI.jsx';
import { T as C } from '../lib/theme.js';

function EditModal({ vendedor, onClose, onSaved }) {
  const [form, setForm]   = useState({ nombre: vendedor.nombre, activo: vendedor.activo });
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const save = async () => {
    if (!form.nombre.trim()) { toast.error('El nombre no puede estar vacío'); return; }
    setSaving(true);
    try {
      const updated = await api.updateVendedor(vendedor.id, {
        nombre: form.nombre.trim(),
        activo: form.activo,
      });
      toast.success('Vendedor actualizado');
      onSaved(updated);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 20,
      }}
    >
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 14,
        padding: 28, width: '100%', maxWidth: 420,
        boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontFamily: "'Syne', sans-serif", fontWeight: 800, color: C.text, margin: 0 }}>
            Editar Vendedor
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 22, lineHeight: 1 }}>×</button>
        </div>

        {/* Nombre */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 11, color: C.muted, marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Nombre completo
          </label>
          <input
            ref={inputRef}
            value={form.nombre}
            onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onClose(); }}
            placeholder="ej. PEDRO GARCIA LOPEZ"
            className="input-base"
            style={{
              width: '100%', background: '#141920', border: `1px solid ${C.border}`,
              borderRadius: 8, padding: '10px 14px', color: C.text, fontSize: 14,
              fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Toggle activo */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: '#141920', border: `1px solid ${C.border}`, borderRadius: 10,
          padding: '12px 16px', marginBottom: 24,
        }}>
          <div>
            <div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>Estado</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
              {form.activo ? 'Activo — puede recibir facturas en la distribución' : 'Inactivo — no aparece en la distribución'}
            </div>
          </div>
          <button
            onClick={() => setForm(f => ({ ...f, activo: !f.activo }))}
            style={{
              width: 48, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer',
              background: form.activo ? C.green : C.muted,
              position: 'relative', transition: 'background 0.2s', flexShrink: 0,
            }}
          >
            <span style={{
              position: 'absolute', top: 3, left: form.activo ? 25 : 3,
              width: 20, height: 20, borderRadius: '50%', background: '#fff',
              transition: 'left 0.2s', display: 'block',
            }} />
          </button>
        </div>

        {/* Meta */}
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 24 }}>
          Registrado: {new Date(vendedor.created_at).toLocaleDateString('es-CU')}
        </div>

        {/* Botones */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 20px', color: C.muted, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', fontWeight: 600 }}>
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={saving}
            style={{
              background: saving ? '#1a2a3a' : '#1a3060', border: `1px solid ${saving ? C.border : '#2a50a0'}`,
              borderRadius: 8, padding: '9px 24px', color: saving ? C.muted : C.accent,
              cursor: saving ? 'not-allowed' : 'pointer', fontSize: 13,
              fontFamily: 'inherit', fontWeight: 700,
            }}>
            {saving ? 'Guardando...' : '✓ Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Vendedores() {
  const [vendedores, setVendedores] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [nombre, setNombre]         = useState('');
  const [saving, setSaving]         = useState(false);
  const [editando, setEditando]     = useState(null);

  const load = () => {
    setLoading(true);
    api.getVendedores()
      .then(setVendedores)
      .catch(e => toast.error(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleSaved = updated => {
    setVendedores(prev => prev.map(v => v.id === updated.id ? updated : v));
    setEditando(null);
  };

  const add = async () => {
    if (!nombre.trim()) { toast.error('Ingrese un nombre'); return; }
    setSaving(true);
    try {
      await api.createVendedor({ nombre });
      setNombre('');
      toast.success('Vendedor agregado');
      load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const del = async (id, nom) => {
    if (!confirm(`¿Eliminar a "${nom}"? Esta acción no se puede deshacer.`)) return;
    try {
      await api.deleteVendedor(id);
      toast.success('Vendedor eliminado');
      load();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const activos   = vendedores.filter(v => v.activo).length;
  const inactivos = vendedores.filter(v => !v.activo).length;

  return (
    <div className="fade-in">
      {editando && <EditModal vendedor={editando} onClose={() => setEditando(null)} onSaved={handleSaved} />}

      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, fontFamily: "'Syne', sans-serif", fontWeight: 800, color: C.text }}>Vendedores</h1>
        <p style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>Gestión del equipo de ventas</p>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 24 }}>
        {[
          { label: 'Total', value: vendedores.length, color: C.accent },
          { label: 'Activos', value: activos, color: C.green },
          { label: 'Inactivos', value: inactivos, color: C.muted },
        ].map(s => (
          <div key={s.label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 18px' }}>
            <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'Syne', sans-serif", color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Formulario agregar */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, marginBottom: 24 }}>
        <h3 style={{ fontSize: 14, color: C.accent, margin: '0 0 16px', fontFamily: "'Syne', sans-serif" }}>＋ Agregar Vendedor</h3>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <Input
              label="Nombre completo"
              value={nombre}
              onChange={setNombre}
              placeholder="ej. PEDRO GARCIA LOPEZ"
              onKeyDown={e => e.key === 'Enter' && add()}
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <Btn onClick={add} disabled={saving}>{saving ? 'Guardando...' : 'Agregar'}</Btn>
          </div>
        </div>
      </div>

      {/* Tabla */}
      {loading ? <Spinner /> : (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          {vendedores.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: '#2a3a4a' }}>No hay vendedores registrados</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  {['#', 'Nombre', 'Estado', 'Registro', 'Acciones'].map((h, i) => (
                    <th key={h} style={{
                      padding: '11px 16px', textAlign: i >= 3 ? 'right' : 'left',
                      fontSize: 11, color: C.muted, fontWeight: 600,
                      textTransform: 'uppercase', letterSpacing: '0.5px',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vendedores.map((v, i) => (
                  <tr
                    key={v.id}
                    className="tr-hover"
                    style={{ borderBottom: `1px solid ${C.border}`, opacity: v.activo ? 1 : 0.5 }}
                  >
                    <td style={{ padding: '13px 16px', color: C.muted, fontSize: 13, width: 40 }}>{i + 1}</td>
                    <td style={{ padding: '13px 16px' }}>
                      <strong style={{ color: C.text, fontSize: 14 }}>{v.nombre}</strong>
                    </td>
                    <td style={{ padding: '13px 16px' }}>
                      <span style={{
                        display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                        background: v.activo ? 'rgba(111,207,151,0.12)' : 'rgba(58,74,90,0.25)',
                        color: v.activo ? C.green : C.muted,
                        border: `1px solid ${v.activo ? 'rgba(111,207,151,0.3)' : 'rgba(58,74,90,0.4)'}`,
                      }}>
                        {v.activo ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td style={{ padding: '13px 16px', color: C.muted, fontSize: 12, textAlign: 'right' }}>
                      {new Date(v.created_at).toLocaleDateString('es-CU')}
                    </td>
                    <td style={{ padding: '13px 16px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => setEditando(v)}
                          className="btn-edit"
                          style={{ color: C.accent }}
                        >
                          ✏️ Editar
                        </button>
                        <button
                          onClick={() => del(v.id, v.nombre)}
                          className="btn-del"
                          style={{ color: C.red }}
                        >
                          🗑️ Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
