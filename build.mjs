// usage: node build.mjs [routes...]        (default sizes: 500 1000 2000 3000)
//        RUNS=5 node build.mjs 2000         (runs per cell, default 3)
//
// For each size: generate the synthetic app (generate.mjs), then bundle it with rolldown,
// `bundle.generate()` only (no disk writes), with `experimental.chunkOptimization.avoidRedundantChunkLoads`
// on (the default) and off. Each build runs in a new Node process. Prints the median time per cell.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

if (process.argv[2] === '--child') {
  const [dir, option] = process.argv.slice(3);
  const { rolldown, VERSION } = await import('rolldown');
  const start = performance.now();
  const bundle = await rolldown({
    input: path.join(dir, 'main.js'),
    experimental: { chunkOptimization: { avoidRedundantChunkLoads: option === 'on' } },
  });
  const { output } = await bundle.generate({ format: 'es' });
  const ms = performance.now() - start;
  await bundle.close();
  console.log(JSON.stringify({ ms, chunks: output.filter(o => o.type === 'chunk').length, version: VERSION }));
  process.exit(0);
}

const sizes = process.argv.slice(2).map(Number);
const runs = Number(process.env.RUNS ?? 3);
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const child = (dir, option) =>
  JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--child', dir, option], { encoding: 'utf8' }).trim().split('\n').pop());

const rows = [];
let version = '';
for (const routes of sizes.length ? sizes : [500, 1000, 2000, 3000]) {
  const dir = path.join(here, 'src', String(routes));
  execFileSync(process.execPath, [path.join(here, 'generate.mjs'), String(routes), dir], { stdio: 'inherit' });
  const cell = { on: [], off: [] };
  let chunks = {};
  // Alternate the two options so slow drift of the machine affects both.
  for (let i = 0; i < runs; i++) {
    for (const option of i % 2 ? ['off', 'on'] : ['on', 'off']) {
      const result = child(dir, option);
      cell[option].push(result.ms);
      chunks[option] = result.chunks;
      version = result.version;
    }
  }
  const on = median(cell.on), off = median(cell.off);
  rows.push({ routes, modules: 4 * routes + 1, chunksOn: chunks.on, chunksOff: chunks.off, on, off });
  console.log(`routes ${routes}: on ${on.toFixed(0)} ms, off ${off.toFixed(0)} ms (${runs} runs each)`);
}

const s = ms => `${(ms / 1000).toFixed(2)} s`;
console.log(`\nrolldown ${version}, node ${process.version}, ${process.platform}-${process.arch}, median of ${runs} runs\n`);
console.log('| Routes | Modules | Chunks (on / off) | `avoidRedundantChunkLoads: true` | `false` | Difference |');
console.log('| --- | --- | --- | --- | --- | --- |');
for (const r of rows) {
  console.log(`| ${r.routes} | ${r.modules} | ${r.chunksOn} / ${r.chunksOff} | ${s(r.on)} | ${s(r.off)} | ${s(r.on - r.off)} |`);
}
