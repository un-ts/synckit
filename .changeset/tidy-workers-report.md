---
"synckit": minor
---

feat: surface worker failures and exits instead of hanging forever in `Atomics.wait()`

A worker that never answers no longer leaves its caller blocked: a module graph that fails to load (a missing top-level import, a syntax error, a failing global shim), a throw after a top-level `await`, a runtime failure while a call is in flight, and a worker that exits — through a handler that calls `process.exit()`, or on its own — are all reported to the caller instead.

This changes the failure semantics, which is why it is a minor. A call that used to hang now throws; a worker that swallows the failure in its own handler no longer lets the call in flight return normally; and a worker that fails fatally no longer takes the process down with it — the caller gets the failure instead, and later calls keep throwing it.

A worker that reached `runAsWorker` and still has a handler for the event keeps serving later calls: the guard reports the failure and re-arms rather than deciding for that handler, so the worker stays usable — it does not mean the handler ran. For a rejection, the guard's own `unhandledRejection` listener is what keeps the runtime from promoting it to an uncaught exception, so a handler that only listens on `uncaughtException` never sees one. Otherwise the failure is fatal for that synchronous function, and later calls keep throwing it rather than waiting on a worker that never registered, or that nothing is left to keep alive.

A recoverable failure only tells the caller that the worker can still serve; it does not stop the request that was in flight. A worker whose own handler absorbs the failure may still be running that request, so a retry can overlap it — a worker module holding state across calls has to expect that.

The timeout is now a single deadline for the whole call, and each wait receives only the time left of it. Previously every wait measured its own slice, so the time spent between waits was not counted and outdated responses could push the total wait past the timeout.

The unused `INT32_BYTES` export is gone.

The `hasFlag` utility now reads the flags the runtime applies — `execArgv` and `NODE_OPTIONS`, in either the `--flag=value` or `--flag value` form — and no longer counts a flag that is only a script argument, which Node does not apply. `NODE_OPTIONS` is now read the way the runtime reads it: split on spaces, with double quotes grouping and removed and a backslash escaping inside them, so a quoted value keeps its spaces and an unset variable is `[]` where a naive split gave `['']`.

`DataMessage<T>` is now a discriminated union whose failure arm requires `error`, so a reason that is present but `undefined` is still a failure rather than a result, and `properties` on that arm is typed `object` instead of `unknown`.

A reported failure carries the worker's reason exactly as it was thrown, even a falsy one; when its properties cannot cross the thread boundary the error is sent bare, and only a reason that cannot be cloned at all is replaced by a synthetic error that still names it.
