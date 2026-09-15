//! Small loopback HTTP listener used by the desktop OAuth redirect.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

static LISTENER: OnceLock<Mutex<Option<TcpListener>>> = OnceLock::new();

fn listener_slot() -> &'static Mutex<Option<TcpListener>> {
    LISTENER.get_or_init(|| Mutex::new(None))
}

/// Binds a loopback listener and returns its ephemeral port.
#[tauri::command]
pub fn oauth_loopback_start() -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let mut slot = listener_slot()
        .lock()
        .map_err(|_| "OAuth listener lock poisoned")?;
    *slot = Some(listener);
    Ok(port)
}

/// Waits for the OAuth callback and returns its query string.
#[tauri::command]
pub fn oauth_loopback_wait(timeout_ms: Option<u64>) -> Result<String, String> {
    let listener = listener_slot()
        .lock()
        .map_err(|_| "OAuth listener lock poisoned")?
        .take()
        .ok_or_else(|| "OAuth listener was not started".to_string())?;
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(300_000).min(600_000));
    wait_for_callback(listener, timeout)
}

fn wait_for_callback(listener: TcpListener, timeout: Duration) -> Result<String, String> {
    let deadline = Instant::now() + timeout;
    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let request = read_request(&mut stream)?;
                let query = request
                    .split_whitespace()
                    .nth(1)
                    .and_then(|target| target.split_once('?').map(|(_, query)| query))
                    .ok_or_else(|| "OAuth callback did not contain a query".to_string())?;
                write_response(&mut stream)?;
                return Ok(query.to_string());
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err("Timed out waiting for Google sign-in".to_string());
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(error) => return Err(error.to_string()),
        }
    }
}

fn read_request(stream: &mut TcpStream) -> Result<String, String> {
    let mut buffer = [0_u8; 8192];
    let count = stream.read(&mut buffer).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&buffer[..count]).to_string())
}

fn write_response(stream: &mut TcpStream) -> Result<(), String> {
    let body = "<html><body>You can close this tab and return to PudimFinance.</body></html>";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(), body
    );
    stream
        .write_all(response.as_bytes())
        .map_err(|e| e.to_string())
}
