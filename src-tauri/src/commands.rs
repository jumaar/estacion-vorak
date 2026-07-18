use crate::config::Config;
use crate::impresora::PrintJob;
use crate::state::AppState;
use chrono::Local;
use tauri::State;

#[tauri::command]
pub fn get_config(config: State<'_, Config>) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "turnstile_site_key": config.turnstile_site_key
    }))
}

#[tauri::command]
pub fn get_backend_config(config: State<'_, Config>) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "nestjs_api_base_url": config.nestjs_api_base_url
    }))
}

#[tauri::command]
pub fn get_component_status(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let status = crate::devices::get_component_status(&state);
    Ok(serde_json::json!(status))
}

#[tauri::command]
pub fn imprimir_etiqueta(
    state: State<'_, AppState>,
    fecha_vencimiento: String,
    precio_total: f64,
) -> Result<(), String> {
    let peso = {
        let hw = state.hardware.lock().map_err(|e| e.to_string())?;
        hw.peso
    };

    if peso <= 0 {
        return Err("Peso no válido en la báscula".to_string());
    }

    let now = Local::now();
    let fecha_hora = now.format("%d/%m/%Y, %H:%M").to_string();

    let job = PrintJob {
        fecha_hora,
        fecha_vencimiento,
        peso,
        precio_total,
    };

    state
        .print_tx
        .send(job)
        .map_err(|e| format!("Error encolando impresión: {}", e))
}

#[tauri::command]
pub fn reimprimir_etiqueta(
    state: State<'_, AppState>,
    peso_g: i32,
    fecha_creacion: String,
    fecha_vencimiento: String,
    precio_total: f64,
) -> Result<(), String> {
    if peso_g <= 0 {
        return Err("Datos de peso inválidos para reimpresión.".to_string());
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
        .map_err(|e| format!("Fecha inválida: {}", e))?;

    let fecha_hora_str = fecha_hora.format("%d/%m/%Y, %H:%M").to_string();

    let job = PrintJob {
        fecha_hora: fecha_hora_str,
        fecha_vencimiento,
        peso: peso_g,
        precio_total,
    };

    state
        .print_tx
        .send(job)
        .map_err(|e| format!("Error encolando reimpresión: {}", e))
}
