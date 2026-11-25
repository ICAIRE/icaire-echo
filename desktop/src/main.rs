//! ICAIRE Echo, the desktop app. A Tauri window around the app the browser used to show: the app itself (the bot,
//! the transcriber, the voices) is the same Node.js program, started here from the files inside the app bundle and
//! stopped when the window closes. What only a native app can do lives here: recording the microphone and the
//! computer's sound without the browser's share picker (audio.rs).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod video;

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Manager, RunEvent, WindowEvent};

const WANTED_PORT: u16 = 4777;

struct App {
    port: Mutex<u16>,
    child: Mutex<Option<Child>>,
    recording: Mutex<Option<audio::Recording>>,
    quitting: Mutex<bool>,
}

/// Where your things live, apart from the app: ~/Library/Application Support/ICAIRE Echo, %APPDATA%\ICAIRE Echo
fn data_dir() -> PathBuf {
    dirs::data_dir().unwrap_or_else(std::env::temp_dir).join("ICAIRE Echo")
}

fn log_file() -> PathBuf {
    #[cfg(target_os = "macos")]
    let dir = dirs::home_dir().unwrap_or_default().join("Library/Logs/ICAIRE Echo");
    #[cfg(not(target_os = "macos"))]
    let dir = data_dir().join("logs");
    let _ = std::fs::create_dir_all(&dir);
    dir.join("echo.log")
}

/// once: what the earlier Meet Recorder kept beside its code moves here (a move on the same disk, nothing copied)
fn bring_over_old_data(data: &Path) {
    #[cfg(target_os = "macos")]
    let old = dirs::home_dir().map(|h| h.join("Meet Recorder"));
    #[cfg(not(target_os = "macos"))]
    let old = dirs::data_local_dir().map(|h| h.join("Meet Recorder"));
    let Some(old) = old else { return };
    for d in ["recordings", "voiceovers", "models", "bot-profile"] {
        let from = old.join(d);
        let to = data.join(d);
        let real_dir = std::fs::symlink_metadata(&from).map(|m| m.is_dir()).unwrap_or(false);
        if real_dir && !to.exists() {
            let _ = std::fs::rename(&from, &to);
        }
    }
}

/// 4777 when it is free (so links keep working), another free port when it is not
fn free_port() -> u16 {
    if TcpListener::bind(("127.0.0.1", WANTED_PORT)).is_ok() {
        return WANTED_PORT;
    }
    TcpListener::bind(("127.0.0.1", 0)).and_then(|l| l.local_addr()).map(|a| a.port()).unwrap_or(WANTED_PORT)
}

/// A tiny request to the app on this computer; returns the status code.
fn request(port: u16, method: &str, path: &str) -> Option<u16> {
    let mut s = TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_millis(800)).ok()?;
    s.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
    let body = if method == "POST" { "{}" } else { "" };
    let req = format!("{method} {path} HTTP/1.1\r\nHost: localhost:{port}\r\nx-mrb: 1\r\ncontent-type: application/json\r\ncontent-length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
    s.write_all(req.as_bytes()).ok()?;
    let mut head = [0u8; 16];
    let n = s.read(&mut head).ok()?;
    std::str::from_utf8(&head[..n]).ok()?.split_whitespace().nth(1)?.parse().ok()
}

/// Starts the app (node server.js) from the bundle, with your data folder, and waits until it answers.
fn start_server(handle: &tauri::AppHandle) -> Result<u16, String> {
    let res = handle.path().resource_dir().map_err(|e| e.to_string())?.join("stage");
    let node = res.join(if cfg!(windows) { "node.exe" } else { "node" });
    let app = res.join("app");
    if !node.exists() {
        return Err(format!("This copy of ICAIRE Echo is incomplete ({} is missing). Install it again.", node.display()));
    }
    let data = data_dir();
    std::fs::create_dir_all(&data).map_err(|e| e.to_string())?;
    bring_over_old_data(&data);
    let port = free_port();
    let log = std::fs::OpenOptions::new().create(true).append(true).open(log_file()).map_err(|e| e.to_string())?;
    let mut cmd = Command::new(&node);
    cmd.arg("server.js")
        .arg("--no-open")
        .current_dir(&app)
        .env("PORT", port.to_string())
        .env("ECHO_DATA", &data)
        .env("ECHO_PACKAGED", "1")
        .env("ECHO_NATIVE", "1")
        .env("MRB_BACKGROUND", "1")
        .stdin(Stdio::null())
        .stdout(log.try_clone().map_err(|e| e.to_string())?)
        .stderr(log);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // no console window
    }
    let child = cmd.spawn().map_err(|e| format!("ICAIRE Echo could not start: {e}"))?;
    *handle.state::<App>().child.lock().unwrap() = Some(child);
    let t0 = Instant::now();
    while t0.elapsed() < Duration::from_secs(60) {
        if request(port, "GET", "/api/state") == Some(200) {
            return Ok(port);
        }
        if let Some(c) = handle.state::<App>().child.lock().unwrap().as_mut() {
            if let Ok(Some(status)) = c.try_wait() {
                return Err(format!("ICAIRE Echo stopped while starting ({status}). Its log: {}", log_file().display()));
            }
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    Err("ICAIRE Echo took too long to start.".into())
}

fn stop_server(handle: &tauri::AppHandle) {
    let state = handle.state::<App>();
    let recording = state.recording.lock().unwrap().take();
    if let Some(r) = recording {
        r.stop();
    }
    let child = state.child.lock().unwrap().take();
    if let Some(mut c) = child {
        let port = *state.port.lock().unwrap();
        let _ = request(port, "POST", "/api/quit");
        let t0 = Instant::now();
        while t0.elapsed() < Duration::from_secs(3) {
            if let Ok(Some(_)) = c.try_wait() {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = c.kill();
    }
}

// ---------- native recording, called from the page ----------
#[derive(serde::Serialize)]
struct Started {
    device: String,
    system: bool,
    system_error: Option<String>,
    video: bool,
    video_error: Option<String>,
}

#[tauri::command]
async fn record_start(state: tauri::State<'_, App>, dir: String, system: bool, video: Option<bool>, ffmpeg: Option<String>) -> Result<Started, String> {
    if state.recording.lock().unwrap().is_some() {
        return Err("A recording is already running.".into());
    }
    // the devices open on their own threads; this waits for them away from the main thread
    // the screen too, when asked for: ffmpeg (the app's own copy, the server says where) encodes it
    let ffmpeg = if video.unwrap_or(false) { ffmpeg.map(std::path::PathBuf::from).filter(|p| p.exists()) } else { None };
    let video_missing = video.unwrap_or(false) && ffmpeg.is_none();
    let r = tauri::async_runtime::spawn_blocking(move || audio::Recording::start(Path::new(&dir), system, ffmpeg.as_deref())).await.map_err(|e| e.to_string())??;
    let video_error = if video_missing { Some("The video encoder was not found.".into()) } else { r.video_error.clone() };
    let out = Started { device: r.device.clone(), system: r.system.is_some(), system_error: r.system_error.clone(), video: r.video.is_some(), video_error };
    *state.recording.lock().unwrap() = Some(r);
    Ok(out)
}

#[tauri::command]
fn record_pause(state: tauri::State<'_, App>, paused: bool) -> Result<(), String> {
    state.recording.lock().unwrap().as_ref().ok_or("Nothing is recording.")?.set_paused(paused);
    Ok(())
}

#[derive(serde::Serialize)]
struct Level {
    mic: f32,
    system: f32,
}

#[tauri::command]
fn record_level(state: tauri::State<'_, App>) -> Level {
    match state.recording.lock().unwrap().as_ref() {
        Some(r) => Level { mic: r.mic.level(), system: r.system.as_ref().map(|s| s.level()).unwrap_or(0.0) },
        None => Level { mic: 0.0, system: 0.0 },
    }
}

#[tauri::command]
async fn record_stop(state: tauri::State<'_, App>) -> Result<f64, String> {
    let r = state.recording.lock().unwrap().take().ok_or("Nothing is recording.")?;
    tauri::async_runtime::spawn_blocking(move || r.stop()).await.map_err(|e| e.to_string())
}

/// "Quit anyway" from the page, when something was still running as the window closed
#[tauri::command]
fn quit_now(handle: tauri::AppHandle) {
    *handle.state::<App>().quitting.lock().unwrap() = true;
    stop_server(&handle);
    handle.exit(0);
}

/// `icaire-echo --video-test <dir> <ffmpeg> <seconds>`: records the screen for that long with a 2 s pause after
/// 2 s, then exits (checks of video.rs without the window: the file should last <seconds> - 2)
fn video_test(args: &[String]) -> ! {
    let (dir, ffmpeg, secs) = (Path::new(&args[2]), Path::new(&args[3]), args[4].parse::<f64>().unwrap_or(8.0));
    std::fs::create_dir_all(dir).ok();
    let paused = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let v = match video::Video::start(dir, ffmpeg, paused.clone(), Instant::now()) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("video did not start: {e}");
            std::process::exit(1);
        }
    };
    std::thread::sleep(Duration::from_secs(2));
    paused.store(true, std::sync::atomic::Ordering::SeqCst);
    std::thread::sleep(Duration::from_secs(2));
    paused.store(false, std::sync::atomic::Ordering::SeqCst);
    std::thread::sleep(Duration::from_secs_f64((secs - 4.0).max(0.0)));
    v.stop();
    println!("expected {:.1} s", secs - 2.0);
    std::process::exit(0);
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() >= 5 && args[1] == "--video-test" {
        video_test(&args);
    }
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|handle, _, _| {
            // opened again: show the window that is already there
            if let Some(w) = handle.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .manage(App { port: Mutex::new(WANTED_PORT), child: Mutex::new(None), recording: Mutex::new(None), quitting: Mutex::new(false) })
        .invoke_handler(tauri::generate_handler![record_start, record_pause, record_level, record_stop, quit_now])
        .setup(|app| {
            let handle = app.handle().clone();
            std::thread::spawn(move || match start_server(&handle) {
                Ok(port) => {
                    *handle.state::<App>().port.lock().unwrap() = port;
                    if let Some(w) = handle.get_webview_window("main") {
                        let _ = w.navigate(format!("http://localhost:{port}/").parse().unwrap());
                    }
                    // the app ended on its own (Quit under More): close the window too
                    loop {
                        std::thread::sleep(Duration::from_millis(500));
                        let ended = {
                            let state = handle.state::<App>();
                            let mut guard = state.child.lock().unwrap();
                            match guard.as_mut() {
                                Some(c) => matches!(c.try_wait(), Ok(Some(_))),
                                None => true,
                            }
                        };
                        if ended {
                            handle.exit(0);
                            return;
                        }
                    }
                }
                Err(e) => {
                    if let Some(w) = handle.get_webview_window("main") {
                        let msg = serde_json::to_string(&e).unwrap_or_default();
                        let _ = w.eval(&format!("window.showError && window.showError({msg})"));
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let handle = window.app_handle().clone();
                if *handle.state::<App>().quitting.lock().unwrap() {
                    return;
                }
                api.prevent_close();
                std::thread::spawn(move || {
                    let state = handle.state::<App>();
                    let port = *state.port.lock().unwrap();
                    let recording_here = state.recording.lock().unwrap().is_some();
                    // the app quits itself when nothing is recording or being made; otherwise the page asks first
                    if !recording_here && matches!(request(port, "POST", "/api/quit"), Some(200) | None) {
                        *state.quitting.lock().unwrap() = true;
                        stop_server(&handle);
                        handle.exit(0);
                    } else {
                        if let Some(w) = handle.get_webview_window("main") {
                            let _ = w.eval("window.echoConfirmQuit ? window.echoConfirmQuit() : null");
                        }
                    }
                });
            }
        })
        .build(tauri::generate_context!())
        .expect("ICAIRE Echo could not start");
    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            stop_server(handle);
        }
    });
}
