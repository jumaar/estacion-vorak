use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::sync::Mutex;

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ComponentStatus {
    pub bascula_conectada: bool,
    pub impresora_conectada: bool,
    pub rfid_conectado: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PrinterSettings {
    pub label_width_mm: u32,
    pub label_height_mm: u32,
    pub density: u8,
    pub speed: u8,
    pub top_margin: i32,
    pub left_margin: i32,
    pub x_offset: i32,
    pub font_size_row_1: f32,
    pub font_size_row_2: f32,
    pub font_size_row_3: f32,
    pub font_size_row_4: f32,
    pub font_size_row_5: f32,
    pub font_size_row_6: f32,
}

impl Default for PrinterSettings {
    fn default() -> Self {
        Self {
            label_width_mm: 40,
            label_height_mm: 30,
            density: 15,
            speed: 4,
            top_margin: 15,
            left_margin: 5,
            x_offset: -30,
            font_size_row_1: 20.0,
            font_size_row_2: 25.0,
            font_size_row_3: 20.0,
            font_size_row_4: 25.0,
            font_size_row_5: 36.0,
            font_size_row_6: 54.0,
        }
    }
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
    pub printer_settings: Mutex<PrinterSettings>,
}
