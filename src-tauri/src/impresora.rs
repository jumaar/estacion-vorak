use crate::label;
use crate::state::AppState;
use std::fs::File;
use std::io::Write;
use std::path::Path;
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::Emitter;

#[derive(Debug, Clone)]
pub struct PrintJob {
    pub fecha_hora: String,
    pub fecha_vencimiento: String,
    pub peso: i32,
    pub precio_total: f64,
}

pub fn spawn_print_worker(
    app_state: Arc<AppState>,
    app_handle: tauri::AppHandle,
    rx: std::sync::mpsc::Receiver<PrintJob>,
    font_data: Arc<Vec<u8>>,
) {
    thread::spawn(move || {
        print_worker_loop(&app_state, &app_handle, rx, &font_data);
    });
}

fn print_worker_loop(
    state: &AppState,
    handle: &tauri::AppHandle,
    rx: std::sync::mpsc::Receiver<PrintJob>,
    font_data: &[u8],
) {
    loop {
        let job = match rx.recv() {
            Ok(j) => j,
            Err(_) => break,
        };

        {
            let hw = state.hardware.lock().unwrap();
            if !hw.impresora_conectada {
                let _ = handle.emit(
                    "impresion_error",
                    serde_json::json!({"error": "Impresora no conectada"}),
                );
                continue;
            }
        }

        let settings = state.printer_settings.lock().unwrap().clone();

        let printer_path = find_printer_device();
        if printer_path.is_none() {
            let _ = handle.emit(
                "impresion_error",
                serde_json::json!({"error": "Dispositivo de impresion no encontrado"}),
            );
            continue;
        }
        let printer_path = printer_path.unwrap();

        let tspl_bytes = label::render_label(
            &job.fecha_hora,
            &job.fecha_vencimiento,
            job.peso,
            job.precio_total,
            font_data,
            &settings,
        );

        match File::create(&printer_path) {
            Ok(mut f) => {
                if let Err(e) = f.write_all(&tspl_bytes) {
                    let _ = handle.emit(
                        "impresion_error",
                        serde_json::json!({"error": format!("Error escribiendo a impresora: {}", e)}),
                    );
                    continue;
                }
                if let Err(e) = f.flush() {
                    let _ = handle.emit(
                        "impresion_error",
                        serde_json::json!({"error": format!("Error en flush: {}", e)}),
                    );
                    continue;
                }
            }
            Err(e) => {
                let _ = handle.emit(
                    "impresion_error",
                    serde_json::json!({"error": format!("Error abriendo dispositivo: {}", e)}),
                );
                continue;
            }
        }

        let _ = handle.emit(
            "impresion_completada",
            serde_json::json!({"mensaje": "Etiqueta impresa exitosamente"}),
        );

        thread::sleep(Duration::from_millis(200));
    }
}

fn find_printer_device() -> Option<String> {
    for i in 0..10 {
        let path = format!("/dev/usb/lp{}", i);
        if Path::new(&path).exists() {
            return Some(path);
        }
    }
    None
}
