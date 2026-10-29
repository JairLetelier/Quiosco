/*
 * Frontend de caja / quiosco (GitHub Pages) <-> Google Apps Script (JSONP).
 * Compatible con Code.gs: respuestas {ok:true, ...} / {ok:false, error:"..."}.
 */
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwWeLuog6xGCW7-NCIHjFcB0gCgoHM2iw7FMUFKqzfQLxeqcRwK19s68PGNcArLB74F/exec';

let currentType = 'INGRESO';
const charts = {};
let historialEnCurso = null;
let dashboardEnCurso = null;

const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const form = document.getElementById('registro-form');
const btnGuardar = document.getElementById('btn-guardar');
const btnCancelar = document.getElementById('btn-cancelar');
const campoFecha = document.getElementById('fecha');
const MONEDA = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });

function formatoCLP(valor) {
  return '$' + MONEDA.format(Number(valor) || 0);
}

function fechaLocalISO() {
  const a = new Date();
  return `${a.getFullYear()}-${String(a.getMonth() + 1).padStart(2, '0')}-${String(a.getDate()).padStart(2, '0')}`;
}

function parseMontoCLP(valor) {
  const texto = String(valor ?? '').trim().replace(/\$/g, '').replace(/\s/g, '');

  if (!texto) return 0;

  if (!/^\d{1,3}(\.\d{3})+$/.test(texto) && !/^\d+$/.test(texto)) {
    throw new Error('Monto inválido. Ejemplo correcto: 59.000');
  }

  const numero = Number(texto.replace(/\./g, ''));

  if (!Number.isSafeInteger(numero) || numero < 0) {
    throw new Error('El monto ingresado no es válido.');
  }

  return numero;
}

function leerMonto(id) {
  return parseMontoCLP(document.getElementById(id).value);
}

if (campoFecha && !campoFecha.value) campoFecha.value = fechaLocalISO();

/* ---------- Respuestas del backend ---------- */

function respuestaExitosa(r) {
  return !!r && (r.ok === true || r.status === 'success');
}

function mensajeRespuesta(r, alternativo) {
  return r?.error || r?.message || r?.mensaje || alternativo;
}

function normalizarFecha(valor) {
  const s = String(valor ?? '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);

  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const local = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);

  if (local) {
    return `${local[3]}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}`;
  }

  return s;
}

function normalizarRegistro(r) {
  const efectivo = Number(r?.efectivo) || 0;
  const tarjeta = Number(r?.tarjeta) || 0;

  return {
    ...r,
    id: String(r?.id ?? ''),
    hoja: String(r?.hoja ?? ''),
    fecha: normalizarFecha(r?.fecha),
    tipo: String(r?.tipo ?? '').toUpperCase(),
    efectivo,
    tarjeta,
    total: Number(r?.total) || (efectivo + tarjeta),
    detalle: String(r?.detalle ?? r?.observacion ?? '')
  };
}

function registrosRespuesta(r) {
  const lista = Array.isArray(r?.registros) ? r.registros : [];
  return lista.map(normalizarRegistro);
}

/* ---------- Comunicación JSONP con Apps Script ---------- */

function fetchGoogle(payload) {
  return new Promise((resolve, reject) => {
    const callbackName = 'gsCallback_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const script = document.createElement('script');
    let terminado = false;

    const timeout = setTimeout(() => {
      cleanup(new Error(
        'Sin respuesta de Apps Script. Revisa que la implementación esté en acceso "Cualquier persona" ' +
        'y que hayas publicado una versión nueva.'
      ));
    }, 40000);

    function cleanup(error, resultado) {
      if (terminado) return;
      terminado = true;

      clearTimeout(timeout);
      delete window[callbackName];

      if (script.parentNode) script.parentNode.removeChild(script);

      if (error) reject(error);
      else resolve(resultado);
    }

    window[callbackName] = resultado => cleanup(null, resultado);
    script.onerror = () => cleanup(new Error('No se pudo conectar con Google Apps Script.'));

    const params = new URLSearchParams({
      data: JSON.stringify(payload),
      callback: callbackName
    });

    script.src = `${GOOGLE_SCRIPT_URL}?${params.toString()}`;
    document.head.appendChild(script);
  });
}

// Llamada autenticada: agrega el PIN y convierte {ok:false} en error.
async function api(payload, pinManual) {
  const pin = pinManual || localStorage.getItem('quiosco_pin');

  if (!pin) throw new Error('Tu sesión expiró. Vuelve a ingresar.');

  const r = await fetchGoogle({ ...payload, pin });

  if (!respuestaExitosa(r)) {
    const msg = mensajeRespuesta(r, 'Google Apps Script no confirmó la operación.');

    if (!pinManual && /PIN/i.test(msg)) {
      localStorage.removeItem('quiosco_pin');
      setTimeout(() => location.reload(), 1500);
    }

    throw new Error(msg);
  }

  return r;
}

/* ---------- Login ---------- */

function entrarALaApp() {
  loginScreen?.classList.remove('active');
  appScreen?.classList.remove('hidden');
  appScreen?.classList.add('active');
  asegurarInterfazDashboard();
}

document.getElementById('btn-login')?.addEventListener('click', async () => {
  const pin = document.getElementById('pin-input').value.trim();
  const error = document.getElementById('login-error');

  if (!pin) {
    error.innerText = 'Ingresa tu PIN.';
    error.classList.remove('hidden');
    return;
  }

  try {
    await api({ action: 'get' }, pin);

    localStorage.setItem('quiosco_pin', pin);
    error.classList.add('hidden');
    entrarALaApp();
    await cargarHistorial();
  } catch (e) {
    error.innerText = e.message || 'No se pudo conectar con el servidor.';
    error.classList.remove('hidden');
  }
});

document.getElementById('pin-input')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-login')?.click();
});

document.getElementById('btn-logout')?.addEventListener('click', () => {
  localStorage.removeItem('quiosco_pin');
  location.reload();
});

/* ---------- Navegación ---------- */

function switchView(view) {
  document.querySelectorAll('.view-section').forEach(el => {
    const activo = el.id === 'view-' + view;

    el.classList.toggle('active', activo);
    el.classList.toggle('hidden', !activo);
  });

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle(
      'active',
      (btn.getAttribute('onclick') || '').includes("'" + view + "'")
    );
  });

  if (view === 'historial') cargarHistorial();

  if (view === 'dashboard') {
    renderizarDashboard().catch(e => mostrarAviso(e.message || 'No se pudo cargar el panel.', 'error'));
  }
}

window.switchView = switchView;

/* ---------- Tipo de movimiento ---------- */

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', e => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    e.currentTarget.classList.add('active');

    currentType = String(e.currentTarget.dataset.target || 'ingreso').toUpperCase();
    actualizarEtiquetaDetalle();
  });
});

function actualizarEtiquetaDetalle() {
  const inversion = currentType === 'INVERSION';
  const etiqueta = document.getElementById('label-detalle');
  const detalle = document.getElementById('detalle');

  if (etiqueta) {
    etiqueta.innerText = inversion
      ? 'Proveedor (Requerido)'
      : 'Observaciones (Opcional)';
  }

  if (detalle) detalle.required = inversion;
}

/* ---------- Guardar / editar ---------- */

form?.addEventListener('submit', async e => {
  e.preventDefault();

  const editInput = document.getElementById('edit-id');
  const editId = editInput.value.trim();
  let efectivo, tarjeta;

  try {
    efectivo = leerMonto('efectivo');
    tarjeta = leerMonto('tarjeta');
  } catch (err) {
    mostrarEstado(err.message, 'error');
    return;
  }

  if (!campoFecha.value) {
    mostrarEstado('Selecciona una fecha.', 'error');
    return;
  }

  const payload = {
    action: editId ? 'update' : 'insert',
    id: editId,
    tipo: currentType,
    fecha: campoFecha.value,
    efectivo,
    tarjeta,
    detalle: document.getElementById('detalle').value.trim()
  };

  if (editId) {
    payload.hoja = editInput.dataset.hoja || '';
    payload.fechaOriginal = editInput.dataset.fecha || campoFecha.value;
  }

  btnGuardar.disabled = true;
  btnGuardar.innerText = 'Guardando...';
  mostrarEstado('', '');

  try {
    const r = await api(payload);
    const lista = registrosRespuesta(r);

    resetFormulario();
    mostrarEstado(
      mensajeRespuesta(r, editId ? 'Registro actualizado correctamente.' : 'Registro guardado correctamente.'),
      'success'
    );

    if (lista.length) pintarHistorial(lista.slice(0, 10));
  } catch (err) {
    mostrarEstado(err.message || 'No se pudo guardar el registro.', 'error');
  } finally {
    btnGuardar.disabled = false;
    btnGuardar.innerText = document.getElementById('edit-id').value
      ? 'Actualizar Registro'
      : 'Guardar en Sheets';
  }
});

/* ---------- Historial ---------- */

function cargarHistorial() {
  if (historialEnCurso) return historialEnCurso;

  historialEnCurso = (async () => {
    const container = document.getElementById('historial-lista');

    if (!container || !localStorage.getItem('quiosco_pin')) return;

    container.innerHTML = '<p style="text-align:center">Cargando últimos movimientos...</p>';

    try {
      const r = await api({ action: 'get' });
      pintarHistorial(registrosRespuesta(r).slice(0, 10));
    } catch (err) {
      container.innerHTML = `<p style="text-align:center;color:#dc2626">${escapeHtml(err.message || 'Error al cargar el historial.')}</p>`;
    }
  })().finally(() => { historialEnCurso = null; });

  return historialEnCurso;
}

function pintarHistorial(registros) {
  const container = document.getElementById('historial-lista');

  if (!container) return;

  if (!registros.length) {
    container.innerHTML = '<p style="text-align:center">No hay registros todavía.</p>';
    return;
  }

  container.innerHTML = '';

  registros.forEach(reg => {
    const item = document.createElement('div');

    item.className = 'registro-item';
    item.innerHTML = `
      <div class="registro-info">
        <h4>
          <span class="badge ${escapeHtml(reg.tipo.toLowerCase())}">${escapeHtml(reg.tipo)}</span>
          ${formatoCLP(reg.total)}
        </h4>
        <p>📅 ${escapeHtml(reg.fecha)} | Efectivo: ${formatoCLP(reg.efectivo)} | Tarjeta: ${formatoCLP(reg.tarjeta)}</p>
        <p><i>${escapeHtml(reg.detalle || 'Sin detalle')}</i></p>
      </div>
      <button class="btn-edit" type="button">✎ Editar</button>
    `;

    item.querySelector('.btn-edit').addEventListener('click', () => prepararEdicion(reg));
    container.appendChild(item);
  });
}

/* ---------- Edición ---------- */

function prepararEdicion(registro) {
  const r = normalizarRegistro(registro);
  const editInput = document.getElementById('edit-id');

  editInput.value = r.id;
  editInput.dataset.hoja = r.hoja;
  editInput.dataset.fecha = r.fecha;

  document.getElementById('form-title').innerText = 'Editando registro';
  campoFecha.value = r.fecha;
  campoFecha.readOnly = true;

  document.getElementById('efectivo').value = MONEDA.format(r.efectivo);
  document.getElementById('tarjeta').value = MONEDA.format(r.tarjeta);
  document.getElementById('detalle').value = r.detalle;

  currentType = r.tipo || 'INGRESO';

  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.toggle(
      'active',
      String(tab.dataset.target || '').toUpperCase() === currentType
    );
  });

  actualizarEtiquetaDetalle();

  btnGuardar.innerText = 'Actualizar Registro';
  btnGuardar.style.backgroundColor = '#059669';
  btnCancelar?.classList.remove('hidden');

  switchView('formulario');
  document.getElementById('form-title').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

window.prepararEdicion = prepararEdicion;

btnCancelar?.addEventListener('click', resetFormulario);

function resetFormulario() {
  form?.reset();

  const editInput = document.getElementById('edit-id');

  editInput.value = '';
  delete editInput.dataset.hoja;
  delete editInput.dataset.fecha;

  document.getElementById('form-title').innerText = 'Nuevo Registro';
  campoFecha.value = fechaLocalISO();
  campoFecha.readOnly = false;
  currentType = 'INGRESO';

  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.toggle(
      'active',
      String(tab.dataset.target || '').toUpperCase() === 'INGRESO'
    );
  });

  actualizarEtiquetaDetalle();
  btnGuardar.innerText = 'Guardar en Sheets';
  btnGuardar.style.backgroundColor = '';
  btnCancelar?.classList.add('hidden');
}

function mostrarEstado(mensaje, tipo) {
  const el = document.getElementById('status-message');

  if (!el) return;

  if (!mensaje) {
    el.classList.add('hidden');
    el.innerText = '';
    return;
  }

  el.innerText = mensaje;
  el.className = `status-msg ${tipo}`;
}

function mostrarAviso(mensaje, tipo) {
  const el = document.getElementById('aviso-anual');

  if (!el) return;

  if (!mensaje) {
    el.classList.add('hidden');
    el.innerText = '';
    return;
  }

  el.innerText = mensaje;
  el.className = `status-msg ${tipo || ''}`;
}

function escapeHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

/* ---------- Resúmenes y gráficos ---------- */

function asegurarInterfazDashboard() {
  const contenedor = document.getElementById('resumenes-periodo');

  if (!contenedor || document.getElementById('resumen-periodos')) return;

  const panel = document.createElement('div');

  panel.id = 'resumen-periodos';
  panel.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;';

  panel.innerHTML = `
    <div class="card resumen-periodo">
      <h4>Semana actual</h4>
      <p>Ingresos: <strong id="sem-ingresos">$0</strong></p>
      <p>Inversiones: <strong id="sem-inversiones">$0</strong></p>
      <p>Ganancia neta: <strong id="sem-neta">$0</strong></p>
      <small id="sem-fechas"></small>
    </div>
    <div class="card resumen-periodo">
      <h4>Mes actual</h4>
      <p>Ingresos: <strong id="mes-ingresos">$0</strong></p>
      <p>Inversiones: <strong id="mes-inversiones">$0</strong></p>
      <p>Ganancia neta: <strong id="mes-neta">$0</strong></p>
      <small id="mes-nombre"></small>
    </div>
    <div class="card resumen-periodo">
      <h4>Año <span id="anio-titulo"></span></h4>
      <p>Ingresos: <strong id="anio-ingresos">$0</strong></p>
      <p>Inversiones: <strong id="anio-inversiones">$0</strong></p>
      <p>Ganancia neta: <strong id="anio-neta">$0</strong></p>
    </div>
    <div class="card resumen-periodo">
      <h4>Acumulado histórico</h4>
      <p>Ingresos: <strong id="hist-ingresos">$0</strong></p>
      <p>Inversiones: <strong id="hist-inversiones">$0</strong></p>
      <p>Ganancia neta: <strong id="hist-neta">$0</strong></p>
    </div>
  `;

  contenedor.appendChild(panel);
}

function renderizarDashboard() {
  if (dashboardEnCurso) return dashboardEnCurso;
  if (!localStorage.getItem('quiosco_pin')) return Promise.resolve();

  dashboardEnCurso = (async () => {
    asegurarInterfazDashboard();
    mostrarAviso('Cargando resúmenes...', '');

    const r = await api({ action: 'get_dashboard' });

    const s = r.semanal || {};
    const m = r.mensual || {};
    const a = r.anual || {};
    const h = r.acumulado || {};

    ponerTexto('sem-ingresos', formatoCLP(s.ingresos));
    ponerTexto('sem-inversiones', formatoCLP(s.inversiones));
    ponerTexto('sem-neta', formatoCLP(s.neta));
    ponerTexto('sem-fechas', s.inicio && s.fin ? `${s.inicio} al ${s.fin}` : '');

    ponerTexto('mes-ingresos', formatoCLP(m.ingresos));
    ponerTexto('mes-inversiones', formatoCLP(m.inversiones));
    ponerTexto('mes-neta', formatoCLP(m.neta));
    ponerTexto('mes-nombre', m.mes || '');

    ponerTexto('anio-titulo', a.anio || '');
    ponerTexto('anio-ingresos', formatoCLP(a.ingresos));
    ponerTexto('anio-inversiones', formatoCLP(a.inversiones));
    ponerTexto('anio-neta', formatoCLP(a.neta));

    ponerTexto('hist-ingresos', formatoCLP(h.ingresos));
    ponerTexto('hist-inversiones', formatoCLP(h.inversiones));
    ponerTexto('hist-neta', formatoCLP(h.neta));

    ponerTexto('kpi-ingresos', formatoCLP(m.ingresos));
    ponerTexto('kpi-inversion', formatoCLP(m.inversiones));
    ponerTexto('kpi-neta', formatoCLP(m.neta));

    if (typeof Chart === 'undefined') {
      mostrarAviso('No se pudo cargar la librería de gráficos (Chart.js). Revisa tu conexión.', 'error');
      return;
    }

    dibujarGrafico('semanal', 'graficoSemanal', s);
    dibujarGrafico('mensual', 'graficoMensual', m);
    dibujarGrafico('anual', 'graficoAnual', a);

    mostrarAviso('', '');
  })().finally(() => { dashboardEnCurso = null; });

  return dashboardEnCurso;
}

function ponerTexto(id, texto) {
  const el = document.getElementById(id);

  if (el) el.innerText = texto;
}

function dibujarGrafico(clave, canvasId, datos) {
  const canvas = document.getElementById(canvasId);

  if (!canvas) return;

  if (charts[clave]) charts[clave].destroy();

  charts[clave] = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: datos.etiquetas || [],
      datasets: [
        {
          label: 'Ingresos',
          data: datos.serieIngresos || [],
          backgroundColor: '#1E3A8A',
          borderRadius: 3
        },
        {
          label: 'Inversiones',
          data: datos.serieInversiones || [],
          backgroundColor: '#DC2626',
          borderRadius: 3
        },
        {
          label: 'Ganancia neta',
          data: datos.serieNeta || [],
          type: 'line',
          borderColor: '#059669',
          backgroundColor: '#059669',
          borderWidth: 2,
          tension: 0.25
        }
      ]
    },
    options: opcionesMonetarias()
  });
}

function opcionesMonetarias() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'bottom', labels: { boxWidth: 12 } },
      tooltip: {
        callbacks: { label: c => `${c.dataset.label}: ${formatoCLP(c.raw)}` }
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: { callback: v => '$' + MONEDA.format(Number(v) || 0) }
      }
    }
  };
}

window.cargarHistorial = cargarHistorial;
window.renderizarDashboard = renderizarDashboard;

/* ---------- Sesión guardada ---------- */

if (localStorage.getItem('quiosco_pin')) {
  entrarALaApp();
}
