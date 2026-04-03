import { NavLink } from 'react-router-dom';

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

export default function Sidebar({ apiOk, usuario, role, onLogout }) {
  const NAV = role === 'viewer' ? NAV_VIEWER : NAV_ADMIN;
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
        <div style={{ fontSize: 10, color: '#3a4a5a', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 }}>Sistema</div>
        <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 800, color: '#e8f0fe', lineHeight: 1.1 }}>
          GestDist<br /><span style={{ color: '#2563eb', fontSize: 26 }}>Pro</span>
        </div>
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: apiOk ? '#6fcf97' : '#eb5757', boxShadow: apiOk ? '0 0 6px #6fcf97' : '0 0 6px #eb5757' }} />
          <span style={{ fontSize: 10, color: '#3a4a5a', letterSpacing: 0.5 }}>
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
              <span style={{ fontSize: 11, color: '#4a5a6a', fontWeight: 600 }}>{usuario}</span>
            </div>
            <button
              onClick={onLogout}
              title="Cerrar sesión"
              className="logout-btn"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3a4a5a', fontSize: 15, padding: '2px 4px', borderRadius: 4, transition: 'color 0.15s' }}
            >
              ⏻
            </button>
          </div>
        )}
        <div style={{ fontSize: 10, color: '#2a3a4a' }}>
          <div>BD: <span style={{ color: '#3a5a7a' }}>Prueba · PostgreSQL</span></div>
          <div style={{ marginTop: 2 }}>BANDEC · v1.0.0</div>
        </div>
      </div>
    </aside>
  );
}