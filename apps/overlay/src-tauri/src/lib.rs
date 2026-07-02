// FLAG: .parse::<Shortcut>() relies on FromStr for "CommandOrControl+Shift+Space".
// Verified per Tauri v2 docs (v2.tauri.app/plugin/global-shortcut/) — the
// cross-platform accelerator string is the canonical form. If cargo build fails
// with "the trait `FromStr` is not implemented for `Shortcut`", fall back to the
// Modifiers variant (see plan Step 3c FLAG-IF-UNSURE note) and report to Lior.

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[tauri::command]
fn hide_panel(window: tauri::Window) {
    let _ = window.hide();
}

/// Read the per-install auth token minted by the daemon (spec §3.2, ADR-0003 p.5).
/// Mirrors `packages/daemon/src/index.ts:64`:
///   dataDir = AGENTIC_DATA_DIR ?? $HOME/.agentic-engine
/// No new Cargo dep: uses std::fs + std::env (B1 approach).
#[tauri::command]
fn read_auth_token() -> Result<String, String> {
    let dir = match std::env::var("AGENTIC_DATA_DIR") {
        Ok(d) => d,
        Err(_) => {
            let home = std::env::var("HOME").map_err(|e| e.to_string())?;
            format!("{home}/.agentic-engine")
        }
    };
    std::fs::read_to_string(std::path::Path::new(&dir).join("auth-token"))
        .map(|s| s.trim().to_string())
        .map_err(|e| e.to_string())
}

/// Shared tray-mutation sink (Demo-1 fix, Step 6): sets the glyph + tooltip on
/// "main-tray". Called from BOTH the JS-invokable command below (kept for a future
/// JS-driven "busy") AND the Rust-side TCP health-poll thread spawned in `setup()`.
/// `set_title`/`set_tooltip` self-proxy to the main thread (tauri-2.11.2
/// `tray/mod.rs` `run_item_main_thread!`), so calling this from a background
/// thread is safe without an explicit `run_on_main_thread`.
fn apply_tray_status(app: &tauri::AppHandle, status: &str) {
    let Some(tray) = app.tray_by_id("main-tray") else {
        return;
    };
    let (glyph, tip) = match status {
        "connected" => ("●", "AgenticEngine — connected"),
        "busy" => ("◐", "AgenticEngine — working…"),
        _ => ("○", "AgenticEngine — daemon unreachable"),
    };
    let _ = tray.set_title(Some(glyph));
    let _ = tray.set_tooltip(Some(tip));
}

/// Read-only status sink for the tray. Kept registered (thin wrapper over
/// `apply_tray_status`) for a future JS-driven "busy" state; tray liveness
/// (connected/disconnected) is now driven solely by the Rust TCP poll below
/// (ADR-0006 p.4 — the deferred menu-bar status indicator; Demo-1 fix Step 6).
#[tauri::command]
fn set_tray_status(app: tauri::AppHandle, status: String) {
    apply_tray_status(&app, &status);
}

pub fn run() {
    tauri::Builder::default()
        // Demo-1 fix (cluster 1): the memory window's native x must HIDE, not DESTROY, so
        // "Open Memory…" can re-show the SAME webview every time (a destroyed window makes
        // get_webview_window("memory") return None -> dead until restart). Keeping the webview
        // alive also lets memory.ts's liveness poll (Step 5) survive close/reopen. Filtered by
        // label so main/widget are unaffected.
        .on_window_event(|window, event| {
            if window.label() == "memory" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            #[cfg(desktop)]
            {
                let shortcut: Shortcut = "CommandOrControl+Shift+Space"
                    .parse()
                    .expect("valid accelerator string");
                let trigger = shortcut.clone();
                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |app, sc, event| {
                            if sc == &trigger && event.state() == ShortcutState::Pressed {
                                if let Some(win) = app.get_webview_window("main") {
                                    let _ = win.show();
                                    let _ = win.set_focus();
                                }
                            }
                        })
                        .build(),
                )?;
                app.global_shortcut().register(shortcut)?;
            }

            // Menu-bar tray: status indicator + "Open Memory…" / "Quit" (ADR-0006 p.4,
            // un-defers the decision). Icon-asset decision (chunk-01): asset-free — reuses
            // the app's default window icon rather than shipping new template PNGs; the
            // visible connected/error state change is driven by `set_tray_status`'s
            // `set_title` glyph, not the icon itself.
            let open_i = MenuItem::with_id(app, "open_memory", "Open Memory…", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_i, &quit_i])?;

            let mut tray_builder = TrayIconBuilder::with_id("main-tray")
                .tooltip("AgenticEngine — connecting…")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open_memory" => {
                        if let Some(win) = app.get_webview_window("memory") {
                            let _ = win.show();
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                        } else if let Some(cfg) = app
                            .config()
                            .app
                            .windows
                            .iter()
                            .find(|w| w.label == "memory")
                            .cloned()
                        {
                            if let Ok(win) =
                                WebviewWindowBuilder::from_config(app, &cfg).and_then(|b| b.build())
                            {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(icon);
            }
            let _tray = tray_builder.build(app)?;

            // Demo-1 fix (Step 6, tray direction): the tray's ONLY liveness source is
            // this Rust-side TCP health poll — a JS poll would run in the same hidden
            // main webview whose reconnect loop was the suspected root cause in Demo-1
            // (WKWebView occlusion / App-Nap throttling), and tuning the shared agent
            // ConnectionManager would couple tray timing to agent-connection semantics
            // (forbidden by this chunk's OUT-scope). std::net only — no new crate.
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    use std::net::{SocketAddr, TcpStream};
                    use std::time::Duration;
                    let addr: SocketAddr =
                        "127.0.0.1:7777".parse().expect("valid daemon socket addr");
                    let mut last: Option<&str> = None;
                    loop {
                        let status = if TcpStream::connect_timeout(&addr, Duration::from_millis(1500)).is_ok()
                        {
                            "connected"
                        } else {
                            "disconnected"
                        };
                        if last != Some(status) {
                            last = Some(status);
                            apply_tray_status(&handle, status);
                        }
                        std::thread::sleep(Duration::from_secs(3));
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            hide_panel,
            read_auth_token,
            set_tray_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
