//! Reading an automation's configuration must never panic, whatever the JSON.

#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    if let Ok(value) = serde_json::from_slice::<serde_json::Value>(data) {
        let automation = domotwin_core::automation::Automation::read(&value);
        assert!(automation.ends.len() <= domotwin_core::automation::MAX_ENDS);
    }
});
