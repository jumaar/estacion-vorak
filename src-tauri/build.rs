fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "get_config",
                "get_backend_config",
                "get_component_status",
                "imprimir_etiqueta",
                "reimprimir_etiqueta",
            ]),
        ),
    )
    .expect("failed to run tauri-build");
}
