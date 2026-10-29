// Pega aquí la NUEVA URL que te dio Google Apps Script
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxE6i47aX4l1qbUqmSbD4KtwmlUIxpIAh5HmIsyF4GNW3mskW7Kuox9-o6eKqggvamv/exec';
let currentType = 'ingreso';

// Variables globales para los gráficos
let chartDiario = null;
let chartMensual = null;

// Elementos del DOM
const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const form = document.getElementById('registro-form');
const btnGuardar = document.getElementById('btn-guardar');
const btnCancelar = document.getElementById('btn-cancelar');

document.getElementById('fecha').valueAsDate = new Date();

// --- LOGIN Y SESIÓN ---
document.getElementById('btn-login').addEventListener('click', () => {
    const pin = document.getElementById('pin-input').value;
    if (pin.length >= 4) {
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

// --- NAVEGACIÓN Y PESTAÑAS ---
function switchView(view) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
    document.getElementById('view-' + view).classList.add('active');
    event.currentTarget.classList.add('active');
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

// --- ENVIAR DATOS (CREAR O ACTUALIZAR) ---
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = localStorage.getItem('quiosco_pin');
    const editId = document.getElementById('edit-id').value;
    const action = editId ? 'update' : 'insert';

    const payload = {
        pin: pin,
        action: action,
        id: editId,
        tipo: currentType,
        fecha: document.getElementById('fecha').value,
        efectivo: Number(document.getElementById('efectivo').value),
        tarjeta: Number(document.getElementById('tarjeta').value),
        detalle: document.getElementById('detalle').value
    };

    btnGuardar.disabled = true;
    btnGuardar.innerText = 'Comunicando con Drive...';
    mostrarEstado('', '');

    try {
        const response = await fetch(GOOGLE_SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload) });
        const result = await response.json();
        
        if (result.status === 'success') {
            mostrarEstado(result.message, 'success');
            setTimeout(() => { resetFormulario(); }, 2000);
        } else {
            mostrarEstado(result.message, 'error');
        }
    } catch (error) {
        mostrarEstado('Error de red.', 'error');
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
        const response = await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({ pin: pin, action: 'get', fecha: document.getElementById('fecha').value })
        });
        const result = await response.json();

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
                        <p><i>${reg.detalle || 'Sin detalle'}</i></p>
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

// --- DASHBOARD Y GRÁFICOS ---
async function renderizarDashboard() {
    document.getElementById('kpi-ingresos').innerText = "...";
    document.getElementById('kpi-inversion').innerText = "...";
    document.getElementById('kpi-neta').innerText = "...";
    
    const pin = localStorage.getItem('quiosco_pin');
    
    try {
        const response = await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({ pin: pin, action: 'get_dashboard', fecha: document.getElementById('fecha').value })
        });
        const result = await response.json();
        
        if (result.status === 'success') {
            dibujarGraficoDiario(result.diario);
            dibujarGraficoAnual(result.anual);
        }
    } catch (e) {
        console.error("Error cargando gráficos", e);
    }
}

function dibujarGraficoDiario(datosDiarios) {
    let sumaIngresos = 0;
    let sumaInversion = 0;
    const porFecha = {};

    datosDiarios.forEach(reg => {
        const monto = Number(reg.total);
        const fechaCorta = reg.fecha.split('T')[0].substring(5); // Solo MM-DD
        
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
        options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } 
        }
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
                {
                    label: 'Ganancia Neta (Línea)',
                    type: 'line',
                    data: dataNeto,
                    borderColor: '#059669', 
                    backgroundColor: '#059669',
                    borderWidth: 2,
                    tension: 0.3,
                    yAxisID: 'y'
                },
                {
                    label: 'Ingresos Brutos',
                    type: 'bar',
                    data: dataIng,
                    backgroundColor: '#D1D5DB', 
                    borderRadius: 4,
                    yAxisID: 'y'
                }
            ]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } 
        }
    });
}