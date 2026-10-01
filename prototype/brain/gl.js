// WebGL2 renderer for the brain. A handful of draw calls, all additive light:
// - ground: radial night, vignette and a sparse static starfield (decoration, drawn in screen space);
// - dust: the particle shell of the brain (decoration);
// - haze: soft region and lobe glows;
// - fibers: links as curved, glowing ribbons (instanced quads, one per curve segment); agent beams reuse them;
// - nodes: neuron sprites (shape by type, short dendrites, halo, ignition flash, think ripples, depth fog);
// - sprites on top: agent heads, rings.
// Static layers (ground to fibers) are drawn once into a cache and only redrawn when layers.staticKey changes;
// each animation frame copies the cache and draws nodes, beams and sprites on top.

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
export const EDGE = { link: 0, index: 1, import: 2, cites: 3, cochange: 4, readfirst: 5, midline: 6, beam: 7 };
export const SPRITE = { glow: 0, ring: 1, head: 2, dust: 3 };
export const NODE_FLOATS = 10; // x y z size shape project r g b seed
export const FIBER_FLOATS = 20; // p0(3) p1(3) t0 t1 c0(3) c1(3) type width core alpha project spare
export const SPRITE_FLOATS = 9; // x y z size r g b a mode

const DEPTH = `float farOf(float w) { return clamp((w - u_depth.x) / (u_depth.y - u_depth.x), 0.0, 1.0); }`;

export const BG_VS = `#version 300 es
out vec2 v_uv;
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); v_uv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
export const BG_FS = `#version 300 es
precision highp float;
in vec2 v_uv; uniform vec3 u_edge, u_center; uniform vec2 u_size; uniform float u_dpr;
out vec4 o;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 q = (v_uv - vec2(0.5, 0.52)) * vec2(u_size.x / u_size.y, 1.0);
  float r = length(q);
  vec3 col = mix(u_center, u_edge, smoothstep(0.0, 0.75, r / 0.85));
  col *= 1.0 - smoothstep(0.5, 1.3, r) * 0.6; // vignette
  // A sparse, dim, static starfield: one candidate per 6 px cell. Decoration, never data.
  vec2 px = gl_FragCoord.xy / u_dpr, cell = floor(px / 6.0);
  float h = hash(cell);
  if (h > 0.986) {
    vec2 c = (cell + vec2(hash(cell + 1.7), hash(cell + 3.1)) * 0.8 + 0.1) * 6.0;
    col += vec3(0.72, 0.70, 0.86) * ((h - 0.986) / 0.014) * 0.32 * smoothstep(1.2, 0.0, length(px - c));
  }
  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  o = vec4(col, 1.0);
}`;

export const NODE_VS = `#version 300 es
in vec3 a_pos; in float a_size, a_shape, a_proj; in vec3 a_color; in float a_seed; in vec4 a_state;
uniform mat4 u_vp; uniform float u_time, u_px; uniform vec2 u_depth; uniform float u_proj[32];
uniform vec4 u_rip[4]; uniform vec3 u_ripColor[4]; uniform vec3 u_kind[6];
out vec3 v_color, v_flash; out float v_alpha, v_shape, v_seed, v_px, v_white;
${DEPTH}
void main() {
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
  vec3 col = a_color * a_state.x * pf;
  col = mix(col, vec3(dot(col, vec3(0.3, 0.59, 0.11))), far * 0.55); // far: desaturated...
  v_color = col * (1.0 - far * 0.5) + rip;                           // ...and dimmer
  v_flash = u_kind[int(a_state.w)] * flash;
  v_white = clamp(a_state.y * 0.75 + flash, 0.0, 1.0);
  v_alpha = vis * (1.0 - far * 0.45);
  v_shape = a_shape;
  v_seed = a_seed;
  float px = vis * min(a_size * (1.0 + 1.0 * flash + 0.3 * a_state.y) * u_px / p.w, 220.0);
  v_px = px;
  gl_PointSize = px;
}`;
export const NODE_FS = `#version 300 es
precision mediump float;
in vec3 v_color, v_flash; in float v_alpha, v_shape, v_seed, v_px, v_white;
out vec4 o;
float sdf(vec2 q, float s) {
  q /= 0.27;
  if (s < 0.5) return length(q) - 1.0;
  if (s < 1.5) return (abs(q.x) + abs(q.y)) * 0.8 - 1.0;
  if (s < 2.5) { q.y = -q.y - 0.25; return max(abs(q.x) * 0.866 + q.y * 0.5, -q.y) - 0.62; }
  if (s < 3.5) return max(abs(q.x), abs(q.y)) - 0.85;
  return abs(length(q) - 0.82) - 0.26;
}
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  if (dot(q, q) > 1.0) discard;
  float d = sdf(q, v_shape);
  float w = max(fwidth(d), 0.02);
  float core = 1.0 - smoothstep(-w, w, d);
  float halo = exp(-dot(q, q) * 5.5) * 0.34;
  // A few short dendrites, fixed per node by its seed; only drawn when the sprite is big enough to read them.
  float den = 0.0;
  if (v_px > 10.0 && dot(q, q) < 0.9) {
    float lw = 1.3 / v_px; // ~0.65 px half-width in sprite units (one pixel is 2 / v_px)
    for (int i = 0; i < 4; i++) {
      float a = v_seed * 6.2831 + float(i) * (1.55 + v_seed * 0.6);
      vec2 dir = vec2(cos(a), sin(a));
      float t = dot(q, dir);
      float len = 0.5 + 0.42 * fract(v_seed * 7.13 + float(i) * 0.37);
      float perp = abs(q.x * dir.y - q.y * dir.x);
      den = max(den, (1.0 - smoothstep(lw, lw * 2.2, perp)) * smoothstep(0.14, 0.22, t) * (1.0 - smoothstep(len * 0.55, len, t)));
    }
    den *= smoothstep(10.0, 16.0, v_px) * 0.55;
  }
  vec3 coreCol = mix(v_color * 1.45, vec3(1.0), v_white * 0.9 + 0.06) + v_flash;
  vec3 col = coreCol * core + v_color * (den + halo) + v_flash * halo * 1.4;
  float a = (core + den + halo) * v_alpha;
  if (a < 0.004) discard;
  o = vec4(col * v_alpha, 0.0);
}`;

export const FIBER_VS = `#version 300 es
in vec3 a_p0, a_p1; in vec2 a_t; in vec3 a_c0, a_c1; in vec4 a_info; in vec2 a_meta; in float a_hl;
uniform mat4 u_vp; uniform vec2 u_half; uniform vec2 u_depth; uniform float u_dpr;
uniform float u_alpha[8]; uniform float u_proj[32]; uniform vec3 u_hlColor;
out vec3 v_color; out float v_alpha, v_side, v_t, v_core, v_dash;
${DEPTH}
void main() {
  bool tail = gl_VertexID < 2;
  float side = (gl_VertexID == 1 || gl_VertexID == 3) ? 1.0 : -1.0;
  vec4 c0 = u_vp * vec4(a_p0, 1.0), c1 = u_vp * vec4(a_p1, 1.0);
  vec4 c = tail ? c0 : c1;
  vec2 dv = (c1.xy / c1.w - c0.xy / c0.w) * u_half;
  float len = length(dv);
  vec2 dir = len > 1e-4 ? dv / len : vec2(1.0, 0.0);
  c.xy += vec2(-dir.y, dir.x) * side * a_info.y * u_dpr * 0.5 / u_half * c.w;
  gl_Position = c;
  int type = int(a_info.x);
  float pf = a_meta.x < 0.0 ? 1.0 : u_proj[int(a_meta.x)];
  float alpha = a_info.w > 0.0 ? a_info.w : u_alpha[type] * a_hl * pf * pf;
  vec3 col = tail ? a_c0 : a_c1;
  if (a_hl > 2.5) { col = mix(col, u_hlColor, 0.45); alpha = 0.6; }
  float far = farOf(c.w);
  col = mix(col, vec3(dot(col, vec3(0.3, 0.59, 0.11))), far * 0.55);
  v_color = col;
  v_alpha = alpha * (1.0 - far * 0.6) * step(0.05, min(c0.w, c1.w));
  v_side = side;
  v_t = tail ? a_t.x : a_t.y;
  v_core = a_info.z;
  v_dash = type == 4 && a_hl < 2.5 ? 1.0 : 0.0;
}`;
export const FIBER_FS = `#version 300 es
precision mediump float;
in vec3 v_color; in float v_alpha, v_side, v_t, v_core, v_dash;
out vec4 o;
void main() {
  if (v_dash > 0.5 && fract(v_t * 45.0) > 0.5) discard;
  float d = abs(v_side);
  float core = exp(-d * d * 14.0), glow = v_core > 0.5 ? exp(-d * d * 2.2) * 0.8 : exp(-d * d * 3.0) * 0.45;
  vec3 col = v_core > 0.5 ? mix(v_color, vec3(1.0), exp(-d * d * 22.0)) : v_color;
  float a = (core * 0.85 + glow) * v_alpha;
  if (a < 0.003) discard;
  o = vec4(col * a, 0.0);
}`;

export const SPRITE_VS = `#version 300 es
in vec3 a_pos; in float a_size; in vec4 a_color; in float a_mode;
uniform mat4 u_vp; uniform float u_px; uniform vec2 u_depth;
out vec4 v_color; out float v_mode;
${DEPTH}
void main() {
  vec4 p = u_vp * vec4(a_pos, 1.0);
  gl_Position = p;
  v_color = vec4(a_color.rgb, a_color.a * (1.0 - farOf(p.w) * 0.6));
  v_mode = a_mode;
  gl_PointSize = clamp(a_size * u_px / p.w, a_mode > 2.5 ? 1.6 : 0.0, 420.0);
}`;
export const SPRITE_FS = `#version 300 es
precision mediump float;
in vec4 v_color; in float v_mode;
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
  o = vec4(col * a, 0.0);
}`;

// The shell: a quiet backdrop. Brightest where it faces the camera, fading out toward the rim, almost gone behind,
// so the folds read as texture and the outline is felt more than seen.
export const DUST_VS = `#version 300 es
in vec3 a_pos; in vec3 a_nrm;
uniform mat4 u_vp; uniform float u_px, u_size, u_alpha; uniform vec3 u_eye, u_color;
out vec4 v_color;
void main() {
  vec4 p = u_vp * vec4(a_pos, 1.0);
  gl_Position = p;
  float f = dot(a_nrm, normalize(u_eye - a_pos));
  float k = f > 0.0 ? 0.1 + 0.9 * smoothstep(0.0, 0.65, f) : 0.04;
  v_color = vec4(u_color, u_alpha * k);
  gl_PointSize = clamp(u_size * u_px / p.w, 1.0, 6.0);
}`;
export const DUST_FS = `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 o;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q), a = exp(-r2 * 3.5) * v_color.a * step(r2, 1.0);
  if (a < 0.002) discard;
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
    this.node = program(gl, NODE_VS, NODE_FS);
    this.fiber = program(gl, FIBER_VS, FIBER_FS);
    this.sprite = program(gl, SPRITE_VS, SPRITE_FS);
    this.dust = program(gl, DUST_VS, DUST_FS);
    this.vao = { bg: gl.createVertexArray() };
    this.buf = {};
    this.counts = { nodes: 0, fibers: 0, beams: 0, dust: 0, sprites: 0 };
  }

  // Interleaved attributes: [name, size] in order; `divisor` 1 for per-instance data.
  _layout(prog, buf, fields, divisor = 0) {
    const gl = this.gl, stride = fields.reduce((s, f) => s + f[1], 0) * 4;
    let off = 0;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    for (const [name, size] of fields) {
      const l = prog.loc[name];
      if (l !== undefined && l >= 0) {
        gl.enableVertexAttribArray(l);
        gl.vertexAttribPointer(l, size, gl.FLOAT, false, stride, off);
        gl.vertexAttribDivisor(l, divisor);
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
    this._layout(this.node, this.buf.node, [['a_pos', 3], ['a_size', 1], ['a_shape', 1], ['a_proj', 1], ['a_color', 3], ['a_seed', 1]]);
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

  // Fibers: FIBER_FLOATS per curve segment, plus a highlight per segment (0 hidden, 1 normal, up to 2 lit, 3 focus).
  _fiberVao(data, hl, usage) {
    const gl = this.gl, vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const b = this._buffer(data, usage);
    this._layout(this.fiber, b, [['a_p0', 3], ['a_p1', 3], ['a_t', 2], ['a_c0', 3], ['a_c1', 3], ['a_info', 4], ['a_meta', 2]], 1);
    const h = this._buffer(hl, usage);
    this._layout(this.fiber, h, [['a_hl', 1]], 1);
    gl.bindVertexArray(null);
    return { vao, b, h };
  }
  // Fibers at two levels of detail (0 smooth, 1 coarse while the camera moves).
  setFibers(data, hl, level = 0) {
    this.fibers = this.fibers || [];
    if (this.fibers[level]) this.gl.deleteVertexArray(this.fibers[level].vao);
    this.fibers[level] = { ...this._fiberVao(data, hl, this.gl.STATIC_DRAW), count: hl.length };
    this.counts.fibers = this.fibers[0] ? this.fibers[0].count : 0;
  }
  updateFibers(hl, level = 0) { const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.fibers[level].h); gl.bufferSubData(gl.ARRAY_BUFFER, 0, hl); }
  // Beams: the same layout, rewritten every frame while agents travel.
  setBeams(data) {
    const gl = this.gl, n = data.length / FIBER_FLOATS;
    if (!this.vao.beam) { const f = this._fiberVao(new Float32Array(FIBER_FLOATS * 64), new Float32Array(64).fill(1), gl.DYNAMIC_DRAW); this.vao.beam = f.vao; this.buf.beam = f.b; this.beamCap = 64; }
    if (n > this.beamCap) { gl.deleteVertexArray(this.vao.beam); this.beamCap = n * 2; const f = this._fiberVao(new Float32Array(FIBER_FLOATS * this.beamCap), new Float32Array(this.beamCap).fill(1), gl.DYNAMIC_DRAW); this.vao.beam = f.vao; this.buf.beam = f.b; }
    if (n) { gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.beam); gl.bufferSubData(gl.ARRAY_BUFFER, 0, data); }
    this.counts.beams = n;
  }

  // Sprites: SPRITE_FLOATS per point. Dust is static (the shell); the rest is rewritten when it changes.
  _spriteVao(data, usage) {
    const gl = this.gl, vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const b = this._buffer(data, usage);
    this._layout(this.sprite, b, [['a_pos', 3], ['a_size', 1], ['a_color', 4], ['a_mode', 1]]);
    gl.bindVertexArray(null);
    return { vao, b };
  }
  // The shell: { pos, nrm, ranges ("lobe|side" → [start, count]) }, drawn range by range.
  setDust(shell) {
    const gl = this.gl, n = shell.pos.length / 3, data = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) { data.set(shell.pos.subarray(i * 3, i * 3 + 3), i * 6); data.set(shell.nrm.subarray(i * 3, i * 3 + 3), i * 6 + 3); }
    this.vao.dust = gl.createVertexArray();
    gl.bindVertexArray(this.vao.dust);
    this._layout(this.dust, this._buffer(data, gl.STATIC_DRAW), [['a_pos', 3], ['a_nrm', 3]]);
    gl.bindVertexArray(null);
    this.dustRanges = shell.ranges;
    this.counts.dust = n;
  }
  // ranges: [[start, count]]; alpha and color per call; half: every other point of each range (while moving).
  _dust(view, ranges, alpha, color, half) {
    const gl = this.gl, L = this.dust.loc, P = this.palette;
    this._common(this.dust, view);
    gl.uniform3f(L.u_eye, ...view.eye);
    gl.uniform1f(L.u_size, P.dustSize);
    gl.uniform1f(L.u_alpha, alpha * (half ? 2 : 1));
    gl.uniform3f(L.u_color, ...color);
    gl.bindVertexArray(this.vao.dust);
    for (const [start, count] of ranges) gl.drawArrays(gl.POINTS, start, half ? Math.ceil(count / 2) : count);
  }
  setSprites(data) {
    const gl = this.gl;
    if (!this.vao.sprite) { const s = this._spriteVao(data, gl.DYNAMIC_DRAW); this.vao.sprite = s.vao; this.buf.sprite = s.b; }
    else { gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.sprite); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW); }
    this.counts.sprites = data.length / SPRITE_FLOATS;
  }

  resize(w, h, dpr) {
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    this.w = w; this.h = h; this.dpr = dpr;
  }
  _cache() {
    const gl = this.gl, W = this.canvas.width, H = this.canvas.height;
    if (this.tw === W && this.th === H) return;
    this.tw = W; this.th = H; this.cacheKey = undefined;
    if (this.cacheRb) { gl.deleteRenderbuffer(this.cacheRb); gl.deleteFramebuffer(this.cacheFb); }
    this.cacheRb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.cacheRb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, W, H);
    this.cacheFb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.cacheFb);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.cacheRb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  _common(prog, view) {
    const gl = this.gl, L = prog.loc;
    gl.useProgram(prog.p);
    if (L.u_vp) gl.uniformMatrix4fv(L.u_vp, false, view.vp);
    if (L.u_px) gl.uniform1f(L.u_px, view.px * this.dpr);
    if (L.u_depth) gl.uniform2f(L.u_depth, view.depth[0], view.depth[1]);
    if (L.u_proj) gl.uniform1fv(L.u_proj, view.proj);
  }
  _fibers(view, vao, count) {
    const gl = this.gl, P = this.palette, L = this.fiber.loc;
    this._common(this.fiber, view);
    gl.uniform2f(L.u_half, this.canvas.width / 2, this.canvas.height / 2);
    gl.uniform1f(L.u_dpr, this.dpr);
    gl.uniform1fv(L.u_alpha, P.edgeAlpha);
    gl.uniform3f(L.u_hlColor, ...P.accent);
    gl.bindVertexArray(vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
  }

  // view: { vp, px (pixels per world unit at distance 1), time (s), ripples: [{p, t, c}], proj, depth: [near, far] }
  // layers: { haze (haze sprites at the start of the sprite buffer), staticKey }
  draw(view, layers) {
    const gl = this.gl, P = this.palette;
    this._cache();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const haze = layers.haze || 0;
    if (layers.staticKey == null || layers.staticKey !== this.cacheKey || (layers.lod || 0) !== this.cacheLod) {
      this.cacheKey = layers.staticKey;
      this.staticDraws = (this.staticDraws || 0) + 1;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.cacheFb);
      gl.disable(gl.BLEND);
      gl.useProgram(this.bg.p);
      gl.uniform3f(this.bg.loc.u_edge, ...P.bg);
      gl.uniform3f(this.bg.loc.u_center, ...P.bgCenter);
      gl.uniform2f(this.bg.loc.u_size, this.w, this.h);
      gl.uniform1f(this.bg.loc.u_dpr, this.dpr);
      gl.bindVertexArray(this.vao.bg);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      const skip = layers.skip || new Set();
      // While the camera moves, half of each (shuffled) range of the shell, twice as bright.
      if (this.counts.dust && !skip.has('dust')) this._dust(view, this.dustRanges.values(), P.dustAlpha, P.dust, (layers.lod || 0) > 0);
      if (haze && !skip.has('haze')) { this._common(this.sprite, view); gl.bindVertexArray(this.vao.sprite); gl.drawArrays(gl.POINTS, 0, haze); }
      const f = this.fibers && (this.fibers[layers.lod || 0] || this.fibers[0]);
      if (f && f.count && !skip.has('fibers')) this._fibers(view, f.vao, f.count);
      this.cacheLod = layers.lod || 0;
    }
    // Chrome clears a presented WebGL back buffer lazily, at the next draw or clear call, and a blit doesn't count:
    // clear first, or the first draw below would wipe the copied cache.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.cacheFb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, this.tw, this.th, 0, 0, this.tw, this.th, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    // Where agents work, the shell around their lobe brightens softly (layers.glow: [{ range, strength, color }]).
    if (this.counts.dust && layers.glow) for (const g of layers.glow) if (g.strength > 0.01) this._dust(view, [g.range], P.dustAlpha * 1.6 * g.strength, g.color, false);
    this._common(this.node, view);
    const L = this.node.loc;
    gl.uniform1f(L.u_time, view.time);
    gl.uniform3fv(L.u_kind, P.kinds);
    const rip = new Float32Array(16).fill(-99), ripC = new Float32Array(12);
    (view.ripples || []).slice(-4).forEach((r, i) => { rip.set([...r.p, r.t], i * 4); ripC.set(r.c, i * 3); });
    gl.uniform4fv(L.u_rip, rip);
    gl.uniform3fv(L.u_ripColor, ripC);
    gl.bindVertexArray(this.vao.node);
    if (!(layers.skip && layers.skip.has('nodes'))) gl.drawArrays(gl.POINTS, 0, this.counts.nodes);
    if (this.counts.beams) this._fibers(view, this.vao.beam, this.counts.beams);
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
