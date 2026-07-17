use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub turnstile_site_key: String,
    pub nestjs_api_base_url: String,
}

impl Config {
    pub fn load(app_handle: &tauri::AppHandle) -> Self {
        let resource_path = app_handle
            .path()
            .resolve("resources/config.json", tauri::path::BaseDirectory::Resource)
            .unwrap_or_else(|_| {
                PathBuf::from("resources/config.json")
            });

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
