let appState = {
    socket: null, // Socket.IO instance para NestJS
    estacionInfo: null, // <-- Nueva propiedad para almacenar la información de la estación
    claveVinculacion: null, // Clave de vinculación guardada de la estación
    productos: [],
    pesoActual: 0.0,
    ultimoEmpaque: null, // Para guardar los datos del último empaque para reimpresión
    basculaConectada: false,
    impresoraConectada: false, // Se mantiene para el estado local
    rfidConectado: false,
    currentPage: null // Página SPA activa: 'login' | 'dashboard' | 'historial'
};

// Parchear window.__TAURI__ si existe pero sin invoke/listen (external URLs sin withGlobalTauri inyectado)
if (window.__TAURI__ && window.__TAURI_INTERNALS__ && !window.__TAURI__.invoke) {
    window.__TAURI__.invoke = function(cmd, args) {
        return window.__TAURI_INTERNALS__.invoke(cmd, args || {});
    };
    window.__TAURI__.listen = function(event, handler) {
        var cb = window.__TAURI_INTERNALS__.transformCallback(handler);
        return window.__TAURI__.invoke('plugin:event|listen', {
            event: event,
            target: { kind: 'Any' },
            handler: cb
        }).then(function(eventId) {
            return function() {
                if (window.__TAURI_EVENT_PLUGIN_INTERNALS__) {
                    window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(event, eventId);
                }
                return window.__TAURI__.invoke('plugin:event|unlisten', {
                    event: event,
                    eventId: eventId
                });
            };
        });
    };
}

// Elementos DOM principales
const pages = {
    login: document.getElementById('login-page'),
    dashboard: document.getElementById('dashboard-page'),
    historial: document.getElementById('historial-page')
};


// Inicialización de la aplicación
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

// Inicializar aplicación (SPA: todo se sirve desde index.html)
function initializeApp() {
    setupEventListeners();

    const estacionInfo = sessionStorage.getItem('vorak_estacion_info');
    if (estacionInfo) {
        appState.estacionInfo = JSON.parse(estacionInfo);
        showPage('dashboard');
        onPageEnter('dashboard');
    } else {
        showPage('login');
        prefillClaveGuardada();
        initTurnstile();
    }

    displayStationInfo();
}

// Mostrar una página SPA (toggle de la clase .active)
function showPage(pageName) {
    ['login', 'dashboard', 'historial'].forEach(p => {
        const el = document.getElementById(`${p}-page`);
        if (el) el.classList.toggle('active', p === pageName);
    });
    appState.currentPage = pageName;
}

// Acciones al entrar a una página SPA
async function onPageEnter(pageName) {
    if (pageName === 'dashboard') {
        displayStationInfo();
        if (!appState.socket || !appState.socket.connected) {
            connectWebSocket();
        }
        connectFlaskBackend();
    } else if (pageName === 'historial') {
        loadProductosEstacion();
        setTimeout(() => {
            const epcInput = document.getElementById('epc-input');
            if (epcInput) epcInput.focus();
        }, 500);
    } else if (pageName === 'login') {
        autoLoginIntentado = false;
        prefillClaveGuardada();
        initTurnstile();
        const claveInput = document.getElementById('clave');
        if (claveInput) claveInput.focus();
    }
}

// Configurar event listeners
function setupEventListeners() {
    // Formulario de login
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', (e) => handleLogin(e));
    }

    // Selector de productos
    const productoSelect = document.getElementById('producto-select');
    if (productoSelect) {
        productoSelect.addEventListener('change', handleProductoChange);
    }

    // Input de producto (para manejar códigos de barras)
    const productoInput = document.getElementById('producto-input');
    if (productoInput) {
        productoInput.addEventListener('input', handleProductoInput);
        productoInput.addEventListener('keydown', handleProductoInputKeydown);
    }

    // Botones de navegación
    const pesarBtn = document.getElementById('pesar-btn');
    if (pesarBtn) {
        pesarBtn.addEventListener('click', handlePesar);
    }

    const historialBtn = document.getElementById('historial-btn');
    if (historialBtn) {
        historialBtn.addEventListener('click', () => {
            navigateToPage('historial');
        });
    }

    // Botón de búsqueda por EPC (disponible en la página de historial)
    const buscarEpcBtn = document.getElementById('buscar-epc-btn');
    if (buscarEpcBtn) {
        buscarEpcBtn.addEventListener('click', buscarEmpaquePorEpc);
    }

    // También permitir buscar al presionar Enter en el input
    const epcInput = document.getElementById('epc-input');
    if (epcInput) {
        epcInput.addEventListener('keypress', function(event) {
            if (event.key === 'Enter') {
                buscarEmpaquePorEpc();
                // Limpiar el input después de buscar
                epcInput.value = '';
            }
        });
    }

    const volverDashboardBtn = document.getElementById('volver-dashboard-btn');
    if (volverDashboardBtn) {
        volverDashboardBtn.addEventListener('click', () => navigateToPage('dashboard'));
    }

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }

    const updateNowBtn = document.getElementById('update-now-btn');
    if (updateNowBtn) {
        updateNowBtn.addEventListener('click', handleUpdateNow);
    }

    // Listener global para la tecla de flecha derecha en el dashboard
    document.addEventListener('keydown', function(event) {
        // Asegurarse de que solo se active en la página del dashboard
        if (appState.currentPage === 'dashboard') {
            // Verificar si la tecla presionada es la flecha derecha
            if (event.key === 'ArrowRight') {
                // Prevenir cualquier acción por defecto del navegador
                event.preventDefault();

                // Simular un clic en el botón "PESAR"
                const pesarBtn = document.getElementById('pesar-btn');
                if (pesarBtn) {
                    pesarBtn.click();
                }
            }
        }
    });
}

// (La función checkExistingSession basada en pathname se eliminó al migrar a SPA:
// la verificación de sesión ahora vive dentro de initializeApp).

// Mostrar información de la estación en el dashboard
function displayStationInfo() {
    const stationInfo = sessionStorage.getItem('vorak_estacion_info');
    if (stationInfo) {
        const estacion = JSON.parse(stationInfo);
        
        // Actualizar elementos del DOM con la información de la estación
        const stationIdElement = document.getElementById('station-id');
        const frigorificoNameElement = document.getElementById('frigorifico-name');
        const lastConnectionElement = document.getElementById('last-connection');
        
        if (stationIdElement) {
            stationIdElement.textContent = `ID: ${estacion.id_estacion}`;
        }
        
        if (frigorificoNameElement) {
            frigorificoNameElement.textContent = `Frigorífico: ${estacion.frigorifico?.nombre_frigorifico || 'N/A'}`;
        }
        
        if (lastConnectionElement) {
            // Formatear la fecha de última conexión
            if (estacion.ultima_conexion) {
                const date = new Date(estacion.ultima_conexion);
                lastConnectionElement.textContent = `Última conexión: ${date.toLocaleString()}`;
            } else {
                lastConnectionElement.textContent = 'Última conexión: N/A';
            }
        }
    }
}

// Navegación SPA entre páginas (sin recargar: el token HttpOnly se conserva
// y no se pierde estado de la app).
async function navigateToPage(pageName) {
    if (appState.currentPage === pageName) return;

    // Si salimos del dashboard, desconectamos los sockets limpiamente.
    if (appState.currentPage === 'dashboard') {
        await disconnectWebSockets();
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Si salimos del login, destruir el widget de Turnstile para que no
    // siga emitiendo callbacks (expired, error) ni mantenga el iframe activo.
    if (appState.currentPage === 'login' && typeof turnstile !== 'undefined') {
        try {
            turnstile.remove('#turnstile-widget');
        } catch (e) {}
        turnstileToken = null;
    }

    showPage(pageName);
    await onPageEnter(pageName);
}

// Variables para Turnstile
let turnstileToken = null;
let autoLoginIntentado = false;

// Rellenar el input con la clave de vinculación guardada de sesiones anteriores
function prefillClaveGuardada() {
    const claveInput = document.getElementById('clave');
    if (!claveInput) return;

    const savedClave = localStorage.getItem('vorak_clave_vinculacion');
    if (savedClave) {
        claveInput.value = savedClave;
        appState.claveVinculacion = savedClave;
    }
}

// Iniciar sesión automáticamente si hay clave guardada y no venimos de un logout explícito
function maybeAutoLogin() {
    if (autoLoginIntentado) return;

    const savedClave = localStorage.getItem('vorak_clave_vinculacion');
    const logoutExplicito = sessionStorage.getItem('vorak_logout');

    if (savedClave && !logoutExplicito && turnstileToken) {
        autoLoginIntentado = true;
        handleLogin();
    }
}

async function initTurnstile() {
    let siteKey;

    // Obtener la Site Key de Turnstile (la URL del backend ya no se necesita:
    // todas las llamadas van same-origin vía el proxy /api).
    try {
        if (window.__TAURI__) {
            const config = await window.__TAURI__.invoke('get_config');
            siteKey = config.turnstile_site_key;
        }
    } catch (error) {
        console.error('Error obteniendo Site Key:', error);
    }

    if (!siteKey) {
        console.error('No se pudo obtener la Site Key de Turnstile. El widget no se renderizará.');
        return;
    }

    if (typeof turnstile === 'undefined') {
        console.error('Turnstile API no está disponible. Reintentando en 1s...');
        if (appState.currentPage === 'login') {
            setTimeout(initTurnstile, 1000);
        }
        return;
    }

    turnstile.ready(function() {
        turnstile.render('#turnstile-widget', {
            sitekey: siteKey,
            callback: function(token) {
                turnstileToken = token;
                const loginButton = document.getElementById('loginButton');
                if (loginButton) {
                    loginButton.disabled = false;
                    loginButton.textContent = 'Iniciar Sesión';
                }
                maybeAutoLogin();
            },
            'error-callback': function() {
                if (appState.currentPage !== 'login') return;
                turnstileToken = null;
                const loginButton = document.getElementById('loginButton');
                if (loginButton) {
                    loginButton.disabled = true;
                }
                showMessage('Error en la verificación de seguridad. Inténtalo de nuevo.', 'error');
            },
            'expired-callback': function() {
                if (appState.currentPage !== 'login') return;
                turnstileToken = null;
                const loginButton = document.getElementById('loginButton');
                if (loginButton) {
                    loginButton.disabled = true;
                }
                showMessage('La verificación de seguridad ha expirado. Actualiza la página.', 'error');
            }
        });
    });
}

// Keep backward compat for any direct calls
window.onloadTurnstileCallback = initTurnstile;

// (waitForSessionEstablishment se eliminó: al migrar a SPA no hay recarga de página
// y la cookie HttpOnly queda disponible inmediatamente tras el login.)

// Manejar login
async function handleLogin(event) {
    if (event) event.preventDefault();

    if (!turnstileToken) {
        showMessage('Completa la verificación de seguridad primero.', 'error');
        return;
    }

    const clave = document.getElementById('clave').value;

    if (!clave) {
        showMessage('Por favor ingrese la clave de vinculación', 'error');
        return;
    }

    const loginButton = document.getElementById('loginButton');
    if (loginButton) {
        loginButton.disabled = true;
        loginButton.textContent = 'Iniciando sesión...';
    }

    try {
        // Login same-origin vía el proxy /api. La cookie HttpOnly que devuelve
        // el backend se almacena como first-party y viaja automáticamente en el
        // handshake del WS. JS nunca toca el token.
        const response = await fetch(`/api/frigorifico/estacion/login/${encodeURIComponent(clave)}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include', // ✅ IMPORTANTE: Envía y recibe cookies
            body: JSON.stringify({
                turnstileToken: turnstileToken
            })
        });

        if (response.ok) {
            const data = await response.json();

            // El token JWT viaja únicamente en cookie HttpOnly (same-origin vía proxy).
            // JS no tiene acceso al token: el handshake WS se autentica con la cookie.
            appState.estacionInfo = data.estacion; // <-- Almacenar la información de la estación
            sessionStorage.setItem('vorak_estacion_info', JSON.stringify(data.estacion)); // <-- Guardar en sessionStorage

            // Guardar la clave de vinculación como estado persistente para futuros inicios de sesión
            appState.claveVinculacion = clave;
            localStorage.setItem('vorak_clave_vinculacion', clave);
            sessionStorage.removeItem('vorak_logout');

            // Mostrar información de la estación
            displayStationInfo();

            // Verificar si hay actualizacion disponible antes de mostrar el dashboard
            const necesitaUpdate = await checkForUpdate();
            if (necesitaUpdate) {
                return;
            }

            // Navegar al dashboard (SPA: sin recarga, la cookie se conserva)
            navigateToPage('dashboard');
        } else {
            // Si el backend rechaza la clave, eliminarla del estado guardado
            if (response.status === 401 || response.status === 403 || response.status === 404) {
                localStorage.removeItem('vorak_clave_vinculacion');
                appState.claveVinculacion = null;
            }
            const errorData = await response.json().catch(() => ({ detail: 'Error de autenticación' }));
            showMessage(errorData.detail || 'Error de autenticación', 'error');
            // Resetear Turnstile para nueva verificación
            turnstile.reset('#turnstile-widget');
            turnstileToken = null;
            if (loginButton) {
                loginButton.disabled = true;
            }
        }
    } catch (error) {
        console.error('Error en login:', error);
        showMessage('Error de conexión. Inténtalo de nuevo.', 'error');
        // Resetear Turnstile
        turnstile.reset('#turnstile-widget');
        turnstileToken = null;
        if (loginButton) {
            loginButton.disabled = true;
        }
    } finally {
        if (loginButton) {
            loginButton.textContent = 'Iniciar Sesión';
        }
    }
}

async function checkForUpdate() {
    try {
        if (!window.__TAURI__) return false;

        const config = await window.__TAURI__.invoke('get_config');
        const currentVersion = config.app_version;
        if (!currentVersion) return false;

        const response = await fetch('https://api.github.com/repos/jumaar/estacion-vorak/releases/latest');
        if (!response.ok) return false;

        const release = await response.json();
        const latestVersion = release.tag_name.replace(/^v/, '');

        if (latestVersion !== currentVersion) {
            document.getElementById('update-current-version').textContent = currentVersion;
            document.getElementById('update-latest-version').textContent = latestVersion;
            document.getElementById('update-overlay').style.display = 'flex';
            return true;
        }

        return false;
    } catch {
        return false;
    }
}

async function handleUpdateNow() {
    const btn = document.getElementById('update-now-btn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Actualizando...';
    }

    try {
        if (window.__TAURI__) {
            const result = await window.__TAURI__.invoke('update_app');
            if (result === 'actualizado') {
                window.location.reload();
            }
        }
    } catch (e) {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Actualizar Ahora';
        }
        showMessage('Error al actualizar: ' + e, 'error');
    }
}

// Inicializar dashboard
async function initializeDashboard() {
}


// Actualizar selector de productos
function updateProductoSelect() {
    const select = document.getElementById('producto-select');
    if (!select) return;

    select.innerHTML = '<option value="">Seleccione un producto...</option>';

    appState.productos.forEach(producto => {
        const option = document.createElement('option');
        option.value = producto.id;
        option.textContent = `${producto.id} - ${producto.nombre} - ${producto.peso}g`;
        select.appendChild(option);
    });
}

// Conectar WebSocket directamente a NestJS
async function connectWebSocket() {
    if (appState.socket && appState.socket.connected) {
        return;
    }

    // Verificar que Socket.IO esté disponible
    if (typeof io === 'undefined') {
        console.error('Socket.IO no está cargado aún. Reintentando en 1 segundo...');
        setTimeout(connectWebSocket, 1000);
        return;
    }

    try {
        // Conexión same-origin al proxy (http://localhost:9527), que puentea
        // HTTP y WebSocket a NestJS. La cookie HttpOnly (first-party) viaja
        // automáticamente y autentica el handshake — el JWT nunca toca JS.
        // Polling primero (HTTP normal, el proxy lo maneja con reqwest); si el
        // upgrade a WS llega a fallar, Socket.IO se mantiene en polling.
        appState.socket = io({
            path: '/api/frigorifico/estacion/ws',
            withCredentials: true,
            transports: ['polling', 'websocket']
        });

        // --- Manejadores de eventos de Socket.IO ---

        appState.socket.on('connect', () => {
            // Una vez conectado, solicitar el catálogo de productos
            appState.socket.emit('get-catalogo');
        });

        appState.socket.on('connect_error', (error) => {
            console.error('Error en la conexión WebSocket directa a NestJS:', error);
            showMessage('Error en la conexión WebSocket: ' + error.message, 'error');
        });

        appState.socket.on('peso_data', (data) => {
            updatePesoData(data);
        });

        // Escuchar el evento de catálogo
        appState.socket.on('catalogo', (productos) => {
            appState.productos = productos;
            updateProductoSelect();
        });

        // Escuchar errores relacionados con el catálogo
        appState.socket.on('error', (error) => {
            if (error.tipo === 'catalogo-error') {
                console.error('❌ Error obteniendo catálogo:', error.mensaje);
                showMessage('Error cargando productos: ' + error.mensaje, 'error');
            }
        });

        appState.socket.on('disconnect', (reason) => {
            console.log('Desconectado del servidor NestJS:', reason);
            // El gateway solo fuerza la desconexión cuando la autenticación falla (token ausente/expirado)
            if (reason === 'io server disconnect') {
                handleSessionExpired();
            }
        });

    } catch (error) {
        console.error('Error conectando WebSocket directo a NestJS:', error);
        showMessage('Error al establecer conexión WebSocket: ' + error.message, 'error');
    }
}

// Conectar al backend local (Tauri) para datos de hardware
let unlistenHandlers = [];

async function connectFlaskBackend() {
    // Cleanup previous listeners
    for (const unlisten of unlistenHandlers) {
        try { unlisten(); } catch (e) {}
    }
    unlistenHandlers = [];

    try {
        // Obtener estado inicial de los componentes
        const initialStatus = await window.__TAURI__.invoke('get_component_status');
        appState.basculaConectada = initialStatus.bascula_conectada || false;
        appState.impresoraConectada = initialStatus.impresora_conectada || false;
        appState.rfidConectado = initialStatus.rfid_conectado || false;
        updateStatusIndicators();
    } catch (e) {
        console.error('Error obteniendo estado de componentes:', e);
    }

    // Escuchar cambios de estado de componentes
    const unlisten1 = await window.__TAURI__.listen('component_status', (event) => {
        const data = event.payload;
        const basculaChanged = appState.basculaConectada !== (data.bascula_conectada || false);
        const impresoraChanged = appState.impresoraConectada !== (data.impresora_conectada || false);
        const rfidChanged = appState.rfidConectado !== (data.rfid_conectado || false);

        appState.basculaConectada = data.bascula_conectada || false;
        appState.impresoraConectada = data.impresora_conectada || false;
        appState.rfidConectado = data.rfid_conectado || false;

        if (basculaChanged) {
            const status = appState.basculaConectada ? 'conectada' : 'desconectada';
            showMessage(`Báscula ${status}`, appState.basculaConectada ? 'success' : 'error');
        }
        if (impresoraChanged) {
            const status = appState.impresoraConectada ? 'conectada' : 'desconectada';
            showMessage(`Impresora ${status}`, appState.impresoraConectada ? 'success' : 'error');
        }
        if (rfidChanged) {
            const status = appState.rfidConectado ? 'conectado' : 'desconectado';
            showMessage(`RFID/TAG ${status}`, appState.rfidConectado ? 'success' : 'error');
        }

        updateStatusIndicators();
    });
    unlistenHandlers.push(unlisten1);

    // Escuchar peso de la báscula
    const unlisten2 = await window.__TAURI__.listen('peso_en_gramos', (event) => {
        appState.pesoActual = event.payload.peso;
        updatePesoDisplayFromGrams(event.payload.peso);
    });
    unlistenHandlers.push(unlisten2);

    // Escuchar eventos de impresión
    const unlisten3 = await window.__TAURI__.listen('impresion_completada', (event) => {
        showMessage(event.payload.mensaje || 'Etiqueta impresa exitosamente', 'success');
    });
    unlistenHandlers.push(unlisten3);

    const unlisten4 = await window.__TAURI__.listen('impresion_error', (event) => {
        showMessage(event.payload.error || 'Error de impresión', 'error');
    });
    unlistenHandlers.push(unlisten4);
}

// Función para actualizar el display de peso desde gramos
function updatePesoDisplayFromGrams(gramos) {
    // Actualizar el display de peso con el valor en gramos
    const pesoDisplayElement = document.getElementById('peso-display');
    if (pesoDisplayElement) {
        pesoDisplayElement.textContent = gramos + ' g';
    }
    
    // Asegurarse de que el display principal también se actualice
    const pesoMainDisplay = document.querySelector('#dashboard-page .peso-display');
    if (pesoMainDisplay && pesoMainDisplay !== pesoDisplayElement) {
        pesoMainDisplay.textContent = gramos + ' g';
    }
}

// Actualizar datos de peso
function updatePesoData(data) {
    appState.pesoActual = data.peso || 0.0;
    appState.basculaConectada = data.bascula_conectada || false;
    appState.impresoraConectada = data.impresora_conectada || false;
    appState.rfidConectado = data.rfid_conectado || false;

    // Actualizar UI
    const pesoElement = document.getElementById('peso-actual');
    if (pesoElement) {
        pesoElement.textContent = appState.pesoActual.toFixed(2);
    }
    
    // Actualizar el nuevo display de peso
    const pesoDisplayElement = document.getElementById('peso-display');
    if (pesoDisplayElement) {
        pesoDisplayElement.textContent = appState.pesoActual.toFixed(0) + ' g';
    }
    
    // Asegurarse de que el display principal también se actualice
    const pesoMainDisplay = document.querySelector('#dashboard-page .peso-display');
    if (pesoMainDisplay) {
        pesoMainDisplay.textContent = appState.pesoActual.toFixed(0) + ' g';
    }

    // Actualizar indicadores de estado
    updateStatusIndicators();

    // Actualizar estadísticas del dashboard
    updateDashboardStats();
}


// Actualizar indicadores de estado
function updateStatusIndicators() {
    const basculaStatus = document.getElementById('bascula-status');
    const impresoraStatus = document.getElementById('impresora-status');
    const rfidStatus = document.getElementById('rfid-status');

    if (basculaStatus) {
        const button = basculaStatus.querySelector('.status-btn');
        if (button) {
            button.className = `status-btn ${appState.basculaConectada ? 'status-on' : 'status-off'}`;
        }
    }

    if (impresoraStatus) {
        const button = impresoraStatus.querySelector('.status-btn');
        if (button) {
            button.className = `status-btn ${appState.impresoraConectada ? 'status-on' : 'status-off'}`;
        }
    }

    if (rfidStatus) {
        const button = rfidStatus.querySelector('.status-btn');
        if (button) {
            button.className = `status-btn ${appState.rfidConectado ? 'status-on' : 'status-off'}`;
        }
    }
}

// Actualizar estadísticas del dashboard
function updateDashboardStats() {
    const estadoSistema = document.getElementById('estado-sistema');

    if (estadoSistema) {
        const conectado = appState.basculaConectada && appState.impresoraConectada && appState.rfidConectado;
        estadoSistema.textContent = conectado ? 'Listo' : 'Verificar Conexiones';
        estadoSistema.style.color = conectado ? 'var(--color-success)' : 'var(--color-error)';
    }
}

// Manejar pesaje
async function handlePesar() {
    const productoSelect = document.getElementById('producto-select');
    const selectedProductoId = productoSelect.value;

    if (!selectedProductoId) {
        showMessage('Por favor seleccione un producto', 'error');
        return;
    }

    if (appState.pesoActual <= 0) {
        showMessage('Peso inválido. Verifique la báscula', 'error');
        return;
    }

    // Validar que todos los dispositivos estén conectados
    if (!appState.basculaConectada) {
        showMessage('Báscula no conectada. No se puede pesar.', 'error');
        return;
    }

    if (!appState.impresoraConectada) {
        showMessage('Impresora no conectada. No se puede pesar.', 'error');
        return;
    }

    if (!appState.rfidConectado) {
        showMessage('Sistema RFID/TAG no conectado. No se puede pesar.', 'error');
        return;
    }

    // Nueva validación: Asegurar que el campo de EPC no esté vacío
    const productoInput = document.getElementById('producto-input');
    const epcIngresado = productoInput ? productoInput.value.trim() : '';
    if (!epcIngresado) {
        showMessage('Por favor, ingrese o escanee un código EPC antes de pesar.', 'error');
        return;
    }

    // Obtener el producto seleccionado para verificar su peso base
    const productoSeleccionado = appState.productos.find(p => p.id == selectedProductoId);
    if (!productoSeleccionado) {
        showMessage('Producto no encontrado en el catálogo', 'error');
        return;
    }

    // Validar que el peso esté en el rango de tolerancia (+/- 100g del peso base del producto)
    const pesoBase = productoSeleccionado.peso;
    const toleranciaGramos = 100;
    const pesoMinimo = pesoBase - toleranciaGramos;
    const pesoMaximo = pesoBase + toleranciaGramos;

    if (appState.pesoActual < pesoMinimo || appState.pesoActual > pesoMaximo) {
        showMessage(`El peso está fuera de tolerancia. Peso actual: ${appState.pesoActual}g. Rango permitido: ${pesoMinimo}g - ${pesoMaximo}g`, 'error', 8000);
        return;
    }

    // Asegurarse de que el WebSocket esté conectado antes de enviar
    if (!appState.socket || !appState.socket.connected) {
        connectWebSocket();

        // Esperar un poco para que se conecte
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Validar que el EPC tenga un formato válido (al menos 10 caracteres para códigos EPC)
    if (epcIngresado && epcIngresado.length < 10) {
        showMessage('El código EPC debe tener al menos 10 caracteres.', 'error');
        return;
    }

    // Construir el objeto de empaque
    const empaque = {
        id_producto: parseInt(selectedProductoId),
        peso_g: appState.pesoActual
    };

    // Añadir EPC si se proporcionó en el input
    if (epcIngresado) {
        empaque.epc = epcIngresado;
    }

    // Enviar a través de WebSocket y esperar respuesta
    if (appState.socket && appState.socket.connected) {
        // Configurar listener para la respuesta antes de enviar
        const responsePromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout esperando respuesta del servidor'));
            }, 10000); // 10 segundos de timeout

            appState.socket.once('empaques-creados', (data) => {
                clearTimeout(timeout);
                resolve(data);
    
                // Después de recibir la respuesta, enviar a backend local para impresión
                if (data.creados > 0 && data.empaques && data.empaques.length > 0) {
                    const empaque = data.empaques[0];
    
                    window.__TAURI__.invoke('imprimir_etiqueta', {
                        fechaVencimiento: empaque.fecha_vencimiento || 'N/A',
                        precioTotal: empaque.precio_venta_total || 0
                    }).catch(e => console.error('Error enviando a imprimir:', e));
                }
            });

            appState.socket.once('error', (error) => {
                clearTimeout(timeout);
                if (error.tipo === 'empaque-error') {
                    reject(new Error(error.mensaje));
                } else {
                    reject(new Error('Error desconocido del servidor'));
                }
            });
        });

        // Enviar el mensaje
        appState.socket.emit('crear-empaques', { empaques: [empaque] });
        
        try {
            // Esperar la respuesta
            const response = await responsePromise;

            // Procesar la respuesta
            if (response.creados > 0 && response.empaques && response.empaques.length > 0) {
                const empaqueCreado = response.empaques[0];
                showMessage(`Empaque creado exitosamente. EPC: ${empaqueCreado.epc}`, 'success', 8000);

                // Obtener el nombre del producto seleccionado del menú desplegable
                const productoSelect = document.getElementById('producto-select');
                const selectedOption = productoSelect.options[productoSelect.selectedIndex];
                let nombreProductoSeleccionado = 'Producto';
                
                if (selectedOption && selectedOption.text) {
                    // El formato en el select es "id - nombre - peso", así que extraemos solo el nombre
                    const partes = selectedOption.text.split(' - ');
                    if (partes.length >= 2) {
                        nombreProductoSeleccionado = partes[1]; // Nombre del producto
                    } else {
                        nombreProductoSeleccionado = partes[0]; // En caso de que solo tenga el ID
                    }
                }
                
                // Actualizar la UI con los datos del empaque creado
                updateUltimoEmpaque({
                    id: empaqueCreado.id || 'N/A',
                    id_producto: empaqueCreado.id_producto || selectedProductoId,
                    producto: nombreProductoSeleccionado,
                    peso_g: empaqueCreado.peso_g || appState.pesoActual,
                    precio_total: empaqueCreado.precio_venta_total || 0,
                    epc: empaqueCreado.epc || 'N/A',
                    fecha_creacion: new Date().toISOString()
                });

                // Limpiar el input después de un pesaje exitoso
                const productoInput = document.getElementById('producto-input');
                if (productoInput) {
                    productoInput.value = '';
                }

                // Actualizar estadísticas
                updateDashboardStats();

                // Enfocar el input después de presionar PESAR
                setTimeout(() => {
                    if (productoInput) {
                        productoInput.focus();
                    }
                }, 100);
            }

            if (response.errores && response.errores.length > 0) {
                
                response.errores.forEach(error => {
                    let mensajeError = '';
                    if (error.code === 'EPC_DUPLICADO') {
                        mensajeError = `EPC duplicado: ${error.epc}. Este código ya existe en el sistema.`;
                        // Limpiar el input cuando hay EPC duplicado
                        const productoInput = document.getElementById('producto-input');
                        if (productoInput) {
                            productoInput.value = '';
                            setTimeout(() => {
                                productoInput.focus();
                            }, 10);
                        }
                    } else {
                        mensajeError = `Error: ${error.error || error.mensaje}`;
                    }
                    showMessage(mensajeError, 'error', 8000); // 8 segundos para errores
                });
            }

        } catch (error) {
            console.error('Error procesando respuesta:', error);
            showMessage(error.message || 'Error procesando la respuesta del servidor', 'error');
        }
    } else {
        showMessage('No hay conexión con el servidor. Intente de nuevo.', 'error');
    }
}



// Manejar cambio de producto seleccionado
function handleProductoChange() {
    const productoSelect = document.getElementById('producto-select');
    const productoSeleccionadoDiv = document.getElementById('producto-seleccionado');
    const productoTexto = productoSeleccionadoDiv.querySelector('.producto-texto');
    const productoInput = document.getElementById('producto-input');

    const selectedOption = productoSelect.options[productoSelect.selectedIndex];

    if (productoSelect.value && selectedOption.text) {
        // Mostrar el producto seleccionado en formato "nombre - peso"
        productoTexto.textContent = selectedOption.text;
        productoTexto.classList.add('seleccionado');

        // Limpiar el input cuando se cambia de producto
        if (productoInput) {
            productoInput.value = '';
        }

        // Enfocar el input después de seleccionar un producto
        setTimeout(() => {
            if (productoInput) {
                productoInput.focus();
            }
        }, 100);
    } else {
        productoTexto.textContent = 'Ningún producto seleccionado';
        productoTexto.classList.remove('seleccionado');
    }
}

// Manejar entrada de texto en el input de producto
function handleProductoInput(event) {
    const input = event.target;
    const value = input.value;

    // Si el valor contiene un salto de línea (Enter), procesar el código
    if (value.includes('\n') || value.includes('\r')) {
        // Extraer solo el código antes del Enter
        const cleanValue = value.replace(/[\r\n]+/g, '').trim();
        input.value = cleanValue;
    }
}

// Variable para controlar el estado de lectura de códigos
let lastCodeTime = 0;

// Manejar eventos de teclado en el input de producto
function handleProductoInputKeydown(event) {
    const input = event.target;

    // Si se presiona Enter, procesar el código completo
    if (event.key === 'Enter') {
        event.preventDefault();
        const value = input.value.trim();

        // Si hay un valor, mantenerlo limpio
        if (value) {
            input.value = value;
        }
    }
}

// Actualizar último empaque
function updateUltimoEmpaque(empaque) {
    const container = document.getElementById('ultimo-empaque-info');
    if (!container) return;

    appState.ultimoEmpaque = empaque; // Guardar los datos para la reimpresión
    // Formatear el nombre del producto con ID
    const nombreConId = `${empaque.id_producto || 'N/A'}-${empaque.producto || 'Producto'}`;
    
    container.innerHTML = `
        <div class="empaque-info">
            <p><strong>Producto:</strong> ${nombreConId}</p>
            <p><strong>Peso:</strong> ${empaque.peso_g} g</p>
            <p><strong>Precio:</strong> $${empaque.precio_total}</p>
            <p><strong>EPC:</strong> ${empaque.epc}</p>
            <p><strong>Fecha:</strong> ${new Date(empaque.fecha_creacion).toLocaleString()}</p>
            <button id="reimprimir-btn" class="btn btn-primary">Reimprimir</button>
        </div>
    `;

    // Añadir el event listener para el nuevo botón
    const reimprimirBtn = document.getElementById('reimprimir-btn');
    if (reimprimirBtn) {
        reimprimirBtn.addEventListener('click', handleReimprimir);
    }
}

// Función para manejar la reimpresión
function handleReimprimir() {
    if (!appState.ultimoEmpaque) {
        showMessage('No hay datos del último empaque para reimprimir.', 'error');
        return;
    }

    if (!appState.impresoraConectada) {
        showMessage('Impresora no conectada. No se puede reimprimir.', 'error');
        return;
    }

    // Enviar los datos del último empaque guardado al backend local para reimprimir
    showMessage('Enviando a reimprimir...', 'info');
    window.__TAURI__.invoke('reimprimir_etiqueta', {
        pesoG: appState.ultimoEmpaque.peso_g,
        fechaCreacion: appState.ultimoEmpaque.fecha_creacion,
        fechaVencimiento: appState.ultimoEmpaque.fecha_vencimiento || 'N/A',
        precioTotal: appState.ultimoEmpaque.precio_total || 0
    }).catch(e => {
        console.error('Error al reimprimir:', e);
        showMessage('Error al enviar reimpresión: ' + e, 'error');
    });
}

// Cargar historial de productos de la estación
async function loadProductosEstacion() {
    try {
        // Obtener el ID de la estación del estado de la aplicación
        const estacionInfo = sessionStorage.getItem('vorak_estacion_info');
        if (!estacionInfo) {
            showMessage('No se encontró información de la estación', 'error');
            return;
        }

        const estacion = JSON.parse(estacionInfo);
        const estacionId = estacion.id_estacion;

        // Petición same-origin vía proxy /api (la cookie HttpOnly viaja sola).
        const response = await fetch(`/api/frigorifico/estacion/${estacionId}`, {
            method: 'GET',
            credentials: 'include', // Para enviar cookies HttpOnly
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if (response.status === 401) {
            handleSessionExpired();
            return;
        }

        if (!response.ok) {
            throw new Error(`Error en la petición: ${response.status}`);
        }

        const data = await response.json();
        
        // Procesar la respuesta para calcular totales
        let totalProductos = 0;
        let totalPeso = 0;
        
        data.productos.forEach(producto => {
            totalProductos += producto.cantidad_total;
            producto.empaques.forEach(empaque => {
                totalPeso += parseFloat(empaque.peso_g);
            });
        });
        
        // Actualizar los totales en la UI
        const productosHoyElement = document.getElementById('productos-hoy');
        const pesoTotalElement = document.getElementById('peso-total');
        
        if (productosHoyElement) {
            productosHoyElement.textContent = totalProductos;
        }
        
        if (pesoTotalElement) {
            // Convertir de gramos a kilogramos para mostrar
            pesoTotalElement.textContent = (totalPeso / 1000).toFixed(2);
        }
        
        // Guardar los productos en el estado de la aplicación para búsquedas locales
        appState.productosEstacion = data.productos;
        
        // Renderizar la tabla de productos con desplegables
        renderProductosTable(data.productos);
        
    } catch (error) {
        console.error('Error cargando productos de la estación:', error);
        showMessage('Error cargando productos de la estación', 'error');
    }
}

// Renderizar tabla de productos con desplegables de empaques
function renderProductosTable(productos) {
    const tbody = document.getElementById('historial-list');
    if (!tbody) return;

    if (productos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6">No hay productos registrados</td></tr>';
        return;
    }

    let tableHTML = '';

    productos.forEach(producto => {
        // Fila principal del producto que actúa como título
        tableHTML += `
            <tr class="producto-row" data-producto-id="${producto.id_producto}">
                <td colspan="6">
                    <div class="producto-header">
                        <h3>${producto.id_producto} - ${producto.nombre_producto} - ${producto.peso_nominal_g || 'N/A'}g</h3>
                        <button class="toggle-empaques-btn" data-producto-id="${producto.id_producto}">
                            Ver ${producto.cantidad_total} empaques ▼
                        </button>
                    </div>
                </td>
            </tr>
            <tr class="product-header-row" style="display: none;" data-producto-id="${producto.id_producto}">
                <th>ID</th>
                <th>Producto</th>
                <th>Peso</th>
                <th>EPC</th>
                <th>Fecha</th>
                <th>Acciones</th>
            </tr>
        `;

        // Filas de empaques (inicialmente ocultas)
        producto.empaques.forEach((empaque, index) => {
            tableHTML += `
                <tr class="empaque-row" data-empaque-id="${empaque.id}" style="display: none;" data-producto-id="${producto.id_producto}">
                    <td>${producto.id_producto}</td>
                    <td>${producto.nombre_producto}</td>
                    <td>${empaque.peso_g}g</td>
                    <td>${empaque.epc}</td>
                    <td>${new Date(empaque.fecha_empaque).toLocaleString()}</td>
                    <td>
                        <button class="btn btn-danger btn-small btn-eliminar-empaque" data-empaque-id="${empaque.id}">Eliminar</button>
                    </td>
                </tr>
            `;
        });
    });

    tbody.innerHTML = tableHTML;

    // Añadir event listeners para los botones de toggle
    document.querySelectorAll('.toggle-empaques-btn').forEach(button => {
        button.addEventListener('click', function() {
            const productoId = this.getAttribute('data-producto-id');
            const empaqueRows = document.querySelectorAll(`.empaque-row[data-producto-id="${productoId}"]`);
            const headerRow = document.querySelector(`.product-header-row[data-producto-id="${productoId}"]`);
            
            // Alternar visibilidad de las filas de empaques
            empaqueRows.forEach(row => {
                if (row.style.display === 'none') {
                    row.style.display = '';
                } else {
                    row.style.display = 'none';
                }
            });
            
            // Alternar visibilidad del encabezado
            if (headerRow) {
                if (headerRow.style.display === 'none') {
                    headerRow.style.display = '';
                } else {
                    headerRow.style.display = 'none';
                }
            }
            
            // Cambiar el texto del botón según el estado
            const isVisible = empaqueRows[0] && empaqueRows[0].style.display !== 'none';
            this.innerHTML = isVisible ? `Ocultar empaques ▲` : `Ver ${empaqueRows.length} empaques ▼`;
        });
    });

    // Añadir event listeners para los botones de eliminar
    document.querySelectorAll('.btn-eliminar-empaque').forEach(button => {
        button.addEventListener('click', async function(event) {
            event.stopPropagation(); // Evitar que se dispare el toggle de la fila
            const empaqueId = this.getAttribute('data-empaque-id');
            const empaqueRow = this.closest('.empaque-row');
            const epc = empaqueRow.querySelector('td:nth-child(4)').textContent; // Obtener el EPC de la celda correspondiente
            
            // Obtener el ID de la estación del sessionStorage
            const estacionInfo = sessionStorage.getItem('vorak_estacion_info');
            if (!estacionInfo) {
                showMessage('No se encontró información de la estación', 'error');
                return;
            }
            
            const estacion = JSON.parse(estacionInfo);
            const estacionId = estacion.id_estacion;
            
            // Llamar a la nueva API para eliminar el empaque por EPC (same-origin vía /api)
            const confirmacion = confirm(`¿Estás seguro de que quieres eliminar el empaque con EPC ${epc}?`);

            if (confirmacion) {
                // Llamar a la nueva API para eliminar el empaque por EPC
                fetch(`/api/frigorifico/estacion/${estacionId}/empaque/${epc}`, {
                    method: 'DELETE',
                    credentials: 'include' // Importante: incluye las cookies
                })
                .then(response => {
                    if (response.status === 401) {
                        handleSessionExpired();
                        return Promise.reject(new Error('Sesión expirada. Reautenticando...'));
                    }
                    // Verificar si la respuesta es exitosa antes de intentar parsear JSON
                    if (!response.ok) {
                        // Si no es exitosa, crear un objeto de error con el status
                        return response.json().then(errorData => {
                            throw new Error(errorData.message || `Error ${response.status}: ${response.statusText}`);
                        });
                    }
                    return response.json();
                })
                .then(data => {
                    if (data.deleted) {
                        // Eliminar la fila del empaque de la tabla
                        empaqueRow.remove();
                        showMessage(`Empaque ${data.epc} eliminado correctamente`, 'success');
                        
                        // Actualizar los totales
                        updateDashboardStats();
                    } else {
                        // Mostrar mensaje de error si no se eliminó
                        showMessage(data.message || `Error al eliminar el empaque con EPC: ${epc}`, 'error');
                    }
                })
                .catch(error => {
                    console.error('Error al eliminar el empaque:', error);
                    showMessage(error.message || 'Error al eliminar el empaque. Inténtalo de nuevo.', 'error');
                });
            }
        });
    });
}

// Mostrar mensajes
function showMessage(message, type = 'info', duration = 5000) {
    let messageElement;

    if (appState.currentPage === 'login') {
        messageElement = document.getElementById('login-message');
        if (messageElement) {
            messageElement.textContent = message;
            messageElement.className = `message message-${type}`;
        }
    } else {
        // Para otras páginas, crear un mensaje temporal
        messageElement = document.createElement('div');
        messageElement.className = `message message-${type}`;
        messageElement.textContent = message;
        document.body.appendChild(messageElement);

        // Remover después del tiempo especificado (por defecto 5 segundos)
        setTimeout(() => {
            if (messageElement.parentNode) {
                messageElement.parentNode.removeChild(messageElement);
            }
        }, duration);
    }
}

// Sesión expirada (401 en REST o desconexión WS por auth): el token HttpOnly
// caducó (24h, sin refresh). Se limpia la sesión SIN marcar logout explícito
// para que la página de login repita el login con la clave de vinculación guardada.
let reautenticacionEnCurso = false;
async function handleSessionExpired() {
    if (reautenticacionEnCurso) return;
    reautenticacionEnCurso = true;

    showMessage('Sesión expirada. Reautenticando...', 'error');
    appState.estacionInfo = null;
    sessionStorage.removeItem('vorak_estacion_info');
    sessionStorage.removeItem('vorak_logout');

    try {
        await disconnectWebSockets();
    } catch (e) {
        console.warn('Error desconectando sockets al expirar sesión:', e);
    }

    // SPA: volver al login sin recargar (la cookie HttpOnly caducó y se limpia
    // al reautenticar). Reseteamos el flag para permitir futuras reautenticaciones.
    await navigateToPage('login');
    reautenticacionEnCurso = false;
}

// Logout
async function logout() {
    appState.estacionInfo = null;
    sessionStorage.removeItem('vorak_estacion_info'); // Limpiar también la info de la estación
    // Marcar logout explícito: la clave queda guardada (prellenada) pero no se auto-inicia sesión
    sessionStorage.setItem('vorak_logout', '1');

    try {
        // Esperar a que los WebSockets se desconecten de forma limpia
        await disconnectWebSockets();
        console.log("Sockets desconectados. Volviendo a login.");
    } catch (error) {
        console.warn("Error durante la desconexión de sockets en logout:", error);
    }

    // SPA: volver al login sin recargar.
    await navigateToPage('login');
}

/**
 * Desconecta los WebSockets de forma limpia y devuelve una Promise
 * que se resuelve cuando ambos se han desconectado.
 */
function disconnectWebSockets() {
    return new Promise((resolve) => {
        for (const unlisten of unlistenHandlers) {
            try { unlisten(); } catch (e) {}
        }
        unlistenHandlers = [];

        const socket = appState.socket;
        if (!socket) {
            resolve();
            return;
        }

        const timeout = setTimeout(() => {
            console.log("Timeout de desconexión WS, limpiando referencia.");
            appState.socket = null;
            resolve();
        }, 3000);

        socket.once('disconnect', () => {
            clearTimeout(timeout);
            appState.socket = null;
            console.log("Socket desconectado limpiamente del backend.");
            resolve();
        });

        socket.disconnect();
    });
}

// Hacer logout disponible globalmente
window.logout = logout;

// Función para buscar un empaque específico por EPC
async function buscarEmpaquePorEpc() {
    const epcInput = document.getElementById('epc-input');
    const epc = epcInput.value.trim();

    if (!epc) {
        showMessage('Por favor ingrese un EPC para buscar', 'error');
        return;
    }

    if (epc.length < 10) {
        showMessage('El EPC debe tener al menos 10 caracteres', 'error');
        return;
    }

    try {
        // Mostrar mensaje de carga
        const busquedaTable = document.getElementById('busqueda-empaque-list');
        busquedaTable.innerHTML = '<tr><td colspan="6">Buscando empaque...</td></tr>';

        // Buscar en los datos locales de productos de la estación
        let empaqueEncontrado = null;
        let productoPadre = null;

        if (appState.productosEstacion && Array.isArray(appState.productosEstacion)) {
            for (const producto of appState.productosEstacion) {
                const empaque = producto.empaques.find(e => e.epc === epc);
                if (empaque) {
                    empaqueEncontrado = empaque;
                    productoPadre = producto;
                    break;
                }
            }
        }

        if (empaqueEncontrado && productoPadre) {
            // Mostrar el producto con solo el empaque encontrado (igual que la tabla principal pero con un solo empaque)
            renderProductoConEmpaqueEspecifico(productoPadre, empaqueEncontrado);
        } else {
            // Si no se encuentra el empaque
            busquedaTable.innerHTML = '<tr><td colspan="6">No se encontró ningún empaque con este EPC</td></tr>';
            showMessage('No se encontró ningún empaque con este EPC', 'error');
            // Limpiar el input cuando no se encuentra el EPC
            epcInput.value = '';
            return;
        }

    } catch (error) {
        console.error('Error buscando empaque por EPC:', error);
        const busquedaTable = document.getElementById('busqueda-empaque-list');
        busquedaTable.innerHTML = '<tr><td colspan="6">Error buscando empaque. Inténtelo de nuevo.</td></tr>';
        showMessage('Error buscando empaque. Inténtelo de nuevo.', 'error');
    }
}

// Función para renderizar el producto con solo el empaque específico encontrado
function renderProductoConEmpaqueEspecifico(producto, empaqueEspecifico) {
    const busquedaTable = document.getElementById('busqueda-empaque-list');

    if (!producto || !empaqueEspecifico) {
        busquedaTable.innerHTML = '<tr><td colspan="6">No se encontró información del empaque</td></tr>';
        return;
    }

    let tableHTML = '';

    // Fila principal del producto que actúa como título (igual que en la tabla principal)
    tableHTML += `
        <tr class="producto-row" data-producto-id="${producto.id_producto}">
            <td colspan="6">
                <div class="producto-header">
                    <h3>${producto.id_producto} - ${producto.nombre_producto} - ${producto.peso_nominal_g || 'N/A'}g</h3>
                    <button class="toggle-empaques-btn" data-producto-id="${producto.id_producto}">
                        Ver empaque encontrado ▼
                    </button>
                </div>
            </td>
        </tr>
        <tr class="product-header-row" style="display: none;" data-producto-id="${producto.id_producto}">
            <th>ID</th>
            <th>Producto</th>
            <th>Peso</th>
            <th>EPC</th>
            <th>Fecha</th>
            <th>Acciones</th>
        </tr>
    `;

    // Solo mostrar el empaque específico encontrado
    tableHTML += `
        <tr class="empaque-row destacado" data-empaque-id="${empaqueEspecifico.id}" style="display: none;" data-producto-id="${producto.id_producto}">
            <td>${producto.id_producto}</td>
            <td>${producto.nombre_producto}</td>
            <td>${empaqueEspecifico.peso_g}g</td>
            <td>${empaqueEspecifico.epc} ⭐</td>
            <td>${new Date(empaqueEspecifico.fecha_empaque).toLocaleString()}</td>
            <td>
                <button class="btn btn-danger btn-small btn-eliminar-empaque" data-empaque-id="${empaqueEspecifico.id}">Eliminar</button>
            </td>
        </tr>
    `;

    busquedaTable.innerHTML = tableHTML;

    // Añadir event listeners para los botones de toggle
    const toggleButton = document.querySelector(`.toggle-empaques-btn[data-producto-id="${producto.id_producto}"]`);
    if (toggleButton) {
        toggleButton.addEventListener('click', function() {
            const productoId = this.getAttribute('data-producto-id');
            const empaqueRows = document.querySelectorAll(`.empaque-row[data-producto-id="${productoId}"]`);
            const headerRow = document.querySelector(`.product-header-row[data-producto-id="${productoId}"]`);

            // Alternar visibilidad de las filas de empaques
            empaqueRows.forEach(row => {
                if (row.style.display === 'none') {
                    row.style.display = '';
                } else {
                    row.style.display = 'none';
                }
            });

            // Alternar visibilidad del encabezado
            if (headerRow) {
                if (headerRow.style.display === 'none') {
                    headerRow.style.display = '';
                } else {
                    headerRow.style.display = 'none';
                }
            }

            // Cambiar el texto del botón según el estado
            const isVisible = empaqueRows[0] && empaqueRows[0].style.display !== 'none';
            this.innerHTML = isVisible ? `Ocultar empaque ▲` : `Ver empaque encontrado ▼`;
        });
    }

    // Añadir event listeners para los botones de eliminar
    const eliminarButton = document.querySelector('.btn-eliminar-empaque');
    if (eliminarButton) {
        eliminarButton.addEventListener('click', async function(event) {
            event.stopPropagation(); // Evitar que se dispare el toggle de la fila
            const empaqueId = this.getAttribute('data-empaque-id');
            const empaqueRow = this.closest('.empaque-row');
            const epc = empaqueRow.querySelector('td:nth-child(4)').textContent.replace(' ⭐', ''); // Obtener el EPC de la celda correspondiente, removiendo el marcador

            // Obtener el ID de la estación del sessionStorage
            const estacionInfo = sessionStorage.getItem('vorak_estacion_info');
            if (!estacionInfo) {
                showMessage('No se encontró información de la estación', 'error');
                return;
            }

            const estacion = JSON.parse(estacionInfo);
            const estacionId = estacion.id_estacion;

            const confirmacion = confirm(`¿Estás seguro de que quieres eliminar el empaque con EPC ${epc}?`);

            if (confirmacion) {
                // Llamar a la nueva API para eliminar el empaque por EPC (same-origin vía /api)
                fetch(`/api/frigorifico/estacion/${estacionId}/empaque/${epc}`, {
                    method: 'DELETE',
                    credentials: 'include' // Importante: incluye las cookies
                })
                .then(response => {
                    if (response.status === 401) {
                        handleSessionExpired();
                        return Promise.reject(new Error('Sesión expirada. Reautenticando...'));
                    }
                    // Verificar si la respuesta es exitosa antes de intentar parsear JSON
                    if (!response.ok) {
                        // Si no es exitosa, crear un objeto de error con el status
                        return response.json().then(errorData => {
                            throw new Error(errorData.message || `Error ${response.status}: ${response.statusText}`);
                        });
                    }
                    return response.json();
                })
                .then(data => {
                    if (data.deleted) {
                        // Eliminar la fila del empaque de la tabla
                        empaqueRow.remove();
                        showMessage(`Empaque ${data.epc} eliminado correctamente`, 'success');

                        // Actualizar los totales
                        updateDashboardStats();
                    } else {
                        // Mostrar mensaje de error si no se eliminó
                        showMessage(data.message || `Error al eliminar el empaque con EPC: ${epc}`, 'error');
                    }
                })
                .catch(error => {
                    console.error('Error al eliminar el empaque:', error);
                    showMessage(error.message || 'Error al eliminar el empaque. Intentalo de nuevo.', 'error');
                });
            }
        });
    }
}

// ===================== MODAL CONFIGURACION IMPRESORA =====================

const PX_PER_MM_DISPLAY = 5;

let printerSettings = {
    label_width_mm: 40,
    label_height_mm: 30,
    density: 15,
    speed: 4,
    top_margin: 15,
    left_margin: 5,
    x_offset: -30,
    font_size_row_1: 20,
    font_size_row_2: 25,
    font_size_row_3: 20,
    font_size_row_4: 25,
    font_size_row_5: 36,
    font_size_row_6: 54
};

function settingsToForm(s) {
    document.getElementById('modal-ctrl-width').value = s.label_width_mm;
    document.getElementById('modal-ctrl-height').value = s.label_height_mm;
    document.getElementById('modal-density').value = s.density;
    document.getElementById('modal-speed').value = s.speed;
    document.getElementById('modal-top-margin').value = s.top_margin;
    document.getElementById('modal-left-margin').value = s.left_margin;
    document.getElementById('modal-font-1').value = s.font_size_row_1;
    document.getElementById('modal-font-2').value = s.font_size_row_2;
    document.getElementById('modal-font-3').value = s.font_size_row_3;
    document.getElementById('modal-font-4').value = s.font_size_row_4;
    document.getElementById('modal-font-5').value = s.font_size_row_5;
    document.getElementById('modal-font-6').value = s.font_size_row_6;
}

function formToSettings() {
    return {
        label_width_mm: parseInt(document.getElementById('modal-ctrl-width').value) || 40,
        label_height_mm: parseInt(document.getElementById('modal-ctrl-height').value) || 30,
        density: parseInt(document.getElementById('modal-density').value) || 15,
        speed: parseInt(document.getElementById('modal-speed').value) || 4,
        top_margin: parseInt(document.getElementById('modal-top-margin').value) || 15,
        left_margin: parseInt(document.getElementById('modal-left-margin').value) || 5,
        x_offset: printerSettings.x_offset,
        font_size_row_1: parseInt(document.getElementById('modal-font-1').value) || 20,
        font_size_row_2: parseInt(document.getElementById('modal-font-2').value) || 25,
        font_size_row_3: parseInt(document.getElementById('modal-font-3').value) || 20,
        font_size_row_4: parseInt(document.getElementById('modal-font-4').value) || 25,
        font_size_row_5: parseInt(document.getElementById('modal-font-5').value) || 36,
        font_size_row_6: parseInt(document.getElementById('modal-font-6').value) || 54
    };
}

function updateCanvasSize() {
    var wPx = printerSettings.label_width_mm * 8;
    var hPx = printerSettings.label_height_mm * 8;
    var canvas = document.getElementById('modal-canvas');
    canvas.width = wPx;
    canvas.height = hPx;
    canvas.style.width = (printerSettings.label_width_mm * PX_PER_MM_DISPLAY) + 'px';
    canvas.style.height = (printerSettings.label_height_mm * PX_PER_MM_DISPLAY) + 'px';

    document.getElementById('modal-px-width').textContent = wPx;
    document.getElementById('modal-px-height').textContent = hPx;
}

function mesAbreviado(m) {
    var meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
    return meses[m] || '???';
}

function formatFechaEs(d) {
    return d.getDate() + '/' + mesAbreviado(d.getMonth()) + '/' + d.getFullYear();
}

function formatDatetimeEs(d) {
    return d.getDate() + '/' + mesAbreviado(d.getMonth()) + '/' + d.getFullYear() +
           ', ' + d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
}

function drawPreview() {
    var canvas = document.getElementById('modal-canvas');
    var ctx = canvas.getContext('2d');
    var w = canvas.width;
    var h = canvas.height;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);

    var s = printerSettings;
    var xPos = s.left_margin;
    var yPos = s.top_margin;
    var lineH;

    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'top';

    var now = new Date();
    var fechaHora = formatDatetimeEs(now);
    var fechaVen = new Date(now.getTime() + 7*24*60*60*1000);
    var fechaVenStr = formatFechaEs(fechaVen);

    // Row 1: "Fecha de empaque:"
    ctx.font = 'bold ' + s.font_size_row_1 + 'px "DejaVu Sans", "Segoe UI", sans-serif';
    ctx.fillText('Fecha de empaque:', xPos, yPos);
    lineH = s.font_size_row_1 + 6;
    yPos += lineH;

    // Row 2: fecha_hora
    ctx.font = 'bold ' + s.font_size_row_2 + 'px "DejaVu Sans", "Segoe UI", sans-serif';
    ctx.fillText(fechaHora, xPos, yPos);
    lineH = s.font_size_row_2 + 6;
    yPos += lineH;

    // Row 3: "Vence:"
    ctx.font = 'bold ' + s.font_size_row_3 + 'px "DejaVu Sans", "Segoe UI", sans-serif';
    ctx.fillText('Vence:', xPos, yPos);
    lineH = s.font_size_row_3 + 6;
    yPos += lineH;

    // Row 4: fecha_vencimiento
    ctx.font = 'bold ' + s.font_size_row_4 + 'px "DejaVu Sans", "Segoe UI", sans-serif';
    ctx.fillText(fechaVenStr, xPos, yPos);
    lineH = s.font_size_row_4 + 6;
    yPos += lineH;

    // Row 5: "Peso: XXXg"
    ctx.font = 'bold ' + s.font_size_row_5 + 'px "DejaVu Sans", "Segoe UI", sans-serif';
    ctx.fillText('Peso: 500g', xPos, yPos);
    lineH = s.font_size_row_5 + 8;
    yPos += lineH;

    // Row 6: "$XXX"
    ctx.font = 'bold ' + s.font_size_row_6 + 'px "DejaVu Sans", "Segoe UI", sans-serif';
    ctx.fillText('$99', xPos, yPos);
}

function refreshPreview() {
    printerSettings = formToSettings();
    updateCanvasSize();
    drawPreview();
}

function updateModalConnStatus() {
    var el = document.getElementById('modal-conn-status');
    if (appState.impresoraConectada) {
        el.textContent = 'Conectada';
        el.className = 'modal-conn-status status-on';
    } else {
        el.textContent = 'Desconectada';
        el.className = 'modal-conn-status status-off';
    }
}

async function openPrinterModal() {
    try {
        if (window.__TAURI__) {
            var settings = await window.__TAURI__.invoke('get_printer_settings');
            printerSettings = settings;
        }
    } catch (e) {
        console.error('Error loading printer settings:', e);
    }

    settingsToForm(printerSettings);
    updateModalConnStatus();
    updateCanvasSize();
    drawPreview();
    document.getElementById('printer-modal').style.display = 'flex';
}

function closePrinterModal() {
    document.getElementById('printer-modal').style.display = 'none';
}

async function savePrinterSettings() {
    var s = formToSettings();
    try {
        if (window.__TAURI__) {
            await window.__TAURI__.invoke('save_printer_settings', { settings: s });
            printerSettings = s;
            showMessage('Configuracion de impresora guardada', 'success');
        }
    } catch (e) {
        console.error('Error saving printer settings:', e);
        showMessage('Error al guardar configuracion: ' + e, 'error');
    }
}

async function testPrint() {
    if (!appState.impresoraConectada) {
        showMessage('Impresora no conectada. No se puede imprimir prueba.', 'error');
        return;
    }

    try {
        if (window.__TAURI__) {
            showMessage('Enviando impresion de prueba...', 'info');
            await window.__TAURI__.invoke('print_test_label');
        }
    } catch (e) {
        console.error('Error test print:', e);
        showMessage('Error en impresion de prueba: ' + e, 'error');
    }
}

function setupStepperButtons() {
    document.querySelectorAll('.stepper-btn').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();

            var inputId = this.dataset.target;
            var input = document.getElementById(inputId);
            if (!input) return;

            var step = parseInt(this.dataset.step) || 0;
            var min = parseInt(input.min) || 0;
            var max = parseInt(input.max) || 100;
            var val = parseInt(input.value);
            if (isNaN(val)) val = min;
            var newVal = Math.max(min, Math.min(max, val + step));
            if (newVal !== val) {
                input.value = newVal;
                if (inputId.startsWith('modal-')) {
                    refreshPreview();
                }
            }
        });
    });
}

// Modal event listeners - called when modal opens
document.getElementById('impresora-status').addEventListener('click', function() {
    openPrinterModal();
    setTimeout(setupStepperButtons, 100);
});

document.getElementById('modal-close-btn').addEventListener('click', closePrinterModal);
document.getElementById('modal-cancel-btn').addEventListener('click', closePrinterModal);

document.getElementById('modal-save-btn').addEventListener('click', async function() {
    await savePrinterSettings();
    closePrinterModal();
});

document.getElementById('modal-test-print-btn').addEventListener('click', async function() {
    var s = formToSettings();
    try {
        if (window.__TAURI__) {
            await window.__TAURI__.invoke('save_printer_settings', { settings: s });
            printerSettings = s;
        }
    } catch (e) {
        console.error('Error saving before test print:', e);
    }
    await testPrint();
});

// Prevent modal close when clicking inside card
document.querySelector('.modal-card').addEventListener('click', function(e) {
    e.stopPropagation();
});

// Close modal when clicking overlay background
document.getElementById('printer-modal').addEventListener('click', function(e) {
    if (e.target === this) {
        closePrinterModal();
    }
});