// EAGLE board model → KiCad 7 board (.kicad_pcb) + footprint library (.pretty/*.kicad_mod).
import { q, f, xy, uuid, sanitize, kicadText, justify, kicadRef } from './sexpr.js';
import { emitElement } from '../eagle.js';
import { normDeg, DEG, BBox } from '../geom.js';
import { boardLayerInfo } from '../layers.js';

export const PCB_VERSION = 20221018;

const USER_LAYERS = [
  [32, 'B.Adhes', 'user', 'B.Adhesive'], [33, 'F.Adhes', 'user', 'F.Adhesive'], [34, 'B.Paste', 'user'], [35, 'F.Paste', 'user'],
  [36, 'B.SilkS', 'user', 'B.Silkscreen'], [37, 'F.SilkS', 'user', 'F.Silkscreen'], [38, 'B.Mask', 'user'], [39, 'F.Mask', 'user'],
  [40, 'Dwgs.User', 'user', 'User.Drawings'], [41, 'Cmts.User', 'user', 'User.Comments'], [42, 'Eco1.User', 'user', 'User.Eco1'],
  [43, 'Eco2.User', 'user', 'User.Eco2'], [44, 'Edge.Cuts', 'user'], [45, 'Margin', 'user'], [46, 'B.CrtYd', 'user', 'B.Courtyard'],
  [47, 'F.CrtYd', 'user', 'F.Courtyard'], [48, 'B.Fab', 'user'], [49, 'F.Fab', 'user'],
];

export function makeLayerMapper(B) {
  const inner = new Set();
  for (const s of B.shapes) {
    if (typeof s.layer === 'number' && s.layer >= 2 && s.layer <= 15) inner.add(s.layer);
    if (s.k === 'via') { const [a, b] = s.extent.split('-').map(Number); for (let l = Math.min(a, b); l <= Math.max(a, b); l++) if (l >= 2 && l <= 15) inner.add(l); }
  }
  // honour the design-rule layer setup, e.g. "(1*2*15*16)"
  for (const m of (B.dr.layerSetup || '').matchAll(/\d+/g)) { const n = +m[0]; if (n >= 2 && n <= 15) inner.add(n); }
  const innerSorted = [...inner].sort((a, b) => a - b);
  const map = new Map();
  innerSorted.forEach((l, i) => map.set(l, `In${i + 1}.Cu`));
  let nInner = innerSorted.length;
  if (nInner % 2) nInner++;
  const copper = ['F.Cu', ...Array.from({ length: nInner }, (_, i) => `In${i + 1}.Cu`), 'B.Cu'];
  const layer = (n) => {
    if (n === 1) return 'F.Cu';
    if (n === 16) return 'B.Cu';
    if (n >= 2 && n <= 15) return map.get(n) || null;
    return boardLayerInfo(n).kicad || null;
  };
  const isCopper = (n) => n >= 1 && n <= 16;
  return { layer, isCopper, copper, nInner };
}

const stroke = (w) => `(stroke (width ${f(w)}) (type solid))`;

/** Converts generic shapes to KiCad graphic items. P maps EAGLE abs → KiCad coords (already local for footprints). */
function graphics(shapes, P, L, prefix, angleOff = 0) {
  const out = [];
  const ts = prefix === 'fp' ? `(tstamp ${uuid()})` : `(tstamp ${uuid()})`;
  for (const s of shapes) {
    const lay = L.layer(s.layer);
    if (!lay) continue;
    const w = s.w || (lay === 'Edge.Cuts' ? 0.1 : 0.12);
    switch (s.k) {
      case 'seg': {
        const [a, b] = P(s.x1, s.y1), [c, d] = P(s.x2, s.y2);
        out.push(`(${prefix}_line (start ${f(a)} ${f(b)}) (end ${f(c)} ${f(d)}) ${stroke(w)} (layer ${q(lay)}) ${ts})`);
        break;
      }
      case 'arc': {
        const am = (s.a0 + s.a1) / 2;
        const [x0, y0] = P(s.cx + s.r * Math.cos(s.a0), s.cy + s.r * Math.sin(s.a0));
        const [xm, ym] = P(s.cx + s.r * Math.cos(am), s.cy + s.r * Math.sin(am));
        const [x1, y1] = P(s.cx + s.r * Math.cos(s.a1), s.cy + s.r * Math.sin(s.a1));
        out.push(`(${prefix}_arc (start ${f(x0)} ${f(y0)}) (mid ${f(xm)} ${f(ym)}) (end ${f(x1)} ${f(y1)}) ${stroke(w)} (layer ${q(lay)}) ${ts})`);
        break;
      }
      case 'circle': {
        const [x, y] = P(s.x, s.y);
        const filled = !(s.w > 0);
        out.push(`(${prefix}_circle (center ${f(x)} ${f(y)}) (end ${f(x + s.r)} ${f(y)}) ${stroke(filled ? 0 : s.w)} (fill ${filled ? 'solid' : 'none'}) (layer ${q(lay)}) ${ts})`);
        break;
      }
      case 'poly': {
        if (s.pts.length < 6) break;
        const pts = [];
        for (let i = 0; i < s.pts.length; i += 2) { const [x, y] = P(s.pts[i], s.pts[i + 1]); pts.push(xy(x, y)); }
        out.push(`(${prefix}_poly (pts ${pts.join(' ')}) ${stroke(s.w || 0)} (fill ${s.fill ? 'solid' : 'none'}) (layer ${q(lay)}) ${ts})`);
        break;
      }
      case 'text': out.push(textItem(s, P, lay, prefix === 'fp' ? 'fp_text user' : 'gr_text', angleOff)); break;
      default: break;
    }
  }
  return out;
}

function textItem(s, P, lay, head, angleOff = 0, hidden = false) {
  const [x, y] = P(s.x, s.y);
  const ang = normDeg((s.mirror ? -s.angle : s.angle) + angleOff);
  const size = s.size || 1.27;
  const th = Math.max(0.05, size * (s.ratio ?? 8) / 100);
  const isBack = lay.startsWith('B.');
  return `(${head} ${q(kicadText(s.str))} (at ${f(x)} ${f(y)} ${f(ang)}) (layer ${q(lay)})${hidden ? ' hide' : ''} (effects (font (size ${f(size)} ${f(size)}) (thickness ${f(th)}))${justify(s.h, s.v, s.mirror || isBack)}) (tstamp ${uuid()}))`;
}

function padItem(p, P, L, netStr, back) {
  const [x, y] = P(p.th ? p.hx : p.x, p.th ? p.hy : p.y);
  const ang = f(normDeg(p.angle));
  const name = q(p.name);
  if (p.th) {
    let shape = 'circle', extra = '';
    if (p.shape === 'rect') shape = 'rect';
    else if (p.shape === 'oval') shape = 'oval';
    else if (p.shape === 'oct') { shape = 'roundrect'; extra = ' (roundrect_rratio 0) (chamfer_ratio 0.2929) (chamfer top_left top_right bottom_left bottom_right)'; }
    const drill = p.offset ? `(drill ${f(p.drill)} (offset ${f(p.offset)} 0))` : `(drill ${f(p.drill)})`;
    const layers = p.stop === false ? '"*.Cu"' : '"*.Cu" "*.Mask"';
    return `(pad ${name} thru_hole ${shape} (at ${f(x)} ${f(y)} ${ang}) (size ${f(p.w)} ${f(p.h)}) ${drill} (layers ${layers})${extra}${netStr} (tstamp ${uuid()}))`;
  }
  const side = back ? 'B' : 'F';
  const copper = L.layer(p.layer) || `${side}.Cu`;
  const s2 = copper.startsWith('B.') ? 'B' : 'F';
  const layers = [q(copper)];
  if (p.cream !== false && (copper === 'F.Cu' || copper === 'B.Cu')) layers.push(q(`${s2}.Paste`));
  if (p.stop !== false && (copper === 'F.Cu' || copper === 'B.Cu')) layers.push(q(`${s2}.Mask`));
  const rr = p.shape === 'roundrect' ? ` (roundrect_rratio ${f(Math.min(0.5, p.rr / Math.min(p.w, p.h)))})` : '';
  return `(pad ${name} smd ${p.shape === 'roundrect' ? 'roundrect' : 'rect'} (at ${f(x)} ${f(y)} ${ang}) (size ${f(p.w)} ${f(p.h)}) (layers ${layers.join(' ')})${rr}${netStr} (tstamp ${uuid()}))`;
}

/** Footprint s-expr for an element (absolute shapes) placed at its EAGLE position. */
function footprintFor(el, shapes, L, netIndex, fpId, opts = {}) {
  const back = el.rot.mirror;
  // KiCad orientation shown in the footprint properties
  const phi = back ? normDeg(180 - el.rot.angle) : el.rot.angle;
  const G = opts.P || ((x, y) => [x, -y]);
  const [PX, PY] = opts.library ? [0, 0] : G(el.x, el.y);
  const c = Math.cos(phi * DEG), s = Math.sin(phi * DEG);
  // EAGLE absolute -> KiCad footprint-local (un-rotated)
  const P = (x, y) => { const [ax, ay] = G(x, y); const X = ax - PX, Y = ay - PY; return [X * c - Y * s, X * s + Y * c]; };
  const lines = [];
  if (opts.version) lines.push(`(footprint ${q(fpId)} (version ${PCB_VERSION}) (generator pcbnew)\n  (layer "F.Cu")`);
  else lines.push(`(footprint ${q(fpId)}${el.locked ? ' locked' : ''} (layer ${q(back ? 'B.Cu' : 'F.Cu')})`);
  lines.push(`  (tstamp ${uuid()})`);
  if (!opts.library) lines.push(`  (at ${f(PX)} ${f(PY)}${phi ? ' ' + f(phi) : ''})`);
  if (el.pkg?.description) lines.push(`  (descr ${q(el.pkg.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500))})`);
  if (opts.path) lines.push(`  (path ${q(opts.path)})`);
  for (const [k, v] of Object.entries(el.attrs || {})) if (v && k !== 'NAME' && k !== 'VALUE') lines.push(`  (property ${q(k)} ${q(v)})`);
  const hasTH = el.pads.some((p) => p.th), hasSMD = el.pads.some((p) => !p.th);
  const attrs = [];
  if (hasTH) attrs.push('through_hole'); else if (hasSMD) attrs.push('smd');
  if (!el.pads.length) attrs.push('board_only', 'exclude_from_pos_files', 'exclude_from_bom');
  if (el.populate === false) attrs.push('exclude_from_bom', 'exclude_from_pos_files');
  if (attrs.length) lines.push(`  (attr ${[...new Set(attrs)].join(' ')})`);
  const nameSh = shapes.find((x) => x.k === 'text' && (x.attr === 'NAME' || x.src === '>NAME'));
  const valSh = shapes.find((x) => x.k === 'text' && (x.attr === 'VALUE' || x.src === '>VALUE'));
  const silk = back ? 'B.SilkS' : 'F.SilkS', fab = back ? 'B.Fab' : 'F.Fab';
  const fieldText = (kind, sh, txt, defLayer) => {
    if (sh) {
      const lay = L.layer(sh.layer) || defLayer;
      return '  ' + textItem({ ...sh, str: txt }, P, lay, `fp_text ${kind}`);
    }
    return `  (fp_text ${kind} ${q(kicadText(txt))} (at 0 0 ${f(phi)}) (layer ${q(defLayer)}) hide (effects (font (size 1 1) (thickness 0.15))${back ? ' (justify mirror)' : ''}) (tstamp ${uuid()}))`;
  };
  lines.push(fieldText('reference', nameSh, opts.library ? 'REF**' : kicadRef(el.name), silk));
  lines.push(fieldText('value', valSh, opts.library ? (el.package || '') : el.value || '', fab));
  const gfx = shapes.filter((x) => x !== nameSh && x !== valSh && x.k !== 'pad' && x.k !== 'hole' && !(x.k === 'text' && (x.attr || x.src?.startsWith('>')) && opts.library));
  for (const g of graphics(gfx, P, L, 'fp')) lines.push('  ' + g);
  for (const p of el.pads) {
    const ni = p.net !== undefined ? netIndex.get(p.net) : undefined;
    const netStr = !opts.library && ni ? ` (net ${ni} ${q(kicadText(p.net))})` : '';
    lines.push('  ' + padItem(p, P, L, netStr, back));
  }
  for (const h of shapes.filter((x) => x.k === 'hole')) {
    const [x, y] = P(h.x, h.y);
    lines.push(`  (pad "" np_thru_hole circle (at ${f(x)} ${f(y)}) (size ${f(h.d)} ${f(h.d)}) (drill ${f(h.d)}) (layers "*.Cu" "*.Mask") (tstamp ${uuid()}))`);
  }
  lines.push(')');
  return lines.join('\n');
}

export function exportBoard(B, proj, opts = {}) {
  const L = makeLayerMapper(B);
  const refPaths = opts.refPaths || new Map();
  const netIndex = new Map();
  const netLines = ['(net 0 "")'];
  let ni = 1;
  for (const n of B.nets.keys()) { netIndex.set(n, ni); netLines.push(`(net ${ni} ${q(kicadText(n))})`); ni++; }
  const bb = B.outline || B.bbox;
  const papers = [['A4', 297, 210], ['A3', 420, 297], ['A2', 594, 420], ['A1', 841, 594], ['A0', 1189, 841]];
  const paper = papers.find(([, w, h]) => bb.w + 20 <= w && bb.h + 20 <= h);
  const pageW = paper ? paper[1] : Math.ceil(bb.w + 20), pageH = paper ? paper[2] : Math.ceil(bb.h + 20);
  // place the board in the middle of the page (EAGLE Y is up, KiCad Y is down)
  const OX = Math.round(((pageW - bb.w) / 2 - bb.x0) / 1.27) * 1.27;
  const OY = Math.round(((pageH - bb.h) / 2 + bb.y1) / 1.27) * 1.27;
  const P = (x, y) => [x + OX, OY - y];
  const fpId = (el) => `${proj}:${sanitize(`${el.library}_${el.package}`)}`;
  const body = [];

  // footprints
  for (const el of B.elements) {
    if (!el.pkg) continue;
    body.push(footprintFor(el, el.shapes, L, netIndex, fpId(el), { path: refPaths.get(el.name), P }));
  }

  // board-level graphics (plain)
  const plain = B.shapes.filter((s) => !s.owner && !s.net && s.k !== 'via');
  const holes = plain.filter((s) => s.k === 'hole');
  const plainGfx = [];
  for (const s of plain) {
    if (s.k === 'hole') continue;
    if (s.k === 'poly' && L.isCopper(s.layer)) { body.push(zoneItem(s, P, L, 0, '', B)); continue; }
    plainGfx.push(s);
  }
  for (const g of graphics(plainGfx, P, L, 'gr')) body.push(g);
  holes.forEach((h, i) => {
    const [x, y] = P(h.x, h.y);
    body.push(`(footprint ${q(`${proj}:MountingHole_${f(h.d)}mm`)} (layer "F.Cu") (tstamp ${uuid()}) (at ${f(x)} ${f(y)})
  (attr board_only exclude_from_pos_files exclude_from_bom)
  (fp_text reference ${q(`H${i + 1}`)} (at 0 ${f(-h.d / 2 - 1)}) (layer "F.SilkS") hide (effects (font (size 1 1) (thickness 0.15))) (tstamp ${uuid()}))
  (fp_text value "Hole" (at 0 ${f(h.d / 2 + 1)}) (layer "F.Fab") hide (effects (font (size 1 1) (thickness 0.15))) (tstamp ${uuid()}))
  (pad "" np_thru_hole circle (at 0 0) (size ${f(h.d)} ${f(h.d)}) (drill ${f(h.d)}) (layers "*.Cu" "*.Mask") (tstamp ${uuid()}))
)`);
  });

  // signals: tracks, vias, zones
  for (const s of B.shapes) {
    if (!s.net || s.owner) continue;
    const n = netIndex.get(s.net) || 0;
    if (s.k === 'seg' || s.k === 'arc') {
      if (!L.isCopper(s.layer)) continue;
      const lay = L.layer(s.layer);
      if (!lay) continue;
      if (s.k === 'seg') {
        const [a, b] = P(s.x1, s.y1), [c, d] = P(s.x2, s.y2);
        if (a === c && b === d) continue;
        body.push(`(segment (start ${f(a)} ${f(b)}) (end ${f(c)} ${f(d)}) (width ${f(s.w || 0.1524)}) (layer ${q(lay)}) (net ${n}) (tstamp ${uuid()}))`);
      } else {
        const am = (s.a0 + s.a1) / 2;
        const [x0, y0] = P(s.cx + s.r * Math.cos(s.a0), s.cy + s.r * Math.sin(s.a0));
        const [xm, ym] = P(s.cx + s.r * Math.cos(am), s.cy + s.r * Math.sin(am));
        const [x1, y1] = P(s.cx + s.r * Math.cos(s.a1), s.cy + s.r * Math.sin(s.a1));
        body.push(`(arc (start ${f(x0)} ${f(y0)}) (mid ${f(xm)} ${f(ym)}) (end ${f(x1)} ${f(y1)}) (width ${f(s.w || 0.1524)}) (layer ${q(lay)}) (net ${n}) (tstamp ${uuid()}))`);
      }
    } else if (s.k === 'via') {
      const [x, y] = P(s.x, s.y);
      const [a, b] = s.extent.split('-').map(Number);
      const la = L.layer(Math.min(a, b)) || 'F.Cu', lb = L.layer(Math.max(a, b)) || 'B.Cu';
      const blind = !(la === 'F.Cu' && lb === 'B.Cu');
      body.push(`(via${blind ? ' blind' : ''} (at ${f(x)} ${f(y)}) (size ${f(s.d)}) (drill ${f(s.drill)}) (layers ${q(la)} ${q(lb)}) (net ${n}) (tstamp ${uuid()}))`);
    } else if (s.k === 'poly' && s.zone) {
      if (!L.isCopper(s.layer)) continue;
      body.push(zoneItem(s, P, L, n, s.net, B));
    }
  }

  const layerLines = [];
  L.copper.forEach((name, i) => {
    const id = name === 'F.Cu' ? 0 : name === 'B.Cu' ? 31 : i;
    layerLines.push(`(${id} ${q(name)} signal)`);
  });
  for (const [id, name, type, user] of USER_LAYERS) layerLines.push(`(${id} ${q(name)} ${type}${user ? ' ' + q(user) : ''})`);
  const thickness = 1.6;
  const text = `(kicad_pcb (version ${PCB_VERSION}) (generator fusion_pcb_viewer)

  (general
    (thickness ${thickness})
  )

  ${paper ? `(paper ${q(paper[0])})` : `(paper "User" ${f(pageW)} ${f(pageH)})`}
  (layers
${layerLines.map((l) => '    ' + l).join('\n')}
  )

  (setup
    (pad_to_mask_clearance 0)
    (pcbplotparams
      (layerselection 0x00010fc_ffffffff)
      (outputformat 1)
      (outputdirectory "gerbers/")
    )
  )

${netLines.map((l) => '  ' + l).join('\n')}

${body.map((b) => b.split('\n').map((l) => '  ' + l).join('\n')).join('\n')}
)
`;
  return { name: `${proj}.kicad_pcb`, data: text, layerMap: L, offset: [OX, OY] };
}

function zoneItem(s, P, L, n, netName, B) {
  const lay = L.layer(s.layer);
  const src = s.src || {};
  const clearance = Number.isFinite(src.isolate) && src.isolate > 0 ? src.isolate : B.dr.mdWireWire || 0.2032;
  const minTh = Math.max(0.1, s.w || 0.254);
  const priority = Math.max(0, 6 - (src.rank || 1));
  const pts = [];
  for (let i = 0; i < s.pts.length; i += 2) { const [x, y] = P(s.pts[i], s.pts[i + 1]); pts.push(xy(x, y)); }
  if (src.pour === 'cutout') {
    return `(zone (net 0) (net_name "") (layer ${q(lay)}) (tstamp ${uuid()}) (hatch edge 0.508)
  (connect_pads (clearance 0))
  (min_thickness 0.254) (filled_areas_thickness no)
  (keepout (tracks allowed) (vias allowed) (pads allowed) (copperpour not_allowed) (footprints allowed))
  (fill (thermal_gap 0.508) (thermal_bridge_width 0.508))
  (polygon (pts ${pts.join(' ')}))
)`;
  }
  const hatch = src.pour === 'hatch' ? ` (mode hatch) (hatch_thickness ${f(minTh)}) (hatch_gap ${f(Math.max(src.spacing || 1.27, minTh * 2))}) (hatch_orientation 0)` : '';
  return `(zone (net ${n}) (net_name ${q(kicadText(netName))}) (layer ${q(lay)}) (tstamp ${uuid()}) (hatch edge 0.508)
  (priority ${priority})
  (connect_pads${src.thermals === false ? ' yes' : ''} (clearance ${f(clearance)}))
  (min_thickness ${f(minTh)}) (filled_areas_thickness no)
  (fill${hatch} (thermal_gap ${f(clearance)}) (thermal_bridge_width ${f(Math.max(minTh, 0.3))})${src.orphans ? '' : ' (island_removal_mode 0)'})
  (polygon (pts ${pts.join(' ')}))
)`;
}

/** One .kicad_mod per used package, at the origin (top side). */
export function exportFootprintLibrary(B, proj) {
  const L = makeLayerMapper(B);
  const files = [];
  const done = new Set();
  const all = [];
  for (const el of B.elements) if (el.pkg) all.push([el.lib, el.pkg]);
  for (const [lib, pkg] of all) {
    const name = sanitize(`${lib.name}_${pkg.name}`);
    if (done.has(name)) continue;
    done.add(name);
    const el = { name: 'REF**', value: pkg.name, package: pkg.name, library: lib.name, x: 0, y: 0, rot: { angle: 0, mirror: false }, attrs: {}, attrDefs: [], pads: [], bbox: new BBox(), pkg, smashed: false };
    const shapes = emitElement(el, pkg, { x: 0, y: 0, angle: 0, mirror: false }, B.dr);
    files.push({ name: `${proj}.pretty/${name}.kicad_mod`, data: footprintFor(el, shapes, L, new Map(), name, { library: true, version: true })+ '\n' });
  }
  return files;
}
