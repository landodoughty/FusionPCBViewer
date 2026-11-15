# Fusion PCB Viewer

A KiCad-style viewer for **Autodesk Fusion Electronics** (`.fsch` / `.fbrd`) and **EAGLE** (`.sch` / `.brd`) designs, with a one-click **export to KiCad**.

It runs entirely in your browser. Files are never uploaded, and there's nothing to install.

![features](https://img.shields.io/badge/schematic-%E2%9C%93-009600) ![features](https://img.shields.io/badge/pcb-%E2%9C%93-c83434) ![features](https://img.shields.io/badge/kicad%20export-%E2%9C%93-4d7fc4)

## Quick start

**Option A: single file, works offline.** Open `dist/fusion-pcb-viewer.html` in Chrome, Edge, Firefox or Safari. You can double-click it.

**Option B: from the source tree.**

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Any static web server works.

Drop your `.fsch` and `.fbrd` onto the window, or use **Open…**. Open both files (together or one after the other) to get schematic ↔ PCB cross-probing. Or click **Try the demo**.

## Viewing

| | Schematic | PCB |
|---|---|---|
| Look | KiCad default schematic colors: green wires, dark-red symbols, junctions, net labels, cross-reference flags, sheet frames | KiCad default dark board colors, per-layer visibility, active layer, high-contrast mode |
| Layers | KiCad's Appearance names: Wires, Buses, Junctions, Labels, Pins, Symbol references… | KiCad layer names, order and colors (`F.Cu`, `In1.Cu`, `B.Cu`, `F.Silkscreen`, `F.Fab`, `Edge.Cuts`, `User.Drawings`…), grouped exactly as they are exported. Hover a layer to see which EAGLE layers it contains |
| Navigation | Sheet list, PgUp/PgDn | Flip board (view from bottom), Front/Back layer presets |
| Copper | n/a | Tracks, arcs, vias (incl. blind/buried), SMD and through-hole pads with EAGLE restring rules, **copper pours previewed with clearances** |
| Inspect | Click a part for value, device, library, package, attributes and description. Click a wire, pin or label to highlight the net (with all its connections) | Click a pad, track, via or pour to highlight the net (routed length, vias, connected pads). Click a part for position, rotation, side and pads |

It also has:

* **Cross-probing:** select a part or net, press <kbd>Tab</kbd>, and it's highlighted in the other view (jumping to the right sheet).
* **Searchable lists** of sheets, parts and nets. Click an entry to zoom to it.
* **Measure tool** (<kbd>M</kbd>), a relative origin (<kbd>Space</kbd>), and mm / mil / inch units (<kbd>U</kbd>).
* **Export**: KiCad project, BOM (`.csv`), or a PNG of the current view.

Press <kbd>?</kbd> in the app for all shortcuts.

## Export to KiCad

**Export → KiCad project (.zip)** produces a project that opens in **KiCad 7, 8 and 9**:

```
myboard/
  myboard.kicad_pro
  myboard.kicad_sch              root sheet (or the only sheet)
  myboard_sheet1.kicad_sch …     one sub-sheet per EAGLE sheet (multi-sheet designs)
  myboard.kicad_pcb
  myboard.kicad_sym + sym-lib-table     symbol library
  myboard.pretty/ + fp-lib-table        footprint library
  CONVERSION_NOTES.txt
```

What gets converted:

* **Symbols.** Multi-gate devices become multi-unit symbols. Pin types, inverted/clock styles, hidden pins, EAGLE `!overbar!` names (→ `~{…}`), and pads mapped to pin numbers all carry over. Supply symbols become KiCad power symbols named after the net they're on.
* **Schematic.** Wires, junctions, buses, net labels, texts and graphics, plus part attributes (MPN etc.) as fields. Nets that span sheets get global labels. Net segments that EAGLE connects *by name only* get labels added, so the connectivity stays the same.
* **Board.** Footprints (top and bottom), pads (round / square / octagon / long / offset / rounded SMD), tracks, arc tracks, vias, pours (as zones with priority / clearance / width), board outline, holes, silkscreen, fab and docu text. Inner layers are mapped to `In1.Cu…`.
* **Linking.** Footprints are linked to their schematic symbols, so *Update PCB from Schematic* works straight away.

After opening the board in KiCad, press **B** (*Edit → Fill All Zones*). EAGLE files store pour outlines only, not the poured copper.

### Command line

The converter also runs in Node 18+ with no dependencies:

```bash
node cli/fusion2kicad.mjs design.fsch design.fbrd -o out/ -n myproject
```

## About the file formats

Fusion Electronics stores designs in EAGLE's XML format. A `.fsch`/`.fbrd` is either the XML directly or a ZIP container that holds it (with metadata and previews). The viewer handles both, plus `.f3z`/`.zip` archives, searching nested archives for EAGLE XML. If a file won't open, use Fusion's **Export → EAGLE schematic/board** and open the `.sch`/`.brd` instead. Legacy binary EAGLE files (before v6) aren't supported.

## Accuracy

The KiCad converter was checked against real open-source designs (SparkFun Qwiic Button, Thing Plus ESP32, RTK Express/Facet with 4 layers and 2 sheets, Artemis, OpenLog Artemis):

* **Schematic:** KiCad's netlist computed from the exported schematic matches the EAGLE nets exactly on every design.
* **Board:** every pad's position, size, drill, side and net, plus track and via counts, was compared with KiCad's own built-in EAGLE importer. They match, with two deliberate differences:
  * Pad diameters follow EAGLE's design-rule restring (what EAGLE's Gerbers produce).
  * Net assignments follow the file. On one design KiCad's importer assigned some BGA pads to the wrong nets.

### Known limitations

* The pour preview in the viewer is an approximation: thermals and orphan removal aren't modelled. The KiCad export uses real zones.
* EAGLE hierarchical *modules* (design blocks) are shown as boxes, and their contents aren't converted.
* Restrict / keepout layers are exported as drawings on `Cmts.User`, not as rule areas. Net classes and design rules aren't exported.
* Text uses a sans-serif font, not EAGLE's vector font, so text widths differ slightly.

## Development

```bash
node test/run.mjs               # tests; if kicad-cli is installed, also round-trips through real KiCad
node scripts/build-single.mjs   # rebuild dist/fusion-pcb-viewer.html
```

```
index.html, css/        UI
js/app.js               UI controller (panels, selection, cross-probing, export menu)
js/loader.js, zip.js    file detection, ZIP/gzip containers
js/xml.js               small XML parser (browser + Node)
js/eagle.js             EAGLE/Fusion model → resolved geometry (libraries, symbols, packages, nets)
js/geom.js, layers.js   transforms (EAGLE rotation/mirror rules), KiCad colors and layer mapping
js/render.js, scenes.js canvas renderer (batched Path2D, pours), hit testing
js/kicad/*.js           KiCad writers (.kicad_sch, .kicad_sym, .kicad_pcb, .kicad_mod, project)
cli/fusion2kicad.mjs    command-line converter
examples/               hand-made demo design (2 sheets, bottom part, via, arc track, pour)
```
