#!/usr/bin/env bash
set -euo pipefail

CARGO_TOML="src-tauri/Cargo.toml"
TAURI_CONF="src-tauri/tauri.conf.json"
ROOT_PKG="package.json"
README="README.md"

TAURI_CURRENT=$(grep '"version"' "$TAURI_CONF" | head -1 | sed 's/.*: *"\(.*\)".*/\1/')

# ── Dependencias ──────────────────────────────────────────────────────────────
if ! command -v npm &>/dev/null; then
  echo "  ERROR: 'npm' no esta instalado."
  exit 1
fi

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

if git rev-parse -q --verify "refs/tags/v${NEW}" > /dev/null 2>&1; then
  echo "  El tag v${NEW} ya existe — cancelado."
  exit 1
fi

# ── Verificar que el remote este sincronizado ─────────────────────────────────
echo ""
echo "  Verificando conexion con origin..."
git fetch origin rust

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/rust)

if [ "$LOCAL" != "$REMOTE" ]; then
  if git merge-base --is-ancestor origin/rust HEAD 2>/dev/null; then
    echo "  Local esta adelantado respecto a origin — continuando."
  elif git merge-base --is-ancestor HEAD origin/rust 2>/dev/null; then
    echo ""
    echo "  ERROR: origin/rust tiene commits que no estan en local."
    echo "  Ejecuta: git pull --rebase origin rust"
    echo "  Y luego volve a correr pnpm tag."
    exit 1
  else
    echo ""
    echo "  ERROR: local y origin/rust divergieron."
    echo "  Sincroniza manualmente y volve a correr pnpm tag."
    exit 1
  fi
fi

# ── Cambios pendientes ────────────────────────────────────────────────────────
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo ""
  echo "  ── Cambios pendientes detectados ──"
  git status --short
  echo "  ────────────────────────────────────"
  echo "  Estos cambios se incluiran en el commit de release."
  echo ""
fi

# ── Actualizar archivos ──────────────────────────────────────────────────────
echo "  Actualizando archivos a v${NEW}..."

sed -i "s/^version = \"${CURRENT}\"/version = \"${NEW}\"/" "$CARGO_TOML"

sed -i "s/\"version\": \"${TAURI_CURRENT}\"/\"version\": \"${NEW}\"/" "$TAURI_CONF"

sed -i "s/VORAK v[0-9]\+\.[0-9]\+\.[0-9]\+/VORAK v${NEW}/g" "$README"

npm version "$NEW" --no-git-tag-version --allow-same-version 2>/dev/null

echo "  Refrescando Cargo.lock..."
(cd src-tauri && cargo generate-lockfile 2>/dev/null) || true

# ── Commit ────────────────────────────────────────────────────────────────────
echo ""
echo "  Creando commit de actualizacion..."

git add .

git commit -m "Actualizacion del sistema a una nueva version v${NEW}" --no-verify

# ── Push ──────────────────────────────────────────────────────────────────────
echo "  Subiendo commit a origin/rust..."
git push origin rust

# ── Tag ───────────────────────────────────────────────────────────────────────
echo ""
echo "  Creando tag anotado v${NEW}..."
git tag -a "v${NEW}" -m "Release v${NEW}"

echo "  Subiendo tag a origin..."
git push origin "v${NEW}"

echo ""
echo "  Listo. El pipeline release.yml se disparara con el tag v${NEW}."
echo ""
