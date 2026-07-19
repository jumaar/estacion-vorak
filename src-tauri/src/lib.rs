mod bascula;
mod commands;
mod config;
mod devices;
mod impresora;
mod label;
mod proxy;
mod state;

use config::Config;
use state::{AppState, HardwareState};
use std::sync::{Arc, Mutex};
use tauri::Manager;

const LOCALHOST_PORT: u16 = 9527;

fn create_main_window(app: &tauri::App) -> tauri::Result<()> {
    let url: tauri::Url = format!("http://localhost:{}/", LOCALHOST_PORT)
        .parse()
        .expect("invalid localhost URL");
    tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::External(url))
        .title("VORAK - Estacion de Pesaje")
        .inner_size(1024.0, 768.0)
        .resizable(true)
        .center()
        .build()?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            let config = Config::load(&app.handle());
            app.manage(config.clone());

            proxy::spawn(app.handle().clone(), &config.nestjs_api_base_url);

            let resource_dir = app
                .path()
                .resolve("resources", tauri::path::BaseDirectory::Resource)
                .unwrap_or_default();

            let font_data = Arc::new(crate::label::load_font(&resource_dir));

            let printer_settings = config::load_or_init_printer_settings(app.handle(), &resource_dir);

            let (print_tx, print_rx) = std::sync::mpsc::channel();
            let app_state = Arc::new(AppState {
                hardware: Mutex::new(HardwareState::default()),
                print_tx,
                bascula_stop: Mutex::new(None),
                printer_settings: Mutex::new(printer_settings),
            });

            app.manage(app_state.clone());

            let handle = app.handle().clone();
            devices::spawn_uevent_listener(app_state.clone(), handle.clone());

            crate::impresora::spawn_print_worker(app_state, handle, print_rx, font_data);

            create_main_window(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::get_backend_config,
            commands::get_component_status,
            commands::get_printer_settings,
            commands::save_printer_settings,
            commands::print_test_label,
            commands::imprimir_etiqueta,
            commands::reimprimir_etiqueta,
            commands::update_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
