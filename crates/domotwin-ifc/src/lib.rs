//! DomoTwin's IFC import (ISO 16739, `DECISIONS.md` D-009): reads an IFC file (IFC2x3, IFC4,
//! IFC4.3 subsets), lists its storeys and converts one into a DomoTwin plan. It is built as its
//! own WebAssembly module, which the frontend loads only to import a `.ifc` file.

#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]

pub mod convert;
mod kinds;
pub mod math;
pub mod model;
pub mod step;
mod upkeep;
mod web;

pub use convert::{Report, Storey};

use model::Model;
use step::{StepError, StepFile};

/// An IFC file, read and indexed.
#[derive(Debug)]
pub struct IfcFile {
    model: Model,
}

impl IfcFile {
    /// Reads a file.
    ///
    /// # Errors
    ///
    /// A stable code: `not_ifc` (not a STEP file, or no `IfcProject`), `too_large`,
    /// `no_storeys`.
    pub fn read(bytes: Vec<u8>) -> Result<Self, &'static str> {
        let step = StepFile::new(bytes).map_err(|e| match e {
            StepError::NotStep => "not_ifc",
            StepError::TooLarge => "too_large",
        })?;
        if step.of_type("IFCPROJECT").is_empty() {
            return Err("not_ifc");
        }
        if step.of_type("IFCBUILDINGSTOREY").is_empty() {
            return Err("no_storeys");
        }
        Ok(IfcFile {
            model: Model::new(step),
        })
    }

    /// The schema named by the file (`IFC4`, `IFC2X3`…).
    pub fn schema(&self) -> &str {
        &self.model.step.schema
    }

    /// The storeys, lowest first.
    pub fn storeys(&self) -> Vec<Storey> {
        convert::storeys(&self.model)
    }

    /// The plan of one storey (by its instance number), what was left out, and the upkeep cards
    /// of its pieces from what the file says of them (`DECISIONS.md`, D-033), by piece id.
    ///
    /// # Errors
    ///
    /// `no_storeys` for an unknown storey, `no_spaces` when it has no space with an outline.
    pub fn convert(
        &self,
        storey: u32,
    ) -> Result<
        (
            serde_json::Value,
            Report,
            serde_json::Map<String, serde_json::Value>,
        ),
        &'static str,
    > {
        if self.model.step.type_of(storey) != Some("IFCBUILDINGSTOREY") {
            return Err("no_storeys");
        }
        convert::convert(&self.model, storey)
    }
}
