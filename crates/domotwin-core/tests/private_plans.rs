//! Reads every `*.plan.json` placed in the repository's `private/` folder (ignored by git), so that
//! contributors can check their own plans locally. Nothing to do when the folder is empty.

#![allow(clippy::unwrap_used, clippy::panic)]

use std::path::Path;

use domotwin_core::read_plan;

#[test]
fn private_plans_read() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../private");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.to_string_lossy().ends_with(".plan.json") {
            continue;
        }
        let bytes = std::fs::read(&path).unwrap();
        if let Err(err) = read_plan(&bytes) {
            panic!("{}: {err}", path.display());
        }
    }
}
