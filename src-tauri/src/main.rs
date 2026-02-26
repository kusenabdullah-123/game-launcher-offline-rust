// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Serialize, Deserialize};
use std::fs;
use std::path::PathBuf;
use std::collections::HashMap;
use std::process::{Command, Child};
use std::sync::{Arc, Mutex};
use tauri::{State, Emitter};

// ─── Structs ──────────────────────────────────────────────────────────────────

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
    #[serde(default)] use_ace: bool,
    #[serde(default)] use_ntsync: bool,
    #[serde(default)] use_antilag: bool,
    #[serde(default)] pub custom_env: String,
    #[serde(default)] pub launch_args: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppConfig {
    pub proton_root: String,
    pub games: Vec<Game>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SystemHealth {
    pub umu_ok:      bool,
    pub gamemode_ok: bool,
    pub ntsync_ok:   bool,
    pub vulkan_ok:   bool,
    pub umu_version: String,
}

struct AppState {
    procs: Arc<Mutex<HashMap<String, Child>>>,
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

fn home_dir() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/root".to_string()))
}

fn config_path() -> PathBuf {
    let dir = home_dir().join(".config").join("corerunner");
    let _ = fs::create_dir_all(&dir);
    let new_path = dir.join("config.json");
    // Migrasi dari path lama jika ada
    let legacy = PathBuf::from("launcher_config.json");
    if legacy.exists() && !new_path.exists() {
        let _ = fs::copy(&legacy, &new_path);
    }
    new_path
}

// ─── Tauri Commands ───────────────────────────────────────────────────────────

#[tauri::command]
fn scan_manual_proton(base_path: String) -> Result<Vec<ProtonVersion>, String> {
    let path = PathBuf::from(&base_path);
    let mut versions = Vec::new();
    if let Ok(entries) = fs::read_dir(&path) {
        for entry in entries.flatten() {
            let sub = entry.path();
            // Deteksi folder proton (biasanya ada file 'proton' atau 'dist')
            if sub.is_dir() && (sub.join("proton").exists() || sub.join("dist").exists()) {
                versions.push(ProtonVersion {
                    name: sub.file_name().unwrap().to_string_lossy().into_owned(),
                    path: sub.to_string_lossy().into_owned(), // Simpan path root foldernya
                });
            }
        }
    }
    // Urutkan nama (terbaru biasanya angka lebih besar/huruf akhir)
    versions.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(versions)
}

#[tauri::command]
fn run_game(
    game: Game,
    state: State<AppState>,
    app_handle: tauri::AppHandle,
    use_gamemode: bool,
) -> Result<String, String> {

    // 1. Cek umu-run tersedia di PATH
    let umu_ok = Command::new("sh")
        .args(["-c", "command -v umu-run"])
        .output()
        .map(|o| o.status.success())  // exit 0 = found, exit 1 = not found
        .unwrap_or(false);
    if !umu_ok {
        return Err(
            "umu-launcher tidak ditemukan.\nInstall: yay -S umu-launcher\natau: paru -S umu-launcher".to_string()
        );
    }

    // 2. Buat Prefix Directory jika belum ada
    if !game.prefix_path.is_empty() {
        let _ = fs::create_dir_all(&game.prefix_path);
    }

    // 3. Setup Command: gamemoderun -> umu-run
    let mut cmd = if use_gamemode {
        let mut c = Command::new("gamemoderun");
        c.arg("umu-run");
        c
    } else {
        Command::new("umu-run")
    };

    // 4. Argumen Utama UMU adalah Game EXE
    cmd.arg(&game.exe_path);

    let proton_folder = {
        let p = PathBuf::from(&game.proton_path);
        if p.is_file() {
            p.parent()
             .map(|parent| parent.to_string_lossy().into_owned())
             .unwrap_or_else(|| game.proton_path.clone())
        } else {
            game.proton_path.clone()
        }
    };

    cmd.env("PROTONPATH",  &proton_folder)
       .env("WINEPREFIX",  &game.prefix_path)
       .env("GAMEID",      "umu-default")
       .env("PROTON_VERB", "run");

    // 6. Optimasi
    cmd.env("WINE_GST_VULKAN_NO_ZERO_COPY", "1")
       .env("PROTON_USE_FSYNC",         "1")
       .env("DXVK_ASYNC",               "1")
       .env("WINE_LARGE_ADDRESS_AWARE", "1")
       .env("WINEDEBUG",     "-all")
       .env("DXVK_LOG_LEVEL", "none");


    // 7. Fitur Opsional
    if game.use_ntsync {
        // Cek apakah kernel support /dev/ntsync
        if std::path::Path::new("/dev/ntsync").exists() {
            cmd.env("PROTON_USE_NTSYNC", "1");
        }
    }
    
    if game.use_antilag {
        cmd.env("ENABLE_LAYER_MESA_ANTI_LAG", "1");
    }

    if game.use_ace {
        // ACE Anti-Cheat fix standar
        cmd.env("WINEDLLOVERRIDES", "lsteamclient=d;winedbg=")
           .env("PROTON_NO_ESYNC", "1");
    }

    // 8. Custom Env Variables (Overwrites dari user)
    // Format yang diharapkan: "KEY=VALUE\nKEY2=VALUE2"
    for line in game.custom_env.lines() {
        let line = line.trim();
        if !line.is_empty() && !line.starts_with('#') {
            if let Some((k, v)) = line.split_once('=') {
                cmd.env(k.trim(), v.trim());
            }
        }
    }

    // 9. Launch Arguments
    if !game.launch_args.trim().is_empty() {
        // Pisahkan argumen berdasarkan spasi
        let args: Vec<&str> = game.launch_args.split_whitespace().collect();
        cmd.args(args);
    }

    // 10. Eksekusi
    let child = cmd.spawn().map_err(|e| format!("Gagal spawn process: {}", e))?;

    // 9. Simpan PID untuk tombol STOP
    let game_name = game.name.clone();
    let procs_arc = Arc::clone(&state.procs);
    procs_arc.lock().unwrap().insert(game_name.clone(), child);

    // 10. Thread Monitoring (Agar tombol UI balik ke 'Launch' saat game tutup)
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_secs(1));
            let mut procs = procs_arc.lock().unwrap();
            
            if let Some(child_proc) = procs.get_mut(&game_name) {
                // Cek apakah proses mati
                if let Ok(Some(_)) = child_proc.try_wait() {
                    procs.remove(&game_name);
                    let _ = app_handle.emit("game-status", (&game_name, "READY"));
                    break;
                }
            } else {
                // Proses sudah dihapus manual (tombol STOP)
                let _ = app_handle.emit("game-status", (&game_name, "READY"));
                break;
            }
        }
    });

    Ok(format!("Running {} via UMU", game.name))
}

#[tauri::command]
fn kill_game(name: String, prefix_path: String, state: State<AppState>) -> Result<(), String> {
    // 1. Matikan proses utama (umu-run)
    let mut procs = state.procs.lock().unwrap();
    if let Some(mut child) = procs.remove(&name) {
        let _ = child.kill();
    }
    drop(procs); // Lepas lock

    // 2. Matikan Wineserver (Ini yang mematikan game sebenarnya)
    if !prefix_path.is_empty() {
        let _ = Command::new("wineserver")
            .arg("-k")
            .env("WINEPREFIX", &prefix_path)
            .spawn();
    }

    Ok(())
}

#[tauri::command]
fn run_winetricks(prefix_path: String) -> Result<(), String> {
    Command::new("winetricks")
        .env("WINEPREFIX", &prefix_path)
        .spawn()
        .map_err(|e| format!("Gagal buka winetricks: {}", e))?;
    Ok(())
}

#[tauri::command]
fn check_system_health() -> SystemHealth {
    // Helper closure: cek apakah command tersedia di PATH
    let cmd_ok = |name: &str| -> bool {
        Command::new("sh")
            .args(["-c", &format!("command -v {}", name)])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    };

    // Versi umu-run (ambil dari --version flag)
    let umu_version = Command::new("umu-run")
        .arg("--version")
        .output()
        .map(|o| {
            // Output biasanya: "umu-launcher version X.Y.Z ..."
            let raw = String::from_utf8_lossy(&o.stdout).to_string();
            // Ambil baris pertama saja, potong setelah newline
            raw.lines().next().unwrap_or("unknown").trim().to_string()
        })
        .unwrap_or_else(|_| "not found".to_string());

    // Vulkan: cek via vulkaninfo (lebih reliable dari file)
    let vulkan_ok = Command::new("vulkaninfo")
        .arg("--summary")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    SystemHealth {
        umu_ok:      cmd_ok("umu-run"),
        gamemode_ok: cmd_ok("gamemoderun"),
        ntsync_ok:   std::path::Path::new("/dev/ntsync").exists(),
        vulkan_ok,
        umu_version,
    }
}

#[tauri::command]
fn save_config(config: AppConfig) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(config_path(), json).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_config() -> Result<AppConfig, String> {
    let path = config_path();
    let data = fs::read_to_string(&path).unwrap_or_else(|_| r#"{"proton_root":"","games":[]}"#.into());
    Ok(serde_json::from_str(&data).unwrap_or(AppConfig { proton_root: "".into(), games: vec![] }))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState { procs: Arc::new(Mutex::new(HashMap::new())) })
        .invoke_handler(tauri::generate_handler![
            run_game,
            kill_game,
            scan_manual_proton,
            save_config,
            load_config,
            run_winetricks,
            check_system_health,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}