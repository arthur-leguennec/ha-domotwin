//! What the view shows and how it moves: the camera and its transitions, the 2D plan switch, the
//! animated cut-away of each wall group, and where the storeys of a home are drawn (D-028): spread
//! apart or stacked in 3D, side by side on the 2D plan. No GPU here, so it is tested natively.

use domotwin_core::camera::{Camera, CutawayMode, Transition, cut_targets};
use domotwin_core::geometry::heights::CUT_HEIGHT;
use domotwin_core::scene::{Scene, WallGroup};
use domotwin_core::walk::{EYE_HEIGHT, Floor};
use std::f64::consts::{FRAC_PI_2, PI, TAU};

/// Duration of camera moves (ms).
const MOVE_MS: f64 = 650.0;
/// Speed of the walls going down or up (cm per ms).
const CUT_SPEED: f64 = 0.75;
/// How far apart the storeys of a home go when spread, in wall heights.
const SPREAD_GAP: f64 = 1.6;
/// Duration of spreading the storeys apart or stacking them, or laying them side by side (ms).
const SPREAD_MS: f64 = 700.0;
/// Space between the storeys side by side on the 2D plan: a share of the widest, at least this
/// (cm).
const SIDE_GAP: f64 = 150.0;
const SIDE_GAP_SHARE: f64 = 0.12;
/// Below this width / height, the storeys side by side go down the view instead of across.
const SIDE_DOWN_ASPECT: f64 = 0.9;
/// Walking (D-029): speed (cm per ms), how fast the walker turns towards its way (radians per ms),
/// how far down the eyes look on the way in, how far a wheel step goes (cm).
const WALK_SPEED: f64 = 0.13;
const WALK_TURN: f64 = 0.004;
const WALK_PITCH: f64 = 0.12;
const WALK_WHEEL: f64 = 400.0;
/// How far back from where it lands the walker steps to see the room (cm).
const WALK_STEP_BACK: f64 = 220.0;
/// How far from a piece the walker stops to look at it (cm, beyond its half size).
const WALK_STAND_OFF: f64 = 90.0;

/// Walking through the storey shown at eye level (D-029).
#[derive(Debug, Clone, PartialEq)]
struct Walk {
    /// Where the walker can go.
    floor: Floor,
    /// Height of the eyes (cm).
    eye_height: f64,
    /// How the walker moves on its own (keys, the pad): ahead and to the right, −1…1.
    velocity: [f64; 2],
    /// Where the walker is going (a tap on the floor), the next point last.
    path: Vec<[f64; 2]>,
    /// What the walker turns to face once there (a piece shown).
    face: Option<[f64; 2]>,
    /// The camera to come back to.
    before: Camera,
}

/// Bounds `[min, max]` in cm.
type Bounds = [[f64; 3]; 2];

/// A storey as the view places it: the height of its floor, its rank from the lowest, the bounds
/// of its geometry on its floor, and how far it moves on the ground (x, z) to lie beside the
/// others on the plan.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Storey {
    elevation: f64,
    rank: usize,
    bounds: Bounds,
    shift: [f64; 2],
}

/// The state of one view.
#[derive(Debug, Clone, PartialEq)]
pub struct ViewState {
    /// Current camera.
    pub camera: Camera,
    transition: Option<Transition>,
    /// Cut-away mode.
    pub cutaway: CutawayMode,
    /// Showing the 2D plan.
    pub plan_view: bool,
    /// The 3D camera to come back to from the plan.
    last_3d: Option<Camera>,
    /// Current height of each wall group.
    pub cuts: Vec<f64>,
    groups: Vec<WallGroup>,
    /// Wall height of the scene.
    pub wall_height: f64,
    /// World bounds of the scene, as shown (the storeys spread apart or not, the roof or not).
    pub bounds: [[f64; 3]; 2],
    /// The storeys of the scene, and its roof (its storey, its storey's floor height, its bounds).
    storeys: Vec<Storey>,
    roof: Option<(usize, f64, Bounds)>,
    /// The roof is shown.
    pub roof_shown: bool,
    /// How far apart the storeys are (0: stacked, 1: spread), and where it is going.
    spread: f64,
    spread_target: f64,
    /// How far the storeys are on their way to lying side by side on the ground (1, the 2D plan
    /// of a home of several storeys), and where it is going; down the view rather than across.
    side: f64,
    side_target: f64,
    side_down: bool,
    /// Walking at eye level, when walking.
    walk: Option<Walk>,
    /// The kiosk's slow turn around the home while nobody touches it (radians per ms, 0: none).
    auto_orbit: f64,
    /// Viewport width / height.
    pub aspect: f64,
    last_time: Option<f64>,
    /// Something changed since the last frame.
    pub dirty: bool,
    /// The cut-away changed since the last shadow map.
    pub shadows_dirty: bool,
    /// The user prefers reduced motion: the camera, the storeys and the walls get where they go
    /// at once.
    pub still: bool,
}

impl Default for ViewState {
    fn default() -> Self {
        Self {
            camera: Camera::default(),
            transition: None,
            cutaway: CutawayMode::Auto,
            plan_view: false,
            last_3d: None,
            cuts: Vec::new(),
            groups: Vec::new(),
            wall_height: 265.0,
            bounds: [[0.0; 3], [1000.0, 265.0, 1000.0]],
            storeys: Vec::new(),
            roof: None,
            roof_shown: true,
            spread: 1.0,
            spread_target: 1.0,
            side: 0.0,
            side_target: 0.0,
            side_down: false,
            walk: None,
            auto_orbit: 0.0,
            aspect: 1.0,
            last_time: None,
            dirty: true,
            shadows_dirty: true,
            still: false,
        }
    }
}

impl ViewState {
    /// Takes a new scene; frames it unless `keep_camera`.
    pub fn set_scene(&mut self, scene: &Scene, keep_camera: bool) {
        self.groups.clone_from(&scene.groups);
        self.wall_height = scene.wall_height;
        let wide = |[min, max]: [[f32; 3]; 2]| -> Bounds {
            [
                [f64::from(min[0]), f64::from(min[1]), f64::from(min[2])],
                [f64::from(max[0]), f64::from(max[1]), f64::from(max[2])],
            ]
        };
        let mut order: Vec<usize> = (0..scene.parts.len()).collect();
        order.sort_by(|a, b| {
            scene.parts[*a]
                .elevation
                .total_cmp(&scene.parts[*b].elevation)
        });
        let storeys_before = self.storeys.len();
        self.storeys = scene
            .parts
            .iter()
            .enumerate()
            .map(|(k, part)| Storey {
                elevation: part.elevation,
                rank: order.iter().position(|o| *o == k).unwrap_or(0),
                bounds: wide(part.bounds),
                shift: [0.0; 2],
            })
            .collect();
        self.roof = scene
            .roof
            .as_ref()
            .map(|roof| (roof.storey, roof.elevation, wide(roof.mesh.bounds())));
        self.side_target = if self.plan_view && self.storeys.len() > 1 {
            1.0
        } else {
            0.0
        };
        if !keep_camera || self.storeys.len() < 2 {
            self.side = self.side_target;
        }
        if !keep_camera || self.storeys.len() > 1 {
            // Walking is on a storey shown alone, as it was.
            self.walk = None;
        }
        if !keep_camera {
            // A home framed afresh stands as asked, without spreading or stacking first.
            self.spread = self.spread_target;
            self.side_down = self.aspect < SIDE_DOWN_ASPECT;
        }
        self.lay_side_by_side();
        self.bounds = self.shown_bounds(self.spread, self.side);
        // On the plan, a storey more or less moves the others: framed again. The same home
        // otherwise keeps its camera, and the move it was making (into a walk too); eyes left
        // without a walk go back to the overview.
        let reframe = self.plan_view && self.storeys.len() != storeys_before;
        let eyes = self
            .transition
            .map_or(self.camera.walk > 0.0, |t| t.to.walk > 0.0);
        if !keep_camera || reframe || (eyes && self.walk.is_none()) {
            self.transition = None;
            self.camera = if self.plan_view {
                self.plan_camera()
            } else {
                self.overview_camera()
            };
        }
        self.cuts = cut_targets(&self.groups, &self.camera, self.cutaway, self.wall_height);
        self.dirty = true;
        self.shadows_dirty = true;
    }

    /// Where storey `storey` is drawn: how far it is moved (cm) from where its geometry stands. Up
    /// to its floor's height, more when the storeys are spread apart; beside the others on the 2D
    /// plan.
    pub fn offset(&self, storey: usize) -> [f64; 3] {
        self.offset_at(storey, self.spread, self.side)
    }

    /// A point of storey `storey`'s geometry where the view draws it.
    pub fn place(&self, storey: usize, p: [f64; 3]) -> [f64; 3] {
        let o = self.offset(storey);
        [p[0] + o[0], p[1] + o[1], p[2] + o[2]]
    }

    fn offset_at(&self, storey: usize, spread: f64, side: f64) -> [f64; 3] {
        let Some(s) = self.storeys.get(storey) else {
            return [0.0; 3];
        };
        let lift = s.elevation + ease(spread) * SPREAD_GAP * self.wall_height * rank_f64(s.rank);
        let k = ease(side);
        [s.shift[0] * k, lift * (1.0 - k), s.shift[1] * k]
    }

    /// Works out how far each storey moves on the ground (x, z) to lie beside the others: the
    /// lowest on the left, the next on its right; down the view, the highest on top.
    fn lay_side_by_side(&mut self) {
        let axis = if self.side_down { 2 } else { 0 };
        let mut order: Vec<usize> = (0..self.storeys.len()).collect();
        order.sort_by_key(|&k| self.storeys[k].rank);
        if self.side_down {
            order.reverse();
        }
        let widest = self
            .storeys
            .iter()
            .map(|s| s.bounds[1][axis] - s.bounds[0][axis])
            .fold(0.0, f64::max);
        let gap = (widest * SIDE_GAP_SHARE).max(SIDE_GAP);
        // Each storey starts where the one before it ends, past the gap; the first stays.
        let mut end: Option<f64> = None;
        for k in order {
            let storey = &mut self.storeys[k];
            let [min, max] = storey.bounds;
            let shift = end.map_or(0.0, |end| end + gap - min[axis]);
            storey.shift = if self.side_down {
                [0.0, shift]
            } else {
                [shift, 0.0]
            };
            if min != max {
                end = Some(max[axis] + shift);
            }
        }
    }

    /// The view's width / height changed: on the plan, the storeys go across or down the view as
    /// it now suits, framed again.
    pub fn set_aspect(&mut self, aspect: f64) {
        self.aspect = aspect;
        self.dirty = true;
        let down = aspect < SIDE_DOWN_ASPECT;
        if !self.plan_view || self.storeys.len() < 2 || down == self.side_down {
            return;
        }
        self.side_down = down;
        self.lay_side_by_side();
        self.bounds = self.shown_bounds(self.spread, self.side);
        self.transition = None;
        self.camera = self.plan_camera();
        self.shadows_dirty = true;
    }

    /// Where the roof is drawn: as its storey is, one more gap up when spread. On the way to the
    /// plan it goes down with its storey and is gone halfway; not on the plan.
    pub fn roof_offset(&self) -> Option<[f64; 3]> {
        self.roof_offset_at(self.spread, self.side)
    }

    fn roof_offset_at(&self, spread: f64, side: f64) -> Option<[f64; 3]> {
        let (storey, elevation, _) = self.roof.filter(|_| self.roof_shown && side < 0.5)?;
        let (rank, shift) = self
            .storeys
            .get(storey)
            .map_or((0, [0.0; 2]), |s| (s.rank, s.shift));
        let lift = elevation + ease(spread) * SPREAD_GAP * self.wall_height * rank_f64(rank + 1);
        let k = ease(side);
        Some([shift[0] * k, lift * (1.0 - k), shift[1] * k])
    }

    /// The bounds of what is shown, the storeys spread by `spread` and on their way side by side
    /// by `side`.
    fn shown_bounds(&self, spread: f64, side: f64) -> Bounds {
        let mut bounds: Option<Bounds> = None;
        let mut add = |[min, max]: Bounds, o: [f64; 3]| {
            if min == max {
                return;
            }
            let moved = [
                [min[0] + o[0], min[1] + o[1], min[2] + o[2]],
                [max[0] + o[0], max[1] + o[1], max[2] + o[2]],
            ];
            bounds = Some(bounds.map_or(moved, |b| {
                [
                    [
                        b[0][0].min(moved[0][0]),
                        b[0][1].min(moved[0][1]),
                        b[0][2].min(moved[0][2]),
                    ],
                    [
                        b[1][0].max(moved[1][0]),
                        b[1][1].max(moved[1][1]),
                        b[1][2].max(moved[1][2]),
                    ],
                ]
            }));
        };
        for (k, storey) in self.storeys.iter().enumerate() {
            add(storey.bounds, self.offset_at(k, spread, side));
        }
        if let (Some((_, _, roof)), Some(o)) = (self.roof, self.roof_offset_at(spread, side)) {
            add(roof, o);
        }
        bounds.unwrap_or([[0.0; 3], [1000.0, 265.0, 1000.0]])
    }

    /// The bounds of what will be shown once the storeys stand still.
    fn target_bounds(&self) -> Bounds {
        self.shown_bounds(self.spread_target, self.side_target)
    }

    /// Spreads the storeys of a home apart (or stacks them), animated from `now`; the camera
    /// frames the home as it will be.
    pub fn set_spread(&mut self, spread: bool, now: f64) {
        let target = if spread { 1.0 } else { 0.0 };
        if (target - self.spread_target).abs() < 1e-9 {
            return;
        }
        self.spread_target = target;
        if self.storeys.len() > 1 && !self.plan_view {
            let bounds = self.target_bounds();
            let to = Camera::framing(bounds, self.camera.yaw, self.camera.pitch, self.aspect, 0.0);
            self.go_to(to, now);
        }
        self.dirty = true;
    }

    /// Whether the storeys are spread apart (or going to be).
    pub const fn spread(&self) -> bool {
        self.spread_target > 0.5
    }

    /// Shows or hides the roof.
    pub fn set_roof(&mut self, shown: bool) {
        if shown != self.roof_shown {
            self.roof_shown = shown;
            self.bounds = self.shown_bounds(self.spread, self.side);
            self.dirty = true;
            self.shadows_dirty = true;
        }
    }

    /// The bounds of storey `storey`'s geometry on its floor.
    pub fn storey_bounds(&self, storey: usize) -> Option<Bounds> {
        self.storeys
            .get(storey)
            .map(|s| s.bounds)
            .filter(|[min, max]| min != max)
    }

    /// The height each wall group is cut to, seen by `camera` (walls at rest).
    pub fn cuts_for(&self, camera: &Camera) -> Vec<f64> {
        cut_targets(&self.groups, camera, self.cutaway, self.wall_height)
    }

    /// The number of storeys of the scene.
    pub fn storey_count(&self) -> usize {
        self.storeys.len()
    }

    /// Whether the storeys are moving: apart, together, or to or from their places side by side.
    pub fn storeys_moving(&self) -> bool {
        (self.spread - self.spread_target).abs() > 1e-9
            || (self.side - self.side_target).abs() > 1e-9
    }

    /// Radius of the scene around its centre (cm).
    pub fn radius(&self) -> f64 {
        let [min, max] = self.bounds;
        let d = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
        (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt() / 2.0
    }

    /// Centre of the scene.
    pub fn centre(&self) -> [f64; 3] {
        let [min, max] = self.bounds;
        [
            f64::midpoint(min[0], max[0]),
            f64::midpoint(min[1], max[1]),
            f64::midpoint(min[2], max[2]),
        ]
    }

    /// How far the home reaches from the camera's target (cm), for the clipping planes: its
    /// radius, and how far the target is from its centre (walking, anywhere in the home).
    pub fn depth(&self) -> f64 {
        let (c, t) = (self.centre(), self.camera.target);
        self.radius() + (t[0] - c[0]).hypot(t[1] - c[1]).hypot(t[2] - c[2])
    }

    /// The overview: the whole home from above and a corner (lower over several storeys, so that
    /// they hide less of each other).
    pub fn overview_camera(&self) -> Camera {
        let pitch = if self.storeys.len() > 1 { 0.6 } else { 0.82 };
        Camera::framing(self.target_bounds(), 0.6, pitch, self.aspect, 0.0)
    }

    /// The whole plan, north up, seen from above.
    fn plan_camera(&self) -> Camera {
        Camera::framing(self.target_bounds(), 0.0, FRAC_PI_2, self.aspect, 1.0)
    }

    /// Starts a move to `to` at `now`.
    pub fn go_to(&mut self, to: Camera, now: f64) {
        self.transition = Some(Transition {
            from: self.camera,
            to: to.clamped(),
            start: now,
            duration: if self.still { 0.0 } else { MOVE_MS },
        });
        self.dirty = true;
    }

    /// Goes to a saved viewpoint: in 3D, not walking.
    pub fn show_camera(&mut self, to: Camera, now: f64) {
        self.walk = None;
        if self.plan_view {
            self.plan_view = false;
            self.side_target = 0.0;
            self.last_3d = None;
        }
        self.go_to(to, now);
    }

    /// Back to the overview.
    pub fn overview(&mut self, now: f64) {
        self.walk = None;
        let camera = if self.plan_view {
            self.plan_camera()
        } else {
            self.overview_camera()
        };
        self.go_to(camera, now);
    }

    /// Switches between the 3D view and the 2D plan, with an animated move.
    pub fn set_plan_view(&mut self, plan: bool, now: f64) {
        if plan == self.plan_view {
            return;
        }
        if plan && let Some(walk) = self.walk.take() {
            // From the eyes to the plan, then back to where the walk started.
            self.camera = self.transition.map_or(self.camera, |t| t.to);
            self.transition = None;
            self.last_3d = Some(walk.before);
            self.plan_view = true;
            let to = self.plan_camera();
            self.go_to(to, now);
            return;
        }
        self.plan_view = plan;
        // The storeys of a home lie down side by side on the plan, and stand up again after.
        if self.storeys.len() > 1 {
            self.side_target = if plan { 1.0 } else { 0.0 };
            if plan && self.side <= 0.0 {
                self.side_down = self.aspect < SIDE_DOWN_ASPECT;
                self.lay_side_by_side();
            }
        }
        let to = if plan {
            self.last_3d = Some(self.transition.map_or(self.camera, |t| t.to));
            self.plan_camera()
        } else {
            self.last_3d
                .take()
                .unwrap_or_else(|| self.overview_camera())
        };
        self.go_to(to, now);
    }

    /// Frames a box (a room or a piece) from the current direction. Walking, the walker goes to
    /// `inside` (a point well inside a room), or up to the piece and faces it.
    pub fn focus(&mut self, bounds: [[f64; 3]; 2], inside: Option<[f64; 2]>, now: f64) {
        if self.walk.is_some() {
            if let Some(spot) = inside {
                self.walk_to(spot);
                return;
            }
            let [min, max] = bounds;
            let centre = [f64::midpoint(min[0], max[0]), f64::midpoint(min[2], max[2])];
            let eye = self.transition.map_or(self.camera, |t| t.to).eye();
            let (dx, dy) = (centre[0] - eye[0], centre[1] - eye[2]);
            let far = dx.hypot(dy);
            let keep = (max[0] - min[0]).max(max[2] - min[2]) / 2.0 + WALK_STAND_OFF;
            if far > keep {
                self.walk_to([centre[0] - dx / far * keep, centre[1] - dy / far * keep]);
            }
            if let Some(walk) = self.walk.as_mut() {
                walk.face = Some(centre);
                self.dirty = true;
            }
            return;
        }
        let (yaw, pitch, ortho) = if self.plan_view {
            (0.0, FRAC_PI_2, 1.0)
        } else {
            (self.camera.yaw, self.camera.pitch.clamp(0.6, 1.1), 0.0)
        };
        let to = Camera::framing(bounds, yaw, pitch, self.aspect, ortho);
        self.go_to(to, now);
    }

    /// Turns the camera (ignored on the 2D plan, which stays north-up and seen from above).
    pub fn orbit(&mut self, dx: f64, dy: f64) {
        if self.plan_view {
            return;
        }
        self.stop();
        if self.walk.is_some() {
            // Walking, a drag looks around.
            self.camera.look(dx, dy);
        } else {
            self.camera.orbit(dx, dy);
        }
        self.dirty = true;
    }

    /// Pans the view; `height` is the viewport height in pixels.
    pub fn pan(&mut self, dx: f64, dy: f64, height: f64) {
        self.stop();
        if self.walk.is_some() {
            // Walking, the eyes stay on the floor: a two-finger drag looks around too.
            self.camera.look(dx, dy);
        } else {
            self.camera.pan(dx, dy, height);
        }
        self.dirty = true;
    }

    /// Zooms by `factor` towards the screen point `ndc`.
    pub fn zoom(&mut self, factor: f64, ndc: [f64; 2]) {
        self.stop();
        if let Some(walk) = &self.walk {
            // Walking, the wheel or a pinch steps ahead or back.
            if factor.is_finite() && factor > 0.0 {
                let eye = self.camera.eye();
                let (ahead, _) = self.camera.heading();
                let d = (1.0 - factor).clamp(-1.0, 1.0) * WALK_WHEEL;
                let at = walk
                    .floor
                    .slide([eye[0], eye[2]], [ahead[0] * d, ahead[1] * d]);
                self.camera = Camera::walking(
                    [at[0], walk.eye_height, at[1]],
                    self.camera.yaw,
                    self.camera.pitch,
                );
                self.dirty = true;
            }
            return;
        }
        // On the plane at the target's height: the point under the centre is the target, so a zoom
        // there goes straight in, however high the home is framed.
        let toward = self
            .camera
            .plane_point(self.aspect, ndc, self.camera.target[1]);
        self.camera.zoom(factor, toward);
        self.dirty = true;
    }

    /// Stops a running move where it is, and the kiosk's turn.
    fn stop(&mut self) {
        if let Some(t) = self.transition.take()
            && t.to.walk != self.camera.walk
        {
            // Into the eyes or out of them: not stuck between the two.
            self.camera = t.to;
        }
        self.auto_orbit = 0.0;
    }

    /// Starts walking through the storey shown, its floor `floor_height` cm up: the eyes go down
    /// where the camera looked (or into the nearest room), looking the same way.
    pub fn start_walk(&mut self, floor: Floor, floor_height: f64, now: f64) {
        let before = self.transition.map_or(self.camera, |t| t.to);
        let before = if self.plan_view {
            self.plan_view = false;
            self.side_target = 0.0;
            self.last_3d
                .take()
                .unwrap_or_else(|| self.overview_camera())
        } else if before.walk > 0.0 {
            self.walk.as_ref().map_or(before, |w| w.before)
        } else {
            before
        };
        // Where the camera looks, or is about to.
        let aim = self.transition.map_or(self.camera, |t| t.to).target;
        let at = floor.start([aim[0], aim[2]]);
        let eye_height = floor_height + EYE_HEIGHT;
        // Looking the way the camera looked, unless a wall is right there: the widest view.
        let (sy, cy) = before.yaw.sin_cos();
        let look = floor.widest_view(at, [-sy, -cy]);
        let yaw = (-look[0]).atan2(-look[1]);
        // A few steps back, to see more of the room.
        let at = floor.reach(
            at,
            [
                at[0] - look[0] * WALK_STEP_BACK,
                at[1] - look[1] * WALK_STEP_BACK,
            ],
        );
        let to = Camera::walking([at[0], eye_height, at[1]], yaw, WALK_PITCH);
        self.walk = Some(Walk {
            floor,
            eye_height,
            velocity: [0.0; 2],
            path: Vec::new(),
            face: None,
            before,
        });
        self.auto_orbit = 0.0;
        self.go_to(to, now);
    }

    /// Stops walking: back to the camera before it.
    pub fn stop_walk(&mut self, now: f64) {
        if let Some(walk) = self.walk.take() {
            self.go_to(walk.before, now);
        }
    }

    /// Whether walking.
    pub const fn walking(&self) -> bool {
        self.walk.is_some()
    }

    /// Walking: a point well inside the room `id` (an L-shaped room's middle may be outside it).
    pub fn room_spot(&self, id: &str) -> Option<[f64; 2]> {
        self.walk.as_ref()?.floor.room_spot(id)
    }

    /// Walking: the floor changed (the plan saved again, another storey up the stairs, its floor
    /// `floor_height` cm up): the walker stays where it is if it can stand there, else goes to the
    /// middle of the nearest room.
    pub fn set_walk_floor(&mut self, floor: Floor, floor_height: f64) {
        let Some(walk) = self.walk.as_mut() else {
            return;
        };
        let eye_height = floor_height + EYE_HEIGHT;
        let going = self.transition.map_or(self.camera, |t| t.to).eye();
        let going = [going[0], going[2]];
        if (eye_height - walk.eye_height).abs() < 0.5 && floor.start(going) == going {
            // The same storey (its 3D files came, it was saved again): the walk goes on.
            walk.floor = floor;
            self.dirty = true;
            return;
        }
        let eye = self.camera.eye();
        let at = floor.start([eye[0], eye[2]]);
        walk.eye_height = eye_height;
        walk.path.clear();
        walk.floor = floor;
        self.transition = None;
        self.camera = Camera::walking(
            [at[0], walk.eye_height, at[1]],
            self.camera.yaw,
            self.camera.pitch,
        );
        self.dirty = true;
    }

    /// Walking: moves on its own ahead and to the right (−1…1 each, 0 to stop), as long as a key
    /// or the pad is held.
    pub fn set_walk_velocity(&mut self, ahead: f64, right: f64) {
        if let Some(walk) = self.walk.as_mut() {
            let v = |x: f64| {
                if x.is_finite() {
                    x.clamp(-1.0, 1.0)
                } else {
                    0.0
                }
            };
            walk.velocity = [v(ahead), v(right)];
            if walk.velocity != [0.0; 2] {
                walk.path.clear();
                walk.face = None;
            }
            self.dirty = true;
        }
    }

    /// Walking: walks to `to` on the floor, through the doors.
    pub fn walk_to(&mut self, to: [f64; 2]) {
        let eye = self.transition.map_or(self.camera, |t| t.to).eye();
        if let Some(walk) = self.walk.as_mut() {
            let mut path = walk.floor.path([eye[0], eye[2]], to);
            path.reverse();
            walk.path = path;
            walk.face = None;
            walk.velocity = [0.0; 2];
            self.dirty = true;
        }
    }

    /// Walking: whether `to` on the floor is in sight from the eyes (no wall in between).
    pub fn sees(&self, to: [f64; 2]) -> bool {
        let eye = self.transition.map_or(self.camera, |t| t.to).eye();
        self.walk
            .as_ref()
            .is_some_and(|w| w.floor.seen([eye[0], eye[2]], to))
    }

    /// The kiosk's slow turn around the home (radians per second, 0 to stop); not while walking
    /// or on the plan.
    pub fn set_auto_orbit(&mut self, per_second: f64) {
        self.auto_orbit = if per_second.is_finite() {
            per_second / 1000.0
        } else {
            0.0
        };
        self.dirty = true;
    }

    /// Whether the kiosk's turn moves the camera now (frames go on, at the pace the view sets).
    pub fn orbiting(&self) -> bool {
        self.auto_orbit != 0.0 && self.walk.is_none() && !self.plan_view
    }

    /// Whether the walker is moving.
    fn walker_moving(&self) -> bool {
        self.walk
            .as_ref()
            .is_some_and(|w| w.velocity != [0.0; 2] || !w.path.is_empty() || w.face.is_some())
    }

    /// Moves the walker by `dt` ms: on its own, or along its way, turning towards it.
    fn walk_step(&mut self, dt: f64) {
        if self.transition.is_some() {
            return;
        }
        // Under reduced motion, a walk to somewhere goes a whole leg a frame and turns at once;
        // the keys still walk at a walker's pace.
        let still = self.still;
        let Some(walk) = self.walk.as_mut() else {
            return;
        };
        let step = WALK_SPEED * dt;
        if step <= 0.0 {
            return;
        }
        let (leg, most_turn) = if still {
            (f64::INFINITY, PI)
        } else {
            (step, WALK_TURN * dt)
        };
        let eye = self.camera.eye();
        let at = [eye[0], eye[2]];
        let (ahead, right) = self.camera.heading();
        let mut yaw = self.camera.yaw;
        let moved = if walk.velocity != [0.0; 2] {
            let [va, vr] = walk.velocity;
            let d = [
                (ahead[0] * va + right[0] * vr) * step,
                (ahead[1] * va + right[1] * vr) * step,
            ];
            walk.floor.slide(at, d)
        } else if let Some(&next) = walk.path.last() {
            let (dx, dy) = (next[0] - at[0], next[1] - at[1]);
            let left = dx.hypot(dy);
            let to = if left <= leg {
                walk.path.pop();
                next
            } else {
                [at[0] + dx / left * leg, at[1] + dy / left * leg]
            };
            let reached = walk.floor.reach(at, to);
            if reached == at && to != at {
                // A wall in the way: stop there.
                walk.path.clear();
            }
            if left > 1.0 {
                // Turn towards the way.
                yaw = turned(yaw, [dx, dy], most_turn).0;
            }
            reached
        } else if let Some(face) = walk.face {
            // There: turn to face what was shown.
            let facing;
            (yaw, facing) = turned(yaw, [face[0] - at[0], face[1] - at[1]], most_turn);
            if facing {
                walk.face = None;
            }
            at
        } else {
            return;
        };
        self.camera = Camera::walking(
            [moved[0], walk.eye_height, moved[1]],
            yaw,
            self.camera.pitch,
        );
        self.dirty = true;
    }

    /// Whether a move or a wall animation is running.
    pub fn animating(&self) -> bool {
        self.transition.is_some()
            || self.storeys_moving()
            || self.walker_moving()
            || cut_targets(&self.groups, &self.camera, self.cutaway, self.wall_height)
                .iter()
                .zip(&self.cuts)
                .any(|(t, c)| (t - c).abs() > 0.01)
    }

    /// Advances the animations to `now`. Returns whether another frame is needed.
    pub fn update(&mut self, now: f64) -> bool {
        let dt = self
            .last_time
            .map_or(16.0, |last| (now - last).clamp(0.0, 100.0));
        self.last_time = Some(now);
        if let Some(transition) = self.transition {
            let (camera, done) = transition.at(now);
            self.camera = camera;
            if done {
                self.transition = None;
            }
            self.dirty = true;
        }
        self.walk_step(dt);
        if self.orbiting() && self.transition.is_none() {
            self.camera.yaw = (self.camera.yaw + self.auto_orbit * dt).rem_euclid(TAU);
            self.dirty = true;
        }
        if self.storeys_moving() {
            let step = if self.still {
                1.0
            } else {
                dt.max(1.0) / SPREAD_MS
            };
            self.spread += (self.spread_target - self.spread).clamp(-step, step);
            self.side += (self.side_target - self.side).clamp(-step, step);
            self.bounds = self.shown_bounds(self.spread, self.side);
            self.dirty = true;
            self.shadows_dirty = true;
        }
        let targets = cut_targets(&self.groups, &self.camera, self.cutaway, self.wall_height);
        if self.cuts.len() != targets.len() {
            self.cuts.clone_from(&targets);
            self.shadows_dirty = true;
        }
        let step = if self.still {
            f64::INFINITY
        } else {
            CUT_SPEED * dt.max(1.0)
        };
        for (cut, target) in self.cuts.iter_mut().zip(&targets) {
            let diff = target - *cut;
            if diff.abs() > 0.01 {
                *cut += diff.clamp(-step, step);
                *cut = cut.clamp(CUT_HEIGHT.min(*target), self.wall_height.max(*target));
                self.shadows_dirty = true;
                self.dirty = true;
            }
        }
        self.animating() || self.orbiting()
    }
}

/// `yaw` turned towards `d` on the floor by at most `most` radians, and whether it faces it now
/// (ahead is (−sin yaw, −cos yaw)).
fn turned(yaw: f64, d: [f64; 2], most: f64) -> (f64, bool) {
    let mut turn = ((-d[0]).atan2(-d[1]) - yaw).rem_euclid(TAU);
    if turn > PI {
        turn -= TAU;
    }
    (yaw + turn.clamp(-most, most), turn.abs() <= most)
}

/// Smooth in and out.
fn ease(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

#[allow(clippy::cast_precision_loss)]
const fn rank_f64(rank: usize) -> f64 {
    rank as f64
}

#[cfg(test)]
mod tests {
    use super::*;
    use domotwin_core::plan::read_plan;
    use domotwin_core::scene::{SceneOptions, build_scene};

    const DEMO: &[u8] = include_bytes!("../../../examples/demo-apartment.domotwin.json");

    fn view() -> ViewState {
        let plan = read_plan(DEMO).unwrap();
        let scene = build_scene(&plan, &SceneOptions::default());
        let mut view = ViewState {
            aspect: 1.5,
            ..ViewState::default()
        };
        view.set_scene(&scene, false);
        view
    }

    #[test]
    fn plan_view_round_trip() {
        let mut view = view();
        let start = view.camera;
        view.set_plan_view(true, 0.0);
        assert!(view.update(10.0));
        let mut t = 10.0;
        while view.update(t) {
            t += 16.0;
            assert!(t < 5000.0, "the move ends");
        }
        assert!(view.camera.ortho > 0.999 && (view.camera.pitch - FRAC_PI_2).abs() < 1e-9);
        // The plan keeps full walls.
        assert!(
            view.cuts
                .iter()
                .all(|c| (c - view.wall_height).abs() < 1e-9)
        );
        view.set_plan_view(false, t);
        while view.update(t) {
            t += 16.0;
        }
        assert!((view.camera.yaw - start.yaw).abs() < 1e-9);
        assert!((view.camera.distance - start.distance).abs() < 1e-6);
    }

    #[test]
    fn walls_go_down_smoothly() {
        let mut view = view();
        view.cutaway = CutawayMode::Off;
        let mut t = 0.0;
        while view.update(t) {
            t += 16.0;
        }
        view.cutaway = CutawayMode::Always;
        let start = t + 16.0;
        assert!(view.update(start));
        let first = view.cuts.clone();
        assert!(
            first
                .iter()
                .all(|c| *c < view.wall_height && *c > CUT_HEIGHT)
        );
        let mut t = start;
        while view.update(t) {
            t += 16.0;
        }
        assert!(view.cuts.iter().all(|c| (c - CUT_HEIGHT).abs() < 1e-9));
        assert!(t - start > 200.0 && t - start < 1000.0, "{} ms", t - start);
    }

    #[test]
    fn under_reduced_motion_everything_gets_there_at_once() {
        let mut view = view();
        view.still = true;
        let mut to = view.camera;
        to.yaw += 1.0;
        view.go_to(to, 0.0);
        view.update(0.0);
        assert!((view.camera.yaw - to.clamped().yaw).abs() < 1e-9);
        // The walls in front go down in one frame.
        view.update(16.0);
        assert!(!view.animating());
        // A walk to somewhere: a leg a frame, turned at once.
        use domotwin_core::geometry::walls::WallLayout;
        use domotwin_core::walk::Floor;
        let plan = read_plan(DEMO).unwrap();
        view.start_walk(Floor::new(&plan, &WallLayout::new(&plan)), 0.0, 32.0);
        let mut t = 32.0;
        while view.update(t) {
            t += 16.0;
        }
        let eye = view.camera.eye();
        let (ahead, _) = view.camera.heading();
        let to = [eye[0] + ahead[0] * 150.0, eye[2] + ahead[1] * 150.0];
        view.walk_to(to);
        let mut frames = 0;
        while view.update(t) {
            t += 16.0;
            frames += 1;
        }
        assert!(frames <= 4, "{frames} frames");
        let there = view.camera.eye();
        assert!((there[0] - to[0]).hypot(there[2] - to[1]) < 1.0);
    }

    #[test]
    fn the_storeys_of_a_home_spread_apart_and_stack() {
        use domotwin_core::scene::build_home;
        const UPPER: &[u8] = include_bytes!("../../../examples/demo-upper-floor.domotwin.json");
        let ground = read_plan(DEMO).unwrap();
        let upper = read_plan(UPPER).unwrap();
        let scene = build_home(&[(&ground, 0.0), (&upper, 280.0)], &SceneOptions::default());
        let mut view = ViewState {
            aspect: 1.5,
            ..ViewState::default()
        };
        view.set_scene(&scene, false);
        assert_eq!(view.storey_count(), 2);
        // Spread apart by default, the roof above the top storey.
        let gap = SPREAD_GAP * view.wall_height;
        assert!(view.spread());
        assert_eq!(view.offset(0), [0.0; 3]);
        assert!((view.offset(1)[1] - 280.0 - gap).abs() < 1e-6);
        let roof = view.roof_offset().unwrap();
        assert!((roof[1] - (280.0 + 2.0 * gap)).abs() < 1e-6);
        let spread_top = view.bounds[1][1];
        // Stacked: the storeys go down to their heights, the camera frames the home again.
        view.set_spread(false, 0.0);
        assert!(view.storeys_moving() && view.animating());
        let mut t = 0.0;
        while view.update(t) {
            t += 16.0;
            assert!(t < 5_000.0);
        }
        assert!(t >= SPREAD_MS - 50.0, "{t} ms");
        assert!((view.offset(1)[1] - 280.0).abs() < 1e-9);
        assert!(view.bounds[1][1] < spread_top - gap);
        // Without its roof.
        view.set_roof(false);
        assert!(view.roof_offset().is_none());
        assert!(view.storey_bounds(1).is_some() && view.storey_bounds(2).is_none());
        // A storey alone stands at its height.
        let alone = build_home(&[(&upper, 280.0)], &SceneOptions::default());
        view.set_scene(&alone, false);
        assert!((view.offset(0)[1] - 280.0).abs() < 1e-9);
    }

    #[test]
    fn the_plan_of_a_home_lays_its_storeys_side_by_side() {
        use domotwin_core::scene::build_home;
        const UPPER: &[u8] = include_bytes!("../../../examples/demo-upper-floor.domotwin.json");
        let ground = read_plan(DEMO).unwrap();
        let upper = read_plan(UPPER).unwrap();
        let scene = build_home(&[(&ground, 0.0), (&upper, 280.0)], &SceneOptions::default());
        let mut view = ViewState {
            aspect: 1.5,
            ..ViewState::default()
        };
        view.set_scene(&scene, false);
        let finish = |view: &mut ViewState, mut t: f64| {
            while view.update(t) {
                t += 16.0;
                assert!(t < 10_000.0);
            }
            t
        };
        // On the plan, the storeys lie on the ground, the upper one on the right of the ground
        // floor, past a gap; no roof.
        view.set_plan_view(true, 0.0);
        let t = finish(&mut view, 0.0);
        let [g0, g1] = view.storey_bounds(0).unwrap();
        let [u0, _] = view.storey_bounds(1).unwrap();
        let (ground_at, upper_at) = (view.offset(0), view.offset(1));
        assert_eq!(ground_at, [0.0; 3]);
        assert!(
            upper_at[1].abs() < 1e-9 && upper_at[2].abs() < 1e-9,
            "{upper_at:?}"
        );
        let gap = u0[0] + upper_at[0] - g1[0];
        assert!(gap >= SIDE_GAP - 1e-6, "{gap}");
        assert!(view.roof_offset().is_none());
        // The camera frames both.
        assert!(view.bounds[0][0] <= g0[0] && view.bounds[1][0] >= g1[0] + gap);
        // Back to 3D: they stand up again, spread apart under the roof.
        view.set_plan_view(false, t);
        finish(&mut view, t);
        assert_eq!(view.offset(1)[0], 0.0);
        assert!(view.offset(1)[1] > 280.0 && view.roof_offset().is_some());
        // A view taller than wide lays them down the view, the highest on top.
        view.set_aspect(0.6);
        view.set_plan_view(true, 0.0);
        finish(&mut view, 0.0);
        assert!(view.offset(0)[2] > 0.0 && view.offset(1)[2].abs() < 1e-9);
        assert!(view.offset(0)[0].abs() < 1e-9);
        // Turned wide on the plan: across again, framed again.
        let down = view.camera;
        view.set_aspect(1.6);
        assert!(view.offset(1)[0] > 0.0 && view.offset(0)[2].abs() < 1e-9);
        assert!(view.camera != down && !view.storeys_moving());
        view.set_aspect(0.6);
        // A scene loaded on the plan starts there, without moving.
        view.set_scene(&scene, false);
        assert!(!view.storeys_moving());
        assert!(view.offset(0)[2] > 0.0);
    }

    #[test]
    fn walking_goes_where_the_floor_is_tapped() {
        use domotwin_core::geometry::walls::WallLayout;
        use domotwin_core::walk::Floor;
        let plan = read_plan(DEMO).unwrap();
        let mut view = view();
        view.start_walk(Floor::new(&plan, &WallLayout::new(&plan)), 0.0, 0.0);
        let mut t = 0.0;
        while view.update(t) {
            t += 16.0;
            assert!(t < 10_000.0);
        }
        assert!(view.walking() && view.camera.walk == 1.0);
        let eye = view.camera.eye();
        assert!((eye[1] - 160.0).abs() < 1e-6, "{eye:?}");
        // Somewhere else in the same room.
        let (ahead, _) = view.camera.heading();
        let to = [eye[0] + ahead[0] * 150.0, eye[2] + ahead[1] * 150.0];
        view.walk_to(to);
        while view.update(t) {
            t += 16.0;
            assert!(t < 20_000.0);
        }
        let there = view.camera.eye();
        assert!(
            (there[0] - to[0]).hypot(there[2] - to[1]) < 1.0,
            "{there:?} {to:?}"
        );
        // Out: back where it was.
        view.stop_walk(t);
        while view.update(t) {
            t += 16.0;
        }
        assert!(!view.walking() && view.camera.walk == 0.0);
    }

    #[test]
    fn a_walk_stays_whole_through_rebuilds_drags_and_viewpoints() {
        use domotwin_core::geometry::walls::WallLayout;
        use domotwin_core::walk::Floor;
        let plan = read_plan(DEMO).unwrap();
        let floor = || Floor::new(&plan, &WallLayout::new(&plan));
        let mut view = view();
        view.start_walk(floor(), 0.0, 0.0);
        let mut t = 0.0;
        while view.update(t) {
            t += 16.0;
        }
        // Into a room: well inside it, through the doors.
        let spot = view.room_spot("bedroom").unwrap();
        view.walk_to(spot);
        view.update(t + 16.0);
        // The same storey built again (its 3D files came): on with the walk.
        view.set_walk_floor(floor(), 0.0);
        assert!(view.walker_moving());
        while view.update(t) {
            t += 16.0;
            assert!(t < 60_000.0);
        }
        let eye = view.camera.eye();
        assert!((eye[0] - spot[0]).hypot(eye[2] - spot[1]) < 1.0, "{eye:?}");
        // A drag while leaving: out of the eyes at once, not stuck half way.
        view.stop_walk(t);
        view.update(t + 200.0);
        assert!(view.camera.walk > 0.0 && view.camera.walk < 1.0);
        view.orbit(10.0, 0.0);
        assert!(view.camera.walk == 0.0);
        // A piece shown while walking: up to it, then facing it.
        view.start_walk(floor(), 0.0, t);
        while view.update(t) {
            t += 16.0;
        }
        // The sofa: 90 × 210 at (380, 105).
        let [min, max] = [[380.0, 0.0, 105.0], [470.0, 85.0, 315.0]];
        view.focus([min, max], None, t);
        while view.update(t) {
            t += 16.0;
            assert!(t < 120_000.0);
        }
        let eye = view.camera.eye();
        let (ahead, _) = view.camera.heading();
        let to = [425.0 - eye[0], 210.0 - eye[2]];
        let far = to[0].hypot(to[1]);
        assert!(far < 105.0 + 90.0 + 1.0, "{eye:?}");
        assert!(
            (ahead[0] * to[0] + ahead[1] * to[1]) / far > 0.99,
            "{ahead:?} {to:?}"
        );
        // A saved viewpoint ends a walk.
        view.start_walk(floor(), 0.0, t);
        view.show_camera(view.overview_camera(), t);
        assert!(!view.walking());
        // The same storey built again half way into a walk: the move goes on to the eyes.
        view.start_walk(floor(), 0.0, t);
        t += 300.0;
        view.update(t);
        view.set_scene(&build_scene(&plan, &SceneOptions::default()), true);
        view.set_walk_floor(floor(), 0.0);
        while view.update(t) {
            t += 16.0;
        }
        assert!(view.camera.walk == 1.0 && (view.camera.eye()[1] - 160.0).abs() < 1e-6);
    }

    #[test]
    fn interactions_stop_moves() {
        let mut view = view();
        view.overview(0.0);
        view.orbit(30.0, 0.0);
        assert!(view.transition.is_none());
        view.set_plan_view(true, 0.0);
        let yaw = view.camera.yaw;
        view.update(10_000.0);
        view.orbit(50.0, 50.0);
        assert!((view.camera.yaw - 0.0).abs() < 1e-9 || (view.camera.yaw - yaw).abs() < 1e-9);
    }

    #[test]
    fn frames_back_in_time_move_nothing_back() {
        // The frontend's `settle()` draws frames ahead of the page's clock (100 ms each, up to
        // 30 s): the page's own frames then come earlier than the last one.
        let ahead = |view: &mut ViewState| {
            for k in 1..=10 {
                view.update(f64::from(k) * 100.0);
            }
        };
        let mut view = view();
        view.set_auto_orbit(0.1);
        ahead(&mut view);
        let camera = view.camera;
        // The kiosk's turn neither goes back nor jumps on, then goes on from the page's clock.
        view.update(16.0);
        assert!(view.camera == camera);
        view.update(32.0);
        let turned = (view.camera.yaw - camera.yaw).rem_euclid(TAU);
        assert!((turned - 0.1 * 0.016).abs() < 1e-9, "{turned}");
        // A move started on the page's clock right after: it runs on that clock, not held until
        // the clock that ran ahead.
        view.set_auto_orbit(0.0);
        ahead(&mut view);
        let from = view.camera;
        let mut to = from;
        to.yaw += 1.0;
        view.go_to(to, 48.0);
        view.update(48.0 + MOVE_MS / 2.0);
        assert!(
            view.camera.yaw > from.yaw && view.camera.yaw < from.yaw + 1.0,
            "{}",
            view.camera.yaw
        );
        view.update(48.0 + MOVE_MS);
        assert!(view.transition.is_none());
        assert!((view.camera.yaw - to.clamped().yaw).abs() < 1e-9);
    }
}
