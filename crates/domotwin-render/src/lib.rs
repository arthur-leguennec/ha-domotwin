//! DomoTwin renderer: draws the scene built by `domotwin-core` with three-d on WebGL2.
//!
//! This crate knows about meshes, materials, cameras and passes, never about the browser or Home
//! Assistant. M0 only clears the view; the scene arrives with milestone M1.

#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]

mod quality;

use std::sync::Arc;

pub use quality::{GpuHint, QualityPreset};
pub use three_d::context::Context as GlContext;
use three_d::{ClearState, Context, CoreError, RenderTarget};

/// An sRGB colour with components in 0–1.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rgb {
    /// Red.
    pub r: f32,
    /// Green.
    pub g: f32,
    /// Blue.
    pub b: f32,
}

/// Owns the GPU resources of one view. One per canvas.
#[derive(Debug)]
pub struct Renderer {
    context: Context,
    width: u32,
    height: u32,
    background: Rgb,
    quality: QualityPreset,
    dirty: bool,
}

impl Renderer {
    /// Creates the renderer on an existing WebGL2 context.
    ///
    /// # Errors
    ///
    /// Fails when the context does not support what the renderer needs.
    pub fn new(gl: Arc<GlContext>, width: u32, height: u32) -> Result<Self, CoreError> {
        let context = Context::from_gl_context(gl)?;
        Ok(Self {
            context,
            width: width.max(1),
            height: height.max(1),
            background: Rgb {
                r: 0.95,
                g: 0.95,
                b: 0.94,
            },
            quality: QualityPreset::Balanced,
            dirty: true,
        })
    }

    /// Sets the drawing buffer size in device pixels.
    pub fn resize(&mut self, width: u32, height: u32) {
        let (width, height) = (width.max(1), height.max(1));
        if (width, height) != (self.width, self.height) {
            self.width = width;
            self.height = height;
            self.dirty = true;
        }
    }

    /// Sets the colour behind the scene (from the Home Assistant theme).
    pub fn set_background(&mut self, background: Rgb) {
        if background != self.background {
            self.background = background;
            self.dirty = true;
        }
    }

    /// The active quality preset.
    pub const fn quality(&self) -> QualityPreset {
        self.quality
    }

    /// Changes the quality preset.
    pub fn set_quality(&mut self, quality: QualityPreset) {
        if quality != self.quality {
            self.quality = quality;
            self.dirty = true;
        }
    }

    /// Asks for a new frame even though nothing changed (benchmarks, context restore).
    pub fn invalidate(&mut self) {
        self.dirty = true;
    }

    /// Whether something changed since the last frame.
    pub const fn is_dirty(&self) -> bool {
        self.dirty
    }

    /// Draws one frame. Returns `true` when another frame is needed (an animation is running).
    pub fn render(&mut self, _time_ms: f64) -> bool {
        let Rgb { r, g, b } = self.background;
        RenderTarget::screen(&self.context, self.width, self.height)
            .clear(ClearState::color_and_depth(r, g, b, 1.0, 1.0));
        self.dirty = false;
        false
    }
}
