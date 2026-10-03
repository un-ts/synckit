---
"synckit": patch
---

fix: surface worker module-load failures (missing top-level imports, syntax errors, failing global shims, ...) instead of hanging forever in `Atomics.wait()`

The guard reports the worker's first uncaught failure whatever its timing — a failure to load the module, a throw after a top-level `await`, or a runtime failure while a call is in flight — and then disarms itself. A worker that reached `runAsWorker` and recovered through its own `uncaughtException` / `unhandledRejection` handlers keeps serving later calls; a worker that never registered is treated as failed, so later calls keep throwing the original error instead of waiting for a worker that cannot answer.
