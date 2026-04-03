import { useState, useEffect } from 'react';

export function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export const fmt = (n) =>
  new Intl.NumberFormat('es-CU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

export const fmtDate = (d) => {
  if (!d) return '—';
  
  // Si ya es un objeto Date, formatear directamente
  if (d instanceof Date) {
    if (isNaN(d.getTime())) return 'Invalid Date';
    return d.toLocaleDateString('es-CU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  
  // Si es string, convertir a Date
  let dateObj;
  
  // Si ya contiene 'T' (formato ISO con hora), usar directamente
  if (typeof d === 'string' && d.includes('T')) {
    dateObj = new Date(d);
  }
  // Si es formato ISO solo fecha (YYYY-MM-DD), agregar hora
  else if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    dateObj = new Date(d + 'T00:00:00');
  }
  // Si es formato DD/MM/YYYY, convertir
  else if (typeof d === 'string' && /^\d{1,2}\/\d{1,2}\/\d{4}/.test(d)) {
    const [day, month, year] = d.split('/');
    dateObj = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00`);
  }
  // Cualquier otro caso
  else {
    dateObj = new Date(d);
  }
  
  // Verificar validez
  if (isNaN(dateObj.getTime())) {
    console.warn('Fecha inválida:', d);
    return 'Invalid Date';
  }
  
  return dateObj.toLocaleDateString('es-CU', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export const estadoProducto = (p) => {
  if (!p.fecha_inicio || !p.fecha_fin) return { label: 'Sin fechas', color: 'gray' };
  const now = new Date();
  const fi = new Date(p.fecha_inicio);
  const ff = new Date(p.fecha_fin + 'T23:59:59');
  if (now < fi) return { label: 'Pendiente', color: 'yellow' };
  if (now > ff) return { label: 'Expirado', color: 'red' };
  return { label: 'Activo', color: 'green' };
};

export const COLORS = {
  blue: { bg: '#1a3a5c', text: '#7eb8f7', border: '#2a5080' },
  green: { bg: '#1a3a2a', text: '#6fcf97', border: '#2a5040' },
  red: { bg: '#3a1a1a', text: '#eb5757', border: '#5a2a2a' },
  yellow: { bg: '#3a321a', text: '#f2c94c', border: '#5a4a2a' },
  purple: { bg: '#2a1a3a', text: '#bb87fc', border: '#4a2a6a' },
  gray: { bg: '#1e2530', text: '#8899bb', border: '#2a3040' },
  cyan: { bg: '#1a2f35', text: '#56cfe1', border: '#2a4a55' },
};
