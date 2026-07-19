use std::path::Path;
use std::process::Command;

const SERVICE_INSTALLED: &str = "/etc/systemd/system/vorak-estacion.service";
const MARKER_SKIP: &str = "/tmp/vorak-estacion-daemon-skip";

pub fn ensure_installed() {
    if Path::new(SERVICE_INSTALLED).exists() {
        return;
    }
    if Path::new(MARKER_SKIP).exists() {
        return;
    }

    let setup_script = r#"#!/bin/bash
set -e
APP_NAME="vorak-estacion"
RESOURCE_DIR="/usr/lib/${APP_NAME}/resources"

if ! id -u vorak &>/dev/null; then
    useradd -r -m -d /home/vorak -s /bin/bash vorak 2>/dev/null || true
fi
for grp in dialout tty; do
    getent group "$grp" &>/dev/null && usermod -a -G "$grp" vorak 2>/dev/null || true
done

if [ -f "${RESOURCE_DIR}/vorak-estacion.service" ]; then
    cp "${RESOURCE_DIR}/vorak-estacion.service" /etc/systemd/system/
    systemctl daemon-reload || true
    systemctl enable vorak-estacion || true
fi

if [ -f "/usr/share/applications/vorak-estacion.desktop" ]; then
    mkdir -p /etc/xdg/autostart
    cp "/usr/share/applications/vorak-estacion.desktop" /etc/xdg/autostart/
fi

if [ -f "${RESOURCE_DIR}/99-vorak-estacion.rules" ]; then
    cp "${RESOURCE_DIR}/99-vorak-estacion.rules" /etc/udev/rules.d/
    udevadm control --reload-rules || true
    udevadm trigger || true
fi

if [ -f "${RESOURCE_DIR}/setup-autologin.sh" ]; then
    bash "${RESOURCE_DIR}/setup-autologin.sh" || true
fi

echo "VORAK daemon configured successfully"
"#;

    let tmp = std::env::temp_dir().join("vorak-estacion-setup.sh");
    if std::fs::write(&tmp, setup_script).is_err() {
        return;
    }
    let _ = Command::new("chmod").arg("+x").arg(&tmp).status();

    std::thread::spawn(move || {
        let result = Command::new("pkexec")
            .arg(&tmp)
            .status();
        let _ = std::fs::remove_file(&tmp);
        match result {
            Ok(s) if s.success() => {
                println!("[vorak-estacion] daemon configured via self-heal");
            }
            _ => {
                let _ = std::fs::write(MARKER_SKIP, "skip");
                println!("[vorak-estacion] daemon setup skipped");
            }
        }
    });
}
