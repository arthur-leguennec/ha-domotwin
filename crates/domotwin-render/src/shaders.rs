//! GLSL ES 3.00 sources. three-d prepends the `#version` line and the default precisions.
//!
//! One vertex shader serves every pass. It reads the packed attributes of
//! `domotwin_core::scene::mesh::Mesh` and applies the cut-away: walls lower to the height of their
//! group, pieces starting above it and things hanging on a cut wall disappear. It also reads the
//! live look of the vertex's element (its light, greyed out, tap highlight, power) from
//! `u_elements`.

/// Vertex shader of every pass.
/// The looks' steps of light and vividness (D-036), shared by the home's and the people's shaders:
/// GLSL that needs `u_bands` and `u_saturation`.
macro_rules! shading_glsl {
    () => {
        r"
// Light in the look's steps (as drawn by hand), their edges smoothed over a pixel or so. Called
// where every pixel of a quad runs (it takes a derivative).
float band(float x) {
    if (u_bands < 0.5) {
        return x;
    }
    float s = x * u_bands;
    float edge = max(fwidth(s), 1e-4);
    return (floor(s) + smoothstep(0.5 - edge, 0.5 + edge, fract(s))) / u_bands;
}

// Colours more vivid (above 1) or duller (below 1).
vec3 saturated(vec3 c) {
    float grey = dot(c, vec3(0.2126, 0.7152, 0.0722));
    return max(mix(vec3(grey), c, u_saturation), 0.0);
}
"
    };
}

pub(crate) const VERTEX: &str = r"
uniform mat4 u_view_proj;
uniform vec4 u_cut[32];
uniform float u_wall_height;
// Drawing the walls' mesh in the looks with glass walls (D-027): 1 their tops alone (opaque), 2
// their faces alone (glass); 0 everything.
uniform float u_wall_pass;
// The surface of the tops of the walls (`Surface::WallCap`).
const uint WALL_CAP = 11u;
// Element tags per row of `u_elements` (`lamps::ELEMENTS_PER_ROW`).
const uint ELEMENTS_PER_ROW = 512u;
// Where the storey drawn is moved to (D-028): up to its floor's height, more when the storeys are
// spread apart, or beside the others on the 2D plan.
uniform vec3 u_offset;
// Three texels per element tag: light (rgb, strength), flags (greyed out, highlight, selected,
// in conflict), power layer level.
uniform sampler2D u_elements;

in vec4 a_position;
in ivec4 a_normal;
in uvec4 a_color;
in uvec4 a_extra;
in vec2 a_uv;

out vec3 v_world;
// Where the fragment is on its storey's own plan (x, z), wherever the storey is drawn.
out vec2 v_plan;
// Height above its storey's floor.
out float v_height;
out vec3 v_normal;
out vec4 v_color;
out vec2 v_uv;
flat out uint v_surface;
flat out uint v_element;
flat out vec4 v_look;
flat out vec4 v_flags;
flat out float v_power;
flat out float v_upkeep;
flat out float v_room;
flat out float v_glass;

float cut_height(uint group) {
    vec4 slot = u_cut[group >> 2u];
    uvec4 lane = uvec4(group & 3u);
    return dot(slot, vec4(equal(lane, uvec4(0u, 1u, 2u, 3u))));
}

void main() {
    vec3 p = a_position.xyz;
    uint mode = a_extra.y & 3u;
    uint group = a_extra.x;
    bool hidden = false;
    if (mode != 0u && group < 128u) {
        float cut = cut_height(group);
        if (mode == 1u) {
            hidden = a_position.w >= cut - 0.01;
            p.y = min(p.y, cut);
        } else {
            hidden = cut < u_wall_height - 0.5;
        }
    }
    v_surface = a_extra.y >> 2u;
    if (u_wall_pass > 0.5 && (v_surface == WALL_CAP) != (u_wall_pass < 1.5)) {
        hidden = true;
    }
    v_glass = u_wall_pass > 1.5 ? 1.0 : 0.0;
    v_height = p.y;
    v_plan = p.xz;
    p += u_offset;
    v_world = p;
    v_normal = vec3(a_normal.xyz) / 127.0;
    v_color = vec4(a_color) / 255.0;
    v_uv = a_uv;
    v_element = a_extra.z | (a_extra.w << 8u);
    ivec2 at = ivec2(int(v_element % ELEMENTS_PER_ROW) * 3, int(v_element / ELEMENTS_PER_ROW));
    v_look = texelFetch(u_elements, at, 0);
    v_flags = texelFetch(u_elements, at + ivec2(1, 0), 0);
    vec4 extra = texelFetch(u_elements, at + ivec2(2, 0), 0);
    v_power = extra.r;
    v_upkeep = extra.g;
    v_room = float(uint(a_normal.w) & 255u);
    // A hidden piece is moved outside the clip volume: all its vertices share the test.
    gl_Position = hidden ? vec4(0.0, 0.0, 2.0, 1.0) : u_view_proj * vec4(p, 1.0);
}
";

/// What the variant of [`FRAGMENT`] drawing the garden's grounds (D-077) starts with.
pub(crate) const GARDEN: &str = "#define GARDEN\n";

/// Shading of the colour passes (opaque and transparent).
pub(crate) const FRAGMENT: &str = concat!(
    r"
precision highp sampler2D;

uniform vec3 u_eye;
uniform vec3 u_sun;
uniform float u_flat;
uniform float u_shadows;
uniform float u_fog;
// Where the fog thins: the home's centre on the ground and its size (cm).
uniform vec3 u_fog_area;
uniform vec3 u_fog_color;
uniform sampler2D u_shadow_map;
uniform mat4 u_shadow_matrix;
uniform float u_shadow_texel;
uniform float u_pcf;

in vec3 v_world;
in vec2 v_plan;
in float v_height;
in vec3 v_normal;
in vec4 v_color;
in vec2 v_uv;
flat in uint v_surface;
flat in uint v_element;
flat in vec4 v_look;
flat in vec4 v_flags;
flat in float v_power;
flat in float v_upkeep;
flat in float v_room;
flat in float v_glass;

// The look (D-027): glass walls (their faces drawn in a pass of their own, `v_glass`), their tint,
// opacity and the colour of their tops (sRGB); the palette furniture and floors take; the 2D plan's
// colours; whether the alpha channel carries the glow (drawn offscreen for the bloom) rather than 1.
uniform float u_glass_walls;
uniform vec3 u_wall_tint;
uniform float u_wall_alpha;
uniform vec3 u_wall_cap;
uniform float u_tint;
// The share of the tint leaves take (D-048).
uniform float u_leaf_tint;
uniform vec3 u_palette;
uniform float u_floor_tint;
uniform vec3 u_floor_palette;
uniform vec3 u_plan_floor;
// The plan's floors are all `u_plan_floor` (the looks of their own colours), else their own.
uniform float u_plan_floors;
uniform vec3 u_plan_cap;
// How light falls and colours show in a look (D-036): the palette's contrast, bands of light (0:
// smooth), vividness, patterns left out, ink on the edges of rounded pieces, shine.
uniform float u_tint_contrast;
uniform float u_bands;
uniform float u_saturation;
uniform float u_flatten;
uniform float u_rim_ink;
uniform float u_specular;

",
    shading_glsl!(),
    r"
uniform float u_glow_alpha;

// The layers (D-023), three texels per room slot: heatmap colour (linear) and strength; the
// room's centre (x, z), reach and alert (0.5 warning, 1 danger); presence.
uniform sampler2D u_rooms;
uniform float u_layers;
uniform float u_power_layer;
uniform float u_upkeep_layer;
// Seconds, wrapping every 600 s (every wave below repeats within that); still without motion.
uniform float u_time;
uniform float u_motion;
// The real sun: the light of sunlit surfaces bouncing into the rooms it cannot reach.
uniform float u_bounce;

// The lamps that are on: position and reach, colour and room slot (0: every room).
uniform vec4 u_light_pos[16];
uniform vec4 u_light_color[16];
uniform float u_light_count;

out vec4 frag;

const uint MATTE = 0u;
const uint PLANKS = 1u;
const uint TILES = 2u;
const uint SUBWAY = 3u;
const uint GLASS = 4u;
const uint GLOW = 5u;
const uint METAL = 6u;
const uint FABRIC = 7u;
const uint MIRROR = 8u;
const uint SCREEN = 9u;
const uint SHADOW = 10u;
const uint WALL_CAP = 11u;
const uint FLOOR = 12u;
const uint WOOD = 13u;
const uint LEAF = 14u;
const uint CEILING = 15u;
// The garden's (D-077).
const uint GRASS = 16u;
const uint GRAVEL = 17u;
const uint WATER = 18u;
const uint SOIL = 19u;
const uint PAVING = 20u;

// The light of the moment (`domotwin_core::lighting`): morning, day, evening or night.
uniform vec3 u_sky;
uniform vec3 u_ground;
uniform vec3 u_sun_color;
uniform float u_exposure;
uniform float u_ao;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

vec3 to_linear(vec3 c) {
    return pow(c, vec3(2.2));
}

vec3 aces(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

// Darkens grout lines `width` cm wide around cells of `size` cm, faded out when they get thinner
// than a pixel.
float grout(vec2 uv, vec2 size, float width) {
    vec2 f = fract(uv / size) * size;
    vec2 d = min(f, size - f);
    float edge = min(d.x, d.y);
    float pixel = max(fwidth(uv.x), fwidth(uv.y));
    float line = 1.0 - smoothstep(width * 0.5, width * 0.5 + max(pixel, 0.05), edge);
    return line * (1.0 - smoothstep(width, width * 6.0, pixel));
}

vec3 planks(vec3 base, vec2 uv) {
    float row = floor(uv.y / 16.0);
    float offset = mod(row * 47.0 + 25.0, 180.0);
    vec2 p = vec2(uv.x - offset, uv.y);
    float plank = floor(p.x / 180.0);
    float h = hash(vec2(row, plank));
    vec3 c = base * (0.86 + 0.26 * h);
    c *= 0.92 + 0.12 * noise(vec2(p.x * 0.04, uv.y * 1.4 + h * 17.0));
    float seam = grout(p, vec2(180.0, 16.0), 0.3);
    return c * (1.0 - 0.38 * seam);
}

vec3 tiles(vec3 base, vec2 uv, float size) {
    vec2 cell = floor(uv / size);
    vec3 c = base * (0.96 + 0.08 * hash(cell));
    float line = grout(uv, vec2(size), 0.6);
    return mix(c, base * 0.74, line);
}

vec3 subway(vec3 base, vec2 uv) {
    float row = floor(uv.y / 7.5);
    vec2 p = vec2(uv.x + mod(row, 2.0) * 7.5, uv.y);
    vec3 c = base * (0.97 + 0.05 * hash(floor(p / vec2(15.0, 7.5))));
    float line = grout(p, vec2(15.0, 7.5), 0.35);
    return mix(c, base * 0.78, line);
}

// The garden's grounds (D-077) are in the variant of this program compiled with `GARDEN`, which
// draws the meshes that have them: a software GPU runs every branch of a shader, taken or not.
#ifdef GARDEN
// A lawn (D-077): fine blades over clumps, its grass `grown` from just mown (0) to long (1):
// even and light when short, darker and tufted as it grows, seed heads paler when long; striped
// the width of a mower along its floor's direction just after a mowing (`fresh`).
vec3 lawn(vec3 base, vec2 uv, float grown, float fresh) {
    float fine = noise(uv * 0.9) * 0.6 + noise(uv * 3.1) * 0.4;
    float clumps = noise(uv * 0.045) * 0.7 + noise(uv * 0.17) * 0.3;
    // Patches a metre or two across, drier or lusher, as a lawn is.
    float patches = noise(uv * 0.0045) * 0.65 + noise(uv * 0.013) * 0.35;
    vec3 c = base * (0.86 + 0.26 * fine) * (0.86 + 0.28 * patches) * mix(1.08, 0.86, grown);
    c = mix(c, c * vec3(1.18, 1.08, 0.78), smoothstep(0.62, 0.9, patches) * 0.35);
    float tuft = smoothstep(0.4, 0.85, clumps) * grown;
    c = mix(c, base * vec3(0.7, 0.86, 0.6), tuft * 0.75);
    float seeds = smoothstep(0.72, 0.95, noise(uv * 0.55)) * smoothstep(0.55, 1.0, grown);
    c = mix(c, base * vec3(1.3, 1.22, 0.86), seeds * 0.55);
    float across = uv.y / 120.0;
    float edge = max(fwidth(across), 1e-4) * 1.5;
    float band = smoothstep(0.5 - edge, 0.5 + edge, fract(across))
        - smoothstep(1.0 - edge, 1.0, fract(across));
    return c * (1.0 + (band - 0.5) * 0.18 * fresh);
}

// Gravel: small stones, light and dark, a little shadow between them.
vec3 gravel(vec3 base, vec2 uv) {
    float stones = noise(uv * 0.7) * 0.5 + noise(uv * 1.9) * 0.5;
    float pick = hash(floor(uv * 0.9));
    return base * (0.72 + 0.4 * stones) * (0.92 + 0.16 * pick);
}
#endif

float sun_shadow(vec3 n) {
    if (u_shadows < 0.5) {
        return 1.0;
    }
    vec4 s = u_shadow_matrix * vec4(v_world + n * 1.5, 1.0);
    vec3 c = s.xyz / s.w * 0.5 + 0.5;
    if (c.x <= 0.0 || c.x >= 1.0 || c.y <= 0.0 || c.y >= 1.0 || c.z >= 1.0) {
        return 1.0;
    }
    float lit = 0.0;
    float count = 0.0;
    int radius = int(u_pcf);
    for (int x = -2; x <= 2; x++) {
        for (int y = -2; y <= 2; y++) {
            if (abs(x) > radius || abs(y) > radius) {
                continue;
            }
            float depth = texture(u_shadow_map, c.xy + vec2(float(x), float(y)) * u_shadow_texel).r;
            lit += c.z - 0.0012 > depth ? 0.0 : 1.0;
            count += 1.0;
        }
    }
    return lit / count;
}

// A wave between `still` (no motion) and 1, `w` radians per second.
float wave(float w, float still) {
    return u_motion > 0.5 ? 0.5 + 0.5 * sin(u_time * w) : still;
}

// The light of the lamps that are on, limited to their room.
vec3 lamps(vec3 n) {
    vec3 sum = vec3(0.0);
    int count = int(u_light_count);
    for (int i = 0; i < 16; i++) {
        if (i >= count) {
            break;
        }
        vec4 pos = u_light_pos[i];
        vec4 tint = u_light_color[i];
        if (tint.w > 0.5 && abs(tint.w - v_room) > 0.5) {
            continue;
        }
        vec3 d = pos.xyz - v_world;
        float dist = length(d);
        if (dist >= pos.w) {
            continue;
        }
        float x = dist / pos.w;
        float fall = (1.0 - x * x) * (1.0 - x * x);
        float facing = max(dot(n, d / max(dist, 1.0)), 0.0) * 0.8 + 0.2;
        sum += tint.rgb * fall * facing;
    }
    return sum;
}

void main() {
    uint surface = v_surface;
    vec3 base = to_linear(v_color.rgb);
    float rough = max(v_color.a, 0.04);
    vec3 n = normalize(v_normal);
    if (!gl_FrontFacing) {
        n = -n;
    }
#ifdef GARDEN
    if (surface == WATER) {
        // Ripples on the water, moving only with motion.
        float drift = u_motion > 0.5 ? u_time * 0.6 : 0.0;
        vec2 q = v_uv * 0.035 + vec2(drift * 0.05, drift * 0.03);
        float e = 0.5;
        float dx = noise(q + vec2(e, 0.0)) - noise(q - vec2(e, 0.0));
        float dz = noise(q + vec2(0.0, e)) - noise(q - vec2(0.0, e));
        n = normalize(n + vec3(dx, 0.0, dz) * 0.35);
    }
#endif
    if (v_glass > 0.5) {
        // Tinted glass, brighter at grazing angles, catching the lamps of its room.
        vec3 view = normalize(u_eye - v_world);
        float grazing = pow(1.0 - abs(dot(n, view)), 2.0);
        vec3 lamp = lamps(n);
        vec3 lit = to_linear(u_wall_tint) * (0.18 + 0.5 * grazing) + lamp * 0.35;
        float shown = u_wall_alpha * (0.7 + 1.6 * grazing);
        vec3 glass = pow(aces(lit * u_exposure), vec3(1.0 / 2.2));
        frag = vec4(glass, clamp(shown + dot(lamp, vec3(0.1)), 0.0, 0.6) * (1.0 - u_flat));
        return;
    }
    if (surface == SHADOW) {
        // Soft contact shadow: full under the footprint, fading outwards.
        vec2 core = v_color.rg;
        vec2 q = max(abs(v_uv) - core, 0.0) / max(1.0 - core, vec2(0.001));
        float a = (1.0 - smoothstep(0.0, 1.0, length(q))) * 0.32 * (1.0 - 0.5 * u_flat);
        frag = vec4(0.0, 0.0, 0.0, a);
        return;
    }
    vec3 albedo = base;
    if (surface == PLANKS) {
        albedo = planks(base, v_uv);
    } else if (surface == TILES) {
        albedo = tiles(base, v_uv, 40.0);
    } else if (surface == SUBWAY) {
        albedo = subway(base, v_uv);
    } else if (surface == FLOOR) {
        albedo = base * (0.95 + 0.08 * noise(v_uv * 0.08));
    } else if (surface == WOOD) {
        albedo = base * (0.93 + 0.1 * noise(vec2(v_uv.x * 0.05, v_uv.y * 0.9)));
    } else if (surface == FABRIC) {
        albedo = base * (0.94 + 0.08 * noise(v_uv * 1.7));
#ifdef GARDEN
    } else if (surface == GRASS) {
        // Without its room, a lawn whose mowing is not known (`layers::GRASS_UNKNOWN`'s share).
        vec4 lawn_of = v_room > 0.5
            ? texelFetch(u_rooms, ivec2(int(v_room + 0.5) * 3 + 2, 0), 0)
            : vec4(0.0, 0.0, 0.1875, 0.0);
        albedo = lawn(base, v_uv, lawn_of.b, lawn_of.a);
    } else if (surface == GRAVEL) {
        albedo = gravel(base, v_uv);
    } else if (surface == SOIL) {
        albedo = base * (0.8 + 0.3 * noise(v_uv * 0.4) + 0.1 * noise(v_uv * 2.3));
    } else if (surface == PAVING) {
        albedo = tiles(base * (0.95 + 0.1 * noise(v_uv * 0.6)), v_uv, 60.0);
    } else if (surface == WATER) {
        // The pool's tiles seen through the water.
        albedo = base * (1.0 - 0.12 * grout(v_uv, vec2(25.0), 0.4));
#endif
    }
    // Patterns left out (the cartoon's flat colours, the clay's single matter).
    albedo = mix(albedo, base, u_flatten);
    // The look's palette, keeping each surface's lightness (as much as the look says).
    bool floor_surface = surface == PLANKS || surface == TILES || surface == FLOOR
        || surface == GRASS || surface == GRAVEL || surface == SOIL || surface == PAVING;
    float lightness = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
    if (surface == WALL_CAP && u_glass_walls > 0.5) {
        albedo = to_linear(u_wall_cap);
    } else if (floor_surface) {
        vec3 floor_tone = to_linear(u_floor_palette) * mix(1.0, 0.5 + 0.8 * lightness, u_tint_contrast);
        albedo = mix(albedo, floor_tone, u_floor_tint);
    } else if (surface != GLOW && surface != SCREEN && surface != GLASS) {
        vec3 tone = to_linear(u_palette) * mix(1.0, 0.45 + 1.6 * lightness, u_tint_contrast);
        // Leaves keep some of their green in a look's palette (D-048), unless it is one matter.
        float tint = surface == LEAF ? u_tint * u_leaf_tint : u_tint;
        albedo = mix(albedo, tone, tint);
    }
    albedo = saturated(albedo);

    // Room layers, on the floors: the heatmap as a soft halo from the centre of the room, its
    // edge moving slowly; a warm glow where someone is; an alert pulsing towards the walls.
    bool on_floor = floor_surface;
    vec3 layer_glow = vec3(0.0);
    vec3 alert_tone = vec3(0.0);
    float alert = 0.0;
    if (u_layers > 0.5 && on_floor && v_room > 0.5) {
        int at = int(v_room + 0.5) * 3;
        vec4 heat = texelFetch(u_rooms, ivec2(at, 0), 0);
        vec4 shape = texelFetch(u_rooms, ivec2(at + 1, 0), 0);
        float presence = texelFetch(u_rooms, ivec2(at + 2, 0), 0).r;
        float d = length(v_plan - shape.xy) / max(shape.z, 1.0);
        if (heat.a > 0.0) {
            float turn = u_motion > 0.5 ? u_time * 0.0104720 : 0.0;
            vec2 drift = vec2(sin(turn), cos(turn)) * 6.0;
            float wobble = noise(v_plan * 0.011 + drift) - 0.5;
            float k = 1.0 - smoothstep(0.1, 1.15, d + wobble * 0.45);
            float breath = 0.92 + 0.08 * wave(1.0472, 1.0);
            albedo = mix(albedo, heat.rgb, (0.35 + 0.5 * k) * breath * heat.a);
            layer_glow += heat.rgb * k * 0.12 * heat.a;
        }
        if (presence > 0.0) {
            float k = 0.3 + 0.7 * (1.0 - smoothstep(0.0, 0.85, d));
            layer_glow += vec3(1.0, 0.62, 0.3) * k * 0.3;
        }
        if (shape.a > 0.0) {
            bool danger = shape.a > 0.75;
            // Display colours: the alert is laid over the picture after tone mapping, so that red
            // stays red on a light floor.
            alert_tone = danger ? vec3(0.8, 0.015, 0.01) : vec3(0.95, 0.4, 0.0);
            float pulse = 0.35 + 0.65 * wave(danger ? 6.2832 : 3.1416, 0.75);
            // A danger shows stronger than a warning.
            alert = pulse * (0.35 + 0.65 * smoothstep(0.35, 1.0, d)) * (danger ? 0.85 : 0.55);
        }
    }

    vec3 v = normalize(u_eye - v_world);
    vec3 r = reflect(-v, n);
    vec3 env = mix(u_ground, u_sky * 1.15, clamp(r.y * 0.5 + 0.5, 0.0, 1.0));
    // A ceiling is never lit by the sun (its lamps light it from below).
    float shadow = surface == CEILING ? 0.0 : sun_shadow(n);
    float ndl = dot(n, u_sun);
    float wrap = surface == LEAF ? 0.4 : 0.0;
    float diffuse_sun = band(max((ndl + wrap) / (1.0 + wrap), 0.0) * shadow);
    // In bands, the sky's light is even (flat colours), the sun's makes the bands.
    vec3 hemi = mix(u_ground, u_sky, u_bands > 0.5 ? 0.7 : n.y * 0.5 + 0.5);
    // A ceiling sees the light the room sends back up, about as much as the walls get.
    if (surface == CEILING) {
        hemi = mix(u_ground, u_sky, 0.75);
    }
    // Under a ceiling (the real sun), a room sees less of the sky: the sunlit patches stand out.
    if (u_bounce > 0.0 && v_room > 0.5) {
        hemi *= 0.6;
    }
    // Rooms have no ceiling: a little darker near the floor on vertical faces.
    float ao = mix(1.0, mix(u_ao, 1.0, smoothstep(0.0, 90.0, v_height)), 1.0 - abs(n.y));
    bool metal = surface == METAL || surface == MIRROR;
    vec3 bounce = u_sun_color * u_bounce * (1.0 - shadow) * (0.6 + 0.4 * max(n.y, 0.0));
    // Metals take little of the light themselves, as much as the look lets them shine.
    float metal_diffuse = metal ? mix(1.0, 0.3, min(u_specular, 1.0)) : 1.0;
    vec3 diffuse = albedo * (hemi * ao + u_sun_color * diffuse_sun + bounce) * metal_diffuse;
    vec3 h = normalize(u_sun + v);
    float shininess = exp2(11.0 * (1.0 - rough) + 1.0);
    float spec = pow(max(dot(n, h), 0.0), shininess) * (shininess + 8.0) / 25.0;
    // In bands, a highlight is a spot or nothing.
    spec = (u_bands > 0.5 ? smoothstep(0.4, 0.6, spec) * 0.8 : spec) * u_specular;
    float fresnel = pow(1.0 - max(dot(n, v), 0.0), 5.0);
    vec3 f0 = metal ? albedo : vec3(0.04);
    vec3 f = f0 + (1.0 - f0) * fresnel * (1.0 - rough);
    vec3 color = diffuse + u_sun_color * spec * f * shadow * step(0.0, ndl) * (1.0 - rough * 0.85);
    color += env * f * (1.0 - rough) * 0.6 * u_specular;
    color += albedo * lamps(n) * (metal ? 0.4 : 1.0);
    // Ink where curved pieces turn away, seen side on (the cartoon's outlines of furniture). Only
    // where the surface curves: a flat face seen at a grazing angle keeps its colour.
    float curved = smoothstep(0.01, 0.06, length(fwidth(n)));
    bool inked = surface != GLOW && surface != SCREEN && surface != GLASS && surface != MIRROR
        && surface != CEILING && surface != WALL_CAP && surface != WATER && !floor_surface;
    if (u_rim_ink > 0.0 && inked) {
        float side = abs(dot(n, v));
        color *= mix(1.0, smoothstep(0.06, 0.26, side), u_rim_ink * curved);
    }
    float alpha = 1.0;
    if (surface == MIRROR) {
        color = mix(albedo * (hemi + u_sun_color * diffuse_sun), env * 0.9 + albedo * 0.1,
            min(u_specular, 1.0));
    } else if (surface == SCREEN) {
        color = albedo * 0.2 + env * (0.04 + 0.4 * fresnel);
    } else if (surface == GLASS) {
        color = albedo * hemi * 0.4 + env * (0.3 + 0.6 * fresnel);
        alpha = 0.22 + 0.5 * fresnel;
#ifdef GARDEN
    } else if (surface == WATER) {
        // Its colour from below, the sky on it, brighter at a grazing angle, and the sun's glint.
        color = albedo * (hemi * 0.75 + u_sun_color * diffuse_sun * 0.45)
            + env * (0.08 + 0.55 * fresnel) * mix(1.0, 0.6, u_bands)
            + u_sun_color * spec * shadow * 0.8 * u_specular;
#endif
    }

    // Lamps and screens that are on glow with their element's light.
    float glow = v_look.a;
    vec3 emission = v_look.rgb * glow;
    if (surface == GLOW) {
        color = color * (1.0 - min(glow, 1.0) * 0.7) + emission * 2.2;
    } else if (surface == SCREEN) {
        color += emission * 1.4;
    }

    // The 2D plan: flat colours, the look's wall tops (and floors, for the looks that colour them).
    vec3 plan = albedo * (0.86 + 0.14 * max(n.y, 0.0));
    if (surface == WALL_CAP) {
        plan = to_linear(u_plan_cap);
    } else if (on_floor && u_plan_floors > 0.5) {
        plan = to_linear(u_plan_floor) * (0.92 + 0.16 * lightness);
    }
    if (surface == GLOW || surface == SCREEN) {
        plan = mix(plan, min(emission * 1.5, vec3(1.0)), min(glow, 1.0) * 0.85);
    }

    color += layer_glow;
    plan += layer_glow * 0.5;
    // The power layer: pieces drawing power tinted from yellow (tens of watts) to red (kW).
    if (u_power_layer > 0.5 && v_power > 0.0 && !on_floor) {
        vec3 tone = mix(vec3(1.0, 0.78, 0.1), vec3(1.0, 0.2, 0.02), v_power);
        float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
        color = mix(color, tone * (0.45 + luma), 0.5) + tone * (0.1 + 0.2 * wave(2.618, 1.0)) * v_power;
        plan = mix(plan, tone, 0.55);
    }
    // The upkeep layer (D-033): pieces with tasks tinted green when fine, amber when one is due
    // soon, red when one is overdue.
    if (u_upkeep_layer > 0.5 && v_upkeep > 0.1 && !on_floor) {
        float state = floor(v_upkeep * 3.0 + 0.5);
        vec3 tone = state > 2.5 ? vec3(0.95, 0.18, 0.12)
            : state > 1.5 ? vec3(1.0, 0.68, 0.08) : vec3(0.22, 0.72, 0.36);
        float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
        color = mix(color, tone * (0.25 + 0.5 * luma), 0.85) + tone * 0.18;
        plan = mix(plan, tone, 0.75);
    }

    // A private room the viewer may not see (D-039): a frosted cover over its floor, finely
    // hatched. The hatching's width is worked out before the branch (derivatives).
    float hatch_at = (v_plan.x + v_plan.y) / 22.0;
    float hatch_px = fwidth(hatch_at);
    if (on_floor && v_room > 0.5
        && texelFetch(u_rooms, ivec2(int(v_room + 0.5) * 3 + 2, 0), 0).g > 0.5) {
        float hatch = 1.0 - smoothstep(0.05, 0.05 + hatch_px * 1.5, abs(fract(hatch_at + 0.5) - 0.5));
        // A pale cool grey, as light as the look's floor allows (not glowing in the dark looks).
        vec3 frost = vec3(0.74, 0.78, 0.84) * (1.0 - 0.3 * hatch);
        float lit = min(0.3 + dot(color, vec3(0.2126, 0.7152, 0.0722)), 0.85);
        float lit_plan = min(0.3 + dot(plan, vec3(0.2126, 0.7152, 0.0722)), 0.85);
        color = mix(color, frost * lit, 0.8);
        plan = mix(plan, frost * lit_plan, 0.8);
    }

    // Unavailable entities: greyed out. A tap: a short blue flash.
    float grey = v_flags.r * 0.85;
    color = mix(color, vec3(dot(color, vec3(0.2126, 0.7152, 0.0722))) * 0.7, grey);
    plan = mix(plan, vec3(dot(plan, vec3(0.2126, 0.7152, 0.0722))) * 0.8, grey);
    vec3 flash = vec3(0.25, 0.5, 1.0) * v_flags.g;
    color += flash * 0.6;
    plan += flash * 0.3;
    // Edit mode: the selection tinted blue, pieces in conflict red (red wins).
    float bad = v_flags.a;
    float selected = v_flags.b * (1.0 - bad);
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(color, vec3(0.12, 0.38, 1.0) * (0.35 + luma), selected * 0.55);
    color = mix(color, vec3(1.0, 0.08, 0.04) * (0.5 + luma), bad * 0.75);
    plan = mix(plan, vec3(0.2, 0.45, 1.0), selected * 0.45);
    plan = mix(plan, vec3(0.95, 0.12, 0.08), bad * 0.7);
    vec3 shaded = mix(aces(color * u_exposure), plan, u_flat);
    shaded = mix(shaded, alert_tone, alert);
    // The weather's fog (D-072): a veil over the home, thicker around it, where it fades into the
    // sky's colour; not on the plan.
    float out_of_home = smoothstep(
        u_fog_area.z * 0.5, u_fog_area.z * 1.6, length(v_world.xz - u_fog_area.xy)
    );
    float fog = u_fog * mix(0.12, 1.0, out_of_home) * (1.0 - u_flat);
    shaded = mix(shaded, to_linear(u_fog_color), fog);
    float a = mix(alpha, max(alpha, 0.35), u_flat);
    // Drawn offscreen, an opaque surface's alpha is how much it glows (lamps and screens that are
    // on); glass keeps its alpha to blend with (and leaves the glow below it as it is).
    if (u_glow_alpha > 0.5 && a >= 0.999) {
        bool lit = surface == GLOW || surface == SCREEN;
        a = lit ? min(glow, 1.0) * 0.9 : 0.0;
    }
    frag = vec4(pow(shaded, vec3(1.0 / 2.2)), a);
}
"
);

/// Depth only (shadow map).
pub(crate) const DEPTH: &str = r"
void main() {}
";

/// Element ids, for picking: red = low byte, green = high byte.
pub(crate) const PICK: &str = r"
flat in uint v_element;
out vec4 frag;

void main() {
    if (v_element == 0u) {
        discard;
    }
    frag = vec4(float(v_element & 255u), float(v_element >> 8u), 0.0, 255.0) / 255.0;
}
";

/// Halos around lit bulbs: camera-facing quads, added to the picture.
pub(crate) const HALO_VERTEX: &str = r"
uniform mat4 u_view_proj;
uniform vec3 u_right;
uniform vec3 u_up;

in vec4 a_center;
in vec4 a_tint;
in vec2 a_corner;

out vec2 v_corner;
flat out vec3 v_tint;

void main() {
    v_corner = a_corner;
    v_tint = a_tint.rgb;
    vec3 p = a_center.xyz + (u_right * a_corner.x + u_up * a_corner.y) * a_center.w;
    gl_Position = u_view_proj * vec4(p, 1.0);
}
";

/// The glow of a halo, strongest at the bulb.
pub(crate) const HALO_FRAGMENT: &str = r"
uniform float u_gain;

in vec2 v_corner;
flat in vec3 v_tint;

out vec4 frag;

void main() {
    float d2 = dot(v_corner, v_corner);
    if (d2 >= 1.0) {
        discard;
    }
    float a = (exp(-d2 * 4.0) - exp(-4.0)) / (1.0 - exp(-4.0));
    vec3 light = 1.0 - exp(-v_tint * a * u_gain);
    // Offscreen, the alpha channel is the glow: a halo adds to it.
    frag = vec4(light, dot(light, vec3(0.33)));
}
";

/// A triangle covering the view, for the background and the bloom passes.
pub(crate) const FULLSCREEN_VERTEX: &str = r"
out vec2 v_uv;

void main() {
    vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    v_uv = p;
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
";

/// The background (D-027): a sky from the horizon up, and the ground the home stands on with its
/// grid, fading into the sky far away; the sun's shadow on it when the look has shadows.
pub(crate) const BACKGROUND_FRAGMENT: &str = r"
precision highp sampler2D;

uniform mat4 u_inv_view_proj;
uniform vec3 u_sky_top;
uniform vec3 u_sky_horizon;
uniform vec3 u_ground;
uniform vec3 u_grid;
uniform float u_grid_strength;
// The grid as dots where its lines cross (D-048).
uniform float u_grid_dots;
uniform float u_ground_y;
uniform vec2 u_centre;
uniform float u_radius;
uniform float u_glow_alpha;
uniform float u_shadows;
uniform sampler2D u_shadow_map;
uniform mat4 u_shadow_matrix;
// The weather's fog (D-072): the ground fades into the sky closer to the home.
uniform float u_fog;
// How much of the sun the clouds let through (D-072): the shadow on the ground fades with it.
uniform float u_sun_left;

in vec2 v_uv;
out vec4 frag;

// Lines every `size` cm about one pixel wide, fading out when the cells get a few pixels small.
float grid(vec2 p, float size) {
    vec2 w = fwidth(p);
    vec2 d = abs(fract(p / size - 0.5) - 0.5) * size;
    vec2 line = 1.0 - smoothstep(w * 0.5, w * 1.5, d);
    float density = max(w.x, w.y) / size;
    return max(line.x, line.y) * (1.0 - smoothstep(0.06, 0.25, density));
}

// Dots every `size` cm, a couple of pixels wide, fading out when they crowd.
float dots(vec2 p, float size) {
    vec2 w = fwidth(p);
    vec2 d = abs(fract(p / size - 0.5) - 0.5) * size / max(w, vec2(1e-4));
    float dot_ = 1.0 - smoothstep(1.0, 2.2, length(d));
    float density = max(w.x, w.y) / size;
    return dot_ * (1.0 - smoothstep(0.04, 0.2, density));
}

void main() {
    vec2 ndc = v_uv * 2.0 - 1.0;
    vec4 near = u_inv_view_proj * vec4(ndc, -1.0, 1.0);
    vec4 far = u_inv_view_proj * vec4(ndc, 1.0, 1.0);
    vec3 p0 = near.xyz / near.w;
    vec3 dir = normalize(far.xyz / far.w - p0);
    vec3 color = mix(u_sky_horizon, u_sky_top, smoothstep(0.1, 1.0, v_uv.y));
    float glow = 0.0;
    if (dir.y < -1e-5) {
        vec3 g = p0 + dir * ((u_ground_y - p0.y) / dir.y);
        float from_home = length(g.xz - u_centre);
        float far_away = max(
            smoothstep(u_radius * 1.4, u_radius * 4.5, from_home),
            u_fog * smoothstep(u_radius * 0.5, u_radius * 1.6, from_home)
        );
        float lines = u_grid_dots > 0.5
            ? max(dots(g.xz, 100.0) * 0.7, dots(g.xz, 500.0))
            : max(grid(g.xz, 100.0) * 0.55, grid(g.xz, 500.0));
        vec3 ground = mix(u_ground, u_grid, lines * u_grid_strength);
        if (u_shadows > 0.5) {
            vec4 s = u_shadow_matrix * vec4(g, 1.0);
            vec3 c = s.xyz / s.w * 0.5 + 0.5;
            bool inside = c.x > 0.0 && c.x < 1.0 && c.y > 0.0 && c.y < 1.0 && c.z < 1.0;
            if (inside && c.z - 0.002 > texture(u_shadow_map, c.xy).r) {
                ground *= 1.0 - 0.14 * u_sun_left;
            }
        }
        color = mix(ground, color, far_away);
        glow = lines * u_grid_strength * (1.0 - far_away) * 0.5;
    }
    frag = vec4(color, u_glow_alpha > 0.5 ? glow : 1.0);
}
";

/// The outlines of the home (D-027): each line a quad a few pixels wide, facing the screen, gone
/// or lowered with its wall by the cut-away like the meshes' pieces, a little in front of the
/// surfaces it lies on.
pub(crate) const LINE_VERTEX: &str = r"
uniform mat4 u_view_proj;
uniform vec4 u_cut[32];
uniform vec2 u_viewport;
uniform float u_line_width;
// Where the storey drawn is moved to (D-028).
uniform vec3 u_offset;
// Towards the camera: its position (w = 1), or the way back along its view (w = 0, orthographic);
// how far lines move that way: a share of the distance (perspective), or a length (orthographic),
// a couple of pixels where the line is.
uniform vec4 u_toward;
uniform float u_line_lift;
// How strongly lines that rise are drawn against level ones (D-048).
uniform float u_line_rise;

// First end and wall group; second end and the height of the bottom of what the line outlines;
// along (0 or 1), across (-1 or 1) and weight.
in vec4 a_a;
in vec4 a_b;
in vec3 a_corner;

out float v_across;
flat out float v_weight;

float cut_height(uint group) {
    vec4 slot = u_cut[group >> 2u];
    uvec4 lane = uvec4(group & 3u);
    return dot(slot, vec4(equal(lane, uvec4(0u, 1u, 2u, 3u))));
}

// A couple of pixels towards the camera: in front of the surfaces the line lies on at any zoom,
// not through the walls.
vec3 forward(vec3 p) {
    vec3 toward = u_toward.w > 0.5 ? u_toward.xyz - p : u_toward.xyz;
    return p + toward * u_line_lift;
}

void main() {
    v_across = a_corner.y;
    v_weight = a_corner.z;
    vec3 pa = a_a.xyz;
    vec3 pb = a_b.xyz;
    vec3 run = pb - pa;
    // Walls stand upright: a line that rises is a corner or the side of a door or a window.
    if (abs(run.y) > 0.9 * length(run)) {
        v_weight *= u_line_rise;
    }
    // A line drawn at no strength is left out, not drawn for nothing.
    bool hidden = v_weight <= 0.0;
    if (a_a.w < 127.5) {
        float cut = cut_height(uint(a_a.w));
        hidden = hidden || a_b.w >= cut - 0.01;
        pa.y = min(pa.y, cut);
        pb.y = min(pb.y, cut);
    }
    pa += u_offset;
    pb += u_offset;
    vec4 ca = u_view_proj * vec4(forward(pa), 1.0);
    vec4 cb = u_view_proj * vec4(forward(pb), 1.0);
    // Clipped at the near plane (z = -w) when one end is behind it.
    float da = ca.z + ca.w;
    float db = cb.z + cb.w;
    if (hidden || (da <= 0.0 && db <= 0.0)) {
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        return;
    }
    if (da < 0.0) {
        ca = mix(ca, cb, (da - 0.001 * db) / (da - db));
    } else if (db < 0.0) {
        cb = mix(cb, ca, (db - 0.001 * da) / (db - da));
    }
    vec2 half_size = u_viewport * 0.5;
    vec2 sa = ca.xy / ca.w * half_size;
    vec2 sb = cb.xy / cb.w * half_size;
    vec2 along = sb - sa;
    float len = length(along);
    along = len > 1e-4 ? along / len : vec2(1.0, 0.0);
    vec2 across = vec2(-along.y, along.x);
    vec4 c = a_corner.x < 0.5 ? ca : cb;
    float end = a_corner.x < 0.5 ? -1.0 : 1.0;
    vec2 offset = (across * a_corner.y + along * end * 0.5) * u_line_width;
    c.xy += offset / half_size * c.w;
    gl_Position = c;
}
";

/// The colour of a line, soft at its sides. Light lines brighten what is under them and add to the
/// glow; dark lines darken it.
pub(crate) const LINE_FRAGMENT: &str = r"
uniform vec3 u_line_color;
uniform float u_line_strength;
uniform float u_line_glow;
uniform float u_dark_lines;

in float v_across;
flat in float v_weight;

out vec4 frag;

void main() {
    float k = (1.0 - smoothstep(0.3, 1.0, abs(v_across))) * v_weight * u_line_strength;
    if (u_dark_lines > 0.5) {
        frag = vec4(mix(vec3(1.0), u_line_color, k), 0.0);
    } else {
        frag = vec4(u_line_color * k, k * u_line_glow);
    }
}
";

/// Wires over the home (D-031): each straight piece of an arc a quad a few pixels wide facing the
/// screen, its ends moved with their storeys (a wire between two storeys follows both).
pub(crate) const WIRE_VERTEX: &str = r"
uniform mat4 u_view_proj;
uniform vec2 u_viewport;
uniform float u_wire_width;
// Where each storey is drawn (D-028).
uniform vec4 u_offsets[20];

// First end and how far along the wire it is; second end and the same; along (0 or 1), across
// (-1 or 1) and weight; colour and flow (1, -1 or 0); the storeys of the wire's two ends, its
// length (cm) and whether it is dashed.
in vec4 a_a;
in vec4 a_b;
in vec3 a_corner;
in vec4 a_color;
in vec4 a_extra;
// When a one-shot pulse set off along the wire (seconds; negative: none).
in float a_shot;

out float v_across;
out float v_t;
flat out vec4 v_color;
flat out vec4 v_extra;
flat out float v_weight;
flat out float v_shot;

vec3 placed(vec3 p, float t) {
    vec3 from = u_offsets[int(a_extra.x)].xyz;
    vec3 to = u_offsets[int(a_extra.y)].xyz;
    return p + mix(from, to, t);
}

void main() {
    v_across = a_corner.y;
    v_weight = a_corner.z;
    v_color = a_color;
    v_extra = a_extra;
    v_shot = a_shot;
    v_t = a_corner.x < 0.5 ? a_a.w : a_b.w;
    vec4 ca = u_view_proj * vec4(placed(a_a.xyz, a_a.w), 1.0);
    vec4 cb = u_view_proj * vec4(placed(a_b.xyz, a_b.w), 1.0);
    float da = ca.z + ca.w;
    float db = cb.z + cb.w;
    if (da <= 0.0 && db <= 0.0) {
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        return;
    }
    if (da < 0.0) {
        ca = mix(ca, cb, (da - 0.001 * db) / (da - db));
    } else if (db < 0.0) {
        cb = mix(cb, ca, (db - 0.001 * da) / (db - da));
    }
    vec2 half_size = u_viewport * 0.5;
    vec2 sa = ca.xy / ca.w * half_size;
    vec2 sb = cb.xy / cb.w * half_size;
    vec2 along = sb - sa;
    float len = length(along);
    along = len > 1e-4 ? along / len : vec2(1.0, 0.0);
    vec2 across = vec2(-along.y, along.x);
    vec4 c = a_corner.x < 0.5 ? ca : cb;
    // Only the wire's own ends are capped: pieces that met and overlapped would be drawn twice
    // where they join, a bead at every joint of a translucent wire.
    float end = a_corner.x < 0.5 ? (a_a.w <= 0.0 ? -1.0 : 0.0) : (a_b.w >= 1.0 ? 1.0 : 0.0);
    vec2 offset = (across * a_corner.y + along * end * 0.5) * u_wire_width;
    c.xy += offset / half_size * c.w;
    gl_Position = c;
}
";

/// The colour of a wire, soft at its sides, dashed when it says so; a light pulse runs along it
/// the way it flows, unless the layers are held still.
pub(crate) const WIRE_FRAGMENT: &str = r"
uniform float u_time;
uniform float u_motion;

in float v_across;
in float v_t;
flat in vec4 v_color;
flat in vec4 v_extra;
flat in float v_weight;
flat in float v_shot;

out vec4 frag;

// The pulse: 60 cm long, at 120 cm a second, one every wire length and 2.4 m.
const float PULSE = 60.0;
const float SPEED = 120.0;
const float GAP = 240.0;
// A one-shot pulse (what an automation did): 90 cm long at 4 m a second, from the wire's start to
// its end; held still, the wire flashes for 0.6 s instead.
const float SHOT_LENGTH = 90.0;
const float SHOT_SPEED = 400.0;
const float SHOT_FLASH = 0.6;

void main() {
    float length_cm = max(v_extra.z, 1.0);
    if (v_extra.w > 0.5 && fract(v_t * length_cm / 24.0) > 0.55) {
        discard;
    }
    float edge = 1.0 - smoothstep(0.35, 1.0, abs(v_across));
    float alpha = edge * v_weight * 0.85;
    vec3 color = v_color.rgb;
    if (v_color.a != 0.0 && u_motion > 0.5) {
        float along = (v_color.a > 0.0 ? v_t : 1.0 - v_t) * length_cm;
        float head = mod(u_time * SPEED, length_cm + GAP);
        float behind = head - along;
        float pulse = behind >= 0.0 && behind < PULSE ? 1.0 - behind / PULSE : 0.0;
        color = mix(color, vec3(1.0), pulse * 0.7);
        alpha = max(alpha, edge * pulse * v_weight);
    }
    if (v_shot >= 0.0) {
        float elapsed = u_time - v_shot;
        float shot = 0.0;
        if (u_motion > 0.5) {
            float behind = elapsed * SHOT_SPEED - v_t * length_cm;
            shot = behind >= 0.0 && behind < SHOT_LENGTH ? 1.0 - behind / SHOT_LENGTH : 0.0;
        } else if (elapsed >= 0.0 && elapsed < SHOT_FLASH) {
            shot = 1.0 - elapsed / SHOT_FLASH;
        }
        color = mix(color, vec3(1.0), shot * 0.75);
        alpha = max(alpha, edge * shot);
    }
    frag = vec4(color, alpha);
}
";

/// The bloom, going down: a quarter of the size each step, the first step keeping only what glows
/// (the colour weighted by the alpha channel).
pub(crate) const BLOOM_DOWN: &str = r"
uniform sampler2D u_source;
uniform vec2 u_texel;
uniform float u_first;

in vec2 v_uv;
out vec4 frag;

vec3 take(vec2 uv) {
    vec4 c = texture(u_source, uv);
    return u_first > 0.5 ? c.rgb * c.a : c.rgb;
}

void main() {
    vec2 h = u_texel;
    vec3 sum = take(v_uv) * 4.0;
    sum += take(v_uv - h) + take(v_uv + h);
    sum += take(v_uv + vec2(h.x, -h.y)) + take(v_uv - vec2(h.x, -h.y));
    frag = vec4(sum / 8.0, 1.0);
}
";

/// The bloom, coming back up: a tent of the smaller level, added to the larger one.
pub(crate) const BLOOM_UP: &str = r"
uniform sampler2D u_source;
uniform vec2 u_texel;

in vec2 v_uv;
out vec4 frag;

void main() {
    vec2 h = u_texel;
    vec3 sum = texture(u_source, v_uv + vec2(-2.0 * h.x, 0.0)).rgb;
    sum += texture(u_source, v_uv + vec2(-h.x, h.y)).rgb * 2.0;
    sum += texture(u_source, v_uv + vec2(0.0, 2.0 * h.y)).rgb;
    sum += texture(u_source, v_uv + vec2(h.x, h.y)).rgb * 2.0;
    sum += texture(u_source, v_uv + vec2(2.0 * h.x, 0.0)).rgb;
    sum += texture(u_source, v_uv + vec2(h.x, -h.y)).rgb * 2.0;
    sum += texture(u_source, v_uv + vec2(0.0, -2.0 * h.y)).rgb;
    sum += texture(u_source, v_uv + vec2(-h.x, -h.y)).rgb * 2.0;
    frag = vec4(sum / 12.0, 1.0);
}
";

/// The picture with its bloom, onto the screen.
pub(crate) const COMPOSITE: &str = r"
uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform float u_bloom_strength;

in vec2 v_uv;
out vec4 frag;

void main() {
    vec3 scene = texture(u_scene, v_uv).rgb;
    vec3 bloom = texture(u_bloom, v_uv).rgb * u_bloom_strength;
    // Added softly, so that what is already bright does not burn out.
    frag = vec4(scene + bloom * (1.0 - scene * 0.5), 1.0);
}
";

/// The cartoon's ink (D-036), laid over what is opaque before glass, outlines, halos and wires are
/// drawn: where the distance from the eye bends towards it, read from the picture's depth.
pub(crate) const INK: &str = r"
precision highp sampler2D;

// How much (0: none), the depth of what is opaque, how a depth turns into a distance from the eye
// (the projection's third and fourth rows), the size of a usual line's width at a distance d
// (x + y·d, cm), one step (texture coordinates) and the colour.
uniform float u_outline;
uniform sampler2D u_depth;
uniform vec4 u_depth_to_distance;
uniform vec2 u_pixel;
uniform vec2 u_ink_step;
uniform vec3 u_ink;

in vec2 v_uv;
out vec4 frag;

// How far from the eye (cm) a depth is.
float distance_of(float depth) {
    float z = depth * 2.0 - 1.0;
    vec4 p = u_depth_to_distance;
    return (z * p.w - p.z) / (z * p.y - p.x);
}

float distance_at(vec2 uv) {
    return distance_of(texture(u_depth, uv).r);
}

// How much the distance bends towards the eye over `step` on each side, in line widths there.
// Across a plane, however slanted, it barely bends; at the edge of something before what is
// behind it, by the gap between them.
float bend(vec2 step, float c) {
    float l = distance_at(v_uv - vec2(step.x, 0.0));
    float r = distance_at(v_uv + vec2(step.x, 0.0));
    float d = distance_at(v_uv - vec2(0.0, step.y));
    float u = distance_at(v_uv + vec2(0.0, step.y));
    return max(l + r - 2.0 * c, u + d - 2.0 * c) / max(u_pixel.x + u_pixel.y * c, 1e-3);
}

void main() {
    float depth = texture(u_depth, v_uv).r;
    // Nothing is nearer than the background: no ink on the sky and the lawn.
    if (depth >= 1.0) {
        discard;
    }
    float c = distance_of(depth);
    // Whole next to the edge, by half a step further (a softer edge).
    float next = smoothstep(10.0, 30.0, bend(u_ink_step * 0.5, c));
    float further = smoothstep(10.0, 30.0, bend(u_ink_step, c));
    float ink = 0.5 * (next + further) * u_outline;
    if (ink <= 0.0) {
        discard;
    }
    frag = vec4(u_ink, ink);
}
";

/// A person's figure, pin or shadow (D-034): the shape moved to where the person stands, turned
/// the way they face.
pub(crate) const FIGURE_VERTEX: &str = r"
uniform mat4 u_view_proj;
// Where the feet are (world cm) and which way the person faces (radians on the floor).
uniform vec4 u_place;
uniform float u_scale;

in vec3 a_position;
in vec3 a_normal;

out vec3 v_world;
out vec3 v_normal;
out float v_rim;

void main() {
    float c = cos(u_place.w);
    float s = sin(u_place.w);
    vec3 p = a_position * u_scale;
    v_world = u_place.xyz + vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);
    v_normal = vec3(a_normal.x * c - a_normal.z * s, a_normal.y, a_normal.x * s + a_normal.z * c);
    v_rim = length(a_position.xz);
    gl_Position = u_view_proj * vec4(v_world, 1.0);
}
";

/// A person in their colour: lit by the sky and the sun, a rim of light around them, glowing in
/// the looks that glow. Fading in or out, it dissolves (the depth stays right). Their shadow is
/// a soft dark disc.
pub(crate) const FIGURE_FRAGMENT: &str = concat!(
    r"
// Linear colour, and how much the person shows.
uniform vec4 u_color;
uniform vec3 u_eye;
uniform vec3 u_sun;
uniform vec3 u_sun_color;
uniform vec3 u_sky;
uniform vec3 u_ground;
uniform float u_exposure;
uniform float u_glow;
uniform float u_glow_alpha;
uniform float u_flat;
uniform float u_shadow_pass;
uniform float u_bands;
uniform float u_saturation;
// Dissolved by how much the person shows (fading in or out), else whole.
uniform float u_dissolve;

in vec3 v_world;
in vec3 v_normal;
in float v_rim;

out vec4 frag;
",
    shading_glsl!(),
    r"
vec3 aces(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

// An ordered threshold per pixel (a 4 × 4 Bayer matrix), to dissolve.
float bayer(vec2 p) {
    ivec2 q = ivec2(mod(p, 4.0));
    int k = q.x + q.y * 4;
    int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
    return (float(m[k]) + 0.5) / 16.0;
}

void main() {
    if (u_shadow_pass > 0.5) {
        float a = (1.0 - smoothstep(0.15, 1.0, v_rim)) * 0.32 * u_color.a * (1.0 - u_flat);
        frag = vec4(0.0, 0.0, 0.0, a);
        return;
    }
    vec3 n = normalize(v_normal);
    // The look's steps of sunlight (D-036), as on the furniture, worked out before any pixel is
    // dissolved (it takes a derivative); in steps, the sky's light is even.
    float sun = band(max(dot(n, u_sun), 0.0));
    float up = u_bands > 0.5 ? 0.7 : n.y * 0.5 + 0.5;
    if (u_dissolve > 0.5 && bayer(gl_FragCoord.xy) >= u_color.a) {
        discard;
    }
    vec3 view = normalize(u_eye - v_world);
    float facing = max(dot(n, view), 0.0);
    float rim = pow(1.0 - facing, 2.2);
    vec3 base = saturated(u_color.rgb);
    vec3 ambient = mix(u_ground, u_sky, up);
    vec3 lit = base * (ambient * 0.85 + u_sun_color * sun * 0.75) + (base * 0.5 + 0.12) * rim;
    lit = mix(lit, base * 1.4 + rim * base * 2.5, u_glow * 0.6);
    vec3 shaded = mix(aces(lit * u_exposure), base, u_flat);
    float a = u_glow_alpha > 0.5 ? clamp(u_glow * (0.25 + rim), 0.0, 1.0) : 1.0;
    frag = vec4(pow(shaded, vec3(1.0 / 2.2)), a);
}
"
);

/// What a camera sees (D-024, D-038): a fan on the floor of its room from where the camera
/// stands, moved with its storey, drawn after what is opaque so that the furniture and the people
/// standing on it hide it.
pub(crate) const CAMERA_VIEW_VERTEX: &str = r"
uniform mat4 u_view_proj;
// Where each storey is drawn (D-028), and how high over the floor the fan lies (cm).
uniform vec4 u_offsets[20];
uniform float u_lift;

// Plan x and y, then the camera's (cm).
in vec4 a_place;
// Nearness to the fan's two side rays (0 on one), the tone (0 on, 1 recording, 2 off) and
// whether the camera was tapped (1) or not (0).
in vec4 a_look;
// How far the view reaches (cm), the storey.
in vec2 a_reach;

out vec2 v_plan;
out vec2 v_side;
flat out vec2 v_camera;
flat out float v_reach;
flat out float v_tone;
flat out float v_focus;

void main() {
    v_plan = a_place.xy;
    v_camera = a_place.zw;
    v_reach = a_reach.x;
    v_side = a_look.xy;
    v_tone = a_look.z;
    v_focus = a_look.w;
    vec3 p = vec3(a_place.x, u_lift, a_place.y) + u_offsets[int(a_reach.y)].xyz;
    gl_Position = u_view_proj * vec4(p, 1.0);
}
";

/// The fan in its tone, strongest at the camera and fading towards its reach, with a ring every
/// metre from the camera and its two side rays drawn as thin lines, never the edge along the walls
/// (it read as the room's outline). Faint until the camera is tapped, then whole.
pub(crate) const CAMERA_VIEW_FRAGMENT: &str = r"
// Display colours of the tones: on, recording, off.
uniform vec3 u_tones[3];
uniform float u_flat;

in vec2 v_plan;
in vec2 v_side;
flat in vec2 v_camera;
flat in float v_reach;
flat in float v_tone;
flat in float v_focus;

out vec4 frag;

// 1 on a line where `d` is 0, over about a pixel and a half, 0 away from it.
float line_at(float d, float width) {
    return 1.0 - smoothstep(0.5, 1.5, d / max(width, 1e-4));
}

void main() {
    vec3 tone = u_tones[int(v_tone + 0.5)];
    float metres = distance(v_plan, v_camera) / 100.0;
    float near = 1.0 - clamp(metres * 100.0 / max(v_reach, 1.0), 0.0, 1.0);
    float fill = mix(0.10, 0.30, v_focus) * mix(0.3, 1.0, near);
    float side = min(v_side.x, v_side.y);
    float ray = line_at(side, fwidth(side));
    float ring = line_at(abs(fract(metres + 0.5) - 0.5), fwidth(metres)) * step(0.5, metres);
    float line = max(ray, ring * 0.8) * mix(0.5, 0.95, v_focus) * mix(0.4, 1.0, near);
    float a = max(fill, line);
    // In the 2D plan a little stronger: it lies on flat colours.
    a = min(a * mix(1.0, 1.3, u_flat), 1.0);
    frag = vec4(tone, a);
}
";

/// What falls around the home (D-072): one particle per instance, its place worked out from its
/// number and the time, so that nothing is stored. Rain falls in streaks and splashes where it
/// lands, on the ground or on the roof, and runs off the eaves; snow drifts down in flakes; hail
/// falls in small hard grains. Outside the walls of a home without its roof shown.
pub(crate) const WEATHER_VERTEX: &str = r"
uniform mat4 u_view_proj;
uniform vec2 u_viewport;
// Seconds, starting again every `u_loop` seconds: each particle's turn fits a whole number of
// times in it, so that nothing jumps when it starts again.
uniform float u_time;
uniform float u_loop;
uniform vec3 u_eye;
// The home's footprint, every storey's and the roof's eaves: its centre and the unit direction of
// its length, half its length and width, and how far out around it things fall.
uniform vec4 u_area;
uniform vec3 u_half;
// Where falling starts and the ground; the home's lowest and highest heights.
uniform vec2 u_heights;
uniform vec2 u_home;
// The wings of the roofs shown (D-077), `u_wings` of them: where each is drawn (its storey's
// offset) and its shape (0 gable, 1 hip, 2 shed, 3 flat); its centre on the plan and the unit
// direction of its ridge; half its length and width, its eaves' height and its rise above its
// storey's floor; a lean-to's high side; as `RoofShape::height_at` reads them.
uniform float u_wings;
uniform vec4 u_wing_at[4];
uniform vec4 u_wing_area[4];
uniform vec4 u_wing_shape[4];
uniform float u_wing_high[4];
uniform vec2 u_wind;
// What falls (0 rain, 1 snow, 2 hail, 3 sleet), its speed (cm/s), the share running off the
// eaves, whether it splashes.
uniform vec4 u_fall;
// A streak's width, in device pixels.
uniform float u_line;

out vec2 v_uv;
flat out float v_kind;
out float v_fade;


uint mix_bits(uint x) {
    x ^= x >> 16;
    x *= 0x7feb352du;
    x ^= x >> 15;
    x *= 0x846ca68bu;
    x ^= x >> 16;
    return x;
}

float hash(uint a, uint b) {
    return float(mix_bits(a * 0x9e3779b9u ^ mix_bits(b + 0x632be5abu))) / 4294967295.0;
}

const vec2 CORNERS[6] = vec2[6](
    vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(1.0, 1.0),
    vec2(-1.0, -1.0), vec2(1.0, 1.0), vec2(-1.0, 1.0)
);

void hide() {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    v_uv = vec2(0.0);
    v_kind = 0.0;
    v_fade = 0.0;
}

float away(float d) {
    return abs(d) < 1e-6 ? (d < 0.0 ? -1e-6 : 1e-6) : d;
}

// Whether `p` is seen over the home from the eye, in front of it or behind it: whether the line
// from the eye through `p` crosses the home's box. What falls around the home is not drawn there,
// so that it falls around the home rather than in it (on its roof, when it has one).
bool over_home(vec3 p, vec2 u, vec2 v) {
    vec2 e = u_eye.xz - u_area.xy;
    vec3 o = vec3(dot(e, u), u_eye.y, dot(e, v));
    vec3 lo = vec3(-u_half.x, u_home.x, -u_half.y);
    vec3 hi = vec3(u_half.x, u_home.y, u_half.y);
    if (all(greaterThan(o, lo)) && all(lessThan(o, hi))) {
        // From inside (walking): what falls outside shows through the windows.
        return false;
    }
    vec3 w = p - u_eye;
    vec3 d = vec3(away(dot(w.xz, u)), away(w.y), away(dot(w.xz, v)));
    vec3 t0 = (lo - o) / d;
    vec3 t1 = (hi - o) / d;
    vec3 near = min(t0, t1);
    vec3 far = max(t0, t1);
    float enter = max(max(near.x, near.y), near.z);
    float leave = min(min(far.x, far.y), far.z);
    return leave >= max(enter, 0.0);
}

// The top of the roofs over a point of the plan (their highest wing there), and that wing; -1
// where there is none.
float roof_over(vec2 p, out int which) {
    float best = -1.0;
    which = -1;
    for (int k = 0; k < 4; k++) {
        if (float(k) >= u_wings) {
            break;
        }
        vec4 at = u_wing_at[k];
        vec4 shape = u_wing_shape[k];
        vec2 ru = u_wing_area[k].zw;
        vec2 r = p - u_wing_area[k].xy;
        float along = dot(r, ru);
        float across = dot(r, vec2(-ru.y, ru.x));
        if (abs(along) > shape.x || abs(across) > shape.y) {
            continue;
        }
        float kind = at.w;
        float up = 1.0;
        if (kind < 0.5) {
            up = 1.0 - abs(across) / shape.y;
        } else if (kind < 1.5) {
            up = min(1.0 - abs(across) / shape.y, (shape.x - abs(along)) / shape.y);
        } else if (kind < 2.5) {
            up = (across * u_wing_high[k] + shape.y) / (2.0 * shape.y);
        }
        float h = at.y + shape.z + shape.w * clamp(up, 0.0, 1.0);
        if (h > best) {
            best = h;
            which = k;
        }
    }
    return best;
}

void main() {
    uint id = uint(gl_InstanceID);
    vec2 q = CORNERS[gl_VertexID % 6];
    float kind = u_fall.x;
    if (kind > 2.5) {
        kind = hash(id, 7u) < 0.5 ? 0.0 : 1.0;
    }
    bool snow = kind > 0.5 && kind < 1.5;
    float speed = u_fall.y * (snow ? 1.0 : 1.4) * (0.8 + 0.4 * hash(id, 1u));
    if (snow && u_fall.x > 2.5) {
        speed *= 0.12;
    }
    bool roofed = u_wings > 0.5;
    // Off the eaves of a wing with slopes: one of them, picked as it falls.
    int eaves = int(min(floor(hash(id, 9u) * u_wings), 3.0));
    bool drip = roofed && kind < 0.5 && hash(id, 2u) < u_fall.z
        && u_wing_at[eaves].w < 2.5;
    float top = u_heights.x;
    float ground = u_heights.y;
    float height = top - ground;
    float splash = u_fall.w > 0.5 && !snow ? 0.18 : 0.0;
    // Its turn, long enough to fall and splash, a whole number of times in the loop.
    float turns = max(1.0, floor(u_loop / (height / speed + splash + 0.05)));
    float period = u_loop / turns;
    float turn = u_time / period + hash(id, 3u);
    uint cycle = uint(floor(turn)) % uint(turns);
    float tau = fract(turn) * period;
    // Where it lands, a new spot each turn: in the footprint's own axes.
    vec2 u = u_area.zw;
    vec2 v = vec2(-u.y, u.x);
    float margin = u_half.z;
    float s = (hash(id, cycle * 4u + 11u) * 2.0 - 1.0) * (u_half.x + margin);
    float t = (hash(id, cycle * 4u + 12u) * 2.0 - 1.0) * (u_half.y + margin);
    bool inside = abs(s) < u_half.x && abs(t) < u_half.y;
    vec2 ru = u_wing_area[eaves].zw;
    vec2 rv = vec2(-ru.y, ru.x);
    vec4 drip_at = u_wing_at[eaves];
    float from = top;
    float stop = ground;
    vec2 land;
    if (drip) {
        // Off the eaves: along one of them, from their height (a lean-to's low one).
        vec4 shape = u_wing_shape[eaves];
        float a = (hash(id, cycle * 4u + 13u) * 2.0 - 1.0) * shape.x;
        float b = (hash(id, cycle * 4u + 14u) < 0.5 ? -1.0 : 1.0) * (shape.y + 3.0);
        if (drip_at.w > 1.5) {
            b = -u_wing_high[eaves] * (shape.y + 3.0);
        }
        land = u_wing_area[eaves].xy + ru * a + rv * b + drip_at.xz;
        from = drip_at.y + shape.z;
        inside = false;
    } else {
        land = u_area.xy + u * s + v * t;
        int wing;
        float over = roofed ? roof_over(land, wing) : -1.0;
        bool covered = over > -0.5;
        if (inside && !covered) {
            // No roof over it: what would land in the home lands in the band around it instead.
            float ks = abs(s) / u_half.x;
            float kt = abs(t) / u_half.y;
            if (ks > kt) {
                s = (s < 0.0 ? -1.0 : 1.0) * (u_half.x + ks * margin);
            } else {
                t = (t < 0.0 ? -1.0 : 1.0) * (u_half.y + kt * margin);
            }
            inside = false;
            land = u_area.xy + u * s + v * t;
        } else if (covered) {
            // On the roof's slope.
            stop = over;
            // From as high above the roof as the rest above the ground: as many seen falling on it.
            from = stop + height;
            land += u_wing_at[wing].xz;
            inside = true;
        }
    }
    float landing = (from - stop) / speed;
    // Its way down, slanted by the wind: no more than so far across for each metre down, or the
    // slow flakes would blow out of sight.
    vec2 slope = u_wind * (snow ? 0.6 : 0.25) / speed;
    float steep = length(slope);
    float most = snow ? 0.8 : 0.6;
    if (steep > most) {
        slope *= most / steep;
    }
    if (drip) {
        // Its way starts at the eave and leads away from the walls (straight down the windward
        // side, where the wind blows it back against them): it lands downwind of the eave.
        float side = dot(land - drip_at.xz - u_wing_area[eaves].xy, rv) < 0.0 ? -1.0 : 1.0;
        float outward = dot(slope, rv) * side;
        if (outward < 0.0) {
            slope -= rv * side * outward;
        }
        land += slope * (from - stop);
    }
    vec3 way = vec3(-slope.x, 1.0, -slope.y);
    if (tau < landing) {
        float left = landing - tau;
        vec3 p = vec3(land.x, stop, land.y) + way * speed * left;
        if (!inside && !drip && over_home(p, u, v)) {
            hide();
            return;
        }
        if (snow) {
            float phase = hash(id, 5u) * 6.2832;
            // Swaying a whole number of times in the loop.
            float sway = 6.2831853 / u_loop;
            p.xz += vec2(sin(u_time * sway * 124.0 + phase), cos(u_time * sway * 105.0 + phase)) * 9.0;
            // A few pixels wide however far it is, so that it shows.
            vec4 c = u_view_proj * vec4(p, 1.0);
            if (c.w <= 0.01) {
                hide();
                return;
            }
            float size = u_line * (1.4 + 1.6 * hash(id, 6u));
            c.xy += q * size * 2.0 / u_viewport * c.w;
            gl_Position = c;
            v_uv = q;
            v_kind = 1.0;
            v_fade = 1.0;
            return;
        }
        // A streak along its way, its head where it is now; hail's are short.
        float length_s = kind > 1.5 ? 0.014 : (drip ? 0.055 : 0.04);
        vec3 tail = p + way * speed * length_s;
        vec4 a = u_view_proj * vec4(p, 1.0);
        vec4 b = u_view_proj * vec4(tail, 1.0);
        if (a.w <= 0.01 || b.w <= 0.01) {
            hide();
            return;
        }
        vec2 sa = a.xy / a.w * u_viewport;
        vec2 sb = b.xy / b.w * u_viewport;
        vec2 dir = sb - sa;
        float len = length(dir);
        dir = len > 1e-4 ? dir / len : vec2(0.0, 1.0);
        vec2 side = vec2(-dir.y, dir.x) * u_line * (kind > 1.5 ? 1.6 : 1.0);
        vec4 end = q.x < 0.0 ? a : b;
        end.xy += side * q.y * 2.0 / u_viewport * end.w;
        gl_Position = end;
        v_uv = q;
        v_kind = 0.0;
        v_fade = kind > 1.5 ? 1.3 : 1.0;
        return;
    }
    float after = tau - landing;
    vec3 above = vec3(land.x, stop, land.y) + way * 100.0;
    if (after < splash && !inside && (drip || !over_home(above, u, v))) {
        // A ring where it landed on the ground, widening and fading: none on the roof's slope,
        // none where its fall was not drawn.
        float k = after / splash;
        float r = mix(2.0, 10.0, k);
        vec3 p = vec3(land.x, stop + 0.6, land.y) + vec3(q.x, 0.0, q.y) * r;
        gl_Position = u_view_proj * vec4(p, 1.0);
        v_uv = q;
        v_kind = 2.0;
        v_fade = 1.0 - k;
        return;
    }
    hide();
}
";

/// A streak, a flake or a splash, in the weather's tint; lit by a storm's flash.
pub(crate) const WEATHER_FRAGMENT: &str = r"
uniform vec4 u_tint;
uniform float u_flash;

in vec2 v_uv;
flat in float v_kind;
in float v_fade;

out vec4 frag;

void main() {
    float a;
    float rim = 0.0;
    if (v_kind < 0.5) {
        // Thin across, brighter at its head.
        a = (1.0 - abs(v_uv.y)) * mix(1.0, 0.25, v_uv.x * 0.5 + 0.5);
    } else if (v_kind < 1.5) {
        // A soft flake, white at its heart, its edge in the tint so that it shows on a light sky.
        float d2 = dot(v_uv, v_uv);
        if (d2 >= 1.0) {
            discard;
        }
        a = 1.0 - smoothstep(0.35, 1.0, d2);
        rim = smoothstep(0.0, 0.7, d2);
    } else {
        float d = length(v_uv);
        if (d >= 1.0) {
            discard;
        }
        a = smoothstep(0.5, 0.85, d) * (1.0 - smoothstep(0.85, 1.0, d));
    }
    float snow = v_kind > 0.5 && v_kind < 1.5 ? 1.0 : 0.0;
    vec3 color = mix(u_tint.rgb, mix(vec3(1.0), u_tint.rgb, 0.25 + rim * 0.45), snow) + u_flash * 0.5;
    frag = vec4(min(color, vec3(1.0)), clamp(a * mix(u_tint.a, 0.95, snow) * v_fade, 0.0, 1.0));
}
";
