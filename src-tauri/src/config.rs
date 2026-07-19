use crate::state::PrinterSettings;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;
use tauri_plugin_store::StoreExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub turnstile_site_key: String,
    pub nestjs_api_base_url: String,
}

impl Config {
    pub fn load(app_handle: &tauri::AppHandle) -> Self {
        let resource_path = app_handle
            .path()
            .resolve(
                "resources/config.json",
                tauri::path::BaseDirectory::Resource,
            )
            .unwrap_or_else(|_| PathBuf::from("resources/config.json"));

        let mut config: Config = fs::read_to_string(&resource_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_else(|| Config {
                turnstile_site_key: String::new(),
                nestjs_api_base_url: String::new(),
            });

        if let Ok(home) = std::env::var("HOME") {
            let override_path = PathBuf::from(home)
                .join(".config")
                .join("vorak-estacion")
                .join("config.json");
            if override_path.exists() {
                if let Ok(override_str) = fs::read_to_string(&override_path) {
                    if let Ok(override_cfg) = serde_json::from_str::<Config>(&override_str) {
                        config = override_cfg;
                    }
                }
            }
        }

        config
    }
}

const STORE_PATH: &str = "printer_settings.json";

pub fn load_or_init_printer_settings(
    app_handle: &tauri::AppHandle,
    resource_dir: &Path,
) -> PrinterSettings {
    let store = app_handle
        .store(STORE_PATH)
        .expect("failed to open printer settings store");

    if let Some(val) = store.get("settings") {
        if let Ok(settings) = serde_json::from_value::<PrinterSettings>(val.clone()) {
            return settings;
        }
    }

    let defaults_path = resource_dir.join("printer_settings.json");
    let defaults = if let Ok(content) = fs::read_to_string(&defaults_path) {
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        PrinterSettings::default()
    };

    let _ = store.set(
        "settings",
        serde_json::to_value(&defaults).unwrap_or_default(),
    );
    let _ = store.save();

    defaults
}

pub fn save_printer_settings(
    app_handle: &tauri::AppHandle,
    settings: &PrinterSettings,
) -> Result<(), String> {
    let store = app_handle
        .store(STORE_PATH)
        .map_err(|e| format!("Error abriendo store: {}", e))?;

    store
        .set(
            "settings",
            serde_json::to_value(settings).map_err(|e| format!("Error serializando: {}", e))?,
        );

    store
        .save()
        .map_err(|e| format!("Error guardando configuracion: {}", e))?;

    Ok(())
}
