//! DomoTwin renderer: draws the scene built by `domotwin-core` with the core layer of three-d on
//! WebGL2 and DomoTwin's own shaders (see `docs/DECISIONS.md`, D-014).
//!
//! The whole home is two meshes (opaque, then glass and contact shadows), so a frame is a few
//! draw calls whatever the plan. Frames are drawn on demand: [`Renderer::needs_frame`] says when.

#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]

mod quality;
mod shaders;
pub mod view;

use std::sync::Arc;

use domotwin_core::camera::CutawayMode;
use domotwin_core::scene::Scene;
use domotwin_core::scene::mesh::Mesh;
pub use quality::{GpuHint, QualityPreset};
pub use three_d::context::Context as GlContext;
use three_d::{
    Blend, ClearState, Context, CoreError, Cull, DepthTest, DepthTexture2D, ElementBuffer,
    Interpolation, Mat4, Program, RenderStates, RenderTarget, ScissorBox, Texture2D, Vec3, Vec4,
    VertexBuffer, Viewport, Wrapping, WriteMask,
};
pub use view::ViewState;

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

/// One mesh on the GPU.
struct GpuMesh {
    positions: VertexBuffer<[f32; 4]>,
    normals: VertexBuffer<[i8; 4]>,
    colors: VertexBuffer<[u8; 4]>,
    extras: VertexBuffer<[u8; 4]>,
    uvs: VertexBuffer<[f32; 2]>,
    indices: ElementBuffer<u32>,
}

impl std::fmt::Debug for GpuMesh {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GpuMesh")
            .field("triangles", &(self.indices.count() / 3))
            .finish()
    }
}

impl GpuMesh {
    fn new(context: &Context, mesh: &Mesh) -> Option<Self> {
        if mesh.indices.is_empty() {
            return None;
        }
        Some(Self {
            positions: VertexBuffer::new_with_data(context, &mesh.positions),
            normals: VertexBuffer::new_with_data(context, &mesh.normals),
            colors: VertexBuffer::new_with_data(context, &mesh.colors),
            extras: VertexBuffer::new_with_data(context, &mesh.extras),
            uvs: VertexBuffer::new_with_data(context, &mesh.uvs),
            indices: ElementBuffer::new_with_data(context, &mesh.indices),
        })
    }

    /// Draws with `program`, binding only the attributes it uses.
    fn draw(&self, program: &Program, states: RenderStates, viewport: Viewport) {
        if program.requires_attribute("a_position") {
            program.use_vertex_attribute("a_position", &self.positions);
        }
        if program.requires_attribute("a_normal") {
            program.use_vertex_attribute("a_normal", &self.normals);
        }
        if program.requires_attribute("a_color") {
            program.use_vertex_attribute("a_color", &self.colors);
        }
        if program.requires_attribute("a_extra") {
            program.use_vertex_attribute("a_extra", &self.extras);
        }
        if program.requires_attribute("a_uv") {
            program.use_vertex_attribute("a_uv", &self.uvs);
        }
        program.draw_elements(states, viewport, &self.indices);
    }
}

/// A shadow map and the matrix that projects the world into it.
struct ShadowMap {
    texture: DepthTexture2D,
    matrix: [f32; 16],
    size: u32,
}

/// The offscreen target of the picking pass.
struct PickTarget {
    color: Texture2D,
    depth: DepthTexture2D,
    width: u32,
    height: u32,
}

/// Direction towards the sun: high, from the south-east of the plan.
const SUN: [f64; 3] = [0.38, 0.82, 0.43];

/// Owns the GPU resources of one view. One per canvas.
pub struct Renderer {
    context: Context,
    width: u32,
    height: u32,
    background: Rgb,
    quality: QualityPreset,
    main: Program,
    depth: Program,
    pick: Program,
    opaque: Option<GpuMesh>,
    transparent: Option<GpuMesh>,
    shadow: Option<ShadowMap>,
    pick_target: Option<PickTarget>,
    /// What the view shows and how it moves.
    pub view: ViewState,
}

impl std::fmt::Debug for Renderer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Renderer")
            .field("width", &self.width)
            .field("height", &self.height)
            .field("quality", &self.quality)
            .field("opaque", &self.opaque)
            .finish_non_exhaustive()
    }
}

#[allow(clippy::cast_possible_truncation)]
fn mat4(m: &[f32; 16]) -> Mat4 {
    Mat4::new(
        m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11], m[12], m[13],
        m[14], m[15],
    )
}

/// Orthographic projection of the world as seen from the sun, covering a sphere.
#[allow(clippy::cast_possible_truncation)]
fn sun_matrix(centre: [f64; 3], radius: f64) -> [f32; 16] {
    let len = (SUN[0] * SUN[0] + SUN[1] * SUN[1] + SUN[2] * SUN[2]).sqrt();
    let back = [SUN[0] / len, SUN[1] / len, SUN[2] / len];
    let forward = [-back[0], -back[1], -back[2]];
    // Right = forward × world up, normalised; up = right × forward.
    let r = [-forward[2], 0.0, forward[0]];
    let rl = (r[0] * r[0] + r[2] * r[2]).sqrt().max(1e-9);
    let right = [r[0] / rl, 0.0, r[2] / rl];
    let up = [
        right[1] * forward[2] - right[2] * forward[1],
        right[2] * forward[0] - right[0] * forward[2],
        right[0] * forward[1] - right[1] * forward[0],
    ];
    let radius = radius.max(100.0);
    let eye = [
        centre[0] + back[0] * radius * 2.0,
        centre[1] + back[1] * radius * 2.0,
        centre[2] + back[2] * radius * 2.0,
    ];
    let dot = |a: [f64; 3], b: [f64; 3]| a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    let (near, far) = (radius * 0.5, radius * 3.5);
    let (sx, sy, sz) = (1.0 / radius, 1.0 / radius, -2.0 / (far - near));
    let tz = -(far + near) / (far - near);
    // proj × view, written out (column-major).
    let rows = [
        [
            right[0] * sx,
            right[1] * sx,
            right[2] * sx,
            -dot(right, eye) * sx,
        ],
        [up[0] * sy, up[1] * sy, up[2] * sy, -dot(up, eye) * sy],
        [
            -forward[0] * sz,
            -forward[1] * sz,
            -forward[2] * sz,
            dot(forward, eye) * sz + tz,
        ],
        [0.0, 0.0, 0.0, 1.0],
    ];
    let mut out = [0.0_f32; 16];
    for (row, values) in rows.iter().enumerate() {
        for (col, v) in values.iter().enumerate() {
            out[col * 4 + row] = *v as f32;
        }
    }
    out
}

impl Renderer {
    /// Creates the renderer on an existing WebGL2 context.
    ///
    /// # Errors
    ///
    /// Fails when the context does not support what the renderer needs or a shader does not
    /// compile.
    pub fn new(gl: Arc<GlContext>, width: u32, height: u32) -> Result<Self, CoreError> {
        let context = Context::from_gl_context(gl)?;
        let main = Program::from_source(&context, shaders::VERTEX, shaders::FRAGMENT)?;
        let depth = Program::from_source(&context, shaders::VERTEX, shaders::DEPTH)?;
        let pick = Program::from_source(&context, shaders::VERTEX, shaders::PICK)?;
        let mut view = ViewState::default();
        view.aspect = f64::from(width.max(1)) / f64::from(height.max(1));
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
            main,
            depth,
            pick,
            opaque: None,
            transparent: None,
            shadow: None,
            pick_target: None,
            view,
        })
    }

    /// Uploads a scene. The camera frames it unless `keep_camera`.
    pub fn set_scene(&mut self, scene: &Scene, keep_camera: bool) {
        self.opaque = GpuMesh::new(&self.context, &scene.opaque);
        self.transparent = GpuMesh::new(&self.context, &scene.transparent);
        self.view.set_scene(scene, keep_camera);
    }

    /// Sets the drawing buffer size in device pixels.
    pub fn resize(&mut self, width: u32, height: u32) {
        let (width, height) = (width.max(1), height.max(1));
        if (width, height) != (self.width, self.height) {
            self.width = width;
            self.height = height;
            self.view.aspect = f64::from(width) / f64::from(height);
            self.view.dirty = true;
        }
    }

    /// Sets the colour behind the scene (from the Home Assistant theme).
    pub fn set_background(&mut self, background: Rgb) {
        if background != self.background {
            self.background = background;
            self.view.dirty = true;
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
            self.shadow = None;
            self.view.shadows_dirty = true;
            self.view.dirty = true;
        }
    }

    /// Sets the cut-away mode.
    pub fn set_cutaway(&mut self, mode: CutawayMode) {
        if mode != self.view.cutaway {
            self.view.cutaway = mode;
            self.view.dirty = true;
        }
    }

    /// Asks for a new frame even though nothing changed (benchmarks, context restore).
    pub fn invalidate(&mut self) {
        self.view.dirty = true;
        self.view.shadows_dirty = true;
    }

    /// Whether a frame is needed: something changed or an animation is running.
    pub fn needs_frame(&self) -> bool {
        self.view.dirty || self.view.animating()
    }

    fn shadow_size(&self) -> Option<(u32, f32)> {
        match self.quality {
            QualityPreset::Eco => None,
            QualityPreset::Balanced => Some((1024, 1.0)),
            QualityPreset::High => Some((2048, 2.0)),
        }
    }

    fn cut_uniform(&self) -> [Vec4; 32] {
        #[allow(clippy::cast_possible_truncation)]
        let wall = self.view.wall_height as f32;
        let mut slots = [Vec4::new(wall, wall, wall, wall); 32];
        for (i, cut) in self.view.cuts.iter().enumerate().take(128) {
            #[allow(clippy::cast_possible_truncation)]
            let value = *cut as f32;
            let slot = &mut slots[i / 4];
            match i % 4 {
                0 => slot.x = value,
                1 => slot.y = value,
                2 => slot.z = value,
                _ => slot.w = value,
            }
        }
        slots
    }

    fn use_common(&self, program: &Program, view_proj: &[f32; 16]) {
        program.use_uniform_if_required("u_view_proj", mat4(view_proj));
        if program.requires_uniform("u_cut") {
            program.use_uniform_array("u_cut", &self.cut_uniform());
        }
        #[allow(clippy::cast_possible_truncation)]
        program.use_uniform_if_required("u_wall_height", self.view.wall_height as f32);
    }

    fn render_shadow_map(&mut self) {
        let Some((size, _)) = self.shadow_size() else {
            self.shadow = None;
            return;
        };
        if self.shadow.as_ref().is_none_or(|s| s.size != size) {
            self.shadow = Some(ShadowMap {
                texture: DepthTexture2D::new::<f32>(
                    &self.context,
                    size,
                    size,
                    Wrapping::ClampToEdge,
                    Wrapping::ClampToEdge,
                ),
                matrix: [0.0; 16],
                size,
            });
        }
        let matrix = sun_matrix(self.view.centre(), self.view.radius());
        self.use_common(&self.depth, &matrix);
        let Some(shadow) = self.shadow.as_mut() else {
            return;
        };
        shadow.matrix = matrix;
        let states = RenderStates {
            write_mask: WriteMask::DEPTH,
            depth_test: DepthTest::Less,
            blend: Blend::Disabled,
            cull: Cull::None,
        };
        let viewport = Viewport::new_at_origo(size, size);
        let (depth, opaque) = (&self.depth, &self.opaque);
        let _ = shadow
            .texture
            .as_depth_target()
            .clear(ClearState::depth(1.0))
            .write::<CoreError>(|| {
                if let Some(mesh) = opaque {
                    mesh.draw(depth, states, viewport);
                }
                Ok(())
            });
    }

    /// Draws one frame at `time_ms`. Returns `true` while an animation needs more frames.
    pub fn render(&mut self, time_ms: f64) -> bool {
        let animating = self.view.update(time_ms);
        if self.view.shadows_dirty {
            self.render_shadow_map();
            self.view.shadows_dirty = false;
        }
        let projection = self
            .view
            .camera
            .projection(self.view.aspect, self.view.radius());
        let eye = projection.eye;
        #[allow(clippy::cast_possible_truncation)]
        let flat = self.view.camera.ortho.clamp(0.0, 1.0) as f32;
        let program = &self.main;
        self.use_common(program, &projection.view_proj);
        #[allow(clippy::cast_possible_truncation)]
        program.use_uniform_if_required(
            "u_eye",
            Vec3::new(eye[0] as f32, eye[1] as f32, eye[2] as f32),
        );
        let len = (SUN[0] * SUN[0] + SUN[1] * SUN[1] + SUN[2] * SUN[2]).sqrt();
        #[allow(clippy::cast_possible_truncation)]
        program.use_uniform_if_required(
            "u_sun",
            Vec3::new(
                (SUN[0] / len) as f32,
                (SUN[1] / len) as f32,
                (SUN[2] / len) as f32,
            ),
        );
        program.use_uniform_if_required("u_flat", flat);
        let shadows = self.shadow.as_ref().filter(|_| flat < 0.5);
        program.use_uniform_if_required("u_shadows", if shadows.is_some() { 1.0_f32 } else { 0.0 });
        if let Some(shadow) = self.shadow.as_ref() {
            if program.requires_uniform("u_shadow_map") {
                program.use_depth_texture("u_shadow_map", &shadow.texture);
            }
            program.use_uniform_if_required("u_shadow_matrix", mat4(&shadow.matrix));
            #[allow(clippy::cast_precision_loss)]
            program.use_uniform_if_required("u_shadow_texel", 1.0 / shadow.size as f32);
            program.use_uniform_if_required("u_pcf", self.shadow_size().map_or(1.0, |(_, p)| p));
        } else if program.requires_uniform("u_shadow_map") {
            // A sampler must point at a depth texture even when unused: a tiny one.
            let tiny = DepthTexture2D::new::<f32>(
                &self.context,
                1,
                1,
                Wrapping::ClampToEdge,
                Wrapping::ClampToEdge,
            );
            program.use_depth_texture("u_shadow_map", &tiny);
            program.use_uniform_if_required("u_pcf", 1.0_f32);
            program.use_uniform_if_required("u_shadow_texel", 1.0_f32);
            program.use_uniform_if_required("u_shadow_matrix", mat4(&[0.0; 16]));
        }
        let viewport = Viewport::new_at_origo(self.width, self.height);
        let Rgb { r, g, b } = self.background;
        let opaque_states = RenderStates {
            write_mask: WriteMask::COLOR_AND_DEPTH,
            depth_test: DepthTest::Less,
            blend: Blend::Disabled,
            cull: Cull::Back,
        };
        let glass_states = RenderStates {
            write_mask: WriteMask::COLOR,
            depth_test: DepthTest::LessOrEqual,
            blend: Blend::TRANSPARENCY,
            cull: Cull::Back,
        };
        let (opaque, transparent) = (&self.opaque, &self.transparent);
        let _ = RenderTarget::screen(&self.context, self.width, self.height)
            .clear(ClearState::color_and_depth(r, g, b, 1.0, 1.0))
            .write::<CoreError>(|| {
                if let Some(mesh) = opaque {
                    mesh.draw(program, opaque_states, viewport);
                }
                if let Some(mesh) = transparent {
                    mesh.draw(program, glass_states, viewport);
                }
                Ok(())
            });
        self.view.dirty = false;
        animating
    }

    /// The element tag (index + 1, 0 for none) drawn at the device pixel `(x, y)` from the top
    /// left of the canvas.
    pub fn pick(&mut self, x: u32, y: u32) -> u16 {
        if x >= self.width || y >= self.height {
            return 0;
        }
        let (width, height) = (self.width, self.height);
        if self
            .pick_target
            .as_ref()
            .is_none_or(|t| (t.width, t.height) != (width, height))
        {
            self.pick_target = Some(PickTarget {
                color: Texture2D::new_empty::<[u8; 4]>(
                    &self.context,
                    width,
                    height,
                    Interpolation::Nearest,
                    Interpolation::Nearest,
                    None,
                    Wrapping::ClampToEdge,
                    Wrapping::ClampToEdge,
                ),
                depth: DepthTexture2D::new::<f32>(
                    &self.context,
                    width,
                    height,
                    Wrapping::ClampToEdge,
                    Wrapping::ClampToEdge,
                ),
                width,
                height,
            });
        }
        let projection = self
            .view
            .camera
            .projection(self.view.aspect, self.view.radius());
        self.use_common(&self.pick, &projection.view_proj);
        let Some(target) = self.pick_target.as_mut() else {
            return 0;
        };
        #[allow(clippy::cast_possible_wrap)]
        let scissor = ScissorBox {
            x: x as i32,
            y: (height - 1 - y) as i32,
            width: 1,
            height: 1,
        };
        let viewport = Viewport::new_at_origo(width, height);
        let states = RenderStates {
            write_mask: WriteMask::COLOR_AND_DEPTH,
            depth_test: DepthTest::Less,
            blend: Blend::Disabled,
            cull: Cull::Back,
        };
        let (program, opaque, transparent) = (&self.pick, &self.opaque, &self.transparent);
        let render_target = RenderTarget::new(
            target.color.as_color_target(None),
            target.depth.as_depth_target(),
        );
        let _ = render_target
            .clear_partially(
                scissor,
                ClearState::color_and_depth(0.0, 0.0, 0.0, 0.0, 1.0),
            )
            .write_partially::<CoreError>(scissor, || {
                for mesh in [opaque, transparent].into_iter().flatten() {
                    mesh.draw(program, states, viewport);
                }
                Ok(())
            });
        let pixels = render_target.read_color_partially::<[u8; 4]>(scissor);
        pixels
            .first()
            .map_or(0, |p| u16::from_le_bytes([p[0], p[1]]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_sun_sees_the_centre_in_the_middle() {
        let m = sun_matrix([500.0, 0.0, 300.0], 800.0);
        let p = [500.0_f32, 0.0, 300.0, 1.0];
        let mut out = [0.0_f32; 4];
        for (row, o) in out.iter_mut().enumerate() {
            *o = (0..4).map(|k| m[k * 4 + row] * p[k]).sum();
        }
        assert!(out[0].abs() < 1e-4 && out[1].abs() < 1e-4);
        assert!(out[2] > -1.0 && out[2] < 1.0);
    }
}
