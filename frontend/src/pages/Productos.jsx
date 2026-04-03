import { useState, useEffect, useRef, useMemo } from 'react';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import { api } from '../lib/api.js';
import { fmt, fmtDate, estadoProducto, useDebounce } from '../lib/utils.js';
import { Badge, Btn, Input, Modal, Table, Tr, Td, Spinner, Alert } from '../components/UI.jsx';

const EMPTY = { codigo: '', producto: '', um_mayorista: '', um_minorista: '', formato: '1', cantidad_mayorista: '', disponible_um_minorista: '0', fecha_inicio: '', fecha_fin: '', importe_mayorista: '', importe: '', activo: true, vende_decimales: false, peso_pieza_min: '', peso_pieza_max: '', formato_rango: false, categoria: 'otros' };

const MONTH_NAMES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

// Devuelve todos los meses "YYYY-MM" que cubre un producto según sus fechas
function mesesDelProducto(p) {
  if (!p.fecha_inicio || !p.fecha_fin) return [];
  const meses = [];
  const cur = new Date(p.fecha_inicio.slice(0, 7) + '-01T00:00:00Z');
  const end = new Date(p.fecha_fin.slice(0, 7)   + '-01T00:00:00Z');
  while (cur <= end) {
    const y = cur.getUTCFullYear();
    const m = String(cur.getUTCMonth() + 1).padStart(2, '0');
    meses.push(`${y}-${m}`);
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return meses;
}

const FULL_MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

export default function Productos() {
  const [productos, setProductos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [search, setSearch]               = useState('');
  const debouncedSearch                   = useDebounce(search);
  const [filterCategoria, setFilterCategoria] = useState('');   // '' | 'carnicos' | 'otros'
  const [filterFechaIni, setFilterFechaIni]   = useState('');
  const [filterFechaFin, setFilterFechaFin]   = useState('');
  const [selected, setSelected]               = useState(new Set()); // ids seleccionados para borrar
  const [deletingBulk, setDeletingBulk]       = useState(false);

  // ── Importar desde Excel ───────────────────────────────────────
  const [showImport, setShowImport]           = useState(false);
  const [importRows, setImportRows]           = useState([]);    // filas parseadas del excel
  const [importMes, setImportMes]             = useState('');    // "YYYY-MM"
  const [importCategoria, setImportCategoria] = useState('otros');
  const [importSaving, setImportSaving]       = useState(false);
  const [importFileName, setImportFileName]   = useState('');
  const fileInputRef = useRef(null);

  const FULL_MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                          'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  // Genera las opciones de mes: 6 meses atrás + 6 adelante
  const mesOptions = (() => {
    const now = new Date();
    const opts = [];
    for (let d = -3; d <= 9; d++) {
      const dt = new Date(now.getFullYear(), now.getMonth() + d, 1);
      const y  = dt.getFullYear();
      const m  = String(dt.getMonth() + 1).padStart(2, '0');
      opts.push({ value: `${y}-${m}`, label: `${FULL_MONTHS_ES[dt.getMonth()]} ${y}` });
    }
    return opts;
  })();

  // Parsea el Excel y extrae las filas de producto
  const handleExcelFile = async (file) => {
    if (!file) return;
    setImportFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb   = XLSX.read(e.target.result, { type: 'array' });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

        // Detectar fila de encabezados buscando "Referencia" o "Descripción"
        let headerRow = -1;
        for (let i = 0; i < data.length; i++) {
          const row = data[i].map(c => String(c || '').trim().toLowerCase());
          if (row.some(c => c.includes('referencia')) && row.some(c => c.includes('descripci'))) {
            headerRow = i;
            break;
          }
        }
        if (headerRow === -1) {
          toast.error('No se encontró la fila de encabezados (Referencia / Descripción)');
          return;
        }

        const headers = data[headerRow].map(c => String(c || '').trim().toLowerCase());
        const iRef    = headers.findIndex(h => h.includes('referencia'));
        const iDesc   = headers.findIndex(h => h.includes('descripci'));
        const iCant   = headers.findIndex(h => h.includes('cantidad'));
        // UNITARIA es la última columna con valor numérico en la fila de encabezado scope
        const iUnit   = headers.findLastIndex(h => h.includes('unitaria'));
        // VENTA TOTAL = valor real
        const iTotal  = headers.findLastIndex(h => h.includes('venta') || h === 'total');

        const rows = [];
        for (let i = headerRow + 1; i < data.length; i++) {
          const row  = data[i];
          const ref  = String(row[iRef]  || '').trim();
          const desc = String(row[iDesc] || '').trim();
          const cant = parseFloat(row[iCant]);
          const unit = parseFloat(row[iUnit]);
          // total = VENTA TOTAL (valor real en CUP)
          const total = iTotal >= 0 ? parseFloat(row[iTotal]) : null;

          // Saltear filas vacías o sin referencia válida o sin cantidad
          if (!ref || !desc || isNaN(cant) || cant <= 0) continue;

          rows.push({
            codigo:    ref,
            producto:  desc,
            disponible: cant,
            importe:   isNaN(unit)  ? '' : String(Math.round(unit  * 100) / 100),
            total:     isNaN(total) ? '' : String(Math.round(total * 100) / 100),
            // campos que el usuario puede ajustar en la preview
            importarCheck: true,
          });
        }

        if (!rows.length) {
          toast.error('No se encontraron filas de producto válidas en el archivo');
          return;
        }

        // Fusionar filas con el mismo código (duplicados en el Excel)
        // → sumar cantidades, conservar el precio de la primera aparición, marcar como duplicado
        const merged = [];
        const seen   = {};
        for (const r of rows) {
          if (seen[r.codigo] !== undefined) {
            // ya existe → sumar disponible
            merged[seen[r.codigo]].disponible += r.disponible;
            merged[seen[r.codigo]].isDuplicate  = true;
          } else {
            seen[r.codigo] = merged.length;
            merged.push({ ...r, isDuplicate: false });
          }
        }

        setImportRows(merged);
        toast.success(`${rows.length} productos detectados`);
      } catch (err) {
        toast.error('Error leyendo el Excel: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Actualiza un campo editable de una fila de preview
  const updateImportRow = (idx, field, value) => {
    setImportRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  // Envía las filas seleccionadas a la BD
  const saveImport = async () => {
    if (!importMes) { toast.error('Seleccioná el mes de la factura'); return; }
    const [y, m] = importMes.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const fecha_inicio = `${y}-${String(m).padStart(2,'0')}-01`;
    const fecha_fin    = `${y}-${String(m).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;

    const toSave = importRows.filter(r => r.importarCheck);
    if (!toSave.length) { toast.error('No hay productos seleccionados'); return; }

    setImportSaving(true);
    let ok = 0, fail = 0;
    for (const r of toSave) {
      try {
        await api.createProducto({
          codigo:                  r.codigo,
          producto:                r.producto,
          um_mayorista:            'Unidad',
          um_minorista:            'Unidad',
          formato:                 1,
          disponible_um_minorista: parseFloat(r.disponible) || 0,
          importe_mayorista:       parseFloat(r.importe)    || 0,
          importe:                 parseFloat(r.importe)    || 0,
          fecha_inicio,
          fecha_fin,
          activo:                  true,
          vende_decimales:         false,
          categoria:               importCategoria,
        });
        ok++;
      } catch (e) {
        fail++;
        console.warn(`[import] ${r.codigo}: ${e.message}`);
      }
    }
    setImportSaving(false);
    if (ok)   toast.success(`${ok} producto${ok > 1 ? 's' : ''} importado${ok > 1 ? 's' : ''} correctamente`);
    if (fail) toast.error(`${fail} producto${fail > 1 ? 's' : ''} no se pudo importar (código duplicado u otro error)`);
    if (ok) { setShowImport(false); setImportRows([]); setImportFileName(''); load(); }
  };

  // ── Vista por mes ──────────────────────────────────────────────
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear]   = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState(null); // null = ver todos
  const years = [currentYear - 1, currentYear, currentYear + 1];

  const load = () => {
    setLoading(true);
    api.getProductos()
      .then(setProductos)
      .catch(e => toast.error(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // Resumen mensual calculado directo desde los productos cargados
  const resumenMensual = useMemo(() => {
    const map = {};
    for (const p of productos) {
      const vr = (parseFloat(p.importe_mayorista) || 0) * ((parseFloat(p.disponible_um_minorista) || 0) / (parseFloat(p.formato) || 1));
      if (!vr) continue;
      for (const mes of mesesDelProducto(p)) {
        if (!map[mes]) map[mes] = { total: 0, count: 0 };
        map[mes].total += vr;
        map[mes].count += 1;
      }
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, d]) => ({ mes, total: d.total, count: d.count }));
  }, [productos]);

  const f = (k) => (v) => setForm(prev => {
    const next = { ...prev, [k]: v };
    // Recalcular disponible automáticamente al cambiar cantidad o formato
    if (k === 'cantidad_mayorista' || k === 'formato') {
      const cant    = parseFloat(k === 'cantidad_mayorista' ? v : next.cantidad_mayorista) || 0;
      const fmt_    = parseFloat(k === 'formato' ? v : next.formato) || 0;
      const autoVal = cant * fmt_;
      const prevAuto = (parseFloat(prev.cantidad_mayorista) || 0) * (parseFloat(prev.formato) || 0);
      // Solo sobreescribir si el campo está vacío o coincide con el auto anterior
      if (!next.disponible_um_minorista || parseFloat(next.disponible_um_minorista) === prevAuto) {
        next.disponible_um_minorista = String(autoVal);
      }
    }
    // Recalcular importe minorista automáticamente solo si no fue editado manualmente
    if (k === 'importe_mayorista' || (k === 'formato' && next.importe_mayorista)) {
      const impMay  = parseFloat(k === 'importe_mayorista' ? v : next.importe_mayorista) || 0;
      const fmt_    = parseFloat(k === 'formato' ? v : next.formato) || 1;
      const autoVal = impMay > 0 ? Math.round((impMay / fmt_) * 100) / 100 : 0;
      // Solo sobreescribir si el campo está vacío o si coincide con el valor auto anterior
      const prevAuto = Math.round(((parseFloat(prev.importe_mayorista) || 0) / (parseFloat(prev.formato) || 1)) * 100) / 100;
      if (!next.importe || parseFloat(next.importe) === prevAuto) {
        next.importe = impMay > 0 ? String(autoVal) : next.importe;
      }
    }
    return next;
  });

  const valorReal = () => {
    const cant   = parseFloat(form.cantidad_mayorista  || 0);
    const impMay = parseFloat(form.importe_mayorista   || 0);
    return cant * impMay;
  };

  const openNew  = () => {
    let prefill = EMPTY;
    if (selectedMonth !== null) {
      const mm = String(selectedMonth + 1).padStart(2, '0');
      const lastDay = new Date(selectedYear, selectedMonth + 1, 0).getDate();
      prefill = {
        ...EMPTY,
        fecha_inicio: `${selectedYear}-${mm}-01`,
        fecha_fin:    `${selectedYear}-${mm}-${String(lastDay).padStart(2, '0')}`,
      };
    }
    setForm(prefill);
    setEditing(null);
    setShowForm(true);
  };
  const openEdit = (p) => {
    const disp = parseFloat(p.disponible_um_minorista) || 0;
    const fmt_ = parseFloat(p.formato) || 1;
    setForm({
      codigo: p.codigo, producto: p.producto, um_mayorista: p.um_mayorista, um_minorista: p.um_minorista,
      formato: String(p.formato),
      cantidad_mayorista: String(Math.round((disp / fmt_) * 10000) / 10000),
      disponible_um_minorista: String(p.disponible_um_minorista),
      fecha_inicio: p.fecha_inicio ? p.fecha_inicio.slice(0, 10) : '',
      fecha_fin:    p.fecha_fin    ? p.fecha_fin.slice(0, 10)    : '',
      importe_mayorista: String(p.importe_mayorista || 0),
      importe: String(p.importe),
      peso_pieza_min: p.peso_pieza_min ? String(p.peso_pieza_min) : '',
      peso_pieza_max: p.peso_pieza_max ? String(p.peso_pieza_max) : '',
      formato_rango: p.formato_rango === true || p.formato_rango === 1,
      categoria: p.categoria || 'otros',
      activo: p.activo !== undefined ? p.activo : true,
      vende_decimales: p.vende_decimales === true || p.vende_decimales === 1,
    });
    setEditing(p.id);
    setShowForm(true);
  };

  const save = async () => {
    if (!form.codigo || !form.producto || !form.um_mayorista || !form.um_minorista) {
      toast.error('Complete todos los campos requeridos');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        formato:                  parseFloat(form.formato),
        disponible_um_minorista:  parseFloat(form.disponible_um_minorista),
        importe_mayorista:        parseFloat(form.importe_mayorista) || 0,
        importe:                  parseFloat(form.importe) || 0,
        peso_pieza_min:           form.peso_pieza_min ? parseFloat(form.peso_pieza_min) : null,
        peso_pieza_max:           form.peso_pieza_max ? parseFloat(form.peso_pieza_max) : null,
        formato_rango:            form.formato_rango,
        fecha_inicio:             form.fecha_inicio || null,
        fecha_fin:                form.fecha_fin    || null,
        activo:                   form.activo,
        vende_decimales:          form.vende_decimales,
        categoria:                form.categoria || 'otros',
      };
      if (editing) {
        await api.updateProducto(editing, payload);
        toast.success('Producto actualizado');
      } else {
        await api.createProducto(payload);
        toast.success('Producto creado');
      }
      setShowForm(false);
      load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const del = async (id, nombre) => {
    if (!confirm(`¿Eliminar "${nombre}"? Esta acción no se puede deshacer.`)) return;
    try {
      await api.deleteProducto(id);
      toast.success('Producto eliminado');
      setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
      load();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const toggleSelect = (id) => setSelected(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const toggleSelectAll = () => {
    if (filtered.every(p => selected.has(p.id))) setSelected(new Set());
    else setSelected(new Set(filtered.map(p => p.id)));
  };
  const deleteBulk = async () => {
    if (!confirm(`¿Eliminar ${selected.size} producto${selected.size > 1 ? 's' : ''}? Esta acción no se puede deshacer.`)) return;
    setDeletingBulk(true);
    let ok = 0, fail = 0;
    for (const id of selected) {
      try { await api.deleteProducto(id); ok++; }
      catch { fail++; }
    }
    setDeletingBulk(false);
    setSelected(new Set());
    if (ok)   toast.success(`${ok} producto${ok > 1 ? 's' : ''} eliminado${ok > 1 ? 's' : ''}`);
    if (fail) toast.error(`${fail} no se pudo${fail > 1 ? 'n' : ''} eliminar (referenciados en facturas)`);
    load();
  };

  // Filtro de búsqueda + filtro de mes
  const filtered = useMemo(() => productos.filter(p => {
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      const matchSearch = p.producto.toLowerCase().includes(q) || p.codigo.toLowerCase().includes(q);
      if (!matchSearch) return false;
    }
    if (filterCategoria && p.categoria !== filterCategoria) return false;
    if (filterFechaIni && p.fecha_inicio && p.fecha_inicio.slice(0,10) < filterFechaIni) return false;
    if (filterFechaFin && p.fecha_fin    && p.fecha_fin.slice(0,10)    > filterFechaFin) return false;
    if (selectedMonth !== null) {
      const mesKey = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}`;
      return mesesDelProducto(p).includes(mesKey);
    }
    return true;
  }), [productos, debouncedSearch, filterCategoria, filterFechaIni, filterFechaFin, selectedMonth, selectedYear]);

  // Conteo de productos por mes para el año seleccionado
  const countByMonth = useMemo(() => Array.from({ length: 12 }, (_, m) => {
    const mesKey = `${selectedYear}-${String(m + 1).padStart(2, '0')}`;
    return productos.filter(p => mesesDelProducto(p).includes(mesKey)).length;
  }), [productos, selectedYear]);

  const HEADERS = [
    { label: (
      <input type="checkbox"
        checked={filtered.length > 0 && filtered.every(p => selected.has(p.id))}
        onChange={toggleSelectAll}
        style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#eb5757' }}
      />
    )},
    { label: 'Código' }, { label: 'Producto' }, { label: 'UM May.' }, { label: 'UM Min.' },
    { label: 'Formato' }, { label: 'Disponible', align: 'right' }, { label: 'Importe', align: 'right' },
    { label: 'Decimales', align: 'center' }, { label: 'Valor Real', align: 'right' },
    { label: 'Inicio' }, { label: 'Fin' }, { label: 'Categoría' }, { label: 'Estado' }, { label: '' }
  ];

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 26, fontFamily: "'Syne', sans-serif", fontWeight: 800, color: '#e8f0fe' }}>Productos</h1>
          <p style={{ color: '#3a4a5a', fontSize: 13, marginTop: 4 }}>{productos.length} registros</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Btn onClick={() => { setShowImport(true); setImportRows([]); setImportFileName(''); }} variant="ghost">📥 Importar Excel</Btn>
          <Btn onClick={openNew}>＋ Nuevo Producto</Btn>
        </div>
      </div>

      {/* ── Selector de año + tabs de mes ─────────────────────── */}
      <div style={{ background: '#0e1117', border: '1px solid #1e2530', borderRadius: 12, padding: '14px 18px', marginBottom: 18 }}>
        {/* Selector de año */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: '#4a6a8a', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>Año:</span>
          {years.map(y => (
            <button
              key={y}
              onClick={() => { setSelectedYear(y); setSelectedMonth(null); }}
              style={{
                background: selectedYear === y ? '#1a3a5c' : 'transparent',
                border: `1px solid ${selectedYear === y ? '#3a7fc1' : '#1e2530'}`,
                borderRadius: 6,
                padding: '3px 12px',
                color: selectedYear === y ? '#7eb8f7' : '#4a6a8a',
                fontSize: 13,
                fontWeight: selectedYear === y ? 700 : 400,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >{y}</button>
          ))}
          {selectedMonth !== null && (
            <button
              onClick={() => setSelectedMonth(null)}
              style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid #2a3a4a', borderRadius: 6, padding: '3px 10px', color: '#4a6a8a', fontSize: 11, cursor: 'pointer' }}
            >✕ Ver todos</button>
          )}
        </div>

        {/* Tabs de mes */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 6 }}>
          {MONTH_NAMES.map((name, i) => {
            const isSelected = selectedMonth === i;
            const count = countByMonth[i];
            return (
              <button
                key={i}
                onClick={() => setSelectedMonth(isSelected ? null : i)}
                style={{
                  background: isSelected ? '#1a3a5c' : count > 0 ? 'rgba(30,37,48,0.8)' : 'transparent',
                  border: `1px solid ${isSelected ? '#3a7fc1' : count > 0 ? '#2a3a4a' : '#151c25'}`,
                  borderRadius: 8,
                  padding: '8px 4px',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ fontSize: 12, fontWeight: isSelected ? 700 : 600, color: isSelected ? '#7eb8f7' : count > 0 ? '#c8d8f0' : '#2a3a4a' }}>
                  {name}
                </span>
                <span style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: isSelected ? '#fff' : count > 0 ? '#6fcf97' : '#1e2530',
                  background: isSelected ? '#3a7fc1' : count > 0 ? 'rgba(111,207,151,0.12)' : 'transparent',
                  borderRadius: 10,
                  padding: '1px 6px',
                  minWidth: 18,
                  textAlign: 'center',
                }}>
                  {count > 0 ? count : '—'}
                </span>
              </button>
            );
          })}
        </div>

        {selectedMonth !== null && (
          <div style={{ marginTop: 10, fontSize: 12, color: '#4a6a8a' }}>
            Mostrando productos de <strong style={{ color: '#7eb8f7' }}>{FULL_MONTHS[selectedMonth]} {selectedYear}</strong>
            {' · '}<span style={{ color: '#6fcf97' }}>{filtered.length} producto{filtered.length !== 1 ? 's' : ''}</span>
            {' · '}
            <span
              onClick={openNew}
              style={{ color: '#bb87fc', cursor: 'pointer', textDecoration: 'underline' }}
            >+ Agregar producto para este mes</span>
          </div>
        )}
      </div>

      {/* ── Valor real por mes ─────────────────────────────────── */}
      {resumenMensual.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#4a6a8a', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            Valor real por mes
          </p>
          <div style={{ background: '#0e1117', border: '1px solid #1e2530', borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#0a0d12', borderBottom: '1px solid #1e2530' }}>
                  <th style={{ padding: '9px 18px', textAlign: 'left',  fontSize: 11, color: '#4a6a8a', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8 }}>Mes</th>
                  <th style={{ padding: '9px 18px', textAlign: 'right', fontSize: 11, color: '#4a6a8a', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8 }}>Productos</th>
                  <th style={{ padding: '9px 18px', textAlign: 'right', fontSize: 11, color: '#4a6a8a', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8 }}>Total Valor Real</th>
                </tr>
              </thead>
              <tbody>
                {resumenMensual.map((m, i) => {
                  const [y, mo] = m.mes.split('-');
                  return (
                    <tr key={m.mes} style={{ borderBottom: i < resumenMensual.length - 1 ? '1px solid #131820' : 'none' }}>
                      <td style={{ padding: '10px 18px', fontSize: 13, color: '#c8d8f0', fontWeight: 600 }}>
                        {MONTH_NAMES[parseInt(mo) - 1]} {y}
                      </td>
                      <td style={{ padding: '10px 18px', textAlign: 'right', fontSize: 13, color: '#5a7a9a' }}>
                        {m.count}
                      </td>
                      <td style={{ padding: '10px 18px', textAlign: 'right', fontSize: 14, color: '#bb87fc', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                        ${fmt(m.total)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Buscador avanzado ─────────────────────────────────── */}
      <div style={{ background: '#0e1117', border: '1px solid #1e2530', borderRadius: 12, padding: '14px 18px', marginBottom: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 10, alignItems: 'end' }}>
          {/* Texto libre */}
          <div>
            <label style={{ display: 'block', marginBottom: 5, fontSize: 11, color: '#4a6a8a', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8 }}>Código o nombre</label>
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar..."
              style={{ width: '100%', boxSizing: 'border-box', background: '#0a0d12', border: '1px solid #1e2530', borderRadius: 8, padding: '8px 12px', color: '#e8f0fe', fontSize: 13, fontFamily: 'inherit', outline: 'none' }}
            />
          </div>
          {/* Categoría */}
          <div>
            <label style={{ display: 'block', marginBottom: 5, fontSize: 11, color: '#4a6a8a', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8 }}>Categoría</label>
            <select value={filterCategoria} onChange={e => setFilterCategoria(e.target.value)}
              style={{ background: '#0a0d12', border: '1px solid #1e2530', borderRadius: 8, padding: '8px 12px', color: filterCategoria ? '#e8f0fe' : '#4a6a8a', fontSize: 13, fontFamily: 'inherit', outline: 'none', cursor: 'pointer', minWidth: 130 }}>
              <option value="">Todas</option>
              <option value="carnicos">🥩 Cárnicos</option>
              <option value="otros">📦 Otros</option>
            </select>
          </div>
          {/* Fecha inicio desde */}
          <div>
            <label style={{ display: 'block', marginBottom: 5, fontSize: 11, color: '#4a6a8a', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8 }}>Inicio desde</label>
            <input type="date" value={filterFechaIni} onChange={e => setFilterFechaIni(e.target.value)}
              style={{ background: '#0a0d12', border: '1px solid #1e2530', borderRadius: 8, padding: '8px 10px', color: filterFechaIni ? '#e8f0fe' : '#4a6a8a', fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
          </div>
          {/* Fecha fin hasta */}
          <div>
            <label style={{ display: 'block', marginBottom: 5, fontSize: 11, color: '#4a6a8a', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8 }}>Fin hasta</label>
            <input type="date" value={filterFechaFin} onChange={e => setFilterFechaFin(e.target.value)}
              style={{ background: '#0a0d12', border: '1px solid #1e2530', borderRadius: 8, padding: '8px 10px', color: filterFechaFin ? '#e8f0fe' : '#4a6a8a', fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
          </div>
        </div>
        {/* Limpiar filtros */}
        {(search || filterCategoria || filterFechaIni || filterFechaFin) && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 12, color: '#6fcf97' }}>{filtered.length} resultado{filtered.length !== 1 ? 's' : ''}</span>
            <button onClick={() => { setSearch(''); setFilterCategoria(''); setFilterFechaIni(''); setFilterFechaFin(''); }}
              style={{ fontSize: 11, color: '#4a6a8a', background: 'transparent', border: '1px solid #2a3a4a', borderRadius: 6, padding: '3px 10px', cursor: 'pointer' }}>
              ✕ Limpiar filtros
            </button>
          </div>
        )}
      </div>

      {/* ── Barra de selección / borrado masivo ───────────────── */}
      {selected.size > 0 && (
        <div style={{ background: 'rgba(235,87,87,0.08)', border: '1px solid rgba(235,87,87,0.25)', borderRadius: 10, padding: '10px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 13, color: '#eb5757', fontWeight: 700 }}>{selected.size} producto{selected.size > 1 ? 's' : ''} seleccionado{selected.size > 1 ? 's' : ''}</span>
          <Btn onClick={deleteBulk} variant="danger" small disabled={deletingBulk}>
            {deletingBulk ? 'Eliminando...' : `🗑 Eliminar ${selected.size} seleccionado${selected.size > 1 ? 's' : ''}`}
          </Btn>
          <button onClick={() => setSelected(new Set())} style={{ marginLeft: 'auto', fontSize: 11, color: '#4a6a8a', background: 'transparent', border: 'none', cursor: 'pointer' }}>Cancelar selección</button>
        </div>
      )}

      {loading ? <Spinner /> : (
        <div style={{ background: '#0e1117', border: '1px solid #1e2530', borderRadius: 12, overflow: 'hidden' }}>
          <Table headers={HEADERS} empty="No hay productos">
            {filtered.map(p => {
              const estado = estadoProducto(p);
              return (
                <Tr key={p.id} style={{ background: selected.has(p.id) ? 'rgba(235,87,87,0.06)' : undefined }}>
                  <Td>
                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)}
                      style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#eb5757' }} />
                  </Td>
                  <Td color="#7eb8f7"><strong>{p.codigo}</strong></Td>
                  <Td>{p.producto}</Td>
                  <Td color="#8899bb">{p.um_mayorista}</Td>
                  <Td color="#8899bb">{p.um_minorista}</Td>
                  <Td align="right" color="#8899bb">{p.formato}</Td>
                  <Td align="right" color="#6fcf97"><strong>{fmt(p.disponible_um_minorista)}</strong></Td>
                  <Td align="right" color="#f2c94c">${fmt(p.importe)}</Td>
                  <Td align="center">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
                      {p.vende_decimales && <Badge color="#6fcf97">✓ Dec.</Badge>}
                      {p.peso_pieza_min && p.peso_pieza_max && (
                        <span style={{ fontSize: 10, color: '#f2c94c', background: 'rgba(242,201,76,0.1)', borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap' }}>
                          {p.peso_pieza_min}–{p.peso_pieza_max} {p.um_minorista}
                          {p.formato_rango && <span style={{ marginLeft: 4, color: '#eb8c34' }}>★ rango</span>}
                        </span>
                      )}
                      {!p.vende_decimales && !p.peso_pieza_min && <span style={{ color: '#2a3a4a' }}>—</span>}
                    </div>
                  </Td>
                  <Td align="right" color="#bb87fc">${fmt((parseFloat(p.importe_mayorista) || 0) * ((parseFloat(p.disponible_um_minorista) || 0) / (parseFloat(p.formato) || 1)))}</Td>
                  <Td color="#3a4a5a">{fmtDate(p.fecha_inicio)}</Td>
                  <Td color="#3a4a5a">{fmtDate(p.fecha_fin)}</Td>
                  <Td>
                    {(() => {
                      const cat = p.categoria || 'otros';
                      const cfg = cat === 'carnicos'
                        ? { bg: '#2a1a0a', border: '#8a4a1a', color: '#f2994a', icon: '🥩' }
                        : { bg: '#0a1a2a', border: '#1a4a6a', color: '#7eb8f7', icon: '📦' };
                      return (
                        <span style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color, borderRadius: 5, padding: '3px 9px', fontSize: 11, fontWeight: 700 }}>
                          {cfg.icon} {cat.charAt(0).toUpperCase() + cat.slice(1)}
                        </span>
                      );
                    })()}
                  </Td>
                  <Td><Badge color={estado.color}>{estado.label}</Badge></Td>
                  <Td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Btn onClick={() => openEdit(p)} variant="ghost" small>Editar</Btn>
                      <Btn onClick={() => del(p.id, p.producto)} variant="danger" small>✕</Btn>
                    </div>
                  </Td>
                </Tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={12} style={{ padding: 40, textAlign: 'center', color: '#2a3a4a' }}>
                {search ? 'Sin resultados para la búsqueda' : 'No hay productos. Crea el primero.'}
              </td></tr>
            )}
          </Table>
        </div>
      )}



      {showForm && (
        <Modal title={editing ? 'Editar Producto' : 'Nuevo Producto'} onClose={() => setShowForm(false)} width={720}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}>
            <Input label="Código" value={form.codigo} onChange={f('codigo')} required placeholder="ej. PROD-001" />
            <Input label="Nombre del Producto" value={form.producto} onChange={f('producto')} required />
            <Input label="UM Mayorista" value={form.um_mayorista} onChange={f('um_mayorista')} required placeholder="ej. Caja 10kg" />
            <Input label="UM Minorista" value={form.um_minorista} onChange={f('um_minorista')} required placeholder="ej. kg" />
            <Input label="Formato (unid. min. por unid. may.)" value={form.formato} onChange={f('formato')} type="number" min="0.01" step="0.01" />
            <Input label="Cantidad (UM Mayorista)" value={form.cantidad_mayorista} onChange={f('cantidad_mayorista')} type="number" min="0" step="1" required placeholder="ej. 50 cajas" />
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 6, fontSize: 11, color: '#8899bb', letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: 600 }}>
                Disponible (UM Minorista) $
                {(() => {
                  const auto = (parseFloat(form.cantidad_mayorista) || 0) * (parseFloat(form.formato) || 0);
                  const actual = parseFloat(form.disponible_um_minorista) || 0;
                  return actual !== auto && auto > 0
                    ? <span style={{ color: '#6fcf97', fontWeight: 400, marginLeft: 6, fontSize: 10 }}>· auto: {fmt(auto)} {form.um_minorista || 'unid.'}</span>
                    : null;
                })()}
              </label>
              <Input
                value={form.disponible_um_minorista}
                onChange={f('disponible_um_minorista')}
                type="number" min="0" step="0.01"
                placeholder={fmt((parseFloat(form.cantidad_mayorista) || 0) * (parseFloat(form.formato) || 0))}
              />
            </div>
            <Input label="Importe Mayorista (precio por caja) $" value={form.importe_mayorista} onChange={f('importe_mayorista')} type="number" min="0" step="0.01" required placeholder="ej. 150.00" />
            <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#e8f0fe', cursor: 'pointer', userSelect: 'none', marginTop: 22 }}>
                <input
                  type="checkbox"
                  checked={form.vende_decimales}
                  onChange={(e) => f('vende_decimales')(e.target.checked)}
                  style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#6fcf97' }}
                />
                <span style={{ fontWeight: 600 }}>
                  Vende en Decimales
                  <span style={{ color: '#8899bb', fontWeight: 400, marginLeft: 8, fontSize: 11 }}>
                    (ej. lomo: 17.15 lb, 20.20 lb)
                  </span>
                </span>
              </label>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 6, fontSize: 11, color: '#8899bb', letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: 600 }}>
                Rango de peso por pieza ({form.um_minorista || 'UM'})
                <span style={{ color: '#3a4a5a', fontWeight: 400, marginLeft: 6, fontSize: 10 }}>— opcional, ej. lomo 12–15 lb</span>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="number" min="0" step="0.01"
                  value={form.peso_pieza_min}
                  onChange={e => f('peso_pieza_min')(e.target.value)}
                  placeholder="mín"
                  style={{ flex: 1, background: '#0a0d12', border: '1px solid #1e2530', borderRadius: 8, padding: '9px 12px', color: '#e8f0fe', fontSize: 13, fontFamily: 'inherit', outline: 'none' }}
                />
                <span style={{ color: '#3a4a5a', fontSize: 13 }}>–</span>
                <input
                  type="number" min="0" step="0.01"
                  value={form.peso_pieza_max}
                  onChange={e => f('peso_pieza_max')(e.target.value)}
                  placeholder="máx"
                  style={{ flex: 1, background: '#0a0d12', border: '1px solid #1e2530', borderRadius: 8, padding: '9px 12px', color: '#e8f0fe', fontSize: 13, fontFamily: 'inherit', outline: 'none' }}
                />
              </div>
              {form.peso_pieza_min && form.peso_pieza_max && (
                <div style={{ marginTop: 5, fontSize: 11, color: '#4a6a8a' }}>
                  Cada pieza pesa entre {form.peso_pieza_min} y {form.peso_pieza_max} {form.um_minorista || 'unid.'}
                </div>
              )}
            </div>
            {/* Selector: Categoría */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 8, fontSize: 11, color: '#8899bb', letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: 600 }}>
                Categoría del producto
              </label>
              <div style={{ display: 'flex', gap: 10 }}>
                {[
                  { value: 'carnicos', label: 'Cárnicos', icon: '🥩', bg: '#2a1a0a', border: '#8a4a1a', color: '#f2994a' },
                  { value: 'otros',   label: 'Otros',    icon: '📦', bg: '#0a1a2a', border: '#1a4a6a', color: '#7eb8f7' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => f('categoria')(opt.value)}
                    style={{
                      flex: 1, padding: '10px 14px', borderRadius: 9, cursor: 'pointer',
                      fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
                      background: form.categoria === opt.value ? opt.bg : '#0a0d12',
                      border: `1.5px solid ${form.categoria === opt.value ? opt.border : '#1e2530'}`,
                      color: form.categoria === opt.value ? opt.color : '#3a4a5a',
                      transition: 'all 0.15s',
                    }}
                  >
                    {opt.icon} {opt.label}
                  </button>
                ))}
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: '#3a4a5a' }}>
                Solo los Puntos de Venta con esta categoría recibirán este producto en el resumen minorista.
              </div>
            </div>

            {/* Checkbox: Formato Rango */}
            <div style={{ marginBottom: 16, gridColumn: '1 / -1' }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: '#e8f0fe', cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={form.formato_rango}
                  onChange={(e) => f('formato_rango')(e.target.checked)}
                  style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#f2c94c', marginTop: 2, flexShrink: 0 }}
                />
                <span>
                  <span style={{ fontWeight: 600 }}>Formato Rango</span>
                  <span style={{ color: '#8899bb', fontWeight: 400, marginLeft: 8, fontSize: 11 }}>
                    (en distribución, el precio por pieza se calculará con el peso real dentro del rango {form.peso_pieza_min && form.peso_pieza_max ? `${form.peso_pieza_min}–${form.peso_pieza_max} ${form.um_minorista || 'unid.'}` : 'definido arriba'})
                  </span>
                  {form.formato_rango && !(form.peso_pieza_min && form.peso_pieza_max) && (
                    <div style={{ marginTop: 4, fontSize: 11, color: '#eb5757', background: 'rgba(235,87,87,0.08)', borderRadius: 4, padding: '3px 8px', display: 'inline-block' }}>
                      ⚠ Define el rango de peso para usar esta opción
                    </div>
                  )}
                  {form.formato_rango && form.peso_pieza_min && form.peso_pieza_max && (
                    <div style={{ marginTop: 4, fontSize: 11, color: '#f2c94c', background: 'rgba(242,201,76,0.08)', borderRadius: 4, padding: '3px 8px', display: 'inline-block' }}>
                      Factura: precio pieza = peso real × ${fmt(parseFloat(form.importe) || 0)}/{form.um_minorista || 'unid.'}
                    </div>
                  )}
                </span>
              </label>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 6, fontSize: 11, color: '#8899bb', letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: 600 }}>
                {`Importe Minorista (por ${form.um_minorista || 'UM min.'}) $`}
                {(() => {
                  const auto = Math.round(((parseFloat(form.importe_mayorista) || 0) / (parseFloat(form.formato) || 1)) * 100) / 100;
                  const actual = parseFloat(form.importe) || 0;
                  return actual !== auto && auto > 0
                    ? <span style={{ color: '#f2c94c', fontWeight: 400, marginLeft: 6, fontSize: 10 }}>· auto: ${fmt(auto)}</span>
                    : null;
                })()}
              </label>
              <Input
                value={form.importe}
                onChange={f('importe')}
                type="number" min="0" step="0.01"
                placeholder={fmt((parseFloat(form.importe_mayorista) || 0) / (parseFloat(form.formato) || 1))}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 6, fontSize: 11, color: '#8899bb', letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: 600 }}>Valor Real (automático)</label>
              <div style={{ background: '#0a0d12', border: '1px solid #1e2530', borderRadius: 8, padding: '10px 14px', color: '#bb87fc', fontSize: 13, fontWeight: 700 }}>
                ${fmt(valorReal())}
              </div>
            </div>
            <Input label="Fecha Inicio Disponibilidad" value={form.fecha_inicio} onChange={f('fecha_inicio')} type="date" />
            <Input label="Fecha Fin Disponibilidad" value={form.fecha_fin} onChange={f('fecha_fin')} type="date" />
            <div style={{ marginBottom: 16, gridColumn: '1 / -1' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#e8f0fe', cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={form.activo}
                  onChange={(e) => f('activo')(e.target.checked)}
                  style={{ width: 18, height: 18, cursor: 'pointer' }}
                />
                <span style={{ fontWeight: 600 }}>
                  Producto Activo
                  <span style={{ color: '#8899bb', fontWeight: 400, marginLeft: 8 }}>
                    (Los productos inactivos no aparecerán en el sistema)
                  </span>
                </span>
              </label>
            </div>
          </div>
          {!form.fecha_inicio && (
            <Alert type="warning">Sin fechas definidas, este producto no podrá incluirse en distribuciones.</Alert>
          )}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
            <Btn onClick={() => setShowForm(false)} variant="ghost">Cancelar</Btn>
            <Btn onClick={save} variant="success" disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</Btn>
          </div>
        </Modal>
      )}
      {/* ── Modal: Importar desde Excel ───────────────────────── */}
      {showImport && (
        <Modal title="Importar Productos desde Excel" onClose={() => { setShowImport(false); setImportRows([]); setImportFileName(''); }} width={900}>

          {/* Paso 1: Subir archivo */}
          <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 12, color: '#4a6a8a', marginBottom: 10, lineHeight: 1.6 }}>
              El archivo debe tener columnas: <strong style={{ color: '#7eb8f7' }}>Referencia</strong> (código),{' '}
              <strong style={{ color: '#7eb8f7' }}>Descripción</strong> (nombre),{' '}
              <strong style={{ color: '#7eb8f7' }}>Cantidad</strong> (disponible),{' '}
              <strong style={{ color: '#7eb8f7' }}>UNITARIA</strong> (precio minorista) y{' '}
              <strong style={{ color: '#7eb8f7' }}>VENTA TOTAL</strong> (valor real).
            </p>
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); handleExcelFile(e.dataTransfer.files[0]); }}
              style={{
                border: '2px dashed #2a3a4a', borderRadius: 10, padding: '24px 18px',
                textAlign: 'center', cursor: 'pointer', transition: 'border-color 0.15s',
                background: importFileName ? 'rgba(111,207,151,0.06)' : 'transparent',
              }}
            >
              {importFileName
                ? <><div style={{ fontSize: 24 }}>📄</div><div style={{ color: '#6fcf97', fontWeight: 700, marginTop: 6 }}>{importFileName}</div><div style={{ fontSize: 11, color: '#4a6a8a', marginTop: 4 }}>Haz clic para cambiar el archivo</div></>
                : <><div style={{ fontSize: 28 }}>📥</div><div style={{ color: '#7eb8f7', fontWeight: 700, marginTop: 6 }}>Arrastrá o hacé clic para subir el .xlsx</div><div style={{ fontSize: 11, color: '#3a4a5a', marginTop: 4 }}>Formato de factura DPKTS</div></>
              }
            </div>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
              onChange={e => handleExcelFile(e.target.files[0])} />
          </div>

          {/* Paso 2: Mes y Categoría */}
          {importRows.length > 0 && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px', marginBottom: 16 }}>
                {/* Mes */}
                <div>
                  <label style={{ display: 'block', marginBottom: 6, fontSize: 11, color: '#8899bb', letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: 600 }}>
                    📅 ¿A qué mes corresponde esta factura?
                  </label>
                  <select
                    value={importMes}
                    onChange={e => setImportMes(e.target.value)}
                    style={{ width: '100%', background: '#0a0d12', border: `1.5px solid ${importMes ? '#3a7fc1' : '#eb5757'}`, borderRadius: 8, padding: '9px 12px', color: importMes ? '#e8f0fe' : '#eb5757', fontSize: 13, fontFamily: 'inherit', outline: 'none', cursor: 'pointer' }}
                  >
                    <option value="">-- Seleccioná el mes --</option>
                    {mesOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  {!importMes && <div style={{ fontSize: 11, color: '#eb5757', marginTop: 4 }}>⚠ Requerido para guardar</div>}
                </div>

                {/* Categoría */}
                <div>
                  <label style={{ display: 'block', marginBottom: 8, fontSize: 11, color: '#8899bb', letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: 600 }}>
                    🗂 Categoría de los productos
                  </label>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {[
                      { value: 'carnicos', label: 'Cárnicos', icon: '🥩', bg: '#2a1a0a', border: '#8a4a1a', color: '#f2994a' },
                      { value: 'otros',   label: 'Otros',    icon: '📦', bg: '#0a1a2a', border: '#1a4a6a', color: '#7eb8f7' },
                    ].map(opt => (
                      <button key={opt.value} type="button" onClick={() => setImportCategoria(opt.value)}
                        style={{ flex: 1, padding: '10px 14px', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, background: importCategoria === opt.value ? opt.bg : '#0a0d12', border: `1.5px solid ${importCategoria === opt.value ? opt.border : '#1e2530'}`, color: importCategoria === opt.value ? opt.color : '#3a4a5a', transition: 'all 0.15s' }}>
                        {opt.icon} {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Paso 3: Preview de filas */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: '#4a6a8a', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>
                    Vista previa — {importRows.filter(r => r.importarCheck).length} de {importRows.length} seleccionados
                    {importRows.some(r => r.isDuplicate) && (
                      <span style={{ marginLeft: 10, color: '#f2c94c', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                        · ⚠ {importRows.filter(r => r.isDuplicate).length} código{importRows.filter(r => r.isDuplicate).length > 1 ? 's' : ''} duplicado{importRows.filter(r => r.isDuplicate).length > 1 ? 's' : ''} en el Excel — cantidades sumadas automáticamente
                      </span>
                    )}
                  </span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setImportRows(r => r.map(x => ({ ...x, importarCheck: true  })))} style={{ fontSize: 11, color: '#6fcf97', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 6px' }}>✓ Todo</button>
                    <button onClick={() => setImportRows(r => r.map(x => ({ ...x, importarCheck: false })))} style={{ fontSize: 11, color: '#eb5757', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 6px' }}>✗ Ninguno</button>
                  </div>
                </div>
                <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid #1e2530', borderRadius: 10, background: '#0a0d12' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead style={{ position: 'sticky', top: 0, background: '#080b10', zIndex: 1 }}>
                      <tr>
                        <th style={{ padding: '8px 10px', textAlign: 'center', color: '#4a6a8a', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.7, borderBottom: '1px solid #1e2530', width: 36 }}></th>
                        <th style={{ padding: '8px 10px', textAlign: 'left',   color: '#4a6a8a', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.7, borderBottom: '1px solid #1e2530' }}>Código (Ref.)</th>
                        <th style={{ padding: '8px 10px', textAlign: 'left',   color: '#4a6a8a', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.7, borderBottom: '1px solid #1e2530' }}>Descripción</th>
                        <th style={{ padding: '8px 10px', textAlign: 'right',  color: '#4a6a8a', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.7, borderBottom: '1px solid #1e2530' }}>Disponible</th>
                        <th style={{ padding: '8px 10px', textAlign: 'right',  color: '#f2c94c', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.7, borderBottom: '1px solid #1e2530' }}>Precio Unit. $</th>
                        <th style={{ padding: '8px 10px', textAlign: 'right',  color: '#bb87fc', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.7, borderBottom: '1px solid #1e2530' }}>Total (valor real)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importRows.map((r, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #111620', opacity: r.importarCheck ? 1 : 0.35 }}>
                          <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                            <input type="checkbox" checked={r.importarCheck} onChange={e => updateImportRow(idx, 'importarCheck', e.target.checked)}
                              style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#6fcf97' }} />
                          </td>
                          <td style={{ padding: '6px 10px', color: '#7eb8f7', fontWeight: 700 }}>
                            {r.codigo}
                            {r.isDuplicate && (
                              <span style={{ marginLeft: 6, fontSize: 10, background: 'rgba(242,201,76,0.15)', color: '#f2c94c', border: '1px solid rgba(242,201,76,0.3)', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>
                                ×2 fusionado
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '6px 10px', color: '#c8d8f0' }}>{r.producto}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', color: '#6fcf97', fontWeight: 700 }}>{fmt(r.disponible)}</td>
                          {/* Precio unitario: editable */}
                          <td style={{ padding: '4px 6px', textAlign: 'right' }}>
                            <input
                              type="number" min="0" step="0.01"
                              value={r.importe}
                              onChange={e => updateImportRow(idx, 'importe', e.target.value)}
                              style={{ width: 90, background: '#0e1117', border: '1px solid #2a3a4a', borderRadius: 6, padding: '4px 8px', color: '#f2c94c', fontSize: 12, fontFamily: 'inherit', textAlign: 'right', outline: 'none' }}
                            />
                          </td>
                          {/* Total: editable (solo informativo, no se guarda en BD) */}
                          <td style={{ padding: '4px 6px', textAlign: 'right' }}>
                            <input
                              type="number" min="0" step="0.01"
                              value={r.total}
                              onChange={e => updateImportRow(idx, 'total', e.target.value)}
                              style={{ width: 110, background: '#0e1117', border: '1px solid #2a3a4a', borderRadius: 6, padding: '4px 8px', color: '#bb87fc', fontSize: 12, fontFamily: 'inherit', textAlign: 'right', outline: 'none' }}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {importMes && (
                <div style={{ fontSize: 12, color: '#4a6a8a', marginBottom: 14, background: 'rgba(30,37,48,0.6)', borderRadius: 8, padding: '8px 14px' }}>
                  Se crearán <strong style={{ color: '#6fcf97' }}>{importRows.filter(r => r.importarCheck).length} productos</strong> con período{' '}
                  <strong style={{ color: '#7eb8f7' }}>{mesOptions.find(o => o.value === importMes)?.label}</strong>,{' '}
                  categoría <strong style={{ color: importCategoria === 'carnicos' ? '#f2994a' : '#7eb8f7' }}>{importCategoria}</strong>,{' '}
                  UM Mayor./Min. = <em>Unidad</em>, Formato = 1.
                </div>
              )}
            </>
          )}

          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
            <Btn onClick={() => { setShowImport(false); setImportRows([]); setImportFileName(''); }} variant="ghost">Cancelar</Btn>
            {importRows.length > 0 && (
              <Btn onClick={saveImport} variant="success" disabled={importSaving || !importMes}>
                {importSaving ? 'Guardando...' : `Guardar ${importRows.filter(r => r.importarCheck).length} productos`}
              </Btn>
            )}
          </div>
        </Modal>
      )}

    </div>
  );
}