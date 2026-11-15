// S-expression helpers for KiCad file writing.
export const q = (s) => '"' + String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n') + '"';
export function f(n) {
  const r = Math.round((+n || 0) * 1e4) / 1e4;
  return Object.is(r, -0) || r === 0 ? '0' : String(r);
}
export const xy = (x, y) => `(xy ${f(x)} ${f(y)})`;
let fallbackCounter = 0;
export function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const h = (n) => Math.floor(Math.random() * 16 ** n).toString(16).padStart(n, '0');
  fallbackCounter++;
  return `${h(8)}-${h(4)}-4${h(3)}-a${h(3)}-${h(12)}`;
}
/** KiCad library item / nickname safe name. */
export const sanitize = (s) => String(s || 'unnamed').replace(/[^A-Za-z0-9_.+\-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'unnamed';

/** EAGLE "!" overbar notation → KiCad ~{...}. */
export function kicadText(s) {
  s = String(s ?? '');
  if (!s.includes('!')) return s;
  let out = '', on = false, buf = '';
  for (const ch of s) {
    if (ch === '!') {
      if (on) { out += buf ? `~{${buf}}` : ''; buf = ''; on = false; }
      else on = true;
    } else if (on) {
      if (ch === '/' || ch === ',' || ch === ' ') { out += (buf ? `~{${buf}}` : '') + ch; buf = ''; on = false; }
      else buf += ch;
    } else out += ch;
  }
  if (on && buf) out += `~{${buf}}`;
  return out;
}

export function justify(h, v, mirror = false) {
  const parts = [];
  if (h < 0) parts.push('left'); else if (h > 0) parts.push('right');
  if (v < 0) parts.push('bottom'); else if (v > 0) parts.push('top');
  if (mirror) parts.push('mirror');
  return parts.length ? ` (justify ${parts.join(' ')})` : '';
}

/** KiCad requires references to end in a number to count as annotated (same rule as KiCad's EAGLE importer). */
export const kicadRef = (n) => (/\d$/.test(n) ? n : `${n}0`);
