//! GLSL ES 3.00 sources. three-d prepends the `#version` line and the default precisions.
//!
//! One vertex shader serves every pass. It reads the packed attributes of
//! `domotwin_core::scene::mesh::Mesh` and applies the cut-away: walls lower to the height of their
//! group, pieces starting above it and things hanging on a cut wall disappear. It also reads the
//! live look of the vertex's element (its light, greyed out, tap highlight) from `u_elements`.

/// Vertex shader of every pass.
pub(crate) const VERTEX: &str = r"
uniform mat4 u_view_proj;
uniform vec4 u_cut[32];
uniform float u_wall_height;
// Two texels per element tag: light (rgb, strength), flags (greyed out, highlight).
uniform sampler2D u_elements;

in vec4 a_position;
in ivec4 a_normal;
in uvec4 a_color;
in uvec4 a_extra;
in vec2 a_uv;

out vec3 v_world;
out vec3 v_normal;
out vec4 v_color;
out vec2 v_uv;
flat out uint v_surface;
flat out uint v_element;
flat out vec4 v_look;
flat out vec4 v_flags;
flat out float v_room;

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
    v_world = p;
    v_normal = vec3(a_normal.xyz) / 127.0;
    v_color = vec4(a_color) / 255.0;
    v_uv = a_uv;
    v_surface = a_extra.y >> 2u;
    v_element = a_extra.z | (a_extra.w << 8u);
    ivec2 at = ivec2(int(v_element) * 2, 0);
    v_look = texelFetch(u_elements, at, 0);
    v_flags = texelFetch(u_elements, at + ivec2(1, 0), 0);
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
in vec3 v_normal;
in vec4 v_color;
in vec2 v_uv;
flat in uint v_surface;
flat in uint v_element;
flat in vec4 v_look;
flat in vec4 v_flags;
flat in float v_room;

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

    vec3 v = normalize(u_eye - v_world);
    vec3 r = reflect(-v, n);
    vec3 env = mix(u_ground, u_sky * 1.15, clamp(r.y * 0.5 + 0.5, 0.0, 1.0));
    float shadow = sun_shadow(n);
    float ndl = dot(n, u_sun);
    float wrap = surface == LEAF ? 0.4 : 0.0;
    float diffuse_sun = max((ndl + wrap) / (1.0 + wrap), 0.0) * shadow;
    vec3 hemi = mix(u_ground, u_sky, n.y * 0.5 + 0.5);
    // Rooms have no ceiling: a little darker near the floor on vertical faces.
    float ao = mix(1.0, mix(u_ao, 1.0, smoothstep(0.0, 90.0, v_world.y)), 1.0 - abs(n.y));
    bool metal = surface == METAL || surface == MIRROR;
    vec3 diffuse = albedo * (hemi * ao + u_sun_color * diffuse_sun) * (metal ? 0.3 : 1.0);
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

    // The 2D plan: flat colours, dark wall tops.
    vec3 plan = albedo * (0.86 + 0.14 * max(n.y, 0.0));
    if (surface == WALL_CAP) {
        plan = vec3(0.035, 0.04, 0.038);
    }
    if (surface == GLOW || surface == SCREEN) {
        plan = mix(plan, min(emission * 1.5, vec3(1.0)), min(glow, 1.0) * 0.85);
    }

    // Unavailable entities: greyed out. A tap: a short blue flash.
    float grey = v_flags.r * 0.85;
    color = mix(color, vec3(dot(color, vec3(0.2126, 0.7152, 0.0722))) * 0.7, grey);
    plan = mix(plan, vec3(dot(plan, vec3(0.2126, 0.7152, 0.0722))) * 0.8, grey);
    vec3 flash = vec3(0.25, 0.5, 1.0) * v_flags.g;
    color += flash * 0.6;
    plan += flash * 0.3;
    vec3 shaded = mix(aces(color * u_exposure), plan, u_flat);
    frag = vec4(pow(shaded, vec3(1.0 / 2.2)), mix(alpha, max(alpha, 0.35), u_flat));
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
    frag = vec4(1.0 - exp(-v_tint * a * u_gain), 0.0);
}
";
