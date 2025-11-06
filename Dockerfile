# Dockerfile para la aplicación de la Estación de Pesaje (Flask)

# --- Etapa 1: Build ---
# Usar una imagen base de Python slim para mantener el tamaño reducido.
FROM python:3.14-slim as builder

# Instalar dependencias del sistema operativo necesarias.
# - build-essential: para compilar algunas dependencias de Python si es necesario.
# - usbutils: para que el comando 'lsusb' esté disponible dentro del contenedor (usado para detectar el RFID).
# - ttf-dejavu: para proveer fuentes TrueType que la librería de impresión (PIL) puede usar.
RUN apt-get update && apt-get install -y \
    build-essential \
    usbutils \
    fonts-dejavu \
    libjpeg-dev \
    zlib1g-dev \
    libpng-dev \
    libfreetype6-dev \
    liblcms2-dev \
    libwebp-dev \
    libharfbuzz-dev \
    libfribidi-dev \
    libxcb1-dev \
    && rm -rf /var/lib/apt/lists/*

# Establecer el directorio de trabajo en la aplicación.
WORKDIR /app

# Copiar el archivo de requerimientos e instalar las dependencias de Python.
# Se hace en un paso separado para aprovechar el cache de Docker.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar el resto del código de la aplicación.
COPY . .
# Comando para ejecutar la aplicación cuando el contenedor inicie.
CMD ["python3", "estacion.py"]