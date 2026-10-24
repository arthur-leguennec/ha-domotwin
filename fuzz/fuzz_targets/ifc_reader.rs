//! The IFC import must never panic, whatever the bytes: reading, listing storeys, converting.

#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    if let Ok(file) = domotwin_ifc::IfcFile::read(data.to_vec()) {
        for storey in file.storeys() {
            let _ = file.convert(storey.id);
        }
    }
});
