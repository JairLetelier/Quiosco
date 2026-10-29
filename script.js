// PEGA AQUÍ TU NUEVA URL GENERADA
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby9sFzqSOoP9Jt8IFRbxSqayoY7Oz0xL8K376rDAudPRD0GxqYBvTnuSSy1qpoxEwte/exec';
let currentType = 'ingreso';
let chartDiario = null;
let chartMensual = null;

const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const form = document.getElementById('registro-form');
const btnGuardar = document.getElementById('btn-guardar');
const btnCancelar = document.getElementById('btn-cancelar');

document.getElementById('fecha').valueAsDate = new Date();

// --- LOGIN ---
document.getElementById('btn-login').addEventListener('click', () => {
    const pin = document.getElementById('pin-input').value;
    if (pin.length >= 6) {
        localStorage.setItem('quiosco_pin', pin);
        loginScreen.classList.remove('active');
        appScreen.classList.remove('hidden');
        appScreen.classList.add('active');
    } else {
        document.getElementById('login-error').classList.remove('hidden');
    }
});

document.getElementById('btn-logout').addEventListener('click', () => {
    localStorage.removeItem('quiosco_pin');
    location.reload();
});

// --- NAVEGACIÓN ---
function switchView(view) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
    const targetView = document.getElementById('view-' + view);
    if (targetView) targetView.classList.add('active');
    const activeButton = Array.from(document.querySelectorAll('.nav-btn')).find(btn => (btn.getAttribute('onclick') || '').includes("'" + view + "'"));
    if (activeButton) activeButton.classList.add('active');
}

document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        currentType = e.target.dataset.target;
        document.getElementById('label-detalle').innerText = currentType === 'inversion' ? 'Proveedor (Requerido)' : 'Observaciones (Opcional)';
        document.getElementById('detalle').required = currentType === 'inversion';
    });
});

// --- COMUNICACIÓN CON GOOGLE APPS SCRIPT ---
// Las lecturas usan JSONP para evitar que fetch lea una respuesta cross-origin.
function fetchGoogle(payload) {
    return new Promise((resolve, reject) => {
        const callbackName = 'gsCallback_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        const script = document.createElement('script');
        const timeout = setTimeout(() => cleanup(new Error('Tiempo de espera agotado al contactar Google Apps Script.')), 15000);

        function cleanup(error, result) {
            clearTimeout(timeout);
            if (window[callbackName]) delete window[callbackName];
            if (script.parentNode) script.parentNode.removeChild(script);
            if (error) reject(error);
            else resolve(result);
        }

        window[callbackName] = (result) => cleanup(null, result);
        script.onerror = () => cleanup(new Error('No se pudo cargar la respuesta de Google Apps Script.'));
        const params = new URLSearchParams({ data: JSON.stringify(payload), callback: callbackName });
        script.src = `${GOOGLE_SCRIPT_URL}?${params.toString()}`;
        document.head.appendChild(script);
    });
}

// Las escrituras se envían por POST no-cors; el navegador no permite leer
// esa respuesta. Por eso verificamos el resultado mediante una lectura JSONP.
async function enviarEscritura(payload) {
    await fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
    });

    // Dar tiempo a Apps Script para escribir en Sheets y luego comprobarlo.
    await new Promise(resolve => setTimeout(resolve, 1200));
    const verificacion = await fetchGoogle({
        pin: payload.pin,
        action: 'get',
        fecha: payload.fecha
    });

    if (!verificacion || verificacion.status !== 'success') {
        throw new Error((verificacion && verificacion.message) || 'No se pudo verificar el registro.');
    }

    if (payload.action === 'insert') {
        const coincide = (verificacion.data || []).some(reg =>
            reg.fecha === payload.fecha &&
            reg.tipo === payload.tipo.toUpperCase() &&
            Number(reg.efectivo) === Number(payload.efectivo) &&
            Number(reg.tarjeta) === Number(payload.tarjeta) &&
            String(reg.detalle || '') === String(payload.detalle || '')
        );
        if (!coincide) throw new Error('No se pudo confirmar el registro en la hoja. Revisa la conexión antes de volver a enviarlo.');
    } else if (payload.action === 'update') {
        const actualizado = (verificacion.data || []).some(reg =>
            String(reg.id) === String(payload.id) &&
            reg.tipo === payload.tipo.toUpperCase() &&
            Number(reg.efectivo) === Number(payload.efectivo) &&
            Number(reg.tarjeta) === Number(payload.tarjeta) &&
            String(reg.detalle || '') === String(payload.detalle || '')
        );
        if (!actualizado) throw new Error('No se pudo confirmar la actualización. Revisa el historial antes de volver a intentarlo.');
    }

    return { status: 'success', message: payload.action === 'update' ? 'Registro actualizado y verificado.' : 'Registro guardado y verificado.' };
}

// --- GUARDAR O EDITAR DATOS ---
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = localStorage.getItem('quiosco_pin');
    const editId = document.getElementById('edit-id').value;
    const action = editId ? 'update' : 'insert';

    const payload = {
        pin: pin, action: action, id: editId, tipo: currentType,
        fecha: document.getElementById('fecha').value,
        efectivo: Number(document.getElementById('efectivo').value),
        tarjeta: Number(document.getElementById('tarjeta').value),
        detalle: document.getElementById('detalle').value
    };

    btnGuardar.disabled = true;
    btnGuardar.innerText = 'Guardando...';
    mostrarEstado('', '');

    try {
        const result = await enviarEscritura(payload);
        
        if (result.status === 'success') {
            mostrarEstado(result.message, 'success');
            setTimeout(() => { resetFormulario(); }, 2000);
        } else {
            mostrarEstado(result.message, 'error');
        }
    } catch (error) {
        mostrarEstado(error.message || 'Error de conexión.', 'error');
    } finally {
        btnGuardar.disabled = false;
        btnGuardar.innerText = editId ? 'Actualizar Registro' : 'Guardar en Drive';
    }
});

// --- CARGAR HISTORIAL ---
async function cargarHistorial() {
    const pin = localStorage.getItem('quiosco_pin');
    const container = document.getElementById('historial-lista');
    container.innerHTML = '<p style="text-align: center;">Descargando datos...</p>';

    try {
        const result = await fetchGoogle({ pin: pin, action: 'get', fecha: document.getElementById('fecha').value });

        if (result.status === 'success' && result.data.length > 0) {
            container.innerHTML = '';
            result.data.forEach(reg => {
                const item = document.createElement('div');
                item.className = 'registro-item';
                const total = Number(reg.total).toLocaleString('es-CL');
                const ef = Number(reg.efectivo).toLocaleString('es-CL');
                const tj = Number(reg.tarjeta).toLocaleString('es-CL');
                
                item.innerHTML = `
                    <div class="registro-info">
                        <h4><span class="badge ${reg.tipo.toLowerCase()}">${reg.tipo}</span> $${total}</h4>
                        <p>📅 ${new Date(reg.fecha).toLocaleDateString()} | Ef: $${ef} | Tj: $${tj}</p>
                        <p><i>${escapeHtml(reg.detalle || 'Sin detalle')}</i></p>
                    </div>
                    <button class="btn-edit" onclick='prepararEdicion(${JSON.stringify(reg)})'>✎ Editar</button>
                `;
                container.appendChild(item);
            });
        } else {
            container.innerHTML = '<p style="text-align: center;">No hay registros en este mes.</p>';
        }
    } catch (error) {
        container.innerHTML = '<p style="text-align: center; color: red;">Error al cargar historial.</p>';
    }
}

// --- EDICIÓN Y UTILIDADES ---
window.prepararEdicion = function(registro) {
    document.getElementById('edit-id').value = registro.id;
    document.getElementById('form-title').innerText = "Corrigiendo Registro";
    document.getElementById('fecha').value = registro.fecha.split('T')[0];
    document.getElementById('fecha').readOnly = true; 
    
    document.getElementById('efectivo').value = registro.efectivo;
    document.getElementById('tarjeta').value = registro.tarjeta;
    document.getElementById('detalle').value = registro.detalle;

    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    const tabTarget = document.querySelector(`.tab[data-target="${registro.tipo.toLowerCase()}"]`);
    if(tabTarget) tabTarget.classList.add('active');
    currentType = registro.tipo.toLowerCase();

    btnGuardar.innerText = "Actualizar Registro";
    btnGuardar.style.backgroundColor = "#059669"; 
    btnCancelar.classList.remove('hidden');
    document.querySelectorAll('.nav-btn')[0].click();
};

btnCancelar.addEventListener('click', resetFormulario);

function resetFormulario() {
    form.reset();
    document.getElementById('edit-id').value = "";
    document.getElementById('form-title').innerText = "Nuevo Registro";
    document.getElementById('fecha').valueAsDate = new Date();
    document.getElementById('fecha').readOnly = false;
    btnGuardar.innerText = "Guardar en Drive";
    btnGuardar.style.backgroundColor = "var(--primary-color)";
    btnCancelar.classList.add('hidden');
    mostrarEstado('','');
}

function mostrarEstado(mensaje, tipo) {
    const statusMsg = document.getElementById('status-message');
    if (!mensaje) { statusMsg.classList.add('hidden'); return; }
    statusMsg.innerText = mensaje;
    statusMsg.className = `status-msg ${tipo}`;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>\"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[ch]));
}

// --- DASHBOARD Y GRÁFICOS ---
async function renderizarDashboard() {
    document.getElementById('kpi-ingresos').innerText = "...";
    document.getElementById('kpi-inversion').innerText = "...";
    document.getElementById('kpi-neta').innerText = "...";
    
    const pin = localStorage.getItem('quiosco_pin');
    
    try {
        const result = await fetchGoogle({ pin: pin, action: 'get_dashboard', fecha: document.getElementById('fecha').value });
        
        if (result.status === 'success') {
            dibujarGraficoDiario(result.diario);
            dibujarGraficoAnual(result.anual);
        }
    } catch (e) {
        console.error("Error cargando gráficos");
    }
}

function dibujarGraficoDiario(datosDiarios) {
    let sumaIngresos = 0; let sumaInversion = 0; const porFecha = {};
    datosDiarios.forEach(reg => {
        const monto = Number(reg.total);
        const fechaCorta = reg.fecha.split('T')[0].substring(5); 
        if (!porFecha[fechaCorta]) porFecha[fechaCorta] = { ingreso: 0, inversion: 0 };
        if (reg.tipo === 'INGRESO') { sumaIngresos += monto; porFecha[fechaCorta].ingreso += monto; }
        else { sumaInversion += monto; porFecha[fechaCorta].inversion += monto; }
    });

    document.getElementById('kpi-ingresos').innerText = "$" + sumaIngresos.toLocaleString('es-CL');
    document.getElementById('kpi-inversion').innerText = "$" + sumaInversion.toLocaleString('es-CL');
    document.getElementById('kpi-neta').innerText = "$" + (sumaIngresos - sumaInversion).toLocaleString('es-CL');

    const etiquetas = Object.keys(porFecha).sort();
    const dataIng = etiquetas.map(f => porFecha[f].ingreso);
    const dataInv = etiquetas.map(f => porFecha[f].inversion);

    if (chartDiario) chartDiario.destroy();
    const ctx = document.getElementById('graficoDiario').getContext('2d');
    chartDiario = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: etiquetas,
            datasets: [
                { label: 'Ingresos', data: dataIng, backgroundColor: '#1E3A8A', borderRadius: 3 },
                { label: 'Inversión', data: dataInv, backgroundColor: '#DC2626', borderRadius: 3 }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } }
    });
}

function dibujarGraficoAnual(datosAnuales) {
    const ordenMeses = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
    const mesesConDatos = Object.keys(datosAnuales).sort((a, b) => ordenMeses.indexOf(a) - ordenMeses.indexOf(b));

    const dataIng = mesesConDatos.map(m => datosAnuales[m].ingreso);
    const dataNeto = mesesConDatos.map(m => datosAnuales[m].ingreso - datosAnuales[m].inversion);

    if (chartMensual) chartMensual.destroy();
    const ctx = document.getElementById('graficoMensual').getContext('2d');
    chartMensual = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: mesesConDatos.map(m => m.substring(0,3)), 
            datasets: [
                { label: 'Ganancia Neta (Línea)', type: 'line', data: dataNeto, borderColor: '#059669', backgroundColor: '#059669', borderWidth: 2, tension: 0.3, yAxisID: 'y' },
                { label: 'Ingresos Brutos', type: 'bar', data: dataIng, backgroundColor: '#D1D5DB', borderRadius: 4, yAxisID: 'y' }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } }
    });
}