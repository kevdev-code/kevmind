// WebGL2 renderer for the brain. A handful of draw calls, all additive light:
// - ground: a deep blue-violet night, vignette and a very sparse, dim starfield (decoration, in screen space);
// - shell: filaments (short curved strands, instanced, one draw call) and a few sparkling junctions (decoration);
// - haze: soft region and lobe glows;
// - fibers: links as curved, glowing ribbons (instanced quads, one per curve segment); the same program draws the
//   neurons' dendrites and axons, the fiber tracts and the fixed structures (brainstem bundle, Purkinje trees);
//   agent beams reuse it;
// - nodes: somas (shape by type, halo, ignition flash, think ripples, depth fog);
// - sprites on top: agent heads, rings, pulses.
// Two caches keep the frames cheap. The deep cache (ground, shell, dendrites, tracts) is redrawn only when the
// camera or what is shown changes (layers.deepKey); the main cache (the deep one plus haze and links) also when the
// activity lighting changes (layers.mainKey). Each animation frame copies the main cache and draws the glow, active
// neurons, nodes, beams and sprites on top. While the camera moves, strands and links are drawn straight.
// Strands and fiber segments are pulled from float textures by vertex id and drawn as plain triangles: instancing
// costs a few microseconds per instance on software renderers (SwiftShader), which dominated with tens of thousands.
// The intro: the caches are drawn once, fully, plus a texture of when the rising wave reaches each pixel; each intro
// frame composites them (ground + the brain where the wave has passed, a glow at its front, two closing waves) and
// draws the nodes and the tracts, which have their own timing. So the intro costs about as much as a still frame.

// OKLCH → gamma-encoded sRGB [0..1], so colors match DESIGN.md's tokens exactly.
export function oklch(L, C, h) {
  const a = C * Math.cos((h * Math.PI) / 180), b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return lin.map((v) => { v = Math.min(1, Math.max(0, v)); return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; });
}

// Kind codes shared with the page: what lights a node.
export const KIND = { none: 0, read: 1, edit: 2, error: 3, command: 4, focus: 5 };
export const SHAPE = { file: 0, instruction: 1, memory: 2, serena: 3, tool: 4 };
// Fiber types: the six link types, the midline (unused), agent beams, dendrites/axons, tracts, fixed structures.
export const EDGE = { link: 0, index: 1, import: 2, cites: 3, cochange: 4, readfirst: 5, midline: 6, beam: 7, dendrite: 8, tract: 9, structure: 10 };
export const SPRITE = { glow: 0, ring: 1, head: 2, dust: 3 };
export const NODE_FLOATS = 11; // x y z size shape project r g b seed part
export const FIBER_FLOATS = 20; // p0(3) p1(3) t0 t1 c0(3) c1(3) type width core alpha project level+2·part
export const SPRITE_FLOATS = 9; // x y z size r g b a mode
export const FIL_FLOATS = 15; // p0(3) p1(3) control(3) normal(3) alpha part tint
// The intro's timeline (s): each part's wave (start, length), the tracts, the one closing wave (start, length), the end.
export const INTRO = { stem: [0.25, 0.4], cerebellum: [0.6, 0.4], cerebrum: [0.9, 1.0], tracts: [1.85, 0.45], wave: [2.3, 0.55], end: 2.95 };
const STILL = [99, -9, -9, 0]; // the intro's clock once it's over: everything shown, no waves

const F = (v) => Number(v).toFixed(3); // a GLSL float literal
const DEPTH = `float farOf(float w) { return clamp((w - u_depth.x) / (u_depth.y - u_depth.x), 0.0, 1.0); }`;
const REVEAL = `
uniform vec4 u_intro; // x: intro clock (s; 99 once over), y: the closing wave's radius (negative: none)
uniform vec2 u_yr[3]; // the parts' heights: cerebrum, cerebellum, brainstem
uniform vec3 u_center;
float revealAt(float y, float part) { // when the rising wave reaches a point: brainstem, then cerebellum, then cerebrum
  vec2 r = part > 1.5 ? u_yr[2] : part > 0.5 ? u_yr[1] : u_yr[0];
  float u = clamp((y - r.x) / max(0.01, r.y - r.x), 0.0, 1.0);
  return part > 1.5 ? ${F(INTRO.stem[0])} + ${F(INTRO.stem[1])} * u : part > 0.5 ? ${F(INTRO.cerebellum[0])} + ${F(INTRO.cerebellum[1])} * u : ${F(INTRO.cerebrum[0])} + ${F(INTRO.cerebrum[1])} * u;
}
float shown(float T) { return smoothstep(T, T + 0.16, u_intro.x); }
float front(float T) { float d = (u_intro.x - T - 0.05) / 0.07; return exp(-d * d); }
float wave(vec3 p) { float a = (distance(p, u_center) - u_intro.y) / 0.16; return exp(-a * a); }
`;
// In the reveal pass (u_mode 1) every cached program writes, instead of light, when the intro reaches the fragment.
const MODE_OUT = `if (u_mode > 0.5) { o = vec4(v_T / 3.0, 0.0, 0.0, 1.0); return; }`;
const OFF = 'gl_Position = vec4(2.0, 2.0, 2.0, 1.0)'; // outside the clip volume: nothing rasterized

export const BG_VS = `#version 300 es
out vec2 v_uv;
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); v_uv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
const GROUND = `
uniform vec3 u_edge, u_center; uniform vec2 u_size; uniform float u_dpr;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 ground(vec2 uv) {
  vec2 q = (uv - vec2(0.5, 0.52)) * vec2(u_size.x / u_size.y, 1.0);
  float r = length(q);
  vec3 col = mix(u_center, u_edge, smoothstep(0.0, 0.8, r / 0.85));
  col *= 1.0 - smoothstep(0.45, 1.3, r) * 0.65; // vignette
  // A very sparse, dim, static starfield: one candidate per 7 px cell. Decoration, never data.
  vec2 px = gl_FragCoord.xy / u_dpr, cell = floor(px / 7.0);
  float h = hash(cell);
  if (h > 0.99) {
    vec2 c = (cell + vec2(hash(cell + 1.7), hash(cell + 3.1)) * 0.8 + 0.1) * 7.0;
    col += vec3(0.70, 0.70, 0.90) * ((h - 0.99) / 0.01) * 0.2 * smoothstep(1.2, 0.0, length(px - c));
  }
  return col + (hash(gl_FragCoord.xy) - 0.5) / 255.0;
}`;
export const BG_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
${GROUND}
void main() { o = vec4(ground(v_uv), 1.0); }`;
// The intro's frame: the ground, the cached brain where the wave has passed, a glow at its front, the closing wave.
export const COMP_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_cache, u_reveal; uniform float u_clock; uniform vec2 u_wave; // the closing wave: radius, band (px)
uniform vec2 u_mid; // the brain's center on screen (px)
out vec4 o;
${GROUND}
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec3 b = texelFetch(u_cache, ip, 0).rgb;
  float T = texelFetch(u_reveal, ip, 0).r * 3.0;
  float on = smoothstep(T, T + 0.16, u_clock), d = (u_clock - T - 0.05) / 0.07, fr = exp(-d * d);
  float w = (distance(gl_FragCoord.xy, u_mid) - u_wave.x) / u_wave.y, wave = exp(-w * w);
  float lit = max(b.r, max(b.g, b.b));
  o = vec4(ground(v_uv) + b * (on * (1.0 + 0.9 * wave) + fr * 2.2) + vec3(0.35) * fr * min(1.0, lit * 2.0), 1.0);
}`;

export const NODE_VS = `#version 300 es
in vec3 a_pos; in float a_size, a_shape, a_proj; in vec3 a_color; in float a_seed, a_part; in vec4 a_state;
uniform mat4 u_vp; uniform float u_time, u_px, u_life; uniform vec2 u_depth; uniform float u_proj[32];
uniform vec4 u_rip[4]; uniform vec3 u_ripColor[4]; uniform vec3 u_kind[6];
out vec3 v_color, v_flash; out float v_alpha, v_shape, v_white, v_far, v_ember;
${DEPTH}
${REVEAL}
void main() {
  float T = revealAt(a_pos.y, a_part) + 0.08, on = shown(T);
  if (on < 0.001) { ${OFF}; gl_PointSize = 0.0; return; }
  vec4 p = u_vp * vec4(a_pos, 1.0);
  gl_Position = p;
  float far = farOf(p.w);
  float dt = u_time - a_state.z;
  float flash = dt >= 0.0 && dt < 3.0 ? exp(-dt * 2.6) : 0.0;
  vec3 rip = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    float rt = u_time - u_rip[i].w;
    if (rt > 0.0 && rt < 2.4) {
      float w = (distance(a_pos, u_rip[i].xyz) - rt * 0.18) / 0.05;
      rip += u_ripColor[i] * exp(-w * w) * (1.0 - rt / 2.4) * 1.3;
    }
  }
  float vis = step(0.001, a_state.x);
  float pf = a_proj < 0.0 ? 1.0 : u_proj[int(a_proj)];
  float lift = front(T) * 1.2 + wave(a_pos) * 0.9; // the intro's growth front and closing wave
  // Life: a slow, soft breathing of each cell's light, out of step with its neighbors (5 to 9 s a cycle).
  float breath = 1.0 + u_life * 0.12 * sin(u_time * (0.7 + 0.55 * a_seed) + a_seed * 47.0);
  vec3 col = a_color * a_state.x * pf * (1.0 + lift) * breath;
  col = mix(col, vec3(dot(col, vec3(0.3, 0.59, 0.11))), far * 0.55); // far: desaturated...
  v_color = col * (1.0 - far * 0.5) + rip;                           // ...and dimmer
  v_flash = u_kind[int(a_state.w)] * flash;
  v_white = clamp(a_state.y * 0.5 + flash + lift * 0.5, 0.0, 1.0);
  v_alpha = vis * on * (1.0 - far * 0.45);
  v_shape = a_shape;
  v_far = far;
  v_ember = clamp(a_state.y + flash, 0.0, 1.0);
  // Nearer cells a little bigger, farther ones a little smaller, beyond perspective.
  float px = vis * min(a_size * (1.0 + 0.8 * flash + 0.25 * a_state.y) * (1.12 - 0.3 * far) * u_px / p.w, 220.0);
  gl_PointSize = px;
}`;
// A glowing cell, shaded as a small 3D body lit from the upper left: a soft gradient body, a bright nucleus, a rim
// light (brighter where the surface turns away), and a halo that grows when the cell is active. Per type: a sphere
// with its nucleus (code files), a faceted octahedron (instructions), a pyramid, the soma of a pyramidal cell (memory
// notes), a small cube (Serena notes), a torus (tools). Farther cells have softer edges.
export const NODE_FS = `#version 300 es
precision mediump float;
in vec3 v_color, v_flash; in float v_alpha, v_shape, v_white, v_far, v_ember;
out vec4 o;
const vec3 LIGHT = vec3(-0.45, 0.55, 0.70);
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  q.y = -q.y;
  if (dot(q, q) > 1.0) discard;
  vec2 p = q / 0.46; // the body fills 46% of the sprite; the rest is halo
  float d, nucleus = 0.0, ridge = 0.0;
  vec3 n;
  if (v_shape < 0.5) { // sphere with a nucleus
    float r = length(p);
    d = r - 1.0;
    n = vec3(p, sqrt(max(0.0, 1.0 - r * r)));
    vec2 c = p - vec2(-0.2, 0.22);
    nucleus = exp(-dot(c, c) * 7.0);
  } else if (v_shape < 1.5) { // octahedron: four facets toward the viewer, ridges between them
    d = (abs(p.x) * 0.9 + abs(p.y) * 0.75) - 1.0;
    n = normalize(vec3(sign(p.x) * 0.55, sign(p.y) * 0.5, 0.68));
    ridge = exp(-pow(min(abs(p.x), abs(p.y)) / 0.06, 2.0));
    nucleus = exp(-dot(p, p) * 10.0) * 0.6;
  } else if (v_shape < 2.5) { // pyramid: a left and a right face, a ridge from the apex
    vec2 t = vec2(abs(p.x), p.y + 0.6); // apex at the top (y 1), base at y -0.6, 1.8 wide
    d = max(t.x * 0.872 + t.y * 0.49 - 0.785, -t.y);
    n = normalize(vec3(p.x < 0.0 ? -0.55 : 0.5, 0.3, 0.75));
    ridge = exp(-pow(p.x / 0.06, 2.0)) * step(-0.6, p.y);
    vec2 c = p - vec2(0.0, -0.05);
    nucleus = exp(-dot(c, c) * 12.0) * 0.8;
  } else if (v_shape < 3.5) { // cube, a corner toward the viewer: top, left and right faces
    vec2 a = abs(p);
    d = max(a.x, a.x * 0.5 + a.y * 0.866) - 0.86; // a pointy-top hexagon
    bool top = p.y > a.x * 0.577;
    n = top ? normalize(vec3(0.0, 0.85, 0.5)) : normalize(vec3(p.x < 0.0 ? -0.75 : 0.75, -0.25, 0.6));
    float e1 = abs(p.x) * step(p.y, 0.0), e2 = abs(p.y - abs(p.x) * 0.577) * step(0.0, p.y + 0.01);
    ridge = exp(-pow(min(e1, e2) / 0.06, 2.0)) * 0.8;
  } else { // torus: a glowing ring, a tube shaded across its width
    float r = length(p), k = (r - 0.64) / 0.34;
    d = abs(r - 0.64) - 0.34;
    vec2 dir = r > 0.001 ? p / r : vec2(0.0);
    n = vec3(dir * clamp(k, -1.0, 1.0), sqrt(max(0.0, 1.0 - k * k)));
    nucleus = exp(-pow((r - 0.64) / 0.12, 2.0)) * 0.5; // a bright line along the top of the tube
  }
  float w = max(fwidth(d), 0.02) * (1.0 + v_far * 3.0);
  float body = 1.0 - smoothstep(-w, w, d);
  float diff = max(dot(n, normalize(LIGHT)), 0.0), rim = pow(1.0 - clamp(n.z, 0.0, 1.0), 2.0);
  vec3 lit = v_color * (0.45 + 0.8 * diff) + v_color * rim * 1.3 + mix(v_color, vec3(1.0), 0.55) * (nucleus * 1.1 + ridge * 0.45);
  lit = mix(lit, vec3(1.0), v_white * 0.55) + v_flash;
  float halo = exp(-max(d, 0.0) * 3.4) * (0.16 + 0.4 * v_ember) * (1.0 - body);
  vec3 col = lit * body + (v_color + v_flash) * halo;
  float a = (body + halo) * v_alpha;
  if (a < 0.004) discard;
  o = vec4(col * v_alpha, 0.0);
}`;

// Vertex pulling: a segment's or strand's data sits in a float texture (u_data, 2048 texels wide), read by vertex id,
// and every segment is plain triangles: no instancing, whose per-instance cost dominates on software renderers.
const PULL = `
uniform highp sampler2D u_data, u_hlt; uniform int u_base;
vec4 fetch(int t) { return texelFetch(u_data, ivec2(t & 2047, t >> 11), 0); }
float fetchHl(int i) { return texelFetch(u_hlt, ivec2(i & 2047, i >> 11), 0).r; }`;

export const FIBER_VS = `#version 300 es
uniform mat4 u_vp; uniform vec2 u_half; uniform vec2 u_depth; uniform float u_dpr;
uniform float u_alpha[11]; uniform float u_proj[32]; uniform vec3 u_hlColor;
out vec3 v_color; out float v_alpha, v_side, v_t, v_core, v_dash, v_T;
${PULL}
${DEPTH}
${REVEAL}
void main() {
  // A segment: two triangles (corners 0 1 2, 2 1 3) of a quad, its data in five texels.
  int item = u_base + gl_VertexID / 6, corner = int[6](0, 1, 2, 2, 1, 3)[gl_VertexID % 6];
  vec4 d0 = fetch(item * 5), d1 = fetch(item * 5 + 1), d2 = fetch(item * 5 + 2), d3 = fetch(item * 5 + 3), d4 = fetch(item * 5 + 4);
  vec3 a_p0 = d0.xyz, a_p1 = vec3(d0.w, d1.xy), a_c0 = d2.xyz, a_c1 = vec3(d2.w, d3.xy);
  vec2 a_t = d1.zw, a_meta = d4.zw;
  vec4 a_info = vec4(d3.zw, d4.xy);
  float a_hl = fetchHl(item);
  bool tail = corner < 2;
  float side = (corner == 1 || corner == 3) ? 1.0 : -1.0;
  int type = int(a_info.x);
  if (a_hl <= 0.0) { ${OFF}; return; }
  vec4 c0 = u_vp * vec4(a_p0, 1.0), c1 = u_vp * vec4(a_p1, 1.0);
  vec4 c = tail ? c0 : c1;
  vec2 dv = (c1.xy / c1.w - c0.xy / c0.w) * u_half;
  float len = length(dv);
  // Dendrites: the fine branches only when they are long enough on screen to read (zoomed in) or the neuron is
  // active; the main ones only above a pixel.
  float level = mod(a_meta.y, 2.0), part = floor(a_meta.y / 2.0 + 0.01);
  if (type == 8 && a_hl < 1.5 && len < (level > 0.5 ? 5.0 : 1.2) * u_dpr) { ${OFF}; return; }
  // The intro: links once both ends are there; dendrites and structures with their part (above the brainstem, with
  // the cerebrum); tracts last, lit from one end to the other, so a pulse shoots along each.
  vec3 pm = tail ? a_p0 : a_p1;
  float T = type == 9 ? ${F(INTRO.tracts[0])} + ${F(INTRO.tracts[1])} * (tail ? a_t.x : a_t.y)
    : type >= 8 ? revealAt(pm.y, part > 1.5 && pm.y > u_yr[2].y ? 0.0 : part) + 0.1
    : type == 7 ? 0.0 : max(revealAt(a_p0.y, 0.0), revealAt(a_p1.y, 0.0)) + 0.15;
  float on = shown(T), lift = front(T) * 3.0;
  if (on < 0.001 && lift < 0.01) { ${OFF}; return; }
  vec2 dir = len > 1e-4 ? dv / len : vec2(1.0, 0.0);
  c.xy += vec2(-dir.y, dir.x) * side * a_info.y * u_dpr * 0.5 / u_half * c.w;
  gl_Position = c;
  float pf = a_meta.x < 0.0 || type >= 8 ? 1.0 : u_proj[int(a_meta.x)]; // dendrites and tracts don't dim by project
  float alpha = a_info.w > 0.0 ? a_info.w : u_alpha[type] * a_hl * pf * pf;
  vec3 col = tail ? a_c0 : a_c1;
  if (a_hl > 2.5 && type < 8) { col = mix(col, u_hlColor, 0.45); alpha = 0.6; }
  float far = farOf(c.w);
  col = mix(col, vec3(dot(col, vec3(0.3, 0.59, 0.11))), far * 0.55);
  v_color = mix(col, vec3(1.0), clamp(lift * 0.35, 0.0, 0.6));
  v_alpha = alpha * (on + lift) * (1.0 - far * 0.6) * step(0.05, min(c0.w, c1.w));
  v_side = side;
  v_t = tail ? a_t.x : a_t.y;
  v_core = a_info.z;
  v_dash = type == 4 && a_hl < 2.5 ? 1.0 : 0.0;
  v_T = T;
}`;
export const FIBER_FS = `#version 300 es
precision mediump float;
in vec3 v_color; in float v_alpha, v_side, v_t, v_core, v_dash, v_T;
uniform float u_mode;
out vec4 o;
void main() {
  if (v_dash > 0.5 && fract(v_t * 45.0) > 0.5) discard;
  float d = abs(v_side);
  float core = exp(-d * d * 14.0), glow = v_core > 0.5 ? exp(-d * d * 2.2) * 0.8 : exp(-d * d * 3.0) * 0.45;
  vec3 col = v_core > 0.5 ? mix(v_color, vec3(1.0), exp(-d * d * 22.0)) : v_color;
  float a = (core * 0.85 + glow) * v_alpha;
  if (a < 0.003) discard;
  ${MODE_OUT}
  o = vec4(col * a, 0.0);
}`;

export const SPRITE_VS = `#version 300 es
in vec3 a_pos; in float a_size; in vec4 a_color; in float a_mode;
uniform mat4 u_vp; uniform float u_px; uniform vec2 u_depth;
out vec4 v_color; out float v_mode, v_T;
${DEPTH}
${REVEAL}
void main() {
  vec4 p = u_vp * vec4(a_pos, 1.0);
  gl_Position = p;
  v_color = vec4(a_color.rgb, a_color.a * (1.0 - farOf(p.w) * 0.6));
  v_mode = a_mode;
  v_T = revealAt(a_pos.y, 0.0) + 0.3;
  gl_PointSize = clamp(a_size * u_px / p.w, a_mode > 2.5 ? 1.6 : 0.0, 420.0);
}`;
export const SPRITE_FS = `#version 300 es
precision mediump float;
in vec4 v_color; in float v_mode, v_T;
uniform float u_mode;
out vec4 o;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = length(q), a;
  vec3 col = v_color.rgb;
  if (v_mode < 0.5) a = exp(-r * r * 4.0);
  else if (v_mode < 1.5) a = exp(-pow((r - 0.8) / 0.09, 2.0));
  else if (v_mode < 2.5) { a = exp(-r * r * 5.0) + exp(-r * r * 70.0) * 1.6; col = mix(col, vec3(1.0), clamp(exp(-r * r * 40.0), 0.0, 1.0)); }
  else a = exp(-r * r * 3.5);
  a *= v_color.a * step(r, 1.0);
  if (a < 0.003) discard;
  ${MODE_OUT}
  o = vec4(col * a, 0.0);
}`;

// The shell's facing: brightest where it faces the camera, so the folds read as texture; a soft, thin edge just
// inside the near side's rim, so the silhouette reads at a glance; almost nothing behind (more when cut open, where
// the far hemisphere's inner wall is what you see). In the cut, the near hemisphere's cerebrum is gone.
const FACING = `
uniform vec3 u_eye; uniform float u_edge, u_back, u_cut;
float facing(vec3 p, vec3 n) {
  float f = dot(n, normalize(u_eye - p));
  float face = 0.1 + 0.9 * smoothstep(0.0, 0.65, f), edge = smoothstep(0.0, 0.05, f) * (1.0 - smoothstep(0.1, 0.22, f));
  return f > 0.0 ? face + u_edge * edge : u_back;
}
bool cutAway(vec3 p, float part) { return u_cut != 0.0 && part < 0.5 && p.z * u_cut > 0.004; }`;

// Filaments: a quadratic curve per instance (p0, control, p1), a thin screen-space ribbon through three points of it
// (6 vertices), or straight through its ends (4 vertices, u_step 1, while the camera moves). The cerebrum in a cool
// gray and violet, mixed per strand; the cerebellum pale ice and the brainstem blue-white, each its own structure.
export const FIL_VS = `#version 300 es
uniform mat4 u_vp; uniform vec2 u_half; uniform float u_dpr, u_alpha, u_width, u_step; uniform int u_verts; uniform vec3 u_color, u_tint, u_cbl, u_stem;
out vec4 v_color; out float v_side, v_T;
${PULL}
${REVEAL}
${FACING}
void main() {
  // A strand: a ribbon through three points of its curve (4 triangles), or straight through its ends (2), from four
  // texels: p0, p1, the control point, the normal, then alpha, part and tint (a_k).
  int item = u_base + gl_VertexID / u_verts, k = gl_VertexID % u_verts;
  int corner = int[12](0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5)[k];
  vec4 d0 = fetch(item * 4), d1 = fetch(item * 4 + 1), d2 = fetch(item * 4 + 2), d3 = fetch(item * 4 + 3);
  vec3 a_p0 = d0.xyz, a_p1 = vec3(d0.w, d1.xy), a_c = vec3(d1.zw, d2.x), a_n = d2.yzw, a_k = d3.xyz;
  if (cutAway(a_p0, a_k.y)) { ${OFF}; return; }
  float t = float(corner / 2) * u_step, side = corner % 2 == 0 ? -1.0 : 1.0;
  vec3 p = mix(mix(a_p0, a_c, t), mix(a_c, a_p1, t), t), tg = mix(a_c - a_p0, a_p1 - a_c, t);
  vec4 c = u_vp * vec4(p, 1.0), c2 = u_vp * vec4(p + tg * 0.05, 1.0);
  vec2 dv = (c2.xy / c2.w - c.xy / c.w) * u_half, dir = length(dv) > 1e-6 ? normalize(dv) : vec2(1.0, 0.0);
  c.xy += vec2(-dir.y, dir.x) * side * u_width * u_dpr * 0.5 / u_half * c.w;
  gl_Position = c;
  vec3 col = a_k.y > 1.5 ? u_stem : a_k.y > 0.5 ? u_cbl : mix(u_color, u_tint, a_k.z * 0.7);
  v_color = vec4(col, u_alpha * a_k.x * facing(p, a_n));
  v_side = side;
  v_T = revealAt(p.y, a_k.y);
}`;
export const FIL_FS = `#version 300 es
precision mediump float;
in vec4 v_color; in float v_side, v_T;
uniform float u_mode;
out vec4 o;
void main() {
  float a = exp(-v_side * v_side * 2.5) * v_color.a;
  if (a < 0.002) discard;
  ${MODE_OUT}
  o = vec4(v_color.rgb * a, 0.0);
}`;

// Junctions: the shell's points, faint, so the web sparkles a little; a lobe's patch of them is also its glow.
export const DUST_VS = `#version 300 es
in vec3 a_pos; in vec3 a_nrm; in float a_part;
uniform mat4 u_vp; uniform float u_px, u_size, u_alpha; uniform vec3 u_color;
out vec4 v_color; out float v_T;
${REVEAL}
${FACING}
void main() {
  if (cutAway(a_pos, a_part)) { ${OFF}; gl_PointSize = 0.0; return; }
  vec4 p = u_vp * vec4(a_pos, 1.0);
  gl_Position = p;
  v_color = vec4(u_color, u_alpha * facing(a_pos, a_nrm));
  v_T = revealAt(a_pos.y, a_part);
  gl_PointSize = clamp(u_size * u_px / p.w, 1.0, 6.0);
}`;
export const DUST_FS = `#version 300 es
precision mediump float;
in vec4 v_color; in float v_T;
uniform float u_mode;
out vec4 o;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q), a = exp(-r2 * 3.5) * v_color.a * step(r2, 1.0);
  if (a < 0.002) discard;
  ${MODE_OUT}
  o = vec4(v_color.rgb * a, 0.0);
}`;

function program(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const loc = {};
  for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) { const u = gl.getActiveUniform(p, i); loc[u.name.replace('[0]', '')] = gl.getUniformLocation(p, u.name); }
  for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES); i++) { const a = gl.getActiveAttrib(p, i); loc[a.name] = gl.getAttribLocation(p, a.name); }
  return { p, loc };
}


export class Renderer {
  constructor(canvas, palette) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.canvas = canvas;
    this.palette = palette;
    this.bg = program(gl, BG_VS, BG_FS);
    this.comp = program(gl, BG_VS, COMP_FS);
    this.node = program(gl, NODE_VS, NODE_FS);
    this.fiber = program(gl, FIBER_VS, FIBER_FS);
    this.sprite = program(gl, SPRITE_VS, SPRITE_FS);
    this.dust = program(gl, DUST_VS, DUST_FS);
    this.filProg = program(gl, FIL_VS, FIL_FS);
    this.vao = { bg: gl.createVertexArray() };
    this.buf = {};
    this.layers = {}; // fiber-program layers: dendrites and tracts (cached), active (active neurons, every frame)
    this.targets = {};
    this.counts = { nodes: 0, fibers: 0, beams: 0, dust: 0, filaments: 0, sprites: 0 };
  }

  // Interleaved attributes: [name, size] in order.
  _layout(prog, buf, fields) {
    const gl = this.gl, stride = fields.reduce((s, f) => s + f[1], 0) * 4;
    let off = 0;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    for (const [name, size] of fields) {
      const l = prog.loc[name];
      if (l !== undefined && l >= 0) {
        gl.enableVertexAttribArray(l);
        gl.vertexAttribPointer(l, size, gl.FLOAT, false, stride, off);
      }
      off += size * 4;
    }
  }
  _buffer(data, usage) {
    const gl = this.gl, b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    return b;
  }

  // Nodes: NODE_FLOATS per node (static), plus a dynamic state vec4 (brightness, 0 = hidden; ember; ignition s; kind).
  setNodes(data, state) {
    const gl = this.gl;
    this.nodeData = data;
    if (this.vao.node) gl.deleteVertexArray(this.vao.node);
    this.vao.node = gl.createVertexArray();
    gl.bindVertexArray(this.vao.node);
    this.buf.node = this._buffer(data, gl.STATIC_DRAW);
    this._layout(this.node, this.buf.node, [['a_pos', 3], ['a_size', 1], ['a_shape', 1], ['a_proj', 1], ['a_color', 3], ['a_seed', 1], ['a_part', 1]]);
    this.buf.state = this._buffer(state, gl.DYNAMIC_DRAW);
    this._layout(this.node, this.buf.state, [['a_state', 4]]);
    gl.bindVertexArray(null);
    this.counts.nodes = data.length / NODE_FLOATS;
  }
  setSize(i, size) {
    const gl = this.gl, k = i * NODE_FLOATS + 3;
    this.nodeData[k] = size;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.node);
    gl.bufferSubData(gl.ARRAY_BUFFER, k * 4, this.nodeData, k, 1);
  }
  updateState(state, from = 0, to = state.length / 4) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.state);
    gl.bufferSubData(gl.ARRAY_BUFFER, from * 16, state, from * 4, (to - from) * 4);
  }

  // A float texture 2048 texels wide holding `items` of `texels` RGBA texels each (data padded to fit), and for
  // fibers a one-channel texture of their highlights. Rewritten in place with update().
  _tex(format, width, rows) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, rows);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return t;
  }
  _store(data, floats, hl = null) {
    const gl = this.gl, texels = Math.ceil(floats / 4), count = Math.round(data.length / floats);
    const rows = Math.max(1, Math.ceil((count * texels) / 2048)), pad = new Float32Array(rows * 2048 * 4);
    if (floats === texels * 4) pad.set(data);
    else for (let i = 0; i < count; i++) pad.set(data.subarray(i * floats, (i + 1) * floats), i * texels * 4);
    const s = { tex: this._tex(gl.RGBA32F, 2048, rows), rows, count, texels };
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 2048, rows, gl.RGBA, gl.FLOAT, pad);
    if (hl) { s.hlRows = Math.max(1, Math.ceil(count / 2048)); s.hlPad = new Float32Array(s.hlRows * 2048); s.hlTex = this._tex(gl.R32F, 2048, s.hlRows); this._hl(s, hl); }
    return s;
  }
  _hl(s, hl) {
    const gl = this.gl;
    s.hlPad.set(hl.subarray(0, s.count));
    gl.bindTexture(gl.TEXTURE_2D, s.hlTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 2048, s.hlRows, gl.RED, gl.FLOAT, s.hlPad);
  }
  _drop(s) { if (!s) return; this.gl.deleteTexture(s.tex); if (s.hlTex) this.gl.deleteTexture(s.hlTex); }
  // Fibers: FIBER_FLOATS per curve segment, plus a highlight per segment (0 hidden, 1 normal, up to 2 lit, 3 focus).
  // Links at two levels of detail (0 smooth, 1 straight while the camera moves).
  setFibers(data, hl, level = 0) {
    this.fibers = this.fibers || [];
    this._drop(this.fibers[level]);
    this.fibers[level] = this._store(data, FIBER_FLOATS, hl);
    this.counts.fibers = this.fibers[0] ? this.fibers[0].count : 0;
  }
  updateFibers(hl, level = 0) { this._hl(this.fibers[level], hl); }
  // Other fiber layers: dendrites, tracts (cached) and the active neurons (every frame).
  setLayer(name, data, hl) {
    this._drop(this.layers[name]);
    this.layers[name] = data.length ? this._store(data, FIBER_FLOATS, hl) : null;
  }
  updateLayer(name, hl) { if (this.layers[name]) this._hl(this.layers[name], hl); }
  // Beams: rewritten every frame while agents travel.
  setBeams(data) {
    this._drop(this.beams);
    const n = data.length / FIBER_FLOATS;
    this.beams = n ? this._store(data, FIBER_FLOATS, new Float32Array(n).fill(1)) : null;
    this.counts.beams = n;
  }

  // Sprites: SPRITE_FLOATS per point, rewritten when they change.
  setSprites(data) {
    const gl = this.gl;
    if (!this.vao.sprite) {
      this.vao.sprite = gl.createVertexArray();
      gl.bindVertexArray(this.vao.sprite);
      this.buf.sprite = this._buffer(data, gl.DYNAMIC_DRAW);
      this._layout(this.sprite, this.buf.sprite, [['a_pos', 3], ['a_size', 1], ['a_color', 4], ['a_mode', 1]]);
      gl.bindVertexArray(null);
    } else { gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.sprite); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW); }
    this.counts.sprites = data.length / SPRITE_FLOATS;
  }
  // The shell's points: { pos, nrm, part, ranges ("lobe|side" → [start, count]) }: the junctions, and each lobe's glow.
  setDust(shell) {
    const gl = this.gl, n = shell.pos.length / 3, data = new Float32Array(n * 7);
    for (let i = 0; i < n; i++) { data.set(shell.pos.subarray(i * 3, i * 3 + 3), i * 7); data.set(shell.nrm.subarray(i * 3, i * 3 + 3), i * 7 + 3); data[i * 7 + 6] = shell.part[i]; }
    this.vao.dust = gl.createVertexArray();
    gl.bindVertexArray(this.vao.dust);
    this._layout(this.dust, this._buffer(data, gl.STATIC_DRAW), [['a_pos', 3], ['a_nrm', 3], ['a_part', 1]]);
    gl.bindVertexArray(null);
    this.dustRanges = shell.ranges;
    this.counts.dust = n;
  }
  // The shell's filaments: { data (FIL_FLOATS each), ranges }.
  setFilaments(f) {
    this.fil = this._store(f.data, FIL_FLOATS);
    this.counts.filaments = this.fil.count;
  }
  _shellCommon(prog, view) {
    const gl = this.gl, L = prog.loc, P = this.palette;
    this._common(prog, view);
    gl.uniform3f(L.u_eye, ...view.eye);
    gl.uniform1f(L.u_edge, P.dustEdge);
    gl.uniform1f(L.u_cut, view.cut || 0);
    gl.uniform1f(L.u_back, view.cut ? 0.4 : 0.04);
  }
  // All strands in one draw call: curved, or straight while the camera moves.
  _filaments(view, straight) {
    const gl = this.gl, L = this.filProg.loc, P = this.palette, s = this.fil;
    this._shellCommon(this.filProg, view);
    gl.uniform2f(L.u_half, this.canvas.width / 2, this.canvas.height / 2);
    gl.uniform1f(L.u_dpr, this.dpr);
    gl.uniform1f(L.u_width, P.filWidth);
    gl.uniform1f(L.u_alpha, P.filAlpha);
    gl.uniform1f(L.u_step, straight ? 1 : 0.5);
    gl.uniform3f(L.u_color, ...P.dust);
    gl.uniform3f(L.u_tint, ...P.dustTint);
    gl.uniform3f(L.u_cbl, ...P.filCbl);
    gl.uniform3f(L.u_stem, ...P.filStem);
    gl.uniform1i(L.u_verts, straight ? 6 : 12);
    this._bindStore(L, s);
    gl.drawArrays(gl.TRIANGLES, 0, s.count * (straight ? 6 : 12));
  }
  // ranges: [[start, count]] (null: all); the glow draws a lobe's points, brighter and tinted.
  _dust(view, ranges, alpha, color) {
    const gl = this.gl, L = this.dust.loc, P = this.palette;
    this._shellCommon(this.dust, view);
    gl.uniform1f(L.u_size, P.dustSize);
    gl.uniform1f(L.u_alpha, alpha);
    gl.uniform3f(L.u_color, ...color);
    gl.bindVertexArray(this.vao.dust);
    for (const [start, count] of ranges || [[0, this.counts.dust]]) gl.drawArrays(gl.POINTS, start, count);
  }

  resize(w, h, dpr) {
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    this.w = w; this.h = h; this.dpr = dpr;
  }
  // An offscreen color target (texture + framebuffer) at the canvas size; true when it was (re)made.
  _target(name) {
    const gl = this.gl, W = this.canvas.width, H = this.canvas.height;
    let t = this.targets[name];
    if (t && t.w === W && t.h === H) return false;
    if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
    t = this.targets[name] = { w: W, h: H, tex: gl.createTexture(), fb: gl.createFramebuffer() };
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, W, H);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return true;
  }
  _blit(from, to) {
    const gl = this.gl, W = this.canvas.width, H = this.canvas.height;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, from);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, to);
    gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, to);
  }
  _common(prog, view) {
    const gl = this.gl, L = prog.loc;
    gl.useProgram(prog.p);
    if (L.u_vp) gl.uniformMatrix4fv(L.u_vp, false, view.vp);
    if (L.u_px) gl.uniform1f(L.u_px, view.px * this.dpr);
    if (L.u_depth) gl.uniform2f(L.u_depth, view.depth[0], view.depth[1]);
    if (L.u_proj) gl.uniform1fv(L.u_proj, view.proj);
    if (L.u_intro) gl.uniform4fv(L.u_intro, view.intro);
    if (L.u_yr) gl.uniform2fv(L.u_yr, view.yr);
    if (L.u_center) gl.uniform3fv(L.u_center, view.center);
    if (L.u_mode) gl.uniform1f(L.u_mode, view.mode || 0);
  }
  // A store's textures on units 2 and 3; drawn with no attributes (the empty VAO).
  _bindStore(L, s, base = 0) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, s.tex);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, s.hlTex || s.tex);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(L.u_data, 2);
    if (L.u_hlt) gl.uniform1i(L.u_hlt, 3);
    gl.uniform1i(L.u_base, base);
    gl.bindVertexArray(this.vao.bg);
  }
  _fibers(view, s, count = s.count) {
    const gl = this.gl, P = this.palette, L = this.fiber.loc;
    this._common(this.fiber, view);
    gl.uniform2f(L.u_half, this.canvas.width / 2, this.canvas.height / 2);
    gl.uniform1f(L.u_dpr, this.dpr);
    gl.uniform1fv(L.u_alpha, P.edgeAlpha);
    gl.uniform3f(L.u_hlColor, ...P.accent);
    this._bindStore(L, s);
    gl.drawArrays(gl.TRIANGLES, 0, count * 6);
  }
  _ground(prog) {
    const gl = this.gl, L = prog.loc, P = this.palette;
    gl.uniform3f(L.u_edge, ...P.bg);
    gl.uniform3f(L.u_center, ...P.bgCenter);
    gl.uniform2f(L.u_size, this.w, this.h);
    gl.uniform1f(L.u_dpr, this.dpr);
    gl.bindVertexArray(this.vao.bg);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  // The cached layers. deep: shell, dendrites, tracts (not during the intro: they have their own timing); main: haze
  // and links. lod 1 (moving): straight strands and links.
  _deep(view, lod, intro, skip) {
    if (this.counts.filaments && !skip.has('dust')) this._filaments(view, lod === 1);
    if (this.counts.dust && !skip.has('dust')) this._dust(view, null, this.palette.dustAlpha, this.palette.dust);
    const d = this.layers.dendrites, t = this.layers.tracts;
    if (d && !skip.has('dendrites')) this._fibers(view, d);
    if (t && !skip.has('tracts') && !intro) this._fibers(view, t);
  }
  _main(view, lod, haze, skip) {
    const gl = this.gl;
    if (haze && !skip.has('haze')) { this._common(this.sprite, view); gl.bindVertexArray(this.vao.sprite); gl.drawArrays(gl.POINTS, 0, haze); }
    const f = this.fibers && (this.fibers[lod] || this.fibers[0]);
    if (f && f.count && !skip.has('fibers')) this._fibers(view, f);
  }

  // view: { vp, px (pixels per world unit at distance 1), time (s), ripples: [{p, t, c}], proj, depth: [near, far],
  //   eye, intro: [clock, wave1, wave2, 0], yr (the parts' heights), center, cut (0, or the cut-away side),
  //   mid: the brain's center on screen (CSS px), radiusPx: its radius on screen }
  // layers: { deepKey, mainKey, lod (0 full, 1 moving), haze (haze sprites at the start of the sprite buffer),
  //   glow: [{ range, strength, color }], introOn, skip }
  draw(view, layers) {
    const gl = this.gl, lod = layers.lod || 0, haze = layers.haze || 0, skip = layers.skip || new Set(), intro = !!layers.introOn;
    const W = this.canvas.width, H = this.canvas.height;
    gl.viewport(0, 0, W, H);
    const still = { ...view, intro: STILL };
    const fresh = this._target('deep') | this._target('main') | (intro && this._target('reveal'));
    const deepStale = fresh || layers.deepKey !== this.deepKey || lod !== this.deepLod || intro !== this.deepIntro;
    if (deepStale) {
      this.deepKey = layers.deepKey; this.deepLod = lod; this.deepIntro = intro;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets.deep.fb);
      gl.disable(gl.BLEND);
      if (intro) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); } // the intro adds the ground itself
      else { gl.useProgram(this.bg.p); this._ground(this.bg); }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      this._deep(still, lod, intro, skip);
    }
    if (deepStale || layers.mainKey !== this.mainKey) {
      this.mainKey = layers.mainKey;
      this.staticDraws = (this.staticDraws || 0) + 1;
      this._blit(this.targets.deep.fb, this.targets.main.fb);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      this._main(still, lod, haze, skip);
      if (intro) { // when the wave reaches each pixel: the earliest of what lights it
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets.reveal.fb);
        gl.clearColor(1, 1, 1, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.blendEquation(gl.MIN);
        const rv = { ...still, mode: 1 };
        this._deep(rv, lod, true, skip);
        this._main(rv, lod, haze, skip);
        gl.blendEquation(gl.FUNC_ADD);
      }
      gl.clearColor(0, 0, 0, 1);
    }
    // Chrome clears a presented WebGL back buffer lazily, at the next draw or clear call, and a blit doesn't count:
    // clear first, or the first draw below would wipe the copied cache.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (intro) {
      gl.disable(gl.BLEND);
      const L = this.comp.loc;
      gl.useProgram(this.comp.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.targets.main.tex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.targets.reveal.tex);
      gl.uniform1i(L.u_cache, 0); gl.uniform1i(L.u_reveal, 1);
      gl.uniform1f(L.u_clock, view.intro[0]);
      const k = this.dpr * view.radiusPx / view.waveR; // world → device px, for the closing wave
      gl.uniform2f(L.u_wave, view.intro[1] * k, Math.max(8, 0.16 * k));
      gl.uniform2f(L.u_mid, view.mid[0] * this.dpr, H - view.mid[1] * this.dpr);
      this._ground(this.comp);
      gl.activeTexture(gl.TEXTURE0);
    } else this._blit(this.targets.main.fb, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    const t = this.layers.tracts;
    if (intro && t && !skip.has('tracts')) this._fibers(view, t); // lit last, with their own clock
    // Where agents work, the shell's points around their lobe brighten softly (layers.glow).
    if (this.counts.dust && layers.glow) for (const g of layers.glow) if (g.strength > 0.01) this._dust(view, [g.range], this.palette.dustAlpha * 3 * g.strength, g.color);
    const a = this.layers.active; // active neurons: full detail, every frame
    if (a) this._fibers(view, a);
    this._common(this.node, view);
    const L = this.node.loc;
    gl.uniform1f(L.u_time, view.time);
    gl.uniform1f(L.u_life, view.life || 0);
    gl.uniform3fv(L.u_kind, this.palette.kinds);
    const rip = new Float32Array(16).fill(-99), ripC = new Float32Array(12);
    (view.ripples || []).slice(-4).forEach((r, i) => { rip.set([...r.p, r.t], i * 4); ripC.set(r.c, i * 3); });
    gl.uniform4fv(L.u_rip, rip);
    gl.uniform3fv(L.u_ripColor, ripC);
    gl.bindVertexArray(this.vao.node);
    if (!skip.has('nodes')) gl.drawArrays(gl.POINTS, 0, this.counts.nodes);
    if (this.beams) this._fibers(view, this.beams);
    if (this.counts.sprites > haze) { this._common(this.sprite, view); gl.bindVertexArray(this.vao.sprite); gl.drawArrays(gl.POINTS, haze, this.counts.sprites - haze); }
    gl.bindVertexArray(null);
  }
}

// ---- tiny matrix helpers (column-major, like WebGL) ----
export function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
export function multiply(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
// Camera orbiting `target` at `dist`, yaw around y, pitch around x. Returns the view matrix and the camera basis.
export function orbitView(target, dist, yaw, pitch) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const eye = [target[0] + dist * sy * cp, target[1] + dist * sp, target[2] + dist * cy * cp];
  const z = [eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]].map((v) => v / dist);
  let x = [z[2], 0, -z[0]];
  const xl = Math.hypot(...x) || 1;
  x = x.map((v) => v / xl);
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const m = new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
  return Object.assign(m, { eye, x, y, z });
}
