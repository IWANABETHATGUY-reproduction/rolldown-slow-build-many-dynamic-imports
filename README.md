# rolldown: `avoidRedundantChunkLoads` build time grows faster than N² with the number of dynamic entries

`GenerateStage::optimize_dynamic_entry_bits` is the pass behind `experimental.chunkOptimization.avoidRedundantChunkLoads`, which is on by default. For every fold candidate, the pass rebuilds the full regrouped chunk graph from all atoms to check for a cycle. In an app with N lazy routes, the number of candidates and the number of atoms both grow with N, and the `BitSet` of each atom has N + 1 bits. The pass runs on one thread, and the JS main thread waits for it.

## Summary

- In this synthetic app, the pass costs 0.57 s at 1,000 lazy routes, 3.23 s at 2,000 and 20.90 s at 4,000 (rolldown 1.2.14). With the pass on and off, the output is the same, so the difference is only the time of the pass.
- In a large private app (about 4,000 JS chunks), the pass uses 4.85 s of CPU time on one thread. This is about 15% of a 33.5 s production build.
- Workaround: `experimental.chunkOptimization: { avoidRedundantChunkLoads: false }`. In other apps, this option can change the chunks.

## Reproduce

```sh
pnpm install
pnpm bench                  # 500, 1000, 2000 and 3000 routes
node build.mjs 4000         # one size
RUNS=5 node build.mjs 2000  # more runs per cell (default 3)
```

[`build.mjs`](build.mjs) generates the app into `src/<routes>/` with [`generate.mjs`](generate.mjs). Then it bundles the app with `bundle.generate()` (no disk writes), with `avoidRedundantChunkLoads` on and off. Each build runs in a new Node process, and the order of the two options alternates.

## Results

rolldown 1.2.14, Node 26.8.1, macOS 26.6.2, Apple M3 Pro (12 cores). Median of 3 runs. Full output: [results.md](results.md).

| Routes | Modules | Chunks | `avoidRedundantChunkLoads: true` | `false` | Time of the pass |
| --- | --- | --- | --- | --- | --- |
| 500 | 2,001 | 1,501 | 0.37 s | 0.23 s | 0.13 s |
| 1,000 | 4,001 | 3,001 | 1.18 s | 0.61 s | 0.57 s |
| 2,000 | 8,001 | 6,001 | 4.62 s | 1.39 s | 3.23 s |
| 3,000 | 12,001 | 9,001 | 11.73 s | 2.06 s | 9.68 s |
| 4,000 | 16,001 | 12,001 | 23.74 s | 2.84 s | 20.90 s |

- When the route count doubles, the time of the pass increases 4.4 to 6.5 times, which is N^2.1 to N^2.7. The rate increases with N.
- When the route count doubles, the rest of the build increases 2.0 to 2.7 times.

Both options give the same output: the same file names with the same content (one sha256 over all output files, checked at 500 and 2,000 routes). I did not find which step gives the same chunks when the pass is off.

## The app

[`generate.mjs`](generate.mjs) writes N routes, N core modules and 2N widget modules:

- `main.js` imports every core module and lazy-loads every route with `import()`. Like an app entry, it has no exports. (With exports, the default `preserveEntrySignatures: 'exports-only'` stops rolldown from moving modules into it.)
- `core/<k>.js` is imported by `main.js` and by routes k and k+1. Its dependent entries are {main, route k, route k+1}. `main.js` already loads it, so the pass can remove both route bits. Each core module is one fold candidate.
- `widget/<j>.js` is imported by three routes, and each widget has a different set of routes. Widgets are not candidates, but each widget is a separate atom.

So the pass sees 4N + 1 atoms, N candidates and N + 1 entries.

## Where the time goes

I recorded samply profiles with a symbolized build of v1.2.12 (Cargo profile `profile`). `dynamic_already_loaded.rs` is the same in v1.2.12, v1.2.14 and `main`. The table charges each sample to the nearest frame of the pass on its stack. Thus, the CPU time of a callee that is not inlined (hashbrown, mimalloc, `BitSet` methods) goes to the line that calls it.

| Code in `reduced_atom_graph_has_static_cycle` | What it does on every call | This app, 2,000 routes | Private app |
| --- | --- | --- | --- |
| [Lines 602–603](https://github.com/rolldown/rolldown/blob/v1.2.14/crates/rolldown/src/stages/generate_stage/dynamic_already_loaded.rs#L602-L603) | `bit_count()` on the `BitSet` of every atom, and `index_of_one()` on each single-bit atom | 1.39 s | 2.53 s |
| [Lines 590–596](https://github.com/rolldown/rolldown/blob/v1.2.14/crates/rolldown/src/stages/generate_stage/dynamic_already_loaded.rs#L590-L596) | Clones the `BitSet` of every atom, and looks it up in a `HashMap<BitSet, usize>` | 0.92 s | 0.47 s |
| [Lines 609–615](https://github.com/rolldown/rolldown/blob/v1.2.14/crates/rolldown/src/stages/generate_stage/dynamic_already_loaded.rs#L609-L615) | Adds every atom edge between two chunks to a new `FxHashSet` (mostly `reserve_rehash`) | 0.59 s | 1.57 s |
| [Line 650](https://github.com/rolldown/rolldown/blob/v1.2.14/crates/rolldown/src/stages/generate_stage/dynamic_already_loaded.rs#L650) | Frees the maps and the `BitSet` clones | 0.12 s | 0.07 s |
| All of `optimize_dynamic_entry_bits` | | 3.32 s | 4.85 s |
| All of the `rolldown-worker` thread | | 3.92 s | 25.12 s |

## Cause

The fold loop in [`optimize_dynamic_entry_bits`](https://github.com/rolldown/rolldown/blob/v1.2.14/crates/rolldown/src/stages/generate_stage/dynamic_already_loaded.rs#L105-L144) calls [`reduced_atom_graph_has_static_cycle`](https://github.com/rolldown/rolldown/blob/v1.2.14/crates/rolldown/src/stages/generate_stage/dynamic_already_loaded.rs#L580-L650) one time for each candidate whose reduced bits can be used. Each call builds the chunk graph again from all atoms:

1. It hashes the `BitSet` of each atom to find the chunk of the atom.
2. It scans the `BitSet` of each atom to find the facade chunks.
3. It adds all atom edges and facade edges again, and then it runs a full cycle search.

So one call costs O(atoms × entries / 8 + atom edges), and the pass makes one call for each candidate. The code comment at [lines 598–601](https://github.com/rolldown/rolldown/blob/v1.2.14/crates/rolldown/src/stages/generate_stage/dynamic_already_loaded.rs#L598-L601) already calls this function "the pass's quadratic hot spot".
