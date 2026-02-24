#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Serialize, Deserialize};
use std::fs;
use std::path::PathBuf;
use std::collections::HashMap;
use std::process::{Command, Child};
use std::sync::{Arc, Mutex};
use tauri::{State, Emitter};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProtonVersion {
    name: String,
    path: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Game {
    id: u64,
    name: String,
    proton_path: String,
    exe_path: String,
    prefix_path: String,
    use_ace: bool, 
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppConfig {
    pub proton_root: String,
    pub games: Vec<Game>,
}

struct AppState {
    procs: Arc<Mutex<HashMap<String, Child>>>,
}

#[tauri::command]
fn scan_manual_proton(base_path: String) -> Result<Vec<ProtonVersion>, String> {
    let path = PathBuf::from(&base_path);
    let mut versions = Vec::new();
    if path.exists() && path.is_dir() {
        if let Ok(entries) = fs::read_dir(path) {
            for entry in entries.flatten() {
                let subfolder = entry.path();
                if subfolder.is_dir() {
                    let proton_binary = subfolder.join("proton");
                    if proton_binary.exists() {
                        versions.push(ProtonVersion {
                            name: subfolder.file_name().unwrap().to_string_lossy().into_owned(),
                            path: proton_binary.to_string_lossy().into_owned(),
                        });
                    }
                }
            }
        }
    }
    Ok(versions)
}

#[tauri::command]
fn save_config(config: AppConfig) -> Result<(), String> {
    let data = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write("launcher_config.json", data).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_config() -> Result<AppConfig, String> {
    let path = "launcher_config.json";
    if !std::path::Path::new(path).exists() {
        return Ok(AppConfig { proton_root: "".into(), games: vec![] });
    }
    let data = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let config: AppConfig = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    Ok(config)
}

#[tauri::command]
fn run_game(game: Game, state: State<AppState>, app_handle: tauri::AppHandle) -> Result<String, String> {
    let mut cmd = Command::new(&game.proton_path);
    cmd.arg("run")
       .arg(&game.exe_path)
       .env("STEAM_COMPAT_DATA_PATH", &game.prefix_path)
       .env("STEAM_COMPAT_CLIENT_INSTALL_PATH", "/tmp");

    if game.use_ace {
        cmd.env("WINEDLLOVERRIDES", "lsteamclient=d;winedbg=")
           .env("PROTON_NO_ESYNC", "1")
           .env("PROTON_USE_FSYNC", "1");
    } else {
        cmd.env("PROTON_NO_ESYNC", "0")
           .env("PROTON_USE_FSYNC", "1");
    }

    let child = cmd.spawn().map_err(|e| e.to_string())?;
    let game_name = game.name.clone();
    let procs_clone = Arc::clone(&state.procs);
    
    procs_clone.lock().unwrap().insert(game_name.clone(), child);

    std::thread::spawn(move || {
        loop {
            let mut procs = procs_clone.lock().unwrap();
            if let Some(child_proc) = procs.get_mut(&game_name) {
                match child_proc.try_wait() {
                    Ok(Some(_)) => {
                        procs.remove(&game_name);
                        let _ = app_handle.emit("game-status", (game_name, "READY"));
                        break;
                    }
                    Ok(None) => (),
                    Err(_) => break,
                }
            } else { break; }
            drop(procs);
            std::thread::sleep(std::time::Duration::from_secs(2));
        }
    });

    Ok(format!("Started {}", game.name))
}

#[tauri::command]
fn kill_game(name: String, state: State<AppState>) -> Result<(), String> {
    let mut procs = state.procs.lock().unwrap();
    if let Some(mut child) = procs.remove(&name) {
        let _ = child.kill();
    }
    Ok(())
}

#[tauri::command]
fn run_winetricks(prefix_path: String) -> Result<String, String> {
    Command::new("konsole")
        .arg("--noclose")
        .arg("-e")
        .arg("sh")
        .arg("-c")
        .arg(format!("WINEPREFIX=\"{}\" winetricks", prefix_path))
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok("Opened Winetricks".into())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState { procs: Arc::new(Mutex::new(HashMap::new())) })
        .invoke_handler(tauri::generate_handler![
            run_game, kill_game, scan_manual_proton, save_config, load_config, run_winetricks
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}