//! The WebAssembly API of the import, used by the panel when a `.ifc` file is picked.

use serde_json::json;
use wasm_bindgen::prelude::*;

use crate::IfcFile;

fn error(code: &str) -> JsError {
    JsError::new(&json!({ "code": code }).to_string())
}

/// A file being imported.
#[wasm_bindgen]
#[derive(Debug)]
pub struct IfcImport {
    file: IfcFile,
}

#[wasm_bindgen]
impl IfcImport {
    /// Reads the file's bytes. Errors are JSON `{"code"}`: `not_ifc`, `too_large`, `no_storeys`.
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: Vec<u8>) -> Result<IfcImport, JsError> {
        console_error_panic_hook::set_once();
        IfcFile::read(bytes)
            .map(|file| IfcImport { file })
            .map_err(error)
    }

    /// The schema named by the file.
    pub fn schema(&self) -> String {
        self.file.schema().to_owned()
    }

    /// The storeys, lowest first, as JSON
    /// `[{"id", "name", "elevation", "spaces", "doors", "windows", "furniture"}]`.
    pub fn storeys(&self) -> String {
        let list: Vec<serde_json::Value> = self
            .file
            .storeys()
            .into_iter()
            .map(|s| {
                json!({
                    "id": s.id,
                    "name": s.name,
                    "elevation": (s.elevation * 10.0).round() / 10.0,
                    "spaces": s.spaces,
                    "doors": s.doors,
                    "windows": s.windows,
                    "furniture": s.furniture,
                })
            })
            .collect();
        serde_json::Value::Array(list).to_string()
    }

    /// The plan of a storey, what was left out and the upkeep cards the file fills (by piece
    /// id), as JSON `{"plan", "report", "upkeep"}`. Errors: `no_storeys`, `no_spaces`.
    pub fn convert(&self, storey: u32) -> Result<String, JsError> {
        let (plan, report, upkeep) = self.file.convert(storey).map_err(error)?;
        Ok(json!({
            "plan": plan,
            "upkeep": upkeep,
            "report": {
                "rooms": report.rooms,
                "doors": report.doors,
                "windows": report.windows,
                "furniture": report.furniture,
                "skippedSpaces": report.skipped_spaces,
                "unplacedOpenings": report.unplaced_openings,
                "skippedFurniture": report.skipped_furniture,
                "overLimit": report.over_limit,
            },
        })
        .to_string())
    }
}
