use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::sync::Mutex;

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ComponentStatus {
    pub bascula_conectada: bool,
    pub impresora_conectada: bool,
    pub rfid_conectado: bool,
}

#[derive(Debug)]
pub struct HardwareState {
    pub peso: i32,
    pub bascula_conectada: bool,
    pub impresora_conectada: bool,
    pub rfid_conectado: bool,
}

impl Default for HardwareState {
    fn default() -> Self {
        Self {
            peso: 0,
            bascula_conectada: false,
            impresora_conectada: false,
            rfid_conectado: false,
        }
    }
}

pub struct AppState {
    pub hardware: Mutex<HardwareState>,
    pub print_tx: std::sync::mpsc::Sender<super::impresora::PrintJob>,
    pub bascula_stop: Mutex<Option<Arc<AtomicBool>>>,
}

