// Minimal, fast XML parser sufficient for EAGLE / Fusion Electronics XML.
// Produces nodes: { tag, attrs, children, text }.
// Works in browsers and Node (no DOMParser dependency).

const ENTITY = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeEntities(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITY[e] ?? m;
  });
}

export function parseXML(src) {
  const root = { tag: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;
  const n = src.length;
  const attrRe = /([^\s=\/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i) {
      const t = src.slice(i, lt);
      if (/\S/.test(t)) stack[stack.length - 1].text += decodeEntities(t);
    }
    if (src.startsWith('<!--', lt)) {
      const e = src.indexOf('-->', lt + 4);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const e = src.indexOf(']]>', lt + 9);
      stack[stack.length - 1].text += src.slice(lt + 9, e < 0 ? n : e);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (src[lt + 1] === '?') {
      const e = src.indexOf('?>', lt + 2);
      i = e < 0 ? n : e + 2;
      continue;
    }
    if (src[lt + 1] === '!') {
      // DOCTYPE (may contain an internal subset in [...])
      let j = lt + 2, depth = 0;
      while (j < n) {
        const c = src[j];
        if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '>' && depth <= 0) break;
        j++;
      }
      i = j + 1;
      continue;
    }
    if (src[lt + 1] === '/') {
      const e = src.indexOf('>', lt + 2);
      const name = src.slice(lt + 2, e).trim();
      // pop to matching tag (tolerant of malformed input)
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].tag === name) { stack.length = k; break; }
      }
      i = e + 1;
      continue;
    }
    // start tag: find end '>' while respecting quotes
    let j = lt + 1, q = 0;
    while (j < n) {
      const c = src.charCodeAt(j);
      if (q) { if (c === q) q = 0; }
      else if (c === 34 || c === 39) q = c;
      else if (c === 62) break;
      j++;
    }
    let body = src.slice(lt + 1, j);
    let selfClose = false;
    if (body.endsWith('/')) { selfClose = true; body = body.slice(0, -1); }
    const sp = body.search(/\s/);
    const tag = sp < 0 ? body : body.slice(0, sp);
    const attrs = {};
    if (sp >= 0) {
      const as = body.slice(sp);
      attrRe.lastIndex = 0;
      let m;
      while ((m = attrRe.exec(as))) attrs[m[1]] = decodeEntities(m[3] !== undefined ? m[3] : m[4]);
    }
    const node = { tag, attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
    i = j + 1;
  }
  return root;
}

// helpers
export const kids = (node, tag) => (node ? node.children.filter((c) => c.tag === tag) : []);
export const kid = (node, tag) => (node ? node.children.find((c) => c.tag === tag) : undefined);
export function path(node, ...tags) {
  let cur = node;
  for (const t of tags) { cur = kid(cur, t); if (!cur) return undefined; }
  return cur;
}
