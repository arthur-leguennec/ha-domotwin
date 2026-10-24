//! The WebAssembly API, used by the frontend to show a plan's 3D files and to import one.

use serde_json::json;
use wasm_bindgen::prelude::*;

use crate::{Error, Format, Model};

fn error(e: Error) -> JsError {
    JsError::new(&json!({ "code": e.code() }).to_string())
}

/// A 3D file being read.
#[wasm_bindgen]
#[derive(Debug)]
pub struct ModelFile {
    model: Model,
    format: Format,
}

#[wasm_bindgen]
impl ModelFile {
    /// Reads a file of a format (`glb`, `gltf`, `obj`, `stl`, `3mf`). Errors are JSON
    /// `{"code"}`: `not_model`, `too_large`, `too_many_triangles`, `too_many_meshes`,
    /// `external_reference`, `unsupported`, `no_geometry`, `image_too_large`.
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: &[u8], format: &str) -> Result<ModelFile, JsError> {
        console_error_panic_hook::set_once();
        let format = Format::from_name(format).ok_or_else(|| error(Error::NotModel))?;
        Model::read(bytes, format)
            .map(|model| ModelFile { model, format })
            .map_err(error)
    }

    /// What the file holds, as JSON `{"triangles", "size": [x, y, z], "unit", "up", "images",
    /// "colors"}`: the size of its box in its own unit (`unit`: `mm`, `cm`, `m`, `in`, `ft`, `um`,
    /// or null when the format does not say), the axis that usually points up for the format, and
    /// whether it has colours of its own.
    pub fn info(&self) -> String {
        let size = self.model.size().map(f64::from);
        json!({
            "triangles": self.model.triangles,
            "size": size,
            "unit": self.model.unit.map(crate::Unit::name),
            "up": self.format.up().to_string(),
            "images": self.model.images.len(),
            "colors": self.model.mesh.finishes.iter().any(|f| *f != crate::Finish::Piece),
        })
        .to_string()
    }

    /// Number of pictures to decode.
    #[wasm_bindgen(js_name = imageCount)]
    pub fn image_count(&self) -> usize {
        self.model.images.len()
    }

    /// The encoded picture `index`.
    #[wasm_bindgen(js_name = imageBytes)]
    pub fn image_bytes(&self, index: usize) -> Vec<u8> {
        self.model
            .images
            .get(index)
            .map(|i| i.bytes.clone())
            .unwrap_or_default()
    }

    /// The media type of picture `index`.
    #[wasm_bindgen(js_name = imageType)]
    pub fn image_type(&self, index: usize) -> String {
        self.model
            .images
            .get(index)
            .map_or_else(String::new, |i| i.mime.to_owned())
    }

    /// Gives the decoded pixels of picture `index` (RGBA rows, top first, any size).
    #[wasm_bindgen(js_name = setImage)]
    pub fn set_image(&mut self, index: usize, width: usize, height: usize, rgba: Vec<u8>) {
        self.model.set_image(index, width, height, rgba);
    }

    /// The mesh for the engine (`DTM1`).
    pub fn mesh(&self) -> Vec<u8> {
        self.model.encode()
    }
}
