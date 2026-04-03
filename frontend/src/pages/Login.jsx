import { useState, useEffect } from 'react';
import { api } from '../lib/api.js';

export default function Login({ onLogin }) {
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(false);
  const [showPass, setShowPass] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 80);
    return () => clearTimeout(t);
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!usuario || !password) {
      setError('Ingresa usuario y contraseña');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await api.login({ usuario, password });
      localStorage.setItem('token', data.token);
      localStorage.setItem('usuario', data.usuario);
      localStorage.setItem('role', data.role || 'admin');
      onLogin(data);
    } catch (err) {
      setError(err.message || 'Credenciales incorrectas');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Syne:wght@700;800&display=swap');

        .login-root {
          min-height: 100vh;
          background: #080b10;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'IBM Plex Mono', monospace;
          position: relative;
          overflow: hidden;
        }

        /* Grid background */
        .login-root::before {
          content: '';
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(37, 99, 235, 0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(37, 99, 235, 0.04) 1px, transparent 1px);
          background-size: 40px 40px;
          pointer-events: none;
        }

        /* Glow orb */
        .login-root::after {
          content: '';
          position: absolute;
          top: -180px;
          left: 50%;
          transform: translateX(-50%);
          width: 600px;
          height: 600px;
          background: radial-gradient(circle, rgba(37, 99, 235, 0.08) 0%, transparent 70%);
          pointer-events: none;
        }

        .login-card {
          position: relative;
          z-index: 1;
          width: 380px;
          opacity: 0;
          transform: translateY(18px);
          transition: opacity 0.45s ease, transform 0.45s ease;
        }
        .login-card.visible {
          opacity: 1;
          transform: translateY(0);
        }

        .login-header {
          margin-bottom: 36px;
          text-align: center;
        }

        .login-logo {
          font-family: 'Syne', sans-serif;
          font-size: 32px;
          font-weight: 800;
          color: #e8f0fe;
          letter-spacing: -0.5px;
          line-height: 1;
          margin-bottom: 8px;
        }
        .login-logo span {
          color: #2563eb;
        }

        .login-subtitle {
          font-size: 11px;
          color: #3a4a5a;
          letter-spacing: 2.5px;
          text-transform: uppercase;
        }

        .login-box {
          background: #0e1117;
          border: 1px solid #1e2530;
          border-radius: 14px;
          padding: 36px 32px;
          box-shadow:
            0 0 0 1px rgba(37, 99, 235, 0.06),
            0 24px 48px rgba(0, 0, 0, 0.5);
        }

        .field {
          margin-bottom: 18px;
        }

        .field-label {
          display: block;
          font-size: 10px;
          color: #4a5568;
          letter-spacing: 1.8px;
          text-transform: uppercase;
          margin-bottom: 8px;
        }

        .field-wrap {
          position: relative;
        }

        .field-input {
          width: 100%;
          background: #080b10;
          border: 1px solid #1e2530;
          border-radius: 8px;
          padding: 11px 14px;
          color: #e8f0fe;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 13px;
          outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
          box-sizing: border-box;
        }

        .field-input:focus {
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
        }

        .field-input::placeholder {
          color: #2a3040;
        }

        .field-input.has-toggle {
          padding-right: 44px;
        }

        .toggle-btn {
          position: absolute;
          right: 12px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          color: #3a4a5a;
          cursor: pointer;
          font-size: 14px;
          padding: 2px;
          line-height: 1;
          transition: color 0.15s;
        }
        .toggle-btn:hover { color: #8899bb; }

        .error-box {
          background: rgba(235, 87, 87, 0.08);
          border: 1px solid rgba(235, 87, 87, 0.25);
          border-radius: 8px;
          padding: 10px 14px;
          color: #eb5757;
          font-size: 12px;
          margin-bottom: 18px;
          display: flex;
          align-items: center;
          gap: 8px;
          animation: shake 0.3s ease;
        }

        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-4px); }
          60% { transform: translateX(4px); }
        }

        .submit-btn {
          width: 100%;
          background: #2563eb;
          border: none;
          border-radius: 8px;
          padding: 13px;
          color: #fff;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 1px;
          cursor: pointer;
          transition: background 0.2s, transform 0.15s, box-shadow 0.2s;
          margin-top: 6px;
          position: relative;
          overflow: hidden;
        }
        .submit-btn:hover:not(:disabled) {
          background: #1d4ed8;
          box-shadow: 0 0 20px rgba(37, 99, 235, 0.35);
          transform: translateY(-1px);
        }
        .submit-btn:active:not(:disabled) {
          transform: translateY(0);
        }
        .submit-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .spinner {
          display: inline-block;
          width: 13px;
          height: 13px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
          vertical-align: middle;
          margin-right: 8px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        .login-footer {
          text-align: center;
          margin-top: 24px;
          font-size: 10px;
          color: #1e2530;
          letter-spacing: 1px;
        }

        .divider {
          border: none;
          border-top: 1px solid #1e2530;
          margin: 24px 0;
        }

        .hint {
          font-size: 11px;
          color: #2a3040;
          text-align: center;
          margin-top: 14px;
          letter-spacing: 0.3px;
        }
      `}</style>

      <div className="login-root">
        <div className={`login-card ${visible ? 'visible' : ''}`}>

          <div className="login-header">
            <div className="login-logo">
              GestDist<span>Pro</span>
            </div>
            <div className="login-subtitle">Sistema de Distribución</div>
          </div>

          <div className="login-box">

            {error && (
              <div className="error-box">
                <span>⚠</span>
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} autoComplete="off">
              <div className="field">
                <label className="field-label" htmlFor="usuario">Usuario</label>
                <input
                  id="usuario"
                  className="field-input"
                  type="text"
                  placeholder="admin"
                  value={usuario}
                  onChange={e => setUsuario(e.target.value)}
                  autoFocus
                  autoComplete="username"
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="password">Contraseña</label>
                <div className="field-wrap">
                  <input
                    id="password"
                    className="field-input has-toggle"
                    type={showPass ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="toggle-btn"
                    onClick={() => setShowPass(v => !v)}
                    tabIndex={-1}
                    aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  >
                    {showPass ? '○' : '●'}
                  </button>
                </div>
              </div>

              <button className="submit-btn" type="submit" disabled={loading}>
                {loading ? (
                  <><span className="spinner" />Verificando...</>
                ) : (
                  'ENTRAR'
                )}
              </button>
            </form>

            <hr className="divider" />

            <div className="hint">
              Acceso restringido · Solo personal autorizado
            </div>
          </div>

          <div className="login-footer">
            GESTDIST PRO © {new Date().getFullYear()}
          </div>
        </div>
      </div>
    </>
  );
}
