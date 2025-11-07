set -e 

if [ -z "${IMAGE_TAG}" ]; then
  echo "Error: La variable de entorno IMAGE_TAG no está definida."
  echo "Este script debe ser ejecutado por el workflow de GitHub Actions."
  exit 1
fi

echo "Verificando la existencia del archivo .env..."
if [ ! -f ".env" ]; then
    echo "Error: No se encontró el archivo .env. Asegúrate de que exista en el dispositivo."
    exit 1
fi

# Cargar variables de entorno desde el archivo .env para usarlas en este script
set -o allexport
. ./.env
set +o allexport

echo "Iniciando sesión en GitHub Container Registry (ghcr.io)..."
if [ -z "$GHCR_USER" ] || [ -z "$GHCR_TOKEN" ]; then
    echo "Advertencia: GHCR_USER o GHCR_TOKEN no están definidos en .env. Se intentará descargar las imágenes sin autenticación."
else
    # Inicia sesión de forma no interactiva usando el token del archivo .env
    echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
fi

echo "Descargando las imágenes más recientes..."
docker compose -p estacion --env-file ./.env pull estacion

echo "Redesplegando la pila de servicios con la nueva versión..."
docker compose -p estacion --env-file ./.env up -d --remove-orphans --force-recreate

echo "Limpiando imágenes de Docker antiguas (dangling)..."
docker image prune -f

echo "✅ Proceso de despliegue finalizado."