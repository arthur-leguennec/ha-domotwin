//! The 3D model import must never panic, whatever the bytes: the first byte picks the format, the
//! rest is the file; a file read is encoded with a picture given and decoded by the engine's
//! reader, which must accept what the import writes.

#![no_main]

use domotwin_models::{Format, Model};
use libfuzzer_sys::fuzz_target;

const FORMATS: [Format; 5] = [
    Format::Glb,
    Format::Gltf,
    Format::Obj,
    Format::Stl,
    Format::ThreeMf,
];

fuzz_target!(|data: &[u8]| {
    let Some((first, file)) = data.split_first() else {
        return;
    };
    let format = FORMATS[usize::from(*first) % FORMATS.len()];
    if let Ok(mut model) = Model::read(file, format) {
        let _ = model.size();
        for i in 0..model.images.len() {
            model.set_image(i, 2, 1, vec![10, 20, 30, 255, 200, 100, 50, 255]);
        }
        let mesh = model.encode();
        assert!(domotwin_core::model_mesh::ModelMesh::decode(&mesh).is_ok());
    }
});
