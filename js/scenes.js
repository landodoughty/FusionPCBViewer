// Builds drawable scenes (layer batches with KiCad-like colors) and hit testing for boards and schematic sheets.
import { newBatch, addToBatch } from './render.js';
import { boardLayerInfo, KICAD_PCB_COLORS, SCH_COLORS, kicadDisplayName, kicadLayerStyle, kicadPanelIndex, kicadDrawOrder } from './layers.js';
import { makeLayerMapper } from './kicad/pcb.js';
import { padOutline } from './eagle.js';
import { distToSeg, pointInPoly, BBox, textBox } from './geom.js';

// ------------------------------------------------------------------ board
// Shapes are grouped by the KiCad layer they map to (same mapping as the KiCad export).
function boardKeyer(B) {
  if (B._keyer) return B._keyer;
  const L = makeLayerMapper(B);
  const names = new Map();
  const key = (n) => {
    if (names.has(n)) return names.get(n);
    let k;
    if (n === 19) k = 'Ratsnest';
    else if (n === 41 || n === 42 || n === 43) k = 'Rule Areas';
    else if (n === 23 || n === 24) k = 'User.Eco1';
    else if ([33, 34, 37, 38, 44, 45].includes(n)) k = 'User.Eco2';
    else k = kicadDisplayName(L.layer(n) || 'Dwgs.User');
    names.set(n, k);
    return k;
  };
  B._keyer = { key, nInner: L.nInner, sources: new Map() };
  for (const s of B.shapes) {
    const k = boardShapeKey(s, B._keyer);
    if (typeof s.layer === 'number' && !(s.k === 'pad' && s.th)) {
      if (!B._keyer.sources.has(k)) B._keyer.sources.set(k, new Set());
      B._keyer.sources.get(k).add(B.layers.get(s.layer)?.name || boardLayerInfo(s.layer).name);
    }
  }
  return B._keyer;
}

export function boardShapeKey(s, keyer) {
  if (s._key) return s._key;
  if (!keyer) return undefined;
  let k;
  if (s.k === 'pad') k = s.th ? 'Pads' : keyer.key(s.layer);
  else if (s.k === 'via') k = 'Vias';
  else if (s.k === 'hole') k = 'Pads';
  else k = keyer.key(s.layer);
  s._key = k;
  return k;
}

export function boardLayerList(B) {
  const keyer = boardKeyer(B);
  const keys = new Set(['F.Cu', 'B.Cu', 'Pads', 'Vias', 'Edge.Cuts']);
  for (const s of B.shapes) keys.add(boardShapeKey(s, keyer));
  for (let i = 1; i <= keyer.nInner; i++) keys.add(`In${i}.Cu`);
  return [...keys].map((k) => ({ key: k, name: k, ...kicadLayerStyle(k), sources: [...(keyer.sources.get(k) || [])] }));
}

export function buildBoardScene(B, state) {
  const keyer = boardKeyer(B);
  const batches = new Map();
  for (const s of B.shapes) {
    const key = boardShapeKey(s, keyer);
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
      if (list.length) pours.set(keyer.key(layer), list);
    }
  }
  const list = boardLayerList(B);
  const layers = list.map((L) => ({
    key: L.key, name: L.name, sources: L.sources, color: state.colors?.get(L.key) || L.color, alpha: L.alpha,
    visible: state.visible.has(L.key) ? state.visible.get(L.key) : L.visible,
    batch: batches.get(L.key) || newBatch(), order: kicadDrawOrder(L.key, state.flip, keyer.nInner), panel: kicadPanelIndex(L.key), zoneAlpha: 0.32,
    minLine: 1, pours: pours.get(L.key),
  }));
  if (state.activeLayer !== undefined) {
    const al = layers.find((l) => l.key === state.activeLayer);
    if (al) al.order = /\.Cu$/.test(al.key) ? 140 : 1000;
    if (state.highContrast) for (const l of layers) if (l.key !== state.activeLayer && l.key !== 'Pads' && l.key !== 'Vias') l.dimmed = true;
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
    const key = boardShapeKey(s, boardKeyer(B));
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
    const side = el.rot.mirror ? 'B.' : 'F.';
    if (!vis.has(side + 'Cu') && !vis.has(side + 'Silkscreen') && !vis.has(side + 'Fab') && !vis.has('Pads')) continue;
    if (el.bbox.contains(x, y, tol)) if (!comp || el.bbox.area() < comp.bbox.area()) comp = el;
  }
  return { shape: best, element: best?.owner ? B.elements.find((e) => e.name === best.owner) : comp, comp };
}

// ------------------------------------------------------------------ schematic
// Keys use the item names from KiCad's schematic Appearance panel.
export function schShapeKey(s) {
  if (s.k === 'pinpt') return null;
  if (s.label || (s.net && s.k === 'poly')) return 'Labels';
  if (s.junction) return 'Junctions';
  if (s.k === 'text') {
    if (s.layer === 'pinname') return 'Pin names';
    if (s.layer === 'pinnum') return 'Pin numbers';
    if (s.attr === 'NAME' || s.src === '>NAME' || s.layer === 95) return 'Symbol references';
    if (s.attr === 'VALUE' || s.src === '>VALUE' || s.layer === 96) return 'Symbol values';
    return s.inst || s.owner ? 'Symbol fields' : 'Notes';
  }
  if (s.layer === 91) return 'Wires';
  if (s.layer === 92) return 'Buses';
  if (s.layer === 93) return 'Pins';
  if (s.layer === 90) return 'Sheet borders';
  if (s.layer === 94 || s.inst || s.owner) return 'Symbol body outlines';
  return 'Notes';
}

const SCH_KEYS = [
  ['Wires', SCH_COLORS.wire], ['Buses', SCH_COLORS.bus], ['Junctions', SCH_COLORS.junction], ['Labels', SCH_COLORS.label],
  ['Pins', SCH_COLORS.pin], ['Pin names', SCH_COLORS.pinName], ['Pin numbers', SCH_COLORS.pinNum],
  ['Symbol references', SCH_COLORS.reference], ['Symbol values', SCH_COLORS.value], ['Symbol fields', SCH_COLORS.field],
  ['Symbol body outlines', SCH_COLORS.symbol], ['Sheet borders', SCH_COLORS.sheet], ['Notes', SCH_COLORS.notes],
];
const SCH_DRAW = ['Notes', 'Sheet borders', 'Symbol body outlines', 'Pins', 'Buses', 'Wires', 'Junctions'];

export function schLayerList(S, sheet) {
  const keys = new Set();
  for (const s of sheet.shapes) { const k = schShapeKey(s); if (k !== null) keys.add(k); }
  return SCH_KEYS.filter(([k]) => keys.has(k)).map(([k, color], i) => ({ key: k, name: k, color, visible: true, panel: i }));
}

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
    batch: batches.get(L.key) || newBatch(), order: SCH_DRAW.includes(L.key) ? SCH_DRAW.indexOf(L.key) : 10, minLine: 1,
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
