//! GLSL ES 3.00 sources. three-d prepends the `#version` line and the default precisions.
//!
//! One vertex shader serves every pass. It reads the packed attributes of
//! `domotwin_core::scene::mesh::Mesh` and applies the cut-away: walls lower to the height of their
//! group, pieces starting above it and things hanging on a cut wall disappear. It also reads the
//! live look of the vertex's element (its light, greyed out, tap highlight, power) from
//! `u_elements`.

/// Vertex shader of every pass.
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
    v_power = texelFetch(u_elements, at + ivec2(2, 0), 0).r;
    v_room = float(uint(a_normal.w) & 255u);
    // A hidden piece is moved outside the clip volume: all its vertices share the test.
    gl_Position = hidden ? vec4(0.0, 0.0, 2.0, 1.0) : u_view_proj * vec4(p, 1.0);
}
";

/// Shading of the colour passes (opaque and transparent).
pub(crate) const FRAGMENT: &str = r"
precision highp sampler2D;

uniform vec3 u_eye;
uniform vec3 u_sun;
uniform float u_flat;
uniform float u_shadows;
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
uniform vec3 u_palette;
uniform float u_floor_tint;
uniform vec3 u_floor_palette;
uniform vec3 u_plan_floor;
uniform vec3 u_plan_cap;
uniform float u_glow_alpha;

// The layers (D-023), three texels per room slot: heatmap colour (linear) and strength; the
// room's centre (x, z), reach and alert (0.5 warning, 1 danger); presence.
uniform sampler2D u_rooms;
uniform float u_layers;
uniform float u_power_layer;
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
    }
    // The look's palette, keeping each surface's lightness.
    bool floor_surface = surface == PLANKS || surface == TILES || surface == FLOOR;
    float lightness = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
    if (surface == WALL_CAP && u_glass_walls > 0.5) {
        albedo = to_linear(u_wall_cap);
    } else if (floor_surface) {
        albedo = mix(albedo, to_linear(u_floor_palette) * (0.5 + 0.8 * lightness), u_floor_tint);
    } else if (surface != GLOW && surface != SCREEN && surface != GLASS) {
        albedo = mix(albedo, to_linear(u_palette) * (0.45 + 1.6 * lightness), u_tint);
    }

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
    float shadow = sun_shadow(n);
    float ndl = dot(n, u_sun);
    float wrap = surface == LEAF ? 0.4 : 0.0;
    float diffuse_sun = max((ndl + wrap) / (1.0 + wrap), 0.0) * shadow;
    vec3 hemi = mix(u_ground, u_sky, n.y * 0.5 + 0.5);
    // Under a ceiling (the real sun), a room sees less of the sky: the sunlit patches stand out.
    if (u_bounce > 0.0 && v_room > 0.5) {
        hemi *= 0.6;
    }
    // Rooms have no ceiling: a little darker near the floor on vertical faces.
    float ao = mix(1.0, mix(u_ao, 1.0, smoothstep(0.0, 90.0, v_height)), 1.0 - abs(n.y));
    bool metal = surface == METAL || surface == MIRROR;
    vec3 bounce = u_sun_color * u_bounce * (1.0 - shadow) * (0.6 + 0.4 * max(n.y, 0.0));
    vec3 diffuse =
        albedo * (hemi * ao + u_sun_color * diffuse_sun + bounce) * (metal ? 0.3 : 1.0);
    vec3 h = normalize(u_sun + v);
    float shininess = exp2(11.0 * (1.0 - rough) + 1.0);
    float spec = pow(max(dot(n, h), 0.0), shininess) * (shininess + 8.0) / 25.0;
    float fresnel = pow(1.0 - max(dot(n, v), 0.0), 5.0);
    vec3 f0 = metal ? albedo : vec3(0.04);
    vec3 f = f0 + (1.0 - f0) * fresnel * (1.0 - rough);
    vec3 color = diffuse + u_sun_color * spec * f * shadow * step(0.0, ndl) * (1.0 - rough * 0.85);
    color += env * f * (1.0 - rough) * 0.6;
    color += albedo * lamps(n) * (metal ? 0.4 : 1.0);
    float alpha = 1.0;
    if (surface == MIRROR) {
        color = env * 0.9 + albedo * 0.1;
    } else if (surface == SCREEN) {
        color = albedo * 0.2 + env * (0.04 + 0.4 * fresnel);
    } else if (surface == GLASS) {
        color = albedo * hemi * 0.4 + env * (0.3 + 0.6 * fresnel);
        alpha = 0.22 + 0.5 * fresnel;
    }

    // Lamps and screens that are on glow with their element's light.
    float glow = v_look.a;
    vec3 emission = v_look.rgb * glow;
    if (surface == GLOW) {
        color = color * (1.0 - min(glow, 1.0) * 0.7) + emission * 2.2;
    } else if (surface == SCREEN) {
        color += emission * 1.4;
    }

    // The 2D plan: flat colours, the look's wall tops (and floors, for the looks with glass walls).
    vec3 plan = albedo * (0.86 + 0.14 * max(n.y, 0.0));
    if (surface == WALL_CAP) {
        plan = to_linear(u_plan_cap);
    } else if (on_floor && u_glass_walls > 0.5) {
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
    float a = mix(alpha, max(alpha, 0.35), u_flat);
    // Drawn offscreen, an opaque surface's alpha is how much it glows (lamps and screens that are
    // on); glass keeps its alpha to blend with (and leaves the glow below it as it is).
    if (u_glow_alpha > 0.5 && a >= 0.999) {
        bool lit = surface == GLOW || surface == SCREEN;
        a = lit ? min(glow, 1.0) * 0.9 : 0.0;
    }
    frag = vec4(pow(shaded, vec3(1.0 / 2.2)), a);
}
";

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
uniform float u_ground_y;
uniform vec2 u_centre;
uniform float u_radius;
uniform float u_glow_alpha;
uniform float u_shadows;
uniform sampler2D u_shadow_map;
uniform mat4 u_shadow_matrix;

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
        float far_away = smoothstep(u_radius * 1.4, u_radius * 4.5, length(g.xz - u_centre));
        float lines = max(grid(g.xz, 100.0) * 0.55, grid(g.xz, 500.0));
        vec3 ground = mix(u_ground, u_grid, lines * u_grid_strength);
        if (u_shadows > 0.5) {
            vec4 s = u_shadow_matrix * vec4(g, 1.0);
            vec3 c = s.xyz / s.w * 0.5 + 0.5;
            bool inside = c.x > 0.0 && c.x < 1.0 && c.y > 0.0 && c.y < 1.0 && c.z < 1.0;
            if (inside && c.z - 0.002 > texture(u_shadow_map, c.xy).r) {
                ground *= 0.86;
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
    bool hidden = false;
    if (a_a.w < 127.5) {
        float cut = cut_height(uint(a_a.w));
        hidden = a_b.w >= cut - 0.01;
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
