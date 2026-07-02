// FLAG: .parse::<Shortcut>() relies on FromStr for "CommandOrControl+Shift+Space".
// Verified per Tauri v2 docs (v2.tauri.app/plugin/global-shortcut/) — the
// cross-platform accelerator string is the canonical form. If cargo build fails
// with "the trait `FromStr` is not implemented for `Shortcut`", fall back to the
// Modifiers variant (see plan Step 3c FLAG-IF-UNSURE note) and report to Lior.

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
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

/// Read-only status sink for the tray. Called by main.ts from a connection-state tap
/// (ADR-0006 p.4 — the deferred menu-bar status indicator). No app logic here: purely
/// reflects daemon connectivity. Unknown/"disconnected" -> error state.
///
/// Icon-asset decision (chunk-01, plan Step 2): asset-free path — no new PNGs, no
/// `include_image!`. The tray reuses the app's existing default window icon (set once at
/// build time); the VISIBLE state change is a glyph in `set_title` (macOS renders the tray
/// title text next to the icon in the menu bar) plus the tooltip — NOT tooltip-only.
#[tauri::command]
fn set_tray_status(app: tauri::AppHandle, status: String) {
    let Some(tray) = app.tray_by_id("main-tray") else {
        return;
    };
    let (glyph, tip) = match status.as_str() {
        "connected" => ("●", "AgenticEngine — connected"),
        "busy" => ("◐", "AgenticEngine — working…"),
        _ => ("○", "AgenticEngine — daemon unreachable"),
    };
    let _ = tray.set_title(Some(glyph));
    let _ = tray.set_tooltip(Some(tip));
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
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(icon);
            }
            let _tray = tray_builder.build(app)?;

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
