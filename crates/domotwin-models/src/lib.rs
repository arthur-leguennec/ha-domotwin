//! DomoTwin's 3D model import (`DECISIONS.md`, D-013 and D-021): reads a glTF 2.0 file (binary
//! GLB, or glTF with its buffers and images embedded), an OBJ, an STL or a 3MF file into a compact
//! mesh that the engine fits into a piece of furniture. It is built as its own WebAssembly module,
//! which the frontend loads only when a plan shows a piece drawn from a 3D file, or to import one.
//!
//! Nothing here panics on input: every count, offset and index is checked, and the format's
//! limits (8 MB per file, 150 000 triangles, 5 000 meshes once nodes or components are expanded,
//! pictures up to 4 096 × 4 096 pixels, 32 MB unpacked from a 3MF archive) are enforced while
//! reading. External files and web addresses are refused.

#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]

mod base64;
mod gltf;
mod image;
pub mod mesh;
mod obj;
mod stl;
mod threemf;
#[cfg(feature = "web")]
mod web;
pub mod xml;
pub mod zip;

pub use mesh::{Finish, Mesh};

/// Largest file read (bytes).
pub const MAX_FILE_BYTES: usize = 8_000_000;
/// Most triangles read from one file.
pub const MAX_TRIANGLES: usize = 150_000;
/// Most meshes drawn once glTF nodes or 3MF components are expanded.
pub const MAX_MESHES: usize = 5_000;
/// Widest and tallest picture read (pixels).
pub const MAX_IMAGE_SIDE: u32 = 4_096;
/// Most bytes unpacked from a 3MF archive.
pub const MAX_UNPACKED: usize = 32_000_000;

/// A file format.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    /// Binary glTF 2.0.
    Glb,
    /// glTF 2.0 with its buffers and images embedded as `data:` URLs.
    Gltf,
    /// Wavefront OBJ.
    Obj,
    /// STL, binary or ASCII.
    Stl,
    /// 3D Manufacturing Format.
    ThreeMf,
}

impl Format {
    /// The format of a plan's `file.format`.
    pub fn from_name(name: &str) -> Option<Format> {
        match name {
            "glb" => Some(Format::Glb),
            "gltf" => Some(Format::Gltf),
            "obj" => Some(Format::Obj),
            "stl" => Some(Format::Stl),
            "3mf" => Some(Format::ThreeMf),
            _ => None,
        }
    }

    /// The name in plans.
    pub const fn name(self) -> &'static str {
        match self {
            Format::Glb => "glb",
            Format::Gltf => "gltf",
            Format::Obj => "obj",
            Format::Stl => "stl",
            Format::ThreeMf => "3mf",
        }
    }

    /// The axis that usually points up in files of this format: `y` for glTF and OBJ, `z` for
    /// STL and 3MF.
    pub const fn up(self) -> char {
        match self {
            Format::Glb | Format::Gltf | Format::Obj => 'y',
            Format::Stl | Format::ThreeMf => 'z',
        }
    }
}

/// Why a file was refused. The codes are stable: the frontend translates them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    /// Not a file of the format, or its structure is invalid.
    NotModel,
    /// Larger than 8 MB, or unpacks to more than 32 MB.
    TooLarge,
    /// More than 150 000 triangles.
    TooManyTriangles,
    /// More than 5 000 meshes once nodes or components are expanded.
    TooManyMeshes,
    /// Needs another file or a web address.
    ExternalReference,
    /// Uses a feature this reader does not have (compressed meshes, glTF 1…).
    Unsupported,
    /// Holds no triangle.
    NoGeometry,
    /// A picture larger than 4 096 × 4 096 pixels.
    ImageTooLarge,
}

impl Error {
    /// The stable code.
    pub const fn code(self) -> &'static str {
        match self {
            Error::NotModel => "not_model",
            Error::TooLarge => "too_large",
            Error::TooManyTriangles => "too_many_triangles",
            Error::TooManyMeshes => "too_many_meshes",
            Error::ExternalReference => "external_reference",
            Error::Unsupported => "unsupported",
            Error::NoGeometry => "no_geometry",
            Error::ImageTooLarge => "image_too_large",
        }
    }
}

/// The length unit a file declares.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unit {
    /// Micrometre.
    Micron,
    /// Millimetre.
    Millimeter,
    /// Centimetre.
    Centimeter,
    /// Metre.
    Meter,
    /// Inch.
    Inch,
    /// Foot.
    Foot,
}

impl Unit {
    /// The name the frontend shows a choice for.
    pub const fn name(self) -> &'static str {
        match self {
            Unit::Micron => "um",
            Unit::Millimeter => "mm",
            Unit::Centimeter => "cm",
            Unit::Meter => "m",
            Unit::Inch => "in",
            Unit::Foot => "ft",
        }
    }
}

/// A picture a material is painted with, to be decoded by the browser.
#[derive(Debug, Clone, PartialEq)]
pub struct Image {
    /// `image/png` or `image/jpeg`.
    pub mime: &'static str,
    /// The encoded picture.
    pub bytes: Vec<u8>,
    /// Size from its header (pixels).
    pub width: u32,
    /// Size from its header (pixels).
    pub height: u32,
    /// The decoded pixels (RGBA, maybe scaled down), once given.
    decoded: Option<Pixels>,
}

#[derive(Debug, Clone, PartialEq)]
struct Pixels {
    width: usize,
    height: usize,
    rgba: Vec<u8>,
}

/// A vertex whose colour comes from a picture: sampled once the picture is decoded.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Textured {
    pub(crate) vertex: u32,
    pub(crate) image: u32,
    pub(crate) uv: [f32; 2],
    /// The material's colour factor (and vertex colour), linear.
    pub(crate) factor: [f32; 3],
}

/// A file read: its geometry with the colours of its materials, and the pictures still to decode.
#[derive(Debug, Clone, PartialEq)]
pub struct Model {
    /// The mesh, in the file's own axes and unit.
    pub mesh: Mesh,
    /// The unit the file declares, when it does.
    pub unit: Option<Unit>,
    /// Pictures of the materials.
    pub images: Vec<Image>,
    /// Number of triangles in the file (double-sided faces count once).
    pub triangles: usize,
    textured: Vec<Textured>,
}

impl Model {
    /// Reads a file.
    ///
    /// # Errors
    ///
    /// Why it was refused.
    pub fn read(bytes: &[u8], format: Format) -> Result<Model, Error> {
        if bytes.len() > MAX_FILE_BYTES {
            return Err(Error::TooLarge);
        }
        let model = match format {
            Format::Glb => gltf::read_glb(bytes)?,
            Format::Gltf => gltf::read_gltf(bytes)?,
            Format::Obj => obj::read(bytes)?,
            Format::Stl => stl::read(bytes)?,
            Format::ThreeMf => threemf::read(bytes)?,
        };
        if model.mesh.indices.is_empty() {
            return Err(Error::NoGeometry);
        }
        Ok(model)
    }

    pub(crate) fn new(
        mesh: Mesh,
        unit: Option<Unit>,
        images: Vec<Image>,
        textured: Vec<Textured>,
        triangles: usize,
    ) -> Self {
        Self {
            mesh,
            unit,
            images,
            triangles,
            textured,
        }
    }

    /// Size of the bounding box along the file's axes, in its unit.
    pub fn size(&self) -> [f32; 3] {
        let [min, max] = self.mesh.bounds();
        [0, 1, 2].map(|k| max[k] - min[k])
    }

    /// Gives the decoded pixels of picture `index` (RGBA rows, top first). Ignored when the size
    /// does not match the pixels.
    pub fn set_image(&mut self, index: usize, width: usize, height: usize, rgba: Vec<u8>) {
        let Some(image) = self.images.get_mut(index) else {
            return;
        };
        if width == 0
            || height == 0
            || width.checked_mul(height).and_then(|n| n.checked_mul(4)) != Some(rgba.len())
        {
            return;
        }
        image.decoded = Some(Pixels {
            width,
            height,
            rgba,
        });
    }

    /// The mesh with the pictures sampled at its vertices (pictures not given keep the colour of
    /// their material), encoded for the engine.
    pub fn encode(&self) -> Vec<u8> {
        let mut mesh = self.mesh.clone();
        for t in &self.textured {
            let Some(pixels) = self
                .images
                .get(t.image as usize)
                .and_then(|i| i.decoded.as_ref())
            else {
                continue;
            };
            let texel = sample(pixels, t.uv);
            let linear = [0, 1, 2].map(|k| t.factor[k] * mesh::to_linear(texel[k]));
            if let Some(color) = mesh.colors.get_mut(t.vertex as usize) {
                *color = linear.map(mesh::to_srgb);
            }
        }
        mesh.encode()
    }
}

/// The texel at `uv` (repeating), nearest.
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::cast_precision_loss
)]
fn sample(pixels: &Pixels, uv: [f32; 2]) -> [u8; 3] {
    let wrap = |c: f32| {
        if c.is_finite() { c - c.floor() } else { 0.0 }
    };
    let x = ((wrap(uv[0]) * pixels.width as f32) as usize).min(pixels.width - 1);
    let y = ((wrap(uv[1]) * pixels.height as f32) as usize).min(pixels.height - 1);
    let at = (y * pixels.width + x) * 4;
    match pixels.rgba.get(at..at + 3) {
        Some(&[r, g, b]) => [r, g, b],
        _ => [255, 255, 255],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_and_codes() {
        for name in ["glb", "gltf", "obj", "stl", "3mf"] {
            assert_eq!(Format::from_name(name).map(Format::name), Some(name));
        }
        assert_eq!(Format::from_name("fbx"), None);
        assert_eq!(Format::Stl.up(), 'z');
        assert_eq!(Format::Glb.up(), 'y');
        assert_eq!(Error::TooManyTriangles.code(), "too_many_triangles");
        assert_eq!(
            Model::read(&vec![0; MAX_FILE_BYTES + 1], Format::Stl),
            Err(Error::TooLarge)
        );
    }

    #[test]
    fn samples_wrap() {
        let pixels = Pixels {
            width: 2,
            height: 1,
            rgba: vec![10, 20, 30, 255, 200, 210, 220, 255],
        };
        assert_eq!(sample(&pixels, [0.25, 0.5]), [10, 20, 30]);
        assert_eq!(sample(&pixels, [0.75, 0.5]), [200, 210, 220]);
        assert_eq!(sample(&pixels, [1.25, -0.5]), [10, 20, 30]);
        assert_eq!(sample(&pixels, [f32::NAN, 0.0]), [10, 20, 30]);
    }
}
