//! What the view shows and how it moves: the camera and its transitions, the 2D plan switch, the
//! animated cut-away of each wall group, and where the storeys of a home are drawn (D-028): spread
//! apart or stacked in 3D, side by side on the 2D plan. No GPU here, so it is tested natively.

use domotwin_core::camera::{Camera, CutawayMode, Transition, cut_targets};
use domotwin_core::geometry::heights::CUT_HEIGHT;
use domotwin_core::scene::{Scene, WallGroup};
use std::f64::consts::FRAC_PI_2;

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
    /// Viewport width / height.
    pub aspect: f64,
    last_time: Option<f64>,
    /// Something changed since the last frame.
    pub dirty: bool,
    /// The cut-away changed since the last shadow map.
    pub shadows_dirty: bool,
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
            aspect: 1.0,
            last_time: None,
            dirty: true,
            shadows_dirty: true,
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
        if !keep_camera {
            // A home framed afresh stands as asked, without spreading or stacking first.
            self.spread = self.spread_target;
            self.side_down = self.aspect < SIDE_DOWN_ASPECT;
        }
        self.lay_side_by_side();
        self.bounds = self.shown_bounds(self.spread, self.side);
        self.transition = None;
        // On the plan, a storey more or less moves the others: framed again.
        let reframe = self.plan_view && self.storeys.len() != storeys_before;
        if !keep_camera || reframe {
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
            duration: MOVE_MS,
        });
        self.dirty = true;
    }

    /// Back to the overview.
    pub fn overview(&mut self, now: f64) {
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

    /// Frames a box (a room or a piece) from the current direction.
    pub fn focus(&mut self, bounds: [[f64; 3]; 2], now: f64) {
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
        self.camera.orbit(dx, dy);
        self.dirty = true;
    }

    /// Pans the view; `height` is the viewport height in pixels.
    pub fn pan(&mut self, dx: f64, dy: f64, height: f64) {
        self.stop();
        self.camera.pan(dx, dy, height);
        self.dirty = true;
    }

    /// Zooms by `factor` towards the screen point `ndc`.
    pub fn zoom(&mut self, factor: f64, ndc: [f64; 2]) {
        self.stop();
        // On the plane at the target's height: the point under the centre is the target, so a zoom
        // there goes straight in, however high the home is framed.
        let toward = self
            .camera
            .plane_point(self.aspect, ndc, self.camera.target[1]);
        self.camera.zoom(factor, toward);
        self.dirty = true;
    }

    /// Stops a running move where it is.
    fn stop(&mut self) {
        self.transition = None;
    }

    /// Whether a move or a wall animation is running.
    pub fn animating(&self) -> bool {
        self.transition.is_some()
            || self.storeys_moving()
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
        if self.storeys_moving() {
            let step = dt.max(1.0) / SPREAD_MS;
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
        let step = CUT_SPEED * dt.max(1.0);
        for (cut, target) in self.cuts.iter_mut().zip(&targets) {
            let diff = target - *cut;
            if diff.abs() > 0.01 {
                *cut += diff.clamp(-step, step);
                *cut = cut.clamp(CUT_HEIGHT.min(*target), self.wall_height.max(*target));
                self.shadows_dirty = true;
                self.dirty = true;
            }
        }
        self.animating()
    }
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

    const DEMO: &[u8] = include_bytes!("../../../examples/demo-apartment.plan.json");

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
    fn the_storeys_of_a_home_spread_apart_and_stack() {
        use domotwin_core::scene::build_home;
        const UPPER: &[u8] = include_bytes!("../../../examples/demo-upper-floor.plan.json");
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
        const UPPER: &[u8] = include_bytes!("../../../examples/demo-upper-floor.plan.json");
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
}
