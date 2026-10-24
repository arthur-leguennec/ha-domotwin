//! DomoTwin renderer: draws the scene built by `domotwin-core` with the core layer of three-d on
//! WebGL2 and DomoTwin's own shaders (see `docs/DECISIONS.md`, D-014).
//!
//! The home is a few meshes (opaque, the walls, then glass and contact shadows; the moving parts
//! apart), so a frame is a few draw calls whatever the plan. Frames are drawn on demand:
//! [`Renderer::needs_frame`] says when.

#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used, clippy::panic))]

pub mod lamps;
mod quality;
mod shaders;
pub mod view;

use std::sync::Arc;

use domotwin_core::camera::CutawayMode;
use domotwin_core::lighting::Lighting;
use domotwin_core::live::Look;
use domotwin_core::scene::lines::Line;
use domotwin_core::scene::mesh::Mesh;
use domotwin_core::scene::{LightSpot, Scene};
use domotwin_core::theme::{Theme, ThemeName};
use lamps::{Halo, Mark, PointLight};
pub use quality::{GpuHint, QualityPreset};
pub use three_d::context::Context as GlContext;
use three_d::{
    Blend, BlendEquationType, BlendMultiplierType, ClearState, Context, CoreError, Cull, DepthTest,
    DepthTexture2D, ElementBuffer, Interpolation, Mat4, Matrix4, Program, RenderStates,
    RenderTarget, RenderTargetMultisample, ScissorBox, SquareMatrix, Texture2D, Vec2, Vec3, Vec4,
    VertexBuffer, Viewport, Wrapping, WriteMask, Zero,
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

    /// Replaces the data, keeping the buffers (moving parts are uploaded often).
    fn replace(slot: &mut Option<Self>, context: &Context, mesh: &Mesh) {
        match slot {
            Some(gpu) if !mesh.indices.is_empty() => {
                gpu.positions.fill(&mesh.positions);
                gpu.normals.fill(&mesh.normals);
                gpu.colors.fill(&mesh.colors);
                gpu.extras.fill(&mesh.extras);
                gpu.uvs.fill(&mesh.uvs);
                gpu.indices.fill(&mesh.indices);
            }
            _ => *slot = Self::new(context, mesh),
        }
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

/// The halos of lit bulbs on the GPU.
struct GpuHalos {
    centers: VertexBuffer<[f32; 4]>,
    tints: VertexBuffer<[f32; 4]>,
    corners: VertexBuffer<[f32; 2]>,
    indices: ElementBuffer<u32>,
}

impl GpuHalos {
    fn new(context: &Context, halos: &[Halo]) -> Option<Self> {
        if halos.is_empty() {
            return None;
        }
        let mut centers = Vec::with_capacity(halos.len() * 4);
        let mut tints = Vec::with_capacity(halos.len() * 4);
        let mut corners = Vec::with_capacity(halos.len() * 4);
        let mut indices = Vec::with_capacity(halos.len() * 6);
        for (i, halo) in halos.iter().enumerate() {
            let base = u32::try_from(i * 4).unwrap_or(u32::MAX - 4);
            for corner in [[-1.0, -1.0], [1.0, -1.0], [1.0, 1.0], [-1.0, 1.0]] {
                let [x, y, z] = halo.center;
                centers.push([x, y, z, halo.size]);
                let [r, g, b] = halo.tint;
                tints.push([r, g, b, 1.0]);
                corners.push(corner);
            }
            indices.extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
        }
        Some(Self {
            centers: VertexBuffer::new_with_data(context, &centers),
            tints: VertexBuffer::new_with_data(context, &tints),
            corners: VertexBuffer::new_with_data(context, &corners),
            indices: ElementBuffer::new_with_data(context, &indices),
        })
    }
}

/// The outlines of the home on the GPU: four corners per line.
struct GpuLines {
    /// First end and wall group.
    a: VertexBuffer<[f32; 4]>,
    /// Second end and the height of the bottom of what the line outlines.
    b: VertexBuffer<[f32; 4]>,
    /// Along (0 or 1), across (−1 or 1) and weight.
    corners: VertexBuffer<[f32; 3]>,
    indices: ElementBuffer<u32>,
}

impl GpuLines {
    fn new(context: &Context, lines: &[Line]) -> Option<Self> {
        if lines.is_empty() {
            return None;
        }
        let mut a = Vec::with_capacity(lines.len() * 4);
        let mut b = Vec::with_capacity(lines.len() * 4);
        let mut corners = Vec::with_capacity(lines.len() * 4);
        let mut indices = Vec::with_capacity(lines.len() * 6);
        for (i, line) in lines.iter().enumerate() {
            let Ok(base) = u32::try_from(i * 4) else {
                break;
            };
            for [along, across] in [[0.0, -1.0], [1.0, -1.0], [1.0, 1.0], [0.0, 1.0]] {
                let [x, y, z] = line.a;
                a.push([x, y, z, f32::from(line.group)]);
                let [x, y, z] = line.b;
                b.push([x, y, z, line.base]);
                corners.push([along, across, line.kind.weight()]);
            }
            indices.extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
        }
        Some(Self {
            a: VertexBuffer::new_with_data(context, &a),
            b: VertexBuffer::new_with_data(context, &b),
            corners: VertexBuffer::new_with_data(context, &corners),
            indices: ElementBuffer::new_with_data(context, &indices),
        })
    }
}

/// The offscreen targets of the bloom (D-027): the picture drawn with MSAA, resolved, and the
/// levels of its glow, each half the size of the one before.
struct PostTargets {
    width: u32,
    height: u32,
    scene: RenderTargetMultisample<[u8; 4], f32>,
    resolved: Texture2D,
    levels: Vec<Texture2D>,
}

/// Levels of the bloom (down to a sixteenth of the view).
const BLOOM_LEVELS: usize = 4;
/// Samples of the offscreen picture (WebGL2 guarantees four).
const MSAA_SAMPLES: u32 = 4;
/// Height of the ground (cm): under the floors' slabs.
const GROUND_Y: f64 = -6.0;
/// How far the outlines are moved towards the camera, in device pixels where they are.
const LINE_LIFT: f64 = 2.0;

/// The inverse of a column-major 4 × 4 matrix, computed in double precision (zero when it has
/// none).
fn invert(m: &[f32; 16]) -> Mat4 {
    let a = m.map(f64::from);
    Matrix4::new(
        a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8], a[9], a[10], a[11], a[12], a[13],
        a[14], a[15],
    )
    .invert()
    .and_then(|inverse| inverse.cast::<f32>())
    .unwrap_or_else(Mat4::zero)
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

/// Direction towards the sun when its position is not used: high, from the south-east of the
/// plan.
const SUN: [f64; 3] = [0.38, 0.82, 0.43];
/// Lowest height of the real sun's direction: below the horizon, it lights from just above it
/// (its light has faded by then, see `domotwin_core::lighting`).
const SUN_MIN_Y: f64 = 0.035;

/// Unit vector of `v`.
fn unit(v: [f64; 3]) -> [f64; 3] {
    let len = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt().max(1e-12);
    v.map(|c| c / len)
}

/// The direction towards the real sun as drawn: a unit vector no lower than [`SUN_MIN_Y`];
/// `None` for no direction.
fn real_sun(direction: [f64; 3]) -> Option<[f64; 3]> {
    if direction.iter().any(|c| !c.is_finite()) || direction.iter().all(|c| *c == 0.0) {
        return None;
    }
    let [x, y, z] = unit(direction);
    let flat = (x * x + z * z).sqrt();
    if y >= SUN_MIN_Y {
        Some([x, y, z])
    } else if flat < 1e-9 {
        // Straight down: from overhead.
        Some([0.0, 1.0, 0.0])
    } else {
        let k = (1.0 - SUN_MIN_Y * SUN_MIN_Y).sqrt() / flat;
        Some([x * k, SUN_MIN_Y, z * k])
    }
}

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
    halo: Program,
    background_program: Program,
    line_program: Program,
    bloom_down: Program,
    bloom_up: Program,
    composite: Program,
    /// The look (D-027).
    theme: Theme,
    /// The outlines of the home.
    lines: Option<GpuLines>,
    /// The offscreen targets, while the look glows.
    post: Option<PostTargets>,
    /// Opaque and moving opaque, then glass and moving glass.
    meshes: [Option<GpuMesh>; 4],
    /// The walls: opaque, or glass faces with opaque tops (D-027).
    walls: Option<GpuMesh>,
    /// The live look of every element, three texels each (see `lamps::element_texels`).
    elements: Texture2D,
    /// The room layers, three texels per room slot (`domotwin_core::layers::room_texels`).
    rooms: Texture2D,
    /// A room layer is shown (heatmap, alert or presence).
    rooms_shown: bool,
    /// The room layers move (the heatmap's halo, a pulsing alert).
    rooms_animated: bool,
    /// The power layer is shown.
    power_layer: bool,
    /// Layers may move (off when the user prefers reduced motion).
    motion: bool,
    /// Direction towards the real sun (unit), when its position is used; else [`SUN`].
    sun: Option<[f64; 3]>,
    /// The ceilings: only drawn in the shadow map, with the real sun.
    ceiling: Option<GpuMesh>,
    /// The looks and edit marks it holds.
    looks: Vec<Look>,
    marks: Vec<Mark>,
    spots: Vec<LightSpot>,
    lights: Vec<PointLight>,
    halos: Option<GpuHalos>,
    shadow: Option<ShadowMap>,
    /// The shadow map must be drawn again (scene, moving parts, sun or quality changed); the
    /// view says when the cut-away changed (`ViewState::shadows_dirty`).
    shadow_stale: bool,
    /// What the shadow sampler points at without shadows. Created once: creating a texture
    /// binds it to the active unit, which would replace a texture bound for the frame.
    no_shadow: DepthTexture2D,
    pick_target: Option<PickTarget>,
    lighting: Lighting,
    /// What the view shows and how it moves.
    pub view: ViewState,
}

impl std::fmt::Debug for Renderer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Renderer")
            .field("width", &self.width)
            .field("height", &self.height)
            .field("quality", &self.quality)
            .field("meshes", &self.meshes)
            .field("walls", &self.walls)
            .field("lights", &self.lights.len())
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

/// Orthographic projection of the world as seen from the sun (`sun`, a unit vector towards it),
/// covering a sphere.
#[allow(clippy::cast_possible_truncation)]
fn sun_matrix(centre: [f64; 3], radius: f64, sun: [f64; 3]) -> [f32; 16] {
    let back = sun;
    let forward = [-back[0], -back[1], -back[2]];
    // Right = forward × world up, normalised; up = right × forward.
    let r = [-forward[2], 0.0, forward[0]];
    let rl = (r[0] * r[0] + r[2] * r[2]).sqrt();
    // A sun overhead sees the plan with its x axis to the right.
    let right = if rl > 1e-6 {
        [r[0] / rl, 0.0, r[2] / rl]
    } else {
        [1.0, 0.0, 0.0]
    };
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

/// A texture of texels on one row (per element tag, per room slot).
fn row_texture(context: &Context, texels: &[[f32; 4]]) -> Texture2D {
    let width = u32::try_from(texels.len()).unwrap_or(2).max(2);
    let texture = Texture2D::new_empty::<[f32; 4]>(
        context,
        width,
        1,
        Interpolation::Nearest,
        Interpolation::Nearest,
        None,
        Wrapping::ClampToEdge,
        Wrapping::ClampToEdge,
    );
    texture.fill(texels);
    texture
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
        let halo = Program::from_source(&context, shaders::HALO_VERTEX, shaders::HALO_FRAGMENT)?;
        let full = shaders::FULLSCREEN_VERTEX;
        let background_program =
            Program::from_source(&context, full, shaders::BACKGROUND_FRAGMENT)?;
        let line_program =
            Program::from_source(&context, shaders::LINE_VERTEX, shaders::LINE_FRAGMENT)?;
        let bloom_down = Program::from_source(&context, full, shaders::BLOOM_DOWN)?;
        let bloom_up = Program::from_source(&context, full, shaders::BLOOM_UP)?;
        let composite = Program::from_source(&context, full, shaders::COMPOSITE)?;
        let elements = row_texture(&context, &lamps::element_texels(&[], &[]));
        let rooms = row_texture(&context, &[[0.0; 4]; 3]);
        let mut view = ViewState::default();
        view.aspect = f64::from(width.max(1)) / f64::from(height.max(1));
        let no_shadow = DepthTexture2D::new::<f32>(
            &context,
            1,
            1,
            Wrapping::ClampToEdge,
            Wrapping::ClampToEdge,
        );
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
            halo,
            background_program,
            line_program,
            bloom_down,
            bloom_up,
            composite,
            theme: Theme::default(),
            lines: None,
            post: None,
            meshes: [None, None, None, None],
            walls: None,
            elements,
            rooms,
            rooms_shown: false,
            rooms_animated: false,
            power_layer: false,
            motion: true,
            sun: None,
            ceiling: None,
            looks: Vec::new(),
            marks: Vec::new(),
            spots: Vec::new(),
            lights: Vec::new(),
            halos: None,
            shadow: None,
            shadow_stale: true,
            no_shadow,
            pick_target: None,
            lighting: Lighting::default(),
            view,
        })
    }

    /// Uploads a scene. The camera frames it unless `keep_camera`.
    pub fn set_scene(&mut self, scene: &Scene, keep_camera: bool) {
        self.meshes = [
            GpuMesh::new(&self.context, &scene.opaque),
            GpuMesh::new(&self.context, &scene.dynamic_opaque),
            GpuMesh::new(&self.context, &scene.transparent),
            GpuMesh::new(&self.context, &scene.dynamic_transparent),
        ];
        self.walls = GpuMesh::new(&self.context, &scene.wall_mesh);
        self.ceiling = GpuMesh::new(&self.context, &scene.ceiling);
        self.lines = GpuLines::new(&self.context, &scene.lines);
        self.shadow_stale = true;
        self.spots.clone_from(&scene.lights);
        self.view.set_scene(scene, keep_camera);
    }

    /// Draws nothing but the background (no plan shown any more).
    pub fn clear_scene(&mut self) {
        self.meshes = [None, None, None, None];
        self.walls = None;
        self.ceiling = None;
        self.lines = None;
        self.spots.clear();
        self.shadow_stale = true;
        self.view.dirty = true;
    }

    /// Uploads the moving parts again (doors, windows, curtains, blinds moved).
    pub fn set_moving_parts(&mut self, opaque: &Mesh, transparent: &Mesh) {
        GpuMesh::replace(&mut self.meshes[1], &self.context, opaque);
        GpuMesh::replace(&mut self.meshes[3], &self.context, transparent);
        self.shadow_stale = true;
        self.view.dirty = true;
    }

    /// Sets the live look of every element (lights, greyed out, highlight).
    pub fn set_looks(&mut self, looks: &[Look]) {
        self.looks.clear();
        self.looks.extend_from_slice(looks);
        self.upload_elements();
        self.relight();
    }

    /// Marks the elements selected or in conflict in edit mode (by element index; empty: none).
    pub fn set_marks(&mut self, marks: &[Mark]) {
        if marks != self.marks.as_slice() {
            self.marks = marks.to_vec();
            self.upload_elements();
        }
    }

    /// Moves the lamps (the pieces carrying them moved in edit mode).
    pub fn set_spots(&mut self, spots: &[LightSpot]) {
        self.spots = spots.to_vec();
        self.relight();
    }

    fn upload_elements(&mut self) {
        let texels = lamps::element_texels(&self.looks, &self.marks);
        if self.elements.width() as usize == texels.len() {
            self.elements.fill(&texels);
        } else {
            self.elements = row_texture(&self.context, &texels);
        }
        self.view.dirty = true;
    }

    /// Sets the room layers: three texels per room slot (`domotwin_core::layers::room_texels`),
    /// whether one is `shown` and whether it moves (`animated`).
    pub fn set_rooms(&mut self, texels: &[[f32; 4]], shown: bool, animated: bool) {
        if self.rooms.width() as usize == texels.len() {
            self.rooms.fill(texels);
        } else {
            self.rooms = row_texture(&self.context, texels);
        }
        self.rooms_shown = shown;
        self.rooms_animated = shown && animated;
        self.view.dirty = true;
    }

    /// Shows or hides the power layer (the pieces drawing power tinted).
    pub fn set_power_layer(&mut self, shown: bool) {
        if shown != self.power_layer {
            self.power_layer = shown;
            self.view.dirty = true;
        }
    }

    /// Whether the power layer is shown.
    pub const fn power_layer(&self) -> bool {
        self.power_layer
    }

    /// Lets the layers move, or holds them still (reduced motion).
    pub fn set_motion(&mut self, motion: bool) {
        if motion != self.motion {
            self.motion = motion;
            self.view.dirty = true;
        }
    }

    /// Whether the layers shown move: frames are then needed all the time (the frontend slows
    /// them down).
    pub fn layers_animating(&self) -> bool {
        self.motion
            && (self.rooms_animated
                || (self.power_layer
                    && self.looks.iter().any(|l| lamps::power_level(l.power) > 0.0)))
    }

    /// Lights the scene from the real sun (`direction` towards it, `y` up), its light coming
    /// into the rooms through the windows only; `None` goes back to the default sun.
    pub fn set_sun(&mut self, direction: Option<[f64; 3]>) {
        let sun = direction.and_then(real_sun);
        if sun != self.sun {
            self.sun = sun;
            self.shadow_stale = true;
            self.view.dirty = true;
        }
    }

    /// The direction towards the sun used now (unit).
    pub fn sun_direction(&self) -> [f64; 3] {
        self.sun.unwrap_or_else(|| unit(SUN))
    }

    fn relight(&mut self) {
        self.lights = lamps::point_lights(&self.spots, &self.looks);
        self.halos = GpuHalos::new(&self.context, &lamps::halos(&self.spots, &self.looks));
        self.view.dirty = true;
    }

    /// The point of the horizontal plane at `height` (cm) drawn at the device pixel `x`, `y`
    /// from the top left (world coordinates), if the camera sees that plane there.
    pub fn plane_point(&self, x: f64, y: f64, height: f64) -> Option<[f64; 3]> {
        let ndc = [
            x / f64::from(self.width) * 2.0 - 1.0,
            1.0 - y / f64::from(self.height) * 2.0,
        ];
        self.view.camera.plane_point(self.view.aspect, ndc, height)
    }

    /// Number of point lights in use (diagnostics).
    pub fn light_count(&self) -> usize {
        self.lights.len()
    }

    /// The drawing buffer size in device pixels.
    pub const fn size(&self) -> (u32, u32) {
        (self.width, self.height)
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

    /// Where a world point is drawn now: device pixels from the top left, `None` when it is
    /// behind the camera.
    pub fn screen_point(&self, point: [f64; 3]) -> Option<[f64; 2]> {
        let m = self
            .view
            .camera
            .projection(self.view.aspect, self.view.radius())
            .view_proj
            .map(f64::from);
        let clip = |row: usize| {
            m[row] * point[0] + m[4 + row] * point[1] + m[8 + row] * point[2] + m[12 + row]
        };
        let w = clip(3);
        if w <= 1e-6 {
            return None;
        }
        Some([
            (clip(0) / w + 1.0) * 0.5 * f64::from(self.width),
            (1.0 - clip(1) / w) * 0.5 * f64::from(self.height),
        ])
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
            self.shadow_stale = true;
            self.view.dirty = true;
        }
    }

    /// Sets the light of the scene (the mood of the time of day).
    pub fn set_lighting(&mut self, lighting: Lighting) {
        if lighting != self.lighting {
            self.lighting = lighting;
            self.view.dirty = true;
        }
    }

    /// The light of the time of day (the look may have its own, see [`Renderer::theme`]).
    pub const fn lighting(&self) -> Lighting {
        self.lighting
    }

    /// Sets the look (D-027).
    pub fn set_theme(&mut self, theme: Theme) {
        if theme != self.theme {
            if theme.shadows != self.theme.shadows {
                self.shadow_stale = true;
            }
            self.theme = theme;
            self.view.dirty = true;
        }
    }

    /// The look.
    pub const fn theme(&self) -> &Theme {
        &self.theme
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
        self.shadow_stale = true;
    }

    /// Whether a frame is needed: something changed or an animation is running.
    pub fn needs_frame(&self) -> bool {
        self.view.dirty || self.view.animating() || self.layers_animating()
    }

    fn shadow_size(&self) -> Option<(u32, f32)> {
        match self.quality {
            // The real sun comes in through the windows only with a shadow map: a small one,
            // drawn again only when something moves, read once per pixel.
            QualityPreset::Eco if self.sun.is_some() => Some((1024, 0.0)),
            QualityPreset::Eco => None,
            QualityPreset::Balanced => Some((1024, 1.0)),
            QualityPreset::High => Some((2048, 2.0)),
        }
    }

    /// The height of each wall group; whole walls when `uncut`.
    fn cut_uniform(&self, uncut: bool) -> [Vec4; 32] {
        #[allow(clippy::cast_possible_truncation)]
        let wall = self.view.wall_height as f32;
        let mut slots = [Vec4::new(wall, wall, wall, wall); 32];
        let cuts = if uncut { &[][..] } else { &self.view.cuts[..] };
        for (i, cut) in cuts.iter().enumerate().take(128) {
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

    fn use_common(&self, program: &Program, view_proj: &[f32; 16], uncut: bool) {
        program.use_uniform_if_required("u_view_proj", mat4(view_proj));
        if program.requires_uniform("u_elements") {
            program.use_texture("u_elements", &self.elements);
        }
        if program.requires_uniform("u_cut") {
            program.use_uniform_array("u_cut", &self.cut_uniform(uncut));
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
        let matrix = sun_matrix(self.view.centre(), self.view.radius(), self.sun_direction());
        // The real sun comes in through the windows only: whole walls and the ceilings cast
        // shadows, whatever the cut-away shows.
        let real = self.sun.is_some();
        self.use_common(&self.depth, &matrix, real);
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
        let (depth, meshes) = (&self.depth, &self.meshes);
        let ceiling = self.ceiling.as_ref().filter(|_| real);
        let _ = shadow
            .texture
            .as_depth_target()
            .clear(ClearState::depth(1.0))
            .write::<CoreError>(|| {
                for mesh in meshes[..2]
                    .iter()
                    .chain([&self.walls])
                    .flatten()
                    .chain(ceiling)
                {
                    mesh.draw(depth, states, viewport);
                }
                Ok(())
            });
    }

    /// Whether frames are drawn offscreen for the bloom (D-027): the looks that glow, on GPUs that
    /// can afford it (day only on desktop GPUs).
    fn post_on(&self) -> bool {
        self.theme.bloom > 0.0
            && match self.quality {
                QualityPreset::Eco => false,
                QualityPreset::Balanced => self.theme.name != ThemeName::Day,
                QualityPreset::High => true,
            }
    }

    /// The offscreen targets at the size of the view, made again when it changed.
    fn ensure_post(&mut self) {
        let (width, height) = (self.width, self.height);
        if self
            .post
            .as_ref()
            .is_some_and(|p| (p.width, p.height) == (width, height))
        {
            return;
        }
        let texture = |w: u32, h: u32| {
            Texture2D::new_empty::<[u8; 4]>(
                &self.context,
                w.max(1),
                h.max(1),
                Interpolation::Linear,
                Interpolation::Linear,
                None,
                Wrapping::ClampToEdge,
                Wrapping::ClampToEdge,
            )
        };
        let mut levels = Vec::new();
        let (mut w, mut h) = (width / 2, height / 2);
        while levels.len() < BLOOM_LEVELS && w.min(h) >= 8 {
            levels.push(texture(w, h));
            (w, h) = (w / 2, h / 2);
        }
        self.post = Some(PostTargets {
            width,
            height,
            scene: RenderTargetMultisample::new(&self.context, width, height, MSAA_SAMPLES),
            resolved: texture(width, height),
            levels,
        });
    }

    /// The light of the scene: the look's own, else the time of day's.
    fn light(&self) -> Lighting {
        self.theme.lighting.unwrap_or(self.lighting)
    }

    /// The background's colours: the look's, or for the day look, shades of the dashboard's, the
    /// ground dimming with the light of the time of day.
    fn backdrop(&self) -> ([f32; 3], [f32; 3], [f32; 3], [f32; 3]) {
        let t = &self.theme;
        if t.name != ThemeName::Day {
            return (t.sky_top, t.sky_horizon, t.ground, t.grid);
        }
        let Rgb { r, g, b } = self.background;
        let shade = |k: f32| [r * k, g * k, b * k];
        let sky = self.lighting.sky;
        let daylight = Lighting::default().sky;
        let luma = |c: [f32; 3]| 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        let dim = (luma(sky) / luma(daylight).max(1e-3))
            .sqrt()
            .clamp(0.4, 1.0);
        (shade(1.0), shade(0.95), shade(0.93 * dim), shade(0.8 * dim))
    }

    /// Width of the lines in device pixels.
    fn line_width(&self) -> f32 {
        #[allow(clippy::cast_precision_loss)]
        let side = self.width.min(self.height) as f32;
        let base = (side / 650.0).clamp(1.0, 3.0);
        match self.theme.name {
            ThemeName::Day => base * 0.9,
            ThemeName::Neon => base * 1.5,
            ThemeName::Blueprint => base * 1.2,
        }
    }

    /// Draws one frame at `time_ms`. Returns `true` while an animation needs more frames.
    pub fn render(&mut self, time_ms: f64) -> bool {
        let animating = self.view.update(time_ms);
        let cuts_moved = std::mem::take(&mut self.view.shadows_dirty);
        // With the real sun the shadow map draws whole walls: the cut-away does not change it.
        // Night looks have no sun shadows.
        if !self.theme.shadows {
            self.shadow = None;
        } else if self.shadow_stale || (cuts_moved && self.sun.is_none()) {
            self.render_shadow_map();
            self.shadow_stale = false;
        }
        let post = self.post_on();
        if post {
            self.ensure_post();
        } else {
            self.post = None;
        }
        let projection = self
            .view
            .camera
            .projection(self.view.aspect, self.view.radius());
        #[allow(clippy::cast_possible_truncation)]
        let flat = self.view.camera.ortho.clamp(0.0, 1.0) as f32;
        let gain = self.set_main_uniforms(&projection, time_ms, flat, post);
        self.set_background_uniforms(&projection.view_proj, post, flat < 0.5);
        self.set_line_uniforms(&projection);
        let halo = &self.halo;
        if self.halos.is_some() {
            halo.use_uniform_if_required("u_view_proj", mat4(&projection.view_proj));
            #[allow(clippy::cast_possible_truncation)]
            let v3 = |v: [f64; 3]| Vec3::new(v[0] as f32, v[1] as f32, v[2] as f32);
            halo.use_uniform_if_required("u_right", v3(projection.right));
            halo.use_uniform_if_required("u_up", v3(projection.up));
            halo.use_uniform_if_required("u_gain", gain);
        }
        let viewport = Viewport::new_at_origo(self.width, self.height);
        let [r, g, b] = self.backdrop().1;
        if let Some(targets) = self.post.as_ref() {
            let _ = targets
                .scene
                .clear(ClearState::color_and_depth(r, g, b, 0.0, 1.0))
                .write::<CoreError>(|| {
                    self.draw_passes(viewport);
                    Ok(())
                });
            targets
                .scene
                .resolve_color_to(&targets.resolved.as_color_target(None));
            self.draw_bloom(targets);
        } else {
            let _ = RenderTarget::screen(&self.context, self.width, self.height)
                .clear(ClearState::color_and_depth(r, g, b, 1.0, 1.0))
                .write::<CoreError>(|| {
                    self.draw_passes(viewport);
                    Ok(())
                });
        }
        self.view.dirty = false;
        animating || self.layers_animating()
    }

    /// Sets what the main program needs for a frame. Returns the lamps' gain.
    fn set_main_uniforms(
        &self,
        projection: &domotwin_core::camera::Projection,
        time_ms: f64,
        flat: f32,
        post: bool,
    ) -> f32 {
        let program = &self.main;
        self.use_common(program, &projection.view_proj, false);
        #[allow(clippy::cast_possible_truncation)]
        let v3 = |v: [f64; 3]| Vec3::new(v[0] as f32, v[1] as f32, v[2] as f32);
        program.use_uniform_if_required("u_eye", v3(projection.eye));
        program.use_uniform_if_required("u_sun", v3(self.sun_direction()));
        let on = |b: bool| if b { 1.0_f32 } else { 0.0 };
        program.use_uniform_if_required("u_layers", on(self.rooms_shown));
        program.use_uniform_if_required("u_power_layer", on(self.power_layer));
        program.use_uniform_if_required("u_motion", on(self.motion));
        program
            .use_uniform_if_required("u_bounce", if self.sun.is_some() { 0.16_f32 } else { 0.0 });
        // Every wave of the layers repeats within 600 s; f32 keeps them smooth over that.
        #[allow(clippy::cast_possible_truncation)]
        program.use_uniform_if_required("u_time", ((time_ms / 1000.0).rem_euclid(600.0)) as f32);
        program.use_uniform_if_required("u_flat", flat);
        let light = self.light();
        let rgb = |c: [f32; 3]| Vec3::new(c[0], c[1], c[2]);
        program.use_uniform_if_required("u_sky", rgb(light.sky));
        program.use_uniform_if_required("u_ground", rgb(light.ground));
        program.use_uniform_if_required("u_sun_color", rgb(light.sun));
        program.use_uniform_if_required("u_exposure", light.exposure);
        program.use_uniform_if_required("u_ao", light.ao);
        let t = &self.theme;
        program.use_uniform_if_required("u_glass_walls", on(t.glass_walls));
        program.use_uniform_if_required("u_wall_pass", 0.0_f32);
        program.use_uniform_if_required("u_wall_tint", rgb(t.wall_tint));
        program.use_uniform_if_required("u_wall_alpha", t.wall_alpha);
        program.use_uniform_if_required("u_wall_cap", rgb(t.wall_cap));
        program.use_uniform_if_required("u_tint", t.tint);
        program.use_uniform_if_required("u_palette", rgb(t.palette));
        program.use_uniform_if_required("u_floor_tint", t.floor_tint);
        program.use_uniform_if_required("u_floor_palette", rgb(t.floor_palette));
        program.use_uniform_if_required("u_plan_floor", rgb(t.plan_floor));
        program.use_uniform_if_required("u_plan_cap", rgb(t.plan_cap));
        program.use_uniform_if_required("u_glow_alpha", on(post));
        // Lamps and halos count less in daylight: a lamp lit at noon barely shows indoors.
        let gain = light.lamp_gain();
        let mut positions = [Vec4::new(0.0, 0.0, 0.0, 1.0); lamps::MAX_LIGHTS];
        let mut colors = [Vec4::new(0.0, 0.0, 0.0, 0.0); lamps::MAX_LIGHTS];
        for (i, lamp) in self.lights.iter().enumerate().take(lamps::MAX_LIGHTS) {
            let [x, y, z] = lamp.position;
            positions[i] = Vec4::new(x, y, z, lamp.radius);
            let [r, g, b] = lamp.color;
            colors[i] = Vec4::new(r * gain, g * gain, b * gain, f32::from(lamp.room));
        }
        if program.requires_uniform("u_light_pos") {
            program.use_uniform_array("u_light_pos", &positions);
            program.use_uniform_array("u_light_color", &colors);
        }
        #[allow(clippy::cast_precision_loss)]
        program.use_uniform_if_required("u_light_count", self.lights.len() as f32);
        let shadows = self.shadow.as_ref().filter(|_| flat < 0.5);
        program.use_uniform_if_required("u_shadows", on(shadows.is_some()));
        if let Some(shadow) = self.shadow.as_ref() {
            program.use_uniform_if_required("u_shadow_matrix", mat4(&shadow.matrix));
            #[allow(clippy::cast_precision_loss)]
            program.use_uniform_if_required("u_shadow_texel", 1.0 / shadow.size as f32);
            program.use_uniform_if_required("u_pcf", self.shadow_size().map_or(1.0, |(_, p)| p));
        } else {
            program.use_uniform_if_required("u_pcf", 1.0_f32);
            program.use_uniform_if_required("u_shadow_texel", 1.0_f32);
            program.use_uniform_if_required("u_shadow_matrix", mat4(&[0.0; 16]));
        }
        gain
    }

    /// Binds the textures of `program`: a texture unit is shared by every program, so each binds
    /// its own right before drawing.
    fn bind_textures(&self, program: &Program) {
        if program.requires_uniform("u_elements") {
            program.use_texture("u_elements", &self.elements);
        }
        if program.requires_uniform("u_rooms") {
            program.use_texture("u_rooms", &self.rooms);
        }
        if program.requires_uniform("u_shadow_map") {
            // A sampler must point at a depth texture even when unused.
            let texture = self.shadow.as_ref().map_or(&self.no_shadow, |s| &s.texture);
            program.use_depth_texture("u_shadow_map", texture);
        }
    }

    /// The background's uniforms; the sun's shadow on the ground only in 3D (`shadows`).
    fn set_background_uniforms(&self, view_proj: &[f32; 16], post: bool, shadows: bool) {
        let program = &self.background_program;
        let (top, horizon, ground, grid) = self.backdrop();
        let rgb = |c: [f32; 3]| Vec3::new(c[0], c[1], c[2]);
        program.use_uniform_if_required("u_inv_view_proj", invert(view_proj));
        program.use_uniform_if_required("u_sky_top", rgb(top));
        program.use_uniform_if_required("u_sky_horizon", rgb(horizon));
        program.use_uniform_if_required("u_ground", rgb(ground));
        program.use_uniform_if_required("u_grid", rgb(grid));
        program.use_uniform_if_required("u_grid_strength", self.theme.grid_strength);
        #[allow(clippy::cast_possible_truncation)]
        program.use_uniform_if_required("u_ground_y", GROUND_Y as f32);
        let [cx, _, cz] = self.view.centre();
        #[allow(clippy::cast_possible_truncation)]
        program.use_uniform_if_required("u_centre", Vec2::new(cx as f32, cz as f32));
        #[allow(clippy::cast_possible_truncation)]
        program.use_uniform_if_required("u_radius", self.view.radius().max(300.0) as f32);
        program.use_uniform_if_required("u_glow_alpha", if post { 1.0_f32 } else { 0.0 });
        let shadow = self.shadow.as_ref().filter(|_| shadows);
        program.use_uniform_if_required("u_shadows", if shadow.is_some() { 1.0_f32 } else { 0.0 });
        let matrix = shadow.map_or([0.0; 16], |s| s.matrix);
        program.use_uniform_if_required("u_shadow_matrix", mat4(&matrix));
    }

    fn set_line_uniforms(&self, projection: &domotwin_core::camera::Projection) {
        let program = &self.line_program;
        self.use_common(program, &projection.view_proj, false);
        // Towards the camera, by `LINE_LIFT` pixels where the line is: from its position (a pixel
        // spans `2 tan(fov / 2) / height` of the distance), or straight back along an orthographic
        // view (a pixel spans `2 half_height / height`).
        let pixels = f64::from(self.height.max(1)) / LINE_LIFT;
        let (toward, lift) = if projection.orthographic {
            let [fx, fy, fz] = projection.forward;
            ([-fx, -fy, -fz, 0.0], 2.0 * projection.half_height / pixels)
        } else {
            let [ex, ey, ez] = projection.eye;
            ([ex, ey, ez, 1.0], 2.0 * projection.tan_half_fov / pixels)
        };
        #[allow(clippy::cast_possible_truncation)]
        {
            program.use_uniform_if_required("u_toward", Vec4::from(toward.map(|v| v as f32)));
            program.use_uniform_if_required("u_lift", lift as f32);
        }
        #[allow(clippy::cast_precision_loss)]
        program.use_uniform_if_required(
            "u_viewport",
            Vec2::new(self.width as f32, self.height as f32),
        );
        program.use_uniform_if_required("u_line_width", self.line_width());
        let t = &self.theme;
        program.use_uniform_if_required("u_line_color", Vec3::new(t.line[0], t.line[1], t.line[2]));
        program.use_uniform_if_required("u_line_strength", t.line_strength);
        program.use_uniform_if_required("u_line_glow", t.line_glow);
        program.use_uniform_if_required("u_dark_lines", if t.dark_lines { 1.0_f32 } else { 0.0 });
    }

    /// Every pass of a frame, into the target being written: the background, what is opaque,
    /// glass, glass walls, the outlines, the halos.
    fn draw_passes(&self, viewport: Viewport) {
        let behind = RenderStates {
            write_mask: WriteMask::COLOR,
            depth_test: DepthTest::Always,
            blend: Blend::Disabled,
            cull: Cull::None,
        };
        let background = &self.background_program;
        self.bind_textures(background);
        background.draw_arrays(behind, viewport, 3);
        let program = &self.main;
        self.bind_textures(program);
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
        for mesh in self.meshes[..2].iter().flatten() {
            mesh.draw(program, opaque_states, viewport);
        }
        // Glass walls: their tops with what is opaque, their faces after the glass.
        let glass_walls = self.walls.as_ref().filter(|_| self.theme.glass_walls);
        if let Some(walls) = self.walls.as_ref() {
            let pass = if glass_walls.is_some() { 1.0_f32 } else { 0.0 };
            program.use_uniform_if_required("u_wall_pass", pass);
            walls.draw(program, opaque_states, viewport);
            program.use_uniform_if_required("u_wall_pass", 0.0_f32);
        }
        for mesh in self.meshes[2..].iter().flatten() {
            mesh.draw(program, glass_states, viewport);
        }
        if let Some(walls) = glass_walls {
            program.use_uniform_if_required("u_wall_pass", 2.0_f32);
            let states = RenderStates {
                cull: Cull::None,
                ..glass_states
            };
            walls.draw(program, states, viewport);
            program.use_uniform_if_required("u_wall_pass", 0.0_f32);
        }
        if let Some(lines) = self
            .lines
            .as_ref()
            .filter(|_| self.theme.line_strength > 0.0)
        {
            // Light lines keep the brightest of what is drawn where they cross (a partition's
            // line comes from both its rooms); dark lines the darkest. The glow keeps the most.
            let equation = if self.theme.dark_lines {
                BlendEquationType::Min
            } else {
                BlendEquationType::Max
            };
            let states = RenderStates {
                write_mask: WriteMask::COLOR,
                depth_test: DepthTest::LessOrEqual,
                blend: Blend::Enabled {
                    source_rgb_multiplier: BlendMultiplierType::One,
                    source_alpha_multiplier: BlendMultiplierType::One,
                    destination_rgb_multiplier: BlendMultiplierType::One,
                    destination_alpha_multiplier: BlendMultiplierType::One,
                    rgb_equation: equation,
                    alpha_equation: BlendEquationType::Max,
                },
                cull: Cull::None,
            };
            let line = &self.line_program;
            self.bind_textures(line);
            line.use_vertex_attribute("a_a", &lines.a);
            line.use_vertex_attribute("a_b", &lines.b);
            line.use_vertex_attribute("a_corner", &lines.corners);
            line.draw_elements(states, viewport, &lines.indices);
        }
        if let Some(h) = self.halos.as_ref() {
            let halo_states = RenderStates {
                write_mask: WriteMask::COLOR,
                depth_test: DepthTest::LessOrEqual,
                blend: Blend::ADD,
                cull: Cull::None,
            };
            let halo = &self.halo;
            halo.use_vertex_attribute("a_center", &h.centers);
            halo.use_vertex_attribute("a_tint", &h.tints);
            halo.use_vertex_attribute("a_corner", &h.corners);
            halo.draw_elements(halo_states, viewport, &h.indices);
        }
    }

    /// The bloom of what glows, then the picture with it onto the screen.
    fn draw_bloom(&self, targets: &PostTargets) {
        let replace = RenderStates {
            write_mask: WriteMask::COLOR,
            depth_test: DepthTest::Always,
            blend: Blend::Disabled,
            cull: Cull::None,
        };
        let add = RenderStates {
            blend: Blend::ADD,
            ..replace
        };
        let texel = |t: &Texture2D| {
            #[allow(clippy::cast_precision_loss)]
            Vec2::new(0.5 / t.width() as f32, 0.5 / t.height() as f32)
        };
        let down = &self.bloom_down;
        let mut source = &targets.resolved;
        for (i, level) in targets.levels.iter().enumerate() {
            down.use_texture("u_source", source);
            down.use_uniform_if_required("u_texel", texel(source));
            down.use_uniform_if_required("u_first", if i == 0 { 1.0_f32 } else { 0.0 });
            let viewport = Viewport::new_at_origo(level.width(), level.height());
            let _ = level
                .as_color_target(None)
                .clear(ClearState::color(0.0, 0.0, 0.0, 1.0))
                .write::<CoreError>(|| {
                    down.draw_arrays(replace, viewport, 3);
                    Ok(())
                });
            source = level;
        }
        let up = &self.bloom_up;
        for pair in targets.levels.windows(2).rev() {
            let (larger, smaller) = (&pair[0], &pair[1]);
            up.use_texture("u_source", smaller);
            up.use_uniform_if_required("u_texel", texel(smaller));
            let viewport = Viewport::new_at_origo(larger.width(), larger.height());
            let _ = larger.as_color_target(None).write::<CoreError>(|| {
                up.draw_arrays(add, viewport, 3);
                Ok(())
            });
        }
        let composite = &self.composite;
        composite.use_texture("u_scene", &targets.resolved);
        if let Some(bloom) = targets.levels.first() {
            composite.use_texture("u_bloom", bloom);
        } else {
            composite.use_texture("u_bloom", &targets.resolved);
        }
        let strength = if targets.levels.is_empty() {
            0.0
        } else {
            self.theme.bloom
        };
        composite.use_uniform_if_required("u_bloom_strength", strength);
        let viewport = Viewport::new_at_origo(self.width, self.height);
        let _ =
            RenderTarget::screen(&self.context, self.width, self.height).write::<CoreError>(|| {
                composite.draw_arrays(replace, viewport, 3);
                Ok(())
            });
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
        self.use_common(&self.pick, &projection.view_proj, false);
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
        let (program, meshes) = (&self.pick, &self.meshes);
        // Through glass walls, what is behind them; their tops stay solid.
        let wall_pass = if self.theme.glass_walls { 1.0_f32 } else { 0.0 };
        let walls = self.walls.as_ref();
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
                for mesh in meshes.iter().flatten() {
                    mesh.draw(program, states, viewport);
                }
                if let Some(walls) = walls {
                    program.use_uniform_if_required("u_wall_pass", wall_pass);
                    walls.draw(program, states, viewport);
                    program.use_uniform_if_required("u_wall_pass", 0.0_f32);
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
    fn the_shaders_know_the_surfaces() {
        use domotwin_core::scene::mesh::Surface;
        let value = |source: &str, name: &str| {
            let at = source.find(&format!("const uint {name} = ")).unwrap() + name.len() + 14;
            source[at..source[at..].find('u').unwrap() + at]
                .parse::<u8>()
                .unwrap()
        };
        let surfaces = [
            ("MATTE", Surface::Matte),
            ("PLANKS", Surface::Planks),
            ("TILES", Surface::Tiles),
            ("SUBWAY", Surface::Subway),
            ("GLASS", Surface::Glass),
            ("GLOW", Surface::Glow),
            ("METAL", Surface::Metal),
            ("FABRIC", Surface::Fabric),
            ("MIRROR", Surface::Mirror),
            ("SCREEN", Surface::Screen),
            ("SHADOW", Surface::Shadow),
            ("WALL_CAP", Surface::WallCap),
            ("FLOOR", Surface::Floor),
            ("WOOD", Surface::Wood),
            ("LEAF", Surface::Leaf),
        ];
        for (name, surface) in surfaces {
            assert_eq!(value(shaders::FRAGMENT, name), surface as u8, "{name}");
        }
        assert_eq!(value(shaders::VERTEX, "WALL_CAP"), Surface::WallCap as u8);
    }

    #[test]
    fn the_sun_sees_the_centre_in_the_middle() {
        let m = sun_matrix([500.0, 0.0, 300.0], 800.0, unit(SUN));
        let p = [500.0_f32, 0.0, 300.0, 1.0];
        let mut out = [0.0_f32; 4];
        for (row, o) in out.iter_mut().enumerate() {
            *o = (0..4).map(|k| m[k * 4 + row] * p[k]).sum();
        }
        assert!(out[0].abs() < 1e-4 && out[1].abs() < 1e-4);
        assert!(out[2] > -1.0 && out[2] < 1.0);
        // Overhead, the projection stays whole.
        let m = sun_matrix([500.0, 0.0, 300.0], 800.0, [0.0, 1.0, 0.0]);
        assert!(m.iter().all(|v| v.is_finite()));
        assert!(m[0].abs() > 1e-6);
    }

    #[test]
    fn the_real_sun_stays_above_the_horizon() {
        assert_eq!(real_sun([0.0; 3]), None);
        assert_eq!(real_sun([f64::NAN, 1.0, 0.0]), None);
        assert_eq!(real_sun([0.0, 2.0, 0.0]), Some([0.0, 1.0, 0.0]));
        assert_eq!(real_sun([0.0, -1.0, 0.0]), Some([0.0, 1.0, 0.0]));
        let low = real_sun([1.0, -0.5, 0.0]).unwrap();
        assert!((low[1] - SUN_MIN_Y).abs() < 1e-12 && low[0] > 0.99);
        assert!((low.iter().map(|c| c * c).sum::<f64>() - 1.0).abs() < 1e-12);
    }
}
