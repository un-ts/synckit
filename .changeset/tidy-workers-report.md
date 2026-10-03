---
"synckit": patch
---

fix: surface worker module-load failures (missing top-level imports, syntax errors, failing global shims, ...) instead of hanging forever in `Atomics.wait()`

The guard reports the worker's first uncaught failure whatever its timing — a failure to load the module, a throw after a top-level `await`, or a runtime failure while a call is in flight — and then disarms itself. A worker that reached `runAsWorker` and still has a handler for those events keeps serving later calls: the guard steps aside and lets that handler decide. Otherwise the failure is fatal for that synchronous function, and later calls keep throwing it rather than waiting on a worker that never registered, or that nothing is left to keep alive.
