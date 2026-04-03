import React from 'react';

export default class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: 48,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '60vh',
          textAlign: 'center',
          fontFamily: "'IBM Plex Mono', monospace",
        }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>💥</div>
          <h2 style={{ color: '#eb5757', fontSize: 20, marginBottom: 8 }}>
            Ocurrió un error inesperado
          </h2>
          <p style={{ color: '#3a4a5a', fontSize: 13, marginBottom: 24, maxWidth: 480 }}>
            {this.state.error?.message || 'Error desconocido'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              padding: '10px 24px',
              background: '#1a2540',
              border: '1px solid #2563eb',
              borderRadius: 8,
              color: '#7eb8f7',
              cursor: 'pointer',
              fontSize: 13,
              fontFamily: 'inherit',
              fontWeight: 600,
            }}
          >
            Reintentar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
