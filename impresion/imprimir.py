import serial # type: ignore
import time
from PIL import Image, ImageDraw, ImageFont # type: ignore
from datetime import datetime

def verificar_estado_impresora(puerto_com="/dev/rfcomm0", baudrate=9600, timeout=2):
    try:
        # Verificar si el dispositivo existe primero
        import os
        if not os.path.exists(puerto_com):
            return False

        # Intentar abrir el puerto
        ser = serial.Serial(
            port=puerto_com,
            baudrate=baudrate,
            bytesize=8,
            parity='N',
            stopbits=1,
            timeout=timeout,
            dsrdtr=True
        )

        # Si llega aquí, el puerto se abrió correctamente
        ser.close()
        return True

    except serial.SerialException as e:
        return False
    except Exception as e:
        return False

# --- CONFIGURACIÓN PARA BLUETOOTH SERIAL ---
PUERTO_COM = "/dev/rfcomm0"  # Puerto RFCOMM para Bluetooth
VELOCIDAD_BAUD = 9600
# -------------------------------------

# --- PARÁMETROS DE LA ETIQUETA ---
ANCHO_DOTS = 320 # 40mm
ALTO_DOTS = 240  # 30mm
ANCHO_BYTES = ANCHO_DOTS // 8 # ¡Siempre 8!
# --------------------------------

def imprimir_etiqueta(fecha_hora, fecha_vencimiento, peso_g, precio_total):
    """
    Función para imprimir etiqueta con datos dinámicos.

    Args:
        fecha_hora (str): Fecha y hora actual
        fecha_vencimiento (str): Fecha de vencimiento
        peso_g (int): Peso en gramos
        precio_total (float): Precio total de venta
    """
    import logging
    logger = logging.getLogger(__name__)

    # Verificar estado de la impresora antes de proceder
    if not verificar_estado_impresora(PUERTO_COM, VELOCIDAD_BAUD):
        logger.error("Impresora no conectada o no disponible")
        return False

    img = Image.new('1', (ANCHO_DOTS, ALTO_DOTS), 255)
    d = ImageDraw.Draw(img)

    # Fuentes - PIL crea la imagen bitmap que la impresora interpreta como imagen
    TAMANO_NORMAL = 36
    TAMANO_GRANDE = 54

    # Intentar cargar fuentes del sistema
    try:
        # Buscar fuentes disponibles en el sistema
        import os
        font_paths = [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
            "/usr/share/fonts/truetype/ubuntu/Ubuntu-Bold.ttf"
        ]

        font_normal_path = None
        for path in font_paths:
            if os.path.exists(path):
                font_normal_path = path
                break

        if font_normal_path:
            font_normal = ImageFont.truetype(font_normal_path, TAMANO_NORMAL)
            font_grande = ImageFont.truetype(font_normal_path, TAMANO_GRANDE)
        else:
            font_normal = ImageFont.load_default()
            font_grande = ImageFont.load_default()

    except Exception as e:
        font_normal = ImageFont.load_default()
        font_grande = ImageFont.load_default()
   
    x_pos = 5  # Más cerca del borde izquierdo
    y_pos = 15  # Más margen superior para centrar mejor
    linea_alto_normal = TAMANO_NORMAL + 8  # Más espacio entre líneas

    # Fuentes adicionales para debugging
    TAMANO_PEQUENO = 20
    TAMANO_MEDIO = 25
    TAMANO_GRANDE_VENC = 25

    try:
        font_pequeno = ImageFont.truetype(font_normal_path, TAMANO_PEQUENO) if font_normal_path else ImageFont.load_default()
        font_medio = ImageFont.truetype(font_normal_path, TAMANO_MEDIO) if font_normal_path else ImageFont.load_default()
        font_grande_venc = ImageFont.truetype(font_normal_path, TAMANO_GRANDE_VENC) if font_normal_path else ImageFont.load_default()
    except:
        font_pequeno = ImageFont.load_default()
        font_medio = ImageFont.load_default()
        font_grande_venc = ImageFont.load_default()

    linea_alto_pequeno = TAMANO_PEQUENO + 6
    linea_alto_medio = TAMANO_MEDIO + 6
    linea_alto_grande_venc = TAMANO_GRANDE_VENC + 6

    # Línea 1: "Fecha:" (pequeño 20pt)
    d.text((x_pos, y_pos), "Fecha de empaque:", font=font_pequeno, fill=0)
    y_pos += linea_alto_pequeno

    # Línea 2: Fecha de hoy (tamaño 25pt)
    d.text((x_pos, y_pos), fecha_hora, font=font_medio, fill=0)
    y_pos += linea_alto_medio

    # Línea 3: "Vence:" (tamaño 20pt)
    d.text((x_pos, y_pos), "Vence:", font=font_pequeno, fill=0)
    y_pos += linea_alto_pequeno

    # Línea 4: Fecha de vencimiento (tamaño 35pt)
    d.text((x_pos, y_pos), fecha_vencimiento, font=font_grande_venc, fill=0)
    y_pos += linea_alto_grande_venc

    # Línea 5: Peso (tamaño normal 36pt)
    d.text((x_pos, y_pos), f"Peso: {peso_g}g", font=font_normal, fill=0)
    y_pos += linea_alto_normal

    # Línea 6: Precio (muy grande 48pt)
    d.text((x_pos, y_pos), f"${precio_total:,.0f}", font=font_grande, fill=0)

    datos_bitmap = img.tobytes()

    # --- 2. Enviar los comandos a la impresora ---
    try:
        ser = serial.Serial(
            port=PUERTO_COM,
            baudrate=VELOCIDAD_BAUD,
            bytesize=8,
            parity='N',
            stopbits=1,
            timeout=2,
            dsrdtr=False,
            rtscts=False,
            xonxoff=False
        )
        
        time.sleep(0.1)

        try:
            ser.write(b"CLS\n")
            ser.flush()
            time.sleep(0.05)
        except Exception as e:
            logger.error(f"Error enviando CLS: {e}")
            raise

        try:
            ser.write(b"SIZE 40 mm, 30 mm\n")
            ser.flush()
            time.sleep(0.05)
        except Exception as e:
            logger.error(f"Error enviando SIZE: {e}")
            raise

        try:
            ser.write(b"GAP 0, 0\n")
            ser.flush()
            time.sleep(0.05)
        except Exception as e:
            logger.error(f"Error enviando GAP: {e}")
            raise

        try:
            ser.write(b"DENSITY 15\n")
            ser.flush()
            time.sleep(0.05)
        except Exception as e:
            logger.error(f"Error enviando DENSITY: {e}")
            raise

        X_OFFSET = -30
        comando_header = f"BITMAP {X_OFFSET}, 0, {ANCHO_BYTES}, {ALTO_DOTS}, 0, ".encode('ascii')

        try:
            ser.write(comando_header)
            ser.flush()
            time.sleep(0.05)
        except Exception as e:
            logger.error(f"Error enviando header: {e}")
            raise

        try:
            ser.write(datos_bitmap)
            ser.flush()
            time.sleep(0.1)
        except Exception as e:
            logger.error(f"Error enviando datos bitmap: {e}")
            raise

        try:
            ser.write(b"\n")
            ser.flush()
            time.sleep(0.05)
        except Exception as e:
            logger.error(f"Error enviando fin de línea: {e}")
            raise

        try:
            ser.write(b"PRINT 1\n")
            ser.flush()
            time.sleep(0.05)
        except Exception as e:
            logger.error(f"Error enviando comando PRINT: {e}")
            raise

        time.sleep(1)
        ser.close()
        return True

    except serial.SerialException as e:
        logger.error(f"Error de conexión serial: {e}")
        return False
    except Exception as e:
        logger.error(f"Error durante la impresión: {e}")
        import traceback
        logger.error(f"Traceback completo: {traceback.format_exc()}")
        return False