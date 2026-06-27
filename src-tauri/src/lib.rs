use serde::Serialize;
use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use tauri::command;
use tauri_plugin_dialog::DialogExt;
use zip::write::FileOptions;
use zip::ZipWriter;

fn mc_dir() -> String {
    if cfg!(target_os = "windows") {
        let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
        format!("{}\\.minecraft", base)
    } else if cfg!(target_os = "macos") {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        format!("{}/Library/Application Support/minecraft", home)
    } else {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        format!("{}/.minecraft", home)
    }
}

#[derive(Serialize)]
struct ModEntry {
    name: String,
    size_kb: u64,
    is_jar: bool,
    enabled: bool,
    filename: String,
}

#[derive(Serialize)]
struct PackEntry {
    name: String,
    size_kb: u64,
    enabled: bool,
    filename: String,
}

#[derive(Serialize)]
struct VersionEntry {
    name: String,
    entry_type: String,
}

#[derive(Serialize)]
struct ProfileInfo {
    name: String,
    last_version: String,
    type_name: String,
    icon: String,
}

#[derive(Serialize)]
struct McData {
    mods: Vec<ModEntry>,
    resourcepacks: Vec<PackEntry>,
    shaders: Vec<PackEntry>,
    versions: Vec<VersionEntry>,
    profiles: Vec<ProfileInfo>,
}

fn format_size(path: &Path) -> u64 {
    fs::metadata(path).map(|m| m.len() / 1024).unwrap_or(0)
}

fn is_disabled(name: &str) -> bool {
    name.ends_with(".disabled")
}

fn display_name(name: &str) -> String {
    if let Some(stripped) = name.strip_suffix(".disabled") {
        stripped.to_string()
    } else {
        name.to_string()
    }
}

fn ensure_dir(path: &Path) {
    fs::create_dir_all(path).ok();
}

fn scan_mods(mods_dir: &Path) -> Vec<ModEntry> {
    let mut mods = Vec::new();
    if !mods_dir.exists() { return mods; }
    if let Ok(entries) = fs::read_dir(mods_dir) {
        for e in entries.flatten() {
            let p = e.path();
            let raw = e.file_name().to_string_lossy().to_string();
            if !raw.ends_with(".jar") && !raw.ends_with(".jar.disabled") { continue; }
            let enabled = !is_disabled(&raw);
            mods.push(ModEntry {
                name: display_name(&raw),
                size_kb: format_size(&p),
                is_jar: true,
                enabled,
                filename: raw,
            });
        }
    }
    mods.sort_by(|a, b| b.enabled.cmp(&a.enabled).then(a.name.cmp(&b.name)));
    mods
}

fn scan_packs(dir: &Path) -> Vec<PackEntry> {
    let mut packs = Vec::new();
    if !dir.exists() { return packs; }
    if let Ok(entries) = fs::read_dir(dir) {
        for e in entries.flatten() {
            let p = e.path();
            let raw = e.file_name().to_string_lossy().to_string();
            let is_dir = p.is_dir();
            if !is_dir && !raw.ends_with(".zip") && !raw.ends_with(".zip.disabled") { continue; }
            let enabled = !is_disabled(&raw);
            packs.push(PackEntry {
                name: display_name(&raw),
                size_kb: format_size(&p),
                enabled,
                filename: raw,
            });
        }
    }
    packs.sort_by(|a, b| b.enabled.cmp(&a.enabled).then(a.name.cmp(&b.name)));
    packs
}

fn toggle_item(base: &Path, filename: &str) -> Result<(), String> {
    let src = base.join(filename);
    let dst = if is_disabled(filename) {
        let new_name = filename.strip_suffix(".disabled").unwrap();
        base.join(new_name)
    } else {
        base.join(format!("{}.disabled", filename))
    };
    fs::rename(&src, &dst).map_err(|e| format!("Failed to toggle: {}", e))
}

fn delete_item(base: &Path, filename: &str) -> Result<(), String> {
    let path = base.join(filename);
    if path.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| format!("Failed to delete: {}", e))
    } else {
        fs::remove_file(&path).map_err(|e| format!("Failed to delete: {}", e))
    }
}

fn copy_file(src: &Path, dest_dir: &Path) -> Result<(), String> {
    ensure_dir(dest_dir);
    let name = src.file_name().ok_or("Invalid file")?.to_string_lossy();
    let dest = dest_dir.join(name.as_ref());
    fs::copy(src, &dest).map_err(|e| format!("Failed to copy: {}", e))?;
    Ok(())
}

#[command]
fn scan() -> McData {
    let mc_dir = mc_dir();
    let mc = Path::new(&mc_dir);
    McData {
        mods: scan_mods(&mc.join("mods")),
        resourcepacks: scan_packs(&mc.join("resourcepacks")),
        shaders: scan_packs(&mc.join("shaderpacks")),
        versions: {
            let mut v = Vec::new();
            let ver_dir = mc.join("versions");
            if ver_dir.exists() {
                if let Ok(entries) = fs::read_dir(&ver_dir) {
                    for e in entries.flatten() {
                        let p = e.path();
                        if !p.is_dir() { continue; }
                        let name = e.file_name().to_string_lossy().to_string();
                        if p.join(format!("{name}.json")).exists() {
                            let entry_type = if name.contains("forge") || name.contains("fabric") || name.contains("neoforge") || name.contains("quilt") { "modded" } else { "vanilla" };
                            v.push(VersionEntry { name, entry_type: entry_type.to_string() });
                        }
                    }
                }
            }
            v
        },
        profiles: {
            let mut p = Vec::new();
            let pf = mc.join("launcher_profiles.json");
            if pf.exists() {
                if let Ok(content) = fs::read_to_string(&pf) {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                        if let Some(profs) = json.get("profiles").and_then(|x| x.as_object()) {
                            for (name, data) in profs {
                                let lv = data.get("lastVersionId").and_then(|v| v.as_str()).unwrap_or("unknown");
                                let tn = data.get("type").and_then(|v| v.as_str()).unwrap_or("custom");
                                let ic = data.get("icon").and_then(|v| v.as_str()).unwrap_or("");
                                p.push(ProfileInfo { name: name.clone(), last_version: lv.to_string(), type_name: tn.to_string(), icon: ic.to_string() });
                            }
                        }
                    }
                }
            }
            p
        },
    }
}

#[command]
fn toggle_mod(name: String) -> Result<(), String> {
    toggle_item(&Path::new(&mc_dir()).join("mods"), &name)
}

#[command]
fn delete_mod(name: String) -> Result<(), String> {
    delete_item(&Path::new(&mc_dir()).join("mods"), &name)
}

#[command]
fn toggle_resourcepack(name: String) -> Result<(), String> {
    toggle_item(&Path::new(&mc_dir()).join("resourcepacks"), &name)
}

#[command]
fn delete_resourcepack(name: String) -> Result<(), String> {
    delete_item(&Path::new(&mc_dir()).join("resourcepacks"), &name)
}

#[command]
fn toggle_shader(name: String) -> Result<(), String> {
    toggle_item(&Path::new(&mc_dir()).join("shaderpacks"), &name)
}

#[command]
fn delete_shader(name: String) -> Result<(), String> {
    delete_item(&Path::new(&mc_dir()).join("shaderpacks"), &name)
}

#[command]
async fn import_mod(app: tauri::AppHandle) -> Result<(), String> {
    let files = app.dialog()
        .file()
        .add_filter("Mods", &["jar"])
        .blocking_pick_files();
    if let Some(paths) = files {
        let dest = Path::new(&mc_dir()).join("mods");
        for p in paths {
            if let Some(src_path) = p.as_path() {
                copy_file(src_path, &dest)?;
            }
        }
    }
    Ok(())
}

#[command]
async fn import_resourcepack(app: tauri::AppHandle) -> Result<(), String> {
    let files = app.dialog()
        .file()
        .add_filter("Packs", &["zip"])
        .blocking_pick_files();
    if let Some(paths) = files {
        let dest = Path::new(&mc_dir()).join("resourcepacks");
        for p in paths {
            if let Some(src_path) = p.as_path() {
                copy_file(src_path, &dest)?;
            }
        }
    }
    Ok(())
}

#[command]
async fn import_shader(app: tauri::AppHandle) -> Result<(), String> {
    let files = app.dialog()
        .file()
        .add_filter("Shaders", &["zip"])
        .blocking_pick_files();
    if let Some(paths) = files {
        let dest = Path::new(&mc_dir()).join("shaderpacks");
        for p in paths {
            if let Some(src_path) = p.as_path() {
                copy_file(src_path, &dest)?;
            }
        }
    }
    Ok(())
}

#[command]
async fn import_file(path: String, kind: String) -> Result<(), String> {
    let src = Path::new(&path);
    let dest_dir = match kind.as_str() {
        "mods" => Path::new(&mc_dir()).join("mods"),
        "resourcepacks" => Path::new(&mc_dir()).join("resourcepacks"),
        "shaders" => Path::new(&mc_dir()).join("shaderpacks"),
        _ => return Err("Invalid kind".to_string()),
    };
    copy_file(src, &dest_dir)
}

#[command]
fn open_folder(kind: String) -> Result<(), String> {
    let path = match kind.as_str() {
        "mods" => Path::new(&mc_dir()).join("mods"),
        "resourcepacks" => Path::new(&mc_dir()).join("resourcepacks"),
        "shaders" => Path::new(&mc_dir()).join("shaderpacks"),
        "versions" => Path::new(&mc_dir()).join("versions"),
        _ => Path::new(&mc_dir()).to_path_buf(),
    };
    let opener = if cfg!(target_os = "windows") { "explorer" }
        else if cfg!(target_os = "macos") { "open" }
        else { "xdg-open" };
    std::process::Command::new(opener)
        .arg(path.to_string_lossy().as_ref())
        .spawn()
        .map_err(|e| format!("Failed to open folder: {}", e))?;
    Ok(())
}

#[command]
async fn export_brushpack(app: tauri::AppHandle) -> Result<(), String> {
    let file = app.dialog()
        .file()
        .add_filter("Brushpack", &["brushpack"])
        .set_file_name("my-modpack.brushpack")
        .blocking_save_file();
    let Some(fpath) = file else { return Ok(()); };
    let Some(path) = fpath.as_path() else { return Ok(()); };

    let f = fs::File::create(path).map_err(|e| e.to_string())?;
    let mut zip = ZipWriter::new(f);
    let opts = FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    zip.start_file("manifest.toml", opts.clone()).map_err(|e| e.to_string())?;
    let manifest = "[meta]\nname = \"Brush Export\"\ncreated = \"2026-06-26\"\n".to_string();
    zip.write_all(manifest.as_bytes()).map_err(|e| e.to_string())?;

    let mc_str = mc_dir();
    let mc = Path::new(&mc_str);
    for subdir in &["mods", "resourcepacks", "shaderpacks", "config"] {
        let dir = mc.join(subdir);
        if !dir.exists() { continue; }
        for entry in walkdir::WalkDir::new(&dir) {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.path().is_dir() { continue; }
            let relative = entry.path().strip_prefix(&mc).map_err(|e| e.to_string())?;
            let name = relative.to_string_lossy().replace("\\", "/");
            let mut file = fs::File::open(entry.path()).map_err(|e| e.to_string())?;
            zip.start_file(&name, opts.clone()).map_err(|e| e.to_string())?;
            let mut buf = Vec::new();
            file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            zip.write_all(&buf).map_err(|e| e.to_string())?;
        }
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
async fn import_brushpack(app: tauri::AppHandle) -> Result<(), String> {
    let file = app.dialog()
        .file()
        .add_filter("Brushpack", &["brushpack"])
        .blocking_pick_file();
    let Some(fpath) = file else { return Ok(()); };
    let Some(path) = fpath.as_path() else { return Ok(()); };

    let f = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    let mc_str = mc_dir();
    let mc = Path::new(&mc_str);

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        if name.ends_with('/') { continue; }
        let dest = mc.join(&name);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out = fs::File::create(&dest).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            scan,
            toggle_mod, delete_mod, import_mod,
            toggle_resourcepack, delete_resourcepack, import_resourcepack,
            toggle_shader, delete_shader, import_shader,
            import_file, open_folder, export_brushpack, import_brushpack,
        ])
        .run(tauri::generate_context!())
        .expect("error while running brush");
}
