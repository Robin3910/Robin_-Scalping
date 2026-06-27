#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::fs;
use std::path::PathBuf;
use log::{info, error};
use tauri::Manager;

#[tauri::command]
fn read_config(path: String) -> Result<String, String> {
    fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", path, e))
}

#[tauri::command]
fn write_config(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = PathBuf::from(&path).parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write {}: {}", path, e))
}

#[tauri::command]
fn log_message(level: String, msg: String) {
    match level.as_str() {
        "info" => info!("{}", msg),
        "error" => error!("{}", msg),
        _ => info!("{}", msg),
    }
}

fn main() {
    env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("info")
    ).init();
    
    info!("Starting Robin Scalper Client...");

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            read_config,
            write_config,
            log_message
        ])
        .setup(|app| {
            info!("Application setup complete");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
