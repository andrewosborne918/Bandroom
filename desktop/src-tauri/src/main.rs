#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{Emitter, Manager};
const DEFAULT_ORIGIN: &str = "https://bndrm.vercel.app";
fn configured_origin(configured: Option<&str>, development: bool) -> String {
    if development {
        if let Some(value) = configured {
            if let Ok(url) = reqwest::Url::parse(value) {
                if url.scheme() == "http" && url.host_str() == Some("localhost")
                    && url.username().is_empty() && url.password().is_none()
                    && url.path() == "/" && url.query().is_none() && url.fragment().is_none() {
                    return url.origin().ascii_serialization();
                }
            }
        }
    }
    DEFAULT_ORIGIN.to_string()
}
fn origin() -> String {
    configured_origin(std::env::var("BNDRM_ORIGIN").ok().as_deref(), cfg!(debug_assertions))
}
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
    keyring::Entry::new("app.bndrm.desktop", if origin() == DEFAULT_ORIGIN { "processor" } else { "processor-development" })
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
        .post(format!("{}/api/desktop/{}", origin(), path))
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
    let base = origin();
    let url = match code {
        Some(c) if c.len() == 10 && c.chars().all(|v| v.is_ascii_hexdigit()) => {
            format!("{base}/?desktop={c}")
        }
        Some(_) => return Err("Invalid connection code".into()),
        None => format!("{base}/"),
    };
    if let Some(old) = app.get_webview_window("band") {
        if navigate_existing {
            old.navigate(url.parse().unwrap())
                .map_err(|_| "Unable to open Bndrm")?;
        }
        old.set_focus().map_err(|_| "Unable to focus Bndrm")?;
        return Ok(());
    }
    let mail_app = app.clone();
    tauri::WebviewWindowBuilder::new(
        &app,
        "band",
        tauri::WebviewUrl::External(url.parse().unwrap()),
    )
    .initialization_script("window.__BNDRM_DESKTOP__ = true;")
    .title("Bndrm · Library & Session")
    .inner_size(1280.0, 900.0)
    .disable_drag_drop_handler()
    .on_navigation(move |url| route_band_navigation(url, &base, |draft| {
        if tauri_plugin_opener::open_url(draft, None::<&str>).is_err() {
            if let Some(window) = mail_app.get_webview_window("band") {
                let _ = window.eval("window.dispatchEvent(new CustomEvent('bndrm-email-draft-result',{detail:'failed'}))");
            }
        }
    }))
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}
fn is_email_draft(url: &reqwest::Url) -> bool {
    if url.scheme() != "mailto" || url.host_str().is_some() || url.fragment().is_some()
        || url.as_str().len() > 16384 || !url.query_pairs().all(|(key, _)| key == "subject" || key == "body") {
        return false;
    }
    // query_pairs performs percent-decoding without accepting mailto headers as
    // additional recipients. Only one recipient is permitted.
    let Ok(recipient_url) = reqwest::Url::parse(&format!("https://validation.invalid/?to={}", url.path())) else { return false };
    let Some((_, recipient)) = recipient_url.query_pairs().next() else { return false };
    let parts: Vec<_> = recipient.split('@').collect();
    parts.len() == 2 && !parts[0].is_empty() && parts[1].contains('.')
        && parts[1].chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
        && !recipient.chars().any(|c| c.is_control() || c.is_whitespace() || "<>,;:?/#\\".contains(c))
}
fn route_band_navigation<F: FnOnce(&str)>(url: &reqwest::Url, base: &str, open_draft: F) -> bool {
    if is_email_draft(url) {
        open_draft(url.as_str());
        false // Keep the band workspace open instead of navigating to mailto.
    } else {
        url.origin().ascii_serialization() == base
    }
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
    let config = json!({"url":origin(),"secret":c["secret"],"cache":root.join(c["bandId"].as_str().unwrap_or("band")),"models":root.join("models")});
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
    let url = format!("{}/desktop", origin());
    if let Some(w) = app.get_webview_window("updates") {
        w.set_focus().map_err(|e| e.to_string())?;
    } else {
        tauri::WebviewWindowBuilder::new(
            &app,
            "updates",
            tauri::WebviewUrl::External(url.parse().unwrap()),
        )
        .initialization_script("window.__BNDRM_DESKTOP__ = true;")
        .title("Bndrm updates")
        .build()
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn is_open_request(url: &str) -> bool {
    matches!(url, "bndrm://open" | "bndrm://open/")
}
#[cfg(test)]
mod tests {
    use super::{is_open_request, configured_origin, DEFAULT_ORIGIN};
    #[test]
    fn packaged_app_always_uses_production() {
        for configured in [None, Some("http://localhost:3000"), Some("https://example.com")] {
            assert_eq!(configured_origin(configured, false), DEFAULT_ORIGIN);
        }
        assert_eq!(configured_origin(None, true), DEFAULT_ORIGIN);
        assert_eq!(configured_origin(Some("http://localhost:3000/"), true), "http://localhost:3000");
        for value in ["not a URL", "https://example.com", "http://localhost.evil:3000", "http://user:pass@localhost:3000", "http://localhost:3000/path", "http://localhost:3000?token=x"] {
            assert_eq!(configured_origin(Some(value), true), DEFAULT_ORIGIN);
        }
    }
    #[test]
    fn email_drafts_open_externally_without_navigating_the_workspace() {
        let mut opened = false;
        let url = reqwest::Url::parse("mailto:person%2Bband%40example.com?subject=Join&body=Private%20invitation").unwrap();
        assert!(!super::route_band_navigation(&url, DEFAULT_ORIGIN, |_| opened = true));
        assert!(opened);
        for value in ["https://evil.example/", "file:///etc/passwd", "javascript:alert(1)", "mailto:one@example.com,two@example.com", "mailto:one%0A@example.com", "mailto:one@example.com?bcc=other@example.com", "mailto:one@example.com#fragment", "mailto://host/person@example.com", "mailto:one@example.com%26bcc=other@example.com"] {
            let url = reqwest::Url::parse(value).unwrap();
            assert!(!super::route_band_navigation(&url, DEFAULT_ORIGIN, |_| panic!("Invalid draft opened")), "{value}");
        }
        let url = reqwest::Url::parse(DEFAULT_ORIGIN).unwrap();
        assert!(super::route_band_navigation(&url, DEFAULT_ORIGIN, |_| panic!("Workspace opened externally")));
    }
    #[test]
    fn external_links_can_only_open_the_controller() {
        assert!(is_open_request("bndrm://open"));
        assert!(is_open_request("bndrm://open/"));
        for url in ["bndrm://run/command", "bndrm://open?secret=anything", "https://bndrm.vercel.app", "bndrm://other-band"] {
            assert!(!is_open_request(url));
        }
    }
}
fn focus_controller(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| focus_controller(app)))
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            use tauri_plugin_deep_link::DeepLinkExt;
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                // Links only raise the controller. Never execute paths, accept credentials,
                // switch bands or change permissions from an external URL.
                if event.urls().iter().any(|url| is_open_request(url.as_str())) {
                    focus_controller(&handle);
                }
            });
            Ok(())
        })
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
