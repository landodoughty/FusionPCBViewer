// Builds drawable scenes (layer batches with KiCad-like colors) and hit testing for boards and schematic sheets.
import { newBatch, addToBatch } from './render.js';
import { boardLayerInfo, boardLayerOrder, KICAD_PCB_COLORS, SCH_COLORS, schLayerInfo } from './layers.js';
import { padOutline } from './eagle.js';
import { distToSeg, pointInPoly, BBox, textBox } from './geom.js';

// ------------------------------------------------------------------ board
export function boardShapeKey(s) {
  if (s.k === 'pad') return s.th ? 17 : s.layer;
  if (s.k === 'via') return 18;
  if (s.k === 'hole') return 17;
  return s.layer;
}

export function boardLayerList(B) {
  const keys = new Set();
  for (const s of B.shapes) keys.add(boardShapeKey(s));
  keys.add(17); keys.add(18);
  return [...keys].map((k) => {
    const info = B.layers.get(k) || boardLayerInfo(k);
    return { ...boardLayerInfo(k, info.name), key: k };
  });
}

export function buildBoardScene(B, state) {
  const batches = new Map();
  for (const s of B.shapes) {
    const key = boardShapeKey(s);
    let b = batches.get(key);
    if (!b) { b = newBatch(); batches.set(key, b); }
    addToBatch(b, s);
  }
  // copper pours: per layer, per net -> zone path + "cut" geometry of everything else
  const pours = new Map();
  const zoneShapes = B.shapes.filter((s) => s.zone && s.layer >= 1 && s.layer <= 16);
  if (zoneShapes.length) {
    const byLayer = new Map();
    for (const z of zoneShapes) {
      if (!byLayer.has(z.layer)) byLayer.set(z.layer, new Map());
      const m = byLayer.get(z.layer);
      if (!m.has(z.net)) m.set(z.net, []);
      m.get(z.net).push(z);
    }
    const iso0 = B.dr.mdWireWire || 0.2;
    for (const [layer, nets] of byLayer) {
      const items = B.shapes.filter((s) => !s.zone && (s.layer === layer || s.k === 'via' || (s.k === 'pad' && s.th) || s.k === 'hole') && s.k !== 'text');
      const list = [];
      for (const [net, zones] of nets) {
        if (zones.some((z) => z.src?.pour === 'cutout')) continue;
        const zp = new Path2D();
        for (const z of zones) { zp.moveTo(z.pts[0], z.pts[1]); for (let i = 2; i < z.pts.length; i += 2) zp.lineTo(z.pts[i], z.pts[i + 1]); zp.closePath(); }
        const iso = Math.max(...zones.map((z) => (Number.isFinite(z.src?.isolate) && z.src.isolate > 0 ? z.src.isolate : iso0)));
        const cut = newBatch();
        for (const it of items) if (it.net !== net || it.k === 'hole') addToBatch(cut, it);
        // other-net pours on this layer with better (lower) rank also take precedence
        const rank = Math.min(...zones.map((z) => z.src?.rank || 1));
        const others = [];
        for (const [n2, z2] of nets) if (n2 !== net) for (const z of z2) if ((z.src?.rank || 1) < rank) others.push(z);
        const op = new Path2D();
        for (const z of others) { op.moveTo(z.pts[0], z.pts[1]); for (let i = 2; i < z.pts.length; i += 2) op.lineTo(z.pts[i], z.pts[i + 1]); op.closePath(); }
        const width = Math.max(...zones.map((z) => z.w || 0));
        list.push({ net, path: zp, cut, iso, others: others.length ? op : null, width });
      }
      if (list.length) pours.set(layer, list);
    }
  }
  const list = boardLayerList(B);
  const layers = list.map((L) => ({
    key: L.key, name: L.name, color: state.colors?.get(L.key) || L.color, alpha: L.alpha,
    visible: state.visible.has(L.key) ? state.visible.get(L.key) : L.visible,
    batch: batches.get(L.key) || newBatch(), order: boardLayerOrder(L.key, state.flip), zoneAlpha: 0.32,
    minLine: 1, pours: pours.get(L.key),
  }));
  if (state.activeLayer !== undefined) {
    const al = layers.find((l) => l.key === state.activeLayer);
    if (al) al.order = al.key >= 1 && al.key <= 16 ? 140 : 1000;
    if (state.highContrast) for (const l of layers) if (l.key !== state.activeLayer && l.key !== 17 && l.key !== 18) l.dimmed = true;
  }
  layers.sort((a, b) => a.order - b.order);
  return {
    background: KICAD_PCB_COLORS.background, gridColor: '#3a4a5c', holeColor: '#0b1520', layers, bbox: B.bbox,
    gridSteps: [0.0254, 0.05, 0.1, 0.127, 0.25, 0.5, 0.635, 1, 1.27, 2.54, 5, 10, 25.4, 50, 100],
  };
}

export function boardHit(B, x, y, scene, tol) {
  const vis = new Set(scene.layers.filter((l) => l.visible).map((l) => l.key));
  // pass 1: copper with nets (topmost first)
  const order = new Map(scene.layers.map((l, i) => [l.key, i]));
  let best = null, bestOrder = -1;
  for (const s of B.shapes) {
    const key = boardShapeKey(s);
    if (!vis.has(key)) continue;
    let hit = false;
    switch (s.k) {
      case 'pad': {
        const o = padOutline(s);
        hit = o.circle ? Math.hypot(x - o.circle[0], y - o.circle[1]) <= o.circle[2] + tol : pointInPoly(x, y, o.pts);
        break;
      }
      case 'via': hit = Math.hypot(x - s.x, y - s.y) <= s.d / 2 + tol; break;
      case 'seg': if (s.net) hit = distToSeg(x, y, s.x1, s.y1, s.x2, s.y2) <= s.w / 2 + tol; break;
      case 'arc': if (s.net) { const d = Math.hypot(x - s.cx, y - s.cy); if (Math.abs(d - s.r) <= s.w / 2 + tol) { let a = Math.atan2(y - s.cy, x - s.cx); while (a < s.a0) a += 2 * Math.PI; hit = a <= s.a1; } } break;
      case 'poly': if (s.zone) hit = pointInPoly(x, y, s.pts); break;
      default: break;
    }
    if (!hit) continue;
    let o = order.get(key) ?? 0;
    if (s.k === 'poly') o -= 1000; // zones lowest priority
    if (s.k === 'pad' || s.k === 'via') o += 1000;
    if (o > bestOrder) { best = s; bestOrder = o; }
  }
  let comp = null;
  for (const el of B.elements) {
    const side = el.rot.mirror ? 16 : 1;
    if (!vis.has(side) && !vis.has(el.rot.mirror ? 22 : 21) && !vis.has(17)) continue;
    if (el.bbox.contains(x, y, tol)) if (!comp || el.bbox.area() < comp.bbox.area()) comp = el;
  }
  return { shape: best, element: best?.owner ? B.elements.find((e) => e.name === best.owner) : comp, comp };
}

// ------------------------------------------------------------------ schematic
export function schShapeKey(s) {
  if (s.k === 'text') {
    if (s.label) return 'labels';
    if (s.layer === 'pinname' || s.layer === 'pinnum') return s.layer;
    if (s.attr === 'NAME' || s.src === '>NAME') return 'refs';
    if (s.attr === 'VALUE' || s.src === '>VALUE') return 'values';
    if (s.layer === 95) return 'refs';
    if (s.layer === 96) return 'values';
    return s.inst || s.owner ? 'symtext' : `t${s.layer}`;
  }
  if (s.k === 'pinpt') return null;
  return s.layer;
}

const SCH_KEY_INFO = {
  labels: ['Net labels', SCH_COLORS.label], pinname: ['Pin names', SCH_COLORS.pinName], pinnum: ['Pin numbers', SCH_COLORS.pinNum],
  refs: ['References', SCH_COLORS.reference], values: ['Values', SCH_COLORS.value], symtext: ['Symbol text', SCH_COLORS.field],
};

export function schLayerList(S, sheet) {
  const keys = new Set();
  for (const s of sheet.shapes) { const k = schShapeKey(s); if (k !== null) keys.add(k); }
  return [...keys].map((k) => {
    if (SCH_KEY_INFO[k]) return { key: k, name: SCH_KEY_INFO[k][0], color: SCH_KEY_INFO[k][1], visible: true };
    const num = typeof k === 'string' ? +k.slice(1) : k;
    const info = schLayerInfo(num, S.layers.get(num)?.name);
    return { key: k, name: (typeof k === 'string' ? 'Text: ' : '') + info.name, color: typeof k === 'string' && num === 94 ? SCH_COLORS.symbol : info.color, visible: true };
  });
}

const SCH_ORDER = { 98: 0, 97: 1, 94: 2, 93: 3, 92: 4, 91: 5 };
export function buildSchScene(S, sheet, state) {
  const batches = new Map();
  for (const s of sheet.shapes) {
    const key = schShapeKey(s);
    if (key === null) continue;
    let b = batches.get(key);
    if (!b) { b = newBatch(); batches.set(key, b); }
    addToBatch(b, s);
  }
  const layers = schLayerList(S, sheet).map((L) => ({
    ...L, color: state.colors?.get(L.key) || L.color, visible: state.visible.has(L.key) ? state.visible.get(L.key) : L.visible,
    batch: batches.get(L.key) || newBatch(), order: typeof L.key === 'number' ? (SCH_ORDER[L.key] ?? 2) : 10, minLine: 1,
  }));
  layers.sort((a, b) => a.order - b.order);
  return { background: SCH_COLORS.background, gridColor: '#c9c6bb', layers, bbox: sheet.bbox, gridSteps: [0.635, 1.27, 2.54, 5.08, 12.7, 25.4, 50.8, 127, 254] };
}

export function schHit(sheet, x, y, tol) {
  let best = null;
  for (const h of sheet.hits) {
    if (h.kind === 'wire') {
      const s = h.shape;
      const d = s.k === 'seg' ? distToSeg(x, y, s.x1, s.y1, s.x2, s.y2) : Math.abs(Math.hypot(x - s.cx, y - s.cy) - s.r);
      if (d <= Math.max(s.w / 2, 0.15) + tol) return { net: h.net, shape: s };
    }
  }
  for (const I of sheet.instances) {
    for (const p of I.pins) if (p.net && Math.hypot(x - p.x, y - p.y) <= tol + 0.3) return { net: p.net, inst: I, pin: p };
  }
  for (const s of sheet.shapes) {
    if (s.k === 'text' && s.label && textBox(s).contains(x, y, tol)) return { net: s.net, shape: s };
  }
  for (const h of sheet.hits) {
    if (h.kind === 'instance' && h.bbox.contains(x, y, tol)) if (!best || h.bbox.area() < best.bbox.area()) best = h;
  }
  return best ? { inst: best.inst } : null;
}

export function shapesBBox(shapes) {
  const b = new BBox();
  for (const s of shapes) {
    if (s.k === 'seg') { b.add(s.x1, s.y1); b.add(s.x2, s.y2); }
    else if (s.k === 'text') b.addBox(textBox(s));
    else if (s.x !== undefined) b.add(s.x, s.y, (s.d || s.w || 0) / 2);
    else if (s.pts) for (let i = 0; i < s.pts.length; i += 2) b.add(s.pts[i], s.pts[i + 1]);
    else if (s.cx !== undefined) b.add(s.cx, s.cy, s.r);
  }
  return b;
}
