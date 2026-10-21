# Build time grows much faster than the number of chunks

In an app with many dynamic imports, the rolldown build time grows much faster than the number of chunks. In this repro, when the number of chunks grows 8 times (1,501 to 12,001), the build time grows about 64 times (0.37 s to 23.74 s).

With `experimental.chunkOptimization.avoidRedundantChunkLoads: false`, the build time per chunk stays almost constant, and the output is the same.

## Reproduce

```sh
pnpm install
pnpm bench                  # 500, 1000, 2000 and 3000 routes
node build.mjs 4000         # one size
RUNS=5 node build.mjs 2000  # more runs per size (default 3)
```

[`build.mjs`](build.mjs) generates the app into `src/<routes>/` with [`generate.mjs`](generate.mjs). Then it bundles the app with `bundle.generate()` (no disk writes), one time with the default options and one time with `avoidRedundantChunkLoads: false`. Each build runs in a new Node process.

## Results

rolldown 1.2.14, Node 26.8.1, macOS 26.6.2, Apple M3 Pro (12 cores). Median of 3 runs. Full output: [results.md](results.md).

| Routes | Modules | Chunks | Build time (default) | Per chunk | Build time (`avoidRedundantChunkLoads: false`) | Per chunk |
| --- | --- | --- | --- | --- | --- | --- |
| 500 | 2,001 | 1,501 | 0.37 s | 0.25 ms | 0.23 s | 0.16 ms |
| 1,000 | 4,001 | 3,001 | 1.18 s | 0.39 ms | 0.61 s | 0.20 ms |
| 2,000 | 8,001 | 6,001 | 4.62 s | 0.77 ms | 1.39 s | 0.23 ms |
| 3,000 | 12,001 | 9,001 | 11.73 s | 1.30 ms | 2.06 s | 0.23 ms |
| 4,000 | 16,001 | 12,001 | 23.74 s | 1.98 ms | 2.84 s | 0.24 ms |

- With the default options, each time the number of chunks doubles, the build time grows 3.2, 3.9 and then 5.1 times. The time per chunk grows 8 times from 500 to 4,000 routes.
- With `avoidRedundantChunkLoads: false`, the time per chunk stays between 0.16 ms and 0.24 ms.
- Both options give the same output: the same file names with the same content (one sha256 over all output files, checked at 500 and 2,000 routes).
- In this app, the modules, the chunks and the dynamic imports all grow at the same rate. So these results do not show which of them causes the growth.

## The app

[`generate.mjs`](generate.mjs) writes N routes, N core modules and 2N widget modules:

- `main.js` imports every core module and loads every route with `import()`. Like an app entry, it has no exports.
- `core/<k>.js` is imported by `main.js` and by routes k and k+1.
- `widget/<j>.js` is imported by three routes, and each widget has a different set of routes.

## Where the time goes

A samply profile of the 2,000-route build, with a symbolized build of v1.2.12 (Cargo profile `profile`). `dynamic_already_loaded.rs` is the same in v1.2.12, v1.2.14 and `main`.

- The `rolldown-worker` thread uses 3.92 s of CPU time. 3.32 s of it is in `GenerateStage::optimize_dynamic_entry_bits`, almost all in [`reduced_atom_graph_has_static_cycle`](https://github.com/rolldown/rolldown/blob/v1.2.14/crates/rolldown/src/stages/generate_stage/dynamic_already_loaded.rs#L580-L650).
- This time runs on one thread, and the JS main thread waits for it.

The lines with the most CPU time (the time of a callee that is not inlined goes to the line that calls it):

| Lines | CPU time |
| --- | --- |
| [602–603](https://github.com/rolldown/rolldown/blob/v1.2.14/crates/rolldown/src/stages/generate_stage/dynamic_already_loaded.rs#L602-L603) | 1.39 s |
| [590–596](https://github.com/rolldown/rolldown/blob/v1.2.14/crates/rolldown/src/stages/generate_stage/dynamic_already_loaded.rs#L590-L596) | 0.92 s |
| [609–615](https://github.com/rolldown/rolldown/blob/v1.2.14/crates/rolldown/src/stages/generate_stage/dynamic_already_loaded.rs#L609-L615) | 0.59 s |
