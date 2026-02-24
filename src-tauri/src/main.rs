// main.rs
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
    #[serde(default)] // Jika kolom tidak ada, isi dengan false
    use_ace: bool, 
    #[serde(default)] // Jika kolom tidak ada, isi dengan false
    use_ntsync: bool,
    #[serde(default)] // Jika kolom tidak ada, isi dengan false
    use_antilag: bool,
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
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let subfolder = entry.path();
            if subfolder.is_dir() && subfolder.join("proton").exists() {
                versions.push(ProtonVersion {
                    name: subfolder.file_name().unwrap().to_string_lossy().into_owned(),
                    path: subfolder.join("proton").to_string_lossy().into_owned(),
                });
            }
        }
    }
    Ok(versions)
}

#[tauri::command]
fn run_game(game: Game, state: State<AppState>, app_handle: tauri::AppHandle, use_gamemode: bool) -> Result<String, String> {
    let mut cmd = if use_gamemode {
        let mut c = Command::new("gamemoderun");
        c.arg(&game.proton_path);
        c
    } else {
        Command::new(&game.proton_path)
    };

    cmd.arg("run").arg(&game.exe_path)
       .env("STEAM_COMPAT_DATA_PATH", &game.prefix_path)
       .env("STEAM_COMPAT_CLIENT_INSTALL_PATH", "/tmp");

    // Optimization Flags
    if game.use_ntsync { cmd.env("PROTON_USE_NTSYNC", "1"); }
    if game.use_antilag { cmd.env("ENABLE_LAYER_MESA_ANTI_LAG", "1"); }
    
    if game.use_ace {
        cmd.env("WINEDLLOVERRIDES", "lsteamclient=d;winedbg=")
           .env("PROTON_NO_ESYNC", "1");
    } else {
        cmd.env("PROTON_NO_ESYNC", "0");
    }
    
    cmd.env("PROTON_USE_FSYNC", "1");

    let child = cmd.spawn().map_err(|e| format!("Launch failed: {}", e))?;
    let game_name = game.name.clone();
    let procs_clone = Arc::clone(&state.procs);
    procs_clone.lock().unwrap().insert(game_name.clone(), child);

    std::thread::spawn(move || {
        loop {
            let mut procs = procs_clone.lock().unwrap();
            if let Some(child_proc) = procs.get_mut(&game_name) {
                if let Ok(Some(_)) = child_proc.try_wait() {
                    procs.remove(&game_name);
                    let _ = app_handle.emit("game-status", (game_name, "READY"));
                    break;
                }
            } else { break; }
            drop(procs);
            std::thread::sleep(std::time::Duration::from_secs(2));
        }
    });

    Ok("Running".into())
}

#[tauri::command]
fn kill_game(name: String, state: State<AppState>) -> Result<(), String> {
    let mut procs = state.procs.lock().unwrap();
    if let Some(mut child) = procs.remove(&name) { let _ = child.kill(); }
    Ok(())
}

#[tauri::command]
fn run_winetricks(prefix_path: String) -> Result<(), String> {
    Command::new("winetricks")
        .env("WINEPREFIX", &prefix_path)
        .spawn()
        .map_err(|e| format!("Gagal menjalankan Winetricks: {}", e))?;
    
    Ok(())
}

#[tauri::command]
fn save_config(config: AppConfig) -> Result<(), String> {
    fs::write("launcher_config.json", serde_json::to_string_pretty(&config).unwrap()).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_config() -> Result<AppConfig, String> {
    let data = fs::read_to_string("launcher_config.json").unwrap_or("{\"proton_root\":\"\",\"games\":[]}".into());
    let config: AppConfig = serde_json::from_str(&data).unwrap();
    Ok(config)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState { procs: Arc::new(Mutex::new(HashMap::new())) })
        .invoke_handler(tauri::generate_handler![run_game, kill_game, scan_manual_proton, save_config, load_config, run_winetricks])
        .run(tauri::generate_context!())
        .expect("failed to run");
}