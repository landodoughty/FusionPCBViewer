// Fusion PCB Viewer — UI controller.
import { loadFiles } from './loader.js';
import { buildBoard, buildSchematic, padOutline } from './eagle.js';
import { View, newBatch, addToBatch } from './render.js';
import { buildBoardScene, buildSchScene, boardHit, schHit, boardShapeKey, schShapeKey, shapesBBox } from './scenes.js';
import { BBox } from './geom.js';
import { SCH_COLORS } from './layers.js';
import { exportKiCadProject, projectName, bomCSV } from './kicad/project.js';
import { exportSchematic } from './kicad/sch.js';
import { exportBoard } from './kicad/pcb.js';
import { writeZip } from './zip.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const stripHtml = (s) => String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();

const state = {
  sch: null, brd: null, mode: null, sheet: 0, fileName: '',
  visible: { sch: new Map(), brd: new Map() },
  flip: false, highContrast: false, activeLayer: 'F.Cu',
  selection: null, // {type:'comp'|'net', name, pad?}
  list: 'parts', filter: '',
  units: 'mm', origin: [0, 0], cursor: [0, 0],
  measure: { on: false, a: null, b: null },
};

const canvas = $('#cv');
const view = new View(canvas);
let scene = null;

// ------------------------------------------------------------------ loading
async function openFiles(files) {
  if (!files || !files.length) return;
  toast('Loading…');
  try {
    const { docs, warnings } = await loadFiles([...files]);
    const schDoc = docs.find((d) => d.kind === 'schematic');
    const brdDoc = docs.find((d) => d.kind === 'board');
    if (!schDoc && !brdDoc) {
      const libs = docs.filter((d) => d.kind === 'library');
      toast(libs.length ? 'That is a library (.lbr) — open a schematic or board.' : `No Fusion/EAGLE design found.\n${warnings.join('\n')}`, true);
      return;
    }
    const t0 = performance.now();
    // opening only a schematic keeps the loaded board (and vice versa), so both can be added one at a time
    const sch = schDoc ? buildSchematic(schDoc) : state.sch;
    const brd = brdDoc ? buildBoard(brdDoc) : state.brd;
    state.sch = sch; state.brd = brd;
    state.selection = null;
    if (schDoc) { state.sheet = 0; state.visible.sch = new Map(); }
    if (brdDoc) { state.flip = false; state.visible.brd = new Map(); state.activeLayer = 'F.Cu'; }
    state.fileName = [sch?.name, brd?.name].filter(Boolean).map((n) => n.split('/').pop()).join(' + ');
    document.title = `${projectName((sch || brd).name)} — Fusion PCB Viewer`;
    $('#welcome').classList.add('hidden');
    $('#tab-sch').disabled = !sch; $('#tab-brd').disabled = !brd;
    $('#btn-export').disabled = false;
    setMode(brdDoc && !schDoc ? 'brd' : sch ? 'sch' : 'brd', true);
    const w = [...warnings, ...(sch?.warnings || []), ...(brd?.warnings || [])];
    const info = `Loaded ${state.fileName} in ${Math.round(performance.now() - t0)} ms`;
    toast(w.length ? `${info}\n⚠ ${w.slice(0, 4).join('\n⚠ ')}${w.length > 4 ? `\n…and ${w.length - 4} more` : ''}` : info, false, w.length ? 7000 : 2500);
  } catch (e) {
    console.error(e);
    toast(`Failed to open: ${e.message}`, true);
  }
}

// ------------------------------------------------------------------ modes & scenes
function setMode(mode, fit = false) {
  if (mode === 'sch' && !state.sch) mode = 'brd';
  if (mode === 'brd' && !state.brd) mode = 'sch';
  const changed = state.mode !== mode;
  state.mode = mode;
  document.body.classList.toggle('mode-brd', mode === 'brd');
  document.body.classList.toggle('mode-sch', mode === 'sch');
  $('#tab-sch').classList.toggle('active', mode === 'sch');
  $('#tab-brd').classList.toggle('active', mode === 'brd');
  $('#ptab-sheets').disabled = mode !== 'sch';
  if (mode !== 'sch' && state.list === 'sheets') state.list = 'parts';
  view.flip = mode === 'brd' && state.flip;
  $('#btn-flip').classList.toggle('on', state.flip);
  $('#btn-contrast').classList.toggle('on', state.highContrast);
  // cross-probe: if a component is selected, go to the sheet that has it
  if (mode === 'sch' && state.selection) {
    const si = sheetFor(state.selection);
    if (si >= 0) state.sheet = si;
  }
  rebuildScene();
  if (fit || changed) {
    const target = selectionBBox();
    if (target && changed && !fit) view.fit(grow(target, 0.6), 0.1);
    else view.fit(scene.bbox);
  }
  renderList();
  renderLayers();
  renderProps();
  updateSheetBadge();
}

function rebuildScene() {
  if (state.mode === 'sch') {
    const sheet = state.sch.sheets[state.sheet];
    scene = buildSchScene(state.sch, sheet, { visible: state.visible.sch });
    $('#stage').style.background = SCH_COLORS.background;
  } else {
    scene = buildBoardScene(state.brd, { visible: state.visible.brd, flip: state.flip, activeLayer: state.activeLayer, highContrast: state.highContrast });
    $('#stage').style.background = scene.background;
  }
  view.scene = scene;
  view.flip = state.mode === 'brd' && state.flip;
  updateOverlays();
}

function grow(b, f) {
  const m = Math.max(b.w, b.h) * f + 2;
  return new BBox().add(b.x0 - m, b.y0 - m).add(b.x1 + m, b.y1 + m);
}

function currentShapes() {
  return state.mode === 'sch' ? state.sch.sheets[state.sheet].shapes : state.brd.shapes;
}

function lighten(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const L = (c) => Math.round(c + (255 - c) * f);
  return `rgb(${L(r)},${L(g)},${L(b)})`;
}

function updateOverlays() {
  view.overlays = [];
  view.dim = false;
  const sel = state.selection;
  if (!sel || !scene) { view.redraw(); return; }
  const shapes = currentShapes();
  const keyOf = state.mode === 'sch' ? schShapeKey : boardShapeKey;
  let picked;
  if (sel.type === 'net') picked = shapes.filter((s) => s.net === sel.name);
  else {
    const owner = state.mode === 'sch' ? sel.name : sel.name;
    picked = shapes.filter((s) => s.owner === owner);
  }
  if (!picked.length) { view.redraw(); return; }
  const groups = new Map();
  for (const s of picked) {
    const k = keyOf(s);
    if (k === null) continue;
    if (!groups.has(k)) groups.set(k, newBatch());
    addToBatch(groups.get(k), s);
  }
  view.dim = sel.type === 'net' || state.mode === 'brd';
  for (const L of scene.layers) {
    const b = groups.get(L.key);
    if (!b) continue;
    let color;
    if (state.mode === 'sch') color = sel.type === 'net' ? '#e000e0' : '#ff8800';
    else color = lighten(L.color, sel.type === 'net' ? 0.55 : 0.45);
    view.overlays.push({ batch: b, color, alpha: 1, visibleKeys: [L.key], holes: true, minLine: sel.type === 'net' && state.mode === 'sch' ? 2.5 : 1, zoneAlpha: 0.3 });
  }
  view.redraw();
}

function selectionBBox() {
  const sel = state.selection;
  if (!sel || !scene) return null;
  if (sel.type === 'comp') {
    if (state.mode === 'brd') return state.brd.elements.find((e) => e.name === sel.name)?.bbox || null;
    const b = new BBox();
    for (const I of state.sch.sheets[state.sheet].instances) if (I.part === sel.name) b.addBox(I.bbox);
    return b.valid ? b : null;
  }
  const b = shapesBBox(currentShapes().filter((s) => s.net === sel.name));
  return b.valid ? b : null;
}

function sheetFor(sel) {
  if (!state.sch) return -1;
  const cur = state.sch.sheets[state.sheet];
  const has = (sh) => (sel.type === 'comp' ? sh.instances.some((I) => I.part === sel.name) : sh.nets.some((n) => n.name === sel.name));
  if (cur && has(cur)) return state.sheet;
  return state.sch.sheets.findIndex(has);
}

function select(sel, { zoom = false, fromList = false } = {}) {
  state.selection = sel;
  if (sel && state.mode === 'sch') {
    const si = sheetFor(sel);
    if (si >= 0 && si !== state.sheet) { state.sheet = si; rebuildScene(); updateSheetBadge(); zoom = true; }
  }
  updateOverlays();
  if (zoom && sel) {
    const b = selectionBBox();
    if (b) {
      const vb = view.viewBox();
      const visible = b.x0 >= vb[0] && b.x1 <= vb[2] && b.y0 >= vb[1] && b.y1 <= vb[3];
      if (!visible || fromList) view.fit(grow(b, sel.type === 'comp' ? 1.5 : 0.15), 0.1);
    }
  }
  renderProps();
  renderList(true);
}

// ------------------------------------------------------------------ left list
function renderList(keepScroll = false) {
  const el = $('#list');
  const scroll = el.scrollTop;
  document.querySelectorAll('.ptab').forEach((b) => b.classList.toggle('active', b.dataset.list === state.list));
  const f = state.filter.trim().toLowerCase();
  const items = [];
  if (state.list === 'sheets' && state.sch) {
    state.sch.sheets.forEach((sh, i) => items.push({ k: String(i + 1), v: stripHtml(sh.description).split('\n')[0] || `${sh.instances.length} parts, ${sh.nets.length} nets`, sel: i === state.sheet, act: () => gotoSheet(i) }));
  } else if (state.list === 'parts') {
    if (state.mode === 'sch' && state.sch) {
      for (const p of state.sch.parts.values()) {
        if (!p.ds) continue;
        const virt = !p.dev?.package;
        if (virt && !f) continue;
        items.push({ k: p.name, v: [p.value, p.package].filter(Boolean).join(' · '), sel: state.selection?.type === 'comp' && state.selection.name === p.name, act: () => select({ type: 'comp', name: p.name }, { zoom: true, fromList: true }) });
      }
    } else if (state.brd) {
      for (const e of state.brd.elements) items.push({ k: e.name, v: [e.value, e.package].filter(Boolean).join(' · ') + (e.rot.mirror ? ' · bottom' : ''), sel: state.selection?.type === 'comp' && state.selection.name === e.name, act: () => select({ type: 'comp', name: e.name }, { zoom: true, fromList: true }) });
    }
  } else if (state.list === 'nets') {
    const names = new Map();
    if (state.mode === 'sch' && state.sch) for (const n of state.sch.nets.values()) names.set(n.name, n.sheets.size > 1 ? `${n.sheets.size} sheets` : `sheet ${[...n.sheets][0] + 1}`);
    else if (state.brd) for (const n of state.brd.nets.values()) names.set(n.name, `${n.shapes.filter((s) => s.k === 'pad').length} pads`);
    for (const [n, v] of names) items.push({ k: n, v, sel: state.selection?.type === 'net' && state.selection.name === n, act: () => select({ type: 'net', name: n }, { zoom: true, fromList: true }) });
  }
  const shown = items.filter((it) => !f || it.k.toLowerCase().includes(f) || it.v.toLowerCase().includes(f));
  shown.sort((a, b) => (state.list === 'sheets' ? 0 : a.k.localeCompare(b.k, undefined, { numeric: true })));
  el.innerHTML = shown.length ? '' : `<div class="empty">${state.mode ? 'Nothing matches.' : 'Open a design to begin.'}</div>`;
  const frag = document.createDocumentFragment();
  for (const it of shown.slice(0, 3000)) {
    const d = document.createElement('div');
    d.className = 'item' + (it.sel ? ' sel' : '');
    d.innerHTML = `<span class="k">${esc(it.k)}</span><span class="v">${esc(it.v)}</span>`;
    d.title = `${it.k}  ${it.v}`;
    d.onclick = it.act;
    frag.appendChild(d);
  }
  el.appendChild(frag);
  $('#list-count').textContent = state.mode ? `${shown.length} of ${items.length}` : '';
  if (keepScroll) {
    el.scrollTop = scroll;
    el.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }
}

function gotoSheet(i) {
  if (!state.sch || i < 0 || i >= state.sch.sheets.length) return;
  state.sheet = i;
  rebuildScene();
  view.fit(scene.bbox);
  renderList(true); renderLayers(); updateSheetBadge();
}

function updateSheetBadge() {
  const b = $('#sheet-badge');
  if (state.mode === 'sch' && state.sch && state.sch.sheets.length > 1) {
    b.hidden = false;
    b.textContent = `Sheet ${state.sheet + 1} / ${state.sch.sheets.length}   (PgUp / PgDn)`;
  } else b.hidden = true;
}

// ------------------------------------------------------------------ layers panel
function renderLayers() {
  const el = $('#layers');
  el.innerHTML = '';
  const quick = $('#layer-quick');
  quick.innerHTML = '';
  if (!scene) return;
  const vis = state.mode === 'sch' ? state.visible.sch : state.visible.brd;
  const setAll = (pred) => { for (const L of scene.layers) vis.set(L.key, pred(L)); rebuildScene(); renderLayers(); };
  const q = (label, fn, title) => { const b = document.createElement('button'); b.className = 'link'; b.textContent = label; b.title = title; b.onclick = fn; quick.appendChild(b); };
  q('All', () => setAll(() => true), 'Show all layers');
  q('None', () => setAll(() => false), 'Hide all layers');
  if (state.mode === 'brd') {
    const common = (k) => ['Pads', 'Vias', 'Edge.Cuts', 'Ratsnest'].includes(k);
    const keep = (L, side) => (L.key.startsWith(side) && !/\.(Mask|Paste|Adhesive|Courtyard)$/.test(L.key)) || common(L.key);
    q('Front', () => setAll((L) => keep(L, 'F.')), 'Show only front-side layers');
    q('Back', () => setAll((L) => keep(L, 'B.')), 'Show only back-side layers');
  }
  // same order as KiCad's Appearance panel
  const layers = [...scene.layers].sort((a, b) => a.panel - b.panel);
  for (const L of layers) {
    const row = document.createElement('div');
    row.className = 'layer' + (L.visible ? '' : ' off') + (state.mode === 'brd' && L.key === state.activeLayer ? ' active' : '');
    const label = esc(L.name);
    row.innerHTML = `<input type="checkbox" ${L.visible ? 'checked' : ''} title="Show/hide"><span class="sw" style="background:${L.color};opacity:${L.alpha ?? 1}"></span><span class="nm">${label}</span>`;
    const cb = row.querySelector('input');
    cb.onclick = (e) => { e.stopPropagation(); vis.set(L.key, cb.checked); rebuildScene(); renderLayers(); };
    row.onclick = () => {
      if (state.mode === 'brd') { state.activeLayer = L.key; vis.set(L.key, true); rebuildScene(); renderLayers(); }
      else { vis.set(L.key, !L.visible); rebuildScene(); renderLayers(); }
    };
    const src = L.sources?.length ? `EAGLE layers: ${L.sources.join(', ')}\n` : '';
    row.title = state.mode === 'brd' ? `${src}Click to make active (drawn on top); checkbox toggles visibility` : 'Click to toggle visibility';
    el.appendChild(row);
  }
}

// ------------------------------------------------------------------ properties
const fmt = (v) => fmtLen(v);
function fmtLen(mm, digits) {
  if (state.units === 'mil') return `${(mm / 0.0254).toFixed(digits ?? 1)} mil`;
  if (state.units === 'in') return `${(mm / 25.4).toFixed(digits ?? 4)} in`;
  return `${mm.toFixed(digits ?? 3)} mm`;
}
function row(k, v) { return v === undefined || v === null || v === '' ? '' : `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`; }

function renderProps() {
  const el = $('#props');
  const sel = state.selection;
  $('#btn-clear').hidden = !sel;
  if (!sel) {
    el.innerHTML = state.mode ? summaryHTML() : '<p class="muted">Open a design to begin.</p>';
    return;
  }
  let html = '';
  if (sel.padOf && sel.type === 'net') html += compHTML({ name: sel.padOf.comp, pad: sel.padOf.pad }) + '<hr class="sep">';
  if (sel.type === 'comp') html += compHTML(sel);
  else html += netHTML(sel);
  el.innerHTML = html;
  el.querySelectorAll('[data-ref]').forEach((s) => { s.onclick = () => select({ type: 'comp', name: s.dataset.ref }, { zoom: true, fromList: true }); });
}

function compHTML(sel) {
  let html = '';
  {
    const e = state.brd?.elements.find((x) => x.name === sel.name);
    const p = state.sch?.parts.get(sel.name);
    html += `<h3>${esc(sel.name)} <span class="chip">component</span></h3><table>`;
    html += row('Value', p?.value ?? e?.value);
    if (p) {
      html += row('Device', p.deviceset + (p.device || '') + (p.technology ? ` (${p.technology})` : ''));
      html += row('Library', p.library);
      html += row('Package', p.package);
      if (p.ds?.gates.length > 1) html += row('Gates', p.ds.gates.map((g) => g.name).join(', '));
      const sheets = state.sch.sheets.map((s, i) => (s.instances.some((I) => I.part === p.name) ? i + 1 : 0)).filter(Boolean);
      if (state.sch.sheets.length > 1) html += row('Sheet(s)', sheets.join(', '));
    }
    if (e) {
      if (!p) { html += row('Library', e.library); html += row('Package', e.package); }
      html += row('Position', `${fmt(e.x)}, ${fmt(e.y)}`);
      html += row('Rotation', `${e.rot.angle}°`);
      html += row('Side', e.rot.mirror ? 'Bottom' : 'Top');
      html += row('Pads', String(e.pads.length));
      if (e.locked) html += row('Locked', 'yes');
      if (!e.populate) html += row('Populate', 'no (DNP)');
    }
    const attrs = { ...(p?.attrs || {}), ...(e?.attrs || {}) };
    for (const [k, v] of Object.entries(attrs)) if (v && k !== 'NAME' && k !== 'VALUE') html += row(k, v);
    html += '</table>';
    const desc = stripHtml(p?.ds?.description || e?.pkg?.description);
    if (desc) html += `<div class="desc">${esc(desc).replace(/\n/g, '<br>')}</div>`;
    if (sel.pad) {
      const pad = e?.pads.find((x) => x.name === sel.pad);
      if (pad) {
        html += `<h3 style="margin-top:12px">Pad ${esc(pad.name)} <span class="chip">${pad.th ? 'through-hole' : 'SMD'}</span></h3><table>`;
        html += row('Net', pad.net || '(none)') + row('Shape', pad.shape) + row('Size', `${fmt(pad.w)} × ${fmt(pad.h)}`) + (pad.drill ? row('Drill', fmt(pad.drill)) : '') + row('Angle', `${Math.round(pad.angle * 10) / 10}°`);
        html += '</table>';
      }
    }
  }
  return html;
}

function netHTML(sel) {
  let html = '';
  {
    html += `<h3>${esc(sel.name)} <span class="chip">net</span></h3><table>`;
    const nodes = [];
    if (state.sch) {
      const n = state.sch.nets.get(sel.name);
      if (n) {
        html += row('Sheets', [...n.sheets].map((i) => i + 1).join(', '));
        const cls = state.sch.classes.find((c) => c.number === n.cls);
        if (cls) html += row('Class', cls.name);
        for (const sh of state.sch.sheets) for (const net of sh.nets) if (net.name === sel.name) for (const sg of net.segments) for (const r of sg.pinrefs) {
          const part = state.sch.parts.get(r.part);
          if (!part?.dev?.package) continue;
          const pads = part.dev.connects.find((c) => c.gate === r.gate && c.pin === r.pin)?.pads || [r.pin];
          for (const pd of pads) nodes.push([r.part, pd]);
        }
      }
    }
    if (state.brd) {
      const n = state.brd.nets.get(sel.name);
      if (n) {
        const segs = n.shapes.filter((s) => s.k === 'seg' || s.k === 'arc').filter((s) => s.layer >= 1 && s.layer <= 16);
        let len = 0;
        for (const s of segs) len += s.k === 'seg' ? Math.hypot(s.x2 - s.x1, s.y2 - s.y1) : s.r * (s.a1 - s.a0);
        html += row('Routed length', fmt(len));
        html += row('Vias', String(n.shapes.filter((s) => s.k === 'via').length));
        html += row('Pours', String(n.shapes.filter((s) => s.zone).length) || '0');
        const cls = state.brd.classes.find((c) => c.number === n.cls);
        if (cls) html += row('Class', `${cls.name}${cls.width ? ` (w ${fmt(cls.width)})` : ''}`);
        if (!nodes.length) for (const s of n.shapes) if (s.k === 'pad') nodes.push([s.owner, s.name]);
      }
    }
    html += row('Connections', String(nodes.length));
    html += '</table>';
    nodes.sort((a, b) => `${a[0]}.${a[1]}`.localeCompare(`${b[0]}.${b[1]}`, undefined, { numeric: true }));
    if (nodes.length) html += `<div class="nodes">${nodes.slice(0, 400).map(([r, p]) => `<span data-ref="${esc(r)}">${esc(r)}.${esc(p)}</span>`).join('')}</div>`;
  }
  return html;
}

function summaryHTML() {
  let h = '<table>';
  if (state.sch) {
    h += row('Schematic', state.sch.name.split('/').pop());
    h += row('Sheets', String(state.sch.sheets.length));
    h += row('Parts', String([...state.sch.parts.values()].filter((p) => p.dev?.package).length));
    h += row('Nets', String(state.sch.nets.size));
  }
  if (state.brd) {
    const B = state.brd;
    h += row('Board', B.name.split('/').pop());
    if (B.outline) h += row('Size', `${fmt(B.outline.w)} × ${fmt(B.outline.h)}`);
    const cu = new Set(B.shapes.filter((s) => s.layer >= 1 && s.layer <= 16).map((s) => s.layer));
    cu.add(1); cu.add(16);
    h += row('Copper layers', String(cu.size));
    h += row('Components', String(B.elements.length));
    h += row('Signals', String(B.nets.size));
    h += row('Vias', String(B.shapes.filter((s) => s.k === 'via').length));
  }
  h += '</table><p class="muted" style="margin-top:12px">Click an item to inspect it. Click a wire, pad or track to highlight its net. Press <kbd>Tab</kbd> to cross-probe between schematic and PCB.</p>';
  return h;
}

// ------------------------------------------------------------------ interaction
function hitAt(x, y) {
  const tol = 3 / view.zoom;
  if (state.mode === 'sch') {
    const h = schHit(state.sch.sheets[state.sheet], x, y, tol);
    if (!h) return null;
    if (h.net) return { type: 'net', name: h.net, label: `Net ${h.net}${h.pin ? `  (${h.inst.part} pin ${h.pin.name})` : ''}` };
    return { type: 'comp', name: h.inst.part, label: `${h.inst.part}  ${h.inst.partDef?.value || ''}` };
  }
  const h = boardHit(state.brd, x, y, scene, tol);
  if (h.shape) {
    const s = h.shape;
    if (s.k === 'pad') return { type: s.net ? 'net' : 'comp', name: s.net || s.owner, comp: s.owner, pad: s.name, label: `Pad ${s.owner}.${s.name}${s.net ? `  net ${s.net}` : ''}` };
    if (s.net) return { type: 'net', name: s.net, label: `${s.k === 'via' ? 'Via' : s.zone ? 'Pour' : 'Track'}  net ${s.net}${s.w ? `  w ${fmt(s.w)}` : ''}` };
  }
  if (h.comp) return { type: 'comp', name: h.comp.name, label: `${h.comp.name}  ${h.comp.value || ''}  ${h.comp.package}` };
  return null;
}

let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (!scene) return;
  canvas.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY, moved: false, button: e.button };
});
canvas.addEventListener('pointermove', (e) => {
  const r = canvas.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 4) { drag.moved = true; canvas.classList.add('grabbing'); }
    if (drag.moved) { view.panBy(dx, dy); drag.x = e.clientX; drag.y = e.clientY; }
  }
  if (!scene) return;
  state.cursor = view.toWorld(sx, sy);
  if (state.measure.on && state.measure.a && !state.measure.done) { state.measure.b = state.cursor; view.redraw(); }
  scheduleHover();
  updateStatus();
});
canvas.addEventListener('pointerup', (e) => {
  canvas.classList.remove('grabbing');
  if (!drag) return;
  const wasDrag = drag.moved;
  drag = null;
  if (wasDrag || e.button !== 0 || !scene) return;
  const r = canvas.getBoundingClientRect();
  const [x, y] = view.toWorld(e.clientX - r.left, e.clientY - r.top);
  if (state.measure.on) {
    const m = state.measure;
    if (!m.a || m.done) { m.a = [x, y]; m.b = [x, y]; m.done = false; }
    else { m.b = [x, y]; m.done = true; }
    view.redraw(); updateStatus();
    return;
  }
  const h = hitAt(x, y);
  if (!h) { select(null); return; }
  if (h.pad) { select({ type: h.type, name: h.name, padOf: { comp: h.comp, pad: h.pad } }); return; }
  select({ type: h.type, name: h.name });
});
canvas.addEventListener('dblclick', (e) => {
  if (!scene || state.measure.on) return;
  const b = selectionBBox();
  if (b) view.fit(grow(b, state.selection.type === 'comp' ? 1.5 : 0.15), 0.1);
});
canvas.addEventListener('wheel', (e) => {
  if (!scene) return;
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  if (e.ctrlKey || !e.shiftKey) {
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    view.zoomAt(sx, sy, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018)));
  } else view.panBy(-e.deltaY, 0);
  updateStatus();
}, { passive: false });

let hoverPending = false;
function scheduleHover() {
  if (hoverPending) return;
  hoverPending = true;
  requestAnimationFrame(() => {
    hoverPending = false;
    if (!scene || drag?.moved) return;
    const h = state.measure.on ? null : hitAt(...state.cursor);
    $('#st-hover').textContent = h ? h.label : '';
    canvas.classList.toggle('pointer', !!h);
  });
}

function updateStatus() {
  const [x, y] = state.cursor;
  const u = state.units;
  const c = (v) => (u === 'mil' ? (v / 0.0254).toFixed(1) : u === 'in' ? (v / 25.4).toFixed(4) : v.toFixed(3));
  $('#st-xy').textContent = `X ${c(x)}  Y ${c(y)}`;
  let dx = x - state.origin[0], dy = y - state.origin[1];
  if (state.measure.on && state.measure.a) { dx = state.measure.b[0] - state.measure.a[0]; dy = state.measure.b[1] - state.measure.a[1]; }
  $('#st-dxy').textContent = `dx ${c(dx)}  dy ${c(dy)}  dist ${c(Math.hypot(dx, dy))}`;
  $('#st-zoom').textContent = `Z ${view.zoom >= 10 ? view.zoom.toFixed(0) : view.zoom.toFixed(2)}`;
  $('#st-grid').textContent = view.grid && scene ? `grid ${c(view.gridPitch())}` : '';
  $('#st-units').textContent = u;
  $('#st-file').textContent = state.fileName || 'No file loaded';
}
view.onchange = updateStatus;

// selection bbox + measurement drawn in world space
view.extraDraw = (ctx, v) => {
  const sel = state.selection;
  const px = 1 / (v.zoom * v.dpr);
  if (sel?.type === 'comp') {
    const b = selectionBBox();
    if (b) {
      const m = 4 / v.zoom;
      ctx.lineWidth = 1.5 * px * v.dpr;
      ctx.setLineDash([5 / v.zoom, 4 / v.zoom]);
      ctx.strokeStyle = state.mode === 'sch' ? '#ff8800' : '#ffffff';
      ctx.strokeRect(b.x0 - m, b.y0 - m, b.w + 2 * m, b.h + 2 * m);
      ctx.setLineDash([]);
    }
  }
  const M = state.measure;
  if (M.on && M.a && M.b) {
    const col = state.mode === 'sch' ? '#0050c8' : '#ffffff';
    ctx.strokeStyle = col; ctx.fillStyle = col;
    ctx.lineWidth = 1.5 / v.zoom;
    ctx.beginPath(); ctx.moveTo(M.a[0], M.a[1]); ctx.lineTo(M.b[0], M.b[1]); ctx.stroke();
    for (const p of [M.a, M.b]) { ctx.beginPath(); ctx.arc(p[0], p[1], 3 / v.zoom, 0, 7); ctx.fill(); }
    const d = Math.hypot(M.b[0] - M.a[0], M.b[1] - M.a[1]);
    const [sx, sy] = v.toScreen((M.a[0] + M.b[0]) / 2, (M.a[1] + M.b[1]) / 2);
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.font = '12px system-ui, sans-serif';
    const label = fmtLen(d);
    const w = ctx.measureText(label).width + 10;
    ctx.fillStyle = 'rgba(20,20,20,.8)'; ctx.fillRect(sx + 8, sy - 22, w, 18);
    ctx.fillStyle = '#fff'; ctx.fillText(label, sx + 13, sy - 9);
  }
};

// ------------------------------------------------------------------ export
function download(name, data, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function doExport(kind) {
  $('#export-menu').hidden = true;
  const proj = projectName((state.sch || state.brd)?.name);
  try {
    if (kind === 'kicad-zip') {
      const { files, notes } = exportKiCadProject({ sch: state.sch, brd: state.brd }, proj);
      download(`${proj}-kicad.zip`, writeZip(files.map((f) => ({ name: `${proj}/${f.name}`, data: f.data }))), 'application/zip');
      toast(`Exported KiCad project (${files.length} files).\n${notes.join('\n')}`, false, 8000);
    } else if (kind === 'kicad-sch') {
      if (!state.sch) return toast('No schematic loaded.', true);
      const r = exportSchematic(state.sch, proj);
      if (r.files.length === 2) download(r.files[0].name, r.files[0].data, 'text/plain');
      else download(`${proj}-schematic.zip`, writeZip(r.files), 'application/zip');
    } else if (kind === 'kicad-pcb') {
      if (!state.brd) return toast('No board loaded.', true);
      const r = exportBoard(state.brd, proj);
      download(r.name, r.data, 'text/plain');
      toast('Exported board. Press B in KiCad to fill zones.', false, 5000);
    } else if (kind === 'bom') {
      download(`${proj}-bom.csv`, bomCSV(state.sch, state.brd), 'text/csv');
    } else if (kind === 'png') {
      canvas.toBlob((b) => download(`${proj}-${state.mode === 'sch' ? `sheet${state.sheet + 1}` : 'pcb'}.png`, b), 'image/png');
    }
  } catch (e) {
    console.error(e);
    toast(`Export failed: ${e.message}`, true);
  }
}

// ------------------------------------------------------------------ toast
let toastTimer;
function toast(msg, err = false, ms = 3000) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  t.classList.toggle('err', err);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, err ? 8000 : ms);
}

// ------------------------------------------------------------------ wiring
$('#btn-open').onclick = () => $('#file-input').click();
$('#btn-open2').onclick = () => $('#file-input').click();
$('#btn-demo').onclick = async () => {
  try {
    if (window.__DEMO__) return openFiles(window.__DEMO__.map(([n, t]) => new File([t], n)));
    const files = await Promise.all(['examples/demo.sch', 'examples/demo.brd'].map(async (u) => new File([await (await fetch(u)).blob()], u.split('/').pop())));
    openFiles(files);
  } catch (e) { toast(`Could not load the demo: ${e.message}`, true); }
};
$('#file-input').onchange = (e) => { openFiles(e.target.files); e.target.value = ''; };
$('#tab-sch').onclick = () => setMode('sch');
$('#tab-brd').onclick = () => setMode('brd');
$('#btn-fit').onclick = () => scene && view.fit(scene.bbox);
$('#btn-zin').onclick = () => view.zoomAt(view.W / 2, view.H / 2, 1.5);
$('#btn-zout').onclick = () => view.zoomAt(view.W / 2, view.H / 2, 1 / 1.5);
$('#btn-grid').onclick = () => toggleGrid();
$('#btn-measure').onclick = () => toggleMeasure();
$('#btn-flip').onclick = () => toggleFlip();
$('#btn-contrast').onclick = () => toggleContrast();
$('#btn-help').onclick = () => $('#help').showModal();
$('#btn-clear').onclick = () => select(null);
$('#st-units').onclick = () => cycleUnits();
$('#btn-export').onclick = (e) => {
  e.stopPropagation();
  const m = $('#export-menu');
  m.hidden = !m.hidden;
  m.querySelector('[data-export="kicad-sch"]').disabled = !state.sch;
  m.querySelector('[data-export="kicad-pcb"]').disabled = !state.brd;
};
document.querySelectorAll('[data-export]').forEach((b) => { b.onclick = () => doExport(b.dataset.export); });
document.addEventListener('click', (e) => { if (!e.target.closest('.menu-wrap')) $('#export-menu').hidden = true; });
document.querySelectorAll('.ptab').forEach((b) => { b.onclick = () => { if (b.disabled) return; state.list = b.dataset.list; renderList(true); }; });
$('#search').addEventListener('input', (e) => { state.filter = e.target.value; renderList(); });

function toggleGrid() { view.grid = !view.grid; $('#btn-grid').classList.toggle('on', view.grid); view.redraw(); updateStatus(); }
function toggleMeasure(force) {
  const m = state.measure;
  m.on = force ?? !m.on; m.a = m.b = null; m.done = false;
  $('#btn-measure').classList.toggle('on', m.on);
  toast(m.on ? 'Measure: click two points. Esc to exit.' : 'Measure off', false, 1800);
  view.redraw();
}
function toggleFlip() {
  if (state.mode !== 'brd') return;
  const [cx] = [view.cx];
  state.flip = !state.flip;
  $('#btn-flip').classList.toggle('on', state.flip);
  rebuildScene();
  view.cx = cx;
  toast(state.flip ? 'Viewing from the bottom' : 'Viewing from the top', false, 1500);
}
function toggleContrast() {
  if (state.mode !== 'brd') return;
  state.highContrast = !state.highContrast;
  $('#btn-contrast').classList.toggle('on', state.highContrast);
  rebuildScene(); renderLayers();
}
function cycleUnits() {
  state.units = state.units === 'mm' ? 'mil' : state.units === 'mil' ? 'in' : 'mm';
  updateStatus(); renderProps();
}

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea')) {
    if (e.key === 'Escape') { e.target.blur(); }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); $('#file-input').click(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (!scene && e.key !== '?') return;
  switch (e.key) {
    case 'f': case 'F': case 'Home': view.fit(scene.bbox); break;
    case '+': case '=': view.zoomAt(view.W / 2, view.H / 2, 1.4); break;
    case '-': case '_': view.zoomAt(view.W / 2, view.H / 2, 1 / 1.4); break;
    case 'g': case 'G': toggleGrid(); break;
    case 'm': case 'M': toggleMeasure(); break;
    case 'v': case 'V': toggleFlip(); break;
    case 'h': case 'H': toggleContrast(); break;
    case 'u': case 'U': cycleUnits(); break;
    case '?': $('#help').showModal(); break;
    case '/': e.preventDefault(); $('#search').focus(); break;
    case ' ': e.preventDefault(); state.origin = [...state.cursor]; updateStatus(); toast('Relative origin set', false, 1000); break;
    case 'Tab':
      e.preventDefault();
      if (state.sch && state.brd) setMode(state.mode === 'sch' ? 'brd' : 'sch');
      break;
    case 'PageDown': if (state.mode === 'sch') gotoSheet(state.sheet + 1); break;
    case 'PageUp': if (state.mode === 'sch') gotoSheet(state.sheet - 1); break;
    case 'ArrowLeft': view.panBy(80, 0); break;
    case 'ArrowRight': view.panBy(-80, 0); break;
    case 'ArrowUp': view.panBy(0, 80); break;
    case 'ArrowDown': view.panBy(0, -80); break;
    case 'Escape':
      if (state.measure.on) toggleMeasure(false);
      else select(null);
      break;
    default: return;
  }
});

// drag & drop anywhere
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); $('.drop').classList.add('over'); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); $('.drop').classList.remove('over'); } });
window.addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0;
  document.body.classList.remove('dragging'); $('.drop').classList.remove('over');
  openFiles(e.dataTransfer.files);
});

new ResizeObserver(() => { const first = !view.W; view.resize(); if (first && scene) view.fit(scene.bbox); }).observe($('#stage'));
renderList();
updateStatus();

// ?open=url for quick demos / testing
const qp = new URLSearchParams(location.search).getAll('open');
if (qp.length) {
  Promise.all(qp.map(async (u) => { const r = await fetch(u); const b = await r.blob(); return new File([b], decodeURIComponent(u.split('/').pop())); }))
    .then(openFiles).catch((e) => toast(`Could not fetch ${qp.join(', ')}: ${e.message}`, true));
}
window.__viewer = { state, view, openFiles, setMode, select };
