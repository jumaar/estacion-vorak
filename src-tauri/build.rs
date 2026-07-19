fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "get_config",
                "get_backend_config",
                "get_component_status",
                "get_printer_settings",
                "save_printer_settings",
                "print_test_label",
                "imprimir_etiqueta",
                "reimprimir_etiqueta",
                "update_app",
            ]),
        ),
    )
    .expect("failed to run tauri-build");
}
