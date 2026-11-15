// Bundles a full KiCad project from loaded EAGLE/Fusion documents.
import { exportSchematic } from './sch.js';
import { exportBoard, exportFootprintLibrary } from './pcb.js';
import { sanitize } from './sexpr.js';

export function projectName(name) {
  return sanitize(String(name || 'project').split('/').pop().replace(/\.(fsch|fbrd|sch|brd|f3z|zip|xml)$/i, '')) || 'project';
}

/** @returns {{files: Array<{name, data}>, notes: string[]}} */
export function exportKiCadProject({ sch, brd }, proj) {
  const files = [];
  const notes = [];
  let refPaths;
  let rootUuid;
  if (sch) {
    const r = exportSchematic(sch, proj);
    files.push(...r.files);
    refPaths = r.refPaths;
    rootUuid = r.rootUuid;
    if (sch.sheets.length > 1) notes.push(`The ${sch.sheets.length} EAGLE sheets were converted to hierarchical sub-sheets of the root sheet; nets spanning sheets use global labels.`);
  }
  if (brd) {
    const r = exportBoard(brd, proj, { refPaths });
    files.push({ name: r.name, data: r.data });
    files.push(...exportFootprintLibrary(brd, proj));
    if (brd.shapes.some((s) => s.zone)) notes.push('Copper pours were exported as unfilled zones: open the board and press B (Edit → Fill All Zones) to pour them.');
  }
  const pro = {
    board: { design_settings: { defaults: {}, rules: {} } },
    meta: { filename: `${proj}.kicad_pro`, version: 1 },
    sheets: rootUuid ? [[rootUuid, '']] : [],
    libraries: { pinned_footprint_libs: [], pinned_symbol_libs: [] },
    pcbnew: { last_paths: {} },
    schematic: {},
    text_variables: {},
  };
  files.push({ name: `${proj}.kicad_pro`, data: JSON.stringify(pro, null, 2) + '\n' });
  if (sch) files.push({ name: 'sym-lib-table', data: `(sym_lib_table\n  (version 7)\n  (lib (name "${proj}")(type "KiCad")(uri "\${KIPRJMOD}/${proj}.kicad_sym")(options "")(descr "Converted from Fusion/EAGLE"))\n)\n` });
  if (brd) files.push({ name: 'fp-lib-table', data: `(fp_lib_table\n  (version 7)\n  (lib (name "${proj}")(type "KiCad")(uri "\${KIPRJMOD}/${proj}.pretty")(options "")(descr "Converted from Fusion/EAGLE"))\n)\n` });
  notes.push('Symbols and footprints are embedded in the schematic/board and also provided as project libraries (sym-lib-table / fp-lib-table).');
  files.push({ name: 'CONVERSION_NOTES.txt', data: `Converted by Fusion PCB Viewer\n\n${notes.map((n) => '- ' + n).join('\n')}\n` });
  return { files, notes };
}

export function bomCSV(sch, brd) {
  const rows = [['Reference', 'Value', 'Package', 'Library', 'Device']];
  const esc = (v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
  if (sch) {
    for (const p of sch.parts.values()) {
      if (!p.dev?.package) continue;
      rows.push([p.name, p.value, p.package, p.library, p.deviceset + (p.device || '')]);
    }
  } else if (brd) {
    for (const e of brd.elements) rows.push([e.name, e.value, e.package, e.library, '']);
  }
  rows.splice(1, rows.length - 1, ...rows.slice(1).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })));
  return rows.map((r) => r.map(esc).join(',')).join('\n') + '\n';
}
