//! The plan reader and the scene builder must never panic, whatever the bytes.

#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    if let Ok(plan) = domotwin_core::read_plan(data) {
        let _ = domotwin_core::scene::build_scene(&plan, &domotwin_core::scene::SceneOptions::default());
    }
});
