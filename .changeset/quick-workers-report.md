---
"synckit": patch
---

fix: surface worker module-load failures (e.g. missing top-level import or syntax error) instead of hanging forever in `Atomics.wait()`
