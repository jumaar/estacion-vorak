#!/bin/bash
set -euo pipefail

APP_NAME="vorak-estacion"
SERVICE="${APP_NAME}.service"

echo "=== Updating ${APP_NAME} ==="

if systemctl is-active --quiet "${SERVICE}"; then
    echo "Stopping ${SERVICE}..."
    systemctl stop "${SERVICE}"
fi

if [ -f /tmp/${APP_NAME}.deb ]; then
    dpkg -i /tmp/${APP_NAME}.deb
    rm -f /tmp/${APP_NAME}.deb
fi

echo "Starting ${SERVICE}..."
systemctl start "${SERVICE}"

echo "=== ${APP_NAME} update complete ==="
