
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzhvKA6-baYh626PVitYJUVDEUN51Nhei7Ahz_80iRiUyTS1N12xvFG2cgcb9pY7RCj/exec';

let currentType = 'INGRESO';
let chartSemanal = null;
let chartResumenMensual = null;
let chartAnual = null;

const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const form = document.getElementById('registro-form');
const btnGuardar = document.getElementById('btn-guardar');
const btnCancelar = document.getElementById('btn-cancelar');

const MONEDA = new Intl.NumberFormat('es-CL', {
    maximumFractionDigits: 0
});

const MESES = [
    'ENERO', 'FEBRERO', 'MARZO', 'ABRIL',
    'MAYO', 'JUNIO', 'JULIO', 'AGOSTO',
    'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
];

function formatoCLP(valor) {
    return '$' + MONEDA.format(Number(valor) || 0);
}

// Acepta 59000, 59.000 y $59.000.
// Los montos se manejan como pesos chilenos enteros.
function parseMontoCLP(valor) {
    if (typeof valor === 'number') {
        if (!Number.isFinite(valor) || valor < 0 ||
            !Number.isInteger(valor)) {
            throw new Error('Ingresa un monto válido en pesos chilenos.');
        }
        return valor;
    }

    let texto = String(valor ?? '').trim();

    if (!texto) return 0;

    texto = texto
        .replace(/\$/g, '')
        .replace(/\s/g, '');

    if (!/^\d{1,3}(\.\d{3})+$/.test(texto) &&
        !/^\d+$/.test(texto)) {
        throw new Error(
            'Monto inválido. Ejemplo correcto: 59.000'
        );
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

function fechaLocalISO() {
    const ahora = new Date();
    const anio = ahora.getFullYear();
    const mes = String(ahora.getMonth() + 1).padStart(2, '0');
    const dia = String(ahora.getDate()).padStart(2, '0');

    return `${anio}-${mes}-${dia}`;
}

const campoFecha = document.getElementById('fecha');

if (campoFecha && !campoFecha.value) {
    campoFecha.value = fechaLocalISO();
}

// ==================================================
// LOGIN
// ==================================================

document.getElementById('btn-login').addEventListener('click', async () => {
    const pin = document.getElementById('pin-input').value.trim();
    const error = document.getElementById('login-error');

    if (!pin || pin.length < 6) {
        error.innerText = 'Ingresa tu PIN.';
        error.classList.remove('hidden');
        return;
    }

    try {
        const resultado = await fetchGoogle({
            pin,
            action: 'get',
            fecha: campoFecha.value || fechaLocalISO()
        });

        if (resultado.status !== 'success') {
            error.innerText = resultado.message || 'PIN incorrecto.';
            error.classList.remove('hidden');
            return;
        }

        localStorage.setItem('quiosco_pin', pin);

        error.classList.add('hidden');
        loginScreen.classList.remove('active');
        appScreen.classList.remove('hidden');
        appScreen.classList.add('active');

        asegurarInterfazDashboard();

        await cargarHistorial();
        await renderizarDashboard();

    } catch (e) {
        error.innerText =
            e.message || 'No se pudo conectar con el servidor.';
        error.classList.remove('hidden');
    }
});

document.getElementById('btn-logout').addEventListener('click', () => {
    localStorage.removeItem('quiosco_pin');
    location.reload();
});

// ==================================================
// NAVEGACIÓN
// ==================================================

function switchView(view) {
    document.querySelectorAll('.view-section').forEach(el => {
        el.classList.remove('active');
    });

    document.querySelectorAll('.nav-btn').forEach(el => {
        el.classList.remove('active');
    });

    const targetView = document.getElementById('view-' + view);

    if (targetView) {
        targetView.classList.add('active');
    }

    const activeButton = Array.from(
        document.querySelectorAll('.nav-btn')
    ).find(btn =>
        (btn.getAttribute('onclick') || '').includes("'" + view + "'")
    );

    if (activeButton) {
        activeButton.classList.add('active');
    }

    if (view === 'historial') cargarHistorial();
    if (view === 'dashboard') renderizarDashboard();
}

window.switchView = switchView;

// ==================================================
// TIPO DE MOVIMIENTO
// ==================================================

document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', e => {
        document.querySelectorAll('.tab').forEach(t => {
            t.classList.remove('active');
        });

        e.currentTarget.classList.add('active');

        currentType = String(
            e.currentTarget.dataset.target || 'ingreso'
        ).toUpperCase();

        actualizarEtiquetaDetalle();
    });
});

function actualizarEtiquetaDetalle() {
    const esInversion = currentType === 'INVERSION';
    const etiqueta = document.getElementById('label-detalle');
    const detalle = document.getElementById('detalle');

    if (etiqueta) {
        etiqueta.innerText = esInversion
            ? 'Proveedor (Requerido)'
            : 'Observaciones (Opcional)';
    }

    if (detalle) {
        detalle.required = esInversion;
    }
}

// ==================================================
// COMUNICACIÓN CON GOOGLE APPS SCRIPT
// ==================================================

function fetchGoogle(payload) {
    return new Promise((resolve, reject) => {
        const callbackName =
            'gsCallback_' + Date.now() + '_' +
            Math.random().toString(36).slice(2);

        const script = document.createElement('script');
        let terminado = false;

        const timeout = setTimeout(() => {
            cleanup(new Error(
                'Tiempo de espera agotado. Revisa la conexión y la implementación de Apps Script.'
            ));
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

        window[callbackName] = resultado => {
            cleanup(null, resultado);
        };

        script.onerror = () => {
            cleanup(new Error(
                'No se pudo obtener respuesta de Google Apps Script.'
            ));
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
    const resultado = await fetchGoogle(payload);

    if (!resultado || resultado.status !== 'success') {
        throw new Error(
            resultado?.message ||
            'Google Apps Script no confirmó la operación.'
        );
    }

    return resultado;
}

// ==================================================
// GUARDAR Y ACTUALIZAR MOVIMIENTOS
// ==================================================

form.addEventListener('submit', async e => {
    e.preventDefault();

    const pin = localStorage.getItem('quiosco_pin');

    if (!pin) {
        mostrarEstado('Tu sesión expiró. Vuelve a ingresar.', 'error');
        return;
    }

    const editId = document.getElementById('edit-id').value.trim();

    let efectivo;
    let tarjeta;

    try {
        efectivo = leerMonto('efectivo');
        tarjeta = leerMonto('tarjeta');
    } catch (error) {
        mostrarEstado(error.message, 'error');
        return;
    }

    const payload = {
        pin,
        action: editId ? 'update' : 'insert',
        id: editId,
        tipo: currentType,
        fecha: campoFecha.value,
        efectivo,
        tarjeta,
        detalle: document.getElementById('detalle').value.trim()
    };

    if (!payload.fecha) {
        mostrarEstado('Selecciona una fecha.', 'error');
        return;
    }

    btnGuardar.disabled = true;
    btnGuardar.innerText = 'Guardando...';
    mostrarEstado('', '');

    try {
        const resultado = await enviarEscritura(payload);

        mostrarEstado(
            resultado.message ||
                (editId
                    ? 'Registro actualizado correctamente.'
                    : 'Registro guardado correctamente.'),
            'success'
        );

        await cargarHistorial();
        await renderizarDashboard();

        resetFormulario();

    } catch (error) {
        mostrarEstado(
            error.message || 'No se pudo guardar el registro.',
            'error'
        );
    } finally {
        btnGuardar.disabled = false;

        const sigueEditando =
            document.getElementById('edit-id').value !== '';

        btnGuardar.innerText = sigueEditando
            ? 'Actualizar Registro'
            : 'Guardar en Sheets';
    }
});

// ==================================================
// HISTORIAL: ÚLTIMOS 10 MOVIMIENTOS
// ==================================================

async function cargarHistorial() {
    const pin = localStorage.getItem('quiosco_pin');
    const container = document.getElementById('historial-lista');

    if (!container || !pin) return;

    container.innerHTML =
        '<p style="text-align:center">Cargando últimos movimientos...</p>';

    try {
        const resultado = await fetchGoogle({
            pin,
            action: 'get',
            fecha: campoFecha.value || fechaLocalISO()
        });

        if (resultado.status !== 'success') {
            throw new Error(
                resultado.message || 'No se pudo cargar el historial.'
            );
        }

        const registros = (resultado.data || []).slice(0, 10);

        if (!registros.length) {
            container.innerHTML =
                '<p style="text-align:center">No hay registros para el mes seleccionado.</p>';
            return;
        }

        container.innerHTML = '';

        registros.forEach(reg => {
            const item = document.createElement('div');
            item.className = 'registro-item';

            const total = formatoCLP(reg.total);
            const efectivo = formatoCLP(reg.efectivo);
            const tarjeta = formatoCLP(reg.tarjeta);
            const tipo = String(reg.tipo || '').toUpperCase();

            item.innerHTML = `
                <div class="registro-info">
                    <h4>
                        <span class="badge ${tipo.toLowerCase()}">
                            ${escapeHtml(tipo)}
                        </span>
                        ${total}
                    </h4>
                    <p>
                        📅 ${escapeHtml(reg.fecha || '')}
                        | Efectivo: ${efectivo}
                        | Tarjeta: ${tarjeta}
                    </p>
                    <p><i>${escapeHtml(reg.detalle || 'Sin detalle')}</i></p>
                </div>
                <button class="btn-edit" type="button">
                    ✎ Editar
                </button>
            `;

            item.querySelector('.btn-edit').addEventListener('click', () => {
                prepararEdicion(reg);
            });

            container.appendChild(item);
        });

    } catch (error) {
        container.innerHTML = `
            <p style="text-align:center;color:#dc2626">
                ${escapeHtml(error.message || 'Error al cargar el historial.')}
            </p>
        `;
    }
}

// ==================================================
// EDITAR MOVIMIENTO
// ==================================================

window.prepararEdicion = function(registro) {
    document.getElementById('edit-id').value = registro.id;
    document.getElementById('form-title').innerText = 'Editando registro';

    campoFecha.value = String(registro.fecha || '').split('T')[0];

    // Se mantiene bloqueada la fecha durante la edición para
    // no trasladar accidentalmente el registro a otra hoja mensual.
    campoFecha.readOnly = true;

    document.getElementById('efectivo').value =
        MONEDA.format(Number(registro.efectivo) || 0);

    document.getElementById('tarjeta').value =
        MONEDA.format(Number(registro.tarjeta) || 0);

    document.getElementById('detalle').value = registro.detalle || '';

    currentType = String(registro.tipo || 'INGRESO').toUpperCase();

    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.toggle(
            'active',
            String(tab.dataset.target || '').toUpperCase() === currentType
        );
    });

    actualizarEtiquetaDetalle();

    btnGuardar.innerText = 'Actualizar Registro';
    btnGuardar.style.backgroundColor = '#059669';

    btnCancelar.classList.remove('hidden');

    const vistaRegistro = document.querySelector(
        '.nav-btn[onclick*="registro"]'
    );

    if (vistaRegistro) {
        vistaRegistro.click();
    } else {
        const primeraVista = document.querySelector('.nav-btn');
        if (primeraVista) primeraVista.click();
    }

    document.getElementById('form-title').scrollIntoView({
        behavior: 'smooth',
        block: 'center'
    });
};

btnCancelar.addEventListener('click', resetFormulario);

function resetFormulario() {
    form.reset();

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

    btnCancelar.classList.add('hidden');
}

// ==================================================
// MENSAJES
// ==================================================

function mostrarEstado(mensaje, tipo) {
    const elemento = document.getElementById('status-message');

    if (!elemento) return;

    if (!mensaje) {
        elemento.classList.add('hidden');
        elemento.innerText = '';
        return;
    }

    elemento.innerText = mensaje;
    elemento.className = `status-msg ${tipo}`;
}

function escapeHtml(valor) {
    return String(valor ?? '').replace(/[&<>"']/g, caracter => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[caracter]);
}

// ==================================================
// CREAR INTERFAZ DE RESÚMENES
// ==================================================

function asegurarInterfazDashboard() {
    const dashboard = document.getElementById('view-dashboard');

    if (!dashboard) return;

    if (!document.getElementById('resumen-periodos')) {
        const panel = document.createElement('section');
        panel.id = 'resumen-periodos';
        panel.style.cssText =
            'display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:16px 0;';

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

        dashboard.insertBefore(panel, dashboard.firstChild);
    }

    const canvasDiario = document.getElementById('graficoDiario');
    const canvasAnual = document.getElementById('graficoMensual');

    if (canvasDiario) {
        const contenedor = canvasDiario.parentElement;

        if (contenedor) {
            contenedor.style.minHeight = '280px';

            if (!contenedor.querySelector('.titulo-grafico-semanal')) {
                const titulo = document.createElement('h3');
                titulo.className = 'titulo-grafico-semanal';
                titulo.innerText = 'Actividad semanal: ingresos e inversiones';
                contenedor.insertBefore(titulo, canvasDiario);
            }
        }
    }

    if (canvasAnual) {
        const contenedor = canvasAnual.parentElement;

        if (contenedor) {
            contenedor.style.minHeight = '280px';

            if (!contenedor.querySelector('.titulo-grafico-anual')) {
                const titulo = document.createElement('h3');
                titulo.className = 'titulo-grafico-anual';
                titulo.innerText = 'Comparación anual por mes';
                contenedor.insertBefore(titulo, canvasAnual);
            }
        }
    }

    if (!document.getElementById('graficoResumenMensual')) {
        const bloque = document.createElement('section');

        bloque.id = 'bloque-grafico-mensual';
        bloque.style.cssText = 'margin:24px 0;';

        bloque.innerHTML = `
            <h3>Actividad mensual por día</h3>
            <div style="position:relative;width:100%;height:300px;">
                <canvas id="graficoResumenMensual"></canvas>
            </div>
        `;

        if (canvasAnual && canvasAnual.parentElement) {
            canvasAnual.parentElement.before(bloque);
        } else {
            dashboard.appendChild(bloque);
        }
    }
}

// ==================================================
// DASHBOARD: SEMANAL, MENSUAL, ANUAL Y ACUMULADO
// ==================================================

async function renderizarDashboard() {
    const pin = localStorage.getItem('quiosco_pin');

    if (!pin) return;

    asegurarInterfazDashboard();

    const resultadoCarga = await fetchGoogle({
        pin,
        action: 'get_dashboard',
        fecha: campoFecha.value || fechaLocalISO()
    });

    if (!resultadoCarga || resultadoCarga.status !== 'success') {
        throw new Error(
            resultadoCarga?.message || 'No se pudo cargar el panel.'
        );
    }

    const resultado = resultadoCarga;

    const semanal = resultado.semanal || {};
    const mensual = resultado.mensual || {};
    const anual = resultado.anualDetalle || {};
    const acumulado = resultado.acumulado || {};

    ponerTexto('sem-ingresos', formatoCLP(semanal.ingresos));
    ponerTexto('sem-inversiones', formatoCLP(semanal.inversiones));
    ponerTexto('sem-neta', formatoCLP(semanal.neta));

    ponerTexto(
        'sem-fechas',
        semanal.inicio && semanal.fin
            ? `${semanal.inicio} al ${semanal.fin}`
            : ''
    );

    ponerTexto('mes-ingresos', formatoCLP(mensual.ingresos));
    ponerTexto('mes-inversiones', formatoCLP(mensual.inversiones));
    ponerTexto('mes-neta', formatoCLP(mensual.neta));

    ponerTexto('anio-ingresos', formatoCLP(anual.ingresos));
    ponerTexto('anio-inversiones', formatoCLP(anual.inversiones));
    ponerTexto('anio-neta', formatoCLP(anual.neta));

    ponerTexto('hist-ingresos', formatoCLP(acumulado.ingresos));
    ponerTexto('hist-inversiones', formatoCLP(acumulado.inversiones));
    ponerTexto('hist-neta', formatoCLP(acumulado.neta));

    // Los KPI originales de la página ahora reflejan el mes actual.
    ponerTexto('kpi-ingresos', formatoCLP(mensual.ingresos));
    ponerTexto('kpi-inversion', formatoCLP(mensual.inversiones));
    ponerTexto('kpi-neta', formatoCLP(mensual.neta));

    dibujarGraficoSemanal(semanal.movimientos || []);
    dibujarGraficoResumenMensual(mensual.movimientos || []);
    dibujarGraficoAnual(anual.meses || resultado.anual || {});
}

function ponerTexto(id, texto) {
    const elemento = document.getElementById(id);

    if (elemento) {
        elemento.innerText = texto;
    }
}

// ==================================================
// GRÁFICO SEMANAL: LUNES A DOMINGO
// ==================================================

function dibujarGraficoSemanal(movimientos) {
    const canvas = document.getElementById('graficoDiario');

    if (!canvas || typeof Chart === 'undefined') return;

    const dias = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

    const valores = dias.map(() => ({
        ingreso: 0,
        inversion: 0
    }));

    movimientos.forEach(mov => {
        const fecha = parseFechaLocal(mov.fecha);

        if (!fecha) return;

        const indice = (fecha.getDay() + 6) % 7;
        const total = Number(mov.total) || 0;

        if (String(mov.tipo).toUpperCase() === 'INGRESO') {
            valores[indice].ingreso += total;
        } else if (String(mov.tipo).toUpperCase() === 'INVERSION') {
            valores[indice].inversion += total;
        }
    });

    if (chartSemanal) chartSemanal.destroy();

    chartSemanal = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: dias,
            datasets: [
                {
                    label: 'Ingresos',
                    data: valores.map(v => v.ingreso),
                    backgroundColor: '#1E3A8A',
                    borderRadius: 4
                },
                {
                    label: 'Inversiones',
                    data: valores.map(v => v.inversion),
                    backgroundColor: '#DC2626',
                    borderRadius: 4
                }
            ]
        },
        options: opcionesMonetarias()
    });
}

// ==================================================
// GRÁFICO MENSUAL: INGRESOS, INVERSIONES Y NETO
// ==================================================

function dibujarGraficoResumenMensual(movimientos) {
    const canvas = document.getElementById('graficoResumenMensual');

    if (!canvas || typeof Chart === 'undefined') return;

    const porFecha = {};

    movimientos.forEach(mov => {
        const fecha = String(mov.fecha || '').split('T')[0];

        if (!fecha) return;

        if (!porFecha[fecha]) {
            porFecha[fecha] = {
                ingreso: 0,
                inversion: 0
            };
        }

        const total = Number(mov.total) || 0;

        if (String(mov.tipo).toUpperCase() === 'INGRESO') {
            porFecha[fecha].ingreso += total;
        } else if (String(mov.tipo).toUpperCase() === 'INVERSION') {
            porFecha[fecha].inversion += total;
        }
    });

    const fechas = Object.keys(porFecha).sort();

    if (chartResumenMensual) chartResumenMensual.destroy();

    chartResumenMensual = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: fechas.map(fecha => fecha.slice(8, 10)),
            datasets: [
                {
                    label: 'Ingresos',
                    data: fechas.map(f => porFecha[f].ingreso),
                    backgroundColor: '#1E3A8A',
                    borderRadius: 3
                },
                {
                    label: 'Inversiones',
                    data: fechas.map(f => porFecha[f].inversion),
                    backgroundColor: '#DC2626',
                    borderRadius: 3
                },
                {
                    label: 'Ganancia neta',
                    data: fechas.map(f =>
                        porFecha[f].ingreso - porFecha[f].inversion
                    ),
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

// ==================================================
// GRÁFICO ANUAL: 12 MESES
// ==================================================

function dibujarGraficoAnual(datosAnuales) {
    const canvas = document.getElementById('graficoMensual');

    if (!canvas || typeof Chart === 'undefined') return;

    const meses = MESES;

    const valores = meses.map(mes => {
        const item = datosAnuales[mes] || {};

        return {
            ingreso: Number(item.ingreso ?? item.ingresos) || 0,
            inversion: Number(item.inversion ?? item.inversiones) || 0,
            neta: Number(item.neta) ||
                ((Number(item.ingreso ?? item.ingresos) || 0) -
                (Number(item.inversion ?? item.inversiones) || 0))
        };
    });

    if (chartAnual) chartAnual.destroy();

    chartAnual = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: meses.map(mes => mes.substring(0, 3)),
            datasets: [
                {
                    label: 'Ingresos',
                    data: valores.map(v => v.ingreso),
                    backgroundColor: '#1E3A8A',
                    borderRadius: 3
                },
                {
                    label: 'Inversiones',
                    data: valores.map(v => v.inversion),
                    backgroundColor: '#DC2626',
                    borderRadius: 3
                },
                {
                    label: 'Ganancia neta',
                    data: valores.map(v => v.neta),
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

// ==================================================
// OPCIONES COMUNES DE GRÁFICOS
// ==================================================

function opcionesMonetarias() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
            mode: 'index',
            intersect: false
        },
        plugins: {
            legend: {
                position: 'bottom',
                labels: {
                    boxWidth: 12
                }
            },
            tooltip: {
                callbacks: {
                    label: contexto => {
                        const valor = Number(contexto.raw) || 0;
                        return `${contexto.dataset.label}: ${formatoCLP(valor)}`;
                    }
                }
            }
        },
        scales: {
            y: {
                beginAtZero: true,
                ticks: {
                    callback: valor => '$' + MONEDA.format(Number(valor) || 0)
                }
            }
        }
    };
}

function parseFechaLocal(valor) {
    const texto = String(valor || '').split('T')[0];
    const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);

    if (!partes) return null;

    const fecha = new Date(
        Number(partes[1]),
        Number(partes[2]) - 1,
        Number(partes[3]),
        12, 0, 0
    );

    if (
        fecha.getFullYear() !== Number(partes[1]) ||
        fecha.getMonth() !== Number(partes[2]) - 1 ||
        fecha.getDate() !== Number(partes[3])
    ) {
        return null;
    }

    return fecha;
}

// ==================================================
// REFRESCAR CUANDO CAMBIA LA FECHA
// ==================================================

if (campoFecha) {
    campoFecha.addEventListener('change', async () => {
        if (document.getElementById('edit-id').value) return;

        if (localStorage.getItem('quiosco_pin')) {
            await cargarHistorial();
            await renderizarDashboard();
        }
    });
}

// ==================================================
// INICIALIZACIÓN
// ==================================================

window.cargarHistorial = cargarHistorial;
window.renderizarDashboard = renderizarDashboard;
window.prepararEdicion = prepararEdicion;
window.switchView = switchView;

if (localStorage.getItem('quiosco_pin')) {
    loginScreen?.classList.remove('active');
    appScreen?.classList.remove('hidden');
    appScreen?.classList.add('active');

    asegurarInterfazDashboard();

    cargarHistorial().catch(console.error);
    renderizarDashboard().catch(error => {
        console.error('No se pudo cargar el panel:', error);
    });
}
