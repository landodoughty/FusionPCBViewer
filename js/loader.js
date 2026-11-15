// Turns raw file bytes (.fsch, .fbrd, .sch, .brd, .f3z/.zip, .lbr) into parsed EAGLE XML documents.
// Fusion Electronics native files are either plain EAGLE XML or a ZIP container that
// holds the EAGLE XML (plus metadata / preview images). Both are handled, recursively.
import { parseXML, path } from './xml.js';
import { readZip, isZip, isGzip, gunzip } from './zip.js';

const td = new TextDecoder('utf-8');
const SKIP_EXT = /\.(png|jpe?g|gif|bmp|svg|json|txt|md|f3d|step|stp|stl|obj|wrl|ico)$/i;

/** @returns {Promise<Array<{name:string, kind:'schematic'|'board'|'library', root:object, version:string}>>} */
export async function loadBytes(name, bytes, depth = 0, warnings = []) {
  const docs = [];
  if (depth > 6) return docs;
  if (isGzip(bytes)) {
    try { return loadBytes(name.replace(/\.gz$/i, ''), await gunzip(bytes), depth + 1, warnings); }
    catch (e) { warnings.push(`${name}: gzip error ${e.message}`); return docs; }
  }
  if (isZip(bytes)) {
    let entries;
    try { entries = readZip(bytes); } catch (e) { warnings.push(`${name}: bad zip (${e.message})`); return docs; }
    for (const ent of entries) {
      if (ent.name.endsWith('/') || SKIP_EXT.test(ent.name)) continue;
      try {
        const data = await ent.read();
        const sub = await loadBytes(`${name}/${ent.name}`, data, depth + 1, warnings);
        docs.push(...sub);
      } catch (e) {
        warnings.push(`${name}/${ent.name}: ${e.message}`);
      }
    }
    return docs;
  }
  // text?
  let text = td.decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const idx = text.indexOf('<eagle');
  if (idx < 0) {
    if (depth === 0) {
      if (bytes.length > 16 && text.slice(0, 16).includes('EAGLE') === false && bytes[0] === 0x10)
        warnings.push(`${name}: looks like a legacy binary EAGLE (<6.0) file, which is not supported. Re-save it as XML.`);
      else warnings.push(`${name}: no EAGLE/Fusion XML found in this file.`);
    }
    return docs;
  }
  const root = parseXML(text);
  const eagle = root.children.find((c) => c.tag === 'eagle');
  if (!eagle) { warnings.push(`${name}: could not parse XML.`); return docs; }
  const drawing = path(eagle, 'drawing');
  let kind = null;
  if (path(drawing, 'schematic')) kind = 'schematic';
  else if (path(drawing, 'board')) kind = 'board';
  else if (path(drawing, 'library')) kind = 'library';
  if (!kind) { warnings.push(`${name}: unknown EAGLE drawing type.`); return docs; }
  docs.push({ name, kind, root: eagle, version: eagle.attrs.version || '' });
  return docs;
}

export async function loadFiles(fileList) {
  const warnings = [];
  const docs = [];
  for (const f of fileList) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    docs.push(...(await loadBytes(f.name, bytes, 0, warnings)));
  }
  return { docs, warnings };
}
