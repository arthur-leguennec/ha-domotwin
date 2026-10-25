//! The import of other apps' plans must never panic, whatever the bytes: finding the format,
//! reading, listing storeys, converting (IFC, Sweet Home 3D, DXF, room scans).

#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    if let Ok(file) = domotwin_import::PlanFile::read(data.to_vec(), "fuzz") {
        for storey in file.storeys() {
            let _ = file.convert(storey.id);
        }
    }
});
