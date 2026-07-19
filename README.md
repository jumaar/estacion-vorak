# vorak-estacion

Estacion de pesaje IoT — VORAK v2.0.0

## Publicar una nueva version

```bash
pnpm tag
```

El script:
1. Muestra la version actual (leida de `src-tauri/Cargo.toml`)
2. Pregunta el nuevo numero de version (formato `X.Y.Z`)
3. Actualiza automaticamente:
   - `src-tauri/Cargo.toml`
   - `src-tauri/tauri.conf.json`
   - `package.json`
4. Crea un commit `vX.Y.Z`
5. Crea y pushea el tag `vX.Y.Z` a `origin/rust`

El pipeline `.github/workflows/release.yml` se dispara con el tag y:
- Compila el `.deb` con `cargo-deb`
- Publica un GitHub Release con el `.deb` adjunto
- Actualiza el repositorio APT firmado con GPG en GitHub Pages

## Instalacion en un dispositivo

*(pendiente)*
