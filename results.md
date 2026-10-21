src/500: 500 routes, 500 core modules, 1000 widget modules
routes 500: on 368 ms, off 235 ms (3 runs each)
src/1000: 1000 routes, 1000 core modules, 2000 widget modules
routes 1000: on 1182 ms, off 608 ms (3 runs each)
src/2000: 2000 routes, 2000 core modules, 4000 widget modules
routes 2000: on 4622 ms, off 1390 ms (3 runs each)
src/3000: 3000 routes, 3000 core modules, 6000 widget modules
routes 3000: on 11733 ms, off 2056 ms (3 runs each)
src/4000: 4000 routes, 4000 core modules, 8000 widget modules
routes 4000: on 23744 ms, off 2841 ms (3 runs each)

rolldown 1.2.14, node v26.8.1, darwin-arm64, median of 3 runs

| Routes | Modules | Chunks (on / off) | `avoidRedundantChunkLoads: true` | `false` | Difference |
| --- | --- | --- | --- | --- | --- |
| 500 | 2001 | 1501 / 1501 | 0.37 s | 0.23 s | 0.13 s |
| 1000 | 4001 | 3001 / 3001 | 1.18 s | 0.61 s | 0.57 s |
| 2000 | 8001 | 6001 / 6001 | 4.62 s | 1.39 s | 3.23 s |
| 3000 | 12001 | 9001 / 9001 | 11.73 s | 2.06 s | 9.68 s |
| 4000 | 16001 | 12001 / 12001 | 23.74 s | 2.84 s | 20.90 s |
