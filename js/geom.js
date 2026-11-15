// Geometry helpers for EAGLE coordinates (mm, Y up, angles CCW in degrees).

export const DEG = Math.PI / 180;

export function num(v, d = 0) {
  if (v === undefined || v === null || v === '') return d;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
}

/** EAGLE rotation string like "R90", "MR180", "SR45", "SMR270". */
export function parseRot(s) {
  const r = { angle: 0, mirror: false, spin: false };
  if (!s) return r;
  let i = 0;
  while (i < s.length && /[SMR]/.test(s[i])) {
    if (s[i] === 'S') r.spin = true;
    else if (s[i] === 'M') r.mirror = true;
    else if (s[i] === 'R') { i++; break; }
    i++;
  }
  r.angle = normDeg(num(s.slice(i), 0));
  return r;
}

export function normDeg(a) {
  a %= 360;
  if (a < 0) a += 360;
  if (Math.abs(a - 360) < 1e-9) a = 0;
  return a;
}

/** Transform = { x, y, angle, mirror }. Point transform: translate · mirrorX · rotate. */
export function xf(t, px, py) {
  if (!t) return [px, py];
  let x = px, y = py;
  if (t.angle) {
    const a = t.angle * DEG, c = Math.cos(a), s = Math.sin(a);
    const qx = x * c - y * s;
    y = x * s + y * c;
    x = qx;
    // snap tiny float noise for right angles
    if (t.angle % 90 === 0) { x = Math.round(x * 1e6) / 1e6; y = Math.round(y * 1e6) / 1e6; }
  }
  if (t.mirror) x = -x;
  return [x + t.x, y + t.y];
}

/** Compose (outer ∘ inner) of rotation+mirror parts. */
export function composeRot(outer, inner) {
  if (inner.mirror) {
    return { angle: normDeg(inner.angle - outer.angle), mirror: !outer.mirror, spin: inner.spin || outer.spin };
  }
  return { angle: normDeg(outer.angle + inner.angle), mirror: outer.mirror, spin: inner.spin || outer.spin };
}

/** Maps an angle (deg) through a transform's rotation+mirror (for directions). */
export function xfAngle(t, a) {
  if (!t) return normDeg(a);
  const r = a + t.angle;
  return normDeg(t.mirror ? 180 - r : r);
}

/** Arc for a wire with EAGLE "curve" (deg, +CCW from p1 to p2). Angles in radians; draw CCW a0→a1. */
export function arcFromCurve(x1, y1, x2, y2, curve) {
  const dx = x2 - x1, dy = y2 - y1;
  const c = Math.hypot(dx, dy);
  const a = curve * DEG;
  const r = c / (2 * Math.sin(Math.abs(a) / 2));
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const d = (c / 2) / Math.tan(a / 2);
  // left normal of chord direction
  const nx = -dy / c, ny = dx / c;
  const cx = mx + nx * d, cy = my + ny * d;
  let a0 = Math.atan2(y1 - cy, x1 - cx);
  let a1 = Math.atan2(y2 - cy, x2 - cx);
  if (curve < 0) [a0, a1] = [a1, a0];
  while (a1 <= a0) a1 += 2 * Math.PI;
  return { cx, cy, r: Math.abs(r), a0, a1 };
}

export function arcPoints(arc, segs) {
  const n = segs || Math.max(4, Math.ceil(((arc.a1 - arc.a0) / (2 * Math.PI)) * 48));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = arc.a0 + ((arc.a1 - arc.a0) * i) / n;
    pts.push(arc.cx + arc.r * Math.cos(t), arc.cy + arc.r * Math.sin(t));
  }
  return pts;
}

export class BBox {
  constructor() { this.x0 = Infinity; this.y0 = Infinity; this.x1 = -Infinity; this.y1 = -Infinity; }
  add(x, y, r = 0) {
    if (x - r < this.x0) this.x0 = x - r;
    if (y - r < this.y0) this.y0 = y - r;
    if (x + r > this.x1) this.x1 = x + r;
    if (y + r > this.y1) this.y1 = y + r;
    return this;
  }
  addBox(b) { if (b && b.valid) { this.add(b.x0, b.y0); this.add(b.x1, b.y1); } return this; }
  get valid() { return this.x0 <= this.x1 && this.y0 <= this.y1; }
  get w() { return this.x1 - this.x0; }
  get h() { return this.y1 - this.y0; }
  contains(x, y, m = 0) { return x >= this.x0 - m && x <= this.x1 + m && y >= this.y0 - m && y <= this.y1 + m; }
  area() { return this.valid ? this.w * this.h : Infinity; }
}

export function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function closestOnSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return [x1 + t * dx, y1 + t * dy];
}

export function pointInPoly(px, py, pts) {
  let inside = false;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[2 * i], yi = pts[2 * i + 1], xj = pts[2 * j], yj = pts[2 * j + 1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Parses an EAGLE "align" attribute into h (-1 left, 0 center, 1 right) and v (-1 bottom, 0 center, 1 top). */
export function parseAlign(s) {
  if (!s) return { h: -1, v: -1 };
  if (s === 'center') return { h: 0, v: 0 };
  const [vv, hh] = s.split('-');
  const v = vv === 'top' ? 1 : vv === 'center' ? 0 : -1;
  const h = hh === 'right' ? 1 : hh === 'center' ? 0 : -1;
  return { h, v };
}

/**
 * Creates a resolved text shape following EAGLE's rendering rules.
 * mirrorGlyphs=true for boards (mirrored text is drawn mirrored), false for schematics.
 */
export function makeText(str, x, y, size, rot, align, extra = {}, mirrorGlyphs = true) {
  let angle = rot.angle, mirror = rot.mirror;
  let { h, v } = align;
  if (!mirrorGlyphs && mirror) { angle = normDeg(-angle); h = -h; mirror = false; }
  if (!rot.spin && angle > 90 + 1e-6 && angle <= 270 + 1e-6) {
    angle = normDeg(angle - 180); h = -h; v = -v;
  }
  return { k: 'text', str, x, y, size, angle, mirror, h, v, ratio: 8, dist: 50, ...extra };
}

/** Approximate bbox corners of a text shape. */
export function textBox(t) {
  const lines = String(t.str).split('\n');
  const w = Math.max(...lines.map((l) => l.length)) * t.size * 0.78;
  const pitch = t.size * (1 + (t.dist ?? 50) / 100);
  const hgt = t.size + (lines.length - 1) * pitch;
  const lx0 = t.h < 0 ? 0 : t.h > 0 ? -w : -w / 2;
  const ly0 = t.v < 0 ? 0 : t.v > 0 ? -hgt : -hgt / 2;
  const tr = { x: t.x, y: t.y, angle: t.angle, mirror: t.mirror };
  const b = new BBox();
  for (const [cx, cy] of [[lx0, ly0 - t.size * 0.25], [lx0 + w, ly0 - t.size * 0.25], [lx0, ly0 + hgt], [lx0 + w, ly0 + hgt]]) {
    const [px, py] = xf(tr, cx, cy);
    b.add(px, py);
  }
  return b;
}
