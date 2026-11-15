// EAGLE schematic model → KiCad 7 schematic files (.kicad_sch) + symbol library (.kicad_sym).
import { q, f, xy, uuid, sanitize, kicadText, justify, kicadRef } from './sexpr.js';
import { parsePrim, pinLength, cleanPinName, emitGeneric } from '../eagle.js';
import { makeText, textBox, xf, normDeg, closestOnSeg, BBox, arcFromCurve } from '../geom.js';

export const SCH_VERSION = 20230121;
const FONT = (s) => `(font (size ${f(s)} ${f(s)}))`;

const PIN_TYPE = { in: 'input', out: 'output', io: 'bidirectional', oc: 'open_collector', pwr: 'power_in', pas: 'passive', hiz: 'tri_state', sup: 'power_in', nc: 'no_connect' };
const PIN_STYLE = { none: 'line', dot: 'inverted', clk: 'clock', dotclk: 'inverted_clock' };

const isSupplyDevice = (ds, dev) => {
  if (dev?.package) return false;
  let pins = 0, sup = 0;
  for (const g of ds.gates) {
    const sym = ds._lib?.symbols.get(g.symbol);
    for (const p of sym?.items || []) if (p.t === 'pin') { pins++; if (p.direction === 'sup') sup++; }
  }
  return pins > 0 && pins === sup;
};

/** Converts locally-emitted shapes (EAGLE coords) into KiCad graphic s-exprs via point mapper P. */
export function shapesToSch(shapes, P, opts = {}) {
  const out = [];
  const tail = opts.lib ? '' : ` (uuid ${uuid()})`;
  const stroke = (w) => `(stroke (width ${f(w)}) (type default))`;
  for (const s of shapes) {
    switch (s.k) {
      case 'seg': {
        const [a, b] = P(s.x1, s.y1), [c, d] = P(s.x2, s.y2);
        out.push(`(polyline (pts ${xy(a, b)} ${xy(c, d)}) ${stroke(s.w)}${opts.lib ? ' (fill (type none))' : ''}${tail})`);
        break;
      }
      case 'arc': {
        const am = (s.a0 + s.a1) / 2;
        const [x0, y0] = P(s.cx + s.r * Math.cos(s.a0), s.cy + s.r * Math.sin(s.a0));
        const [xm, ym] = P(s.cx + s.r * Math.cos(am), s.cy + s.r * Math.sin(am));
        const [x1, y1] = P(s.cx + s.r * Math.cos(s.a1), s.cy + s.r * Math.sin(s.a1));
        out.push(`(arc (start ${f(x0)} ${f(y0)}) (mid ${f(xm)} ${f(ym)}) (end ${f(x1)} ${f(y1)}) ${stroke(s.w)} (fill (type none))${tail})`);
        break;
      }
      case 'circle': {
        const [x, y] = P(s.x, s.y);
        out.push(`(circle (center ${f(x)} ${f(y)}) (radius ${f(s.r)}) ${stroke(s.w)} (fill (type ${s.w > 0 ? 'none' : 'outline'}))${tail})`);
        break;
      }
      case 'poly': {
        const pts = [];
        for (let i = 0; i < s.pts.length; i += 2) { const [x, y] = P(s.pts[i], s.pts[i + 1]); pts.push(xy(x, y)); }
        pts.push(pts[0]);
        out.push(`(polyline (pts ${pts.join(' ')}) ${stroke(s.w)} (fill (type ${s.fill ? 'outline' : 'none'}))${tail})`);
        break;
      }
      case 'text': {
        if (!String(s.str).trim()) break;
        const [x, y] = P(s.x, s.y);
        const ang = opts.lib ? Math.round(s.angle * 10) : f(s.angle);
        out.push(`(text ${q(kicadText(s.str))} (at ${f(x)} ${f(y)} ${ang}) (effects ${FONT(s.size)}${justify(s.h, s.v)})${tail})`);
        break;
      }
      default: break;
    }
  }
  return out;
}

/** Field (property) at a text shape: centered, with angle relative to the symbol orientation. */
function fieldAt(shape, P, symRotSwaps = false) {
  const b = textBox(shape);
  const [x, y] = P((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
  const vertical = Math.round(shape.angle) % 180 === 90;
  return { x, y, angle: vertical !== symRotSwaps ? 90 : 0, size: shape.size };
}

// ------------------------------------------------------------------ library symbols
function buildLibSymbol(proj, part, emitLocal) {
  const { ds, dev, lib } = part;
  ds._lib = lib;
  const name = sanitize(`${lib.name}_${ds.name}${dev?.name ? '_' + dev.name : ''}`);
  const supply = isSupplyDevice(ds, dev);
  const frameLike = !dev?.package && !supply;
  const units = [];
  let refField = null, valField = null;
  let allPinNumsHidden = true;
  const supplyPinName = [];
  ds.gates.forEach((g, gi) => {
    const sym = lib.symbols.get(g.symbol);
    const items = [];
    const pins = [];
    const shapes = [];
    for (const p of sym?.items || []) {
      if (p.t === 'pin') { pins.push(p); continue; }
      if (p.t === 'text' && p.value.startsWith('>')) {
        const k = p.value.slice(1).toUpperCase();
        if (gi === 0 || (k === 'NAME' && !refField) || (k === 'VALUE' && !valField)) {
          const sh = makeText(p.value, p.x, p.y, p.size, p.rot, p.align, {}, false);
          if (k === 'NAME' && !refField) refField = sh;
          if (k === 'VALUE' && !valField) valField = sh;
        }
        continue;
      }
      emitLocal(p, shapes);
    }
    items.push(...shapesToSch(shapes, (x, y) => [x, y], { lib: true }));
    for (const p of pins) {
      const conn = dev?.connects.find((c) => c.gate === g.name && c.pin === p.name);
      let nums = conn?.pads?.length ? conn.pads : [];
      const showPad = (p.visible === 'both' || p.visible === 'pad') && nums.length && dev?.package;
      if (showPad) allPinNumsHidden = false;
      if (!nums.length) nums = [supply ? '1' : cleanPinName(p.name) || String(pins.indexOf(p) + 1)];
      const showName = p.visible === 'both' || p.visible === 'pin';
      let type = PIN_TYPE[p.direction] || 'bidirectional';
      let hide = false;
      if (supply) { type = 'power_in'; hide = true; supplyPinName.push(cleanPinName(p.name)); }
      const nm = showName || supply ? kicadText(cleanPinName(p.name)) : '~';
      nums.forEach((num, k) => {
        const t = k === 0 ? type : 'passive';
        const h = hide || k > 0;
        items.push(`(pin ${t} ${PIN_STYLE[p.func] || 'line'} (at ${f(p.x)} ${f(p.y)} ${Math.round(p.rot.angle)}) (length ${f(pinLength(p))})${h ? ' hide' : ''} (name ${q(nm || '~')} (effects ${FONT(1.27)})) (number ${q(num)} (effects ${FONT(1.27)})))`);
      });
    }
    units.push({ index: gi + 1, items });
  });
  return { name, supply, frameLike, units, refField, valField, allPinNumsHidden, supplyPinName: supplyPinName[0] };
}

function libSymbolText(def, fullName, prefix, footprint, valueText) {
  const lines = [];
  const pinNames = '(pin_names (offset 0.762))';
  const flags = `${def.supply ? '(power) ' : ''}${def.allPinNumsHidden ? '(pin_numbers hide) ' : ''}${pinNames} (in_bom ${def.supply || def.frameLike ? 'no' : 'yes'}) (on_board ${def.supply || def.frameLike ? 'no' : 'yes'})`;
  lines.push(`(symbol ${q(fullName)} ${flags}`);
  const P = (x, y) => [x, y];
  const prop = (id, k, v, sh, hidden) => {
    const at = sh ? fieldAt(sh, P) : { x: 0, y: 0, angle: 0, size: 1.27 };
    lines.push(`  (property ${q(k)} ${q(v)} (id ${id}) (at ${f(at.x)} ${f(at.y)} ${at.angle}) (effects ${FONT(Math.min(at.size, 2.54))}${hidden ? ' hide' : ''}))`);
  };
  prop(0, 'Reference', prefix, def.refField, !def.refField);
  prop(1, 'Value', valueText, def.valField, !def.valField);
  prop(2, 'Footprint', footprint, null, true);
  prop(3, 'Datasheet', '', null, true);
  const base = fullName.includes(':') ? fullName.split(':')[1] : fullName;
  for (const u of def.units) {
    lines.push(`  (symbol ${q(`${base}_${u.index}_1`)}`);
    for (const it of u.items) lines.push('    ' + it);
    lines.push('  )');
  }
  lines.push(')');
  return lines.join('\n');
}

// ------------------------------------------------------------------ main
export function exportSchematic(S, proj) {
  const emitLocal = (p, out) => emitGeneric(p, null, p.layer, out, false, (t) => (t.startsWith('>') ? null : t));
  const libDefs = new Map(); // key -> {def, name}
  const partInfo = new Map();
  const fpName = (part) => (part.dev?.package ? `${proj}:${sanitize(`${part.lib.name}_${part.dev.package}`)}` : '');

  for (const part of S.parts.values()) {
    if (!part.ds) continue;
    const key = `${part.lib.name}|${part.lib.urn}|${part.ds.name}|${part.dev?.name || ''}`;
    if (!libDefs.has(key)) {
      const def = buildLibSymbol(proj, part, emitLocal);
      libDefs.set(key, def);
    }
    partInfo.set(part.name, { key, def: libDefs.get(key) });
  }
  // unique names (different libraries could clash after sanitizing)
  const used = new Map();
  for (const def of libDefs.values()) {
    let n = def.name, i = 2;
    while (used.has(n) && used.get(n) !== def) n = `${def.name}_${i++}`;
    used.set(n, def); def.name = n;
  }

  // nets needing global labels: multi-sheet or containing supply pins
  const supplyNets = new Set();
  const segCount = new Map();
  for (const sh of S.sheets) {
    for (const n of sh.nets) {
      segCount.set(n.name, (segCount.get(n.name) || 0) + n.segments.length);
      for (const sg of n.segments) for (const r of sg.pinrefs) {
        const pi = partInfo.get(r.part);
        if (pi?.def.supply) supplyNets.add(n.name);
      }
    }
  }
  const globalNet = (name) => (S.nets.get(name)?.sheets.size || 0) > 1 || supplyNets.has(name);

  const rootUuid = uuid();
  const multi = S.sheets.length > 1;
  const sheetBlocks = S.sheets.map((sh, i) => ({ uuid: uuid(), fileUuid: uuid(), file: multi ? `${proj}_sheet${i + 1}.kicad_sch` : `${proj}.kicad_sch`, name: `Sheet${i + 1}` }));
  const refPaths = new Map(); // reference -> path for PCB linking
  const pwrCounter = { n: 1 }, frmCounter = { n: 1 };
  const refMap = new Map(); // eagle part name -> kicad reference

  const files = [];
  S.sheets.forEach((sheet, si) => {
    const blk = sheetBlocks[si];
    const instPath = multi ? `/${rootUuid}/${blk.uuid}` : `/${rootUuid}`;
    // page geometry
    const bb = sheet.bbox;
    const G = 2.54;
    const OX = Math.ceil((-bb.x0 + 10) / G) * G;
    const OY = Math.ceil((bb.y1 + 10) / G) * G;
    const P = (x, y) => [x + OX, OY - y];
    const pw = bb.w + 20, ph = bb.h + 20;
    const papers = [['A4', 297, 210], ['A3', 420, 297], ['A2', 594, 420], ['A1', 841, 594], ['A0', 1189, 841]];
    const paper = papers.find(([, w, h]) => pw <= w && ph <= h);
    const paperStr = paper ? `(paper ${q(paper[0])})` : `(paper "User" ${f(Math.ceil(pw))} ${f(Math.ceil(ph))})`;

    const body = [];
    const usedLib = new Set();
    const usedVariants = new Set();
    // symbols
    for (const I of sheet.instances) {
      const part = I.partDef;
      const pi = part && partInfo.get(part.name);
      if (!pi || !I.sym) continue;
      const def = pi.def;
      const unit = part.ds.gates.findIndex((g) => g.name === I.gate) + 1;
      let ref = refMap.get(part.name);
      if (!ref) {
        if (def.supply) ref = `#PWR${String(pwrCounter.n++).padStart(2, '0')}`;
        else if (def.frameLike) ref = `#FRM${frmCounter.n++}`;
        else ref = kicadRef(part.name);
        refMap.set(part.name, ref);
      }
      const symUuid = uuid();
      if (!def.supply && !def.frameLike && !refPaths.has(ref)) refPaths.set(part.name, `${multi ? '/' + blk.uuid : ''}/${symUuid}`);
      const [kx, ky] = P(I.x, I.y);
      const swaps = I.rot.angle % 180 === 90;
      const value = def.supply ? (I.pins.find((p) => p.net)?.net || def.supplyPinName || part.value) : part.value;
      const L = [];
      let libName = def.name;
      if (def.supply && value !== def.supplyPinName) {
        def.variants = def.variants || new Map();
        if (!def.variants.has(value)) def.variants.set(value, sanitize(`${def.name}_${value}`));
        libName = def.variants.get(value);
        usedVariants.add(`${pi.key}\u0000${value}`);
      } else usedLib.add(pi.key);
      L.push(`(symbol (lib_id ${q(`${proj}:${libName}`)}) (at ${f(kx)} ${f(ky)} ${Math.round(I.rot.angle) % 360})${I.rot.mirror ? ' (mirror y)' : ''} (unit ${unit})`);
      L.push(`  (in_bom ${def.supply || def.frameLike ? 'no' : 'yes'}) (on_board ${def.supply || def.frameLike ? 'no' : 'yes'}) (dnp no)`);
      L.push(`  (uuid ${symUuid})`);
      const fprop = (id, k, v, sh) => {
        if (sh) {
          const at = fieldAt(sh, P, swaps);
          L.push(`  (property ${q(k)} ${q(v)} (id ${id}) (at ${f(at.x)} ${f(at.y)} ${at.angle}) (effects ${FONT(at.size)}))`);
        } else L.push(`  (property ${q(k)} ${q(v)} (id ${id}) (at ${f(kx)} ${f(ky)} 0) (effects ${FONT(1.27)} hide))`);
      };
      fprop(0, 'Reference', ref, def.supply ? null : I.texts.NAME);
      fprop(1, 'Value', kicadText(value), I.texts.VALUE);
      fprop(2, 'Footprint', fpName(part), null);
      fprop(3, 'Datasheet', '', null);
      let id = 4;
      for (const [k, v] of Object.entries(part.attrs)) {
        if (!v || ['NAME', 'VALUE', 'Reference', 'Value', 'Footprint', 'Datasheet'].includes(k)) continue;
        fprop(id++, k, v, null);
      }
      const gate = part.ds.gates[unit - 1];
      const nums = new Set();
      for (const c of part.dev?.connects || []) if (c.gate === gate.name) c.pads.forEach((p) => nums.add(p));
      if (!part.dev?.package) for (const p of I.sym.items) if (p.t === 'pin') nums.add(def.supply ? '1' : cleanPinName(p.name));
      for (const n of nums) L.push(`  (pin ${q(n)} (uuid ${uuid()}))`);
      L.push(`  (instances (project ${q(proj)} (path ${q(instPath)} (reference ${q(ref)}) (unit ${unit}))))`);
      L.push(')');
      body.push(L.join('\n'));
    }

    // plain graphics & text
    const plainShapes = [];
    for (const p of sheet.plain) emitLocal(p, plainShapes);
    for (const s of shapesToSch(plainShapes, P)) body.push(s);

    // nets
    const pinPos = new Map();
    for (const I of sheet.instances) for (const p of I.pins) pinPos.set(`${I.part}\u0000${I.gate}\u0000${p.name}`, [p.x, p.y]);
    const emitNetLike = (owner, isBus) => {
      const kname = isBus ? busName(owner.name) : kicadText(owner.name);
      const glob = !isBus && globalNet(owner.name);
      for (const sg of owner.segments) {
        const wires = sg.wires.filter(Boolean);
        for (const w of wires) {
          const [a, b] = P(w.x1, w.y1), [c, d] = P(w.x2, w.y2);
          body.push(`(${isBus ? 'bus' : 'wire'} (pts ${xy(a, b)} ${xy(c, d)}) (stroke (width 0) (type default)) (uuid ${uuid()}))`);
        }
        for (const j of sg.junctions) { const [x, y] = P(j.x, j.y); body.push(`(junction (at ${f(x)} ${f(y)}) (diameter 0) (color 0 0 0 0) (uuid ${uuid()}))`); }
        const labels = sg.labels.map((l) => ({ ...l }));
        const hasSupply = sg.pinrefs.some((r) => partInfo.get(r.part)?.def.supply);
        const nSeg = segCount.get(owner.name) || 0;
        const needLabel = !labels.length && !hasSupply && (nSeg > 1 || (multi && globalNet(owner.name)));
        if (needLabel) {
          let pt = null;
          if (wires.length) pt = [wires[0].x1, wires[0].y1];
          else if (sg.pinrefs.length) pt = pinPos.get(`${sg.pinrefs[0].part}\u0000${sg.pinrefs[0].gate}\u0000${sg.pinrefs[0].pin}`);
          if (pt) labels.push({ x: pt[0], y: pt[1], size: 1.27, rot: { angle: 0, mirror: false }, onWire: true });
        }
        for (const l of labels) {
          // snap anchor onto the nearest wire of the segment so KiCad connects it
          let ax = l.x, ay = l.y;
          if (!l.onWire && wires.length) {
            let best = Infinity;
            for (const w of wires) {
              const [cx, cy] = closestOnSeg(l.x, l.y, w.x1, w.y1, w.x2, w.y2);
              const d = Math.hypot(cx - l.x, cy - l.y);
              if (d < best) { best = d; ax = cx; ay = cy; }
            }
          } else if (!l.onWire && !wires.length && sg.pinrefs.length) {
            const pp = pinPos.get(`${sg.pinrefs[0].part}\u0000${sg.pinrefs[0].gate}\u0000${sg.pinrefs[0].pin}`);
            if (pp) [ax, ay] = pp;
          }
          const [x, y] = P(ax, ay);
          let ang = normDeg(l.rot.mirror ? 180 - l.rot.angle : l.rot.angle);
          ang = Math.round(ang / 90) * 90 % 360;
          const jh = ang === 180 || ang === 270 ? 'right' : 'left';
          if (glob) {
            body.push(`(global_label ${q(kname)} (shape passive) (at ${f(x)} ${f(y)} ${ang}) (fields_autoplaced) (effects ${FONT(Math.min(l.size, 1.778))} (justify ${jh})) (uuid ${uuid()})\n  (property "Intersheetrefs" "\${INTERSHEET_REFS}" (id 0) (at ${f(x)} ${f(y)} 0) (effects ${FONT(1.27)} hide)))`);
          } else {
            body.push(`(label ${q(kname)} (at ${f(x)} ${f(y)} ${ang}) (fields_autoplaced) (effects ${FONT(Math.min(l.size, 1.778))} (justify ${jh} bottom)) (uuid ${uuid()}))`);
          }
        }
      }
    };
    for (const n of sheet.nets) emitNetLike(n, false);
    for (const b of sheet.busses) emitNetLike(b, true);

    const libText = [...usedLib].map((k) => {
      const def = libDefs.get(k);
      const anyPart = [...S.parts.values()].find((p) => partInfo.get(p.name)?.key === k);
      return libSymbolText(def, `${proj}:${def.name}`, def.supply ? '#PWR' : def.frameLike ? '#FRM' : (anyPart.ds.prefix || 'U'), fpName(anyPart), def.supply ? def.supplyPinName : anyPart.value);
    });
    for (const kv of usedVariants) {
      const [k, net] = kv.split('\u0000');
      const def = libDefs.get(k);
      const vdef = { ...def, units: def.units.map((u) => ({ ...u, items: u.items.map((it) => it.replace(/\(name "[^"]*"/, `(name ${q(kicadText(net))}`)) })) };
      libText.push(libSymbolText(vdef, `${proj}:${def.variants.get(net)}`, '#PWR', '', net));
    }
    const header = `(kicad_sch (version ${SCH_VERSION}) (generator fusion_pcb_viewer)\n\n  (uuid ${multi ? blk.fileUuid : rootUuid})\n\n  ${paperStr}\n\n  (lib_symbols\n${indent(libText.join('\n'), 4)}\n  )\n`;
    const footer = multi ? '' : `\n  (sheet_instances\n    (path "/" (page "1"))\n  )\n`;
    files.push({ name: blk.file, data: `${header}\n${indent(body.join('\n'), 2)}\n${footer})\n` });
  });

  if (multi) {
    // root sheet with one block per EAGLE sheet
    const body = [];
    S.sheets.forEach((sh, i) => {
      const blk = sheetBlocks[i];
      const col = i % 4, row = Math.floor(i / 4);
      const x = 25.4 + col * 66.04, y = 30.48 + row * 38.1, w = 50.8, h = 25.4;
      const title = sh.description ? sh.description.replace(/<[^>]+>/g, '').trim().slice(0, 40) || blk.name : blk.name;
      body.push(`(sheet (at ${f(x)} ${f(y)}) (size ${f(w)} ${f(h)}) (fields_autoplaced)
  (stroke (width 0.1524) (type solid))
  (fill (color 0 0 0 0.0000))
  (uuid ${blk.uuid})
  (property "Sheetname" ${q(title)} (id 0) (at ${f(x)} ${f(y - 0.7)} 0) (effects ${FONT(1.27)} (justify left bottom)))
  (property "Sheetfile" ${q(blk.file)} (id 1) (at ${f(x)} ${f(y + h + 0.6)} 0) (effects ${FONT(1.27)} (justify left top)))
  (instances (project ${q(proj)} (path ${q(`/${rootUuid}`)} (page ${q(String(i + 2))}))))
)`);
    });
    const root = `(kicad_sch (version ${SCH_VERSION}) (generator fusion_pcb_viewer)\n\n  (uuid ${rootUuid})\n\n  (paper "A4")\n\n  (lib_symbols\n  )\n\n${indent(body.join('\n'), 2)}\n\n  (sheet_instances\n    (path "/" (page "1"))\n  )\n)\n`;
    files.unshift({ name: `${proj}.kicad_sch`, data: root });
  }

  // standalone symbol library
  const symLib = [`(kicad_symbol_lib (version 20220914) (generator fusion_pcb_viewer)`];
  for (const [k, def] of libDefs) {
    const anyPart = [...S.parts.values()].find((p) => partInfo.get(p.name)?.key === k);
    symLib.push(indent(libSymbolText(def, def.name, def.supply ? '#PWR' : def.frameLike ? '#FRM' : (anyPart.ds.prefix || 'U'), fpName(anyPart), def.supply ? def.supplyPinName : anyPart.ds.name), 2));
  }
  symLib.push(')\n');
  files.push({ name: `${proj}.kicad_sym`, data: symLib.join('\n') });
  return { files, refPaths, refMap, rootUuid };
}

function busName(n) {
  const parts = n.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 1) return kicadText(parts[0]);
  return `{${parts.map(kicadText).join(' ')}}`;
}

function indent(s, n) {
  const p = ' '.repeat(n);
  return s.split('\n').map((l) => (l ? p + l : l)).join('\n');
}
// re-export helpers used by the CLI/UI
export { parsePrim, xf, BBox, arcFromCurve };
