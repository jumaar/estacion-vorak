/**
 * VORAK Estación de Pesaje - Frontend SPA
 * Aplicación JavaScript para la interfaz de usuario
 */

// Estado global de la aplicación
let appState = {
    socket: null, // Socket.IO instance para NestJS
    flaskSocket: null, // Socket.IO instance para Flask
    token: null,
    estacionInfo: null, // <-- Nueva propiedad para almacenar la información de la estación
    websocket: null,
    productos: [],
    historial: [],
    pesoActual: 0.0,
    basculaConectada: false,
    impresoraConectada: false, // Se mantiene para el estado local
    nestjsApiBaseUrl: null, // Nueva variable para la URL del backend NestJS
    rfidConectado: false
};

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

// Inicializar aplicación
function initializeApp() {
    setupEventListeners();
    checkExistingSession();
    displayStationInfo(); // Mostrar información de la estación si está disponible
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
        historialBtn.addEventListener('click', () => navigateToPage('historial'));
    }

    const volverDashboardBtn = document.getElementById('volver-dashboard-btn');
    if (volverDashboardBtn) {
        volverDashboardBtn.addEventListener('click', () => navigateToPage('dashboard'));
    }

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }
}

// Verificar sesión existente
function checkExistingSession() {
    const isProtectedPage = window.location.pathname === '/dashboard' || window.location.pathname === '/historial';
    const isLoginPage = window.location.pathname === '/' || window.location.pathname === '/login';
    // Con cookies HttpOnly, no podemos verificar directamente el token desde JS.
    // Verificamos si tenemos la información de la estación en sessionStorage.
    const estacionInfo = sessionStorage.getItem('vorak_estacion_info');

    if (estacionInfo) {
        appState.estacionInfo = JSON.parse(estacionInfo);
        if (isLoginPage) {
            navigateToPage('dashboard');
        } else if (isProtectedPage) {
            connectWebSocket();
            connectFlaskWebSocket(); // Conectar también a Flask para recibir datos de peso
        }
    } else {
        // Si NO hay sesión y estamos intentando acceder a una página protegida, redirigir a login
        if (isProtectedPage) {
            console.warn('No hay información de sesión. Redirigiendo a login.');
            navigateToPage('login');
        }
    }
}

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

// Navegación entre páginas
function navigateToPage(pageName) {
    if (window.location.pathname.includes(pageName)) {
        return;
    }

    if (pageName === 'dashboard') {
        window.location.href = '/dashboard';
    } else if (pageName === 'historial') {
        window.location.href = '/historial';
    } else if (pageName === 'login') {
        window.location.href = '/login';
    } else {
        console.error(`Página desconocida: ${pageName}`);
    }
}

// Variables para Turnstile
let turnstileToken = null;

// Función que se ejecuta cuando Turnstile está listo
window.onloadTurnstileCallback = async function() {
    
    let siteKey;
    let nestjsApiBaseUrl;

    // Obtener la URL base del backend NestJS
    try {
        const response = await fetch('/api/backend-config');
        if (!response.ok) throw new Error('Respuesta de red no fue ok al obtener config de backend.');
        const config = await response.json();
        nestjsApiBaseUrl = config.nestjs_api_base_url;
        appState.nestjsApiBaseUrl = nestjsApiBaseUrl;
    } catch (error) {
        console.error('Error obteniendo URL del backend NestJS, el login no funcionará:', error);
    }

    // Obtener la Site Key de Turnstile
    try {
        const response = await fetch('/api/config');
        if (!response.ok) throw new Error('Respuesta de red no fue ok.');
        const config = await response.json();
        siteKey = config.turnstile_site_key;
    } catch (error) {
        console.error('Error obteniendo Site Key del servidor, usando fallback:', error);
    }

    if (!siteKey) {
        console.error('No se pudo obtener la Site Key de Turnstile. El widget no se renderizará.');
        return;
    }

    turnstile.render('#turnstile-widget', {
        sitekey: siteKey,
        callback: function(token) {
            // Token recibido - habilitar el botón
            turnstileToken = token;
            const loginButton = document.getElementById('loginButton');
            if (loginButton) {
                loginButton.disabled = false;
                loginButton.textContent = 'Iniciar Sesión';
            }
        },
        'error-callback': function() {
            // Error en la verificación
            turnstileToken = null;
            const loginButton = document.getElementById('loginButton');
            if (loginButton) {
                loginButton.disabled = true;
            }
            showMessage('Error en la verificación de seguridad. Inténtalo de nuevo.', 'error');
            console.error('Error en Turnstile');
        },
        'expired-callback': function() {
            // Token expirado
            turnstileToken = null;
            const loginButton = document.getElementById('loginButton');
            if (loginButton) {
                loginButton.disabled = true;
            }
            showMessage('La verificación de seguridad ha expirado. Actualiza la página.', 'error');
            console.warn('Token de Turnstile expirado');
        }
    });
}

// Función para esperar que la sesión esté establecida
function waitForSessionEstablishment() {
    return new Promise((resolve) => {
        // Verificar inmediatamente si la sesión ya está disponible
        if (sessionStorage.getItem('vorak_estacion_info')) {
            resolve();
            return;
        }
        
        // Intentar verificar cada 50ms
        const checkInterval = setInterval(() => {
            if (sessionStorage.getItem('vorak_estacion_info')) {
                clearInterval(checkInterval);
                resolve();
            }
        }, 50);
        
        // Establecer un timeout máximo de 5 segundos para evitar bucles infinitos
        setTimeout(() => {
            clearInterval(checkInterval);
            console.warn('Timeout esperando establecimiento de sesión');
            resolve(); // Resolver de todas formas para continuar con la navegación
        }, 5000);
    });
}

// Manejar login
async function handleLogin(event) {
    if (event) event.preventDefault();

    if (!turnstileToken) {
        showMessage('Completa la verificación de seguridad primero.', 'error');
        return;
    }

    // Obtener la URL base del backend NestJS
    if (!appState.nestjsApiBaseUrl) {
        const configResponse = await fetch('/api/backend-config');
        if (!configResponse.ok) {
            showMessage('Error de configuración: No se pudo obtener la URL del backend', 'error');
            return;
        }
        const configData = await configResponse.json();
        appState.nestjsApiBaseUrl = configData.nestjs_api_base_url;
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
        // Enviar la petición de login directamente al backend NestJS
        const response = await fetch(`${appState.nestjsApiBaseUrl}/api/frigorifico/estacion/login/${encodeURIComponent(clave)}`, {
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

            // El token JWT se almacena automáticamente como HttpOnly cookie
            // No necesitamos extraerlo explícitamente ya que el navegador lo enviará automáticamente
            appState.estacionInfo = data.estacion; // <-- Almacenar la información de la estación
            sessionStorage.setItem('vorak_estacion_info', JSON.stringify(data.estacion)); // <-- Guardar en sessionStorage

            // Mostrar información de la estación
            displayStationInfo();

            // Esperar a que la sesión esté completamente establecida antes de redirigir
            await waitForSessionEstablishment();
            
            // Navegar al dashboard
            navigateToPage('dashboard');
            
            // Conectar WebSockets después de navegar
            connectWebSocket();
            connectFlaskWebSocket(); // Conectar también a Flask para recibir datos de peso
        } else {
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
        // Obtener la URL base del backend NestJS
        const configResponse = await fetch('/api/backend-config');
        if (!configResponse.ok) {
            showMessage('No se pudo obtener la configuración del servidor', 'error');
            return;
        }

        const configData = await configResponse.json();
        const nestjsApiBaseUrl = configData.nestjs_api_base_url;

        // Extraer el hostname y puerto de la URL base de NestJS
        const nestjsUrl = new URL(nestjsApiBaseUrl);
        const protocol = nestjsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${nestjsUrl.hostname}:${nestjsUrl.port || (nestjsUrl.protocol === 'https:' ? 443 : 80)}/api/frigorifico/estacion`;


        // Conectar directamente a NestJS con credenciales (HttpOnly cookie)
        appState.socket = io(wsUrl, {
            transports: ['websocket'],
            withCredentials: true  // Importante para enviar cookies HttpOnly
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

        appState.socket.on('disconnect', () => {
            logInteraction('Desconectado del servidor NestJS', 'error');
        });

    } catch (error) {
        console.error('Error conectando WebSocket directo a NestJS:', error);
        showMessage('Error al establecer conexión WebSocket: ' + error.message, 'error');
    }
}

// Conectar WebSocket a Flask para recibir datos de peso
function connectFlaskWebSocket() {
    // Conectar al WebSocket de Flask en el mismo servidor
    appState.flaskSocket = io('/', {
        transports: ['websocket'],
        withCredentials: true
    });

    appState.flaskSocket.on('connect', () => {
        // Conexión WebSocket establecida con Flask
    });

    appState.flaskSocket.on('connect_error', (error) => {
        console.error('Error en la conexión WebSocket con Flask:', error);
    });

    appState.flaskSocket.on('peso_en_gramos', (data) => {
        // Actualizar solo el peso en el estado (mantener como valor crudo en gramos)
        appState.pesoActual = data.peso;
        updatePesoDisplayFromGrams(data.peso); // Actualizar display con el valor en gramos
    });
    
    // Escuchar el estado de los componentes
    appState.flaskSocket.on('component_status', (data) => {

        // Actualizar estado de los componentes
        const basculaChanged = appState.basculaConectada !== (data.bascula_conectada || false);
        const impresoraChanged = appState.impresoraConectada !== (data.impresora_conectada || false);
        const rfidChanged = appState.rfidConectado !== (data.rfid_conectado || false);

        appState.basculaConectada = data.bascula_conectada || false;
        appState.impresoraConectada = data.impresora_conectada || false;
        appState.rfidConectado = data.rfid_conectado || false;

        // Mostrar alertas rápidas para cambios de estado
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

        // Actualizar indicadores de estado
        updateStatusIndicators();
    });

    appState.flaskSocket.on('disconnect', () => {
        // Desconectado del servidor Flask
    });
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
    const productosHoy = document.getElementById('productos-hoy');
    const pesoTotal = document.getElementById('peso-total');
    const estadoSistema = document.getElementById('estado-sistema');

    if (productosHoy) {
        productosHoy.textContent = appState.historial.length;
    }

    if (pesoTotal) {
        const total = appState.historial.reduce((sum, item) => sum + item.peso_g, 0);
        pesoTotal.textContent = total.toFixed(1);
    }

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

    // Asegurarse de que el WebSocket esté conectado antes de enviar
    if (!appState.socket || !appState.socket.connected) {
        connectWebSocket();

        // Esperar un poco para que se conecte
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Obtener el EPC del input si está disponible
    const productoInput = document.getElementById('producto-input');
    const epcIngresado = productoInput ? productoInput.value.trim() : '';

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
    
                // Después de recibir la respuesta, enviar datos a Flask para impresión
                if (data.creados > 0 && data.empaques && data.empaques.length > 0) {
                    const empaque = data.empaques[0];
    
                    // Enviar datos del empaque a Flask vía WebSocket
                    if (appState.flaskSocket && appState.flaskSocket.connected) {
                        appState.flaskSocket.emit('imprimir_etiqueta', {
                            fecha_hora: new Date().toLocaleString(),
                            fecha_vencimiento: empaque.fecha_vencimiento,
                            precio_total: empaque.precio_venta_total,
                            epc: empaque.epc
                        });
                    }
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

                // Actualizar la UI con los datos del empaque creado
                updateUltimoEmpaque({
                    id: empaqueCreado.id || 'N/A',
                    producto: empaqueCreado.nombre || 'Producto',
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
                console.warn('Errores en la creación de empaques:', response.errores);
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
                            }, 100);
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

    container.innerHTML = `
        <div class="empaque-info">
            <p><strong>Producto:</strong> ${empaque.producto}</p>
            <p><strong>Peso:</strong> ${empaque.peso_g} kg</p>
            <p><strong>Precio:</strong> $${empaque.precio_total}</p>
            <p><strong>EPC:</strong> ${empaque.epc}</p>
            <p><strong>Fecha:</strong> ${new Date(empaque.fecha_creacion).toLocaleString()}</p>
        </div>
    `;
}

// Cargar historial
async function loadHistorial() {
    try {
        const response = await fetch('/api/frigorifico/historial', {
            headers: {
                // 'Authorization' ya no es necesario, la cookie se envía automáticamente.
            }
        });

        if (response.ok) {
            const data = await response.json();
            appState.historial = data.historial;
            renderHistorialTable();
        } else {
            throw new Error('Error cargando historial');
        }
    } catch (error) {
        console.error('Error cargando historial:', error);
        showMessage('Error cargando historial', 'error');
    }
}

// Renderizar tabla de historial
function renderHistorialTable() {
    const tbody = document.getElementById('historial-list');
    if (!tbody) return;

    if (appState.historial.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7">No hay empaques registrados</td></tr>';
        return;
    }

    tbody.innerHTML = appState.historial.map(empaque => `
        <tr>
            <td>${empaque.id}</td>
            <td>${empaque.producto}</td>
            <td>${empaque.peso_g} kg</td>
            <td>$${empaque.precio_total}</td>
            <td>${empaque.epc}</td>
            <td>${new Date(empaque.fecha_creacion).toLocaleDateString()}</td>
            <td><span class="status-chip status-active">${empaque.estado}</span></td>
        </tr>
    `).join('');
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

// Logout
function logout() {
    if (appState.socket) {
        appState.socket.disconnect();
        appState.socket = null;
    }
    if (appState.flaskSocket) {
        appState.flaskSocket.disconnect();
        appState.flaskSocket = null;
    }
    appState.estacionInfo = null;
    sessionStorage.removeItem('vorak_estacion_info'); // Limpiar también la info de la estación
    // Redirigir a la página de login
    window.location.href = '/login';
}

// Hacer logout disponible globalmente
window.logout = logout;