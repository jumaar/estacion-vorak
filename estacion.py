import os
import serial # pyright: ignore[reportMissingModuleSource]
from flask import Flask, jsonify, request, send_from_directory # pyright: ignore[reportMissingImports]
from flask_socketio import SocketIO, emit, disconnect # pyright: ignore[reportMissingModuleSource]
from datetime import datetime
from dotenv import load_dotenv # pyright: ignore[reportMissingImports]
import logging
import threading
import time
import sys
sys.path.append(os.path.join(os.path.dirname(__file__), 'impresion'))
from imprimir import imprimir_etiqueta, verificar_estado_impresora # type: ignore

# Cargar variables de entorno desde .env
load_dotenv()


# Configuración de Cloudflare Turnstile
TURNSTILE_SITE_KEY = os.getenv("TURNSTILE_SITE_KEY") # Solo la SITE_KEY es necesaria para el frontend
if not TURNSTILE_SITE_KEY:
    print("ADVERTENCIA: TURNSTILE_SITE_KEY no está configurada en .env. El widget de Turnstile no se renderizará.")

# --- Inicialización de Flask ---
static_path = os.path.join(os.path.dirname(__file__), "static")
app = Flask(__name__, static_folder=static_path, static_url_path='/')

# --- Inicialización de SocketIO ---
socketio = SocketIO(app, cors_allowed_origins="*")

# Configurar logging
logging.basicConfig(level=logging.INFO)

# --- Estado compartido para el hardware ---
hardware_state = {
    "peso": 0,
    "bascula_conectada": False,
    "impresora_conectada": False,
    "rfid_conectado": False,  # Nuevo estado para RFID/TAG
    "lock": threading.Lock() # Para acceso seguro entre hilos
}

# --- Configuración de dispositivos ---
IMPRESORA_PUERTO = "/dev/rfcomm0"
IMPRESORA_BAUDRATE = 9600

# Configuración RFID (placeholder - ajustar según hardware real)
RFID_PUERTO = "/dev/ttyUSB1"  # Puerto para RFID reader
RFID_BAUDRATE = 9600


def emit_component_status(socketio_instance, state, previous_status=None):
    """
    Emite el estado de los componentes solo si ha cambiado.
    """
    with state["lock"]:
        current_status = {
            'bascula_conectada': state["bascula_conectada"],
            'impresora_conectada': state["impresora_conectada"],
            'rfid_conectado': state["rfid_conectado"]
        }

    # Si no hay estado previo, emitir siempre
    if previous_status is None or current_status != previous_status:
        socketio_instance.emit('component_status', current_status, namespace='/')
        return current_status
    return previous_status


def manage_bascula_connection(state, socketio_instance):
    """
    Función que se ejecuta en un hilo. Mantiene el puerto serial abierto,
    lee continuamente y actualiza el estado compartido.
    """
    serial_port = os.getenv("SERIAL_PORT_BASCULA")
    serial_baudrate = int(os.getenv("SERIAL_BAUDRATE"))
    previous_status = None

    while True:
        try:
            # Parámetros comunes: 8 data bits, no parity, 1 stop bit (8N1)
            with serial.Serial(serial_port, serial_baudrate, timeout=1, bytesize=serial.EIGHTBITS, parity=serial.PARITY_NONE, stopbits=serial.STOPBITS_ONE) as ser:
                app.logger.info("Báscula conectada. Empezando a leer datos...")
                
                buffer = ""  # Buffer para acumular datos incompletos
                
                with state["lock"]:
                    state["bascula_conectada"] = True

                # Emitir estado al conectar
                previous_status = emit_component_status(socketio_instance, state, previous_status)

                while True:
                    try:
                        if ser.in_waiting > 0:
                            raw_data = ser.read(ser.in_waiting)
                            try:
                                decoded_data = raw_data.decode('utf-8')
                                buffer += decoded_data
                                lines = buffer.split('\n')
                                buffer = lines[-1]
                                
                                # Procesar todos los mensajes completos
                                for line in lines[:-1]:
                                    line = line.strip()
                                    if line:  # Si hay datos válidos
                                        
                                        # Intentar convertir la línea a un número entero
                                        try:
                                            peso_en_gramos = int(line)
                                            with state["lock"]:
                                                state["peso"] = peso_en_gramos
                                            
                                            # Emitir el peso a través de WebSocket
                                            socketio_instance.emit('peso_en_gramos', {'peso': peso_en_gramos}, namespace='/')
                                        except ValueError:
                                            # Si la línea no es un número válido, se ignora
                                            pass
                            except UnicodeDecodeError:
                                app.logger.warning("Error de decodificación de datos recibidos")
                                continue
                    except Exception as read_error:
                        if "device reports readiness to read but returned no data" in str(read_error):
                            # Este es un error común cuando no hay datos disponibles, no es un error real
                            continue  # Continuar intentando leer sin log
                        else:
                            app.logger.error(f"Error fatal durante la lectura: {read_error}. Cerrando conexión...")
                            break  # Salir del bucle interno para reconectar
        except serial.SerialException as e:
            app.logger.error(f"Error de puerto serial: {e}. Reintentando en 5 segundos...")
        except Exception as e:
            app.logger.error(f"Error general en el hilo de la báscula: {e}")

        # Si llegamos aquí, hubo un error. Marcar como desconectada y esperar antes de reintentar.
        with state["lock"]:
            state["bascula_conectada"] = False
            state["peso"] = 0

        # Emitir estado al desconectar
        previous_status = emit_component_status(socketio_instance, state, previous_status)

        time.sleep(5)  # Esperar 5 segundos antes de reintentar
        

def manage_impresora_connection(state, socketio_instance):
    """
    Función que se ejecuta en un hilo. Verifica periódicamente el estado
    de la impresora y actualiza el estado compartido.
    """
    previous_status = None

    while True:
        try:
            # Verificar estado de la impresora
            estado_actual = verificar_estado_impresora(IMPRESORA_PUERTO, IMPRESORA_BAUDRATE)

            with state["lock"]:
                state["impresora_conectada"] = estado_actual

            # Emitir estado si cambió
            current_status = {
                'bascula_conectada': state["bascula_conectada"],
                'impresora_conectada': estado_actual,
                'rfid_conectado': state["rfid_conectado"]
            }

            if previous_status != current_status:
                socketio_instance.emit('component_status', current_status, namespace='/')
                previous_status = current_status

                if estado_actual:
                    app.logger.info("Impresora conectada")
                else:
                    app.logger.warning("Impresora desconectada")

        except Exception as e:
            app.logger.error(f"Error verificando estado de impresora: {e}")
            with state["lock"]:
                state["impresora_conectada"] = False

        # Verificar cada 10 segundos
        time.sleep(10)


# Iniciar hilos de hardware
bascula_thread = threading.Thread(target=manage_bascula_connection, args=(hardware_state, socketio), daemon=True)
bascula_thread.start()

def manage_rfid_connection(state, socketio_instance):
    """
    Función que se ejecuta en un hilo. Verifica periódicamente el estado
    del lector RFID/TAG.
    """
    previous_status = None

    while True:
        try:
            # Verificar estado del RFID (placeholder - implementar según hardware)
            # Por ahora simulamos que está conectado
            estado_actual = True  # Cambiar por verificación real

            with state["lock"]:
                state["rfid_conectado"] = estado_actual

            # Emitir estado si cambió
            current_status = {
                'bascula_conectada': state["bascula_conectada"],
                'impresora_conectada': state["impresora_conectada"],
                'rfid_conectado': estado_actual
            }

            if previous_status != current_status:
                socketio_instance.emit('component_status', current_status, namespace='/')
                previous_status = current_status

                if estado_actual:
                    app.logger.info("RFID/TAG conectado")
                else:
                    app.logger.warning("RFID/TAG desconectado")

        except Exception as e:
            app.logger.error(f"Error verificando estado de RFID: {e}")
            with state["lock"]:
                state["rfid_conectado"] = False

        # Verificar cada 15 segundos (menos frecuente que impresora)
        time.sleep(15)


# Iniciar hilos de hardware
bascula_thread = threading.Thread(target=manage_bascula_connection, args=(hardware_state, socketio), daemon=True)
bascula_thread.start()

impresora_thread = threading.Thread(target=manage_impresora_connection, args=(hardware_state, socketio), daemon=True)
impresora_thread.start()

rfid_thread = threading.Thread(target=manage_rfid_connection, args=(hardware_state, socketio), daemon=True)
rfid_thread.start()
# Eventos de SocketIO para logs de conexión
@socketio.on('connect')
def handle_connect():
    # Emitir el estado actual de los componentes al nuevo cliente
    emit_component_status(socketio, hardware_state, None)  # Forzar emisión

@socketio.on('disconnect')
def handle_disconnect():
    app.logger.info(f"Cliente WebSocket desconectado: {request.sid}")

@socketio.on('peso_en_gramos')
def handle_peso_en_gramos(data):
    app.logger.info(f"Evento 'peso_en_gramos' recibido por el cliente: {data}")


# Iniciar hilos de hardware


# --- Rutas para servir la SPA (Single Page Application) ---

# --- Rutas Públicas ---
@app.route('/')
def route_root():
    """Sirve la página de login en la raíz (pública)."""
    return send_from_directory(app.static_folder, 'login.html')

@app.route('/login')
def route_login():
    """Sirve la página de login (pública)."""
    return send_from_directory(app.static_folder, 'login.html')

# --- Rutas Protegidas ---
@app.route('/dashboard')
def route_dashboard():
    """
    Sirve el archivo HTML del dashboard. La protección de esta página
    se maneja en el frontend (JavaScript) verificando el token en localStorage.
    """
    return send_from_directory(app.static_folder, 'dashboard.html')

@app.route('/historial')
def route_historial():
    """Sirve la página de historial (protegida)."""
    return send_from_directory(app.static_folder, 'historial.html')



@app.route("/api/config", methods=['GET'])
def obtener_configuracion():
    """Devuelve la configuración pública necesaria para el frontend."""
    if not TURNSTILE_SITE_KEY:
        app.logger.error("TURNSTILE_SITE_KEY no está configurada en el servidor.")
        return jsonify({"detail": "Error de configuración del servidor"}), 500

    return jsonify({
        "turnstile_site_key": TURNSTILE_SITE_KEY
    })


@app.route("/api/backend-config", methods=['GET'])
def obtener_backend_configuracion():
    """Devuelve la configuración del backend de NestJS necesaria para el frontend."""
    nestjs_api_base_url = os.getenv("NESTJS_API_BASE_URL")
    if not nestjs_api_base_url:
        app.logger.error("NESTJS_API_BASE_URL no está configurada en .env.")
        return jsonify({"detail": "Error de configuración del servidor"}), 500

    return jsonify({"nestjs_api_base_url": nestjs_api_base_url})


@app.route("/api/imprimir-etiqueta", methods=['POST'])
def imprimir_etiqueta_endpoint():
    """
    Endpoint para imprimir etiqueta con datos del empaque.
    Espera un JSON con los datos del empaque creado.
    """
    try:
        data = request.get_json()

        if not data or 'empaques' not in data or not data['empaques']:
            return jsonify({"error": "Datos de empaque no proporcionados"}), 400

        empaque = data['empaques'][0]  # Tomar el primer empaque

        # Obtener peso actual de la báscula
        with hardware_state["lock"]:
            peso_actual = hardware_state["peso"]

        if peso_actual <= 0:
            return jsonify({"error": "Peso no válido en la báscula"}), 400

        # Preparar datos para impresión
        fecha_hora = datetime.now().strftime("%d/%m/%Y %H:%M")
        fecha_vencimiento = empaque.get('fecha_vencimiento', 'N/A')
        precio_total = empaque.get('precio_venta_total', 0)

        # Imprimir etiqueta
        exito = imprimir_etiqueta(fecha_hora, fecha_vencimiento, peso_actual, precio_total)

        if exito:
            return jsonify({"mensaje": "Etiqueta impresa exitosamente"}), 200
        else:
            app.logger.error("Error al imprimir etiqueta")
            return jsonify({"error": "Error al imprimir etiqueta"}), 500

    except Exception as e:
        app.logger.error(f"Error en endpoint de impresión: {e}")
        return jsonify({"error": "Error interno del servidor"}), 500


@socketio.on('imprimir_etiqueta')
def handle_imprimir_etiqueta(data):
    """
    Manejador de Socket.IO para imprimir etiqueta.
    Recibe datos del frontend y ejecuta la impresión.
    """
    try:
        # Obtener peso actual de la báscula
        with hardware_state["lock"]:
            peso_actual = hardware_state["peso"]

        if peso_actual <= 0:
            app.logger.error("Peso no válido en la báscula")
            emit('impresion_error', {'error': 'Peso no válido en la báscula'})
            return

        # Preparar datos para impresión
        fecha_hora = data.get('fecha_hora', datetime.now().strftime("%d/%m/%Y %H:%M"))
        fecha_vencimiento = data.get('fecha_vencimiento', 'N/A')
        precio_total = data.get('precio_total', 0)

        # Imprimir etiqueta
        exito = imprimir_etiqueta(fecha_hora, fecha_vencimiento, peso_actual, precio_total)

        if exito:
            emit('impresion_completada', {'mensaje': 'Etiqueta impresa exitosamente'})
        else:
            app.logger.error("Error al imprimir etiqueta")
            emit('impresion_error', {'error': 'Error al imprimir etiqueta'})

    except Exception as e:
        app.logger.error(f"Error en impresión: {e}")
        emit('impresion_error', {'error': 'Error interno del servidor'})





# --- Punto de Entrada ---
if __name__ == "__main__":
    port = int(os.getenv("PORT"))
    host = os.getenv("HOST")  # Valor por defecto para host
    debug_mode = os.getenv("FLASK_DEBUG", "False").lower() == "true"
    # Usar el servidor de eventos de SocketIO en lugar del de Flask
    socketio.run(app, host=host, port=port, debug=debug_mode)
