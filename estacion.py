import os
import logging
import threading
import time
import subprocess
import queue
import sys
import ssl
import serial # pyright: ignore[reportMissingModuleSource]
from datetime import datetime
from flask import Flask, jsonify, request, send_from_directory # pyright: ignore[reportMissingImports] 
from flask_socketio import SocketIO, emit # pyright: ignore[reportMissingModuleSource]
from dotenv import load_dotenv # pyright: ignore[reportMissingImports] 

sys.path.append(os.path.join(os.path.dirname(__file__), 'impresion'))
from imprimir import imprimir_etiqueta # type: ignore

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
# Usar threading para manejar concurrencia (más simple y compatible)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading', logger=False, engineio_logger=False)

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
print_queue = queue.Queue() # Cola para los trabajos de impresión

# --- Configuración de dispositivos ---
IMPRESORA_PUERTO = "/dev/usb/lp1" 

RFID_PUERTO = "/dev/ttyUSB1"  

SERIAL_PORT_BASCULA = "/dev/ttyUSB0" 
SERIAL_BAUDRATE = 9600

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
    # Obtener configuración con valores por defecto para evitar errores si no están en .env
    serial_port = SERIAL_PORT_BASCULA
    serial_baudrate_str = SERIAL_BAUDRATE
    serial_baudrate = int(serial_baudrate_str)

    if not serial_port:
        app.logger.error("La variable de entorno SERIAL_PORT_BASCULA no está definida. El hilo de la báscula no puede iniciar.")
        return

    previous_status = None

    while True:
        try:
            # Parámetros comunes: 8 data bits, no parity, 1 stop bit (8N1)
            with serial.Serial(serial_port, serial_baudrate, timeout=1, bytesize=serial.EIGHTBITS, parity=serial.PARITY_NONE, stopbits=serial.STOPBITS_ONE) as ser:
                app.logger.info(f"Báscula conectada en {serial_port}. Esperando datos...")

                with state["lock"]:
                    state["bascula_conectada"] = True

                # Emitir estado al conectar
                previous_status = emit_component_status(socketio_instance, state, previous_status)

                # Bucle de lectura optimizado con readline()
                while True:
                    try:
                        # readline() es una llamada bloqueante que espera hasta recibir un '\n' o hasta que se cumpla el timeout
                        linea_bytes = ser.readline()
                        if not linea_bytes:
                            # Si readline() devuelve una cadena vacía, significa que el timeout (1s) se cumplió sin recibir datos.
                            # Esto es normal si la báscula no envía datos constantemente. Continuamos esperando.
                            continue

                        linea_str = linea_bytes.decode('utf-8').strip()

                        if linea_str:
                            peso_en_gramos = int(linea_str)
                            with state["lock"]:
                                state["peso"] = peso_en_gramos
                            socketio_instance.emit('peso_en_gramos', {'peso': peso_en_gramos}, namespace='/')

                    except (UnicodeDecodeError, ValueError) as data_error:
                        app.logger.warning(f"Dato inválido recibido de la báscula, se ignora: {data_error}")
                    except serial.SerialException as ser_err:
                        app.logger.error(f"Error de puerto serial durante la lectura: {ser_err}. Saliendo para reconectar...")
                        break
        except KeyboardInterrupt:
            # Manejar interrupción del teclado
            app.logger.info("Interrupción del teclado detectada, saliendo...")
            break
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

        time.sleep(5) # Esperar 5 segundos antes de reintentar


def verificar_estado_impresora(puerto_impresora):
    try:
        # Para dispositivos USB, la existencia del archivo es el indicador de conexión.
        return os.path.exists(puerto_impresora)
    except Exception:
        # En caso de cualquier otro error, asumir que no está conectada.
        return False
        

def manage_impresora_connection(state, socketio_instance):
    """
    Función que se ejecuta en un hilo. Verifica periódicamente el estado
    de la impresora y actualiza el estado compartido.
    """
    previous_status = None

    while True:
        try:
            # Verificar estado de la impresora
            estado_actual = verificar_estado_impresora(IMPRESORA_PUERTO)

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

                if not estado_actual:
                    app.logger.warning("Impresora desconectada")

        except KeyboardInterrupt:
            # Manejar interrupción del teclado
            app.logger.info("Interrupción del teclado detectada, saliendo...")
            break
        except Exception as e:
            app.logger.error(f"Error verificando estado de impresora: {e}")
            with state["lock"]:
                state["impresora_conectada"] = False

        # Verificar cada 10 segundos
        time.sleep(10)


def check_rfid_device_connected():
    """
    Verifica si el dispositivo RFID/TAG (que actúa como teclado USB) está conectado.
    Busca un dispositivo USB con el Vendor ID y Product ID específicos.
    """
    try:
        # ID de Vendedor (Vendor ID) y ID de Producto (Product ID) del lector RFID
        vendor_id = "1a86"
        product_id = "e010"
        
        # Ejecuta 'lsusb' y busca el dispositivo
        result = subprocess.run(['lsusb'], capture_output=True, text=True, check=True)
        return f"{vendor_id}:{product_id}" in result.stdout
    except (subprocess.CalledProcessError, FileNotFoundError):
        # Si 'lsusb' no existe o falla, asumimos que no está conectado
        app.logger.error("No se pudo ejecutar 'lsusb' para verificar el lector RFID.")
        return False

def manage_rfid_connection(state, socketio_instance):
    """
    Función que se ejecuta en un hilo. Verifica periódicamente el estado
    del lector RFID/TAG.
    """
    previous_status = None
    is_connected = False

    while True:
        try:
            # Verificar si el dispositivo RFID está conectado usando su ID de USB
            estado_actual = check_rfid_device_connected()

            # Solo actualizamos el estado y emitimos si ha habido un cambio
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
                is_connected = estado_actual

                if not estado_actual:
                    app.logger.warning("RFID/TAG desconectado")

        except KeyboardInterrupt:
            # Manejar interrupción del teclado
            app.logger.info("Interrupción del teclado detectada, saliendo...")
            break
        except Exception as e:
            app.logger.error(f"Error verificando estado de RFID: {e}")
            with state["lock"]:
                state["rfid_conectado"] = False

        # Sondeo adaptativo:
        # - Si está conectado, verificar con menos frecuencia (cada 15s).
        # - Si está desconectado, verificar más a menudo para una reconexión rápida (cada 2s).
        sleep_interval = 15 if is_connected else 2
        time.sleep(sleep_interval)


# Iniciar hilos de hardware
bascula_thread = threading.Thread(target=manage_bascula_connection, args=(hardware_state, socketio), daemon=True)
bascula_thread.start()

impresora_thread = threading.Thread(target=manage_impresora_connection, args=(hardware_state, socketio), daemon=True)
impresora_thread.start()

rfid_thread = threading.Thread(target=manage_rfid_connection, args=(hardware_state, socketio), daemon=True)
rfid_thread.start()
# Eventos de SocketIO para logs de conexión

def manage_print_queue(state, socketio_instance):
    """
    Función que se ejecuta en un hilo. Procesa la cola de impresión.
    Maneja la conexión con la impresora de forma centralizada.
    """
    while True:
        printer_file = None  # Usaremos un manejador de archivo
        print_job = print_queue.get() # Espera bloqueante hasta que haya un trabajo

        try:
            # Verificar si la impresora está conectada antes de intentar imprimir
            with state["lock"]:
                if not state["impresora_conectada"]:
                    app.logger.warning("Trabajo de impresión descartado: Impresora no conectada.")
                    socketio_instance.emit('impresion_error', {'error': 'Impresora no conectada'})
                    continue # Salta al finally y luego a la siguiente iteración


            printer_file = open(IMPRESORA_PUERTO, 'wb', buffering=0)


            imprimir_etiqueta(
                printer_file,
                print_job['fecha_hora'],
                print_job['fecha_vencimiento'],
                print_job['peso'],
                print_job['precio_total']
            )
            
            # Esperar a que todos los datos se envíen antes de continuar
            printer_file.flush()
            socketio_instance.emit('impresion_completada', {'mensaje': 'Etiqueta impresa exitosamente'})

        except FileNotFoundError:
            app.logger.error(f"Error de impresión: El dispositivo '{IMPRESORA_PUERTO}' no fue encontrado.")
            socketio_instance.emit('impresion_error', {'error': 'Dispositivo de impresión no encontrado.'})
        except Exception as e:
            app.logger.error(f"Error inesperado en el hilo de impresión: {e}")
            socketio_instance.emit('impresion_error', {'error': 'Error interno en el proceso de impresión'})
        finally:
            # Asegurarse de que el puerto se cierre siempre, incluso si falla
            if printer_file:
                
            # Marcar la tarea como completada en la cola
               print_queue.task_done()
            # Pausa de 500ms para darle un respiro al hardware de la impresora
            time.sleep(0.2) # Reducimos la pausa para USB, que es más rápido y estable


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
        now = datetime.now()
        fecha_hora = f"{now.day}/{now.month}/{now.year}, {now.hour:02d}:{now.minute:02d}"
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

        # Preparar datos para el trabajo de impresión
        now = datetime.now()
        print_job = {
            'fecha_hora': f"{now.day}/{now.month}/{now.year}, {now.hour:02d}:{now.minute:02d}",
            'fecha_vencimiento': data.get('fecha_vencimiento', 'N/A'),
            'precio_total': data.get('precio_total', 0),
            'peso': peso_actual
        }

        # Añadir el trabajo a la cola en lugar de imprimir directamente
        print_queue.put(print_job)

    except Exception as e:
        app.logger.error(f"Error en impresión: {e}")
        emit('impresion_error', {'error': 'Error interno del servidor'})


@socketio.on('reimprimir_etiqueta')
def handle_reimprimir_etiqueta(data):
    """
    Manejador de Socket.IO específico para REIMPRIMIR una etiqueta.
    Utiliza los datos guardados del último empaque, no el peso actual de la báscula.
    """
    app.logger.info(f"Solicitud de reimpresión recibida para el empaque: {data.get('epc')}")
    try:
        peso_guardado = data.get('peso_g')
        if not peso_guardado or peso_guardado <= 0:
            emit('impresion_error', {'error': 'Datos de peso inválidos para reimpresión.'})
            return

        # Crear el trabajo de impresión con los datos recibidos
        print_job = {
            'fecha_hora': datetime.fromisoformat(data['fecha_creacion']).strftime('%d/%m/%Y, %H:%M'),
            'fecha_vencimiento': data.get('fecha_vencimiento', 'N/A'),
            'precio_total': data.get('precio_total', 0),
            'peso': peso_guardado
        }
        print_queue.put(print_job)

    except Exception as e:
        app.logger.error(f"Error en reimpresión: {e}")
        emit('impresion_error', {'error': 'Error interno del servidor al reimprimir'})

# --- Punto de Entrada ---
if __name__ == "__main__":
    port = int(os.getenv("PORT"))
    host = os.getenv("HOST")  # Valor por defecto para host
    try:
        # Iniciar el hilo consumidor de la cola de impresión
        print_thread = threading.Thread(target=manage_print_queue, args=(hardware_state, socketio), daemon=True)
        print_thread.start()

        # Configurar SSL/TLS para HTTPS
        ssl_cert_path = os.path.join(os.path.dirname(__file__), 'localhost.pem')
        ssl_key_path = os.path.join(os.path.dirname(__file__), 'localhost-key.pem')
        
        # Crear contexto SSL
       
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(certfile=ssl_cert_path, keyfile=ssl_key_path)
        
        # Iniciar la aplicación Flask con Socket.IO y SSL
        socketio.run(app,
                     host=host,
                     port=port,
                     use_reloader=False,
                     ssl_context=context,
                     allow_unsafe_werkzeug=True)
    except KeyboardInterrupt:
        app.logger.info("Aplicación interrumpida por el usuario")
        # Detener los hilos de forma ordenada
        import sys
        sys.exit(0)
