// WebGL2 renderer for the brain: everything is a handful of draw calls. Nodes are point sprites (shape by type,
// soft halo, ignition flash and think ripples computed in the shader from a time uniform), edges are 1 px lines
// (dashed when statistical), plus the silhouette, region haze, comets and rings. Additive blending makes the glow.

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
export const EDGE = { link: 0, index: 1, import: 2, cites: 3, cochange: 4, readfirst: 5, fissure: 6, profile: 7 };

export const NODE_VS = `#version 300 es
in vec3 a_pos; in float a_size; in float a_shape; in float a_proj; in vec4 a_state;
uniform mat4 u_vp; uniform float u_time, u_px; uniform float u_proj[32];
uniform vec4 u_rip[4]; uniform vec3 u_ripColor[4];
uniform vec3 u_kind[6]; uniform vec3 u_base;
out vec3 v_color; out float v_alpha, v_shape;
void main() {
  vec4 p = u_vp * vec4(a_pos, 1.0);
  gl_Position = p;
  float far = clamp((p.w - 2.7) / 1.0, 0.0, 1.0);
  float dt = u_time - a_state.z;
  float flash = dt >= 0.0 && dt < 3.0 ? exp(-dt * 2.6) : 0.0;
  vec3 rip = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    float rt = u_time - u_rip[i].w;
    if (rt > 0.0 && rt < 2.4) {
      float d = distance(a_pos, u_rip[i].xyz);
      float w = (d - rt * 0.18) / 0.05;
      rip += u_ripColor[i] * exp(-w * w) * (1.0 - rt / 2.4) * 1.4;
    }
  }
  float vis = step(0.001, a_state.x);
  float pf = a_proj < 0.0 ? 1.0 : u_proj[int(a_proj)];
  v_color = u_base * a_state.x * pf + u_kind[int(a_state.w)] * (a_state.y * 0.85 + flash * 1.6) + rip;
  v_alpha = mix(1.0, 0.5, far) * vis;
  v_shape = a_shape;
  gl_PointSize = vis * min(a_size * (1.0 + 1.3 * flash) * u_px / p.w, 160.0);
}`;
export const NODE_FS = `#version 300 es
precision mediump float;
in vec3 v_color; in float v_alpha, v_shape;
out vec4 o;
float sdf(vec2 q, float s) {
  q /= 0.36;
  if (s < 0.5) return length(q) - 1.0;
  if (s < 1.5) return (abs(q.x) + abs(q.y)) * 0.8 - 1.0;
  if (s < 2.5) { q.y = -q.y - 0.25; return max(abs(q.x) * 0.866 + q.y * 0.5, -q.y) - 0.62; }
  if (s < 3.5) return max(abs(q.x), abs(q.y)) - 0.85;
  return abs(length(q) - 0.82) - 0.26;
}
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d = sdf(q, v_shape);
  float w = max(fwidth(d), 0.02);
  float core = 1.0 - smoothstep(-w, w, d);
  float r2 = dot(q, q);
  float halo = exp(-r2 * 8.0) * 0.42;
  float a = (core * 0.9 + halo) * v_alpha;
  if (a < 0.004) discard;
  o = vec4(v_color * a, a);
}`;

export const LINE_VS = `#version 300 es
in vec3 a_pos; in float a_dist; in float a_type; in float a_proj; in float a_hl;
uniform mat4 u_vp; uniform float u_proj[32]; uniform vec3 u_edge[8]; uniform float u_alpha[8]; uniform vec3 u_hlColor;
out vec3 v_color; out float v_dist, v_dash;
void main() {
  vec4 p = u_vp * vec4(a_pos, 1.0);
  gl_Position = p;
  int t = int(a_type);
  float far = clamp((p.w - 2.7) / 1.0, 0.0, 1.0);
  float hl = a_hl;
  float pf = a_proj < 0.0 ? 1.0 : u_proj[int(a_proj)];
  float alpha = hl > 1.5 ? 0.55 : u_alpha[t] * hl * pf * pf;
  vec3 c = hl > 1.5 ? u_hlColor : u_edge[t];
  v_color = c * alpha * mix(1.0, 0.45, far);
  v_dist = a_dist;
  v_dash = t == 4 && hl < 1.5 ? 1.0 : 0.0;
}`;
export const LINE_FS = `#version 300 es
precision mediump float;
in vec3 v_color; in float v_dist, v_dash;
out vec4 o;
void main() {
  if (v_dash > 0.5 && fract(v_dist * 55.0) > 0.55) discard;
  o = vec4(v_color, 0.0);
}`;

export const SPRITE_VS = `#version 300 es
in vec3 a_pos; in float a_size; in vec4 a_color; in float a_ring;
uniform mat4 u_vp; uniform float u_px;
out vec4 v_color; out float v_ring;
void main() {
  vec4 p = u_vp * vec4(a_pos, 1.0);
  gl_Position = p;
  v_color = a_color; v_ring = a_ring;
  gl_PointSize = min(a_size * u_px / p.w, 512.0);
}`;
export const SPRITE_FS = `#version 300 es
precision mediump float;
in vec4 v_color; in float v_ring;
out vec4 o;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = length(q);
  float a = v_ring > 0.5 ? exp(-pow((r - 0.8) / 0.09, 2.0)) : exp(-r * r * 4.0);
  a *= v_color.a * step(r, 1.0);
  if (a < 0.003) discard;
  o = vec4(v_color.rgb * a, a);
}`;

// The night ground: a radial glow toward the center, dithered so the gradient doesn't band.
export const BG_VS = `#version 300 es
out vec2 v_uv;
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); v_uv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
export const BG_FS = `#version 300 es
precision mediump float;
in vec2 v_uv; uniform vec3 u_edge, u_center; uniform vec2 u_size;
out vec4 o;
void main() {
  vec2 q = (v_uv - vec2(0.52, 0.54)) * vec2(u_size.x / u_size.y, 1.0);
  float t = smoothstep(0.0, 0.75, length(q) / 0.85);
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) / 255.0;
  o = vec4(mix(u_center, u_edge, t) + n, 1.0);
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
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(p, i); loc[u.name.replace('[0]', '')] = gl.getUniformLocation(p, u.name); }
  const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < na; i++) { const a = gl.getActiveAttrib(p, i); loc[a.name] = gl.getAttribLocation(p, a.name); }
  return { p, loc };
}

export class Renderer {
  constructor(canvas, palette, { antialias = true } = {}) {
    this.msaa = antialias;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.canvas = canvas;
    this.palette = palette;
    this.node = program(gl, NODE_VS, NODE_FS);
    this.line = program(gl, LINE_VS, LINE_FS);
    this.sprite = program(gl, SPRITE_VS, SPRITE_FS);
    this.bg = program(gl, BG_VS, BG_FS);
    this.vao = { bg: gl.createVertexArray() };
    this.buf = {};
    this.counts = { nodes: 0, edges: 0, fissures: 0, sprites: 0 };
  }

  _attr(prog, name, buf, size, stride, offset) {
    const gl = this.gl, l = prog.loc[name];
    if (l === undefined || l < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(l);
    gl.vertexAttribPointer(l, size, gl.FLOAT, false, stride * 4, offset * 4);
  }

  // Static node data: [x,y,z,size,shape,project] per node, plus a dynamic state vec4 per node
  // (x brightness, 0 = hidden; y ember strength; z ignition time in s; w kind code).
  setNodes(pos, size, shape, proj, state) {
    const gl = this.gl, n = size.length;
    const data = (this.nodeData = new Float32Array(n * 6));
    for (let i = 0; i < n; i++) data.set([pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], size[i], shape[i], proj[i]], i * 6);
    const vao = (this.vao.node = gl.createVertexArray());
    gl.bindVertexArray(vao);
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    this.buf.node = b;
    this._attr(this.node, 'a_pos', b, 3, 6, 0);
    this._attr(this.node, 'a_size', b, 1, 6, 3);
    this._attr(this.node, 'a_shape', b, 1, 6, 4);
    this._attr(this.node, 'a_proj', b, 1, 6, 5);
    this.buf.state = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.state);
    gl.bufferData(gl.ARRAY_BUFFER, state, gl.DYNAMIC_DRAW);
    this._attr(this.node, 'a_state', this.buf.state, 4, 4, 0);
    gl.bindVertexArray(null);
    this.counts.nodes = n;
  }
  setSize(i, size) {
    const gl = this.gl;
    this.nodeData[i * 6 + 3] = size;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.node);
    gl.bufferSubData(gl.ARRAY_BUFFER, (i * 6 + 3) * 4, this.nodeData, i * 6 + 3, 1);
  }
  updateState(state, from = 0, to = state.length / 4) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.state);
    gl.bufferSubData(gl.ARRAY_BUFFER, from * 16, state, from * 4, (to - from) * 4);
  }

  // Lines as pairs of vertices [x,y,z,dist,type,project] plus a dynamic highlight per vertex (0 hidden, 1 normal, 2 lit).
  _lines(key, verts, hl) {
    const gl = this.gl;
    const vao = (this.vao[key] = gl.createVertexArray());
    gl.bindVertexArray(vao);
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    this._attr(this.line, 'a_pos', b, 3, 6, 0);
    this._attr(this.line, 'a_dist', b, 1, 6, 3);
    this._attr(this.line, 'a_type', b, 1, 6, 4);
    this._attr(this.line, 'a_proj', b, 1, 6, 5);
    this.buf[key + 'Hl'] = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf[key + 'Hl']);
    gl.bufferData(gl.ARRAY_BUFFER, hl, gl.DYNAMIC_DRAW);
    this._attr(this.line, 'a_hl', this.buf[key + 'Hl'], 1, 1, 0);
    gl.bindVertexArray(null);
  }
  setEdges(verts, hl) { this._lines('edges', verts, hl); this.counts.edges = hl.length; }
  updateEdges(hl) { const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.edgesHl); gl.bufferSubData(gl.ARRAY_BUFFER, 0, hl); }
  setFissures(verts) { this._lines('fissures', verts, new Float32Array(verts.length / 6).fill(1)); this.counts.fissures = verts.length / 6; }

  // Sprites (haze, comets, rings): [x,y,z,size,r,g,b,a,ring] per point, rewritten whenever they change.
  setSprites(data) {
    const gl = this.gl;
    if (!this.vao.sprite) {
      this.vao.sprite = gl.createVertexArray();
      gl.bindVertexArray(this.vao.sprite);
      this.buf.sprite = gl.createBuffer();
      this._attr(this.sprite, 'a_pos', this.buf.sprite, 3, 9, 0);
      this._attr(this.sprite, 'a_size', this.buf.sprite, 1, 9, 3);
      this._attr(this.sprite, 'a_color', this.buf.sprite, 4, 9, 4);
      this._attr(this.sprite, 'a_ring', this.buf.sprite, 1, 9, 8);
      gl.bindVertexArray(null);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.sprite);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    this.counts.sprites = data.length / 9;
  }

  resize(w, h, dpr) {
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    this.w = w; this.h = h; this.dpr = dpr;
  }

  // Two render targets: the static layers (ground, outline, haze, edges) are drawn with 4x MSAA and resolved into a
  // cache that is redrawn only when layers.staticKey changes (camera, filters, focus, project emphasis); every frame
  // copies the cache and draws the moving layers (stars, comets, rings) on top. ponytail: stars skip MSAA because
  // their shader antialiases them already.
  _targets() {
    const gl = this.gl, W = this.canvas.width, H = this.canvas.height;
    if (this.tw === W && this.th === H) return;
    this.tw = W; this.th = H; this.cacheKey = undefined;
    for (const r of [this.msRb, this.cacheRb]) if (r) gl.deleteRenderbuffer(r);
    for (const f of [this.msFb, this.cacheFb]) if (f) gl.deleteFramebuffer(f);
    const target = (samples) => {
      const rb = gl.createRenderbuffer(), fb = gl.createFramebuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      if (samples) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, W, H);
      else gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, W, H);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
      return [rb, fb];
    };
    const samples = this.msaa ? Math.min(4, gl.getParameter(gl.MAX_SAMPLES)) : 0;
    [this.cacheRb, this.cacheFb] = target(0);
    [this.msRb, this.msFb] = samples ? target(samples) : [null, null];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  _blit(from, to) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, from);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, to);
    gl.blitFramebuffer(0, 0, this.tw, this.th, 0, 0, this.tw, this.th, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  _sprites(view, from, count) {
    const gl = this.gl;
    gl.useProgram(this.sprite.p);
    gl.uniformMatrix4fv(this.sprite.loc.u_vp, false, view.vp);
    gl.uniform1f(this.sprite.loc.u_px, view.px * this.dpr);
    gl.bindVertexArray(this.vao.sprite);
    gl.drawArrays(gl.POINTS, from, count);
  }

  // view: { vp (Float32Array 16), px (pixels per world unit at distance 1), time (s), ripples: [{p, t, c}], proj }
  // layers: { haze (haze sprites at the start of the sprite buffer), staticKey, and the benchmark's layer switches }
  draw(view, layers) {
    const gl = this.gl, P = this.palette;
    this._targets();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const haze = layers.haze || 0;
    if (layers.staticKey == null || layers.staticKey !== this.cacheKey) {
      this.cacheKey = layers.staticKey;
      this.staticDraws = (this.staticDraws || 0) + 1;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFb || this.cacheFb);
      gl.disable(gl.BLEND);
      if (layers.bg === false) { gl.clearColor(...P.bg, 1); gl.clear(gl.COLOR_BUFFER_BIT); } else {
        gl.useProgram(this.bg.p);
        gl.uniform3f(this.bg.loc.u_edge, ...P.bg);
        gl.uniform3f(this.bg.loc.u_center, ...P.bgCenter);
        gl.uniform2f(this.bg.loc.u_size, this.w, this.h);
        gl.bindVertexArray(this.vao.bg);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(this.line.p);
      gl.uniformMatrix4fv(this.line.loc.u_vp, false, view.vp);
      gl.uniform3fv(this.line.loc.u_edge, P.edgeColors);
      gl.uniform1fv(this.line.loc.u_alpha, P.edgeAlpha);
      gl.uniform3f(this.line.loc.u_hlColor, ...P.accent);
      gl.uniform1fv(this.line.loc.u_proj, view.proj);
      if (this.counts.fissures) { gl.bindVertexArray(this.vao.fissures); gl.drawArrays(gl.LINES, 0, this.counts.fissures); }
      if (this.counts.sprites && haze) this._sprites(view, 0, haze);
      if (this.counts.edges && layers.edges !== false) {
        gl.useProgram(this.line.p);
        gl.bindVertexArray(this.vao.edges);
        gl.drawArrays(gl.LINES, 0, this.counts.edges);
      }
      if (this.msFb) this._blit(this.msFb, this.cacheFb);
    }
    // Chrome clears a presented WebGL back buffer lazily, at the next draw or clear call, and a blit doesn't count:
    // clear first, or the stars' draw call would wipe the copied cache.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this._blit(this.cacheFb, null);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    if (layers.nodes !== false) {
      gl.useProgram(this.node.p);
      gl.uniformMatrix4fv(this.node.loc.u_vp, false, view.vp);
      gl.uniform1f(this.node.loc.u_time, view.time);
      gl.uniform1f(this.node.loc.u_px, view.px * this.dpr);
      gl.uniform3fv(this.node.loc.u_kind, P.kinds);
      gl.uniform3f(this.node.loc.u_base, ...P.node);
      gl.uniform1fv(this.node.loc.u_proj, view.proj);
      const rip = new Float32Array(16).fill(-99), ripC = new Float32Array(12);
      (view.ripples || []).slice(-4).forEach((r, i) => { rip.set([...r.p, r.t], i * 4); ripC.set(r.c, i * 3); });
      gl.uniform4fv(this.node.loc.u_rip, rip);
      gl.uniform3fv(this.node.loc.u_ripColor, ripC);
      gl.bindVertexArray(this.vao.node);
      gl.drawArrays(gl.POINTS, 0, this.counts.nodes);
    }
    if (this.counts.sprites > haze) this._sprites(view, haze, this.counts.sprites - haze);
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
// Camera orbiting `target` at `dist`, yaw around y, pitch around x.
export function orbitView(target, dist, yaw, pitch) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const eye = [target[0] + dist * sy * cp, target[1] + dist * sp, target[2] + dist * cy * cp];
  const z = [eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]].map((v) => v / dist);
  let x = [z[2], 0, -z[0]];
  const xl = Math.hypot(...x) || 1;
  x = x.map((v) => v / xl);
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
}
