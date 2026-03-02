use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Output, Stdio};
use std::sync::Mutex;
use std::thread::sleep;
use std::time::Duration;

use tauri::{Manager, State, WindowEvent};

const DEFAULT_PORT: u16 = 4310;
const PORT_SCAN_COUNT: u16 = 25;
const STARTUP_RETRY_COUNT: usize = 80;
const STARTUP_RETRY_DELAY_MS: u64 = 250;

struct BackendProcess {
    child: Child,
    port: u16,
}

#[derive(Default)]
struct BackendState {
    process: Mutex<Option<BackendProcess>>,
}

fn backend_url(port: u16) -> String {
    format!("http://localhost:{port}")
}

fn locate_backend_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(value) = std::env::var("BLANKDRIVE_ROOT") {
        candidates.push(PathBuf::from(value));
    }

    if let Ok(current) = std::env::current_dir() {
        candidates.push(current);
    }

    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join(".."));

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("blankdrive-runtime"));
    }

    for candidate in candidates {
        let cli_entrypoint = candidate.join("dist").join("index.js");
        if cli_entrypoint.is_file() {
            return Ok(candidate);
        }
    }

    Err(
        "Could not locate BlankDrive runtime. Expected `dist/index.js` in repository root. Run `npm run build` in the root project and retry."
            .to_string(),
    )
}

fn select_port(start_port: u16, scan_count: u16) -> Result<u16, String> {
    for offset in 0..=scan_count {
        let port = start_port.saturating_add(offset);
        if port == 0 {
            continue;
        }

        if TcpListener::bind((Ipv4Addr::LOCALHOST, port)).is_ok() {
            return Ok(port);
        }
    }

    Err(format!(
        "No free loopback port found between {start_port} and {}.",
        start_port.saturating_add(scan_count)
    ))
}

fn read_http_status(port: u16) -> bool {
    let addr = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port));
    let timeout = Duration::from_millis(350);
    let mut stream = match TcpStream::connect_timeout(&addr, timeout) {
        Ok(stream) => stream,
        Err(_) => return false,
    };

    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));

    if stream
        .write_all(b"GET /api/status HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }

    let mut bytes = [0_u8; 128];
    let count = match stream.read(&mut bytes) {
        Ok(count) => count,
        Err(_) => return false,
    };

    if count == 0 {
        return false;
    }

    let response = String::from_utf8_lossy(&bytes[..count]);
    response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200")
}

fn stop_backend_process(state: &State<BackendState>) {
    if let Ok(mut guard) = state.process.lock() {
        if let Some(mut process) = guard.take() {
            let _ = process.child.kill();
            let _ = process.child.wait();
        }
    }
}

fn run_blankdrive_cli(app: &tauri::AppHandle, args: &[&str]) -> Result<Output, String> {
    let backend_root = locate_backend_root(app)?;
    let cli_entrypoint = backend_root.join("dist").join("index.js");
    if !cli_entrypoint.is_file() {
        return Err(format!(
            "Missing backend runtime: {}",
            cli_entrypoint.display()
        ));
    }

    let node_bin = std::env::var("BLANKDRIVE_NODE_BIN").unwrap_or_else(|_| "node".to_string());
    let mut command = Command::new(node_bin.clone());
    command
        .arg(&cli_entrypoint)
        .args(args)
        .current_dir(&backend_root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    command
        .output()
        .map_err(|error| format!("Failed to run BLANK command with `{node_bin}`: {error}."))
}

#[tauri::command]
fn ensure_blankdrive_backend(
    app: tauri::AppHandle,
    state: State<BackendState>,
) -> Result<String, String> {
    let mut guard = state
        .process
        .lock()
        .map_err(|_| "Backend process lock poisoned.".to_string())?;

    if let Some(existing) = guard.as_mut() {
        if read_http_status(existing.port) {
            return Ok(backend_url(existing.port));
        }
        let _ = existing.child.kill();
        let _ = existing.child.wait();
        *guard = None;
    }

    let backend_root = locate_backend_root(&app)?;
    let cli_entrypoint = backend_root.join("dist").join("index.js");
    if !cli_entrypoint.is_file() {
        return Err(format!(
            "Missing backend runtime: {}",
            cli_entrypoint.display()
        ));
    }

    let node_bin = std::env::var("BLANKDRIVE_NODE_BIN").unwrap_or_else(|_| "node".to_string());
    let port = select_port(DEFAULT_PORT, PORT_SCAN_COUNT)?;

    let mut command = Command::new(node_bin.clone());
    command
        .arg(&cli_entrypoint)
        .arg("web")
        .arg("--port")
        .arg(port.to_string())
        .current_dir(&backend_root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let mut child = command.spawn().map_err(|error| {
        format!("Failed to launch Node sidecar with `{node_bin}`: {error}.")
    })?;

    for _ in 0..STARTUP_RETRY_COUNT {
        if read_http_status(port) {
            *guard = Some(BackendProcess { child, port });
            return Ok(backend_url(port));
        }

        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("Failed to query backend process: {error}."))?
        {
            return Err(format!(
                "BlankDrive backend exited while starting (status: {status})."
            ));
        }

        sleep(Duration::from_millis(STARTUP_RETRY_DELAY_MS));
    }

    let _ = child.kill();
    let _ = child.wait();
    Err("Timed out while waiting for BlankDrive backend to become ready.".to_string())
}

#[tauri::command]
fn stop_blankdrive_backend(state: State<BackendState>) {
    stop_backend_process(&state);
}

#[tauri::command]
fn check_blankdrive_update(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let current_version = app.package_info().version.to_string();
    let args = vec![
        "update",
        "--check",
        "--scheduled",
        "--json",
        "--current-version",
        current_version.as_str(),
    ];

    let output = run_blankdrive_cli(&app, &args)?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Update check command failed.".to_string()
        } else {
            stderr
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        return Err("Update check returned empty output.".to_string());
    }

    serde_json::from_str::<serde_json::Value>(&stdout)
        .map_err(|error| format!("Failed to parse update JSON: {error}."))
}

#[tauri::command]
fn install_blankdrive_update(app: tauri::AppHandle) -> Result<String, String> {
    let current_version = app.package_info().version.to_string();
    let args = vec![
        "update",
        "--install",
        "--yes",
        "--force",
        "--current-version",
        current_version.as_str(),
    ];

    let output = run_blankdrive_cli(&app, &args)?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "Desktop update command failed.".to_string()
        } else {
            stderr
        });
    }

    Ok("Installer launched".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(BackendState::default())
        .invoke_handler(tauri::generate_handler![
            ensure_blankdrive_backend,
            stop_blankdrive_backend,
            check_blankdrive_update,
            install_blankdrive_update
        ])
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::Destroyed) {
                let state: State<BackendState> = window.state();
                stop_backend_process(&state);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
