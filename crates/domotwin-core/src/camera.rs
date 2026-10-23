//! Camera math: an orbit camera around a target, the 2D plan view (orthographic, from above),
//! fitting a box, saved viewpoints, smooth transitions and the cut-away decision per wall group.
//!
//! World axes: `x` = plan x, `y` up, `z` = plan y (cm). Matrices are column-major, for WebGL.

use std::f64::consts::{FRAC_PI_2, PI, TAU};

use crate::geometry::heights::CUT_HEIGHT;
use crate::scene::WallGroup;

/// Lowest pitch (radians above the horizon).
pub const MIN_PITCH: f64 = 0.08;
/// Closest and farthest distances to the target (cm).
pub const DISTANCE_RANGE: (f64, f64) = (60.0, 30_000.0);
/// Vertical field of view of the 3D view (radians).
pub const FOV: f64 = 0.70;

/// A camera state. `ortho` blends from perspective (0) to the 2D plan (1).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Camera {
    /// Point looked at.
    pub target: [f64; 3],
    /// Direction of the camera around the target (radians): 0 = on the plan's +y side (south),
    /// growing counter-clockwise seen from above.
    pub yaw: f64,
    /// Angle above the horizon (radians), `MIN_PITCH`–π/2.
    pub pitch: f64,
    /// Distance to the target (cm).
    pub distance: f64,
    /// 0 = perspective, 1 = orthographic plan view.
    pub ortho: f64,
}

impl Default for Camera {
    fn default() -> Self {
        Self {
            target: [0.0; 3],
            yaw: 0.6,
            pitch: 0.75,
            distance: 1500.0,
            ortho: 0.0,
        }
    }
}

/// View and projection of a camera for one frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Projection {
    /// Camera position used for the frame.
    pub eye: [f64; 3],
    /// Unit vectors: right, up and forward.
    pub right: [f64; 3],
    /// Up on screen.
    pub up: [f64; 3],
    /// Looking direction.
    pub forward: [f64; 3],
    /// View matrix (column-major).
    pub view: [f32; 16],
    /// Projection matrix (column-major).
    pub proj: [f32; 16],
    /// `proj × view`.
    pub view_proj: [f32; 16],
    /// Half the visible height at the target (cm).
    pub half_height: f64,
    /// Width / height.
    pub aspect: f64,
    /// Orthographic.
    pub orthographic: bool,
    /// Tangent of half the vertical field of view (perspective).
    pub tan_half_fov: f64,
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn mul(a: &[f32; 16], b: &[f32; 16]) -> [f32; 16] {
    let mut out = [0.0; 16];
    for col in 0..4 {
        for row in 0..4 {
            out[col * 4 + row] = (0..4).map(|k| a[k * 4 + row] * b[col * 4 + k]).sum();
        }
    }
    out
}

impl Camera {
    /// Unit vector from the target to the camera.
    pub fn back(&self) -> [f64; 3] {
        let (sy, cy) = self.yaw.sin_cos();
        let (sp, cp) = self.pitch.sin_cos();
        [cp * sy, sp, cp * cy]
    }

    /// Camera position.
    pub fn eye(&self) -> [f64; 3] {
        let b = self.back();
        [
            self.target[0] + b[0] * self.distance,
            self.target[1] + b[1] * self.distance,
            self.target[2] + b[2] * self.distance,
        ]
    }

    /// Keeps the state within its ranges.
    pub fn clamped(mut self) -> Self {
        self.pitch = if self.pitch.is_finite() {
            self.pitch.clamp(MIN_PITCH, FRAC_PI_2)
        } else {
            FRAC_PI_2
        };
        self.yaw = if self.yaw.is_finite() {
            self.yaw.rem_euclid(TAU)
        } else {
            0.0
        };
        self.distance = if self.distance.is_finite() {
            self.distance.clamp(DISTANCE_RANGE.0, DISTANCE_RANGE.1)
        } else {
            DISTANCE_RANGE.1
        };
        self.ortho = if self.ortho.is_finite() {
            self.ortho.clamp(0.0, 1.0)
        } else {
            0.0
        };
        if !self.target.iter().all(|v| v.is_finite()) {
            self.target = [0.0; 3];
        }
        self
    }

    /// The view and projection for a viewport of `aspect` (width / height); `depth` is the
    /// radius (cm) of the scene around the target, for the clipping planes.
    #[allow(clippy::cast_possible_truncation)]
    pub fn projection(&self, aspect: f64, depth: f64) -> Projection {
        let aspect = if aspect.is_finite() && aspect > 0.01 {
            aspect
        } else {
            1.0
        };
        let half_height = self.distance * (FOV / 2.0).tan();
        // Towards the plan view, narrow the field of view and step back to keep the framing,
        // then switch to a true orthographic projection.
        let orthographic = self.ortho > 0.999;
        let fov = (FOV * (1.0 - self.ortho).powi(2)).max(0.02);
        let tan_half_fov = (fov / 2.0).tan();
        let distance = if orthographic {
            self.distance.max(depth * 2.0 + 100.0)
        } else {
            half_height / tan_half_fov
        };
        let (sy, cy) = self.yaw.sin_cos();
        let (sp, cp) = self.pitch.sin_cos();
        let back = [cp * sy, sp, cp * cy];
        let eye = [
            self.target[0] + back[0] * distance,
            self.target[1] + back[1] * distance,
            self.target[2] + back[2] * distance,
        ];
        let forward = [-back[0], -back[1], -back[2]];
        let right = [cy, 0.0, -sy];
        let up = cross(right, forward);
        let t = [-dot(right, eye), -dot(up, eye), dot(forward, eye)];
        let f = |v: f64| v as f32;
        let view = [
            f(right[0]),
            f(up[0]),
            f(-forward[0]),
            0.0,
            f(right[1]),
            f(up[1]),
            f(-forward[1]),
            0.0,
            f(right[2]),
            f(up[2]),
            f(-forward[2]),
            0.0,
            f(t[0]),
            f(t[1]),
            f(t[2]),
            1.0,
        ];
        let depth = depth.max(100.0);
        let near = (distance - depth * 1.5).max(distance * 0.002).max(1.0);
        let far = distance + depth * 1.5;
        let proj = if orthographic {
            let (h, w) = (half_height, half_height * aspect);
            [
                f(1.0 / w),
                0.0,
                0.0,
                0.0,
                0.0,
                f(1.0 / h),
                0.0,
                0.0,
                0.0,
                0.0,
                f(-2.0 / (far - near)),
                0.0,
                0.0,
                0.0,
                f(-(far + near) / (far - near)),
                1.0,
            ]
        } else {
            let fy = 1.0 / tan_half_fov;
            [
                f(fy / aspect),
                0.0,
                0.0,
                0.0,
                0.0,
                f(fy),
                0.0,
                0.0,
                0.0,
                0.0,
                f((far + near) / (near - far)),
                -1.0,
                0.0,
                0.0,
                f(2.0 * far * near / (near - far)),
                0.0,
            ]
        };
        Projection {
            eye,
            right,
            up,
            forward,
            view,
            proj,
            view_proj: mul(&proj, &view),
            half_height,
            aspect,
            orthographic,
            tan_half_fov,
        }
    }

    /// Turns the camera: `dx`, `dy` in pixels.
    pub fn orbit(&mut self, dx: f64, dy: f64) {
        self.yaw -= dx * 0.006;
        self.pitch += dy * 0.006;
        *self = self.clamped();
    }

    /// Moves the target with the pointer: `dx`, `dy` in pixels on a viewport `height` pixels
    /// high, so that the point under the pointer follows it.
    pub fn pan(&mut self, dx: f64, dy: f64, height: f64) {
        let per_pixel = 2.0 * self.distance * (FOV / 2.0).tan() / height.max(1.0);
        let (sy, cy) = self.yaw.sin_cos();
        let right = [cy, -sy];
        // Screen up projected on the floor (towards the target, seen from the camera).
        let ahead = [-sy, -cy];
        // Dragging up a tilted view moves farther per pixel than across.
        let depth_factor = 1.0 / self.pitch.sin().max(0.3);
        self.target[0] -= (right[0] * dx - ahead[0] * dy * depth_factor) * per_pixel;
        self.target[2] -= (right[1] * dx - ahead[1] * dy * depth_factor) * per_pixel;
        *self = self.clamped();
    }

    /// Zooms by `factor` (< 1 closer) towards `toward` (a point on the floor), when given.
    pub fn zoom(&mut self, factor: f64, toward: Option<[f64; 3]>) {
        if !factor.is_finite() || factor <= 0.0 {
            return;
        }
        let before = self.distance;
        self.distance = (self.distance * factor).clamp(DISTANCE_RANGE.0, DISTANCE_RANGE.1);
        if let Some(p) = toward {
            let k = 1.0 - self.distance / before;
            for axis in [0, 2] {
                self.target[axis] += (p[axis] - self.target[axis]) * k;
            }
        }
        *self = self.clamped();
    }

    /// The point of the floor (`y = 0`) under the screen point `ndc` (−1…1, y up), if any.
    pub fn floor_point(&self, aspect: f64, ndc: [f64; 2]) -> Option<[f64; 3]> {
        let p = self.projection(aspect, 1000.0);
        let (origin, dir) = if p.orthographic {
            let w = p.half_height * aspect;
            let o = [
                p.eye[0] + p.right[0] * ndc[0] * w + p.up[0] * ndc[1] * p.half_height,
                p.eye[1] + p.right[1] * ndc[0] * w + p.up[1] * ndc[1] * p.half_height,
                p.eye[2] + p.right[2] * ndc[0] * w + p.up[2] * ndc[1] * p.half_height,
            ];
            (o, p.forward)
        } else {
            let (sx, sy) = (ndc[0] * p.tan_half_fov * aspect, ndc[1] * p.tan_half_fov);
            let d = [
                p.forward[0] + p.right[0] * sx + p.up[0] * sy,
                p.forward[1] + p.right[1] * sx + p.up[1] * sy,
                p.forward[2] + p.right[2] * sx + p.up[2] * sy,
            ];
            (p.eye, d)
        };
        if dir[1] > -1e-6 {
            return None;
        }
        let t = -origin[1] / dir[1];
        Some([origin[0] + dir[0] * t, 0.0, origin[2] + dir[2] * t])
    }

    /// The camera framing the box `[min, max]` with the given yaw and pitch.
    pub fn framing(bounds: [[f64; 3]; 2], yaw: f64, pitch: f64, aspect: f64, ortho: f64) -> Self {
        let [min, max] = bounds;
        let centre = [
            f64::midpoint(min[0], max[0]),
            f64::midpoint(min[1], max[1]) * 0.3,
            f64::midpoint(min[2], max[2]),
        ];
        let size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
        let aspect = if aspect.is_finite() && aspect > 0.01 {
            aspect
        } else {
            1.0
        };
        // Size of the box seen from the camera: its plan extent turned by the yaw, foreshortened
        // by the pitch.
        let (sy, cy) = yaw.sin_cos();
        let across = (size[0] * cy).abs() + (size[2] * sy).abs();
        let along = (size[0] * sy).abs() + (size[2] * cy).abs();
        let tall = along * pitch.sin() + size[1] * pitch.cos();
        let half = (tall / 2.0).max(across / 2.0 / aspect) * 1.12 + 30.0;
        let distance = half / (FOV / 2.0).tan();
        Camera {
            target: centre,
            yaw,
            pitch,
            distance,
            ortho,
        }
        .clamped()
    }

    /// The camera of a saved viewpoint: position and target `[x, height, plan y]`.
    pub fn from_view(position: [f64; 3], target: [f64; 3]) -> Self {
        let d = [
            position[0] - target[0],
            position[1] - target[1],
            position[2] - target[2],
        ];
        let distance = dot(d, d).sqrt();
        if distance < 1e-6 {
            return Camera {
                target,
                ..Camera::default()
            }
            .clamped();
        }
        let horizontal = d[0].hypot(d[2]);
        Camera {
            target,
            yaw: d[0].atan2(d[2]),
            pitch: d[1].atan2(horizontal),
            distance,
            ortho: 0.0,
        }
        .clamped()
    }

    /// The state between `self` (`t` = 0) and `to` (`t` = 1); the yaw takes the shorter way.
    pub fn lerp(&self, to: &Camera, t: f64) -> Camera {
        let t = t.clamp(0.0, 1.0);
        let mix = |a: f64, b: f64| a + (b - a) * t;
        let mut dyaw = (to.yaw - self.yaw).rem_euclid(TAU);
        if dyaw > PI {
            dyaw -= TAU;
        }
        Camera {
            target: [
                mix(self.target[0], to.target[0]),
                mix(self.target[1], to.target[1]),
                mix(self.target[2], to.target[2]),
            ],
            yaw: self.yaw + dyaw * t,
            pitch: mix(self.pitch, to.pitch),
            // Distances blend geometrically, so zooming feels even.
            distance: (self.distance.ln() + (to.distance.ln() - self.distance.ln()) * t).exp(),
            ortho: mix(self.ortho, to.ortho),
        }
        .clamped()
    }
}

/// Ease in and out.
pub fn ease(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    if t < 0.5 {
        4.0 * t * t * t
    } else {
        1.0 - (-2.0 * t + 2.0).powi(3) / 2.0
    }
}

/// A camera move over time.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Transition {
    /// Start state.
    pub from: Camera,
    /// End state.
    pub to: Camera,
    /// Start time (ms).
    pub start: f64,
    /// Duration (ms).
    pub duration: f64,
}

impl Transition {
    /// The state at `now`, and whether the move is over.
    pub fn at(&self, now: f64) -> (Camera, bool) {
        if self.duration <= 0.0 || now >= self.start + self.duration {
            return (self.to, true);
        }
        let t = ((now - self.start) / self.duration).max(0.0);
        (self.from.lerp(&self.to, ease(t)), false)
    }
}

/// Which walls the automatic cut-away lowers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CutawayMode {
    /// The walls between the camera and the rooms.
    #[default]
    Auto,
    /// Every wall.
    Always,
    /// None: full walls.
    Off,
}

impl CutawayMode {
    /// From the card option (`auto`, `always`, `off`); unknown names give `Auto`.
    pub fn from_name(name: &str) -> Self {
        match name {
            "always" => Self::Always,
            "off" => Self::Off,
            _ => Self::Auto,
        }
    }
}

/// The cut height wanted for each wall group, seen from `camera`.
pub fn cut_targets(
    groups: &[WallGroup],
    camera: &Camera,
    mode: CutawayMode,
    wall_height: f64,
) -> Vec<f64> {
    let back = camera.back();
    let horizontal = back[0].hypot(back[2]);
    // From (almost) straight above, walls hide nothing: keep them.
    let looking_down = camera.pitch > 1.35 || camera.ortho > 0.5;
    groups
        .iter()
        .map(|group| {
            let cut = match mode {
                CutawayMode::Off => false,
                CutawayMode::Always => true,
                CutawayMode::Auto if looking_down || horizontal < 1e-6 => false,
                CutawayMode::Auto => {
                    let dot = (group.normal[0] * back[0] + group.normal[1] * back[2]) / horizontal;
                    if group.inner {
                        dot.abs() > 0.35
                    } else {
                        dot > 0.2
                    }
                }
            };
            if cut { CUT_HEIGHT } else { wall_height }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn apply(m: &[f32; 16], p: [f64; 3]) -> [f64; 3] {
        #[allow(clippy::cast_possible_truncation)]
        let v = [p[0] as f32, p[1] as f32, p[2] as f32, 1.0];
        let mut out = [0.0_f32; 4];
        for (row, o) in out.iter_mut().enumerate() {
            *o = (0..4).map(|k| m[k * 4 + row] * v[k]).sum();
        }
        [
            f64::from(out[0] / out[3]),
            f64::from(out[1] / out[3]),
            f64::from(out[2] / out[3]),
        ]
    }

    #[test]
    fn target_is_at_the_centre_of_the_screen() {
        let camera = Camera {
            target: [300.0, 0.0, 200.0],
            ..Camera::default()
        };
        let p = camera.projection(1.5, 1000.0);
        let c = apply(&p.view_proj, camera.target);
        assert!(c[0].abs() < 1e-4 && c[1].abs() < 1e-4 && c[2].abs() < 1.0);
    }

    #[test]
    fn plan_view_has_north_up_and_east_right() {
        let camera = Camera {
            target: [0.0; 3],
            yaw: 0.0,
            pitch: FRAC_PI_2,
            distance: 1000.0,
            ortho: 1.0,
        };
        let p = camera.projection(1.0, 1000.0);
        assert!(p.orthographic);
        let east = apply(&p.view_proj, [100.0, 0.0, 0.0]);
        let north = apply(&p.view_proj, [0.0, 0.0, -100.0]);
        assert!(east[0] > 0.0 && east[1].abs() < 1e-4);
        assert!(north[1] > 0.0 && north[0].abs() < 1e-4);
    }

    #[test]
    fn floor_point_under_the_centre_is_the_target() {
        let camera = Camera {
            target: [120.0, 0.0, -40.0],
            ..Camera::default()
        };
        let Some(p) = camera.floor_point(1.3, [0.0, 0.0]) else {
            panic!("the floor is in view")
        };
        assert!((p[0] - 120.0).abs() < 1e-6 && (p[2] - -40.0).abs() < 1e-6);
        let plan = Camera {
            pitch: FRAC_PI_2,
            ortho: 1.0,
            ..camera
        };
        let Some(p) = plan.floor_point(1.0, [1.0, 0.0]) else {
            panic!("the floor is in view")
        };
        assert!(p[0] > 120.0);
    }

    #[test]
    fn framing_and_views() {
        let bounds = [[0.0, 0.0, 0.0], [1000.0, 265.0, 600.0]];
        let camera = Camera::framing(bounds, 0.6, 0.75, 1.5, 0.0);
        let p = camera.projection(1.5, 1200.0);
        for corner in [
            [0.0, 0.0, 0.0],
            [1000.0, 265.0, 600.0],
            [1000.0, 0.0, 0.0],
            [0.0, 265.0, 600.0],
        ] {
            let c = apply(&p.view_proj, corner);
            assert!(c[0].abs() <= 1.0 && c[1].abs() <= 1.0, "{corner:?} → {c:?}");
        }
        let view = Camera::from_view([500.0, 800.0, 1300.0], [500.0, 0.0, 300.0]);
        let eye = view.eye();
        assert!((eye[0] - 500.0).abs() < 1e-6 && (eye[1] - 800.0).abs() < 1e-6);
        assert!((eye[2] - 1300.0).abs() < 1e-6);
    }

    #[test]
    fn transitions_take_the_short_way() {
        let a = Camera {
            yaw: 0.1,
            ..Camera::default()
        };
        let b = Camera {
            yaw: TAU - 0.1,
            ..Camera::default()
        };
        let half = a.lerp(&b, 0.5);
        assert!(half.yaw < 0.01 || half.yaw > TAU - 0.01);
        let move_ = Transition {
            from: a,
            to: b,
            start: 0.0,
            duration: 400.0,
        };
        assert!(!move_.at(200.0).1);
        assert_eq!(move_.at(400.0), (b, true));
    }

    #[test]
    fn cutaway_lowers_the_walls_facing_the_camera() {
        let groups = [
            WallGroup {
                normal: [0.0, 1.0],
                inner: false,
            },
            WallGroup {
                normal: [0.0, -1.0],
                inner: false,
            },
            WallGroup {
                normal: [1.0, 0.0],
                inner: true,
            },
        ];
        // Camera on the +y (south) side: the south façade is cut, the north one kept.
        let camera = Camera {
            yaw: 0.0,
            ..Camera::default()
        };
        let cuts = cut_targets(&groups, &camera, CutawayMode::Auto, 265.0);
        assert_eq!(cuts, vec![CUT_HEIGHT, 265.0, 265.0]);
        let top = Camera {
            pitch: FRAC_PI_2,
            ..camera
        };
        assert_eq!(
            cut_targets(&groups, &top, CutawayMode::Auto, 265.0),
            vec![265.0; 3]
        );
        assert_eq!(
            cut_targets(&groups, &camera, CutawayMode::Always, 265.0),
            vec![CUT_HEIGHT; 3]
        );
        assert_eq!(
            cut_targets(&groups, &camera, CutawayMode::Off, 265.0),
            vec![265.0; 3]
        );
    }
}
