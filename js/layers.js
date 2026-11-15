// Layer metadata, KiCad-like colors and EAGLE → KiCad layer mapping.

export const BOARD_LAYER_NAMES = {
  1: 'Top', 16: 'Bottom', 17: 'Pads', 18: 'Vias', 19: 'Unrouted', 20: 'Dimension',
  21: 'tPlace', 22: 'bPlace', 23: 'tOrigins', 24: 'bOrigins', 25: 'tNames', 26: 'bNames',
  27: 'tValues', 28: 'bValues', 29: 'tStop', 30: 'bStop', 31: 'tCream', 32: 'bCream',
  33: 'tFinish', 34: 'bFinish', 35: 'tGlue', 36: 'bGlue', 37: 'tTest', 38: 'bTest',
  39: 'tKeepout', 40: 'bKeepout', 41: 'tRestrict', 42: 'bRestrict', 43: 'vRestrict',
  44: 'Drills', 45: 'Holes', 46: 'Milling', 47: 'Measures', 48: 'Document', 49: 'Reference',
  51: 'tDocu', 52: 'bDocu',
};
for (let i = 2; i <= 15; i++) BOARD_LAYER_NAMES[i] = `Route${i}`;

const INNER_COLORS = ['#7fc87f', '#ce7d2c', '#4fcbcb', '#db628b', '#a7a5c6', '#28cccc', '#d6c93e', '#c87fc8', '#5c8f5c', '#9d5c2a', '#3d9696', '#a54c69', '#8584a6', '#aaa53c'];

// KiCad "default" PCB colors
export const KICAD_PCB_COLORS = {
  background: '#001023',
  grid: '#848484',
  'F.Cu': '#c83434', 'B.Cu': '#4d7fc4',
  'F.SilkS': '#f2eda1', 'B.SilkS': '#e8b2a7',
  'F.Fab': '#afafaf', 'B.Fab': '#585d84',
  'F.Mask': '#d864ff', 'B.Mask': '#02ffee',
  'F.Paste': '#b4a09a', 'B.Paste': '#00c2c2',
  'F.Adhes': '#840084', 'B.Adhes': '#0000c2',
  'F.CrtYd': '#ff26e2', 'B.CrtYd': '#26e9ff',
  'Edge.Cuts': '#d0d2cd', 'Dwgs.User': '#c2c2c2', 'Cmts.User': '#5994dc',
  pads: '#e3b72e', vias: '#ececec', holes: '#e3b72e', ratsnest: '#f5f5f5',
};

export function boardLayerInfo(num, name) {
  num = +num;
  const n = name || BOARD_LAYER_NAMES[num] || `Layer${num}`;
  let color = '#9a9a9a', kicad = null, visible = true, alpha = 1;
  const C = KICAD_PCB_COLORS;
  if (num === 1) { color = C['F.Cu']; kicad = 'F.Cu'; }
  else if (num === 16) { color = C['B.Cu']; kicad = 'B.Cu'; }
  else if (num >= 2 && num <= 15) { color = INNER_COLORS[num - 2]; kicad = 'inner'; }
  else switch (num) {
    case 17: color = C.pads; break;
    case 18: color = C.vias; break;
    case 19: color = C.ratsnest; break;
    case 20: color = C['Edge.Cuts']; kicad = 'Edge.Cuts'; break;
    case 46: color = C['Edge.Cuts']; kicad = 'Edge.Cuts'; break;
    case 21: color = C['F.SilkS']; kicad = 'F.SilkS'; break;
    case 22: color = C['B.SilkS']; kicad = 'B.SilkS'; break;
    case 25: color = C['F.SilkS']; kicad = 'F.SilkS'; break;
    case 26: color = C['B.SilkS']; kicad = 'B.SilkS'; break;
    case 27: color = C['F.Fab']; kicad = 'F.Fab'; break;
    case 28: color = C['B.Fab']; kicad = 'B.Fab'; break;
    case 51: color = '#c4c4a0'; kicad = 'F.Fab'; break;
    case 52: color = '#7f84b0'; kicad = 'B.Fab'; break;
    case 29: color = C['F.Mask']; kicad = 'F.Mask'; alpha = 0.45; visible = false; break;
    case 30: color = C['B.Mask']; kicad = 'B.Mask'; alpha = 0.45; visible = false; break;
    case 31: color = C['F.Paste']; kicad = 'F.Paste'; visible = false; break;
    case 32: color = C['B.Paste']; kicad = 'B.Paste'; visible = false; break;
    case 35: color = C['F.Adhes']; kicad = 'F.Adhes'; visible = false; break;
    case 36: color = C['B.Adhes']; kicad = 'B.Adhes'; visible = false; break;
    case 39: color = C['F.CrtYd']; kicad = 'F.CrtYd'; visible = false; break;
    case 40: color = C['B.CrtYd']; kicad = 'B.CrtYd'; visible = false; break;
    case 41: color = '#ff6060'; kicad = 'Cmts.User'; visible = false; alpha = 0.6; break;
    case 42: color = '#6060ff'; kicad = 'Cmts.User'; visible = false; alpha = 0.6; break;
    case 43: color = '#ff60ff'; kicad = 'Cmts.User'; visible = false; alpha = 0.6; break;
    case 23: case 24: visible = false; break;
    case 33: case 34: case 37: case 38: visible = false; break;
    case 44: case 45: color = C.holes; visible = false; break;
    case 47: color = C['Dwgs.User']; kicad = 'Dwgs.User'; break;
    case 48: color = C['Cmts.User']; kicad = 'Cmts.User'; break;
    case 49: color = C['Dwgs.User']; kicad = 'Dwgs.User'; visible = false; break;
    default:
      if (num >= 100) { color = '#9ab0c8'; kicad = 'Dwgs.User'; }
  }
  return { num, name: n, color, kicad, visible, alpha };
}

/** Back-to-front drawing order key for board layers (lower is drawn first). */
export function boardLayerOrder(num, flipped = false) {
  num = +num;
  const back = [52, 28, 40, 42, 22, 26, 36, 32, 30, 34, 38, 24];
  const front = [23, 37, 33, 29, 31, 35, 21, 25, 41, 39, 27, 51];
  let o;
  if (num === 16) o = 100;
  else if (num >= 2 && num <= 15) o = 100 + (16 - num);
  else if (num === 1) o = 120;
  else if (back.includes(num)) o = 10 + back.indexOf(num);
  else if (front.includes(num)) o = 200 + front.indexOf(num);
  else if (num === 17) o = 150;
  else if (num === 18) o = 151;
  else if (num === 20 || num === 46) o = 300;
  else if (num === 19) o = 400;
  else o = 250 + (num % 50);
  if (flipped) {
    if (num === 16) o = 120;
    else if (num === 1) o = 100;
    else if (num >= 2 && num <= 15) o = 100 + num;
    else if (back.includes(num)) o = 200 + back.indexOf(num);
    else if (front.includes(num)) o = 10 + front.indexOf(num);
  }
  return o;
}

const MIRROR_PAIRS = [[1, 16], [21, 22], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32], [33, 34], [35, 36], [37, 38], [39, 40], [41, 42], [51, 52]];
const MIRROR_MAP = new Map();
for (const [a, b] of MIRROR_PAIRS) { MIRROR_MAP.set(a, b); MIRROR_MAP.set(b, a); }
export function mirrorLayer(n) { return MIRROR_MAP.get(+n) ?? +n; }
export const isBottomLayer = (n) => [16, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 52].includes(+n);

// KiCad "default" schematic colors (light theme)
export const SCH_COLORS = {
  background: '#f5f4ef',
  grid: '#b5b5b5',
  wire: '#009600',
  bus: '#0000c2',
  junction: '#009600',
  symbol: '#840000',
  symbolFill: '#ffffc2',
  pin: '#840000',
  pinName: '#006464',
  pinNum: '#a90000',
  reference: '#006464',
  value: '#006464',
  field: '#840084',
  label: '#0f0f0f',
  globalLabel: '#840000',
  notes: '#0000c2',
  frame: '#840000',
  sheet: '#840084',
  highlight: '#ff00ff',
  selection: '#ff9900',
};

export function schLayerInfo(num, name) {
  num = +num;
  const C = SCH_COLORS;
  const map = {
    91: ['Nets', C.wire], 92: ['Busses', C.bus], 93: ['Pins', C.pin], 94: ['Symbols', C.symbol],
    95: ['Names', C.reference], 96: ['Values', C.value], 97: ['Info', C.notes], 98: ['Guide', '#9b9b9b'],
    90: ['Modules', C.sheet], 99: ['SpiceOrder', '#808080'],
  };
  const m = map[num];
  return { num, name: name || (m ? m[0] : `Layer${num}`), color: m ? m[1] : (num >= 100 ? '#7a4f9a' : C.symbol), visible: true, alpha: 1 };
}
