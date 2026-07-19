# estacion-vorak

Estacion de pesaje IoT — VORAK v2.0.0

## Publicar una nueva version

```bash
pnpm tag
```

El script:
1. Muestra la version actual (leida de `src-tauri/Cargo.toml`)
2. Pregunta el nuevo numero de version (formato `X.Y.Z`)
3. Actualiza automaticamente `Cargo.toml`, `tauri.conf.json`, `package.json` y `README.md`
4. Crea un commit `vX.Y.Z`
5. Crea y pushea el tag `vX.Y.Z` a `origin/rust`

El pipeline `.github/workflows/release.yml` se dispara con el tag y:
- Compila el `.deb` con `cargo-deb`
- Publica un GitHub Release con el `.deb` adjunto
- Actualiza el repositorio APT firmado con GPG en `https://estacion.vorak.app`

## Instalacion en un dispositivo

### 1. Agregar la clave GPG y el repositorio APT

```bash
curl -fsSL https://estacion.vorak.app/vorak-estacion.gpg.key | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/vorak-estacion.gpg
echo "deb [signed-by=/etc/apt/trusted.gpg.d/vorak-estacion.gpg] https://estacion.vorak.app stable main" | sudo tee /etc/apt/sources.list.d/vorak-estacion.list
```

### 2. Instalar

```bash
sudo apt update
sudo apt install vorak-estacion
```

### 3. El sistema se actualiza solo

Cada vez que un operador inicia sesion, la aplicacion consulta `https://api.github.com/repos/jumaar/estacion-vorak/releases/latest`. Si hay una nueva version, muestra un overlay bloqueando el sistema hasta que se instale la actualizacion via `apt`.
