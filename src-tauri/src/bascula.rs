use crate::state::AppState;
use std::io::{BufRead, BufReader};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::Emitter;

const BASCULA_VID: u16 = 0x1a86;
const BASCULA_PID: u16 = 0x7523;

pub fn find_serial_port(vid: u16, pid: u16) -> Option<String> {
    let ports = serialport::available_ports().ok()?;
    let vid_pid_str = format!("{:04x}:{:04x}", vid, pid);
    for port in ports {
        if let serialport::SerialPortType::UsbPort(ref info) = port.port_type {
            let hwid = format!("{:04x}:{:04x}", info.vid, info.pid);
            if hwid == vid_pid_str {
                return Some(port.port_name);
            }
        }
    }
    None
}

pub fn spawn_bascula_reader(
    app_state: Arc<AppState>,
    app_handle: tauri::AppHandle,
    stop_flag: Arc<AtomicBool>,
) {
    thread::spawn(move || {
        bascula_reader_loop(&app_state, &app_handle, stop_flag);
    });
}

fn bascula_reader_loop(state: &AppState, handle: &tauri::AppHandle, stop_flag: Arc<AtomicBool>) {
    loop {
        if stop_flag.load(Ordering::Relaxed) {
            let mut hw = state.hardware.lock().unwrap();
            hw.bascula_conectada = false;
            hw.peso = 0;
            let status = crate::state::ComponentStatus {
                bascula_conectada: false,
                impresora_conectada: hw.impresora_conectada,
                rfid_conectado: hw.rfid_conectado,
            };
            drop(hw);
            let _ = handle.emit("component_status", &status);
            break;
        }

        let port_name = match find_serial_port(BASCULA_VID, BASCULA_PID) {
            Some(p) => p,
            None => {
                let mut hw = state.hardware.lock().unwrap();
                hw.bascula_conectada = false;
                hw.peso = 0;
                drop(hw);
                thread::sleep(Duration::from_secs(5));
                continue;
            }
        };

        match serialport::new(&port_name, 9600)
            .timeout(Duration::from_secs(1))
            .data_bits(serialport::DataBits::Eight)
            .parity(serialport::Parity::None)
            .stop_bits(serialport::StopBits::One)
            .open()
        {
            Ok(port) => {
                let mut reader = BufReader::new(port);
                loop {
                    if stop_flag.load(Ordering::Relaxed) {
                        break;
                    }

                    let mut line = String::new();
                    match reader.read_line(&mut line) {
                        Ok(0) => {
                            thread::sleep(Duration::from_millis(100));
                            continue;
                        }
                        Ok(_) => {
                            let trimmed = line.trim();
                            if !trimmed.is_empty() {
                                if let Ok(peso) = trimmed.parse::<i32>() {
                                    let mut hw = state.hardware.lock().unwrap();
                                    hw.peso = peso;
                                    drop(hw);
                                    let _ = handle
                                        .emit("peso_en_gramos", serde_json::json!({"peso": peso}));
                                }
                            }
                        }
                        Err(e) => {
                            if e.kind() == std::io::ErrorKind::TimedOut {
                                if find_serial_port(BASCULA_VID, BASCULA_PID).is_none() {
                                    break;
                                }
                                continue;
                            }
                            eprintln!("Error leyendo bascula: {}", e);
                            break;
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("Error abriendo puerto serie: {}", e);
            }
        }

        let mut hw = state.hardware.lock().unwrap();
        hw.bascula_conectada = false;
        hw.peso = 0;
        let status = crate::state::ComponentStatus {
            bascula_conectada: false,
            impresora_conectada: hw.impresora_conectada,
            rfid_conectado: hw.rfid_conectado,
        };
        drop(hw);
        let _ = handle.emit("component_status", &status);

        thread::sleep(Duration::from_secs(5));
    }
}
