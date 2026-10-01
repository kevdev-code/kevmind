// Canvas 2D version of the same scene, written the fast way: CPU projection, pre-rendered glow sprites per shape
// and kind drawn with drawImage, edges batched into one path per type, additive "lighter" compositing.
const css = (rgb, a = 1) => `rgba(${Math.round(rgb[0] * 255)},${Math.round(rgb[1] * 255)},${Math.round(rgb[2] * 255)},${a})`;

function sprite(shape, rgb, ring = false) {
  const s = 64, c = new OffscreenCanvas(s, s), x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, css(rgb, ring ? 0 : 0.42)); g.addColorStop(1, css(rgb, 0));
  if (ring) { x.strokeStyle = css(rgb); x.lineWidth = 5; x.beginPath(); x.arc(32, 32, 26, 0, Math.PI * 2); x.stroke(); return c; }
  x.fillStyle = g; x.fillRect(0, 0, s, s);
  x.fillStyle = css(rgb, 0.9);
  const k = 11.5;
  x.beginPath();
  if (shape === 0) x.arc(32, 32, k, 0, Math.PI * 2);
  else if (shape === 1) { x.moveTo(32, 32 - k * 1.25); x.lineTo(32 + k * 1.25, 32); x.lineTo(32, 32 + k * 1.25); x.lineTo(32 - k * 1.25, 32); }
  else if (shape === 2) { x.moveTo(32, 32 - k); x.lineTo(32 + k, 32 + k * 0.8); x.lineTo(32 - k, 32 + k * 0.8); }
  else if (shape === 3) x.rect(32 - k * 0.85, 32 - k * 0.85, k * 1.7, k * 1.7);
  else { x.lineWidth = 6; x.strokeStyle = css(rgb, 0.9); x.arc(32, 32, k * 0.82, 0, Math.PI * 2); x.stroke(); return c; }
  x.fill();
  return c;
}

export class CanvasRenderer {
  constructor(canvas, S) {
    this.S = S;
    this.c = canvas;
    this.x = canvas.getContext('2d', { alpha: false });
    const k = S.P.kinds;
    // sprites[shape][kind]: kind 0 is the plain star
    this.sprites = [0, 1, 2, 3, 4].map((sh) => [0, 1, 2, 3, 4, 5].map((kd) => sprite(sh, kd ? k.slice(kd * 3, kd * 3 + 3) : S.P.node)));
    this.glow = new Map();
    this.ring = new Map();
    this.scr = new Float32Array(S.N * 3);
  }
  resize(w, h, dpr) { this.w = w; this.h = h; this.dpr = dpr; this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr); }
  glowFor(rgb, ring) {
    const key = rgb.join(',') + ring;
    const m = ring ? this.ring : this.glow;
    if (!m.has(key)) m.set(key, ring ? sprite(0, rgb, true) : (() => {
      const c = new OffscreenCanvas(64, 64), x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, css(rgb, 1)); g.addColorStop(1, css(rgb, 0)); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return c;
    })());
    return m.get(key);
  }
  draw(view, sprites, hazeCount) {
    const { S, x, scr } = this, m = view.vp, W = this.w, H = this.h, d = this.dpr;
    const proj = (px, py, pz, out, o) => {
      const cx = m[0] * px + m[4] * py + m[8] * pz + m[12], cy = m[1] * px + m[5] * py + m[9] * pz + m[13], w = m[3] * px + m[7] * py + m[11] * pz + m[15];
      out[o] = ((cx / w + 1) / 2) * W * d; out[o + 1] = ((1 - cy / w) / 2) * H * d; out[o + 2] = w;
    };
    for (let i = 0; i < S.N; i++) proj(S.pos[i * 3], S.pos[i * 3 + 1], S.pos[i * 3 + 2], scr, i * 3);
    x.globalCompositeOperation = 'source-over';
    x.globalAlpha = 1;
    const g = x.createRadialGradient(W * d * 0.52, H * d * 0.46, 0, W * d * 0.52, H * d * 0.46, Math.max(W, H) * d * 0.6);
    g.addColorStop(0, css(S.P.bgCenter)); g.addColorStop(1, css(S.P.bg));
    x.fillStyle = g; x.fillRect(0, 0, W * d, H * d);
    x.globalCompositeOperation = 'lighter';
    x.lineWidth = d;
    // profile, fissures
    const tmp = new Float32Array(6);
    x.beginPath();
    for (let i = 0; i < S.fissures.length; i += 12) {
      proj(S.fissures[i], S.fissures[i + 1], S.fissures[i + 2], tmp, 0); proj(S.fissures[i + 6], S.fissures[i + 7], S.fissures[i + 8], tmp, 3);
      x.moveTo(tmp[0], tmp[1]); x.lineTo(tmp[3], tmp[4]);
    }
    x.strokeStyle = css(S.P.edgeColors.slice(21, 24), 0.42); x.stroke();
    // haze
    for (let k = 0; k < hazeCount; k++) this.blit(sprites, k, view, false);
    // edges: one path per type
    for (let t = 0; t < 6; t++) {
      x.beginPath();
      for (let k = 0; k < S.E; k++) {
        const v = k * 12;
        if (S.edgeVerts[v + 4] !== t) continue;
        proj(S.edgeVerts[v], S.edgeVerts[v + 1], S.edgeVerts[v + 2], tmp, 0); proj(S.edgeVerts[v + 6], S.edgeVerts[v + 7], S.edgeVerts[v + 8], tmp, 3);
        x.moveTo(tmp[0], tmp[1]); x.lineTo(tmp[3], tmp[4]);
      }
      x.setLineDash(t === 4 ? [2 * d, 2 * d] : []);
      x.strokeStyle = css(S.P.edgeColors.slice(t * 3, t * 3 + 3), S.P.edgeAlpha[t]);
      x.stroke();
    }
    x.setLineDash([]);
    // nodes: plain star, plus the kind's sprite when lit, plus the agent's color under a think ripple
    for (let i = 0; i < S.N; i++) {
      const w = scr[i * 3 + 2];
      if (w <= 0) continue;
      const st = i * 4, flashDt = view.time - S.state[st + 2], flash = flashDt >= 0 && flashDt < 3 ? Math.exp(-flashDt * 2.6) : 0;
      const pf = S.proj[i] < 0 ? 1 : view.proj[S.proj[i]];
      const far = Math.min(1, Math.max(0, (w - 2.7) / 1.0)), alpha = 1 - far * 0.5;
      const px = Math.min(160, (S.size[i] * (1 + 1.3 * flash) * view.px * d) / w);
      const sx = scr[i * 3] - px / 2, sy = scr[i * 3 + 1] - px / 2;
      const sh = this.sprites[S.shape[i]];
      x.globalAlpha = Math.min(1, S.state[st] * pf * alpha);
      x.drawImage(sh[0], sx, sy, px, px);
      const kind = S.state[st + 3], em = S.state[st + 1] * 0.85 + flash * 1.6;
      if (kind && em > 0.01) { x.globalAlpha = Math.min(1, em * alpha); x.drawImage(sh[kind], sx, sy, px, px); }
      for (const r of view.ripples) {
        const rt = view.time - r.t, dd = Math.hypot(S.pos[i * 3] - r.p[0], S.pos[i * 3 + 1] - r.p[1], S.pos[i * 3 + 2] - r.p[2]);
        const wv = (dd - rt * 0.18) / 0.05, a = Math.exp(-wv * wv) * (1 - rt / 2.4) * 1.4;
        if (a > 0.02) { x.globalAlpha = Math.min(1, a * alpha); x.drawImage(this.glowFor(r.c, false), sx, sy, px, px); }
      }
    }
    // comets and rings
    for (let k = hazeCount; k < sprites.length / 9; k++) this.blit(sprites, k, view, true);
    x.globalAlpha = 1;
  }
  blit(sp, k, view, top) {
    const o = k * 9, x = this.x, d = this.dpr, p = new Float32Array(3);
    const m = view.vp, px = sp[o], py = sp[o + 1], pz = sp[o + 2];
    const cx = m[0] * px + m[4] * py + m[8] * pz + m[12], cy = m[1] * px + m[5] * py + m[9] * pz + m[13], w = m[3] * px + m[7] * py + m[11] * pz + m[15];
    if (w <= 0) return;
    p[0] = ((cx / w + 1) / 2) * this.w * d; p[1] = ((1 - cy / w) / 2) * this.h * d;
    const s = Math.min(512, (sp[o + 3] * view.px * d) / w);
    x.globalAlpha = Math.min(1, sp[o + 7]);
    x.drawImage(this.glowFor([sp[o + 4], sp[o + 5], sp[o + 6]], sp[o + 8] > 0.5), p[0] - s / 2, p[1] - s / 2, s, s);
  }
}
