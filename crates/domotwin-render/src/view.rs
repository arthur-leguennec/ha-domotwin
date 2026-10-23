//! What the view shows and how it moves: the camera and its transitions, the 2D plan switch and
//! the animated cut-away of each wall group. No GPU here, so it is tested natively.

use domotwin_core::camera::{Camera, CutawayMode, Transition, cut_targets};
use domotwin_core::geometry::heights::CUT_HEIGHT;
use domotwin_core::scene::{Scene, WallGroup};
use std::f64::consts::FRAC_PI_2;

/// Duration of camera moves (ms).
const MOVE_MS: f64 = 650.0;
/// Speed of the walls going down or up (cm per ms).
const CUT_SPEED: f64 = 0.75;

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
    /// World bounds of the scene.
    pub bounds: [[f64; 3]; 2],
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
        let [min, max] = scene.bounds;
        self.bounds = [
            [f64::from(min[0]), f64::from(min[1]), f64::from(min[2])],
            [f64::from(max[0]), f64::from(max[1]), f64::from(max[2])],
        ];
        self.transition = None;
        if !keep_camera {
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

    /// The overview: the whole home from above and a corner.
    pub fn overview_camera(&self) -> Camera {
        Camera::framing(self.bounds, 0.6, 0.82, self.aspect, 0.0)
    }

    /// The whole plan, north up, seen from above.
    fn plan_camera(&self) -> Camera {
        Camera::framing(self.bounds, 0.0, FRAC_PI_2, self.aspect, 1.0)
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
        let toward = self.camera.floor_point(self.aspect, ndc);
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
