/*
 * Frontend de caja / quiosco.
 * Compatible con respuestas de Apps Script en formato antiguo {ok:true, registros:[]}
 * y formato nuevo {status:'success', data:[]}.
 * La URL se puede cambiar aquí cuando corresponda.
 */
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbybZCSbJfb4WUjaKc1zDMha2LUt9-XKokTKWCItOgerUhexVNJnUJNIDaYrmeu0bSF8/exec';

let currentType = 'INGRESO';
let chartSemanal = null;
let chartResumenMensual = null;
let chartAnual = null;

const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const form = document.getElementById('registro-form');
const btnGuardar = document.getElementById('btn-guardar');
const btnCancelar = document.getElementById('btn-cancelar');
const campoFecha = document.getElementById('fecha');
const MONEDA = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });
const MESES = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];

function formatoCLP(valor) {
  return '$' + MONEDA.format(Number(valor) || 0);
}

function fechaLocalISO() {
  const ahora = new Date();
  return `${ahora.getFullYear()}-${String(ahora.getMonth()+1).padStart(2,'0')}-${String(ahora.getDate()).padStart(2,'0')}`;
}

function parseMontoCLP(valor) {
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor) || valor < 0 || !Number.isInteger(valor)) {
      throw new Error('Ingresa un monto válido en pesos chilenos.');
    }
    return valor;
  }

  let texto = String(valor ?? '').trim().replace(/\$/g,'').replace(/\s/g,'');
  if (!texto) return 0;

  if (!/^\d{1,3}(\.\d{3})+$/.test(texto) && !/^\d+$/.test(texto)) {
    throw new Error('Monto inválido. Ejemplo correcto: 59.000');
  }

  const numero = Number(texto.replace(/\./g,''));
  if (!Number.isSafeInteger(numero) || numero < 0) {
    throw new Error('El monto ingresado no es válido.');
  }

  return numero;
}

function leerMonto(id) {
  return parseMontoCLP(document.getElementById(id).value);
}

if (campoFecha && !campoFecha.value) {
  campoFecha.value = fechaLocalISO();
}

// Admite los dos contratos de respuesta que han usado las versiones del backend.
function respuestaExitosa(r) {
  return !!r && (r.status === 'success' || r.ok === true);
}

function mensajeRespuesta(r, alternativo) {
  return r?.message || r?.mensaje || alternativo;
}

function registrosRespuesta(r) {
  const lista = Array.isArray(r?.data)
    ? r.data
    : (Array.isArray(r?.registros)
      ? r.registros
      : (Array.isArray(r?.historial) ? r.historial : []));

  return lista.map(normalizarRegistro)
    .sort((a,b) => fechaOrden(b.fecha) - fechaOrden(a.fecha));
}

function normalizarRegistro(r) {
  return {
    ...r,
    id: r?.id ?? r?.ID ?? '',
    fecha: normalizarFecha(r?.fecha ?? r?.Fecha ?? ''),
    tipo: String(r?.tipo ?? r?.Tipo ?? '').toUpperCase(),
    efectivo: Number(r?.efectivo ?? r?.Efectivo ?? 0) || 0,
    tarjeta: Number(r?.tarjeta ?? r?.Tarjeta ?? 0) || 0,
    total: Number(
      r?.total ??
      r?.Total ??
      ((Number(r?.efectivo ?? r?.Efectivo) || 0) +
       (Number(r?.tarjeta ?? r?.Tarjeta) || 0))
    ) || 0,
    detalle: String(
      r?.detalle ??
      r?.observacion ??
      r?.['Observación / Proveedor'] ??
      r?.Observacion ??
      ''
    )
  };
}

function normalizarFecha(valor) {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return `${valor.getFullYear()}-${String(valor.getMonth()+1).padStart(2,'0')}-${String(valor.getDate()).padStart(2,'0')}`;
  }

  const s = String(valor ?? '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);

  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const local = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);

  if (local) {
    return `${local[3]}-${String(local[2]).padStart(2,'0')}-${String(local[1]).padStart(2,'0')}`;
  }

  return s;
}

function fechaOrden(valor) {
  const t = Date.parse(`${normalizarFecha(valor)}T12:00:00`);
  return Number.isFinite(t) ? t : 0;
}

// Comunicación JSONP con Apps Script.
function fetchGoogle(payload) {
  return new Promise((resolve,reject) => {
    const callbackName = 'gsCallback_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const script = document.createElement('script');
    let terminado = false;

    const timeout = setTimeout(() => {
      cleanup(new Error('Tiempo de espera agotado. Revisa la conexión y la implementación de Apps Script.'));
    }, 20000);

    function cleanup(error, resultado) {
      if (terminado) return;
      terminado = true;

      clearTimeout(timeout);
      delete window[callbackName];

      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }

      if (error) reject(error);
      else resolve(resultado);
    }

    window[callbackName] = resultado => cleanup(null, resultado);

    script.onerror = () => {
      cleanup(new Error('No se pudo obtener respuesta de Google Apps Script.'));
    };

    const params = new URLSearchParams({
      data: JSON.stringify(payload),
      callback: callbackName
    });

    script.src = `${GOOGLE_SCRIPT_URL}?${params.toString()}`;
    document.head.appendChild(script);
  });
}

async function enviarEscritura(payload) {
  const r = await fetchGoogle(payload);

  if (!respuestaExitosa(r)) {
    throw new Error(mensajeRespuesta(r,'Google Apps Script no confirmó la operación.'));
  }

  return r;
}

// LOGIN
document.getElementById('btn-login')?.addEventListener('click', async () => {
  const pin = document.getElementById('pin-input').value.trim();
  const error = document.getElementById('login-error');

  if (!pin || pin.length < 6) {
    error.innerText = 'Ingresa tu PIN.';
    error.classList.remove('hidden');
    return;
  }

  try {
    const r = await fetchGoogle({
      pin,
      action:'get',
      fecha:campoFecha?.value || fechaLocalISO()
    });

    if (!respuestaExitosa(r)) {
      error.innerText = mensajeRespuesta(r,'PIN incorrecto.');
      error.classList.remove('hidden');
      return;
    }

    localStorage.setItem('quiosco_pin',pin);
    error.classList.add('hidden');
    loginScreen?.classList.remove('active');
    appScreen?.classList.remove('hidden');
    appScreen?.classList.add('active');

    asegurarInterfazDashboard();
    await cargarHistorial();
    await renderizarDashboard();
  } catch(e) {
    error.innerText = e.message || 'No se pudo conectar con el servidor.';
    error.classList.remove('hidden');
  }
});

document.getElementById('btn-logout')?.addEventListener('click', () => {
  localStorage.removeItem('quiosco_pin');
  location.reload();
});

// NAVEGACIÓN
function switchView(view) {
  document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('view-' + view)?.classList.add('active');

  const btn = Array.from(document.querySelectorAll('.nav-btn'))
    .find(el => (el.getAttribute('onclick') || '').includes("'" + view + "'"));

  btn?.classList.add('active');

  if (view === 'historial') cargarHistorial();

  if (view === 'dashboard') {
    renderizarDashboard().catch(e => mostrarEstado(e.message,'error'));
  }
}

window.switchView = switchView;

// TIPO DE MOVIMIENTO
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

// GUARDAR / EDITAR
form?.addEventListener('submit', async e => {
  e.preventDefault();

  const pin = localStorage.getItem('quiosco_pin');

  if (!pin) {
    mostrarEstado('Tu sesión expiró. Vuelve a ingresar.','error');
    return;
  }

  const editId = document.getElementById('edit-id').value.trim();
  let efectivo, tarjeta;

  try {
    efectivo = leerMonto('efectivo');
    tarjeta = leerMonto('tarjeta');
  } catch(err) {
    mostrarEstado(err.message,'error');
    return;
  }

  const payload = {
    pin,
    action:editId ? 'update' : 'insert',
    id:editId,
    tipo:currentType,
    fecha:campoFecha.value,
    efectivo,
    tarjeta,
    detalle:document.getElementById('detalle').value.trim()
  };

  if (!payload.fecha) {
    mostrarEstado('Selecciona una fecha.','error');
    return;
  }

  btnGuardar.disabled = true;
  btnGuardar.innerText = 'Guardando...';
  mostrarEstado('','');

  try {
    const r = await enviarEscritura(payload);

    mostrarEstado(
      mensajeRespuesta(
        r,
        editId ? 'Registro actualizado correctamente.' : 'Registro guardado correctamente.'
      ),
      'success'
    );

    await cargarHistorial();
    await renderizarDashboard();
    resetFormulario();
  } catch(err) {
    mostrarEstado(err.message || 'No se pudo guardar el registro.','error');
  } finally {
    btnGuardar.disabled = false;
    btnGuardar.innerText = document.getElementById('edit-id').value
      ? 'Actualizar Registro'
      : 'Guardar en Sheets';
  }
});

// HISTORIAL: últimos 10 movimientos que devuelve el backend
async function cargarHistorial() {
  const pin = localStorage.getItem('quiosco_pin');
  const container = document.getElementById('historial-lista');

  if (!container || !pin) return;

  container.innerHTML = '<p style="text-align:center">Cargando últimos movimientos...</p>';

  try {
    const r = await fetchGoogle({
      pin,
      action:'get',
      fecha:campoFecha?.value || fechaLocalISO()
    });

    if (!respuestaExitosa(r)) {
      throw new Error(mensajeRespuesta(r,'No se pudo cargar el historial.'));
    }

    const registros = registrosRespuesta(r).slice(0,10);

    if (!registros.length) {
      container.innerHTML = '<p style="text-align:center">No hay registros para el período seleccionado.</p>';
      return;
    }

    container.innerHTML = '';

    registros.forEach(reg => {
      const item = document.createElement('div');
      item.className = 'registro-item';

      item.innerHTML = `
        <div class="registro-info">
          <h4>
            <span class="badge ${escapeHtml(reg.tipo.toLowerCase())}">
              ${escapeHtml(reg.tipo)}
            </span>
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
  } catch(err) {
    container.innerHTML = `<p style="text-align:center;color:#dc2626">${escapeHtml(err.message || 'Error al cargar el historial.')}</p>`;
  }
}

// EDICIÓN
function prepararEdicion(registro) {
  const r = normalizarRegistro(registro);

  document.getElementById('edit-id').value = r.id;
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

  const nav = document.querySelector('.nav-btn[onclick*="formulario"]') ||
    document.querySelector('.nav-btn');

  nav?.click();
  document.getElementById('form-title').scrollIntoView({behavior:'smooth',block:'center'});
}

window.prepararEdicion = prepararEdicion;

btnCancelar?.addEventListener('click',resetFormulario);

function resetFormulario() {
  form?.reset();

  document.getElementById('edit-id').value = '';
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
  btnGuardar.style.backgroundColor = 'var(--primary-color)';
  btnCancelar?.classList.add('hidden');
}

function mostrarEstado(mensaje,tipo) {
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

function escapeHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g,c => ({
    '&':'&amp;',
    '<':'&lt;',
    '>':'&gt;',
    '"':'&quot;',
    "'":'&#39;'
  }[c]));
}

// INTERFAZ DEL PANEL
function asegurarInterfazDashboard() {
  const dashboard = document.getElementById('view-dashboard');

  if (!dashboard) return;

  if (!document.getElementById('resumen-periodos')) {
    const panel = document.createElement('section');

    panel.id = 'resumen-periodos';
    panel.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:16px 0;';

    panel.innerHTML = `
      <div class="card resumen-periodo">
        <h3>Resumen semanal</h3>
        <p>Ingresos: <strong id="sem-ingresos">$0</strong></p>
        <p>Inversiones: <strong id="sem-inversiones">$0</strong></p>
        <p>Ganancia neta: <strong id="sem-neta">$0</strong></p>
        <small id="sem-fechas"></small>
      </div>
      <div class="card resumen-periodo">
        <h3>Resumen mensual</h3>
        <p>Ingresos: <strong id="mes-ingresos">$0</strong></p>
        <p>Inversiones: <strong id="mes-inversiones">$0</strong></p>
        <p>Ganancia neta: <strong id="mes-neta">$0</strong></p>
      </div>
      <div class="card resumen-periodo">
        <h3>Resumen anual</h3>
        <p>Ingresos: <strong id="anio-ingresos">$0</strong></p>
        <p>Inversiones: <strong id="anio-inversiones">$0</strong></p>
        <p>Ganancia neta: <strong id="anio-neta">$0</strong></p>
      </div>
      <div class="card resumen-periodo">
        <h3>Acumulado histórico</h3>
        <p>Ingresos: <strong id="hist-ingresos">$0</strong></p>
        <p>Inversiones: <strong id="hist-inversiones">$0</strong></p>
        <p>Ganancia neta: <strong id="hist-neta">$0</strong></p>
      </div>
    `;

    dashboard.insertBefore(panel,dashboard.firstChild);
  }

  const diario = document.getElementById('graficoDiario');
  const anual = document.getElementById('graficoMensual');

  if (diario?.parentElement) {
    diario.parentElement.style.minHeight = '280px';

    if (!diario.parentElement.querySelector('.titulo-grafico-semanal')) {
      const h = document.createElement('h3');
      h.className = 'titulo-grafico-semanal';
      h.innerText = 'Actividad semanal: ingresos e inversiones';
      diario.parentElement.insertBefore(h,diario);
    }
  }

  if (anual?.parentElement) {
    anual.parentElement.style.minHeight = '280px';

    if (!anual.parentElement.querySelector('.titulo-grafico-anual')) {
      const h = document.createElement('h3');
      h.className = 'titulo-grafico-anual';
      h.innerText = 'Comparación anual por mes';
      anual.parentElement.insertBefore(h,anual);
    }
  }

  if (!document.getElementById('graficoResumenMensual')) {
    const bloque = document.createElement('section');

    bloque.id = 'bloque-grafico-mensual';
    bloque.style.cssText = 'margin:24px 0;';
    bloque.innerHTML = `
      <h3>Actividad mensual por día</h3>
      <div style="position:relative;width:100%;height:300px">
        <canvas id="graficoResumenMensual"></canvas>
      </div>
    `;

    if (anual?.parentElement) {
      anual.parentElement.before(bloque);
    } else {
      dashboard.appendChild(bloque);
    }
  }
}

// DASHBOARD
async function renderizarDashboard() {
  const pin = localStorage.getItem('quiosco_pin');
  if (!pin) return;

  asegurarInterfazDashboard();

  const r = await fetchGoogle({
    pin,
    action:'get_dashboard',
    fecha:campoFecha?.value || fechaLocalISO()
  });

  if (!respuestaExitosa(r)) {
    throw new Error(mensajeRespuesta(r,'No se pudo cargar el panel.'));
  }

  const semanal = r.semanal || {};
  const mensual = r.mensual || {};
  const anual = r.anualDetalle || {};
  const acumulado = r.acumulado || {};

  ponerTexto('sem-ingresos',formatoCLP(semanal.ingresos));
  ponerTexto('sem-inversiones',formatoCLP(semanal.inversiones));
  ponerTexto('sem-neta',formatoCLP(semanal.neta));
  ponerTexto(
    'sem-fechas',
    semanal.inicio && semanal.fin ? `${semanal.inicio} al ${semanal.fin}` : ''
  );

  ponerTexto('mes-ingresos',formatoCLP(mensual.ingresos));
  ponerTexto('mes-inversiones',formatoCLP(mensual.inversiones));
  ponerTexto('mes-neta',formatoCLP(mensual.neta));

  ponerTexto('anio-ingresos',formatoCLP(anual.ingresos));
  ponerTexto('anio-inversiones',formatoCLP(anual.inversiones));
  ponerTexto('anio-neta',formatoCLP(anual.neta));

  ponerTexto('hist-ingresos',formatoCLP(acumulado.ingresos));
  ponerTexto('hist-inversiones',formatoCLP(acumulado.inversiones));
  ponerTexto('hist-neta',formatoCLP(acumulado.neta));

  ponerTexto('kpi-ingresos',formatoCLP(mensual.ingresos));
  ponerTexto('kpi-inversion',formatoCLP(mensual.inversiones));
  ponerTexto('kpi-neta',formatoCLP(mensual.neta));

  dibujarGraficoSemanal(semanal.movimientos || r.diario || []);
  dibujarGraficoResumenMensual(mensual.movimientos || []);
  dibujarGraficoAnual(anual.meses || r.anual || {});
}

function ponerTexto(id,texto) {
  const el = document.getElementById(id);
  if (el) el.innerText = texto;
}

function dibujarGraficoSemanal(movimientos) {
  const canvas = document.getElementById('graficoDiario');
  if (!canvas || typeof Chart === 'undefined') return;

  const dias = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
  const valores = dias.map(() => ({ingreso:0,inversion:0}));

  (Array.isArray(movimientos) ? movimientos : []).forEach(m => {
    const f = parseFechaLocal(m.fecha ?? m.Fecha);
    if (!f) return;

    const i = (f.getDay()+6)%7;
    const total = Number(m.total ?? m.Total) ||
      ((Number(m.efectivo ?? m.Efectivo)||0) +
       (Number(m.tarjeta ?? m.Tarjeta)||0));

    if (String(m.tipo ?? m.Tipo).toUpperCase() === 'INGRESO') {
      valores[i].ingreso += total;
    } else if (String(m.tipo ?? m.Tipo).toUpperCase() === 'INVERSION') {
      valores[i].inversion += total;
    }
  });

  if (chartSemanal) chartSemanal.destroy();

  chartSemanal = new Chart(canvas.getContext('2d'), {
    type:'bar',
    data:{
      labels:dias,
      datasets:[
        {
          label:'Ingresos',
          data:valores.map(v=>v.ingreso),
          backgroundColor:'#1E3A8A',
          borderRadius:4
        },
        {
          label:'Inversiones',
          data:valores.map(v=>v.inversion),
          backgroundColor:'#DC2626',
          borderRadius:4
        }
      ]
    },
    options:opcionesMonetarias()
  });
}

function dibujarGraficoResumenMensual(movimientos) {
  const canvas = document.getElementById('graficoResumenMensual');
  if (!canvas || typeof Chart === 'undefined') return;

  const porFecha = {};

  (Array.isArray(movimientos) ? movimientos : []).forEach(m => {
    const f = normalizarFecha(m.fecha ?? m.Fecha);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return;

    if (!porFecha[f]) {
      porFecha[f] = {ingreso:0,inversion:0};
    }

    const t = Number(m.total ?? m.Total) ||
      ((Number(m.efectivo ?? m.Efectivo)||0) +
       (Number(m.tarjeta ?? m.Tarjeta)||0));

    if (String(m.tipo ?? m.Tipo).toUpperCase() === 'INGRESO') {
      porFecha[f].ingreso += t;
    } else if (String(m.tipo ?? m.Tipo).toUpperCase() === 'INVERSION') {
      porFecha[f].inversion += t;
    }
  });

  const fechas = Object.keys(porFecha).sort();

  if (chartResumenMensual) chartResumenMensual.destroy();

  chartResumenMensual = new Chart(canvas.getContext('2d'), {
    type:'bar',
    data:{
      labels:fechas.map(f=>f.slice(8,10)),
      datasets:[
        {
          label:'Ingresos',
          data:fechas.map(f=>porFecha[f].ingreso),
          backgroundColor:'#1E3A8A',
          borderRadius:3
        },
        {
          label:'Inversiones',
          data:fechas.map(f=>porFecha[f].inversion),
          backgroundColor:'#DC2626',
          borderRadius:3
        },
        {
          label:'Ganancia neta',
          data:fechas.map(f=>porFecha[f].ingreso-porFecha[f].inversion),
          type:'line',
          borderColor:'#059669',
          backgroundColor:'#059669',
          borderWidth:2,
          tension:.25
        }
      ]
    },
    options:opcionesMonetarias()
  });
}

function dibujarGraficoAnual(datos) {
  const canvas = document.getElementById('graficoMensual');
  if (!canvas || typeof Chart === 'undefined') return;

  const meses = MESES;
  datos = datos && typeof datos === 'object' ? datos : {};

  const valores = meses.map(mes => {
    const item = datos[mes] ||
      datos[mes.charAt(0)+mes.slice(1).toLowerCase()] ||
      {};

    const ingreso = Number(item.ingreso ?? item.ingresos ?? item.Ingresos) || 0;
    const inversion = Number(item.inversion ?? item.inversiones ?? item.Inversiones) || 0;

    const neta = (item.neta !== undefined || item.Neta !== undefined)
      ? Number(item.neta ?? item.Neta) || 0
      : ingreso-inversion;

    return {ingreso,inversion,neta};
  });

  if (chartAnual) chartAnual.destroy();

  chartAnual = new Chart(canvas.getContext('2d'), {
    type:'bar',
    data:{
      labels:meses.map(m=>m.substring(0,3)),
      datasets:[
        {
          label:'Ingresos',
          data:valores.map(v=>v.ingreso),
          backgroundColor:'#1E3A8A',
          borderRadius:3
        },
        {
          label:'Inversiones',
          data:valores.map(v=>v.inversion),
          backgroundColor:'#DC2626',
          borderRadius:3
        },
        {
          label:'Ganancia neta',
          data:valores.map(v=>v.neta),
          type:'line',
          borderColor:'#059669',
          backgroundColor:'#059669',
          borderWidth:2,
          tension:.25
        }
      ]
    },
    options:opcionesMonetarias()
  });
}

function opcionesMonetarias() {
  return {
    responsive:true,
    maintainAspectRatio:false,
    interaction:{mode:'index',intersect:false},
    plugins:{
      legend:{
        position:'bottom',
        labels:{boxWidth:12}
      },
      tooltip:{
        callbacks:{
          label:c=>`${c.dataset.label}: ${formatoCLP(c.raw)}`
        }
      }
    },
    scales:{
      y:{
        beginAtZero:true,
        ticks:{
          callback:v=>'$'+MONEDA.format(Number(v)||0)
        }
      }
    }
  };
}

function parseFechaLocal(valor) {
  const s = normalizarFecha(valor);
  const p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!p) return null;

  const f = new Date(Number(p[1]),Number(p[2])-1,Number(p[3]),12);

  return f.getFullYear() === Number(p[1]) &&
    f.getMonth() === Number(p[2])-1 &&
    f.getDate() === Number(p[3]) ? f : null;
}

// Al cambiar la fecha, actualiza los datos mostrados.
if (campoFecha) {
  campoFecha.addEventListener('change',async () => {
    if (document.getElementById('edit-id')?.value) return;

    if (localStorage.getItem('quiosco_pin')) {
      await cargarHistorial();

      try {
        await renderizarDashboard();
      } catch(e) {
        console.error('No se pudo actualizar el panel:',e);
      }
    }
  });
}

window.cargarHistorial = cargarHistorial;
window.renderizarDashboard = renderizarDashboard;

// Si ya había una sesión guardada, vuelve a abrir el panel.
if (localStorage.getItem('quiosco_pin')) {
  loginScreen?.classList.remove('active');
  appScreen?.classList.remove('hidden');
  appScreen?.classList.add('active');

  asegurarInterfazDashboard();
  cargarHistorial().catch(console.error);
  renderizarDashboard().catch(e => console.error('No se pudo cargar el panel:',e));
}