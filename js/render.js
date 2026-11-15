// Canvas renderer: compiles shapes into per-layer Path2D batches and draws them with pan/zoom.
import { padOutline } from './eagle.js';
import { DEG } from './geom.js';

const FONT_PX = 100; // base font size; scaled by transforms
const CAP = 0.72; // cap height / em for the UI sans font
export const TEXT_FONT = `${FONT_PX}px "Helvetica Neue", Arial, sans-serif`;

export function newBatch() {
  return { strokes: new Map(), fills: new Path2D(), zoneFill: new Path2D(), zoneOutline: new Path2D(), holes: new Path2D(), texts: [], count: 0, hasFill: false, hasZone: false, hasHoles: false };
}

function strokePath(b, w) {
  const key = Math.round(w * 1e4) / 1e4;
  let p = b.strokes.get(key);
  if (!p) { p = new Path2D(); b.strokes.set(key, p); }
  return p;
}

function polyPath(path, pts) {
  path.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) path.lineTo(pts[i], pts[i + 1]);
  path.closePath();
}

/** Adds a shape to a batch. */
export function addToBatch(b, s) {
  b.count++;
  switch (s.k) {
    case 'seg': {
      const p = strokePath(b, s.w);
      p.moveTo(s.x1, s.y1); p.lineTo(s.x2, s.y2);
      break;
    }
    case 'arc': {
      const p = strokePath(b, s.w);
      p.moveTo(s.cx + s.r * Math.cos(s.a0), s.cy + s.r * Math.sin(s.a0));
      p.arc(s.cx, s.cy, s.r, s.a0, s.a1, false);
      break;
    }
    case 'circle': {
      if (s.w > 0) {
        const p = strokePath(b, s.w);
        p.moveTo(s.x + s.r, s.y); p.arc(s.x, s.y, s.r, 0, 2 * Math.PI);
      } else {
        b.fills.moveTo(s.x + s.r, s.y); b.fills.arc(s.x, s.y, s.r, 0, 2 * Math.PI); b.hasFill = true;
      }
      break;
    }
    case 'poly': {
      if (s.pts.length < 4) break;
      if (s.zone) {
        polyPath(b.zoneFill, s.pts); polyPath(b.zoneOutline, s.pts); b.hasZone = true;
        break;
      }
      if (s.fill) { polyPath(b.fills, s.pts); b.hasFill = true; }
      if (s.w > 0 || !s.fill) polyPath(strokePath(b, s.w), s.pts);
      break;
    }
    case 'pad': {
      const o = padOutline(s);
      if (o.circle) { b.fills.moveTo(o.circle[0] + o.circle[2], o.circle[1]); b.fills.arc(o.circle[0], o.circle[1], o.circle[2], 0, 2 * Math.PI); }
      else polyPath(b.fills, o.pts);
      b.hasFill = true;
      if (s.drill) addHole(b, s.hx ?? s.x, s.hy ?? s.y, s.drill / 2);
      break;
    }
    case 'via': {
      b.fills.moveTo(s.x + s.d / 2, s.y); b.fills.arc(s.x, s.y, s.d / 2, 0, 2 * Math.PI); b.hasFill = true;
      addHole(b, s.x, s.y, s.drill / 2);
      break;
    }
    case 'hole': addHole(b, s.x, s.y, s.d / 2, true); break;
    case 'text': b.texts.push(s); break;
    default: break;
  }
}
function addHole(b, x, y, r) { b.holes.moveTo(x + r, y); b.holes.arc(x, y, r, 0, 2 * Math.PI); b.hasHoles = true; }

function drawText(ctx, s, color, M, zoom) {
  const px = s.size * zoom;
  if (px < 1.2) return;
  const lines = String(s.str).split('\n');
  ctx.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);
  ctx.translate(s.x, s.y);
  if (s.mirror) ctx.scale(-1, 1);
  if (s.angle) ctx.rotate(s.angle * DEG);
  const k = s.size / CAP / FONT_PX;
  ctx.scale(k, -k);
  ctx.fillStyle = color;
  ctx.textAlign = s.h < 0 ? 'left' : s.h > 0 ? 'right' : 'center';
  ctx.textBaseline = 'alphabetic';
  const em = FONT_PX * CAP; // cap height in font units
  const pitch = em * (1 + (s.dist ?? 50) / 100);
  const n = lines.length;
  // baseline (y-down font units) of first line
  let base0;
  if (s.v < 0) base0 = -(n - 1) * pitch;
  else if (s.v > 0) base0 = em;
  else base0 = em / 2 - ((n - 1) * pitch) / 2;
  for (let i = 0; i < n; i++) {
    const y = base0 + i * pitch;
    ctx.fillText(lines[i], 0, y);
    if (s.overbar && i === 0) {
      const w = ctx.measureText(lines[i]).width;
      const x0 = s.h < 0 ? 0 : s.h > 0 ? -w : -w / 2;
      ctx.fillRect(x0, y - em * 1.25, w, FONT_PX * 0.07);
    }
  }
}

/**
 * View: owns the canvas, camera, and draws a "scene":
 *   scene = { background, layers: [{key, color, alpha, visible, batch}], extraDraw?(ctx, view) }
 */
export class View {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cx = 0; this.cy = 0; this.zoom = 5; this.flip = false;
    this.scene = null;
    this.overlays = [];
    this.dim = false;
    this.grid = true;
    this.gridColor = '#888';
    this._raf = 0;
    this.onchange = null;
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    this.W = r.width; this.H = r.height;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.redraw();
  }

  matrix() {
    const z = this.zoom * this.dpr;
    const fx = this.flip ? -1 : 1;
    return [z * fx, 0, 0, -z, (this.W / 2 - this.cx * this.zoom * fx) * this.dpr, (this.H / 2 + this.cy * this.zoom) * this.dpr];
  }
  toWorld(sx, sy) {
    const fx = this.flip ? -1 : 1;
    return [(sx - this.W / 2) / (this.zoom * fx) + this.cx, -(sy - this.H / 2) / this.zoom + this.cy];
  }
  toScreen(x, y) {
    const fx = this.flip ? -1 : 1;
    return [(x - this.cx) * this.zoom * fx + this.W / 2, -(y - this.cy) * this.zoom + this.H / 2];
  }

  fit(b, margin = 0.06) {
    if (!b || !b.valid || !this.W) return;
    this.cx = (b.x0 + b.x1) / 2; this.cy = (b.y0 + b.y1) / 2;
    const zx = this.W / Math.max(b.w, 1e-3), zy = this.H / Math.max(b.h, 1e-3);
    this.zoom = Math.min(zx, zy) * (1 - 2 * margin);
    this.redraw();
  }
  zoomAt(sx, sy, f) {
    const [wx, wy] = this.toWorld(sx, sy);
    this.zoom = Math.min(5000, Math.max(0.05, this.zoom * f));
    const [nx, ny] = this.toWorld(sx, sy);
    this.cx += wx - nx; this.cy += wy - ny;
    this.redraw();
  }
  panBy(dx, dy) {
    const fx = this.flip ? -1 : 1;
    this.cx -= dx / (this.zoom * fx); this.cy += dy / this.zoom;
    this.redraw();
  }
  redraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.draw(); this.onchange?.(); });
  }

  gridPitch() {
    const steps = this.scene?.gridSteps || [0.127, 0.254, 0.635, 1.27, 2.54, 6.35, 12.7, 25.4, 63.5, 127, 254];
    for (const s of steps) if (s * this.zoom >= 14) return s;
    return steps[steps.length - 1];
  }

  draw() {
    const { ctx, scene } = this;
    if (!this.W) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = scene?.background || '#111';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!scene) return;
    const M = this.matrix();
    const z = this.zoom * this.dpr;
    if (this.grid) this.drawGrid(M);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 1;
    const baseAlpha = this.dim ? 0.28 : 1;
    const layers = scene.layers.filter((l) => l.visible);
    for (const L of layers) this.drawBatch(L.batch, L.color, (L.alpha ?? 1) * baseAlpha * (L.dimmed ? 0.35 : 1), M, z, L);
    // holes on top of all copper
    if (scene.holeColor) {
      ctx.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);
      ctx.globalAlpha = 1;
      for (const L of layers) {
        if (!L.batch.hasHoles) continue;
        ctx.fillStyle = scene.holeColor;
        ctx.fill(L.batch.holes);
      }
    }
    for (const o of this.overlays) {
      if (o.visibleKeys && !o.visibleKeys.some((k) => scene.layers.find((l) => l.key === k)?.visible)) continue;
      this.drawBatch(o.batch, o.color, o.alpha ?? 1, M, z, o);
      if (o.holes && scene.holeColor && o.batch.hasHoles) {
        ctx.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);
        ctx.fillStyle = scene.holeColor; ctx.fill(o.batch.holes);
      }
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);
    scene.extraDraw?.(ctx, this, M);
    this.extraDraw?.(ctx, this, M);
  }

  /** Approximate copper pour: zone area minus clearance around other-net copper (raster, per frame). */
  drawPours(L, alpha, M) {
    if (!this.off) { this.off = document.createElement('canvas'); this.offCtx = this.off.getContext('2d'); }
    const off = this.off, o = this.offCtx;
    if (off.width !== this.canvas.width || off.height !== this.canvas.height) { off.width = this.canvas.width; off.height = this.canvas.height; }
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.globalCompositeOperation = 'source-over';
    o.clearRect(0, 0, off.width, off.height);
    o.lineCap = 'round'; o.lineJoin = 'round';
    for (const P of L.pours) {
      // draw each net's pour into a scratch layer, then union onto off
      if (!this.off2) { this.off2 = document.createElement('canvas'); this.off2Ctx = this.off2.getContext('2d'); }
      const c2 = this.off2, x = this.off2Ctx;
      if (c2.width !== off.width || c2.height !== off.height) { c2.width = off.width; c2.height = off.height; }
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.globalCompositeOperation = 'source-over';
      x.clearRect(0, 0, c2.width, c2.height);
      x.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);
      x.lineCap = 'round'; x.lineJoin = 'round';
      x.fillStyle = L.color; x.strokeStyle = L.color;
      x.fill(P.path, 'evenodd');
      x.globalCompositeOperation = 'destination-out';
      x.fillStyle = '#000'; x.strokeStyle = '#000';
      const b = P.cut, iso = P.iso;
      x.lineWidth = 2 * iso;
      if (b.hasFill) { x.fill(b.fills); x.stroke(b.fills); }
      if (b.hasHoles) { x.fill(b.holes); x.stroke(b.holes); }
      for (const [w, p] of b.strokes) { x.lineWidth = w + 2 * iso; x.stroke(p); }
      if (P.others) { x.fill(P.others); x.lineWidth = 2 * iso; x.stroke(P.others); }
      // keep the pour inside its own outline minus half the min width (Eagle draws the outline with that width)
      x.globalCompositeOperation = 'source-over';
      o.drawImage(c2, 0, 0);
    }
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha * (this.pourAlpha ?? 0.6);
    ctx.drawImage(off, 0, 0);
    ctx.globalAlpha = alpha;
  }

  drawBatch(b, color, alpha, M, z, L) {
    const { ctx } = this;
    if (L.pours && this.showPours !== false) this.drawPours(L, alpha, M);
    ctx.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    if (b.hasZone && L.pours && this.showPours !== false) {
      ctx.lineWidth = 1 / z;
      ctx.globalAlpha = alpha * 0.5;
      ctx.stroke(b.zoneOutline);
      ctx.globalAlpha = alpha;
    } else if (b.hasZone) {
      ctx.globalAlpha = alpha * (L.zoneAlpha ?? 0.35);
      ctx.fill(b.zoneFill, 'evenodd');
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 1.5 / z;
      ctx.setLineDash([6 / z, 4 / z]);
      ctx.stroke(b.zoneOutline);
      ctx.setLineDash([]);
    }
    if (b.hasFill) ctx.fill(b.fills, 'nonzero');
    for (const [w, p] of b.strokes) {
      ctx.lineWidth = Math.max(w, (L.minLine ?? 1) / z);
      ctx.stroke(p);
    }
    if (b.texts.length) {
      ctx.font = TEXT_FONT;
      const vb = this.viewBox();
      for (const t of b.texts) {
        const r = t.size * Math.max(1, String(t.str).length);
        if (t.x + r < vb[0] || t.x - r > vb[2] || t.y + r < vb[1] || t.y - r > vb[3]) continue;
        drawText(ctx, t, color, M, this.zoom);
      }
    }
    ctx.globalAlpha = 1;
  }

  viewBox() {
    const [ax, ay] = this.toWorld(0, 0), [bx, by] = this.toWorld(this.W, this.H);
    return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
  }

  drawGrid(M) {
    const { ctx } = this;
    const p = this.gridPitch();
    const [x0, y0, x1, y1] = this.viewBox();
    const n = ((x1 - x0) / p) * ((y1 - y0) / p);
    if (n > 40000) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.scene.gridColor || this.gridColor;
    const s = Math.max(1, this.dpr);
    for (let gx = Math.floor(x0 / p) * p; gx <= x1; gx += p) {
      for (let gy = Math.floor(y0 / p) * p; gy <= y1; gy += p) {
        const [sx, sy] = this.toScreen(gx, gy);
        ctx.fillRect(sx * this.dpr - s / 2, sy * this.dpr - s / 2, s, s);
      }
    }
  }
}
