use crate::config::{self, Config};
use crate::impresora::PrintJob;
use crate::state::{AppState, PrinterSettings};
use chrono::{Datelike, Local, Timelike};
use std::sync::Arc;
use tauri::{Emitter, State};

fn mes_abreviado(m: u32) -> &'static str {
    match m {
        1 => "ene",
        2 => "feb",
        3 => "mar",
        4 => "abr",
        5 => "may",
        6 => "jun",
        7 => "jul",
        8 => "ago",
        9 => "sep",
        10 => "oct",
        11 => "nov",
        12 => "dic",
        _ => "???",
    }
}

fn format_fecha_es(d: &chrono::NaiveDate) -> String {
    format!("{}/{}/{}", d.day(), mes_abreviado(d.month()), d.year())
}

fn format_datetime_es(dt: &chrono::NaiveDateTime) -> String {
    format!(
        "{}/{}/{}, {:02}:{:02}",
        dt.day(),
        mes_abreviado(dt.month()),
        dt.year(),
        dt.hour(),
        dt.minute()
    )
}

#[tauri::command]
pub fn get_config(config: State<'_, Config>) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "turnstile_site_key": config.turnstile_site_key,
        "app_version": env!("CARGO_PKG_VERSION")
    }))
}

#[tauri::command]
pub fn get_backend_config(config: State<'_, Config>) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "nestjs_api_base_url": config.nestjs_api_base_url
    }))
}

#[tauri::command]
pub fn get_component_status(state: State<'_, Arc<AppState>>) -> Result<serde_json::Value, String> {
    let status = crate::devices::get_component_status(&state);
    Ok(serde_json::json!(status))
}

#[tauri::command]
pub fn get_printer_settings(state: State<'_, Arc<AppState>>) -> Result<PrinterSettings, String> {
    let settings = state.printer_settings.lock().map_err(|e| e.to_string())?;
    Ok(settings.clone())
}

#[tauri::command]
pub fn save_printer_settings(
    state: State<'_, Arc<AppState>>,
    app_handle: tauri::AppHandle,
    settings: PrinterSettings,
) -> Result<(), String> {
    config::save_printer_settings(&app_handle, &settings)?;

    let mut current = state.printer_settings.lock().map_err(|e| e.to_string())?;
    *current = settings;

    Ok(())
}

#[tauri::command]
pub fn print_test_label(
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let peso = {
        let hw = state.hardware.lock().map_err(|e| e.to_string())?;
        hw.peso
    };

    let peso_test = if peso > 0 { peso } else { 500 };

    let now = Local::now();
    let fecha_hora = format_datetime_es(&now.naive_local());
    let venc = now
        .checked_add_signed(chrono::Duration::days(7))
        .unwrap_or(now);
    let fecha_vencimiento = format_fecha_es(&venc.date_naive());

    let job = PrintJob {
        fecha_hora,
        fecha_vencimiento,
        peso: peso_test,
        precio_total: 99.0,
    };

    state
        .print_tx
        .send(job)
        .map_err(|e| format!("Error encolando impresion de prueba: {}", e))
}

#[tauri::command]
pub fn imprimir_etiqueta(
    state: State<'_, Arc<AppState>>,
    fecha_vencimiento: String,
    precio_total: f64,
) -> Result<(), String> {
    let peso = {
        let hw = state.hardware.lock().map_err(|e| e.to_string())?;
        hw.peso
    };

    if peso <= 0 {
        return Err("Peso no valido en la bascula".to_string());
    }

    let now = Local::now();
    let fecha_hora = format_datetime_es(&now.naive_local());

    let job = PrintJob {
        fecha_hora,
        fecha_vencimiento,
        peso,
        precio_total,
    };

    state
        .print_tx
        .send(job)
        .map_err(|e| format!("Error encolando impresion: {}", e))
}

#[tauri::command]
pub fn reimprimir_etiqueta(
    state: State<'_, Arc<AppState>>,
    peso_g: i32,
    fecha_creacion: String,
    fecha_vencimiento: String,
    precio_total: f64,
) -> Result<(), String> {
    if peso_g <= 0 {
        return Err("Datos de peso invalidos para reimpresion.".to_string());
    }

    let fecha_hora = chrono::DateTime::parse_from_rfc3339(&fecha_creacion)
        .or_else(|_| {
            chrono::NaiveDateTime::parse_from_str(&fecha_creacion, "%Y-%m-%dT%H:%M:%S%.fZ")
                .map(|d| d.and_utc().into())
        })
        .or_else(|_| {
            chrono::NaiveDate::parse_from_str(&fecha_creacion, "%Y-%m-%d")
                .map(|d| d.and_hms_opt(0, 0, 0).unwrap().and_utc().into())
        })
        .map_err(|e| format!("Fecha invalida: {}", e))?;

    let fecha_hora_str = format_datetime_es(&fecha_hora.naive_utc());

    let job = PrintJob {
        fecha_hora: fecha_hora_str,
        fecha_vencimiento,
        peso: peso_g,
        precio_total,
    };

    state
        .print_tx
        .send(job)
        .map_err(|e| format!("Error encolando reimpresion: {}", e))
}

#[tauri::command]
pub fn update_app(app_handle: tauri::AppHandle) -> Result<String, String> {
    use std::io::{BufRead, BufReader};
    use std::process::{Command, Stdio};

    let emit = |msg: &str| {
        let _ = app_handle.emit("update-progress", msg);
    };

    emit("Iniciando actualizacion...");
    emit("Se solicitara permiso de administrador (pkexec).");

    let mut cmd = Command::new("pkexec");
    cmd.arg("bash")
        .arg("-c")
        .arg("apt-get update && apt-get install --only-upgrade vorak-estacion -y")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Error ejecutando actualizacion: {}", e))?;

    if let Some(stdout) = child.stdout.take() {
        let app_handle = app_handle.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                let _ = app_handle.emit("update-progress", line);
            }
        });
    }

    if let Some(stderr) = child.stderr.take() {
        let app_handle = app_handle.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                let msg = format!("[stderr] {}", line);
                let _ = app_handle.emit("update-progress", msg);
            }
        });
    }

    emit("Descargando e instalando paquetes...");

    let status = child
        .wait()
        .map_err(|e| format!("Error esperando actualizacion: {}", e))?;

    if !status.success() {
        emit("La actualizacion no se completo. Verifique la conexion.");
        return Err("La actualizacion no se completo. Verifique la conexion.".into());
    }

    emit("Actualizacion completada. Reiniciando aplicacion...");

    app_handle.restart();
}
