FROM python:3.14-slim as builder

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

WORKDIR /app

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /etc/ssl/private && \
    cp localhost.pem /etc/ssl/certs/localhost.pem && \
    cp localhost-key.pem /etc/ssl/private/localhost-key.pem

CMD ["python3.14", "estacion.py"]
