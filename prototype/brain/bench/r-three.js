// three.js version of the same scene: the prototype's own shaders as RawShaderMaterials on Points and LineSegments,
// so the GPU work matches the raw WebGL renderer and the difference is three.js itself (load, parse, per-frame overhead).
import * as THREE from '/vendor/three/three.module.js';
import { NODE_VS, NODE_FS, LINE_VS, LINE_FS, SPRITE_VS, SPRITE_FS, BG_VS, BG_FS } from '../gl.js';

const strip = (src) => src.replace(/^#version 300 es\n/, '');
const additive = { glslVersion: THREE.GLSL3, transparent: true, depthTest: false, depthWrite: false, blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation };

export class ThreeRenderer {
  static async create(canvas, S) { return new ThreeRenderer(canvas, S); }
  constructor(canvas, S) {
    this.S = S;
    const r = (this.r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' }));
    r.autoClear = false;
    this.gl = r.getContext();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera();
    const P = S.P;
    this.u = { u_vp: { value: new Float32Array(16) }, u_px: { value: 1 }, u_time: { value: 0 }, u_proj: { value: new Float32Array(32) },
      u_rip: { value: new Float32Array(16) }, u_ripColor: { value: new Float32Array(12) }, u_kind: { value: new Float32Array(P.kinds) },
      u_base: { value: new THREE.Vector3(...P.node) }, u_edge: { value: new Float32Array(P.edgeColors) }, u_alpha: { value: new Float32Array(P.edgeAlpha) },
      u_hlColor: { value: new THREE.Vector3(...P.accent) }, u_size: { value: new THREE.Vector2(1, 1) },
      u_edgeC: { value: new THREE.Vector3(...P.bg) }, u_center: { value: new THREE.Vector3(...P.bgCenter) } };
    const add = (obj, order) => { obj.frustumCulled = false; obj.renderOrder = order; this.scene.add(obj); return obj; };

    // background (gl_VertexID triangle; the position attribute only sets the draw count)
    const bgGeo = new THREE.BufferGeometry();
    bgGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
    const bgFs = strip(BG_FS).replace('uniform vec3 u_edge, u_center;', 'uniform vec3 u_edgeC, u_center;').replace('mix(u_center, u_edge, t)', 'mix(u_center, u_edgeC, t)');
    add(new THREE.Mesh(bgGeo, new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: strip(BG_VS), fragmentShader: bgFs, uniforms: this.u, depthTest: false, depthWrite: false })), 0);

    const lines = (verts, hl, order) => {
      const g = new THREE.BufferGeometry();
      const b = new THREE.InterleavedBuffer(verts, 6);
      g.setAttribute('a_pos', new THREE.InterleavedBufferAttribute(b, 3, 0));
      g.setAttribute('a_dist', new THREE.InterleavedBufferAttribute(b, 1, 3));
      g.setAttribute('a_type', new THREE.InterleavedBufferAttribute(b, 1, 4));
      g.setAttribute('a_proj', new THREE.InterleavedBufferAttribute(b, 1, 5));
      g.setAttribute('a_hl', new THREE.BufferAttribute(hl, 1));
      g.setAttribute('position', new THREE.InterleavedBufferAttribute(b, 3, 0));
      return add(new THREE.LineSegments(g, new THREE.RawShaderMaterial({ ...additive, vertexShader: strip(LINE_VS), fragmentShader: strip(LINE_FS), uniforms: this.u })), order);
    };
    lines(S.fissures, new Float32Array(S.fissures.length / 6).fill(1), 1);
    lines(S.edgeVerts, S.edgeHl, 3);

    const ng = new THREE.BufferGeometry();
    const nd = new Float32Array(S.N * 6);
    for (let i = 0; i < S.N; i++) nd.set([S.pos[i * 3], S.pos[i * 3 + 1], S.pos[i * 3 + 2], S.size[i], S.shape[i], S.proj[i]], i * 6);
    const nb = new THREE.InterleavedBuffer(nd, 6);
    ng.setAttribute('a_pos', new THREE.InterleavedBufferAttribute(nb, 3, 0));
    ng.setAttribute('position', new THREE.InterleavedBufferAttribute(nb, 3, 0));
    ng.setAttribute('a_size', new THREE.InterleavedBufferAttribute(nb, 1, 3));
    ng.setAttribute('a_shape', new THREE.InterleavedBufferAttribute(nb, 1, 4));
    ng.setAttribute('a_proj', new THREE.InterleavedBufferAttribute(nb, 1, 5));
    this.state = new THREE.BufferAttribute(S.state, 4);
    this.state.setUsage(THREE.DynamicDrawUsage);
    ng.setAttribute('a_state', this.state);
    add(new THREE.Points(ng, new THREE.RawShaderMaterial({ ...additive, vertexShader: strip(NODE_VS), fragmentShader: strip(NODE_FS), uniforms: this.u })), 4);

    const sprite = (order) => {
      const g = new THREE.BufferGeometry();
      const buf = new THREE.InterleavedBuffer(new Float32Array(9 * 4096), 9);
      buf.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('a_pos', new THREE.InterleavedBufferAttribute(buf, 3, 0));
      g.setAttribute('position', new THREE.InterleavedBufferAttribute(buf, 3, 0));
      g.setAttribute('a_size', new THREE.InterleavedBufferAttribute(buf, 1, 3));
      g.setAttribute('a_color', new THREE.InterleavedBufferAttribute(buf, 4, 4));
      g.setAttribute('a_ring', new THREE.InterleavedBufferAttribute(buf, 1, 8));
      const obj = add(new THREE.Points(g, new THREE.RawShaderMaterial({ ...additive, vertexShader: strip(SPRITE_VS), fragmentShader: strip(SPRITE_FS), uniforms: this.u })), order);
      return { g, buf, obj };
    };
    this.haze = sprite(2);
    this.top = sprite(5);
  }
  resize(w, h, dpr) { this.r.setPixelRatio(dpr); this.r.setSize(w, h, false); this.u.u_size.value.set(w, h); this.dpr = dpr; }
  updateState(dirty) { if (dirty.length) this.state.needsUpdate = true; }
  draw(view, sprites, haze) {
    const u = this.u;
    u.u_vp.value = view.vp; u.u_px.value = view.px * this.dpr; u.u_time.value = view.time; u.u_proj.value = view.proj;
    const rip = new Float32Array(16).fill(-99), ripC = new Float32Array(12);
    view.ripples.slice(-4).forEach((x, i) => { rip.set([...x.p, x.t], i * 4); ripC.set(x.c, i * 3); });
    u.u_rip.value = rip; u.u_ripColor.value = ripC;
    const n = sprites.length / 9;
    this.haze.buf.array.set(sprites.subarray(0, haze * 9)); this.haze.buf.needsUpdate = true; this.haze.g.setDrawRange(0, haze);
    this.top.buf.array.set(sprites.subarray(haze * 9)); this.top.buf.needsUpdate = true; this.top.g.setDrawRange(0, n - haze);
    this.r.clear();
    this.r.render(this.scene, this.camera);
  }
}
