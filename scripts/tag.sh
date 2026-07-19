#!/usr/bin/env bash
set -euo pipefail

CARGO_TOML="src-tauri/Cargo.toml"
TAURI_CONF="src-tauri/tauri.conf.json"
ROOT_PKG="package.json"
README="README.md"

CURRENT=$(grep '^version' "$CARGO_TOML" | head -1 | sed 's/.*"\(.*\)".*/\1/')

echo ""
echo "  Version actual: ${CURRENT}"
echo ""

read -r -p "  Nueva version (ej: 2.0.1): " NEW

if [[ -z "$NEW" ]]; then
  echo "  Version vacia — cancelado."
  exit 1
fi

if ! [[ "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "  Formato invalido. Usa X.Y.Z (semver)."
  exit 1
fi

echo ""
echo "  Actualizando archivos a v${NEW}..."

sed -i "s/^version = \"${CURRENT}\"/version = \"${NEW}\"/" "$CARGO_TOML"

jq ".version = \"${NEW}\"" "$TAURI_CONF" > /tmp/tauri_tmp.json && mv /tmp/tauri_tmp.json "$TAURI_CONF"

sed -i "s/VORAK v[0-9]\+\.[0-9]\+\.[0-9]\+/VORAK v${NEW}/g" "$README"

npm version "$NEW" --no-git-tag-version --allow-same-version 2>/dev/null

git add "$CARGO_TOML" src-tauri/Cargo.lock "$TAURI_CONF" "$ROOT_PKG" "$README"

git commit -m "v${NEW}" --no-verify

git tag "v${NEW}"

echo ""
echo "  v${NEW} creado. Subiendo a origin..."
echo ""

git push origin rust --tags

echo ""
echo "  Listo. El pipeline release.yml se disparara con el tag v${NEW}."
echo ""
