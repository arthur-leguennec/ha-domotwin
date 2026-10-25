//! DomoTwin's plan import (`DECISIONS.md` D-009, D-040): reads a file of another app, lists its
//! storeys and converts one into a DomoTwin plan. IFC files (ISO 16739: IFC2x3, IFC4, IFC4.3
//! subsets), Sweet Home 3D homes, DXF drawings and room scans (RoomPlan's USDZ or JSON); each
//! reader gives the plan builder (`build`) a draft. It is built as its own WebAssembly module,
//! which the frontend loads only to import a file.

#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]

pub mod build;
pub mod convert;
pub mod dxf;
mod faces;
mod kinds;
pub mod math;
pub mod model;
pub mod scan;
pub mod sh3d;
pub mod step;
mod upkeep;
mod usda;
mod web;

pub use build::Report;
pub use convert::Storey;

use dxf::DxfFile;
use scan::ScanFile;
use sh3d::Sh3dFile;

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

/// A file of another app, read: the format is found from its content.
#[derive(Debug)]
pub enum PlanFile {
    Ifc(Box<IfcFile>),
    Sh3d(Sh3dFile),
    Dxf(DxfFile),
    Scan(ScanFile),
}

impl PlanFile {
    /// Reads a file; `title` names the plan when the file does not (the file's name).
    ///
    /// # Errors
    ///
    /// A stable code: `not_plan` (no format known), `too_large`, `no_storeys`, `not_ifc`,
    /// `sh3d_old` (saved before Sweet Home 3D 5.3), `dxf_binary`, `scan_usdz` (a scan's root layer
    /// alone, without the elements its USDZ holds), `scan_usdc` (a scan in USD's binary format).
    pub fn read(bytes: Vec<u8>, title: &str) -> Result<Self, &'static str> {
        let start = &bytes[..bytes.len().min(512)];
        let text = String::from_utf8_lossy(start);
        let trimmed = text.trim_start_matches('\u{feff}').trim_start();
        if step::is_step(&bytes) {
            return IfcFile::read(bytes).map(|f| PlanFile::Ifc(Box::new(f)));
        }
        if bytes.starts_with(b"PK\x03\x04") {
            // A Sweet Home 3D home, else a scan's USDZ.
            return match Sh3dFile::read(&bytes, title) {
                Err("not_plan") => ScanFile::from_usdz(&bytes, title).map(PlanFile::Scan),
                read => read.map(PlanFile::Sh3d),
            };
        }
        if trimmed.starts_with('{') {
            return ScanFile::from_json(&bytes, title).map(PlanFile::Scan);
        }
        if trimmed.starts_with("#usda") {
            return Err("scan_usdz");
        }
        if bytes.starts_with(b"PXR-USDC") {
            return Err("scan_usdc");
        }
        if bytes.starts_with(b"AutoCAD Binary DXF") {
            return Err("dxf_binary");
        }
        let mut lines = trimmed.lines().map(str::trim);
        // Past the comments (`999`) some apps write first.
        let mut code = lines.next();
        while code == Some("999") {
            lines.next();
            code = lines.next();
        }
        if code == Some("0") && lines.next() == Some("SECTION") {
            return DxfFile::read(&bytes, title).map(PlanFile::Dxf);
        }
        Err("not_plan")
    }

    /// The format: `ifc`, `sh3d`, `dxf` or `scan`.
    pub fn format(&self) -> &'static str {
        match self {
            PlanFile::Ifc(_) => "ifc",
            PlanFile::Sh3d(_) => "sh3d",
            PlanFile::Dxf(_) => "dxf",
            PlanFile::Scan(_) => "scan",
        }
    }

    /// The storeys, lowest first.
    pub fn storeys(&self) -> Vec<Storey> {
        match self {
            PlanFile::Ifc(f) => f.storeys(),
            PlanFile::Sh3d(f) => f.storeys(),
            PlanFile::Dxf(f) => f.storeys(),
            PlanFile::Scan(f) => f.storeys(),
        }
    }

    /// The plan of a storey, what was left out, and the upkeep cards the file fills by piece id.
    ///
    /// # Errors
    ///
    /// `no_storeys` for an unknown storey, `no_spaces` when it has no room.
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
        match self {
            PlanFile::Ifc(f) => f.convert(storey),
            PlanFile::Sh3d(f) => f.convert(storey),
            PlanFile::Dxf(f) => f.convert(storey),
            PlanFile::Scan(f) => f.convert(storey),
        }
    }
}
