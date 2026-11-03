export interface Palette {
  id: string;
  name: string;
  /** Four gradient stops, hex sRGB. */
  stops: [string, string, string, string];
}

export const PALETTES: Palette[] = [
  { id: 'aurora', name: 'Aurora', stops: ['#00f5d4', '#00b4ff', '#8a5cff', '#ff4fd8'] },
  { id: 'ember', name: 'Ember', stops: ['#ffe14d', '#ff8a00', '#ff2e63', '#a30dff'] },
  { id: 'prism', name: 'Prism', stops: ['#ff3d6e', '#ffd23f', '#35ff9e', '#3da5ff'] },
  { id: 'glacier', name: 'Glacier', stops: ['#f4fbff', '#8fe3ff', '#4d84ff', '#8f5dff'] },
  { id: 'acid', name: 'Acid', stops: ['#d9ff00', '#00ff85', '#00cfff', '#ff2bd6'] },
];
