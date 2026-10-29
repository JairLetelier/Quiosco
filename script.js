
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzDghmRzksyMetthrFPI0Y1MsuvnTbvLKYdnR1OeX9hnsa2xo33qJ1-6HeiyWVTWJOF/exec';

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
document.getElementById('btn-login').addEventListener('click', async () => {
    const pin = document.getElementById('pin-input').value;
    const error = document.getElementById('login-error');

    if (!pin || pin.length < 6) {
        error.classList.remove('hidden');
        return;
    }

    try {
        const resultado = await fetchGoogle({
            pin,
            action: 'get',
            fecha: document.getElementById('fecha').value
        });

        if (resultado.status !== 'success') {
            error.classList.remove('hidden');
            error.innerText = resultado.message || 'PIN incorrecto.';
            return;
        }

        localStorage.setItem('quiosco_pin', pin);
        error.classList.add('hidden');
        loginScreen.classList.remove('active');
        appScreen.classList.remove('hidden');
        appScreen.classList.add('active');

        cargarHistorial();
        renderizarDashboard();
    } catch (e) {
        error.classList.remove('hidden');
        error.innerText = e.message || 'No se pudo conectar con el servidor.';
    }
});

document.getElementById('btn-logout').addEventListener('click', () => {
    localStorage.removeItem('quiosco_pin');
    location.reload();
});

// --- NAVEGACIÓN ---
function switchView(view) {
    document.querySelectorAll('.view-section').forEach(el =>
        el.classList.remove('active')
    );

    document.querySelectorAll('.nav-btn').forEach(el =>
        el.classList.remove('active')
    );

    const targetView = document.getElementById('view-' + view);
    if (targetView) targetView.classList.add('active');

    const activeButton = Array.from(
        document.querySelectorAll('.nav-btn')
    ).find(btn =>
        (btn.getAttribute('onclick') || '').includes("'" + view + "'")
    );

    if (activeButton) activeButton.classList.add('active');

    if (view === 'historial') cargarHistorial();
    if (view === 'dashboard') renderizarDashboard();
}

document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', e => {
        document.querySelectorAll('.tab').forEach(t =>
            t.classList.remove('active')
        );

        e.currentTarget.classList.add('active');
        currentType = e.currentTarget.dataset.target;

        document.getElementById('label-detalle').innerText =
            currentType === 'inversion'
                ? 'Proveedor (Requerido)'
                : 'Observaciones (Opcional)';

        document.getElementById('detalle').required =
            currentType === 'inversion';
    });
});

// --- COMUNICACIÓN CON GOOGLE APPS SCRIPT ---
// Code.gs debe tener doGet(e) y responder_() con soporte JSONP.
function fetchGoogle(payload) {
    return new Promise((resolve, reject) => {
        const callbackName =
            'gsCallback_' + Date.now() + '_' +
            Math.random().toString(36).slice(2);

        const script = document.createElement('script');
        let terminado = false;

        const timeout = setTimeout(() => {
            cleanup(new Error(
                'Tiempo de espera agotado. Revisa la URL y los permisos de Apps Script.'
            ));
        }, 20000);

        function cleanup(error, result) {
            if (terminado) return;
            terminado = true;

            clearTimeout(timeout);
            delete window[callbackName];

            if (script.parentNode) {
                script.parentNode.removeChild(script);
            }

            if (error) reject(error);
            else resolve(result);
        }

        window[callbackName] = resultado => cleanup(null, resultado);

        script.onerror = () => cleanup(new Error(
            'No se pudo cargar la respuesta de Google Apps Script. Comprueba la implementación.'
        ));

        const params = new URLSearchParams({
            data: JSON.stringify(payload),
            callback: callbackName
        });

        script.src = `${GOOGLE_SCRIPT_URL}?${params.toString()}`;
        document.head.appendChild(script);
    });
}

// --- GUARDAR O EDITAR ---
// Utiliza GET/JSONP en lugar del POST que producía el error 401.
// Requiere que el doGet actual de Code.gs acepte insert y update.
async function enviarEscritura(payload) {
    const resultado = await fetchGoogle(payload);

    if (!resultado || resultado.status !== 'success') {
        throw new Error(
            (resultado && resultado.message) ||
            'Google Apps Script no confirmó la operación.'
        );
    }

    return {
        status: 'success',
        message: payload.action === 'update'
            ? 'Registro actualizado correctamente.'
            : 'Registro guardado correctamente.'
    };
}

form.addEventListener('submit', async e => {
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
    btnGuardar.innerText = 'Guardando...';
    mostrarEstado('', '');

    try {
        const resultado = await enviarEscritura(payload);

        mostrarEstado(resultado.message, 'success');

        await cargarHistorial();
        await renderizarDashboard();

        setTimeout(() => resetFormulario(), 2000);
    } catch (error) {
        mostrarEstado(error.message || 'Error de conexión.', 'error');
    } finally {
        btnGuardar.disabled = false;
        btnGuardar.innerText = editId
            ? 'Actualizar Registro'
            : 'Guardar en Drive';
    }
});

// --- CARGAR HISTORIAL ---
async function cargarHistorial() {
    const pin = localStorage.getItem('quiosco_pin');
    const container = document.getElementById('historial-lista');

    if (!container) return;

    container.innerHTML =
        '<p style="text-align:center">Descargando datos...</p>';

    try {
        const resultado = await fetchGoogle({
            pin: pin,
            action: 'get',
            fecha: document.getElementById('fecha').value
        });

        if (resultado.status !== 'success') {
            throw new Error(resultado.message || 'No se pudo cargar el historial.');
        }

        const registros = resultado.data || [];

        if (!registros.length) {
            container.innerHTML =
                '<p style="text-align:center">No hay registros en este mes.</p>';
            return;
        }

        container.innerHTML = '';

        registros.forEach(reg => {
            const item = document.createElement('div');
            item.className = 'registro-item';

            const total = Number(reg.total || 0).toLocaleString('es-CL');
            const efectivo = Number(reg.efectivo || 0).toLocaleString('es-CL');
            const tarjeta = Number(reg.tarjeta || 0).toLocaleString('es-CL');

            item.innerHTML = `
                <div class="registro-info">
                    <h4>
                        <span class="badge ${String(reg.tipo).toLowerCase()}">
                            ${escapeHtml(reg.tipo)}
                        </span>
                        $${total}
                    </h4>
                    <p>
                        📅 ${escapeHtml(reg.fecha)}
                        | Ef: $${efectivo}
                        | Tj: $${tarjeta}
                    </p>
                    <p><i>${escapeHtml(reg.detalle || 'Sin detalle')}</i></p>
                </div>
                <button class="btn-edit" type="button">✎ Editar</button>
            `;

            item.querySelector('.btn-edit').addEventListener('click', () => {
                prepararEdicion(reg);
            });

            container.appendChild(item);
        });
    } catch (error) {
        container.innerHTML =
            `<p style="text-align:center;color:red">${
                escapeHtml(error.message || 'Error al cargar historial.')
            }</p>`;
    }
}

// --- EDICIÓN ---
window.prepararEdicion = function(registro) {
    document.getElementById('edit-id').value = registro.id;
    document.getElementById('form-title').innerText =
        'Corrigiendo Registro';

    document.getElementById('fecha').value =
        String(registro.fecha).split('T')[0];

    document.getElementById('fecha').readOnly = true;
    document.getElementById('efectivo').value = registro.efectivo;
    document.getElementById('tarjeta').value = registro.tarjeta;
    document.getElementById('detalle').value = registro.detalle || '';

    document.querySelectorAll('.tab').forEach(t => {
        t.classList.remove('active');
    });

    const tipo = String(registro.tipo).toLowerCase();
    const tab = document.querySelector(
        `.tab[data-target="${tipo}"]`
    );

    if (tab) tab.classList.add('active');

    currentType = tipo;

    document.getElementById('label-detalle').innerText =
        tipo === 'inversion'
            ? 'Proveedor (Requerido)'
            : 'Observaciones (Opcional)';

    document.getElementById('detalle').required = tipo === 'inversion';

    btnGuardar.innerText = 'Actualizar Registro';
    btnGuardar.style.backgroundColor = '#059669';
    btnCancelar.classList.remove('hidden');

    const nav = document.querySelectorAll('.nav-btn')[0];
    if (nav) nav.click();
};

btnCancelar.addEventListener('click', resetFormulario);

function resetFormulario() {
    form.reset();

    document.getElementById('edit-id').value = '';
    document.getElementById('form-title').innerText = 'Nuevo Registro';
    document.getElementById('fecha').valueAsDate = new Date();
    document.getElementById('fecha').readOnly = false;

    currentType = 'ingreso';

    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.toggle(
            'active',
            tab.dataset.target === 'ingreso'
        );
    });

    document.getElementById('label-detalle').innerText =
        'Observaciones (Opcional)';

    document.getElementById('detalle').required = false;

    btnGuardar.innerText = 'Guardar en Drive';
    btnGuardar.style.backgroundColor = 'var(--primary-color)';
    btnCancelar.classList.add('hidden');

    mostrarEstado('', '');
}

// --- MENSAJES ---
function mostrarEstado(mensaje, tipo) {
    const elemento = document.getElementById('status-message');

    if (!mensaje) {
        elemento.classList.add('hidden');
        return;
    }

    elemento.innerText = mensaje;
    elemento.className = `status-msg ${tipo}`;
}

function escapeHtml(valor) {
    return String(valor).replace(/[&<>"']/g, caracter => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[caracter]);
}

// --- DASHBOARD Y GRÁFICOS ---
async function renderizarDashboard() {
    const ingresos = document.getElementById('kpi-ingresos');
    const inversion = document.getElementById('kpi-inversion');
    const neta = document.getElementById('kpi-neta');

    if (ingresos) ingresos.innerText = '...';
    if (inversion) inversion.innerText = '...';
    if (neta) neta.innerText = '...';

    try {
        const resultado = await fetchGoogle({
            pin: localStorage.getItem('quiosco_pin'),
            action: 'get_dashboard',
            fecha: document.getElementById('fecha').value
        });

        if (resultado.status !== 'success') {
            throw new Error(resultado.message || 'No se pudo cargar el panel.');
        }

        dibujarGraficoDiario(resultado.diario || []);
        dibujarGraficoAnual(resultado.anual || {});
    } catch (error) {
        console.error('Error cargando gráficos:', error);
    }
}

function dibujarGraficoDiario(datosDiarios) {
    let sumaIngresos = 0;
    let sumaInversion = 0;
    const porFecha = {};

    datosDiarios.forEach(reg => {
        const monto = Number(reg.total) || 0;
        const fecha = String(reg.fecha).split('T')[0];
        const fechaCorta = fecha.substring(5);

        if (!porFecha[fechaCorta]) {
            porFecha[fechaCorta] = { ingreso: 0, inversion: 0 };
        }

        if (String(reg.tipo).toUpperCase() === 'INGRESO') {
            sumaIngresos += monto;
            porFecha[fechaCorta].ingreso += monto;
        } else {
            sumaInversion += monto;
            porFecha[fechaCorta].inversion += monto;
        }
    });

    document.getElementById('kpi-ingresos').innerText =
        '$' + sumaIngresos.toLocaleString('es-CL');

    document.getElementById('kpi-inversion').innerText =
        '$' + sumaInversion.toLocaleString('es-CL');

    document.getElementById('kpi-neta').innerText =
        '$' + (sumaIngresos - sumaInversion).toLocaleString('es-CL');

    const etiquetas = Object.keys(porFecha).sort();

    if (chartDiario) chartDiario.destroy();

    const canvas = document.getElementById('graficoDiario');
    if (!canvas) return;

    chartDiario = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: etiquetas,
            datasets: [
                {
                    label: 'Ingresos',
                    data: etiquetas.map(f => porFecha[f].ingreso),
                    backgroundColor: '#1E3A8A',
                    borderRadius: 3
                },
                {
                    label: 'Inversión',
                    data: etiquetas.map(f => porFecha[f].inversion),
                    backgroundColor: '#DC2626',
                    borderRadius: 3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { boxWidth: 12 }
                }
            }
        }
    });
}

function dibujarGraficoAnual(datosAnuales) {
    const ordenMeses = [
        'ENERO', 'FEBRERO', 'MARZO', 'ABRIL',
        'MAYO', 'JUNIO', 'JULIO', 'AGOSTO',
        'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
    ];

    const meses = Object.keys(datosAnuales).sort(
        (a, b) => ordenMeses.indexOf(a) - ordenMeses.indexOf(b)
    );

    const dataIngresos = meses.map(
        mes => Number(datosAnuales[mes].ingreso) || 0
    );

    const dataNeta = meses.map(mes =>
        (Number(datosAnuales[mes].ingreso) || 0) -
        (Number(datosAnuales[mes].inversion) || 0)
    );

    if (chartMensual) chartMensual.destroy();

    const canvas = document.getElementById('graficoMensual');
    if (!canvas) return;

    chartMensual = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: meses.map(mes => mes.substring(0, 3)),
            datasets: [
                {
                    label: 'Ganancia Neta (Línea)',
                    type: 'line',
                    data: dataNeta,
                    borderColor: '#059669',
                    backgroundColor: '#059669',
                    borderWidth: 2,
                    tension: 0.3,
                    yAxisID: 'y'
                },
                {
                    label: 'Ingresos Brutos',
                    type: 'bar',
                    data: dataIngresos,
                    backgroundColor: '#D1D5DB',
                    borderRadius: 4,
                    yAxisID: 'y'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { boxWidth: 12 }
                }
            }
        }
    });
}

// Permite que otras partes de la página llamen estas funciones.
window.cargarHistorial = cargarHistorial;
window.renderizarDashboard = renderizarDashboard;
