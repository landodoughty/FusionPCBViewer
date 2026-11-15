#!/usr/bin/env node
// Dependency-free test suite: node test/run.mjs
// If kicad-cli (KiCad 7+) is on PATH, exported files are also loaded by KiCad and the netlist is verified.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseXML } from '../js/xml.js';
import { readZip, writeZip } from '../js/zip.js';
import { loadBytes } from '../js/loader.js';
import { buildBoard, buildSchematic } from '../js/eagle.js';
import { parseRot, xf, arcFromCurve, composeRot } from '../js/geom.js';
import { exportKiCadProject } from '../js/kicad/project.js';
import { kicadText } from '../js/kicad/sexpr.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ex = (f) => path.join(root, 'examples', f);
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.stack?.split('\n').slice(0, 3).join('\n    ')}`); }
}
function eq(a, b, msg = '') { if (a !== b) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function near(a, b, msg = '', tol = 1e-6) { if (Math.abs(a - b) > tol) throw new Error(`${msg} expected ${b}, got ${a}`); }
function ok(v, msg) { if (!v) throw new Error(msg || 'assertion failed'); }
async function load(file) {
  const docs = await loadBytes(path.basename(file), new Uint8Array(fs.readFileSync(file)));
  ok(docs.length === 1, `expected one document in ${file}`);
  return docs[0];
}
function balanced(s) {
  let d = 0, inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '(') d++;
    else if (c === ')') { d--; if (d < 0) return false; }
  }
  return d === 0 && !inStr;
}

console.log('core');
await test('XML parser handles entities, CDATA, comments, doctype', () => {
  const r = parseXML('<?xml version="1.0"?><!DOCTYPE eagle SYSTEM "eagle.dtd"><!-- c --><a x="1 &amp; 2"><b>&gt;NAME</b><c><![CDATA[<raw>]]></c><d/></a>');
  const a = r.children[0];
  eq(a.attrs.x, '1 & 2'); eq(a.children[0].text, '>NAME'); eq(a.children[1].text, '<raw>'); eq(a.children.length, 3);
});
await test('rotation parsing and transforms (rotate, then mirror)', () => {
  const r = parseRot('SMR90');
  ok(r.spin && r.mirror); eq(r.angle, 90);
  const [x, y] = xf({ x: 10, y: 0, angle: 90, mirror: true }, 1, 0);
  near(x, 10); near(y, 1);
  const c = composeRot({ angle: 90, mirror: true }, { angle: 0, mirror: true });
  eq(c.mirror, false); eq(c.angle, 270);
});
await test('arc from EAGLE curve', () => {
  const a = arcFromCurve(1, 0, 0, 1, 90);
  near(a.cx, 0); near(a.cy, 0); near(a.r, 1);
  const b = arcFromCurve(0, 1, 1, 0, -90);
  near(b.cx, 0); near(b.cy, 0);
});
await test('zip write/read roundtrip', async () => {
  const z = writeZip([{ name: 'a.txt', data: 'hello' }, { name: 'dir/b.bin', data: new Uint8Array([1, 2, 3]) }]);
  const e = readZip(z);
  eq(e.length, 2); eq(new TextDecoder().decode(await e[0].read()), 'hello'); eq((await e[1].read())[2], 3);
});
await test('EAGLE overbar → KiCad', () => {
  eq(kicadText('!RESET'), '~{RESET}'); eq(kicadText('!CS!/WR'), '~{CS}/WR'); eq(kicadText('A!B!C'), 'A~{B}C'); eq(kicadText('GND'), 'GND');
});

console.log('loading');
let sch, brd;
await test('schematic loads (2 sheets, parts, nets)', async () => {
  sch = buildSchematic(await load(ex('demo.sch')));
  eq(sch.sheets.length, 2); eq(sch.parts.size, 6); eq(sch.nets.size, 3);
  eq([...sch.nets.get('LED_A').sheets].join(','), '0,1');
  const r1 = sch.sheets[0].instances.find((i) => i.part === 'R1');
  const p2 = r1.pins.find((p) => p.name === '2');
  near(p2.x, 38.1); near(p2.y, 25.4); eq(p2.net, 'LED_A');
  const d1 = sch.sheets[1].instances.find((i) => i.part === 'D1');
  const a = d1.pins.find((p) => p.name === 'A');
  near(a.x, 30.48, 'mirrored instance pin x'); eq(a.net, 'LED_A');
  eq(sch.warnings.length, 0, 'warnings');
});
await test('board loads (bottom part, pads, nets, via, pour)', async () => {
  brd = buildBoard(await load(ex('demo.brd')));
  eq(brd.elements.length, 3); eq(brd.nets.size, 3);
  const r1 = brd.elements.find((e) => e.name === 'R1');
  const p1 = r1.pads.find((p) => p.name === '1');
  near(p1.x, 15); near(p1.y, 11.25); eq(p1.net, 'VCC'); eq(p1.angle, 90);
  const d1 = brd.elements.find((e) => e.name === 'D1');
  ok(d1.rot.mirror); const a = d1.pads.find((p) => p.name === 'A');
  eq(a.layer, 16); near(a.x, 21.25); eq(a.net, 'LED_A');
  const j1 = brd.elements.find((e) => e.name === 'J1');
  eq(j1.pads.find((p) => p.name === '1').shape, 'rect'); eq(j1.pads.find((p) => p.name === '2').shape, 'oct');
  eq(brd.shapes.filter((s) => s.k === 'via').length, 1);
  eq(brd.shapes.filter((s) => s.zone).length, 1);
  ok(brd.shapes.some((s) => s.k === 'arc' && s.net === 'VCC'), 'curved track');
  ok(brd.outline && Math.abs(brd.outline.w - 30) < 1e-9, 'outline');
});
await test('Fusion-style ZIP container (.fbrd with deflate) loads', async () => {
  const d = await load(ex('demo-container.fbrd'));
  eq(d.kind, 'board');
  eq(buildBoard(d).elements.length, 3);
});

console.log('kicad export');
let files;
await test('project export produces balanced, complete files', () => {
  ({ files } = exportKiCadProject({ sch, brd }, 'demo'));
  const names = files.map((f) => f.name);
  for (const n of ['demo.kicad_sch', 'demo_sheet1.kicad_sch', 'demo_sheet2.kicad_sch', 'demo.kicad_pcb', 'demo.kicad_pro', 'demo.kicad_sym', 'sym-lib-table', 'fp-lib-table'])
    ok(names.includes(n), `missing ${n}`);
  ok(names.some((n) => n.startsWith('demo.pretty/')), 'footprint lib');
  for (const f of files) if (/\.(kicad_sch|kicad_pcb|kicad_sym|kicad_mod)$|lib-table$/.test(f.name)) ok(balanced(f.data), `unbalanced parens in ${f.name}`);
  JSON.parse(files.find((f) => f.name === 'demo.kicad_pro').data);
});
await test('schematic export: global labels across sheets, power symbols, mirror', () => {
  const s1 = files.find((f) => f.name === 'demo_sheet1.kicad_sch').data;
  const s2 = files.find((f) => f.name === 'demo_sheet2.kicad_sch').data;
  ok(s1.includes('(global_label "LED_A"') && s2.includes('(global_label "LED_A"'), 'LED_A global labels');
  ok(/\(symbol "demo:[^"]*GND[^"]*" \(power\)/.test(s1), 'power symbol');
  ok(/lib_id "demo:demo_LED_0603"\) \(at [\d.]+ [\d.]+ 0\) \(mirror y\)/.test(s2), 'mirrored LED');
});
await test('board export: footprints, bottom side, arc track, via, zone', () => {
  const p = files.find((f) => f.name === 'demo.kicad_pcb').data;
  ok(/\(footprint "demo:demo_LED0603" \(layer "B\.Cu"\)/.test(p), 'bottom footprint');
  ok(/\(pad "1" thru_hole rect/.test(p) && /\(chamfer_ratio 0\.2929\)/.test(p), 'square + octagon pads');
  ok(/\n  \(arc \(start/.test(p), 'arc track'); ok(/\(via \(at/.test(p), 'via'); ok(/\(zone \(net \d+\) \(net_name "GND"\) \(layer "B\.Cu"\)/.test(p), 'zone');
  ok(/\(gr_arc .*\(layer "Edge\.Cuts"\)/.test(p), 'outline arc'); ok(p.includes('np_thru_hole'), 'mounting hole');
  ok(/\(path "\/[0-9a-f-]+\/[0-9a-f-]+"\)/.test(p), 'footprints linked to schematic symbols');
  ok(!p.includes('In1.Cu'), 'a 2-layer board with through vias must not gain inner layers');
});

// optional: let real KiCad load the files
let kicad = null;
try { kicad = execFileSync('kicad-cli', ['version'], { encoding: 'utf8' }).trim(); } catch { /* not installed */ }
if (kicad) {
  console.log(`kicad-cli ${kicad}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fpv-'));
  for (const f of files) { fs.mkdirSync(path.dirname(path.join(dir, f.name)), { recursive: true }); fs.writeFileSync(path.join(dir, f.name), f.data); }
  const env = { ...process.env, HOME: dir };
  await test('KiCad loads the schematic and computes the same nets', () => {
    execFileSync('kicad-cli', ['sch', 'export', 'netlist', '-o', path.join(dir, 'n.net'), path.join(dir, 'demo.kicad_sch')], { env, stdio: 'pipe' });
    const net = fs.readFileSync(path.join(dir, 'n.net'), 'utf8');
    const nodes = (name) => {
      const m = new RegExp(`\\(name "/?${name}"\\)([\\s\\S]*?)\\(net \\(code|\\(name "${name}"\\)([\\s\\S]*)$`).exec(net);
      return [...((m?.[1] || m?.[2] || '').matchAll(/\(ref "([^"]+)"\) \(pin "([^"]+)"\)/g))].map((x) => `${x[1]}.${x[2]}`).sort().join(' ');
    };
    eq(nodes('LED_A'), 'D1.A R1.2', 'LED_A'); eq(nodes('GND'), 'D1.C J1.2', 'GND'); eq(nodes('VCC'), 'J1.1 R1.1', 'VCC');
  });
  await test('KiCad loads the board', () => {
    execFileSync('kicad-cli', ['pcb', 'export', 'svg', '--layers', 'F.Cu,B.Cu', '-o', path.join(dir, 'b.svg'), path.join(dir, 'demo.kicad_pcb')], { env, stdio: 'pipe' });
    ok(fs.statSync(path.join(dir, 'b.svg')).size > 1000);
  });
  fs.rmSync(dir, { recursive: true, force: true });
} else console.log('(kicad-cli not found: skipping KiCad round-trip checks)');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
