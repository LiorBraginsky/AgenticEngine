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
        .invoke_handler(tauri::generate_handler![hide_panel])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
