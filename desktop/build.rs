fn main() {
    // the recording commands the page may call; each gets an "allow-<name>" permission listed in capabilities/
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["record_start", "record_pause", "record_level", "record_stop", "quit_now"]),
    ))
    .expect("tauri build step failed");
}
