//! The plan reader must never panic, whatever the bytes.

#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let _ = domotwin_core::summarize_plan(data);
});
