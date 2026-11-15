#!/usr/bin/env node
// Command-line converter: node cli/fusion2kicad.mjs <design.fsch> [design.fbrd] [-o outdir] [-n name]
import fs from 'node:fs';
import path from 'node:path';
import { loadBytes } from '../js/loader.js';
import { buildBoard, buildSchematic } from '../js/eagle.js';
import { exportKiCadProject, projectName } from '../js/kicad/project.js';

const args = process.argv.slice(2);
let out = null, name = null;
const inputs = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-o') out = args[++i];
  else if (args[i] === '-n') name = args[++i];
  else if (args[i] === '-h' || args[i] === '--help') { usage(); process.exit(0); }
  else inputs.push(args[i]);
}
function usage() {
  console.log('Usage: node cli/fusion2kicad.mjs <file.fsch|.sch|.fbrd|.brd|.f3z|.zip>... [-o outdir] [-n projectname]');
}
if (!inputs.length) { usage(); process.exit(1); }

let sch = null, brd = null;
const warnings = [];
for (const f of inputs) {
  const docs = await loadBytes(path.basename(f), new Uint8Array(fs.readFileSync(f)), 0, warnings);
  for (const d of docs) {
    if (d.kind === 'schematic' && !sch) sch = buildSchematic(d);
    else if (d.kind === 'board' && !brd) brd = buildBoard(d);
  }
}
if (!sch && !brd) { console.error('No schematic or board found.', warnings.join('\n')); process.exit(2); }
const proj = name || projectName((sch || brd).name);
out = out || path.join(process.cwd(), `${proj}-kicad`);
const { files, notes } = exportKiCadProject({ sch, brd }, proj);
for (const f of files) {
  const p = path.join(out, f.name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, f.data);
}
for (const w of [...warnings, ...(sch?.warnings || []), ...(brd?.warnings || [])]) console.warn('warning:', w);
console.log(`Wrote ${files.length} files to ${out}`);
for (const n of notes) console.log(' -', n);
