use std::path::Path;
use std::process::Command;

const AUTOSTART_INSTALLED: &str = "/etc/xdg/autostart/vorak-estacion.desktop";
const MARKER_SKIP: &str = "/tmp/vorak-estacion-daemon-skip";

pub fn ensure_installed() {
    if Path::new(AUTOSTART_INSTALLED).exists() {
        return;
    }
    if Path::new(MARKER_SKIP).exists() {
        return;
    }

    let setup_script = r#"#!/bin/bash
set -e
APP_NAME="vorak-estacion"
RESOURCE_DIR="/usr/lib/${APP_NAME}/resources"

if [ -f "/usr/share/applications/vorak-estacion.desktop" ]; then
    mkdir -p /etc/xdg/autostart
    cp "/usr/share/applications/vorak-estacion.desktop" /etc/xdg/autostart/
fi

if [ -f "${RESOURCE_DIR}/99-vorak-estacion.rules" ]; then
    cp "${RESOURCE_DIR}/99-vorak-estacion.rules" /etc/udev/rules.d/
    udevadm control --reload-rules || true
    udevadm trigger || true
fi

echo "VORAK autostart configured successfully"
"#;

    let tmp = std::env::temp_dir().join("vorak-estacion-setup.sh");
    if std::fs::write(&tmp, setup_script).is_err() {
        return;
    }
    let _ = Command::new("chmod").arg("+x").arg(&tmp).status();

    std::thread::spawn(move || {
        let result = Command::new("pkexec").arg(&tmp).status();
        let _ = std::fs::remove_file(&tmp);
        match result {
            Ok(s) if s.success() => {
                println!("[vorak-estacion] autostart configured via self-heal");
            }
            _ => {
                let _ = std::fs::write(MARKER_SKIP, "skip");
                println!("[vorak-estacion] autostart setup skipped");
            }
        }
    });
}
