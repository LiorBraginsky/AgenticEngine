// FLAG: .parse::<Shortcut>() relies on FromStr for "CommandOrControl+Shift+Space".
// Verified per Tauri v2 docs (v2.tauri.app/plugin/global-shortcut/) — the
// cross-platform accelerator string is the canonical form. If cargo build fails
// with "the trait `FromStr` is not implemented for `Shortcut`", fall back to the
// Modifiers variant (see plan Step 3c FLAG-IF-UNSURE note) and report to Lior.

use tauri::Manager;
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

pub fn run() {
    tauri::Builder::default()
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![hide_panel, read_auth_token])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
