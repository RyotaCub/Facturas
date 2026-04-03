const BASE = '/api';

async function request(path, options = {}) {
  const token = localStorage.getItem('token');
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json();

  // Si el token expiró o es inválido, limpiar sesión y notificar al App
  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('usuario');
    window.dispatchEvent(new Event('session-expired'));
    throw new Error(data.error || 'Sesión expirada. Por favor iniciá sesión nuevamente.');
  }

  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

export const api = {
  // Productos
  getProductos: () => request('/productos'),
  createProducto: (body) => request('/productos', { method: 'POST', body }),
  updateProducto: (id, body) => request(`/productos/${id}`, { method: 'PUT', body }),
  deleteProducto: (id) => request(`/productos/${id}`, { method: 'DELETE' }),

  // Transferencias
  getTransferencias: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/transferencias${q ? '?' + q : ''}`);
  },
  getTransferenciasStats: () => request('/transferencias/stats'),
  getTransferenciasPrefijos: () => request('/transferencias/prefijos'),
  getClientes: () => request('/transferencias/clientes'),
  updateTransferencia: (id, body) => request(`/transferencias/${id}`, { method: 'PATCH', body }),
  deleteTransferenciasBulk: (body) => request('/transferencias/bulk', { method: 'DELETE', body }),
  deleteTransferenciasByIds: (ids) => request('/transferencias/by-ids', { method: 'DELETE', body: { ids } }),

  // Vendedores
  getVendedores: () => request('/vendedores'),
  createVendedor: (body) => request('/vendedores', { method: 'POST', body }),
  updateVendedor: (id, body) => request(`/vendedores/${id}`, { method: 'PUT', body }),
  deleteVendedor: (id) => request(`/vendedores/${id}`, { method: 'DELETE' }),

  // Puntos de Venta
  getPuntosVenta: () => request('/puntos-venta'),
  getPuntosVentaActivos: () => request('/puntos-venta/activos'),
  createPuntoVenta: (body) => request('/puntos-venta', { method: 'POST', body }),
  updatePuntoVenta: (id, body) => request(`/puntos-venta/${id}`, { method: 'PUT', body }),
  deletePuntoVenta: (id) => request(`/puntos-venta/${id}`, { method: 'DELETE' }),
  validarPorcentajes: (body) => request('/puntos-venta/validar-porcentajes', { method: 'POST', body }),

  // Autenticación
  login: (body) => request('/auth/login', { method: 'POST', body }),
  me: () => request('/auth/me'),

  // Distribución
  calcularDistribucion:   (body) => request('/distribucion/calcular',             { method: 'POST', body }),
  confirmarDistribucion:  (body) => request('/distribucion/confirmar',             { method: 'POST', body }),
  recalcularMinorista:    (body) => request('/distribucion/recalcular-minorista',  { method: 'POST', body }),

  // Facturas
  getFacturas: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/facturas${q ? '?' + q : ''}`);
  },
  getFactura: (id) => request(`/facturas/${id}`),
  getFacturasAnuladas: () => request('/facturas/anuladas/lista'),
  deleteFactura: (id, motivo) => request(`/facturas/${id}`, { method: 'DELETE', body: motivo ? { motivo } : undefined }),
  getResumenesMinoristas: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/facturas/resumenes/minoristas${q ? '?' + q : ''}`);
  },
  deleteResumenMinorista: (id) => request(`/facturas/resumenes/minoristas/${id}`, { method: 'DELETE' }),
  getPeriodos: () => request('/facturas/periodos/list'),

  // BANDEC PDF Converter
  convertBandecPdf: (pdf_base64, filename, formato = null) => request('/bandec/convert', { method: 'POST', body: { pdf_base64, filename, ...(formato ? { formato } : {}) } }),
  extractBandecToDb: (txt, borrar_existentes = false, formato = 'v1') => request('/bandec/extract-to-db', { method: 'POST', body: { txt, borrar_existentes, formato } }),
  getBandecTitulares: (fechaInicio, fechaFin) => request(`/bandec/titulares?fecha_inicio=${encodeURIComponent(fechaInicio)}&fecha_fin=${encodeURIComponent(fechaFin)}`),

  // Clientes
  getClientesList:       ()        => request('/clientes'),
  getClientesDuplicados: ()        => request('/clientes/duplicados'),
  createCliente:         (body)    => request('/clientes', { method: 'POST', body }),
  updateCliente:         (id,body) => request(`/clientes/${id}`, { method: 'PUT', body }),
  deleteCliente:         (id)      => request(`/clientes/${id}`, { method: 'DELETE' }),
  syncClientes:          ()        => request('/clientes/sync', { method: 'POST' }),

  // Health
  health: () => request('/health'),

  // Reset (TESTING ONLY)
  resetSystem: (fecha_inicio, fecha_fin) => request('/reset', { method: 'POST', body: { fecha_inicio, fecha_fin } }),
};