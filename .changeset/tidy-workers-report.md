---
"synckit": minor
---

feat: surface worker failures and exits instead of hanging forever in `Atomics.wait()`

A worker that never answers no longer leaves its caller blocked: a module graph that fails to load (a missing top-level import, a syntax error, a failing global shim), a throw after a top-level `await`, a runtime failure while a call is in flight, and a worker that exits — through a handler that calls `process.exit()`, or on its own — are all reported to the caller instead.

The guard now reaches a worker through its own `NODE_OPTIONS` rather than its `execArgv`, so it is in place before a preload the worker inherits from `NODE_OPTIONS`, which run first: a failure there reaches the caller like any other instead of being left to the call's deadline, or to no deadline at all. The worker's environment is passed explicitly to do that, and its `NODE_OPTIONS` keeps whatever it inherited, after the preload. A runtime that refuses that environment — Node 18 with `--openssl-legacy-provider`, Node 24 with `--title`, the set varies by version — makes the worker fall back to the inherited environment with the guard in its `execArgv` instead, so the guard loads after preloads inherited through `NODE_OPTIONS` and a failure in one of those is reported by nothing. synckit warns once per worker that takes that path, under the `SYNCKIT_GUARD_ORDERING` code, so the caller can bound the wait themselves with `SYNCKIT_TIMEOUT` or a timeout passed per call.

This changes the failure semantics, which is why it is a minor. A call that used to hang now throws; a worker that swallows the failure in its own handler no longer lets the call in flight return normally; and a worker that fails fatally no longer takes the process down with it — the caller gets the failure instead, and later calls keep throwing it.

A worker which reached `runAsWorker` and still has a handler for the event keeps serving later calls: the guard reports the failure and re-arms rather than deciding for that handler, so the worker stays usable — it does not mean the handler ran. For a rejection, the guard's own `unhandledRejection` listener is what keeps the runtime from promoting it under the default `throw` mode, so a handler listening only on `uncaughtException` never sees it; under `strict` the runtime promotes it anyway, and that handler does see it. Otherwise the failure is fatal for that synchronous function, and later calls keep throwing it rather than waiting on a worker which never registered, or which has nothing left to keep it alive.

A recoverable failure only tells the caller that the worker can still serve; it does not stop the request that was in flight. A worker whose own handler absorbs the failure may still be running that request, so a retry can overlap it — a worker module holding state across calls has to expect that.

The timeout is now a single deadline for the whole call, and each wait receives only the time left of it. Previously every wait measured its own slice, so the time spent between waits was not counted and outdated responses could push the total wait past the timeout.

The module specifiers `encodeImportModule` generates are escaped with `JSON.stringify` now — double quotes and full escaping — where a single-quoted literal escaped only backslashes and quotes, so a path carrying a newline or another control character is emitted correctly instead of breaking the generated source.

**Breaking:** the `INT32_BYTES` export is gone. It was reachable from the public entry point — `src/index.ts` re-exports the whole constants module — so an import of it that compiles on `main` no longer compiles here. Nothing in the package used it, and the release stays a `minor` under the 0.x convention rather than a `major`.

The `hasFlag` utility now reads the flags the runtime applies — `execArgv` and `NODE_OPTIONS`, in either the `--flag=value` or `--flag value` form — and no longer counts a flag that is only a script argument, which Node does not apply. `NODE_OPTIONS` is now read the way the runtime reads it: split on spaces, with double quotes grouping and removed and a backslash escaping inside them, so a quoted value keeps its spaces and an unset variable is `[]` where a naive split gave `['']`.

`DataMessage<T>` is now a discriminated union whose failure arm requires `error`, so a reason that is present but `undefined` is still a failure rather than a result, and `properties` on that arm is typed `object` instead of `unknown`.

A reported failure carries the worker's reason exactly as it was thrown, even a falsy one; when its properties cannot cross the thread boundary the error is sent bare, and only a reason that cannot be cloned at all is replaced by a synthetic error that still names it.
