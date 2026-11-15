#!/usr/bin/env node
// Bundles the viewer into ONE self-contained HTML file (no server needed, works from file://).
// Usage: node scripts/build-single.mjs [out.html]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(root, 'dist', 'fusion-pcb-viewer.html'));
const order = [];
const seen = new Set();

function visit(rel) {
  if (seen.has(rel)) return;
  seen.add(rel);
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  for (const m of src.matchAll(/^import\s+\{[^}]*\}\s+from\s+'([^']+)';/gm)) visit(path.posix.join(path.posix.dirname(rel), m[1]));
  order.push(rel);
}
visit('js/app.js');

const modules = order.map((rel) => {
  let src = fs.readFileSync(path.join(root, rel), 'utf8');
  const exports = [];
  src = src.replace(/^import\s+\{([^}]*)\}\s+from\s+'([^']+)';/gm, (_, names, from) => {
    const dep = path.posix.join(path.posix.dirname(rel), from);
    const list = names.split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/\s+as\s+/, ': '));
    return `const { ${list.join(', ')} } = __mods[${JSON.stringify(dep)}];`;
  });
  src = src.replace(/^export\s+(async\s+function|function|class|const|let)\s+([A-Za-z_$][\w$]*)/gm, (_, kw, name) => { exports.push(name); return `${kw} ${name}`; });
  src = src.replace(/^export\s+\{([^}]*)\};?/gm, (_, names) => { for (const n of names.split(',')) if (n.trim()) exports.push(n.trim()); return ''; });
  if (/^\s*(import|export)\s/m.test(src)) throw new Error(`Unsupported import/export form in ${rel}`);
  return `__mods[${JSON.stringify(rel)}] = (() => {\n${src}\nreturn { ${[...new Set(exports)].join(', ')} };\n})();`;
});

const demo = [['demo.sch', fs.readFileSync(path.join(root, 'examples/demo.sch'), 'utf8')], ['demo.brd', fs.readFileSync(path.join(root, 'examples/demo.brd'), 'utf8')]];
const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace('<link rel="stylesheet" href="css/style.css">', () => `<style>\n${css}\n</style>`);
const js = `"use strict";\nwindow.__DEMO__ = ${JSON.stringify(demo).replace(/</g, '\\u003c')};\nconst __mods = {};\n${modules.join('\n\n')}\n`;
html = html.replace('<script type="module" src="js/app.js"></script>', () => `<script>\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`Wrote ${out} (${(html.length / 1024).toFixed(0)} KB, ${order.length} modules)`);
