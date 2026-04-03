import { Routes, Route, Navigate } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Productos from './pages/Productos.jsx';
import Transferencias from './pages/Transferencias.jsx';
import Vendedores from './pages/Vendedores.jsx';
import PuntosVenta from './pages/PuntosVenta.jsx';
import Distribucion from './pages/Distribucion.jsx';
import Facturas from './pages/Facturas.jsx';
import Resumenes from './pages/Resumenes.jsx';
import Periodos from './pages/Periodos.jsx';
import BandecConverter from './pages/BandecConverter.jsx';
import Clientes from './pages/Clientes.jsx';
import Login from './pages/Login.jsx';
import { api } from './lib/api.js';

export default function App() {
  const [apiOk, setApiOk] = useState(false);
  const [user, setUser] = useState(() => {
    const token = localStorage.getItem('token');
    const usuario = localStorage.getItem('usuario');
    const role = localStorage.getItem('role') || 'admin';
    return token && usuario ? { token, usuario, role } : null;
  });

  useEffect(() => {
    const check = () => api.health().then(() => setApiOk(true)).catch(() => setApiOk(false));
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, []);

  // Redirige al login automáticamente cuando el token expira
  useEffect(() => {
    const onExpired = () => {
      localStorage.removeItem('token');
      localStorage.removeItem('usuario');
      localStorage.removeItem('role');
      setUser(null);
    };
    window.addEventListener('session-expired', onExpired);
    return () => window.removeEventListener('session-expired', onExpired);
  }, []);

  function handleLogin(data) {
    setUser(data);
  }

  function handleLogout() {
    localStorage.removeItem('token');
    localStorage.removeItem('usuario');
    localStorage.removeItem('role');
    setUser(null);
  }

  if (!user) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar apiOk={apiOk} usuario={user.usuario} role={user.role} onLogout={handleLogout} />
      <main style={{ flex: 1, marginLeft: 228, padding: '32px 40px', minHeight: '100vh', maxWidth: 'calc(100vw - 228px)' }}>
        {!apiOk && (
          <div style={{ background: '#2a1a1a', border: '1px solid #5a2a2a', borderRadius: 10, padding: '12px 18px', marginBottom: 20, color: '#eb5757', fontSize: 13, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>⚠</span>
            <span>No se puede conectar con el backend. Asegúrate de que el servidor esté corriendo en <strong>http://localhost:3001</strong> y que la BD PostgreSQL esté activa.</span>
          </div>
        )}
        <ErrorBoundary>
        <Routes>
          {user.role === 'viewer' ? (
            <>
              <Route path="/transferencias" element={<Transferencias />} />
              <Route path="*" element={<Navigate to="/transferencias" replace />} />
            </>
          ) : (
            <>
              <Route path="/" element={<Dashboard />} />
              <Route path="/productos" element={<Productos />} />
              <Route path="/transferencias" element={<Transferencias />} />
              <Route path="/vendedores" element={<Vendedores />} />
              <Route path="/puntos-venta" element={<PuntosVenta />} />
              <Route path="/distribucion" element={<Distribucion />} />
              <Route path="/facturas" element={<Facturas />} />
              <Route path="/resumenes" element={<Resumenes />} />
              <Route path="/periodos" element={<Periodos />} />
              <Route path="/clientes" element={<Clientes />} />
              <Route path="/bandec-converter" element={<BandecConverter />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </>
          )}
        </Routes>
        </ErrorBoundary>
      </main>
    </div>
  );
}