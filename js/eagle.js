// EAGLE / Fusion Electronics XML → resolved, renderable model (schematic + board).
import { kids, kid, path } from './xml.js';
import {
  num, parseRot, normDeg, xf, composeRot, xfAngle, arcFromCurve, arcPoints, BBox, parseAlign, makeText, textBox, DEG,
} from './geom.js';
import { mirrorLayer, boardLayerInfo, schLayerInfo } from './layers.js';

const yes = (v, d = false) => (v === undefined ? d : v === 'yes' || v === 'true' || v === '1');

// ---------------------------------------------------------------- primitives
export function parsePrim(n) {
  const a = n.attrs;
  switch (n.tag) {
    case 'wire':
      return { t: 'wire', x1: num(a.x1), y1: num(a.y1), x2: num(a.x2), y2: num(a.y2), w: num(a.width), layer: +a.layer, curve: num(a.curve), style: a.style || 'continuous', cap: a.cap || 'round' };
    case 'circle':
      return { t: 'circle', x: num(a.x), y: num(a.y), r: num(a.radius), w: num(a.width), layer: +a.layer };
    case 'rectangle':
      return { t: 'rect', x1: num(a.x1), y1: num(a.y1), x2: num(a.x2), y2: num(a.y2), layer: +a.layer, rot: parseRot(a.rot) };
    case 'polygon':
      return {
        t: 'poly', w: num(a.width), layer: +a.layer, spacing: num(a.spacing), pour: a.pour || 'solid', isolate: num(a.isolate, NaN),
        orphans: yes(a.orphans), thermals: yes(a.thermals, true), rank: num(a.rank, 0),
        verts: kids(n, 'vertex').map((v) => ({ x: num(v.attrs.x), y: num(v.attrs.y), curve: num(v.attrs.curve) })),
      };
    case 'text':
      return { t: 'text', x: num(a.x), y: num(a.y), size: num(a.size, 1.778), layer: +a.layer, ratio: num(a.ratio, 8), rot: parseRot(a.rot), align: parseAlign(a.align), dist: num(a.distance, 50), font: a.font || 'proportional', value: n.text || '' };
    case 'pin':
      return { t: 'pin', name: a.name || '', x: num(a.x), y: num(a.y), visible: a.visible || 'both', length: a.length || 'long', direction: a.direction || 'io', func: a.function || 'none', rot: parseRot(a.rot), swaplevel: num(a.swaplevel) };
    case 'pad':
      return { t: 'pad', name: a.name || '', x: num(a.x), y: num(a.y), drill: num(a.drill), diameter: num(a.diameter), shape: a.shape || 'round', rot: parseRot(a.rot), stop: yes(a.stop, true), thermals: yes(a.thermals, true), first: yes(a.first) };
    case 'smd':
      return { t: 'smd', name: a.name || '', x: num(a.x), y: num(a.y), dx: num(a.dx), dy: num(a.dy), layer: +a.layer || 1, roundness: num(a.roundness), rot: parseRot(a.rot), stop: yes(a.stop, true), cream: yes(a.cream, true), thermals: yes(a.thermals, true) };
    case 'hole':
      return { t: 'hole', x: num(a.x), y: num(a.y), drill: num(a.drill) };
    case 'frame':
      return { t: 'frame', x1: num(a.x1), y1: num(a.y1), x2: num(a.x2), y2: num(a.y2), columns: num(a.columns, 6), rows: num(a.rows, 4), layer: +a.layer, borders: { left: yes(a['border-left'], true), top: yes(a['border-top'], true), right: yes(a['border-right'], true), bottom: yes(a['border-bottom'], true) } };
    case 'dimension':
      return { t: 'dim', x1: num(a.x1), y1: num(a.y1), x2: num(a.x2), y2: num(a.y2), x3: num(a.x3), y3: num(a.y3), layer: +a.layer, dtype: a.dtype || 'parallel', w: num(a.width, 0.13), extw: num(a.extwidth), textsize: num(a.textsize, 1.27), unit: a.unit || 'mm', precision: num(a.precision, 2) };
    default:
      return null;
  }
}

function parseItems(node) {
  return node ? node.children.map(parsePrim).filter(Boolean) : [];
}

// ---------------------------------------------------------------- libraries
export function parseLibrary(libNode, nameOverride) {
  const lib = {
    name: nameOverride ?? libNode.attrs.name ?? 'library',
    urn: libNode.attrs.urn || '',
    description: kid(libNode, 'description')?.text || '',
    packages: new Map(), symbols: new Map(), devicesets: new Map(),
  };
  for (const p of kids(kid(libNode, 'packages'), 'package')) {
    lib.packages.set(p.attrs.name, { name: p.attrs.name, urn: p.attrs.urn || '', description: kid(p, 'description')?.text || '', items: parseItems(p) });
  }
  for (const s of kids(kid(libNode, 'symbols'), 'symbol')) {
    lib.symbols.set(s.attrs.name, { name: s.attrs.name, items: parseItems(s) });
  }
  for (const ds of kids(kid(libNode, 'devicesets'), 'deviceset')) {
    const d = {
      name: ds.attrs.name, prefix: ds.attrs.prefix || '', uservalue: yes(ds.attrs.uservalue),
      description: kid(ds, 'description')?.text || '',
      gates: kids(kid(ds, 'gates'), 'gate').map((g) => ({ name: g.attrs.name, symbol: g.attrs.symbol, x: num(g.attrs.x), y: num(g.attrs.y), addlevel: g.attrs.addlevel || 'next', swaplevel: num(g.attrs.swaplevel) })),
      devices: new Map(),
    };
    for (const dev of kids(kid(ds, 'devices'), 'device')) {
      const connects = kids(kid(dev, 'connects'), 'connect').map((c) => ({ gate: c.attrs.gate, pin: c.attrs.pin, pads: (c.attrs.pad || '').split(/\s+/).filter(Boolean), route: c.attrs.route || 'all' }));
      const techs = new Map();
      for (const t of kids(kid(dev, 'technologies'), 'technology')) {
        const at = {};
        for (const x of kids(t, 'attribute')) at[x.attrs.name] = x.attrs.value ?? '';
        techs.set(t.attrs.name || '', at);
      }
      d.devices.set(dev.attrs.name || '', { name: dev.attrs.name || '', package: dev.attrs.package || '', connects, techs });
    }
    lib.devicesets.set(d.name, d);
  }
  return lib;
}

export function parseLibraries(node) {
  const map = new Map();
  for (const l of kids(node, 'library')) {
    const lib = parseLibrary(l);
    map.set(`${lib.name}|${lib.urn}`, lib);
    if (!map.has(lib.name)) map.set(lib.name, lib);
  }
  return map;
}
const findLib = (libs, name, urn) => libs.get(`${name}|${urn || ''}`) || libs.get(name);

function attrMap(node) {
  const m = {};
  for (const a of kids(node, 'attribute')) m[a.attrs.name] = a.attrs.value ?? '';
  return m;
}

function layerTable(drawing, infoFn) {
  const m = new Map();
  for (const l of kids(kid(drawing, 'layers'), 'layer')) {
    const info = infoFn(l.attrs.number, l.attrs.name);
    info.eagleVisible = yes(l.attrs.visible, true);
    info.active = yes(l.attrs.active, true);
    m.set(+l.attrs.number, info);
  }
  return m;
}

// ---------------------------------------------------------------- shape emitter
// Shapes (absolute, Eagle coordinates):
//   seg {x1,y1,x2,y2,w}  arc {cx,cy,r,a0,a1,w}  circle {x,y,r,w(0=filled)}
//   poly {pts,w,fill}  text {...}  pad {...}  via {...}  hole {...}
function polyFromVerts(verts, t, mirror) {
  const pts = [];
  const tv = verts.map((v) => { const [x, y] = xf(t, v.x, v.y); return { x, y, curve: mirror ? -v.curve : v.curve }; });
  for (let i = 0; i < tv.length; i++) {
    const v = tv[i], nx = tv[(i + 1) % tv.length];
    if (v.curve) {
      const arc = arcFromCurve(v.x, v.y, nx.x, nx.y, v.curve);
      let p = arcPoints(arc);
      if (v.curve < 0) { // arc points are CCW from a0 (=end) — reverse
        const r = [];
        for (let k = p.length - 2; k >= 0; k -= 2) r.push(p[k], p[k + 1]);
        p = r;
      }
      pts.push(...p.slice(0, -2));
    } else pts.push(v.x, v.y);
  }
  return pts;
}

function rectPts(p, t) {
  const cx = (p.x1 + p.x2) / 2, cy = (p.y1 + p.y2) / 2;
  const hw = Math.abs(p.x2 - p.x1) / 2, hh = Math.abs(p.y2 - p.y1) / 2;
  const rt = { x: cx, y: cy, angle: p.rot.angle, mirror: false };
  const out = [];
  for (const [lx, ly] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) {
    const [ax, ay] = xf(rt, lx, ly);
    const [bx, by] = xf(t, ax, ay);
    out.push(bx, by);
  }
  return out;
}

export function wireShape(p, t, layer) {
  const [x1, y1] = xf(t, p.x1, p.y1);
  const [x2, y2] = xf(t, p.x2, p.y2);
  const mirror = t && t.mirror;
  if (p.curve) {
    const curve = mirror ? -p.curve : p.curve;
    const arc = arcFromCurve(x1, y1, x2, y2, curve);
    return { k: 'arc', ...arc, w: p.w, layer, x1, y1, x2, y2, curve, style: p.style };
  }
  return { k: 'seg', x1, y1, x2, y2, w: p.w, layer, style: p.style };
}

function frameShapes(p, t, layer, out, sheetLabel) {
  const [ax, ay] = xf(t, p.x1, p.y1), [bx, by] = xf(t, p.x2, p.y2);
  const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
  const w = 0.2;
  const rect = (a, b, c, d) => out.push({ k: 'poly', pts: [a, b, c, b, c, d, a, d], w, fill: false, layer });
  rect(x0, y0, x1, y1);
  const bs = Math.min(4, Math.min(x1 - x0, y1 - y0) / 20);
  const ix0 = x0 + (p.borders.left ? bs : 0), ix1 = x1 - (p.borders.right ? bs : 0);
  const iy0 = y0 + (p.borders.bottom ? bs : 0), iy1 = y1 - (p.borders.top ? bs : 0);
  rect(ix0, iy0, ix1, iy1);
  const cols = Math.max(1, p.columns), rows = Math.max(1, p.rows);
  const ts = bs * 0.5;
  for (let i = 0; i < cols; i++) {
    const cx0 = ix0 + ((ix1 - ix0) * i) / cols, cx1 = ix0 + ((ix1 - ix0) * (i + 1)) / cols;
    if (i > 0) {
      if (p.borders.top) out.push({ k: 'seg', x1: cx0, y1: iy1, x2: cx0, y2: y1, w, layer });
      if (p.borders.bottom) out.push({ k: 'seg', x1: cx0, y1: y0, x2: cx0, y2: iy0, w, layer });
    }
    const lab = String(i + 1);
    if (p.borders.top) out.push(makeText(lab, (cx0 + cx1) / 2, (iy1 + y1) / 2, ts, { angle: 0 }, { h: 0, v: 0 }, { layer }, false));
    if (p.borders.bottom) out.push(makeText(lab, (cx0 + cx1) / 2, (iy0 + y0) / 2, ts, { angle: 0 }, { h: 0, v: 0 }, { layer }, false));
  }
  for (let j = 0; j < rows; j++) {
    const cy1 = iy1 - ((iy1 - iy0) * j) / rows, cy0 = iy1 - ((iy1 - iy0) * (j + 1)) / rows;
    if (j > 0) {
      if (p.borders.left) out.push({ k: 'seg', x1: x0, y1: cy1, x2: ix0, y2: cy1, w, layer });
      if (p.borders.right) out.push({ k: 'seg', x1: ix1, y1: cy1, x2: x1, y2: cy1, w, layer });
    }
    const lab = String.fromCharCode(65 + (j % 26));
    if (p.borders.left) out.push(makeText(lab, (x0 + ix0) / 2, (cy0 + cy1) / 2, ts, { angle: 0 }, { h: 0, v: 0 }, { layer }, false));
    if (p.borders.right) out.push(makeText(lab, (ix1 + x1) / 2, (cy0 + cy1) / 2, ts, { angle: 0 }, { h: 0, v: 0 }, { layer }, false));
  }
}

function dimShapes(p, t, layer, out, mirrorGlyphs) {
  const [x1, y1] = xf(t, p.x1, p.y1), [x2, y2] = xf(t, p.x2, p.y2), [x3, y3] = xf(t, p.x3, p.y3);
  const w = p.w || 0.13;
  let len, ax1 = x1, ay1 = y1, ax2 = x2, ay2 = y2;
  if (p.dtype === 'horizontal') { len = Math.abs(x2 - x1); ay1 = ay2 = y3; }
  else if (p.dtype === 'vertical') { len = Math.abs(y2 - y1); ax1 = ax2 = x3; }
  else if (p.dtype === 'radius' || p.dtype === 'diameter') { len = Math.hypot(x2 - x1, y2 - y1) * (p.dtype === 'diameter' ? 2 : 1); }
  else {
    len = Math.hypot(x2 - x1, y2 - y1);
    const dx = x2 - x1, dy = y2 - y1, L = len || 1;
    const nx = -dy / L, ny = dx / L;
    const off = (x3 - x1) * nx + (y3 - y1) * ny;
    ax1 = x1 + nx * off; ay1 = y1 + ny * off; ax2 = x2 + nx * off; ay2 = y2 + ny * off;
  }
  out.push({ k: 'seg', x1: ax1, y1: ay1, x2: ax2, y2: ay2, w, layer });
  out.push({ k: 'seg', x1, y1, x2: ax1, y2: ay1, w: w / 2, layer });
  out.push({ k: 'seg', x1: x2, y1: y2, x2: ax2, y2: ay2, w: w / 2, layer });
  const val = p.unit === 'inch' ? len / 25.4 : p.unit === 'mil' ? len / 0.0254 : p.unit === 'mic' ? len * 1000 : len;
  const ang = Math.atan2(ay2 - ay1, ax2 - ax1) / DEG;
  out.push(makeText(`${val.toFixed(p.precision)}${p.unit === 'mm' ? '' : ' ' + p.unit}`, (ax1 + ax2) / 2, (ay1 + ay2) / 2 + 0.3, p.textsize, { angle: normDeg(ang) }, { h: 0, v: -1 }, { layer }, mirrorGlyphs));
}

/** Emits generic (non pad/pin) primitive into shapes. */
export function emitGeneric(p, t, layer, out, mirrorGlyphs, textResolve) {
  const mirror = !!(t && t.mirror);
  switch (p.t) {
    case 'wire': out.push(wireShape(p, t, layer)); break;
    case 'circle': { const [x, y] = xf(t, p.x, p.y); out.push({ k: 'circle', x, y, r: p.r, w: p.w, layer }); break; }
    case 'rect': out.push({ k: 'poly', pts: rectPts(p, t), w: 0, fill: true, layer }); break;
    case 'poly': out.push({ k: 'poly', pts: polyFromVerts(p.verts, t, mirror), w: p.w, fill: true, layer, pour: p.pour }); break;
    case 'text': {
      const str = textResolve ? textResolve(p.value, p) : p.value;
      if (str === null || str === undefined || str === '') break;
      const [x, y] = xf(t, p.x, p.y);
      const rot = t ? composeRot(t, p.rot) : p.rot;
      out.push(makeText(str, x, y, p.size, rot, p.align, { layer, ratio: p.ratio, dist: p.dist, src: p.value }, mirrorGlyphs));
      break;
    }
    case 'frame': frameShapes(p, t, layer, out); break;
    case 'dim': dimShapes(p, t, layer, out, mirrorGlyphs); break;
    default: break;
  }
}

// ---------------------------------------------------------------- design rules
const UNIT_MM = { mil: 0.0254, mm: 1, mic: 0.001, um: 0.001, in: 25.4, inch: 25.4 };
export function parseLen(s, d) {
  if (s === undefined || s === null) return d;
  const m = /^\s*(-?[\d.]+)\s*([a-z]*)/i.exec(String(s));
  if (!m) return d;
  return parseFloat(m[1]) * (UNIT_MM[m[2].toLowerCase()] ?? 1);
}

export function parseDesignRules(node) {
  const params = {};
  for (const p of kids(node, 'param')) params[p.attrs.name] = p.attrs.value;
  const first = (s) => String(s ?? '').trim().split(/\s+/)[0];
  const r = {
    params,
    rvPadTop: num(first(params.rvPadTop), 0.25), rlMinPadTop: parseLen(first(params.rlMinPadTop), 0.254), rlMaxPadTop: parseLen(first(params.rlMaxPadTop), 0.508),
    rvViaOuter: num(first(params.rvViaOuter), 0.25), rlMinViaOuter: parseLen(first(params.rlMinViaOuter), 0.2032), rlMaxViaOuter: parseLen(first(params.rlMaxViaOuter), 0.508),
    psElongationLong: num(params.psElongationLong, 100), psElongationOffset: num(params.psElongationOffset, 100),
    srRoundness: num(params.srRoundness, 0), srMinRoundness: parseLen(params.srMinRoundness, 0), srMaxRoundness: parseLen(params.srMaxRoundness, 0),
    mvStopFrame: num(params.mvStopFrame, 1), mlMinStopFrame: parseLen(params.mlMinStopFrame, 0.1016), mlMaxStopFrame: parseLen(params.mlMaxStopFrame, 0.1016),
    mdWireWire: parseLen(params.mdWireWire, 0.2032), mlViaStopLimit: parseLen(params.mlViaStopLimit, 0),
    msDrill: parseLen(params.msDrill, 0.6096), msWidth: parseLen(params.msWidth, 0.254),
    psTop: num(params.psTop, -1), psBottom: num(params.psBottom, -1), psFirst: num(params.psFirst, -1),
    layerSetup: params.layerSetup || '',
  };
  return r;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function padDiameter(pad, dr) {
  const ring = clamp(pad.drill * dr.rvPadTop, dr.rlMinPadTop, dr.rlMaxPadTop);
  return Math.max(pad.diameter || 0, pad.drill + 2 * ring);
}
export function viaDiameter(drill, diameter, dr) {
  const ring = clamp(drill * dr.rvViaOuter, dr.rlMinViaOuter, dr.rlMaxViaOuter);
  return Math.max(diameter || 0, drill + 2 * ring);
}

// ---------------------------------------------------------------- board
export function buildBoard(doc) {
  const drawing = kid(doc.root, 'drawing');
  const board = kid(drawing, 'board');
  const layers = layerTable(drawing, boardLayerInfo);
  const libs = parseLibraries(kid(board, 'libraries'));
  const dr = parseDesignRules(kid(board, 'designrules'));
  const B = {
    kind: 'board', name: doc.name, layers, libs, dr, elements: [], shapes: [], nets: new Map(),
    classes: kids(kid(board, 'classes'), 'class').map((c) => ({ number: +c.attrs.number, name: c.attrs.name, width: num(c.attrs.width), drill: num(c.attrs.drill), clearances: kids(c, 'clearance').map((x) => ({ cls: +x.attrs.class, value: num(x.attrs.value) })) })),
    plain: parseItems(kid(board, 'plain')), signals: [], warnings: [], usedLayers: new Set(), attributes: attrMap(kid(board, 'attributes')),
  };
  const ensureLayer = (n) => { if (!layers.has(n)) layers.set(n, boardLayerInfo(n)); B.usedLayers.add(n); };

  // signals: pad -> net
  const padNet = new Map();
  for (const s of kids(kid(board, 'signals'), 'signal')) {
    const sig = {
      name: s.attrs.name, cls: num(s.attrs.class), airwireshidden: yes(s.attrs.airwireshidden),
      contacts: kids(s, 'contactref').map((c) => ({ element: c.attrs.element, pad: c.attrs.pad })),
      items: s.children.map((c) => {
        if (c.tag === 'via') return { t: 'via', x: num(c.attrs.x), y: num(c.attrs.y), extent: c.attrs.extent || '1-16', drill: num(c.attrs.drill), diameter: num(c.attrs.diameter), shape: c.attrs.shape || 'round', alwaysstop: yes(c.attrs.alwaysstop) };
        return parsePrim(c);
      }).filter(Boolean),
    };
    B.signals.push(sig);
    for (const c of sig.contacts) padNet.set(`${c.element}\u0000${c.pad}`, sig.name);
    B.nets.set(sig.name, { name: sig.name, cls: sig.cls, shapes: [] });
  }

  const push = (sh, net) => {
    if (net) { sh.net = net; B.nets.get(net)?.shapes.push(sh); }
    if (typeof sh.layer === 'number') ensureLayer(sh.layer);
    B.shapes.push(sh);
    return sh;
  };

  // elements
  for (const e of kids(kid(board, 'elements'), 'element')) {
    const a = e.attrs;
    const rot = parseRot(a.rot);
    const t = { x: num(a.x), y: num(a.y), angle: rot.angle, mirror: rot.mirror };
    const lib = findLib(libs, a.library, a.library_urn);
    const pkg = lib?.packages.get(a.package);
    const el = {
      name: a.name, value: a.value ?? '', library: a.library, libraryUrn: a.library_urn || '', package: a.package, packageUrn: a.package3d_urn || '',
      x: t.x, y: t.y, rot, locked: yes(a.locked), smashed: yes(a.smashed), populate: yes(a.populate, true),
      attrs: {}, attrDefs: [], shapes: [], pads: [], bbox: new BBox(), pkg, lib,
    };
    for (const at of kids(e, 'attribute')) {
      const aa = at.attrs;
      el.attrs[aa.name] = aa.value ?? (aa.name === 'NAME' ? el.name : aa.name === 'VALUE' ? el.value : '');
      el.attrDefs.push({ name: aa.name, value: aa.value, x: aa.x !== undefined ? num(aa.x) : undefined, y: aa.y !== undefined ? num(aa.y) : undefined, size: num(aa.size, 1.27), layer: aa.layer !== undefined ? +aa.layer : undefined, ratio: num(aa.ratio, 8), rot: parseRot(aa.rot), align: parseAlign(aa.align), display: aa.display || 'value', font: aa.font, constant: aa.constant });
    }
    if (!pkg) { B.warnings.push(`Package ${a.package} for ${a.name} not found in library ${a.library}`); }
    for (const sh of emitElement(el, pkg, t, dr, padNet)) { el.shapes.push(sh); push(sh, sh.net); }
    if (!el.bbox.valid) el.bbox.add(t.x, t.y, 0.5);
    B.elements.push(el);
  }

  // plain
  for (const p of B.plain) {
    if (p.t === 'hole') { push({ k: 'hole', x: p.x, y: p.y, d: p.drill, layer: 45, plated: false }); continue; }
    const tmp = [];
    emitGeneric(p, null, p.layer, tmp, true, null);
    tmp.forEach((s) => push(s));
  }

  // signals geometry
  for (const sig of B.signals) {
    for (const p of sig.items) {
      if (p.t === 'via') {
        const d = viaDiameter(p.drill, p.diameter, dr);
        push({ k: 'via', x: p.x, y: p.y, d, drill: p.drill, extent: p.extent, shape: p.shape, layer: 18 }, sig.name);
      } else if (p.t === 'wire') {
        push(wireShape(p, null, p.layer), sig.name);
      } else if (p.t === 'poly') {
        push({ k: 'poly', pts: polyFromVerts(p.verts, null, false), w: p.w, fill: true, zone: true, layer: p.layer, src: p }, sig.name);
      }
    }
  }

  // bbox: prefer board outline
  const outline = new BBox(), all = new BBox();
  for (const s of B.shapes) {
    if (s.layer === 20 || s.layer === 46) addBBox(outline, s);
    addBBox(all, s);
  }
  B.outline = outline.valid ? outline : null;
  B.allBBox = all.valid ? all : new BBox().add(0, 0, 10);
  // zoom-to-fit frames the board outline (like looking at the board), not far-away notes
  if (outline.valid) {
    const m = Math.max(outline.w, outline.h) * 0.04 + 1;
    B.bbox = new BBox().add(outline.x0 - m, outline.y0 - m).add(outline.x1 + m, outline.y1 + m);
  } else B.bbox = B.allBBox;
  return B;
}


/** Resolves a package placed as element `el` with transform t into absolute shapes (pads get nets from padNet). */
export function emitElement(el, pkg, t, dr, padNet = new Map()) {
  const resolveText = (s) => {
    if (!s.startsWith('>')) return s;
    const key = s.slice(1).toUpperCase();
    if (key === 'NAME') return el.name;
    if (key === 'VALUE') return el.value;
    return el.attrs[key] ?? el.attrs[s.slice(1)] ?? '';
  };
  const smashedNames = new Set(el.smashed ? el.attrDefs.filter((d) => d.x !== undefined).map((d) => d.name.toUpperCase()) : []);
  const out = [];
  const addShape = (sh) => { sh.owner = el.name; out.push(sh); };
  for (const p of pkg?.items || []) {
    const lay = t.mirror ? mirrorLayer(p.layer) : p.layer;
    if (p.t === 'pad') {
      const [x, y] = xf(t, p.x, p.y);
      const d = padDiameter(p, dr);
      const ang = xfAngle(t, p.rot.angle);
      let shape = 'circle', w = d, h = d, ox = 0;
      if (p.shape === 'square') shape = 'rect';
      else if (p.shape === 'octagon') shape = 'oct';
      else if (p.shape === 'long') { shape = 'oval'; w = d * (1 + dr.psElongationLong / 100); }
      else if (p.shape === 'offset') { shape = 'oval'; w = d * (1 + dr.psElongationOffset / 100); ox = (w - d) / 2; }
      const net = padNet.get(`${el.name}\u0000${p.name}`);
      const cx = x + ox * Math.cos(ang * DEG), cy = y + ox * Math.sin(ang * DEG);
      const pad = { k: 'pad', th: true, name: p.name, shape, x: cx, y: cy, hx: x, hy: y, w, h, angle: ang, drill: p.drill, layer: 17, stop: p.stop, thermals: p.thermals, src: p, offset: ox, local: { x: p.x, y: p.y } };
      el.pads.push(pad);
      addShape(Object.assign(pad, net ? { net } : {}));
      el.bbox.add(cx, cy, w / 2);
    } else if (p.t === 'smd') {
      const [x, y] = xf(t, p.x, p.y);
      const ang = xfAngle(t, p.rot.angle);
      let rr = 0;
      const rnd = Math.max(p.roundness, dr.srRoundness ? dr.srRoundness : 0);
      if (rnd) rr = (rnd / 100) * Math.min(p.dx, p.dy) / 2;
      const net = padNet.get(`${el.name}\u0000${p.name}`);
      const pad = { k: 'pad', th: false, name: p.name, shape: rr > 0 ? 'roundrect' : 'rect', x, y, w: p.dx, h: p.dy, angle: ang, rr, layer: lay, stop: p.stop, cream: p.cream, thermals: p.thermals, src: p, local: { x: p.x, y: p.y } };
      el.pads.push(pad);
      addShape(Object.assign(pad, net ? { net } : {}));
      el.bbox.add(x, y, Math.max(p.dx, p.dy) / 2);
    } else if (p.t === 'hole') {
      const [x, y] = xf(t, p.x, p.y);
      addShape({ k: 'hole', x, y, d: p.drill, layer: 45, plated: false });
      el.bbox.add(x, y, p.drill / 2);
    } else if (p.t === 'text') {
      if (p.value.startsWith('>') && smashedNames.has(p.value.slice(1).toUpperCase())) continue;
      const tmp = [];
      emitGeneric(p, t, lay, tmp, true, resolveText);
      tmp.forEach(addShape);
    } else {
      const tmp = [];
      emitGeneric(p, t, lay, tmp, true, resolveText);
      for (const sh of tmp) { addShape(sh); addBBox(el.bbox, sh); }
    }
  }
  // smashed attributes / attribute texts
  for (const d of el.attrDefs) {
    if (d.x === undefined || d.display === 'off' || d.layer === undefined) continue;
    if (!el.smashed && (d.name === 'NAME' || d.name === 'VALUE')) continue;
    const val = d.name === 'NAME' ? el.name : d.name === 'VALUE' ? el.value : (d.value ?? '');
    const str = d.display === 'name' ? d.name : d.display === 'both' ? `${d.name}=${val}` : val;
    if (!str) continue;
    const sh = makeText(str, d.x, d.y, d.size, d.rot, d.align, { layer: d.layer, ratio: d.ratio, attr: d.name }, true);
    addShape(sh);
  }
  return out;
}

export function addBBox(b, s) {
  switch (s.k) {
    case 'seg': b.add(s.x1, s.y1, s.w / 2); b.add(s.x2, s.y2, s.w / 2); break;
    case 'arc': {
      const p = arcPoints(s, 16);
      for (let i = 0; i < p.length; i += 2) b.add(p[i], p[i + 1], s.w / 2);
      break;
    }
    case 'circle': b.add(s.x, s.y, s.r + s.w / 2); break;
    case 'poly': for (let i = 0; i < s.pts.length; i += 2) b.add(s.pts[i], s.pts[i + 1], (s.w || 0) / 2); break;
    case 'pad': b.add(s.x, s.y, Math.max(s.w, s.h) / 2); break;
    case 'via': b.add(s.x, s.y, s.d / 2); break;
    case 'hole': b.add(s.x, s.y, s.d / 2); break;
    case 'text': b.addBox(textBox(s)); break;
    default: break;
  }
}

/** Polygon (flat pts) or circle for a pad shape. */
export function padOutline(p, grow = 0) {
  const w = p.w + 2 * grow, h = p.h + 2 * grow;
  if (p.shape === 'circle' || (p.shape === 'oval' && Math.abs(w - h) < 1e-9)) return { circle: [p.x, p.y, w / 2] };
  const t = { x: p.x, y: p.y, angle: p.angle, mirror: false };
  const pts = [];
  const hw = w / 2, hh = h / 2;
  if (p.shape === 'rect') {
    for (const [x, y] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) pts.push(...xf(t, x, y));
  } else if (p.shape === 'oct') {
    const k = Math.min(hw, hh) - Math.min(hw, hh) / (1 + Math.SQRT2);
    for (const [x, y] of [[-hw + k, -hh], [hw - k, -hh], [hw, -hh + k], [hw, hh - k], [hw - k, hh], [-hw + k, hh], [-hw, hh - k], [-hw, -hh + k]]) pts.push(...xf(t, x, y));
  } else {
    // oval / roundrect: rounded rectangle with radius r
    const r = p.shape === 'oval' ? Math.min(hw, hh) : Math.min(p.rr + grow, hw, hh);
    const corners = [[hw - r, hh - r, 0], [-hw + r, hh - r, 90], [-hw + r, -hh + r, 180], [hw - r, -hh + r, 270]];
    for (const [cx, cy, a0] of corners) {
      for (let i = 0; i <= 8; i++) {
        const a = (a0 + (90 * i) / 8) * DEG;
        pts.push(...xf(t, cx + r * Math.cos(a), cy + r * Math.sin(a)));
      }
    }
  }
  return { pts };
}

// ---------------------------------------------------------------- schematic
const PIN_LEN = { point: 0, short: 2.54, middle: 5.08, long: 7.62 };
export const pinLength = (p) => PIN_LEN[p.length] ?? 7.62;

export function cleanPinName(n) {
  let s = n;
  const at = s.indexOf('@');
  if (at > 0) s = s.slice(0, at);
  return s;
}
/** EAGLE overbar: "!RESET" or "!CS!/WR". Returns plain text without the markers. */
export const stripBang = (s) => s.replace(/!/g, '');

export function deviceFullName(ds, dev, tech) {
  let n = ds.name;
  const t = tech || '';
  n = n.includes('*') ? n.replace('*', t) : n + t;
  n = n.includes('?') ? n.replace('?', dev?.name || '') : n + (dev?.name || '');
  return n;
}

export function buildSchematic(doc) {
  const drawing = kid(doc.root, 'drawing');
  const sch = kid(drawing, 'schematic');
  const layers = layerTable(drawing, schLayerInfo);
  const libs = parseLibraries(kid(sch, 'libraries'));
  const S = {
    kind: 'schematic', name: doc.name, layers, libs, parts: new Map(), sheets: [], nets: new Map(), warnings: [],
    attributes: attrMap(kid(sch, 'attributes')), xreflabel: sch.attrs.xreflabel || '%F%N/%S.%C%R',
    classes: kids(kid(sch, 'classes'), 'class').map((c) => ({ number: +c.attrs.number, name: c.attrs.name, width: num(c.attrs.width), drill: num(c.attrs.drill) })),
    modules: kids(kid(sch, 'modules'), 'module').map((m) => m.attrs.name),
  };
  if (S.modules.length) S.warnings.push('This design uses hierarchical modules; module contents are shown as blocks only.');

  for (const p of kids(kid(sch, 'parts'), 'part')) {
    const a = p.attrs;
    const lib = findLib(libs, a.library, a.library_urn);
    const ds = lib?.devicesets.get(a.deviceset);
    const dev = ds?.devices.get(a.device || '');
    const tech = a.technology || '';
    const techAttrs = dev?.techs.get(tech) || {};
    const attrs = { ...techAttrs, ...attrMap(p) };
    let value = a.value;
    if (value === undefined) value = ds ? (ds.uservalue ? '' : deviceFullName(ds, dev, tech)) : a.deviceset;
    if (!ds) S.warnings.push(`Device ${a.deviceset} for part ${a.name} not found in library ${a.library}`);
    S.parts.set(a.name, { name: a.name, library: a.library, libraryUrn: a.library_urn || '', deviceset: a.deviceset, device: a.device || '', technology: tech, value, attrs, lib, ds, dev, package: dev?.package || '' });
  }

  const sheetNodes = kids(kid(sch, 'sheets'), 'sheet');
  sheetNodes.forEach((sn, idx) => {
    const sheet = { index: idx, description: kid(sn, 'description')?.text || '', shapes: [], instances: [], nets: [], busses: [], plain: parseItems(kid(sn, 'plain')), moduleinsts: [], bbox: new BBox(), hits: [] };
    const sheetTextResolve = (s) => {
      if (!s.startsWith('>')) return s;
      const k = s.slice(1).toUpperCase();
      if (k === 'SHEET') return `${idx + 1}/${sheetNodes.length}`;
      if (k === 'SHEETNR') return String(idx + 1);
      if (k === 'SHEETS') return String(sheetNodes.length);
      if (k === 'DRAWING_NAME') return (doc.name || '').split('/').pop().replace(/\.[^.]+$/, '');
      if (k === 'LAST_DATE_TIME' || k === 'PLOT_DATE_TIME') return '';
      if (k === 'SHEET_DESCRIPTION' || k === 'SHEET_HEADLINE') return sheet.description.replace(/<[^>]+>/g, '');
      return S.attributes[s.slice(1)] ?? '';
    };
    for (const p of sheet.plain) emitGeneric(p, null, p.layer, sheet.shapes, false, sheetTextResolve);

    // nets first, so pins know their nets
    const pinNet = new Map();
    const parseSegs = (node) => kids(node, 'segment').map((sg) => ({
      wires: kids(sg, 'wire').map(parsePrim),
      junctions: kids(sg, 'junction').map((j) => ({ x: num(j.attrs.x), y: num(j.attrs.y) })),
      labels: kids(sg, 'label').map((l) => ({ x: num(l.attrs.x), y: num(l.attrs.y), size: num(l.attrs.size, 1.778), layer: +l.attrs.layer || 95, rot: parseRot(l.attrs.rot), xref: yes(l.attrs.xref), align: parseAlign(l.attrs.align), font: l.attrs.font })),
      pinrefs: kids(sg, 'pinref').map((r) => ({ part: r.attrs.part, gate: r.attrs.gate, pin: r.attrs.pin })),
      portrefs: kids(sg, 'portref').map((r) => ({ moduleinst: r.attrs.moduleinst, port: r.attrs.port })),
    }));
    for (const n of kids(kid(sn, 'nets'), 'net')) {
      const net = { name: n.attrs.name, cls: num(n.attrs.class), segments: parseSegs(n) };
      sheet.nets.push(net);
      if (!S.nets.has(net.name)) S.nets.set(net.name, { name: net.name, sheets: new Set(), cls: net.cls });
      S.nets.get(net.name).sheets.add(idx);
      for (const sg of net.segments) for (const r of sg.pinrefs) pinNet.set(`${r.part}\u0000${r.gate}\u0000${r.pin}`, net.name);
    }
    for (const b of kids(kid(sn, 'busses'), 'bus')) sheet.busses.push({ name: b.attrs.name, segments: parseSegs(b) });

    // instances
    for (const inst of kids(kid(sn, 'instances'), 'instance')) {
      const a = inst.attrs;
      const part = S.parts.get(a.part);
      const rot = parseRot(a.rot);
      const t = { x: num(a.x), y: num(a.y), angle: rot.angle, mirror: rot.mirror };
      const gate = part?.ds?.gates.find((g) => g.name === a.gate);
      const sym = gate ? part.lib.symbols.get(gate.symbol) : null;
      const I = { part: a.part, gate: a.gate, x: t.x, y: t.y, rot, smashed: yes(a.smashed), t, sym, gateDef: gate, partDef: part, attrDefs: [], pins: [], shapes: [], bbox: new BBox(), texts: {} };
      for (const at of kids(inst, 'attribute')) {
        const aa = at.attrs;
        I.attrDefs.push({ name: aa.name, x: aa.x !== undefined ? num(aa.x) : undefined, y: aa.y !== undefined ? num(aa.y) : undefined, size: num(aa.size, 1.778), layer: aa.layer !== undefined ? +aa.layer : undefined, ratio: num(aa.ratio, 8), rot: parseRot(aa.rot), align: parseAlign(aa.align), display: aa.display || 'value', value: aa.value });
      }
      if (!part || !sym) { S.warnings.push(`Cannot resolve symbol for ${a.part} gate ${a.gate}`); sheet.instances.push(I); continue; }
      const multiGate = part.ds.gates.length > 1;
      const fullName = multiGate ? part.name + (a.gate.startsWith('G$') ? '' : a.gate) : part.name;
      I.displayName = fullName;
      const resolve = (s) => {
        if (!s.startsWith('>')) return s;
        const k = s.slice(1).toUpperCase();
        if (k === 'NAME') return fullName;
        if (k === 'VALUE') return part.value;
        if (k === 'PART') return part.name;
        if (k === 'GATE') return a.gate;
        const v = part.attrs[s.slice(1)] ?? part.attrs[k];
        if (v !== undefined) return v;
        return sheetTextResolve(s);
      };
      const smashedNames = new Set(I.smashed ? I.attrDefs.filter((d) => d.x !== undefined).map((d) => d.name.toUpperCase()) : []);
      const add = (sh) => { sh.owner = part.name; sh.inst = I; I.shapes.push(sh); sheet.shapes.push(sh); };
      const connects = part.dev?.connects || [];
      for (const p of sym.items) {
        if (p.t === 'pin') {
          const pads = connects.find((c) => c.gate === a.gate && c.pin === p.name)?.pads || [];
          const net = pinNet.get(`${a.part}\u0000${a.gate}\u0000${p.name}`);
          const pinShapes = pinGraphics(p, t, pads, !!part.dev?.package);
          const [px, py] = xf(t, p.x, p.y);
          I.pins.push({ name: p.name, x: px, y: py, pads, net, def: p });
          for (const sh of pinShapes) { if (net) sh.net = net; sh.pin = p.name; add(sh); addBBox(I.bbox, sh); }
        } else if (p.t === 'text') {
          if (p.value.startsWith('>') && smashedNames.has(p.value.slice(1).toUpperCase())) continue;
          const tmp = [];
          emitGeneric(p, t, p.layer, tmp, false, resolve);
          for (const sh of tmp) {
            add(sh);
            const key = p.value.startsWith('>') ? p.value.slice(1).toUpperCase() : null;
            if (key) I.texts[key] = sh;
          }
        } else {
          const tmp = [];
          emitGeneric(p, t, p.layer, tmp, false, resolve);
          for (const sh of tmp) { add(sh); addBBox(I.bbox, sh); }
        }
      }
      if (I.smashed) {
        for (const d of I.attrDefs) {
          if (d.x === undefined || d.display === 'off') continue;
          const k = d.name.toUpperCase();
          const val = k === 'NAME' ? fullName : k === 'VALUE' ? part.value : k === 'PART' ? part.name : k === 'GATE' ? a.gate : (part.attrs[d.name] ?? d.value ?? '');
          const str = d.display === 'name' ? d.name : d.display === 'both' ? `${d.name}=${val}` : val;
          if (!str) continue;
          const sh = makeText(str, d.x, d.y, d.size, d.rot, d.align, { layer: d.layer ?? (k === 'VALUE' ? 96 : 95), ratio: d.ratio, attr: d.name }, false);
          add(sh);
          I.texts[k] = sh;
        }
      }
      if (!I.bbox.valid) I.bbox.add(t.x, t.y, 1);
      sheet.instances.push(I);
      sheet.hits.push({ kind: 'instance', inst: I, bbox: I.bbox, owner: part.name });
    }

    // module instances (hierarchical designs): draw as boxes
    for (const mi of kids(kid(sn, 'moduleinsts'), 'moduleinst')) {
      const x = num(mi.attrs.x), y = num(mi.attrs.y);
      sheet.moduleinsts.push({ name: mi.attrs.name, module: mi.attrs.module, x, y });
      sheet.shapes.push({ k: 'poly', pts: [x - 10, y - 10, x + 10, y - 10, x + 10, y + 10, x - 10, y + 10], w: 0.254, fill: false, layer: 90 });
      sheet.shapes.push(makeText(`${mi.attrs.name}: ${mi.attrs.module}`, x, y, 1.778, { angle: 0 }, { h: 0, v: 0 }, { layer: 90 }, false));
    }

    // net geometry
    const emitSegs = (owner, isBus) => {
      for (const sg of owner.segments) {
        for (const w of sg.wires) {
          const sh = wireShape(w, null, isBus ? 92 : 91);
          sh.net = owner.name; if (isBus) sh.bus = true;
          sheet.shapes.push(sh);
          sheet.hits.push({ kind: 'wire', shape: sh, net: owner.name });
        }
        for (const j of sg.junctions) sheet.shapes.push({ k: 'circle', x: j.x, y: j.y, r: 0.5, w: 0, layer: isBus ? 92 : 91, net: owner.name, junction: true });
        for (const l of sg.labels) {
          const txt = makeText(owner.name, l.x, l.y, l.size, l.rot, l.align, { layer: l.layer, net: owner.name, label: true, xref: l.xref }, false);
          sheet.shapes.push(txt);
          if (l.xref) {
            const b = textBox(txt), m = l.size * 0.35;
            sheet.shapes.push({ k: 'poly', pts: [b.x0 - m, b.y0 - m, b.x1 + m, b.y0 - m, b.x1 + m, b.y1 + m, b.x0 - m, b.y1 + m], w: 0.1524, fill: false, layer: l.layer, net: owner.name });
          }
        }
      }
    };
    for (const n of sheet.nets) emitSegs(n, false);
    for (const b of sheet.busses) emitSegs(b, true);

    for (const s of sheet.shapes) addBBox(sheet.bbox, s);
    if (!sheet.bbox.valid) sheet.bbox.add(0, 0, 50);
    S.sheets.push(sheet);
  });
  return S;
}

/** Pin line, decorations and labels as shapes, in absolute coordinates. */
function pinGraphics(p, t, pads, hasPackage) {
  const out = [];
  const len = pinLength(p);
  const a = p.rot.angle * DEG;
  const dx = Math.cos(a), dy = Math.sin(a);
  const tip = [p.x, p.y], end = [p.x + dx * len, p.y + dy * len];
  const W = 0.1524;
  const dot = p.func === 'dot' || p.func === 'dotclk';
  const clk = p.func === 'clk' || p.func === 'dotclk';
  const lineEnd = dot ? [p.x + dx * (len - 1.27), p.y + dy * (len - 1.27)] : end;
  const seg = (x1, y1, x2, y2) => { const [a1, b1] = xf(t, x1, y1), [a2, b2] = xf(t, x2, y2); out.push({ k: 'seg', x1: a1, y1: b1, x2: a2, y2: b2, w: W, layer: 93 }); };
  if (len > 0) seg(tip[0], tip[1], lineEnd[0], lineEnd[1]);
  if (dot) {
    const [cx, cy] = xf(t, p.x + dx * (len - 0.635), p.y + dy * (len - 0.635));
    out.push({ k: 'circle', x: cx, y: cy, r: 0.635, w: W, layer: 93 });
  }
  if (clk) {
    const nx = -dy, ny = dx, s = 0.8;
    seg(end[0] + nx * s, end[1] + ny * s, end[0] + dx * 1.6, end[1] + dy * 1.6);
    seg(end[0] + dx * 1.6, end[1] + dy * 1.6, end[0] - nx * s, end[1] - ny * s);
  }
  // connection point marker (only drawn when zoomed in; tagged)
  const [tx, ty] = xf(t, tip[0], tip[1]);
  out.push({ k: 'pinpt', x: tx, y: ty, layer: 93 });
  const showName = p.visible === 'both' || p.visible === 'pin';
  const showPad = (p.visible === 'both' || p.visible === 'pad') && hasPackage && pads.length;
  const nm = stripBang(cleanPinName(p.name));
  if (showName && nm) {
    const off = len + 0.762 + (clk ? 1.6 : 0);
    const [x, y] = xf(t, p.x + dx * off, p.y + dy * off);
    const rot = composeRot(t, { angle: p.rot.angle, mirror: false });
    out.push(makeText(nm, x, y, 1.778, rot, { h: -1, v: 0 }, { layer: 'pinname', overbar: p.name.includes('!') }, false));
  }
  if (showPad && len > 0) {
    const nx = -dy, ny = dx;
    const mid = Math.min(len / 2, 2.54);
    const [x, y] = xf(t, p.x + dx * mid + nx * 0.254, p.y + dy * mid + ny * 0.254);
    const rot = composeRot(t, { angle: p.rot.angle, mirror: false });
    const txt = makeText(pads.join(','), x, y, 1.27, rot, { h: 0, v: -1 }, { layer: 'pinnum' }, false);
    out.push(txt);
  }
  return out;
}
