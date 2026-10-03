---
"synckit": minor
---

feat: surface worker failures and exits instead of hanging forever in `Atomics.wait()`

A worker that never answers no longer leaves its caller blocked: a module graph that fails to load (a missing top-level import, a syntax error, a failing global shim), a throw after a top-level `await`, a runtime failure while a call is in flight, and a worker that exits — through a handler that calls `process.exit()`, or on its own — are all reported to the caller instead.

This changes the failure semantics, which is why it is a minor. A call that used to hang now throws; a worker that swallows the failure in its own handler no longer lets the call in flight return normally; and a worker that fails fatally no longer takes the process down with it — the caller gets the failure instead, and later calls keep throwing it.

A worker that reached `runAsWorker` and still has a handler for those events keeps serving later calls: the guard steps aside and lets that handler decide. Otherwise the failure is fatal for that synchronous function, and later calls keep throwing it rather than waiting on a worker that never registered, or that nothing is left to keep alive.
