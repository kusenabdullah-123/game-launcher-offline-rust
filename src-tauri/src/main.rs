// main.rs
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
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppConfig {
    pub proton_root: String,
    pub games: Vec<Game>,
}

struct AppState {
    procs: Arc<Mutex<HashMap<String, Child>>>,
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

fn home_dir() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/root".to_string()))
}

/// Cek apakah command tersedia di PATH sistem
fn cmd_exists(name: &str) -> bool {
    Command::new("sh")
        .args(["-c", &format!("command -v {}", name)])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Auto-detect path Steam yang valid. Jika tidak ada, buat folder dummy.
/// Proton butuh folder ini ada — tapi Steam tidak harus terinstall penuh.
fn find_steam_path() -> String {
    let candidates = [
        home_dir().join(".local/share/Steam"),
        home_dir().join(".steam/steam"),
        home_dir().join(".steam/root"),
        home_dir().join(".var/app/com.valvesoftware.Steam/.local/share/Steam"),
        home_dir().join("snap/steam/common/.local/share/Steam"),
    ];

    // Prioritas: folder yang punya steamapps (Steam terinstall penuh)
    for p in &candidates {
        if p.join("steamapps").exists() {
            return p.to_string_lossy().into_owned();
        }
    }
    // Fallback: folder Steam yang ada tapi tidak lengkap
    for p in &candidates {
        if p.exists() {
            return p.to_string_lossy().into_owned();
        }
    }

    // Tidak ada Steam sama sekali → buat folder dummy minimal
    // Cukup folder ada, Proton/CachyOS tidak butuh isi folder ini
    let dummy = home_dir().join(".steam").join("steam");
    let _ = fs::create_dir_all(dummy.join("steamapps"));
    dummy.to_string_lossy().into_owned()
}

fn config_path() -> PathBuf {
    // Simpan di ~/.config/corerunner/ — lebih baik dari cwd (bisa hilang saat rebuild)
    let dir = home_dir().join(".config").join("corerunner");
    let _ = fs::create_dir_all(&dir);
    let new_path = dir.join("config.json");

    // Migrasi dari path lama (launcher_config.json di cwd)
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
            if sub.is_dir() && sub.join("proton").exists() {
                versions.push(ProtonVersion {
                    name: sub.file_name().unwrap().to_string_lossy().into_owned(),
                    path: sub.join("proton").to_string_lossy().into_owned(),
                });
            }
        }
    }
    // Terbaru di atas (sort terbalik)
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

    // 1. Validasi path sebelum spawn
    if !PathBuf::from(&game.proton_path).exists() {
        return Err(format!("Proton tidak ditemukan: {}", game.proton_path));
    }
    if !PathBuf::from(&game.exe_path).exists() {
        return Err(format!("File EXE tidak ditemukan: {}", game.exe_path));
    }

    // 2. Siapkan prefix folder
    if !game.prefix_path.is_empty() {
        let _ = fs::create_dir_all(&game.prefix_path);
    }

    // 3. Tentukan command utama
    //    Urutan: [gamemoderun] → proton → game.exe
    //    TIDAK pakai steam-run → tidak butuh steam-native-runtime
    let mut cmd = if use_gamemode && cmd_exists("gamemoderun") {
        let mut c = Command::new("gamemoderun");
        c.arg(&game.proton_path);
        c
    } else {
        Command::new(&game.proton_path)
    };

    // 4. Argumen Proton
    cmd.arg("run").arg(&game.exe_path);

    // 5. Environment variables
    let steam_path = find_steam_path();
    cmd
        // ── Core (WAJIB) ─────────────────────────────────────────
        .env("STEAM_COMPAT_DATA_PATH",           &game.prefix_path)
        .env("STEAM_COMPAT_CLIENT_INSTALL_PATH", &steam_path)      // FIX: bukan /tmp

        // ── GStreamer: blokir bundled plugins (versi .so tidak cocok sistem) ──
        // Root cause blackscreen cutscene: libvpx.so.6, libFLAC.so.8 tidak ada
        // → Proton CachyOS/GE punya GStreamer bundled yg minta versi lama
        // → Cukup kosongkan path agar plugin lama tidak dimuat
        // → JANGAN pakai PROTON_USE_MEDIA_FOUNDATION=1 → merusak DX12 rendering
        .env("GST_PLUGIN_SYSTEM_PATH_1_0",       "")
        .env("WINE_GST_REGISTRY_DIRECTORY",
             format!("{}/gstreamer-cache", game.prefix_path))

        // ── Video / GPU ───────────────────────────────────────────
        .env("WINE_GST_VULKAN_NO_ZERO_COPY",     "1")  // Fix video hitam Ryzen APU
        .env("DXVK_ASYNC",                       "1")  // Shader compile async
        .env("DXVK_STATE_CACHE",                 "1")  // Cache shader antar session
        .env("VKD3D_SHADER_CACHE_PATH",          &game.prefix_path)
        .env("PROTON_USE_WINED3D",               "0")  // Pastikan DXVK/VKD3D aktif

        // ── Sinkronisasi ──────────────────────────────────────────
        .env("PROTON_USE_FSYNC",                 "1")
        .env("WINE_LARGE_ADDRESS_AWARE",         "1")

        // ── Log suppression (kurangi noise terminal) ──────────────
        .env("WINEDEBUG",      "-all")
        .env("DXVK_LOG_LEVEL", "none")
        .env("LC_ALL",         "C");

    // 6. Flag opsional per game
    if game.use_ntsync && PathBuf::from("/dev/ntsync").exists() {
        cmd.env("PROTON_USE_NTSYNC", "1");
    }
    if game.use_antilag {
        cmd.env("ENABLE_LAYER_MESA_ANTI_LAG", "1");
    }
    if game.use_ace {
        // ACE Anti-Cheat: matikan esync, override lsteamclient
        cmd.env("WINEDLLOVERRIDES", "lsteamclient=d;winedbg=")
           .env("PROTON_NO_ESYNC", "1");
    }

    // 7. Spawn proses
    let child = cmd.spawn()
        .map_err(|e| format!("Gagal start game. Error: {}", e))?;

    // 8. Simpan handle untuk tombol STOP
    let game_name = game.name.clone();
    let procs_arc = Arc::clone(&state.procs);
    procs_arc.lock().unwrap().insert(game_name.clone(), child);

    // 9. Thread monitor: deteksi saat game tutup → emit event ke frontend
    std::thread::spawn(move || {
        loop {
            // Sleep DULU baru cek → hindari CPU spin loop saat baru launch
            std::thread::sleep(std::time::Duration::from_secs(2));
            let mut procs = procs_arc.lock().unwrap();
            if let Some(child_proc) = procs.get_mut(&game_name) {
                if let Ok(Some(_)) = child_proc.try_wait() {
                    procs.remove(&game_name);
                    let _ = app_handle.emit("game-status", (&game_name, "READY"));
                    break;
                }
            } else {
                // Sudah di-kill manual via tombol STOP
                let _ = app_handle.emit("game-status", (&game_name, "READY"));
                break;
            }
        }
    });

    Ok(format!("Launched: {} (steam: {})", game.name, steam_path))
}

#[tauri::command]
fn kill_game(name: String, prefix_path: String, state: State<AppState>) -> Result<(), String> {
    // Kill proses utama (gamemoderun/proton)
    let mut procs = state.procs.lock().unwrap();
    if let Some(mut child) = procs.remove(&name) {
        let _ = child.kill();
    }
    drop(procs);

    // Kill Wine server di prefix ini agar semua proses Wine ikut mati
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
        .map_err(|_| {
            "winetricks tidak terinstall.\nInstall: sudo pacman -S winetricks\natau: sudo apt install winetricks".to_string()
        })?;
    Ok(())
}

#[tauri::command]
fn save_config(config: AppConfig) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Gagal serialize config: {}", e))?;
    fs::write(config_path(), json)
        .map_err(|e| format!("Gagal simpan config: {}", e))
}

#[tauri::command]
fn load_config() -> Result<AppConfig, String> {
    let path = config_path();
    let data = fs::read_to_string(&path)
        .unwrap_or_else(|_| r#"{"proton_root":"","games":[]}"#.into());
    // Gunakan unwrap_or_default agar tidak crash jika JSON corrupt
    serde_json::from_str(&data)
        .map_err(|e| format!("Config corrupt: {}. Reset dengan hapus {}", e, path.display()))
}

#[tauri::command]
fn check_system_health() -> HashMap<String, serde_json::Value> {
    let mut h: HashMap<String, serde_json::Value> = HashMap::new();

    // Kernel NTSync support
    h.insert("ntsync".into(),     PathBuf::from("/dev/ntsync").exists().into());
    // GameMode daemon
    h.insert("gamemode".into(),   cmd_exists("gamemoderun").into());
    // steam-run (opsional, tidak dipakai launcher ini)
    h.insert("steam_run".into(),  cmd_exists("steam-run").into());
    // Vulkan (diperlukan DXVK/VKD3D)
    let vulkan_ok = Command::new("vulkaninfo")
        .arg("--summary").output()
        .map(|o| o.status.success()).unwrap_or(false);
    h.insert("vulkan".into(), vulkan_ok.into());
    // Steam path
    let sp = find_steam_path();
    h.insert("steam_path".into(),  sp.clone().into());
    h.insert("steam_valid".into(), PathBuf::from(&sp).join("steamapps").exists().into());

    h
}

// ─── Main ─────────────────────────────────────────────────────────────────────

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