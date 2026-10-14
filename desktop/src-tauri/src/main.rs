#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{Emitter, Manager};
const ORIGIN: &str = "https://bndrm.vercel.app";
#[derive(Default)]
struct Controller {
    child: Arc<Mutex<Option<Child>>>,
    pair: Mutex<Option<Value>>,
}
fn local(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        Err("Native access denied".into())
    } else {
        Ok(())
    }
}
fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new("app.bndrm.desktop", "processor")
        .map_err(|_| "Unable to open your computer’s credential vault".into())
}
fn saved() -> Result<Value, String> {
    let text = entry()?
        .get_password()
        .map_err(|_| "Connect this computer to your band first")?;
    serde_json::from_str(&text).map_err(|_| "Reconnect this computer".into())
}
async fn request(path: &str, body: Value) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "Network setup failed")?;
    let response = client
        .post(format!("{ORIGIN}/api/desktop/{path}"))
        .json(&body)
        .send()
        .await
        .map_err(|_| "Unable to reach Bndrm. Check your internet connection.")?;
    let ok = response.status().is_success();
    let result: Value = response
        .json()
        .await
        .map_err(|_| "Unexpected response from Bndrm")?;
    if !ok {
        return Err(result["error"]
            .as_str()
            .unwrap_or("Connection failed")
            .to_string());
    }
    Ok(result)
}
#[tauri::command]
fn connection_status(window: tauri::WebviewWindow) -> Result<Value, String> {
    local(&window)?;
    Ok(match saved() {
        Ok(c) => json!({"connected":true,"bandName":c["bandName"]}),
        Err(_) => json!({"connected":false}),
    })
}
#[tauri::command]
async fn begin_pair(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Controller>,
) -> Result<Value, String> {
    local(&window)?;
    let name = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "My computer".into());
    let p = request("pair", json!({"name":name,"platform":std::env::consts::OS})).await?;
    let response = json!({"userCode":p["userCode"],"expiresAt":p["expiresAt"]});
    *state.pair.lock().unwrap() = Some(p);
    Ok(response)
}
#[tauri::command]
async fn poll_pair(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Controller>,
) -> Result<Value, String> {
    local(&window)?;
    let p = state
        .pair
        .lock()
        .unwrap()
        .clone()
        .ok_or("Start a new connection")?;
    let r = request(
        "poll",
        json!({"id":p["id"],"deviceSecret":p["deviceSecret"]}),
    )
    .await?;
    if r["approved"] == true {
        entry()?.set_password(&json!({"secret":p["deviceSecret"],"bandName":r["bandName"],"bandId":r["bandId"],"pairId":p["id"]}).to_string()).map_err(|_|"Could not securely save this connection. Check your credential vault.")?;
        *state.pair.lock().unwrap() = None;
    }
    Ok(json!({"approved":r["approved"]}))
}
#[tauri::command]
async fn open_band(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    code: Option<String>,
) -> Result<(), String> {
    local(&window)?;
    let navigate_existing = code.is_some();
    let url = match code {
        Some(c) if c.len() == 10 && c.chars().all(|v| v.is_ascii_hexdigit()) => {
            format!("{ORIGIN}/?desktop={c}")
        }
        Some(_) => return Err("Invalid connection code".into()),
        None => format!("{ORIGIN}/"),
    };
    if let Some(old) = app.get_webview_window("band") {
        if navigate_existing {
            old.navigate(url.parse().unwrap())
                .map_err(|_| "Unable to open Bndrm")?;
        }
        old.set_focus().map_err(|_| "Unable to focus Bndrm")?;
        return Ok(());
    }
    tauri::WebviewWindowBuilder::new(
        &app,
        "band",
        tauri::WebviewUrl::External(url.parse().unwrap()),
    )
    .title("Bndrm · Library & Session")
    .inner_size(1280.0, 900.0)
    .disable_drag_drop_handler()
    .on_navigation(|url| url.scheme() == "https" && url.host_str() == Some("bndrm.vercel.app"))
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}
fn stop(controller: &Controller) {
    if let Some(mut child) = controller.child.lock().unwrap().take() {
        #[cfg(unix)]
        unsafe {
            libc::kill(-(child.id() as i32), libc::SIGTERM);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let _ = Command::new("taskkill")
                .args(["/PID", &child.id().to_string(), "/T", "/F"])
                .creation_flags(0x08000000)
                .status();
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}
#[tauri::command]
fn disconnect(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Controller>,
) -> Result<(), String> {
    local(&window)?;
    stop(&state);
    *state.pair.lock().unwrap() = None;
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("Unable to clear the saved connection".into()),
    }
}
#[tauri::command]
fn start_processor(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Controller>,
) -> Result<(), String> {
    local(&window)?;
    let mut held = state.child.lock().unwrap();
    if let Some(child) = held.as_mut() {
        if child
            .try_wait()
            .map_err(|_| "Unable to inspect processor")?
            .is_none()
        {
            return Ok(());
        }
    }
    *held = None;
    let c = saved()?;
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Unable to find application storage")?;
    std::fs::create_dir_all(&root).map_err(|_| "Unable to create application storage")?;
    let runtime = app
        .path()
        .resource_dir()
        .map_err(|_| "Unable to find bundled audio tools")?
        .join("runtime")
        .join("bndrm-processor");
    let exe = runtime.join(if cfg!(windows) {
        "bndrm-processor.exe"
    } else {
        "bndrm-processor"
    });
    let mut cmd = Command::new(exe);
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("PYTHONUNBUFFERED", "1");
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            cmd.pre_exec(|| {
                if libc::setsid() < 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let mut child = cmd
        .spawn()
        .map_err(|_| "Bundled processor could not start. Reinstall Bndrm Desktop.")?;
    let config = json!({"url":ORIGIN,"secret":c["secret"],"cache":root.join(c["bandId"].as_str().unwrap_or("band")),"models":root.join("models")});
    if child
        .stdin
        .take()
        .ok_or("Processor input missing")?
        .write_all(format!("{config}\n").as_bytes())
        .is_err()
    {
        let _ = child.kill();
        return Err("Unable to start processor".into());
    }
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    *held = Some(child);
    drop(held);
    let handle = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let event = serde_json::from_str::<Value>(&line)
                .unwrap_or(json!({"stage":"log","message":line}));
            if let Some(w) = handle.get_webview_window("main") {
                let _ = w.emit("processor-event", event);
            }
        }
    });
    let handle = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Some(w) = handle.get_webview_window("main") {
                let _ = w.emit("processor-event", json!({"stage":"log","message":line}));
            }
        }
    });
    let handle = app.clone();
    let children = state.child.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));
        let mut held = children.lock().unwrap();
        let Some(c) = held.as_mut() else { break };
        if let Ok(Some(_)) = c.try_wait() {
            *held = None;
            if let Some(w) = handle.get_webview_window("main") {
                let _=w.emit("processor-event",json!({"stage":"failed","message":"Processor stopped. Check its activity, then restart or reconnect."}));
            }
            break;
        }
    });
    Ok(())
}
#[tauri::command]
async fn open_updates(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    local(&window)?;
    let url = format!("{ORIGIN}/desktop");
    if let Some(w) = app.get_webview_window("updates") {
        w.set_focus().map_err(|e| e.to_string())?;
    } else {
        tauri::WebviewWindowBuilder::new(
            &app,
            "updates",
            tauri::WebviewUrl::External(url.parse().unwrap()),
        )
        .title("Bndrm updates")
        .build()
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn main() {
    tauri::Builder::default()
        .manage(Controller::default())
        .invoke_handler(tauri::generate_handler![
            connection_status,
            begin_pair,
            poll_pair,
            open_band,
            start_processor,
            disconnect,
            open_updates
        ])
        .build(tauri::generate_context!())
        .expect("Bndrm could not start")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                stop(&app.state::<Controller>());
            }
        });
}
