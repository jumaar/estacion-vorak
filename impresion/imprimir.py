import serial # type: ignore
import time
from PIL import Image, ImageDraw, ImageFont # type: ignore
from datetime import datetime

def verificar_estado_impresora(puerto_impresora, baudrate=None, timeout=None):
    """
    Verifica si la impresora está conectada. Para impresoras USB (/dev/usb/lp*),
    la forma más fiable es simplemente comprobar si el archivo del dispositivo existe.
    """
    try:
        import os
        # Para dispositivos USB, la existencia del archivo es el indicador de conexión.
        return os.path.exists(puerto_impresora)
    except Exception as e:
        # En caso de cualquier otro error, asumir que no está conectada.
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

def imprimir_etiqueta(printer_file, fecha_hora, fecha_vencimiento, peso_g, precio_total):
    """
    Función para generar los comandos de impresión y enviarlos a un archivo de dispositivo abierto.

    Args:
        printer_file: Objeto de archivo abierto en modo binario para la impresora.
        fecha_hora (str): Fecha y hora actual
        fecha_vencimiento (str): Fecha de vencimiento
        peso_g (int): Peso en gramos
        precio_total (float): Precio total de venta
    """
    # --- CONSTANTES DE CALIBRACIÓN ---
    TAMANO_NORMAL = 36
    TAMANO_GRANDE = 54
    TAMANO_PEQUENO = 20
    TAMANO_MEDIO = 25
    TAMANO_GRANDE_VENC = 25

    x_pos = 5  # Más cerca del borde izquierdo
    y_pos = 15  # Más margen superior para centrar mejor
    linea_alto_normal = TAMANO_NORMAL + 8  # Más espacio entre líneas
    linea_alto_pequeno = TAMANO_PEQUENO + 6
    linea_alto_medio = TAMANO_MEDIO + 6
    linea_alto_grande_venc = TAMANO_GRANDE_VENC + 6
    # --- FIN CONSTANTES ---

    img = Image.new('1', (ANCHO_DOTS, ALTO_DOTS), 255)
    d = ImageDraw.Draw(img)

    # Fuentes - PIL crea la imagen bitmap que la impresora interpreta como imagen
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
            font_pequeno = ImageFont.truetype(font_normal_path, TAMANO_PEQUENO)
            font_medio = ImageFont.truetype(font_normal_path, TAMANO_MEDIO)
            font_grande_venc = ImageFont.truetype(font_normal_path, TAMANO_GRANDE_VENC)
        else:
            font_normal = ImageFont.load_default()
            font_grande = ImageFont.load_default()
            font_pequeno = ImageFont.load_default()
            font_medio = ImageFont.load_default()
            font_grande_venc = ImageFont.load_default()

    except Exception as e:
        font_normal = ImageFont.load_default()
        font_grande = ImageFont.load_default()
        font_pequeno = ImageFont.load_default()
        font_medio = ImageFont.load_default()
        font_grande_venc = ImageFont.load_default()

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

    # --- Enviar los comandos a la impresora a través de la conexión proporcionada ---
    printer_file.write(b"CLS\n")
    printer_file.write(b"SIZE 40 mm, 30 mm\n")
    printer_file.write(b"GAP 0, 0\n")
    printer_file.write(b"DENSITY 15\n")

    X_OFFSET = -30
    comando_header = f"BITMAP {X_OFFSET}, 0, {ANCHO_BYTES}, {ALTO_DOTS}, 0, ".encode('ascii')

    printer_file.write(comando_header)
    printer_file.write(datos_bitmap)
    printer_file.write(b"\n")
    printer_file.write(b"PRINT 1\n")