mod bascula;
mod commands;
mod config;
mod devices;
mod impresora;
mod label;
mod state;

use config::Config;
use state::{AppState, HardwareState};
use std::sync::{Arc, Mutex};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let config = Config::load(&app.handle());
            app.manage(config);

            let resource_dir = app
                .path()
                .resolve("resources", tauri::path::BaseDirectory::Resource)
                .unwrap_or_default();

            let font_data = Arc::new(crate::label::load_font(&resource_dir));

            let (print_tx, print_rx) = std::sync::mpsc::channel();
            let app_state = Arc::new(AppState {
                hardware: Mutex::new(HardwareState::default()),
                print_tx,
                bascula_stop: Mutex::new(None),
            });

            app.manage(app_state.clone());

            let handle = app.handle().clone();
            devices::spawn_uevent_listener(app_state.clone(), handle.clone());

            crate::impresora::spawn_print_worker(
                app_state,
                handle,
                print_rx,
                font_data,
            );

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::get_backend_config,
            commands::get_component_status,
            commands::imprimir_etiqueta,
            commands::reimprimir_etiqueta,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
