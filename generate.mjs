// usage: node generate.mjs <routes> [outDir]
//
// Writes a synthetic app to <outDir> (default: src/):
//
// - main.js lazy-loads <routes> route modules with `import()`.
// - core/<k>.js is imported by main.js and by routes k and k+1, so its dependent entries are
//   {main, route k, route k+1}. main.js already loads it, so `avoidRedundantChunkLoads` can drop
//   both route bits: every core module is one fold candidate.
// - widget/<j>.js is imported by three routes, with a different set of routes per widget. These
//   modules are not candidates, but each one is a separate atom that every candidate check scans.
//
// So there are about 4 x <routes> atoms and <routes> fold candidates, over <routes> + 1 entries.
import fs from 'node:fs';
import path from 'node:path';

const routes = Number(process.argv[2]);
const outDir = path.resolve(process.argv[3] ?? 'src');
if (!Number.isInteger(routes) || routes < 8) {
  console.error('usage: node generate.mjs <routes (>= 8)> [outDir]');
  process.exit(2);
}

fs.rmSync(outDir, { recursive: true, force: true });
for (const dir of ['core', 'widget', 'route']) fs.mkdirSync(path.join(outDir, dir), { recursive: true });

const write = (file, code) => fs.writeFileSync(path.join(outDir, file), code);
const mod = (i, n) => ((i % n) + n) % n;

for (let k = 0; k < routes; k++) {
  write(`core/${k}.js`, `export function core${k}(x) {\n  return \`core ${k}: \${x}\`;\n}\n`);
}

// Two widget families with different spacing, so every widget has its own set of three routes.
const widgetRoutes = [];
for (let j = 0; j < routes; j++) widgetRoutes.push([j, mod(j + 1, routes), mod(j + 3, routes)]);
for (let j = 0; j < routes; j++) widgetRoutes.push([j, mod(j + 2, routes), mod(j + 5, routes)]);
const widgetsByRoute = Array.from({ length: routes }, () => []);
widgetRoutes.forEach((users, w) => {
  write(`widget/${w}.js`, `export function widget${w}(x) {\n  return \`widget ${w}: \${x}\`;\n}\n`);
  for (const r of users) widgetsByRoute[r].push(w);
});

for (let r = 0; r < routes; r++) {
  const cores = [r, mod(r - 1, routes)];
  const widgets = widgetsByRoute[r];
  const imports = [
    ...cores.map(k => `import { core${k} } from '../core/${k}.js';`),
    ...widgets.map(w => `import { widget${w} } from '../widget/${w}.js';`),
  ];
  const calls = [...cores.map(k => `core${k}(${r})`), ...widgets.map(w => `widget${w}(${r})`)];
  write(`route/${r}.js`, `${imports.join('\n')}\n\nexport default function route${r}() {\n  return [${calls.join(', ')}];\n}\n`);
}

// Like an app's main entry, main.js has no exports. With exports, the default
// `preserveEntrySignatures: 'exports-only'` would keep rolldown from moving shared modules into it.
const mainImports = Array.from({ length: routes }, (_, k) => `import { core${k} } from './core/${k}.js';`);
const routeLoaders = Array.from({ length: routes }, (_, r) => `    () => import('./route/${r}.js'),`);
write(
  'main.js',
  `${mainImports.join('\n')}\n\n` +
    `globalThis.app = {\n` +
    `  cores: [${Array.from({ length: routes }, (_, k) => `core${k}`).join(', ')}],\n` +
    `  routes: [\n${routeLoaders.join('\n')}\n  ],\n};\n`,
);

console.log(`${path.relative(process.cwd(), outDir)}: ${routes} routes, ${routes} core modules, ${2 * routes} widget modules`);
