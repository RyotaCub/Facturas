import { NavLink } from 'react-router-dom';
import { useState } from 'react';
import { api } from '../lib/api.js';
import toast from 'react-hot-toast';

const NAV_ADMIN = [
  {
    label: 'Principal',
    items: [
      { to: '/', label: 'Dashboard', icon: '⬡' },
    ]
  },
  {
    label: 'Gestión',
    items: [
      { to: '/productos', label: 'Productos', icon: '▤' },
      { to: '/transferencias', label: 'Transferencias', icon: '⇄' },
      { to: '/vendedores', label: 'Vendedores', icon: '◉' },
      { to: '/clientes',   label: 'Clientes',   icon: '👥' },
      { to: '/puntos-venta', label: 'Puntos de Venta', icon: '⬟' },
    ]
  },
  {
    label: 'Operaciones',
    items: [
      { to: '/distribucion', label: 'Distribución', icon: '⊕' },
      { to: '/facturas', label: 'Facturas', icon: '≡' },
      { to: '/resumenes', label: 'Resúmenes', icon: '◫' },
      { to: '/periodos', label: 'Períodos', icon: '◷' },
    ]
  },
  {
    label: 'Herramientas',
    items: [
      { to: '/bandec-converter', label: 'Convertidor PDF', icon: '⇌' },
    ]
  }
];

const NAV_VIEWER = [
  {
    label: 'Gestión',
    items: [
      { to: '/transferencias', label: 'Transferencias', icon: '⇄' },
    ]
  }
];

export default function Sidebar({ apiOk, usuario, role, onLogout, activeDb, onSwitchDb }) {
  const NAV = role === 'viewer' ? NAV_VIEWER : NAV_ADMIN;
  const [switching, setSwitching] = useState(false);

  async function handleSwitch() {
    const target = activeDb === 'prueba' ? 'real' : 'prueba';
    setSwitching(true);
    try {
      const data = await api.switchDb(target);
      onSwitchDb(data.db);
      toast.success(`BD cambiada a "${data.db}"`);
    } catch (err) {
      toast.error(err.message || 'Error al cambiar BD');
    } finally {
      setSwitching(false);
    }
  }
  return (
    <aside style={{
      width: 228, background: '#0a0d12',
      borderRight: '1px solid #1e2530',
      display: 'flex', flexDirection: 'column',
      position: 'fixed', height: '100vh', zIndex: 100,
      overflowY: 'auto',
    }}>
      {/* Logo */}
      <div style={{ padding: '28px 22px 22px', borderBottom: '1px solid #1e2530' }}>
        <div style={{ fontSize: 10, color: '#7dd3fc', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 }}>Sistema</div>
        <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 800, color: '#e8f0fe', lineHeight: 1.1 }}>
          GestDist<br /><span style={{ color: '#2563eb', fontSize: 26 }}>Pro</span>
        </div>
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: apiOk ? '#6fcf97' : '#eb5757', boxShadow: apiOk ? '0 0 6px #6fcf97' : '0 0 6px #eb5757' }} />
          <span style={{ fontSize: 10, color: '#7dd3fc', letterSpacing: 0.5 }}>
            {apiOk ? 'BD conectada' : 'BD desconectada'}
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '16px 10px' }}>
        {NAV.map(group => (
          <div key={group.label} style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 9, color: '#2a3a4a', letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 700, padding: '4px 12px 8px' }}>
              {group.label}
            </div>
            {group.items.map(item => (
              <NavLink key={item.to} to={item.to} end={item.to === '/'}
                className={({ isActive }) => 'nav-link-item' + (isActive ? ' active' : '')}
              >
                <span style={{ fontSize: 16, width: 20, textAlign: 'center' }}>{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div style={{ padding: '14px 22px', borderTop: '1px solid #1e2530' }}>
        {usuario && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#1a2540', border: '1px solid #2a3a5a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#7eb8f7' }}>
                {usuario.charAt(0).toUpperCase()}
              </div>
              <span style={{ fontSize: 11, color: '#7dd3fc', fontWeight: 600 }}>{usuario}</span>
            </div>
            <button
              onClick={onLogout}
              title="Cerrar sesión"
              className="logout-btn"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7dd3fc', fontSize: 15, padding: '2px 4px', borderRadius: 4, transition: 'color 0.15s' }}
            >
              ⏻
            </button>
          </div>
        )}
        {role === 'admin' && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 9, color: '#2a3a4a', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>Base de datos</div>
            <button
              onClick={handleSwitch}
              disabled={switching}
              style={{
                width: '100%', padding: '6px 10px', borderRadius: 6, border: 'none', cursor: switching ? 'default' : 'pointer',
                background: activeDb === 'real' ? '#1a3a1a' : '#1a2a3a',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                transition: 'background 0.2s', opacity: switching ? 0.6 : 1,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: activeDb === 'real' ? '#6fcf97' : '#f2c94c', display: 'inline-block' }} />
                <span style={{ fontSize: 11, color: activeDb === 'real' ? '#6fcf97' : '#f2c94c', fontWeight: 700 }}>
                  {activeDb === 'real' ? 'Real' : 'Prueba'}
                </span>
              </span>
              <span style={{ fontSize: 10, color: '#3a5a7a' }}>
                {switching ? '...' : `→ ${activeDb === 'real' ? 'Prueba' : 'Real'}`}
              </span>
            </button>
          </div>
        )}
        <div style={{ fontSize: 10, color: '#2a3a4a' }}>
          <div>BANDEC · v1.0.0</div>
        </div>
      </div>
    </aside>
  );
}