// Sample d3-scale-chromatic's sequential schemes into 5-color palettes (a developer tool).
//
//   npm install --prefix <dir> d3-scale-chromatic@3.1.0
//   node scripts/sample_d3_sequential.mjs <dir>/node_modules/d3-scale-chromatic > d3.json
//
// Each continuous scheme is sampled over a few windows (dark, middle, and bright parts), so one
// scheme gives several palettes; build_palettes.py then filters them for room light.
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const [packageDir] = process.argv.slice(2);
if (!packageDir) {
  console.error('usage: node scripts/sample_d3_sequential.mjs <path to d3-scale-chromatic>');
  process.exit(2);
}
const d3 = await import(pathToFileURL(join(packageDir, 'src', 'index.js')).href);

const SCHEMES = {
  single: ['Blues', 'Greens', 'Greys', 'Oranges', 'Purples', 'Reds'],
  colorbrewer: ['BuGn', 'BuPu', 'GnBu', 'OrRd', 'PuBuGn', 'PuBu', 'PuRd', 'RdPu', 'YlGnBu', 'YlGn', 'YlOrBr', 'YlOrRd'],
  perceptual: ['Turbo', 'Viridis', 'Inferno', 'Magma', 'Plasma', 'Cividis', 'Warm', 'Cool', 'CubehelixDefault'],
};
// [label, start, end] along the scheme (0 = its first color, 1 = its last).
const WINDOWS = [['full', 0.1, 0.9], ['bright', 0.45, 1.0], ['middle', 0.25, 0.75], ['deep', 0.15, 0.6]];

// d3's interpolators return "rgb(r, g, b)" (or "#rrggbb" for some schemes).
function hex(color) {
  if (color.startsWith('#')) return color.toLowerCase();
  const parts = color.match(/\d+(\.\d+)?/g).slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(Number(v)))));
  return '#' + parts.map((v) => v.toString(16).padStart(2, '0')).join('');
}
const out = [];
for (const [group, names] of Object.entries(SCHEMES)) {
  for (const name of names) {
    const interpolate = d3[`interpolate${name}`];
    if (!interpolate) throw new Error(`d3-scale-chromatic has no interpolate${name}`);
    for (const [label, start, end] of WINDOWS) {
      const colors = [0, 1, 2, 3, 4].map((i) => hex(interpolate(start + ((end - start) * i) / 4)));
      out.push({ scheme: name, group, window: label, colors });
    }
  }
}
process.stdout.write(JSON.stringify(out, null, 1) + '\n');
