// SPDX-License-Identifier: GPL-3.0-or-later
mod autosave;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      autosave::autosave_write,
      autosave::autosave_read,
      autosave::autosave_sessions,
      autosave::autosave_clear,
    ])
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
