import { useState, useRef } from 'react';
import { api } from '../lib/api.js';
import { T as COLORS } from '../lib/theme.js';

export default function BandecConverter() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [formato, setFormato]   = useState('auto');  // 'auto' | 'v1' | 'v2'
  const [formatoDetectado, setFormatoDetectado] = useState('');
  const [dbLoading, setDbLoading] = useState(false);
  const [dbResult,  setDbResult]  = useState(null);
  const [dbError,   setDbError]   = useState('');
  const inputRef = useRef();

  const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

  const handleFile = (f) => {
    if (!f) return;
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
      setError('Solo se aceptan archivos PDF.');
      return;
    }
    if (f.size > MAX_FILE_SIZE) {
      setError(`El archivo es demasiado grande. Máximo permitido: 20 MB (este archivo: ${(f.size / 1024 / 1024).toFixed(1)} MB).`);
      return;
    }
    setFile(f);
    setError('');
    setResult(null);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    handleFile(f);
  };

  const handleConvert = async () => {
    if (!file) return;
    setLoading(true);
    setError('');
    setResult(null);

    try {
      // Read file as base64
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const data = await api.convertBandecPdf(base64, file.name, formato === 'auto' ? null : formato);
      setFormatoDetectado(data.formato || '');
      setResult(data);
    } catch (err) {
      setError(err.message || 'Error al convertir el archivo.');
    } finally {
      setLoading(false);
    }
  };

  const handleSendToDb = async () => {
    if (!result) return;
    setDbLoading(true);
    setDbError('');
    setDbResult(null);
    try {
      const data = await api.extractBandecToDb(result.txt, false, result.formato || formatoDetectado);
      setDbResult(data);
    } catch (err) {
      setDbError(err.message || 'Error al enviar a la base de datos.');
    } finally {
      setDbLoading(false);
    }
  };

  const handleDownload = () => {
    if (!result) return;
    const blob = new Blob([result.txt], { type: 'text/plain;charset=latin-1' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setFile(null);
    setResult(null);
    setError('');
    setDbResult(null);
    setDbError('');
    setFormatoDetectado('');
  };

  return (
    <div className="fade-in">
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontFamily: "'Syne', sans-serif", fontWeight: 800, color: '#e8f0fe', margin: 0 }}>
          Convertidor PDF → TXT
        </h1>
        <p style={{ color: COLORS.muted, fontSize: 13, marginTop: 6 }}>
          Convierte el estado de cuenta BANDEC (PDF) al formato TXT compatible con el extractor
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, maxWidth: 900 }}>
        {/* Left: Upload */}
        <div>
          <div style={{ fontSize: 11, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
            1. Seleccionar PDF
          </div>

          {/* Selector de formato */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              Variante del PDF
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { value: 'auto', label: '🔍 Auto-detectar' },
                { value: 'v1',   label: '📄 Clásico (2025-)' },
                { value: 'v2',   label: '🌐 Banca Remota Web' },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setFormato(opt.value)}
                  style={{
                    flex: 1,
                    padding: '8px 6px',
                    background: formato === opt.value ? 'rgba(126,184,247,0.12)' : COLORS.card,
                    border: `1px solid ${formato === opt.value ? COLORS.accent : COLORS.border}`,
                    borderRadius: 8,
                    color: formato === opt.value ? COLORS.accent : COLORS.muted,
                    cursor: 'pointer',
                    fontSize: 11,
                    fontWeight: formato === opt.value ? 700 : 400,
                    fontFamily: 'inherit',
                    transition: 'all 0.15s',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {formatoDetectado && (
              <div style={{ marginTop: 6, fontSize: 11, color: COLORS.muted }}>
                ✅ Formato detectado: <span style={{ color: COLORS.accent }}>
                  {formatoDetectado === 'v2' ? 'Banca Remota Web' : 'Clásico'}
                </span>
              </div>
            )}
          </div>

          {/* Drop zone */}
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            style={{
              border: `2px dashed ${dragOver ? COLORS.accent : file ? COLORS.green : COLORS.border}`,
              borderRadius: 12,
              padding: '40px 24px',
              textAlign: 'center',
              cursor: 'pointer',
              background: dragOver ? 'rgba(126,184,247,0.05)' : file ? 'rgba(111,207,151,0.04)' : COLORS.card,
              transition: 'all 0.2s',
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,application/pdf"
              style={{ display: 'none' }}
              onChange={(e) => handleFile(e.target.files[0])}
            />

            {file ? (
              <div>
                <div style={{ fontSize: 36, marginBottom: 10 }}>📄</div>
                <div style={{ color: COLORS.green, fontWeight: 700, fontSize: 14 }}>{file.name}</div>
                <div style={{ color: COLORS.muted, fontSize: 12, marginTop: 4 }}>
                  {(file.size / 1024).toFixed(1)} KB
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); reset(); }}
                  style={{ marginTop: 12, padding: '6px 14px', background: 'none', border: `1px solid ${COLORS.border}`, borderRadius: 6, color: COLORS.muted, cursor: 'pointer', fontSize: 11 }}
                >
                  Cambiar archivo
                </button>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 36, marginBottom: 10 }}>📂</div>
                <div style={{ color: COLORS.text, fontSize: 14, fontWeight: 600 }}>
                  Arrastra el PDF aquí
                </div>
                <div style={{ color: COLORS.muted, fontSize: 12, marginTop: 4 }}>
                  o haz click para seleccionar
                </div>
                <div style={{ color: COLORS.muted, fontSize: 11, marginTop: 8, opacity: 0.6 }}>
                  Solo archivos PDF de estado de cuenta BANDEC
                </div>
              </div>
            )}
          </div>

          {/* Convert button */}
          <button
            onClick={handleConvert}
            disabled={!file || loading}
            style={{
              marginTop: 16,
              width: '100%',
              padding: '14px',
              background: file && !loading ? 'linear-gradient(135deg, #1a56db, #1e3a8a)' : '#1e2530',
              border: 'none',
              borderRadius: 10,
              color: file && !loading ? '#e8f0fe' : COLORS.muted,
              cursor: file && !loading ? 'pointer' : 'not-allowed',
              fontSize: 14,
              fontWeight: 700,
              fontFamily: 'inherit',
              transition: 'all 0.2s',
            }}
          >
            {loading ? '⏳ Convirtiendo...' : '🔄 Convertir a TXT'}
          </button>

          {/* Error */}
          {error && (
            <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(235,87,87,0.1)', border: `1px solid ${COLORS.red}`, borderRadius: 8, color: COLORS.red, fontSize: 13 }}>
              ⚠️ {error}
            </div>
          )}
        </div>

        {/* Right: Result */}
        <div>
          <div style={{ fontSize: 11, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
            2. Descargar TXT
          </div>

          {!result && !loading && (
            <div style={{
              border: `1px solid ${COLORS.border}`,
              borderRadius: 12,
              padding: '40px 24px',
              textAlign: 'center',
              background: COLORS.card,
              minHeight: 220,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.3 }}>📝</div>
              <div style={{ color: COLORS.muted, fontSize: 13 }}>El resultado aparecerá aquí</div>
            </div>
          )}

          {loading && (
            <div style={{
              border: `1px solid ${COLORS.border}`,
              borderRadius: 12,
              padding: '40px 24px',
              textAlign: 'center',
              background: COLORS.card,
              minHeight: 220,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>⚙️</div>
              <div style={{ color: COLORS.accent, fontSize: 14, fontWeight: 600 }}>Procesando PDF...</div>
              <div style={{ color: COLORS.muted, fontSize: 12, marginTop: 6 }}>Extrayendo transacciones</div>
            </div>
          )}

          {result && (
            <div style={{
              border: `1px solid ${COLORS.green}`,
              borderRadius: 12,
              background: 'rgba(111,207,151,0.04)',
              overflow: 'hidden',
            }}>
              {/* Success header */}
              <div style={{ padding: '16px 20px', borderBottom: `1px solid ${COLORS.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 22 }}>✅</span>
                <div>
                  <div style={{ color: COLORS.green, fontWeight: 700, fontSize: 14 }}>Conversión exitosa</div>
                  <div style={{ color: COLORS.muted, fontSize: 12, marginTop: 2 }}>{result.filename}</div>
                </div>
              </div>

              {/* Stats */}
              <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Stat label="Movimientos" value={result.movimientos} />
                <Stat label="Variante" value={result.formato === 'v2' ? 'Banca Remota Web' : 'Clásico'} color={COLORS.accent} />
              </div>

              {/* Preview */}
              <div style={{ padding: '0 20px 16px' }}>
                <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                  Vista previa
                </div>
                <pre style={{
                  background: '#060a0f',
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 8,
                  padding: '10px 12px',
                  fontSize: 9.5,
                  color: COLORS.muted,
                  overflow: 'auto',
                  maxHeight: 140,
                  fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                  margin: 0,
                  lineHeight: 1.5,
                }}>
                  {result.txt.split('\n').slice(0, 18).join('\n')}
                </pre>
              </div>

              {/* Download button */}
              <div style={{ padding: '0 20px 20px' }}>
                <button
                  onClick={handleDownload}
                  style={{
                    width: '100%',
                    padding: '13px',
                    background: 'linear-gradient(135deg, #065f46, #047857)',
                    border: 'none',
                    borderRadius: 10,
                    color: '#d1fae5',
                    cursor: 'pointer',
                    fontSize: 14,
                    fontWeight: 700,
                    fontFamily: 'inherit',
                  }}
                >
                  ⬇️ Descargar {result.filename}
                </button>

                {/* ── Botón Enviar a BD ── */}
                <button
                  onClick={handleSendToDb}
                  disabled={dbLoading || !!dbResult}
                  style={{
                    width: '100%',
                    marginTop: 8,
                    padding: '13px',
                    background: dbResult
                      ? '#1e2530'
                      : dbLoading
                        ? '#1e2530'
                        : 'linear-gradient(135deg, #4c1d95, #6d28d9)',
                    border: 'none',
                    borderRadius: 10,
                    color: dbResult ? COLORS.muted : dbLoading ? COLORS.muted : '#ede9fe',
                    cursor: dbLoading || dbResult ? 'not-allowed' : 'pointer',
                    fontSize: 14,
                    fontWeight: 700,
                    fontFamily: 'inherit',
                    transition: 'all 0.2s',
                  }}
                >
                  {dbLoading ? '⏳ Enviando a BD...' : dbResult ? '✅ Enviado a BD' : '🗄️ Enviar a Base de Datos'}
                </button>

                {/* Error de BD */}
                {dbError && (
                  <div style={{ marginTop: 10, padding: '10px 14px', background: 'rgba(235,87,87,0.1)', border: `1px solid ${COLORS.red}`, borderRadius: 8, color: COLORS.red, fontSize: 13 }}>
                    ⚠️ {dbError}
                  </div>
                )}

                {/* Resultado de BD */}
                {dbResult && (
                  <div style={{ marginTop: 12, padding: '14px 16px', background: 'rgba(109,40,217,0.08)', border: '1px solid #6d28d9', borderRadius: 10 }}>
                    <div style={{ color: '#c4b5fd', fontWeight: 700, fontSize: 13, marginBottom: 10 }}>
                      🗄️ Resultado en Base de Datos
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <DbStat label="Procesadas"  value={dbResult.total}      color="#c4b5fd" />
                      <DbStat label="Insertadas"  value={dbResult.insertadas} color={COLORS.green} />
                      <DbStat label="Duplicadas"  value={dbResult.duplicadas} color={COLORS.yellow} />
                      <DbStat label="Con CI"      value={dbResult.con_ci}     color={COLORS.accent} />
                    </div>
                    <div style={{ marginTop: 10, display: 'flex', gap: 12, fontSize: 12, color: COLORS.muted }}>
                      <span>💚 Créditos: {dbResult.num_creditos} — ${Number(dbResult.total_creditos).toLocaleString('es-CU', { minimumFractionDigits: 2 })} CUP</span>
                    </div>
                  </div>
                )}

                <button
                  onClick={reset}
                  style={{
                    width: '100%',
                    marginTop: 8,
                    padding: '10px',
                    background: 'none',
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: 10,
                    color: COLORS.muted,
                    cursor: 'pointer',
                    fontSize: 12,
                    fontFamily: 'inherit',
                  }}
                >
                  Convertir otro archivo
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Instructions */}
      <div style={{ marginTop: 32, maxWidth: 900 }}>
        <div style={{ fontSize: 11, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
          ¿Cómo usar?
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
          {[
            { icon: '📥', title: 'Descarga el PDF', desc: 'Obtén el estado de cuenta desde la Banca Remota BANDEC en formato PDF' },
            { icon: '🔄', title: 'Convierte aquí', desc: 'Sube el PDF y haz click en "Convertir". El sistema extrae todas las transacciones automáticamente' },
            { icon: '📊', title: 'Importa a BD', desc: 'Descarga el TXT o haz click en "Enviar a Base de Datos" para importar las transacciones directamente a PostgreSQL' },
          ].map((s, i) => (
            <div key={i} style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: '16px 18px' }}>
              <div style={{ fontSize: 22, marginBottom: 8 }}>{s.icon}</div>
              <div style={{ color: COLORS.text, fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{s.title}</div>
              <div style={{ color: COLORS.muted, fontSize: 12, lineHeight: 1.6 }}>{s.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ background: '#060a0f', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ color: COLORS.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</div>
      <div style={{ color: color || COLORS.green, fontWeight: 700, fontSize: 18, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function DbStat({ label, value, color }) {
  return (
    <div style={{ background: '#060a0f', borderRadius: 8, padding: '8px 10px' }}>
      <div style={{ color: COLORS.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</div>
      <div style={{ color: color || COLORS.text, fontWeight: 700, fontSize: 16, marginTop: 2 }}>{value}</div>
    </div>
  );
}