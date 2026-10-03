---
"synckit": patch
---

fix: surface worker module-load failures (missing top-level imports, syntax errors, failing global shims, ...) instead of hanging forever in `Atomics.wait()`
