//! Reads every `*.domotwin.json` placed in the repository's `private/` folder (ignored by git), so that
//! contributors can check that their own plans read and build locally. Nothing to do when the folder is empty.

#![allow(clippy::unwrap_used, clippy::panic)]

use std::path::Path;

use domotwin_core::read_plan;
use domotwin_core::scene::{SceneOptions, build_scene};

#[test]
fn private_plans_read() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../private");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.to_string_lossy().ends_with(".domotwin.json") {
            continue;
        }
        let bytes = std::fs::read(&path).unwrap();
        match read_plan(&bytes) {
            Ok(plan) => {
                let scene = build_scene(&plan, &SceneOptions::default());
                assert!(
                    scene.parts[0].opaque.triangle_count() > 0,
                    "{}",
                    path.display()
                );
            }
            Err(err) => panic!("{}: {err}", path.display()),
        }
    }
}
