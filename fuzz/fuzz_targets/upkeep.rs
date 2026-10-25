//! Working out where upkeep cards stand must never panic, whatever the JSON and the date.

#![no_main]

use domotwin_core::upkeep::{Date, states};
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    // The first ten bytes are the day, the rest the cards.
    let (day, cards) = data.split_at(data.len().min(10));
    let today = std::str::from_utf8(day)
        .ok()
        .and_then(Date::parse)
        .unwrap_or_else(|| Date::from_days(i64::from(day.first().copied().unwrap_or(0)) * 997));
    if let Ok(value) = serde_json::from_slice::<serde_json::Value>(cards) {
        let out = states(&value, today);
        assert!(out.is_object());
    }
});
