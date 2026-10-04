---
"synckit": minor
---

feat: surface worker failures and exits instead of hanging forever in `Atomics.wait()`

A worker that never answers no longer leaves its caller blocked: a module graph that fails to load (a missing top-level import, a syntax error, a failing global shim), a throw after a top-level `await`, a runtime failure while a call is in flight, and a worker that exits — through a handler that calls `process.exit()`, or on its own — are all reported to the caller instead.

This changes the failure semantics, which is why it is a minor. A call that used to hang now throws; a worker that swallows the failure in its own handler no longer lets the call in flight return normally; and a worker that fails fatally no longer takes the process down with it — the caller gets the failure instead, and later calls keep throwing it.

A worker that reached `runAsWorker` and still has a handler for those events keeps serving later calls: the guard steps aside and lets that handler decide. Otherwise the failure is fatal for that synchronous function, and later calls keep throwing it rather than waiting on a worker that never registered, or that nothing is left to keep alive.

The timeout is now a single deadline for the whole call, and each wait receives only the time left of it. Previously every wait measured its own slice, so the time spent between waits was not counted and outdated responses could push the total wait past the timeout.

The unused `INT32_BYTES` export is gone.

`DataMessage<T>` is now a discriminated union whose failure arm requires `error`, so a reason that is present but `undefined` is still a failure rather than a result.

A reported failure carries the worker's reason exactly as it was thrown, even a falsy one; when its properties cannot cross the thread boundary the error is sent bare, and only a reason that cannot be cloned at all is replaced by a synthetic error.
