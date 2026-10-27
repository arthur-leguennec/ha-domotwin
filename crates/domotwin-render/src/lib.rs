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
mod weather;

use std::borrow::Cow;
use std::sync::Arc;

use domotwin_core::camera::{Camera, CutawayMode};
use domotwin_core::lighting::Lighting;
use domotwin_core::live::Look;
use domotwin_core::scene::figures::{self, Shape};
use domotwin_core::scene::lines::Line;
use domotwin_core::scene::mesh::Mesh;
use domotwin_core::scene::wires::WireSegment;
use domotwin_core::scene::{LightSpot, MovingParts, Scene, StoreyPart};
use domotwin_core::theme::Theme;
use domotwin_core::weather::Weather;
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

/// How a camera is, for the tone of what it sees.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CameraTone {
    On,
    Recording,
    /// Unavailable, or unknown to Home Assistant.
    Off,
}

impl CameraTone {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::On => "on",
            Self::Recording => "recording",
            Self::Off => "off",
        }
    }
}

/// What a camera sees (D-024, D-038), drawn as a fan on the floor of its room.
#[derive(Debug, Clone, PartialEq)]
pub struct CameraFan {
    /// The storey it is on.
    pub storey: usize,
    /// Where the camera sees from, then the far points across its angle of view, in order (plan
    /// cm).
    pub points: Vec<[f64; 2]>,
    pub tone: CameraTone,
    /// Tapped: drawn whole; else faint.
    pub focused: bool,
}

/// What the cameras see, as triangles of a fan from each camera, all in one draw call.
struct GpuCameraViews {
    /// Plan x and y, then the camera's (plan cm).
    place: VertexBuffer<[f32; 4]>,
    /// Nearness to the two side rays, the tone, focused.
    look: VertexBuffer<[f32; 4]>,
    /// How far the view reaches (cm), the storey.
    reach: VertexBuffer<[f32; 2]>,
    count: u32,
}

impl GpuCameraViews {
    fn new(context: &Context, views: &[CameraFan]) -> Option<Self> {
        let mut place = Vec::new();
        let mut look = Vec::new();
        let mut reaches = Vec::new();
        for view in views {
            let Some((&apex, far)) = view.points.split_first() else {
                continue;
            };
            if far.len() < 2 {
                continue;
            }
            let distance = |p: [f64; 2]| (p[0] - apex[0]).hypot(p[1] - apex[1]);
            let reach = far.iter().copied().map(distance).fold(1.0, f64::max);
            let tone = match view.tone {
                CameraTone::On => 0.0,
                CameraTone::Recording => 1.0,
                CameraTone::Off => 2.0,
            };
            let focus = if view.focused { 1.0 } else { 0.0 };
            let storey = f32::from(
                u8::try_from(view.storey).map_or(MAX_PARTS - 1, |s| s.min(MAX_PARTS - 1)),
            );
            let last = far.len() - 2;
            for (i, pair) in far.windows(2).enumerate() {
                // 0 along a side ray (the first triangle's first edge, the last one's last), 1
                // across from it: the fragment shader draws the rays as lines.
                let first = |k: usize| if i > 0 || k == 2 { 1.0 } else { 0.0 };
                let end = |k: usize| if i < last || k == 1 { 1.0 } else { 0.0 };
                for (k, p) in [apex, pair[0], pair[1]].into_iter().enumerate() {
                    #[allow(clippy::cast_possible_truncation)]
                    {
                        place.push([p[0], p[1], apex[0], apex[1]].map(|v| v as f32));
                        reaches.push([reach as f32, storey]);
                    }
                    look.push([first(k), end(k), tone, focus]);
                }
            }
        }
        if place.is_empty() {
            return None;
        }
        Some(Self {
            count: u32::try_from(place.len()).unwrap_or(u32::MAX),
            place: VertexBuffer::new_with_data(context, &place),
            look: VertexBuffer::new_with_data(context, &look),
            reach: VertexBuffer::new_with_data(context, &reaches),
        })
    }
}

/// How high over its floor a camera's view lies (cm): over the rugs, under everything else.
const CAMERA_VIEW_LIFT: f32 = 3.0;

/// What lies on the floor (people's shadows, cameras' views): blended over it, hidden by what
/// stands on it, the depth kept and the alpha (the glow's, D-027) left as it is.
const ON_THE_FLOOR: RenderStates = RenderStates {
    write_mask: WriteMask::COLOR,
    depth_test: DepthTest::LessOrEqual,
    blend: Blend::Enabled {
        source_rgb_multiplier: BlendMultiplierType::SrcAlpha,
        source_alpha_multiplier: BlendMultiplierType::Zero,
        destination_rgb_multiplier: BlendMultiplierType::OneMinusSrcAlpha,
        destination_alpha_multiplier: BlendMultiplierType::One,
        rgb_equation: BlendEquationType::Add,
        alpha_equation: BlendEquationType::Add,
    },
    cull: Cull::None,
};

/// A person to draw (D-034).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Figure {
    /// The storey they are on.
    pub storey: usize,
    /// Where their feet are on the storey's floor (plan cm: x, height above the floor, y).
    pub at: [f32; 3],
    /// Which way they face (radians on the plan, from +x towards +y).
    pub heading: f32,
    /// Their colour (linear RGB).
    pub color: [f32; 3],
    /// How much they show (0 … 1).
    pub opacity: f32,
    /// What is drawn.
    pub shape: FigureShape,
}

/// What a figure is drawn as.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FigureShape {
    /// A person (D-034).
    Person,
    /// A person as a map pin.
    Pin,
    /// A robot vacuum (D-049).
    Robot,
}

impl Figure {
    /// Fading in or out: shown, but not wholly.
    fn fading(&self) -> bool {
        self.opacity > 0.0 && self.opacity < FULLY_SHOWN
    }
}

/// From this opacity a person is drawn whole; below it, dissolved (the figure shader's
/// `u_dissolve`).
const FULLY_SHOWN: f32 = 0.999;

/// Which passes of a frame are drawn: all, or (with the ink, D-036) what is opaque, then what is
/// seen through or over it.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    Whole,
    /// The background, what is opaque, the people wholly shown.
    Solid,
    /// The people fading, glass, glass walls, the outlines, the halos, the wires.
    SeeThrough,
}

/// Which people a pass draws.
#[derive(Clone, Copy, PartialEq, Eq)]
enum People {
    All,
    /// Those wholly shown.
    Solid,
    /// Those fading in or out.
    Fading,
}

/// A shape of the people on the GPU.
struct GpuShape {
    positions: VertexBuffer<[f32; 3]>,
    normals: VertexBuffer<[f32; 3]>,
    indices: ElementBuffer<u32>,
}

impl GpuShape {
    fn new(context: &Context, shape: &Shape) -> Self {
        Self {
            positions: VertexBuffer::new_with_data(context, &shape.positions),
            normals: VertexBuffer::new_with_data(context, &shape.normals),
            indices: ElementBuffer::new_with_data(context, &shape.indices),
        }
    }

    fn draw(&self, program: &Program, states: RenderStates, viewport: Viewport) {
        program.use_vertex_attribute("a_position", &self.positions);
        if program.requires_attribute("a_normal") {
            program.use_vertex_attribute("a_normal", &self.normals);
        }
        program.draw_elements(states, viewport, &self.indices);
    }
}

/// The figure, the pin and the shadow, uploaded the first time someone is drawn.
struct GpuPeople {
    figure: GpuShape,
    pin: GpuShape,
    robot: GpuShape,
    shadow: GpuShape,
}

/// The radius of a person's shadow (cm).
const SHADOW_RADIUS: f32 = 30.0;
/// The radius of a robot vacuum's shadow (cm): a little wider than it.
const ROBOT_SHADOW_RADIUS: f32 = 21.0;

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

/// The wires drawn over the home (D-031): four corners per straight piece of an arc.
struct GpuWires {
    /// First end and how far along its wire it is.
    a: VertexBuffer<[f32; 4]>,
    /// Second end and the same.
    b: VertexBuffer<[f32; 4]>,
    /// Along (0 or 1), across (−1 or 1) and weight.
    corners: VertexBuffer<[f32; 3]>,
    /// Colour and flow.
    colors: VertexBuffer<[f32; 4]>,
    /// The storeys of the wire's ends, its length and whether it is dashed.
    extras: VertexBuffer<[f32; 4]>,
    indices: ElementBuffer<u32>,
    /// A pulse runs along some of them: frames are needed while they are shown.
    pulsing: bool,
    /// When a one-shot pulse set off along each corner's wire (seconds of the wires' clock;
    /// negative: none), and the wire of each piece, to set them off.
    shots: VertexBuffer<f32>,
    shot_starts: Vec<f32>,
    wire_of: Vec<u32>,
    /// The length of each wire (cm), by its index: how long its pulse takes.
    lengths: Vec<f32>,
}

impl GpuWires {
    fn new(context: &Context, segments: &[WireSegment]) -> Option<Self> {
        if segments.is_empty() {
            return None;
        }
        let n = segments.len() * 4;
        let (mut a, mut b) = (Vec::with_capacity(n), Vec::with_capacity(n));
        let (mut corners, mut colors) = (Vec::with_capacity(n), Vec::with_capacity(n));
        let mut extras = Vec::with_capacity(n);
        let mut indices = Vec::with_capacity(segments.len() * 6);
        let mut wire_of = Vec::with_capacity(segments.len());
        let mut lengths: Vec<f32> = Vec::new();
        for (i, s) in segments.iter().enumerate() {
            let Ok(base) = u32::try_from(i * 4) else {
                break;
            };
            for [along, across] in [[0.0, -1.0], [1.0, -1.0], [1.0, 1.0], [0.0, 1.0]] {
                a.push([s.a[0], s.a[1], s.a[2], s.ta]);
                b.push([s.b[0], s.b[1], s.b[2], s.tb]);
                corners.push([along, across, s.weight]);
                colors.push([s.color[0], s.color[1], s.color[2], s.flow]);
                extras.push([
                    f32::from(s.parts[0].min(MAX_PARTS - 1)),
                    f32::from(s.parts[1].min(MAX_PARTS - 1)),
                    s.length,
                    if s.dashed { 1.0 } else { 0.0 },
                ]);
            }
            indices.extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
            wire_of.push(s.wire);
            let k = s.wire as usize;
            if lengths.len() <= k {
                lengths.resize(k + 1, 0.0);
            }
            lengths[k] = s.length;
        }
        let shot_starts = vec![-1.0; a.len()];
        Some(Self {
            a: VertexBuffer::new_with_data(context, &a),
            b: VertexBuffer::new_with_data(context, &b),
            corners: VertexBuffer::new_with_data(context, &corners),
            colors: VertexBuffer::new_with_data(context, &colors),
            extras: VertexBuffer::new_with_data(context, &extras),
            indices: ElementBuffer::new_with_data(context, &indices),
            pulsing: segments.iter().any(|s| s.flow != 0.0),
            shots: VertexBuffer::new_with_data(context, &shot_starts),
            shot_starts,
            wire_of,
            lengths,
        })
    }

    /// Sets a one-shot pulse off along `wires` (their indices) at `start` (seconds of the wires'
    /// clock). Returns when the last of them is over.
    fn shoot(&mut self, wires: &[u32], start: f32) -> f32 {
        let mut until = start;
        let mut chosen = vec![false; self.lengths.len()];
        for &wire in wires {
            if let Some(c) = chosen.get_mut(wire as usize) {
                *c = true;
            }
        }
        for (piece, wire) in self.wire_of.iter().enumerate() {
            if chosen.get(*wire as usize).copied().unwrap_or(false) {
                self.shot_starts[piece * 4..piece * 4 + 4].fill(start);
                let length = self.lengths.get(*wire as usize).copied().unwrap_or(0.0);
                until = until.max(start + (length + SHOT_LENGTH) / SHOT_SPEED);
            }
        }
        self.shots.fill(&self.shot_starts);
        until
    }

    /// No one-shot pulse any more.
    fn clear_shots(&mut self) {
        if self.shot_starts.iter().any(|&s| s >= 0.0) {
            self.shot_starts.fill(-1.0);
            self.shots.fill(&self.shot_starts);
        }
    }
}

/// A one-shot pulse (an automation that ran) runs at this speed (cm/s)…
const SHOT_SPEED: f32 = 400.0;
/// …and is this long (cm); held still, the wire flashes for [`SHOT_FLASH`] seconds instead.
const SHOT_LENGTH: f32 = 90.0;
const SHOT_FLASH: f32 = 0.6;

/// Which wires: those of the network map (D-031), those of automations (D-032).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WireSet {
    Network = 0,
    Automations = 1,
}

/// The wires' clock (seconds): wrapped once a day, so that a float counts it to a hundredth of a
/// second and a pulse is cut short once a day at most.
#[allow(clippy::cast_possible_truncation)]
fn wire_clock(time_ms: f64) -> f32 {
    (time_ms / 1000.0).rem_euclid(86_400.0) as f32
}

/// Storeys the wire shader moves wire ends with (the integration keeps at most 20).
const MAX_PARTS: u8 = 20;

/// One storey on the GPU (D-028): its meshes, its outlines and its lamps' lights.
#[derive(Default)]
struct GpuPart {
    /// Opaque and moving opaque, then glass and moving glass.
    meshes: [Option<GpuMesh>; 4],
    /// The walls: opaque, or glass faces with opaque tops (D-027).
    walls: Option<GpuMesh>,
    /// The ceilings: drawn in the shadow map with the real sun, and seen when walking (D-029).
    ceiling: Option<GpuMesh>,
    lines: Option<GpuLines>,
    /// The lights of its lamps that are on, where the view draws them.
    lights: Vec<PointLight>,
}

impl GpuPart {
    fn new(context: &Context, part: &StoreyPart) -> Self {
        Self {
            meshes: [
                GpuMesh::new(context, &part.opaque),
                GpuMesh::new(context, &part.dynamic_opaque),
                GpuMesh::new(context, &part.transparent),
                GpuMesh::new(context, &part.dynamic_transparent),
            ],
            walls: GpuMesh::new(context, &part.wall_mesh),
            ceiling: GpuMesh::new(context, &part.ceiling),
            lines: GpuLines::new(context, &part.lines),
            lights: Vec::new(),
        }
    }
}

/// The roof on the GPU, and its outlines.
struct GpuRoof {
    mesh: Option<GpuMesh>,
    lines: Option<GpuLines>,
}

/// The offscreen targets of the bloom (D-027) and the ink (D-036): the picture drawn with MSAA,
/// resolved, its depth for the looks with ink, and the levels of its glow, each half the size of
/// the one before.
struct PostTargets {
    width: u32,
    height: u32,
    scene: RenderTargetMultisample<[u8; 4], f32>,
    resolved: Texture2D,
    depth: Option<DepthTexture2D>,
    /// The bloom's levels (none when nothing glows).
    glow: bool,
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
    wire_program: Program,
    figure_program: Program,
    camera_view_program: Program,
    bloom_down: Program,
    bloom_up: Program,
    composite: Program,
    ink: Program,
    weather_program: Program,
    /// The look (D-027).
    theme: Theme,
    /// The offscreen targets, while the look glows.
    post: Option<PostTargets>,
    /// The storeys of the scene (one for a plan alone), and the roof over the top one.
    parts: Vec<GpuPart>,
    roof: Option<GpuRoof>,
    /// The live look of every element, three texels each (see `lamps::element_texels`).
    elements: Texture2D,
    /// The room layers, three texels per room slot (`domotwin_core::layers::room_texels`).
    rooms: Texture2D,
    /// A room layer is shown (heatmap, alert or presence).
    rooms_shown: bool,
    /// The room layers move (the heatmap's halo, a pulsing alert).
    rooms_animated: bool,
    /// The wires drawn over the home, by [`WireSet`].
    wires: [Option<GpuWires>; 2],
    /// The people (D-034), and their shapes once one is drawn.
    figures: Vec<Figure>,
    camera_views: Option<GpuCameraViews>,
    people: Option<GpuPeople>,
    /// The frames' clock at the last frame, and when the last one-shot pulse is over (ms).
    frame_ms: f64,
    shots_until_ms: f64,
    /// The power layer is shown.
    power_layer: bool,
    /// Where each element's upkeep stands (D-033: 0 no card or no task, 1 fine, 2 due soon,
    /// 3 overdue), and whether the upkeep layer tints them.
    upkeep: Vec<u8>,
    upkeep_layer: bool,
    /// Layers may move (off when the user prefers reduced motion).
    motion: bool,
    /// Direction towards the real sun (unit), when its position is used; else [`SUN`].
    sun: Option<[f64; 3]>,
    /// The looks and edit marks it holds.
    looks: Vec<Look>,
    marks: Vec<Mark>,
    spots: Vec<LightSpot>,
    halos: Option<GpuHalos>,
    shadow: Option<ShadowMap>,
    /// The shadow map must be drawn again (scene, moving parts, sun or quality changed); the
    /// view says when the cut-away changed (`ViewState::shadows_dirty`).
    shadow_stale: bool,
    /// Whether the shadow map was drawn with the ceilings (see `roofed`).
    shadow_roofed: bool,
    /// What the shadow sampler points at without shadows. Created once: creating a texture
    /// binds it to the active unit, which would replace a texture bound for the frame.
    no_shadow: DepthTexture2D,
    pick_target: Option<PickTarget>,
    lighting: Lighting,
    /// The weather around the home (D-067), the footprint things fall around, and how bright a
    /// storm's flash is this frame.
    weather: Weather,
    footprint: Option<weather::Footprint>,
    flash: f32,
    /// How far the view is on its way to the plan this frame (what falls is not drawn on it).
    flat: f32,
    /// What the view shows and how it moves.
    pub view: ViewState,
}

impl std::fmt::Debug for Renderer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Renderer")
            .field("width", &self.width)
            .field("height", &self.height)
            .field("quality", &self.quality)
            .field("storeys", &self.parts.len())
            .field("lights", &self.light_count())
            .finish_non_exhaustive()
    }
}

/// Draws what `program` draws next moved by `offset` cm (a storey of a home, D-028).
#[allow(clippy::cast_possible_truncation)]
fn set_offset(program: &Program, offset: [f64; 3]) {
    let [x, y, z] = offset.map(|v| v as f32);
    program.use_uniform_if_required("u_offset", Vec3::new(x, y, z));
}

/// No offset: the geometry where it stands.
const NO_OFFSET: [f64; 3] = [0.0; 3];

/// A storey as a frame draws it: its meshes, where, and the lights that light it.
type Drawn<'a> = (&'a GpuPart, [f64; 3], Cow<'a, [PointLight]>);

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
    rows_texture(context, width, 1, texels)
}

/// A float texture of `width` × `height` texels, row 0 first, read with `texelFetch`.
fn rows_texture(context: &Context, width: u32, height: u32, texels: &[[f32; 4]]) -> Texture2D {
    let texture = Texture2D::new_empty::<[f32; 4]>(
        context,
        width,
        height,
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
        let wire_program =
            Program::from_source(&context, shaders::WIRE_VERTEX, shaders::WIRE_FRAGMENT)?;
        let figure_program =
            Program::from_source(&context, shaders::FIGURE_VERTEX, shaders::FIGURE_FRAGMENT)?;
        let camera_view_program = Program::from_source(
            &context,
            shaders::CAMERA_VIEW_VERTEX,
            shaders::CAMERA_VIEW_FRAGMENT,
        )?;
        let bloom_down = Program::from_source(&context, full, shaders::BLOOM_DOWN)?;
        let bloom_up = Program::from_source(&context, full, shaders::BLOOM_UP)?;
        let composite = Program::from_source(&context, full, shaders::COMPOSITE)?;
        let ink = Program::from_source(&context, full, shaders::INK)?;
        let weather_program =
            Program::from_source(&context, shaders::WEATHER_VERTEX, shaders::WEATHER_FRAGMENT)?;
        let (columns, rows, texels) = lamps::element_rows(lamps::element_texels(&[], &[], &[]));
        let elements = rows_texture(&context, columns, rows, &texels);
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
            wire_program,
            figure_program,
            camera_view_program,
            bloom_down,
            bloom_up,
            composite,
            ink,
            weather_program,
            theme: Theme::default(),
            post: None,
            parts: Vec::new(),
            roof: None,
            elements,
            rooms,
            rooms_shown: false,
            rooms_animated: false,
            wires: [None, None],
            figures: Vec::new(),
            camera_views: None,
            people: None,
            frame_ms: 0.0,
            shots_until_ms: 0.0,
            power_layer: false,
            upkeep: Vec::new(),
            upkeep_layer: false,
            motion: true,
            sun: None,
            looks: Vec::new(),
            marks: Vec::new(),
            spots: Vec::new(),
            halos: None,
            shadow: None,
            shadow_stale: true,
            shadow_roofed: false,
            no_shadow,
            pick_target: None,
            lighting: Lighting::default(),
            weather: Weather::CLEAR,
            footprint: None,
            flash: 0.0,
            flat: 0.0,
            view,
        })
    }

    /// Uploads a scene. The camera frames it unless `keep_camera`.
    pub fn set_scene(&mut self, scene: &Scene, keep_camera: bool) {
        self.parts = scene
            .parts
            .iter()
            .map(|part| GpuPart::new(&self.context, part))
            .collect();
        self.roof = scene.roof.as_ref().map(|roof| GpuRoof {
            mesh: GpuMesh::new(&self.context, &roof.mesh),
            lines: GpuLines::new(&self.context, &roof.lines),
        });
        self.shadow_stale = true;
        self.spots.clone_from(&scene.lights);
        self.footprint = weather::Footprint::of(scene);
        self.view.set_scene(scene, keep_camera);
        self.relight();
    }

    /// Draws nothing but the background (no plan shown any more).
    pub fn clear_scene(&mut self) {
        self.parts.clear();
        self.roof = None;
        self.footprint = None;
        self.spots.clear();
        self.camera_views = None;
        self.shadow_stale = true;
        self.view.dirty = true;
        self.relight();
    }

    /// Uploads the moving parts of each storey again (doors, windows, curtains, blinds moved).
    pub fn set_moving_parts(&mut self, parts: &[MovingParts]) {
        for (gpu, (opaque, transparent)) in self.parts.iter_mut().zip(parts) {
            GpuMesh::replace(&mut gpu.meshes[1], &self.context, opaque);
            GpuMesh::replace(&mut gpu.meshes[3], &self.context, transparent);
        }
        self.shadow_stale = true;
        self.view.dirty = true;
    }

    /// Spreads the storeys of a home apart, or stacks them (animated from `now`).
    pub fn set_spread(&mut self, spread: bool, now: f64) {
        self.view.set_spread(spread, now);
    }

    /// Shows or hides the roof over the top storey.
    pub fn set_roof(&mut self, shown: bool) {
        self.view.set_roof(shown);
        self.relight();
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
        let (width, height, texels) = lamps::element_rows(lamps::element_texels(
            &self.looks,
            &self.marks,
            &self.upkeep,
        ));
        if (self.elements.width(), self.elements.height()) == (width, height) {
            self.elements.fill(&texels);
        } else {
            self.elements = rows_texture(&self.context, width, height, &texels);
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

    /// Sets where each element's upkeep stands, by element index (`element_texels`).
    pub fn set_upkeep(&mut self, states: &[u8]) {
        if states != self.upkeep.as_slice() {
            self.upkeep = states.to_vec();
            self.upload_elements();
        }
    }

    /// Shows or hides the upkeep layer (D-033): the pieces tinted by where their upkeep stands.
    pub fn set_upkeep_layer(&mut self, shown: bool) {
        if shown != self.upkeep_layer {
            self.upkeep_layer = shown;
            self.view.dirty = true;
        }
    }

    /// Lets the layers move, or holds them still (reduced motion).
    pub fn set_motion(&mut self, motion: bool) {
        if motion != self.motion {
            self.motion = motion;
            self.view.still = !motion;
            self.view.dirty = true;
        }
    }

    /// Whether things may move (the user does not prefer reduced motion).
    pub const fn motion(&self) -> bool {
        self.motion
    }

    /// The clock (ms) of the last frame drawn.
    pub const fn frame_ms(&self) -> f64 {
        self.frame_ms
    }

    /// Whether the layers shown move: frames are then needed all the time (the frontend slows
    /// them down).
    pub fn layers_animating(&self) -> bool {
        // A one-shot pulse runs, or its flash fades under reduce motion: frames until it is over.
        let shot = self.frame_ms < self.shots_until_ms;
        shot || self.motion
            && (self.rooms_animated
                || self.wires.iter().flatten().any(|w| w.pulsing)
                || (self.power_layer
                    && self.looks.iter().any(|l| lamps::power_level(l.power) > 0.0))
                || self.weather_moving())
    }

    /// Sets the weather around the home (D-067).
    pub fn set_weather(&mut self, weather: Weather) {
        if weather != self.weather {
            self.weather = weather;
            self.view.dirty = true;
        }
    }

    /// The weather around the home.
    pub fn weather(&self) -> Weather {
        self.weather
    }

    /// How thick the weather's fog is, from 0 (none) to 1: none at eye level, walking inside.
    fn fog(&self) -> f32 {
        if self.view.walking() || self.view.camera.walk > 0.0 {
            return 0.0;
        }
        #[allow(clippy::cast_possible_truncation)]
        let fog = (self.weather.fog.clamp(0.0, 1.0) * 0.85) as f32;
        fog
    }

    /// Whether what falls is drawn: something falls, around a home, in 3D (not on the plan).
    fn weather_drawn(&self) -> bool {
        self.footprint.is_some()
            && !self.view.plan_view
            && self.flat < 0.5
            && weather::particles(&self.weather, self.quality) > 0
    }

    /// Whether the weather moves: something falling is drawn, or a storm flashes (in 3D only).
    fn weather_moving(&self) -> bool {
        let storm = self.weather.lightning
            && self.footprint.is_some()
            && !self.view.plan_view
            && self.flat < 0.5;
        self.weather.animated() && (self.weather_drawn() || storm)
    }

    /// Sets what the weather's program needs for a frame (D-067).
    fn set_weather_uniforms(&self, projection: &domotwin_core::camera::Projection, time_ms: f64) {
        let Some(footprint) = self.footprint.filter(|_| self.weather_drawn()) else {
            return;
        };
        let program = &self.weather_program;
        #[allow(clippy::cast_possible_truncation)]
        let f = |v: f64| v as f32;
        let v3 = |v: [f64; 3]| Vec3::new(f(v[0]), f(v[1]), f(v[2]));
        program.use_uniform_if_required("u_view_proj", mat4(&projection.view_proj));
        program.use_uniform_if_required("u_eye", v3(projection.eye));
        #[allow(clippy::cast_precision_loss)]
        program.use_uniform_if_required(
            "u_viewport",
            Vec2::new(self.width as f32, self.height as f32),
        );
        program.use_uniform_if_required("u_line", self.pixel_scale() * 1.2);
        // Under reduced motion, what falls holds still: a picture of the rain. The shader's turns
        // fit whole in its loop.
        let time = if self.motion {
            (time_ms / 1000.0).rem_euclid(weather::LOOP_S)
        } else {
            37.0
        };
        program.use_uniform_if_required("u_time", f(time));
        program.use_uniform_if_required("u_loop", f(weather::LOOP_S));
        let [cx, cz] = footprint.centre;
        program.use_uniform_if_required("u_area", Vec4::new(f(cx), f(cz), 1.0, 0.0));
        program.use_uniform_if_required(
            "u_half",
            Vec3::new(
                f(footprint.half[0]),
                f(footprint.half[1]),
                f(footprint.margin()),
            ),
        );
        // From above the highest the home stands, spread or not: the same turns while it moves.
        let [lo, hi] = self.view.bounds;
        program.use_uniform_if_required(
            "u_heights",
            Vec2::new(f(self.view.highest() + 200.0), f(GROUND_Y)),
        );
        program.use_uniform_if_required("u_home", Vec2::new(f(lo[1]), f(hi[1])));
        // On the roof when it is shown, else outside the walls only.
        let roof = footprint.roof.zip(self.view.roof_offset());
        let (roof_at, area, shape) = match roof {
            Some((shape, offset)) => (
                Vec4::new(f(offset[0]), f(offset[1]), f(offset[2]), 1.0),
                Vec4::new(
                    f(shape.centre[0]),
                    f(shape.centre[1]),
                    f(shape.ridge[0]),
                    f(shape.ridge[1]),
                ),
                Vec4::new(
                    f(shape.half_length),
                    f(shape.half_width),
                    f(shape.eaves),
                    f(shape.rise),
                ),
            ),
            None => (
                Vec4::new(0.0, 0.0, 0.0, 0.0),
                Vec4::new(0.0, 0.0, 1.0, 0.0),
                Vec4::new(1.0, 1.0, 0.0, 0.0),
            ),
        };
        program.use_uniform_if_required("u_roof", roof_at);
        program.use_uniform_if_required("u_roof_area", area);
        program.use_uniform_if_required("u_roof_shape", shape);
        let [wx, wz] = self.weather.wind;
        program.use_uniform_if_required("u_wind", Vec2::new(f(wx), f(wz)));
        let (kind, speed) = weather::fall(&self.weather);
        let drips = if roof.is_some() { 0.15 } else { 0.0 };
        let splashes = if matches!(self.quality, QualityPreset::Eco) {
            0.0
        } else {
            1.0
        };
        program.use_uniform_if_required("u_fall", Vec4::new(kind, speed, drips, splashes));
        // Against the ground it mostly falls in front of.
        let [r, g, b, a] = weather::tint(self.backdrop_of_look().2);
        program.use_uniform_if_required("u_tint", Vec4::new(r, g, b, a));
        program.use_uniform_if_required("u_flash", self.flash);
    }

    /// Draws what falls around the home (D-067): over the home, hidden behind it, writing no
    /// depth and leaving the glow below as it is.
    fn draw_weather(&self, viewport: Viewport) {
        if !self.weather_drawn() {
            return;
        }
        let count = weather::particles(&self.weather, self.quality);
        self.weather_program
            .draw_arrays_instanced(ON_THE_FLOOR, viewport, 6, count);
    }

    /// Draws `segments` as the wires of `set` (none: no wires), each end moved with its storey
    /// (D-031).
    pub fn set_wires(&mut self, set: WireSet, segments: &[WireSegment]) {
        self.wires[set as usize] = GpuWires::new(&self.context, segments);
        self.view.dirty = true;
    }

    /// Sets a one-shot pulse off along `wires` of `set` (their indices in the wires given), from
    /// each one's start to its end, at `time_ms` (the frames' clock). Held still (reduce motion),
    /// the wires flash instead.
    pub fn shoot_wires(&mut self, set: WireSet, wires: &[u32], time_ms: f64) {
        let start = wire_clock(time_ms);
        if let Some(w) = self.wires[set as usize].as_mut() {
            let lasts = (w.shoot(wires, start) - start).max(SHOT_FLASH);
            self.shots_until_ms = self.shots_until_ms.max(time_ms + f64::from(lasts) * 1000.0);
            self.view.dirty = true;
        }
    }

    /// What the cameras see (D-038); none: nothing drawn.
    pub fn set_camera_fans(&mut self, fans: &[CameraFan]) {
        self.camera_views = GpuCameraViews::new(&self.context, fans);
        self.view.dirty = true;
    }

    /// Whether what the cameras see is drawn: not at eye level, nor on the way to it or back
    /// (D-038).
    pub fn camera_fans_drawable(&self) -> bool {
        !self.view.walking() && self.view.camera.walk <= 0.0
    }

    /// The people to draw (D-034), where they are now.
    pub fn set_figures(&mut self, figures: Vec<Figure>) {
        if figures == self.figures {
            return;
        }
        if !figures.is_empty() && self.people.is_none() {
            self.people = Some(GpuPeople {
                figure: GpuShape::new(&self.context, &figures::figure()),
                pin: GpuShape::new(&self.context, &figures::pin()),
                robot: GpuShape::new(&self.context, &figures::robot()),
                shadow: GpuShape::new(&self.context, &figures::shadow()),
            });
        }
        self.figures = figures;
        self.view.dirty = true;
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

    /// Places the lamps' lights and halos where the view draws their storeys.
    fn relight(&mut self) {
        // Each storey's lamps are worked out on its own floor (how high a bulb is decides its
        // reach and its halo), then moved to where the storey is drawn.
        let mut halos = Vec::new();
        for (k, part) in self.parts.iter_mut().enumerate() {
            #[allow(clippy::cast_possible_truncation)]
            let offset = self.view.offset(k).map(|v| v as f32);
            let moved = |p: &mut [f32; 3]| {
                for (v, o) in p.iter_mut().zip(offset) {
                    *v += o;
                }
            };
            let own: Vec<LightSpot> = self
                .spots
                .iter()
                .filter(|s| s.storey == k)
                .copied()
                .collect();
            part.lights = lamps::point_lights(&own, &self.looks);
            for light in &mut part.lights {
                moved(&mut light.position);
            }
            halos.extend(lamps::halos(&own, &self.looks).into_iter().map(|mut halo| {
                moved(&mut halo.center);
                halo
            }));
        }
        self.halos = GpuHalos::new(&self.context, &halos);
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
        self.parts.iter().map(|p| p.lights.len()).sum()
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
            self.view.set_aspect(f64::from(width) / f64::from(height));
        }
    }

    /// Where a world point is drawn now: device pixels from the top left, `None` when it is
    /// behind the camera.
    pub fn screen_point(&self, point: [f64; 3]) -> Option<[f64; 2]> {
        let m = self
            .view
            .camera
            .projection(self.view.aspect, self.view.depth())
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

    /// Whether the rooms have their ceilings in the sun's way: with the real sun (it comes in
    /// through the windows), and walking under the ceilings drawn (D-029).
    fn roofed(&self) -> bool {
        self.sun.is_some() || (self.view.walking() && !self.theme.glass_walls)
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
        // The real sun comes in through the windows only, and so does the sun of a walk under the
        // ceilings: whole walls and the ceilings cast shadows, whatever the cut-away shows.
        let real = self.roofed();
        self.shadow_roofed = real;
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
        let (depth, parts, view) = (&self.depth, &self.parts, &self.view);
        let _ = shadow
            .texture
            .as_depth_target()
            .clear(ClearState::depth(1.0))
            .write::<CoreError>(|| {
                for (k, part) in parts.iter().enumerate() {
                    set_offset(depth, view.offset(k));
                    let ceiling = part.ceiling.as_ref().filter(|_| real);
                    for mesh in part.meshes[..2]
                        .iter()
                        .chain([&part.walls])
                        .flatten()
                        .chain(ceiling)
                    {
                        mesh.draw(depth, states, viewport);
                    }
                }
                set_offset(depth, NO_OFFSET);
                Ok(())
            });
    }

    /// Whether frames are drawn offscreen: for the bloom (D-027) or the ink (D-036), on GPUs that
    /// can afford it.
    fn post_on(&self) -> bool {
        self.glow_on() || self.ink_on()
    }

    /// Whether frames are drawn offscreen, with the bloom, with the ink (D-027, D-036).
    pub fn effects(&self) -> (bool, bool, bool) {
        (self.post_on(), self.glow_on(), self.ink_on())
    }

    /// Whether what glows blooms: on High, and from Balanced for the looks that say so.
    fn glow_on(&self) -> bool {
        self.theme.bloom > 0.0
            && match self.quality {
                QualityPreset::Eco => false,
                QualityPreset::Balanced => self.theme.bloom_on_balanced,
                QualityPreset::High => true,
            }
    }

    /// Whether the look's ink is drawn (D-036): from the Balanced preset up.
    fn ink_on(&self) -> bool {
        self.theme.outline > 0.0 && self.quality != QualityPreset::Eco
    }

    /// The offscreen targets at the size of the view, made again when it changed.
    fn ensure_post(&mut self) {
        let (width, height) = (self.width, self.height);
        let ink = self.ink_on();
        let glow = self.glow_on();
        if self.post.as_ref().is_some_and(|p| {
            (p.width, p.height, p.depth.is_some(), p.glow) == (width, height, ink, glow)
        }) {
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
        while glow && levels.len() < BLOOM_LEVELS && w.min(h) >= 8 {
            levels.push(texture(w, h));
            (w, h) = (w / 2, h / 2);
        }
        self.post = Some(PostTargets {
            width,
            height,
            scene: RenderTargetMultisample::new(&self.context, width, height, MSAA_SAMPLES),
            resolved: texture(width, height),
            depth: ink.then(|| {
                DepthTexture2D::new::<f32>(
                    &self.context,
                    width.max(1),
                    height.max(1),
                    Wrapping::ClampToEdge,
                    Wrapping::ClampToEdge,
                )
            }),
            glow,
            levels,
        });
    }

    /// The light of the scene: the look's own, else the time of day's, greyed by the clouds
    /// (D-067).
    fn light(&self) -> Lighting {
        match self.theme.lighting {
            Some(own) => own,
            None => weather::overcast(self.lighting, self.clouds()),
        }
    }

    /// How cloudy the sky is drawn (D-067): not on the plan.
    fn clouds(&self) -> f64 {
        self.weather.overcast * f64::from(1.0 - self.flat)
    }

    /// The exposure of a frame: the light's, brighter for a storm's flash.
    fn exposure(&self) -> f32 {
        self.light().exposure * (1.0 + 1.4 * self.flash)
    }

    /// The background's colours: the look's own (the night looks, D-027), or dimming with the light
    /// of the time of day: the day look's shades of the dashboard's colours (its sky kept), the
    /// sky and lawn of the cartoon and the clay's backdrop (D-036).
    fn backdrop(&self) -> ([f32; 3], [f32; 3], [f32; 3], [f32; 3]) {
        let (top, horizon, ground, grid) = self.backdrop_of_look();
        let lit = |c: [f32; 3]| weather::flashed(c, self.flash);
        (lit(top), lit(horizon), lit(ground), lit(grid))
    }

    /// The background's colours before a storm's flash: see [`Renderer::backdrop`].
    fn backdrop_of_look(&self) -> ([f32; 3], [f32; 3], [f32; 3], [f32; 3]) {
        let t = &self.theme;
        if !t.follows_time() {
            return (t.sky_top, t.sky_horizon, t.ground, t.grid);
        }
        let sky = self.light().sky;
        let daylight = Lighting::default().sky;
        let luma = weather::luma;
        let dim = (luma(sky) / luma(daylight).max(1e-3))
            .sqrt()
            .clamp(0.4, 1.0);
        if !t.sky_from_dashboard {
            let cover = self.clouds();
            let shade = |c: [f32; 3], k: f32| weather::grey(c.map(|v| v * k), cover);
            return (
                shade(t.sky_top, dim),
                shade(t.sky_horizon, dim),
                shade(t.ground, dim),
                shade(t.grid, dim),
            );
        }
        let Rgb { r, g, b } = self.background;
        let shade = |k: f32| [r * k, g * k, b * k];
        (shade(1.0), shade(0.95), shade(0.93 * dim), shade(0.8 * dim))
    }

    /// Width of the lines in device pixels.
    fn line_width(&self) -> f32 {
        self.pixel_scale() * self.theme.line_width
    }

    /// A line's usual width in device pixels: wider on larger views.
    fn pixel_scale(&self) -> f32 {
        #[allow(clippy::cast_precision_loss)]
        let side = self.width.min(self.height) as f32;
        (side / 650.0).clamp(1.0, 3.0)
    }

    /// Draws one frame at `time_ms`. Returns `true` while an animation needs more frames.
    pub fn render(&mut self, time_ms: f64) -> bool {
        self.frame_ms = time_ms;
        if self.shots_until_ms > 0.0 && time_ms >= self.shots_until_ms {
            // The pulses are over: forgotten, so that none comes back when the wires' clock
            // comes round again.
            for w in self.wires.iter_mut().flatten() {
                w.clear_shots();
            }
            self.shots_until_ms = 0.0;
        }
        let moving = self.view.storeys_moving();
        let animating = self.view.update(time_ms);
        if moving {
            // The lamps and the shadows go up and down with their storeys.
            self.relight();
            self.shadow_stale = true;
        }
        let cuts_moved = std::mem::take(&mut self.view.shadows_dirty);
        // Under the ceilings the shadow map draws whole walls: the cut-away does not change it.
        // Night looks have no sun shadows.
        let roofed = self.roofed();
        if !self.theme.shadows {
            self.shadow = None;
        } else if self.shadow_stale || roofed != self.shadow_roofed || (cuts_moved && !roofed) {
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
            .projection(self.view.aspect, self.view.depth());
        #[allow(clippy::cast_possible_truncation)]
        let flat = self.view.camera.ortho.clamp(0.0, 1.0) as f32;
        self.flat = flat;
        #[allow(clippy::cast_possible_truncation)]
        let flash = if self.weather.lightning && self.motion && flat < 0.5 {
            domotwin_core::weather::flash(time_ms / 1000.0) as f32
        } else {
            0.0
        };
        self.flash = flash;
        let gain = self.set_main_uniforms(&projection, time_ms, flat, post);
        self.set_weather_uniforms(&projection, time_ms);
        self.set_background_uniforms(&projection.view_proj, post, flat < 0.5);
        self.set_line_uniforms(&projection);
        let offsets = self.part_offsets();
        self.set_wire_uniforms(&projection, time_ms, &offsets);
        self.set_figure_uniforms(&projection, flat, post);
        self.set_camera_view_uniforms(&projection, flat, &offsets);
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
            // With the ink (D-036): what is opaque, then the ink read from its depth, then what is
            // seen through or over it, so that no ink crosses glass, outlines, halos or wires.
            let first = if targets.depth.is_some() {
                Phase::Solid
            } else {
                Phase::Whole
            };
            let _ = targets
                .scene
                .clear(ClearState::color_and_depth(r, g, b, 0.0, 1.0))
                .write::<CoreError>(|| {
                    self.draw_passes(viewport, None, first);
                    Ok(())
                });
            if let Some(depth) = targets.depth.as_ref() {
                targets.scene.resolve_depth_to(&depth.as_depth_target());
                let _ = targets.scene.write::<CoreError>(|| {
                    self.draw_ink(viewport, depth, &projection);
                    self.draw_passes(viewport, None, Phase::SeeThrough);
                    Ok(())
                });
            }
            targets
                .scene
                .resolve_color_to(&targets.resolved.as_color_target(None));
            self.draw_bloom(targets);
        } else {
            let _ = RenderTarget::screen(&self.context, self.width, self.height)
                .clear(ClearState::color_and_depth(r, g, b, 1.0, 1.0))
                .write::<CoreError>(|| {
                    self.draw_passes(viewport, None, Phase::Whole);
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
        program.use_uniform_if_required("u_upkeep_layer", on(self.upkeep_layer));
        program.use_uniform_if_required("u_motion", on(self.motion));
        program.use_uniform_if_required("u_bounce", if self.roofed() { 0.16_f32 } else { 0.0 });
        // Every wave of the layers repeats within 600 s; f32 keeps them smooth over that.
        #[allow(clippy::cast_possible_truncation)]
        program.use_uniform_if_required("u_time", ((time_ms / 1000.0).rem_euclid(600.0)) as f32);
        program.use_uniform_if_required("u_flat", flat);
        let light = self.light();
        let rgb = |c: [f32; 3]| Vec3::new(c[0], c[1], c[2]);
        program.use_uniform_if_required("u_sky", rgb(light.sky));
        program.use_uniform_if_required("u_ground", rgb(light.ground));
        program.use_uniform_if_required("u_sun_color", rgb(light.sun));
        program.use_uniform_if_required("u_exposure", self.exposure());
        program.use_uniform_if_required("u_ao", light.ao);
        // The weather's fog fades into the horizon (D-067), around the home.
        program.use_uniform_if_required("u_fog", self.fog());
        let [cx, _, cz] = self.view.centre();
        #[allow(clippy::cast_possible_truncation)]
        program.use_uniform_if_required(
            "u_fog_area",
            Vec3::new(cx as f32, cz as f32, self.view.radius().max(300.0) as f32),
        );
        let horizon = self.backdrop().1;
        program
            .use_uniform_if_required("u_fog_color", Vec3::new(horizon[0], horizon[1], horizon[2]));
        let t = &self.theme;
        program.use_uniform_if_required("u_glass_walls", on(t.glass_walls));
        program.use_uniform_if_required("u_wall_pass", 0.0_f32);
        program.use_uniform_if_required("u_wall_tint", rgb(t.wall_tint));
        program.use_uniform_if_required("u_wall_alpha", t.wall_alpha);
        program.use_uniform_if_required("u_wall_cap", rgb(t.wall_cap));
        program.use_uniform_if_required("u_tint", t.tint);
        program.use_uniform_if_required("u_palette", rgb(t.palette));
        program.use_uniform_if_required("u_leaf_tint", t.leaf_tint);
        program.use_uniform_if_required("u_floor_tint", t.floor_tint);
        program.use_uniform_if_required("u_floor_palette", rgb(t.floor_palette));
        program.use_uniform_if_required("u_plan_floor", rgb(t.plan_floor.unwrap_or_default()));
        program.use_uniform_if_required("u_plan_floors", on(t.plan_floor.is_some()));
        program.use_uniform_if_required("u_plan_cap", rgb(t.plan_cap));
        let shading = &t.shading;
        program.use_uniform_if_required("u_tint_contrast", shading.tint_contrast);
        program.use_uniform_if_required("u_bands", shading.bands);
        program.use_uniform_if_required("u_saturation", shading.saturation);
        program.use_uniform_if_required("u_flatten", shading.flatten);
        program.use_uniform_if_required("u_rim_ink", shading.rim_ink);
        program.use_uniform_if_required("u_specular", shading.specular);
        program.use_uniform_if_required("u_glow_alpha", on(post));
        // Lamps and halos count less in daylight: a lamp lit at noon barely shows indoors.
        let gain = light.lamp_gain();
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
        program.use_uniform_if_required(
            "u_grid_dots",
            if self.theme.grid_dots { 1.0_f32 } else { 0.0 },
        );
        #[allow(clippy::cast_possible_truncation)]
        program.use_uniform_if_required("u_ground_y", GROUND_Y as f32);
        let [cx, _, cz] = self.view.centre();
        #[allow(clippy::cast_possible_truncation)]
        program.use_uniform_if_required("u_centre", Vec2::new(cx as f32, cz as f32));
        #[allow(clippy::cast_possible_truncation)]
        program.use_uniform_if_required("u_radius", self.view.radius().max(300.0) as f32);
        program.use_uniform_if_required("u_glow_alpha", if post { 1.0_f32 } else { 0.0 });
        program.use_uniform_if_required("u_fog", self.fog() * (1.0 - self.flat));
        let sun_left = if self.theme.follows_time() {
            weather::sun_left(self.clouds())
        } else {
            1.0
        };
        program.use_uniform_if_required("u_sun_left", sun_left);
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
            program.use_uniform_if_required("u_line_lift", lift as f32);
        }
        #[allow(clippy::cast_precision_loss)]
        program.use_uniform_if_required(
            "u_viewport",
            Vec2::new(self.width as f32, self.height as f32),
        );
        program.use_uniform_if_required("u_line_width", self.line_width());
        program.use_uniform_if_required("u_line_rise", self.theme.line_rise);
        let t = &self.theme;
        program.use_uniform_if_required("u_line_color", Vec3::new(t.line[0], t.line[1], t.line[2]));
        program.use_uniform_if_required("u_line_strength", t.line_strength);
        program.use_uniform_if_required("u_line_glow", t.line_glow);
        program.use_uniform_if_required("u_dark_lines", if t.dark_lines { 1.0_f32 } else { 0.0 });
    }

    /// Where each storey is drawn now (D-028), for the shaders' `u_offsets`: once a frame.
    fn part_offsets(&self) -> Vec<Vec4> {
        #[allow(clippy::cast_possible_truncation)]
        (0..usize::from(MAX_PARTS))
            .map(|k| {
                let [x, y, z] = self.view.offset(k).map(|v| v as f32);
                Vec4::new(x, y, z, 0.0)
            })
            .collect()
    }

    fn set_wire_uniforms(
        &self,
        projection: &domotwin_core::camera::Projection,
        time_ms: f64,
        offsets: &[Vec4],
    ) {
        if self.wires.iter().all(Option::is_none) {
            return;
        }
        let program = &self.wire_program;
        program.use_uniform_if_required("u_view_proj", mat4(&projection.view_proj));
        #[allow(clippy::cast_precision_loss)]
        program.use_uniform_if_required(
            "u_viewport",
            Vec2::new(self.width as f32, self.height as f32),
        );
        program.use_uniform_if_required("u_wire_width", (self.line_width() * 1.6).max(2.5));
        program.use_uniform_array("u_offsets", offsets);
        program.use_uniform_if_required("u_time", wire_clock(time_ms));
        program.use_uniform_if_required("u_motion", if self.motion { 1.0_f32 } else { 0.0 });
    }

    fn set_camera_view_uniforms(
        &self,
        projection: &domotwin_core::camera::Projection,
        flat: f32,
        offsets: &[Vec4],
    ) {
        if self.camera_views.is_none() {
            return;
        }
        let program = &self.camera_view_program;
        program.use_uniform_if_required("u_view_proj", mat4(&projection.view_proj));
        program.use_uniform_array("u_offsets", offsets);
        program.use_uniform_if_required("u_lift", CAMERA_VIEW_LIFT);
        program.use_uniform_if_required("u_flat", flat);
        let [r, g, b] = self.theme.accent;
        let tones = [
            Vec3::new(r, g, b),
            Vec3::new(0.90, 0.22, 0.21),
            Vec3::new(0.55, 0.58, 0.62),
        ];
        program.use_uniform_array("u_tones", &tones);
    }

    fn set_figure_uniforms(
        &self,
        projection: &domotwin_core::camera::Projection,
        flat: f32,
        post: bool,
    ) {
        if self.figures.is_empty() {
            return;
        }
        let program = &self.figure_program;
        #[allow(clippy::cast_possible_truncation)]
        let v3 = |v: [f64; 3]| Vec3::new(v[0] as f32, v[1] as f32, v[2] as f32);
        let rgb = |c: [f32; 3]| Vec3::new(c[0], c[1], c[2]);
        let light = self.light();
        program.use_uniform_if_required("u_view_proj", mat4(&projection.view_proj));
        program.use_uniform_if_required("u_eye", v3(projection.eye));
        program.use_uniform_if_required("u_sun", v3(self.sun_direction()));
        program.use_uniform_if_required("u_sun_color", rgb(light.sun));
        program.use_uniform_if_required("u_sky", rgb(light.sky));
        program.use_uniform_if_required("u_ground", rgb(light.ground));
        program.use_uniform_if_required("u_exposure", self.exposure());
        program.use_uniform_if_required("u_glow", self.theme.line_glow.min(1.0));
        program.use_uniform_if_required("u_glow_alpha", if post { 1.0_f32 } else { 0.0 });
        program.use_uniform_if_required("u_flat", flat);
        program.use_uniform_if_required("u_bands", self.theme.shading.bands);
        program.use_uniform_if_required("u_saturation", self.theme.shading.saturation);
    }

    /// The people (D-034): their shadows, then them, in the depth of the picture.
    fn draw_people(&self, viewport: Viewport, which: People) {
        let Some(shapes) = self.people.as_ref() else {
            return;
        };
        let program = &self.figure_program;
        let shadow_states = ON_THE_FLOOR;
        let body_states = RenderStates {
            write_mask: WriteMask::COLOR_AND_DEPTH,
            depth_test: DepthTest::Less,
            blend: Blend::Disabled,
            cull: Cull::Back,
        };
        #[allow(clippy::cast_possible_truncation)]
        let placed = |f: &Figure, lift: f32| {
            let [x, y, z] = self
                .view
                .place(
                    f.storey,
                    [
                        f64::from(f.at[0]),
                        f64::from(f.at[1] + lift),
                        f64::from(f.at[2]),
                    ],
                )
                .map(|v| v as f32);
            Vec4::new(x, y, z, f.heading)
        };
        let color = |f: &Figure| Vec4::new(f.color[0], f.color[1], f.color[2], f.opacity);
        // The shadows write no depth: all drawn with the first people drawn.
        if which != People::Fading {
            program.use_uniform_if_required("u_shadow_pass", 1.0_f32);
            for f in self.figures.iter().filter(|f| f.opacity > 0.0) {
                let radius = if f.shape == FigureShape::Robot {
                    ROBOT_SHADOW_RADIUS
                } else {
                    SHADOW_RADIUS
                };
                program.use_uniform_if_required("u_scale", radius);
                program.use_uniform("u_place", placed(f, 0.6 - f.at[1]));
                program.use_uniform("u_color", color(f));
                shapes.shadow.draw(program, shadow_states, viewport);
            }
        }
        program.use_uniform_if_required("u_shadow_pass", 0.0_f32);
        program.use_uniform_if_required("u_scale", 1.0_f32);
        let drawn = |f: &&Figure| match which {
            People::All => f.opacity > 0.0,
            People::Solid => f.opacity > 0.0 && !f.fading(),
            People::Fading => f.fading(),
        };
        for f in self.figures.iter().filter(drawn) {
            program.use_uniform("u_place", placed(f, 0.0));
            program.use_uniform("u_color", color(f));
            program.use_uniform_if_required("u_dissolve", if f.fading() { 1.0_f32 } else { 0.0 });
            let shape = match f.shape {
                FigureShape::Person => &shapes.figure,
                FigureShape::Pin => &shapes.pin,
                FigureShape::Robot => &shapes.robot,
            };
            shape.draw(program, body_states, viewport);
        }
    }

    /// Every pass of a frame, into the target being written: the background, what is opaque,
    /// the people, glass, glass walls, the outlines, the halos, the wires.
    fn draw_passes(&self, viewport: Viewport, only: Option<usize>, phase: Phase) {
        let solid = phase != Phase::SeeThrough;
        if solid {
            let behind = RenderStates {
                write_mask: WriteMask::COLOR,
                depth_test: DepthTest::Always,
                blend: Blend::Disabled,
                cull: Cull::None,
            };
            let background = &self.background_program;
            self.bind_textures(background);
            background.draw_arrays(behind, viewport, 3);
        }
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
        let gain = self.light().lamp_gain();
        let glass_walls = self.theme.glass_walls;
        let walking = self.view.walking() && only.is_none();
        let roof = self
            .roof
            .as_ref()
            .filter(|_| only.is_none())
            .zip(self.view.roof_offset())
            .and_then(|(roof, offset)| Some((roof.mesh.as_ref()?, offset, roof)));
        let storeys = self.drawn(only);
        // What is opaque, storey by storey; glass walls only have their tops drawn with it.
        for (part, offset, lights) in storeys.iter().filter(|_| solid) {
            self.use_storey(program, *offset, lights, gain);
            for mesh in part.meshes[..2].iter().flatten() {
                mesh.draw(program, opaque_states, viewport);
            }
            if let Some(walls) = part.walls.as_ref() {
                let pass = if glass_walls { 1.0_f32 } else { 0.0 };
                program.use_uniform_if_required("u_wall_pass", pass);
                walls.draw(program, opaque_states, viewport);
                program.use_uniform_if_required("u_wall_pass", 0.0_f32);
            }
            // Walking, the rooms have their ceilings (the glass looks keep the sky above).
            if let Some(ceiling) = part.ceiling.as_ref().filter(|_| walking && !glass_walls) {
                ceiling.draw(program, opaque_states, viewport);
            }
        }
        if let Some((mesh, offset, _)) = roof.filter(|_| solid && !glass_walls) {
            self.use_storey(program, offset, &[], gain);
            mesh.draw(program, opaque_states, viewport);
        }
        // The people stand among the furniture; not in a storey's picture. Those fading in or out
        // are dissolved pixel by pixel: with the ink, they come after it (their holes uninked).
        let people = match phase {
            Phase::Whole => Some(People::All),
            Phase::Solid => Some(People::Solid),
            Phase::SeeThrough => self
                .figures
                .iter()
                .any(Figure::fading)
                .then_some(People::Fading),
        };
        if let Some(which) = people.filter(|_| only.is_none() && !self.figures.is_empty()) {
            self.draw_people(viewport, which);
            self.bind_textures(program);
        }
        // What the cameras see, on the floor (D-038): after what is opaque, so that what stands
        // on it hides it, and before the ink, which outlines what stands on it; not in a
        // storey's picture, nor at eye level.
        if let Some(views) = self
            .camera_views
            .as_ref()
            .filter(|_| phase != Phase::SeeThrough && only.is_none() && self.camera_fans_drawable())
        {
            let cameras = &self.camera_view_program;
            cameras.use_vertex_attribute("a_place", &views.place);
            cameras.use_vertex_attribute("a_look", &views.look);
            cameras.use_vertex_attribute("a_reach", &views.reach);
            cameras.draw_arrays(ON_THE_FLOOR, viewport, views.count);
        }
        if phase == Phase::Solid {
            return;
        }
        for (part, offset, lights) in &storeys {
            self.use_storey(program, *offset, lights, gain);
            for mesh in part.meshes[2..].iter().flatten() {
                mesh.draw(program, glass_states, viewport);
            }
        }
        if glass_walls {
            // The faces of glass walls (and a glass roof), after everything else.
            program.use_uniform_if_required("u_wall_pass", 2.0_f32);
            let states = RenderStates {
                cull: Cull::None,
                ..glass_states
            };
            for (part, offset, lights) in &storeys {
                if let Some(walls) = part.walls.as_ref() {
                    self.use_storey(program, *offset, lights, gain);
                    walls.draw(program, states, viewport);
                }
            }
            if let Some((mesh, offset, _)) = roof {
                self.use_storey(program, offset, &[], gain);
                mesh.draw(program, states, viewport);
            }
            program.use_uniform_if_required("u_wall_pass", 0.0_f32);
        }
        set_offset(program, NO_OFFSET);
        if self.theme.line_strength > 0.0 {
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
            let outlines = storeys
                .iter()
                .map(|(part, offset, _)| (part.lines.as_ref(), *offset));
            let roof_lines = roof.map(|(_, offset, roof)| (roof.lines.as_ref(), offset));
            for (lines, offset) in outlines.chain(roof_lines) {
                if let Some(lines) = lines {
                    set_offset(line, offset);
                    line.use_vertex_attribute("a_a", &lines.a);
                    line.use_vertex_attribute("a_b", &lines.b);
                    line.use_vertex_attribute("a_corner", &lines.corners);
                    line.draw_elements(states, viewport, &lines.indices);
                }
            }
            set_offset(line, NO_OFFSET);
        }
        if let Some(h) = self.halos.as_ref().filter(|_| only.is_none()) {
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
        // What falls around the home, after the glass so that it shows in front of the windows;
        // not in a storey's picture.
        if only.is_none() {
            self.draw_weather(viewport);
        }
        // Wires over everything, so that a link is seen through the walls it crosses; not in a
        // storey's picture.
        for w in self.wires.iter().flatten().filter(|_| only.is_none()) {
            // The alpha channel is what the bloom makes glow: wires glow in the looks whose
            // outlines do, and leave it as it is in the others.
            let (alpha_source, alpha_equation) = if self.theme.line_glow > 0.0 {
                (BlendMultiplierType::One, BlendEquationType::Max)
            } else {
                (BlendMultiplierType::Zero, BlendEquationType::Add)
            };
            let states = RenderStates {
                write_mask: WriteMask::COLOR,
                depth_test: DepthTest::Always,
                blend: Blend::Enabled {
                    source_rgb_multiplier: BlendMultiplierType::SrcAlpha,
                    source_alpha_multiplier: alpha_source,
                    destination_rgb_multiplier: BlendMultiplierType::OneMinusSrcAlpha,
                    destination_alpha_multiplier: BlendMultiplierType::One,
                    rgb_equation: BlendEquationType::Add,
                    alpha_equation,
                },
                cull: Cull::None,
            };
            let wire = &self.wire_program;
            wire.use_vertex_attribute("a_a", &w.a);
            wire.use_vertex_attribute("a_b", &w.b);
            wire.use_vertex_attribute("a_corner", &w.corners);
            wire.use_vertex_attribute("a_color", &w.colors);
            wire.use_vertex_attribute("a_extra", &w.extras);
            wire.use_vertex_attribute("a_shot", &w.shots);
            wire.draw_elements(states, viewport, &w.indices);
        }
    }

    /// The storeys a frame draws, where and lit by which lights: every one, or `only` one
    /// at its floor (a picture of it).
    fn drawn(&self, only: Option<usize>) -> Vec<Drawn<'_>> {
        self.parts
            .iter()
            .enumerate()
            .filter_map(|(k, part)| match only {
                None => Some((part, self.view.offset(k), Cow::Borrowed(&part.lights[..]))),
                Some(o) if o == k => {
                    let own: Vec<LightSpot> = self
                        .spots
                        .iter()
                        .filter(|s| s.storey == k)
                        .copied()
                        .collect();
                    Some((
                        part,
                        NO_OFFSET,
                        Cow::Owned(lamps::point_lights(&own, &self.looks)),
                    ))
                }
                Some(_) => None,
            })
            .collect()
    }

    /// A picture of storey `storey` alone, `width` × `height` device pixels, seen from above a
    /// corner as the overview sees the home: RGBA rows from the top (the storeys' thumbnails,
    /// D-028). `None` without that storey.
    pub fn picture(&mut self, storey: usize, width: u32, height: u32) -> Option<Vec<u8>> {
        let bounds = self.view.storey_bounds(storey)?;
        let (width, height) = (width.clamp(16, 1024), height.clamp(16, 1024));
        let aspect = f64::from(width) / f64::from(height);
        let camera = Camera::framing(bounds, 0.6, 0.82, aspect, 0.0);
        let [min, max] = bounds;
        let radius = (max[0] - min[0])
            .hypot(max[1] - min[1])
            .hypot(max[2] - min[2])
            / 2.0;
        let projection = camera.projection(aspect, radius.max(100.0));
        // The view's frame state, as this picture needs it: its size, its cut-away, no sun
        // shadows (the shadow map has the storeys where the view shows them).
        let size = (self.width, self.height);
        (self.width, self.height) = (width, height);
        let cuts = self.view.cuts_for(&camera);
        let view_cuts = std::mem::replace(&mut self.view.cuts, cuts);
        let shadow = self.shadow.take();
        // No weather on a storey's picture (clouds, fog, a flash): the storey as it is, whatever
        // the sky.
        let flash = std::mem::replace(&mut self.flash, 0.0);
        let weather = std::mem::replace(&mut self.weather, Weather::CLEAR);
        self.set_main_uniforms(&projection, 0.0, 0.0, false);
        self.set_background_uniforms(&projection.view_proj, false, false);
        self.set_line_uniforms(&projection);
        let color = Texture2D::new_empty::<[u8; 4]>(
            &self.context,
            width,
            height,
            Interpolation::Nearest,
            Interpolation::Nearest,
            None,
            Wrapping::ClampToEdge,
            Wrapping::ClampToEdge,
        );
        let depth = DepthTexture2D::new::<f32>(
            &self.context,
            width,
            height,
            Wrapping::ClampToEdge,
            Wrapping::ClampToEdge,
        );
        let target = RenderTarget::new(color.as_color_target(None), depth.as_depth_target());
        let [r, g, b] = self.backdrop().1;
        let viewport = Viewport::new_at_origo(width, height);
        let _ = target
            .clear(ClearState::color_and_depth(r, g, b, 1.0, 1.0))
            .write::<CoreError>(|| {
                self.draw_passes(viewport, Some(storey), Phase::Whole);
                Ok(())
            });
        let pixels = target.read_color::<[u8; 4]>();
        (self.width, self.height) = size;
        self.view.cuts = view_cuts;
        self.shadow = shadow;
        self.flash = flash;
        self.weather = weather;
        self.view.dirty = true;
        // GL rows go from the bottom.
        let row = width as usize;
        Some(
            pixels
                .chunks(row)
                .rev()
                .flatten()
                .flat_map(|p| *p)
                .collect(),
        )
    }

    /// Draws storey parts moved by `offset` (cm), lit by `lights` (their colours times `gain`).
    fn use_storey(&self, program: &Program, offset: [f64; 3], lights: &[PointLight], gain: f32) {
        set_offset(program, offset);
        let mut positions = [Vec4::new(0.0, 0.0, 0.0, 1.0); lamps::MAX_LIGHTS];
        let mut colors = [Vec4::new(0.0, 0.0, 0.0, 0.0); lamps::MAX_LIGHTS];
        for (i, lamp) in lights.iter().enumerate().take(lamps::MAX_LIGHTS) {
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
        program
            .use_uniform_if_required("u_light_count", lights.len().min(lamps::MAX_LIGHTS) as f32);
    }

    /// The look's ink (D-036) over what is opaque, read from its resolved `depth`.
    fn draw_ink(
        &self,
        viewport: Viewport,
        depth: &DepthTexture2D,
        projection: &domotwin_core::camera::Projection,
    ) {
        let ink = &self.ink;
        ink.use_depth_texture("u_depth", depth);
        ink.use_uniform_if_required("u_outline", self.theme.outline);
        // A distance from a depth: the projection's third and fourth rows, at x = y = 0.
        let p = &projection.proj;
        let rows = Vec4::new(p[10], p[11], p[14], p[15]);
        ink.use_uniform_if_required("u_depth_to_distance", rows);
        // The size of a usual line's width (cm) at a distance d: x + y·d.
        let scale = self.pixel_scale();
        #[allow(clippy::cast_precision_loss)]
        let height = self.height.max(1) as f32;
        #[allow(clippy::cast_possible_truncation)]
        let pixel = if projection.orthographic {
            Vec2::new(2.0 * projection.half_height as f32 / height * scale, 0.0)
        } else {
            Vec2::new(0.0, 2.0 * projection.tan_half_fov as f32 / height * scale)
        };
        ink.use_uniform_if_required("u_pixel", pixel);
        // Two usual pixels wide (the outer one half inked), in texture coordinates.
        let px = scale * 2.0;
        #[allow(clippy::cast_precision_loss)]
        let step = Vec2::new(px / self.width.max(1) as f32, px / height);
        ink.use_uniform_if_required("u_ink_step", step);
        let [r, g, b] = self.theme.line;
        ink.use_uniform_if_required("u_ink", Vec3::new(r, g, b));
        // Over the picture; the alpha (what glows) left as it is.
        let states = RenderStates {
            write_mask: WriteMask::COLOR,
            depth_test: DepthTest::Always,
            blend: Blend::Enabled {
                source_rgb_multiplier: BlendMultiplierType::SrcAlpha,
                source_alpha_multiplier: BlendMultiplierType::Zero,
                destination_rgb_multiplier: BlendMultiplierType::OneMinusSrcAlpha,
                destination_alpha_multiplier: BlendMultiplierType::One,
                rgb_equation: BlendEquationType::Add,
                alpha_equation: BlendEquationType::Add,
            },
            cull: Cull::None,
        };
        ink.draw_arrays(states, viewport, 3);
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
        let levels = &targets.levels;
        let down = &self.bloom_down;
        let mut source = &targets.resolved;
        for (i, level) in levels.iter().enumerate() {
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
        for pair in levels.windows(2).rev() {
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
        if let Some(bloom) = levels.first() {
            composite.use_texture("u_bloom", bloom);
        } else {
            composite.use_texture("u_bloom", &targets.resolved);
        }
        let strength = if levels.is_empty() {
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
            .projection(self.view.aspect, self.view.depth());
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
        // Through glass walls, what is behind them; their tops stay solid. The roof is not
        // picked: a tap goes to the storey under it.
        let wall_pass = if self.theme.glass_walls { 1.0_f32 } else { 0.0 };
        let (program, parts, view) = (&self.pick, &self.parts, &self.view);
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
                for (k, part) in parts.iter().enumerate() {
                    set_offset(program, view.offset(k));
                    for mesh in part.meshes.iter().flatten() {
                        mesh.draw(program, states, viewport);
                    }
                    if let Some(walls) = part.walls.as_ref() {
                        program.use_uniform_if_required("u_wall_pass", wall_pass);
                        walls.draw(program, states, viewport);
                        program.use_uniform_if_required("u_wall_pass", 0.0_f32);
                    }
                }
                set_offset(program, NO_OFFSET);
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
            ("CEILING", Surface::Ceiling),
        ];
        for (name, surface) in surfaces {
            assert_eq!(value(shaders::FRAGMENT, name), surface as u8, "{name}");
        }
        assert_eq!(value(shaders::VERTEX, "WALL_CAP"), Surface::WallCap as u8);
        let per_row = "const uint ELEMENTS_PER_ROW = ";
        let at = shaders::VERTEX.find(per_row).unwrap() + per_row.len();
        let end = at + shaders::VERTEX[at..].find('u').unwrap();
        assert_eq!(
            shaders::VERTEX[at..end].parse::<usize>().unwrap(),
            lamps::ELEMENTS_PER_ROW
        );
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
