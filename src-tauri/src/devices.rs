use crate::bascula::spawn_bascula_reader;
use crate::state::{AppState, ComponentStatus};
use libc::{
    bind, close, recvfrom, sockaddr_nl, socket, AF_NETLINK, NETLINK_KOBJECT_UEVENT, SOCK_RAW,
};
use std::io::{self, ErrorKind};
use std::mem::MaybeUninit;
use std::os::unix::io::RawFd;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use tauri::Emitter;

const BASCULA_VID: u16 = 0x1a86;
const BASCULA_PID: u16 = 0x7523;
const IMPRESORA_VID: u16 = 0x0483;
const IMPRESORA_PID: u16 = 0x5720;
const RFID_VID: u16 = 0x1a86;
const RFID_PID: u16 = 0xe010;

fn check_usb_present(vid: u16, pid: u16) -> bool {
    if let Ok(output) = std::process::Command::new("lsusb").output() {
        let stdout = String::from_utf8_lossy(&output.stdout).to_lowercase();
        let target = format!("{:04x}:{:04x}", vid, pid);
        return stdout.contains(&target);
    }
    false
}

fn find_usblp_device() -> bool {
    for i in 0..10 {
        if Path::new(&format!("/dev/usb/lp{}", i)).exists() {
            return true;
        }
    }
    false
}

fn get_device_type(product: &str) -> Option<DeviceType> {
    if product.starts_with("1a86/e010") {
        return Some(DeviceType::Rfid);
    }
    if product.starts_with("1a86/7523") {
        return Some(DeviceType::Bascula);
    }
    if product.starts_with("483/5720") || product.starts_with("0483/5720") {
        return Some(DeviceType::Impresora);
    }
    None
}

#[derive(Debug)]
enum DeviceType {
    Bascula,
    Impresora,
    Rfid,
}

pub fn spawn_uevent_listener(app_state: Arc<AppState>, app_handle: tauri::AppHandle) {
    thread::spawn(move || {
        if let Err(e) = uevent_loop(app_state, &app_handle) {
            eprintln!("uevent listener stopped: {}", e);
        }
    });
}

fn uevent_loop(state: Arc<AppState>, handle: &tauri::AppHandle) -> io::Result<()> {
    let fd = create_netlink_socket()?;

    let mut bascula_connected = check_usb_present(BASCULA_VID, BASCULA_PID);
    let mut impresora_connected =
        check_usb_present(IMPRESORA_VID, IMPRESORA_PID) && find_usblp_device();
    let mut rfid_connected = check_usb_present(RFID_VID, RFID_PID);

    {
        let mut hw = state.hardware.lock().unwrap();
        hw.bascula_conectada = bascula_connected;
        hw.impresora_conectada = impresora_connected;
        hw.rfid_conectado = rfid_connected;
        if !bascula_connected {
            hw.peso = 0;
        }
    }

    let initial = ComponentStatus {
        bascula_conectada: bascula_connected,
        impresora_conectada: impresora_connected,
        rfid_conectado: rfid_connected,
    };
    let mut prev_status: Option<ComponentStatus> = Some(initial.clone());
    let _ = handle.emit("component_status", &initial);

    if bascula_connected {
        start_bascula_reader(&state, handle);
    }

    let mut buf = vec![0u8; 4096];

    loop {
        let n = read_uevent(fd, &mut buf)?;
        if n == 0 {
            continue;
        }

        let data = &buf[..n];
        let mut action = String::new();
        let mut product = String::new();
        let mut devname = String::new();
        let mut subsystem = String::new();

        let mut start = 0;
        for (i, &byte) in data.iter().enumerate() {
            if byte == 0 {
                if start < i {
                    let kv = String::from_utf8_lossy(&data[start..i]);
                    if let Some((key, value)) = kv.split_once('=') {
                        match key {
                            "ACTION" => action = value.to_string(),
                            "PRODUCT" => product = value.to_string(),
                            "DEVNAME" => devname = value.to_string(),
                            "SUBSYSTEM" => subsystem = value.to_string(),
                            _ => {}
                        }
                    }
                }
                start = i + 1;
                if start >= n {
                    break;
                }
            }
        }

        let product_lower = product.to_lowercase();

        let is_printer_usb = subsystem == "usb"
            && (product_lower.starts_with("483/5720") || product_lower.starts_with("0483/5720"));
        let is_printer_lp = subsystem == "usbmisc" && devname.starts_with("usb/lp");

        let device = get_device_type(&product.to_lowercase());

        if let Some(ref dt) = device {
            match dt {
                DeviceType::Bascula => {
                    if action == "add" {
                        if !bascula_connected {
                            bascula_connected = true;
                            start_bascula_reader(&state, handle);
                        }
                    } else if action == "remove" {
                        bascula_connected = false;
                        let stop_guard = state.bascula_stop.lock().unwrap();
                        if let Some(ref stop) = *stop_guard {
                            stop.store(true, Ordering::Relaxed);
                        }
                        let mut hw = state.hardware.lock().unwrap();
                        hw.peso = 0;
                    }
                }
                DeviceType::Impresora => {
                    if action == "add" {
                        impresora_connected = true;
                    } else if action == "remove" {
                        impresora_connected = find_usblp_device();
                    }
                }
                DeviceType::Rfid => {
                    if action == "add" {
                        rfid_connected = true;
                    } else if action == "remove" {
                        rfid_connected = false;
                    }
                }
            }
        }

        if is_printer_usb {
            if action == "add" {
                impresora_connected = find_usblp_device();
            } else if action == "remove" {
                impresora_connected = find_usblp_device();
            }
        }

        if is_printer_lp {
            if action == "add" {
                impresora_connected = true;
            } else if action == "remove" {
                impresora_connected = false;
            }
        }

        {
            let mut hw = state.hardware.lock().unwrap();
            hw.bascula_conectada = bascula_connected;
            hw.impresora_conectada = impresora_connected;
            hw.rfid_conectado = rfid_connected;
        }

        let current = ComponentStatus {
            bascula_conectada: bascula_connected,
            impresora_conectada: impresora_connected,
            rfid_conectado: rfid_connected,
        };

        if prev_status.as_ref() != Some(&current) {
            let _ = handle.emit("component_status", &current);
            prev_status = Some(current);
        }
    }
}

fn create_netlink_socket() -> io::Result<RawFd> {
    let fd = unsafe { socket(AF_NETLINK, SOCK_RAW, NETLINK_KOBJECT_UEVENT) };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }

    let mut addr: sockaddr_nl = unsafe { MaybeUninit::zeroed().assume_init() };
    addr.nl_family = AF_NETLINK as u16;
    addr.nl_pid = 0;
    addr.nl_groups = 1;

    let ret = unsafe {
        bind(
            fd,
            &addr as *const sockaddr_nl as *const libc::sockaddr,
            std::mem::size_of::<sockaddr_nl>() as u32,
        )
    };
    if ret < 0 {
        unsafe { close(fd) };
        return Err(io::Error::last_os_error());
    }

    Ok(fd)
}

fn read_uevent(fd: RawFd, buf: &mut [u8]) -> io::Result<usize> {
    let n = unsafe {
        recvfrom(
            fd,
            buf.as_mut_ptr() as *mut libc::c_void,
            buf.len(),
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if n < 0 {
        let err = io::Error::last_os_error();
        if err.kind() == ErrorKind::Interrupted {
            return Ok(0);
        }
        return Err(err);
    }
    Ok(n as usize)
}

pub fn get_component_status(state: &AppState) -> ComponentStatus {
    let hw = state.hardware.lock().unwrap();
    ComponentStatus {
        bascula_conectada: hw.bascula_conectada,
        impresora_conectada: hw.impresora_conectada,
        rfid_conectado: hw.rfid_conectado,
    }
}

fn start_bascula_reader(state: &Arc<AppState>, handle: &tauri::AppHandle) {
    let mut stop_guard = state.bascula_stop.lock().unwrap();
    if stop_guard.is_none() {
        let stop = Arc::new(AtomicBool::new(false));
        *stop_guard = Some(stop.clone());
        drop(stop_guard);
        spawn_bascula_reader(state.clone(), handle.clone(), stop);
    }
}
