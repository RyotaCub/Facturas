import React from 'react';
import { COLORS } from '../lib/utils.js';

// ── Badge ──────────────────────────────────────────────────
export const Badge = React.memo(function Badge({ children, color = 'blue' }) {
  const c = COLORS[color] || COLORS.blue;
  return (
    <span style={{
      background: c.bg, color: c.text, border: `1px solid ${c.border}`,
      padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
      letterSpacing: 0.6, textTransform: 'uppercase', whiteSpace: 'nowrap'
    }}>
      {children}
    </span>
  );
});

// ── Button ─────────────────────────────────────────────────
const BTN_VARIANTS = {
  primary: { background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: '#fff', border: 'none' },
  success: { background: 'linear-gradient(135deg,#16a34a,#15803d)', color: '#fff', border: 'none' },
  danger:  { background: 'none', color: '#eb5757', border: '1px solid #eb5757' },
  ghost:   { background: 'none', color: '#8899bb', border: '1px solid #2a3040' },
  warning: { background: 'linear-gradient(135deg,#d97706,#b45309)', color: '#fff', border: 'none' },
  purple:  { background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', color: '#fff', border: 'none' },
};

export const Btn = React.memo(function Btn({ children, onClick, variant = 'primary', icon: Icon, small, disabled, type = 'button', style = {} }) {
  const s = BTN_VARIANTS[variant] || BTN_VARIANTS.primary;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="btn-base"
      style={{
        ...s,
        padding: small ? '6px 14px' : '10px 20px',
        borderRadius: 8,
        fontSize: small ? 12 : 13,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        opacity: disabled ? 0.5 : 1,
        fontFamily: 'inherit',
        transition: 'opacity 0.15s, transform 0.1s',
        ...style,
      }}
    >
      {Icon && <Icon size={small ? 14 : 16} />}
      {children}
    </button>
  );
});

// ── Input ──────────────────────────────────────────────────
export const Input = React.memo(function Input({ label, value, onChange, type = 'text', step, min, max, required, disabled, placeholder }) {
  return (
    <div style={{ marginBottom: 16 }}>
      {label && (
        <label style={{ display: 'block', marginBottom: 6, fontSize: 11, color: '#8899bb', letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: 600 }}>
          {label}{required && <span style={{ color: '#eb5757' }}> *</span>}
        </label>
      )}
      <input
        type={type} value={value ?? ''} onChange={e => onChange(e.target.value)}
        step={step} min={min} max={max} disabled={disabled} placeholder={placeholder}
        className="input-base"
        style={{
          width: '100%', background: '#0a0d12', border: '1px solid #2a3040',
          borderRadius: 8, padding: '10px 14px', color: '#e8f0fe', fontSize: 13,
          outline: 'none', boxSizing: 'border-box',
          opacity: disabled ? 0.6 : 1,
          transition: 'border-color 0.15s',
        }}
      />
    </div>
  );
});

// ── Select ─────────────────────────────────────────────────
export const Select = React.memo(function Select({ label, value, onChange, children, required, disabled }) {
  return (
    <div style={{ marginBottom: 16 }}>
      {label && (
        <label style={{ display: 'block', marginBottom: 6, fontSize: 11, color: '#8899bb', letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: 600 }}>
          {label}{required && <span style={{ color: '#eb5757' }}> *</span>}
        </label>
      )}
      <select
        value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={disabled}
        className="select-base"
        style={{
          width: '100%', background: '#0a0d12', border: '1px solid #2a3040',
          borderRadius: 8, padding: '10px 14px', color: '#e8f0fe', fontSize: 13,
          outline: 'none', boxSizing: 'border-box', cursor: 'pointer',
        }}
      >
        {children}
      </select>
    </div>
  );
});

// ── Modal ──────────────────────────────────────────────────
export function Modal({ title, children, onClose, width = 640 }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 9000, backdropFilter: 'blur(6px)', padding: '24px 16px', overflowY: 'auto' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="fade-in" style={{ background: '#0e1117', border: '1px solid #2a3040', borderRadius: 16, width: '100%', maxWidth: width, boxShadow: '0 32px 100px rgba(0,0,0,0.8)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: '1px solid #1e2530' }}>
          <h3 style={{ margin: 0, fontSize: 16, color: '#e8f0fe', fontFamily: "'Syne', sans-serif", fontWeight: 700 }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#556', cursor: 'pointer', padding: 4, display: 'flex', borderRadius: 6 }}>
            <XIcon size={18} />
          </button>
        </div>
        <div style={{ padding: 24 }}>{children}</div>
      </div>
    </div>
  );
}
// ── Alert ──────────────────────────────────────────────────
export function Alert({ type = 'info', children, style: extraStyle = {} }) {
  const styles = {
    error:   { bg: '#2a1a1a', border: '#eb5757', color: '#eb5757', icon: '⚠' },
    success: { bg: '#1a2a1a', border: '#6fcf97', color: '#6fcf97', icon: '✓' },
    info:    { bg: '#1a2a3a', border: '#7eb8f7', color: '#7eb8f7', icon: 'ℹ' },
    warning: { bg: '#2a2a1a', border: '#f2c94c', color: '#f2c94c', icon: '⚠' },
  };
  const s = styles[type] || styles.info;
  return (
    <div style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 8, padding: '12px 16px', color: s.color, display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, marginBottom: 16, ...extraStyle }}>
      <span style={{ fontSize: 16 }}>{s.icon}</span>
      <span>{children}</span>
    </div>
  );
}

// ── Card ───────────────────────────────────────────────────
export const Card = React.memo(function Card({ children, style = {} }) {
  return (
    <div style={{ background: '#141920', border: '1px solid #1e2530', borderRadius: 12, padding: 24, ...style }}>
      {children}
    </div>
  );
});

// ── StatCard ───────────────────────────────────────────────
export const StatCard = React.memo(function StatCard({ label, value, sub, color = '#7eb8f7', icon }) {
  return (
    <div style={{ background: '#141920', border: '1px solid #1e2530', borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ fontSize: 11, color: '#4a5568', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        {icon && <span>{icon}</span>}{label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: "'Syne', sans-serif" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#3a4a5a', marginTop: 4 }}>{sub}</div>}
    </div>
  );
});

// ── Table helpers ──────────────────────────────────────────
export function Table({ headers, children, empty = 'Sin datos' }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #1e2530' }}>
            {headers.map((h, i) => (
              <th key={i} style={{ padding: '10px 14px', textAlign: h.align || 'left', color: '#4a5568', fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: 600, whiteSpace: 'nowrap' }}>
                {typeof h === 'string' ? h : (h.label || '')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Tr({ children, onClick, style: extraStyle = {} }) {
  return (
    <tr
      onClick={onClick}
      className="tr-hover"
      style={{ borderBottom: '1px solid #0e1117', cursor: onClick ? 'pointer' : 'default', transition: 'background 0.1s', ...extraStyle }}
    >
      {children}
    </tr>
  );
}

export function Td({ children, align = 'left', color, bold }) {
  return (
    <td style={{ padding: '12px 14px', textAlign: align, color: color || '#e8f0fe', fontWeight: bold ? 700 : 400, verticalAlign: 'middle' }}>
      {children}
    </td>
  );
}

// ── Loading spinner ────────────────────────────────────────
export const Spinner = React.memo(function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
      <div style={{ width: 32, height: 32, border: '3px solid #1e2530', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); }}`}</style>
    </div>
  );
});

// ── Icon components (SVG inline) ───────────────────────────
export function XIcon({ size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
}
