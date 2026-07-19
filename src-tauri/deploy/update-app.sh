#!/bin/bash
set -euo pipefail

APP_NAME="vorak-estacion"
SERVICE="${APP_NAME}.service"

echo "=== Updating ${APP_NAME} ==="

if systemctl is-active --quiet "${SERVICE}"; then
    echo "Stopping ${SERVICE}..."
    systemctl stop "${SERVICE}"
fi

apt-get update
apt-get install --only-upgrade "${APP_NAME}" -y

echo "Starting ${SERVICE}..."
systemctl start "${SERVICE}"

echo "=== ${APP_NAME} update complete ==="
