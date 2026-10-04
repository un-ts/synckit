// @ts-check
'use strict'

/**
 * Preloaded into every worker with `-r <synckit>/register.cjs`, so it is in place before the
 * worker module and before any `--require` / `--import` hook that module depends on.
 *
 * If that module then fails to load — or raises any uncaught failure before the main thread
 * hears from it, including one that only surfaces after a top-level `await` — nothing would
 * ever tell the main thread: it is blocked in `Atomics.wait()` and cannot process the worker's
 * `error` event. This file reports the first such failure through the transferred port instead:
 * it carries the error and bumps the notification byte in this worker's slice of the shared
 * buffer (`shared.cjs`) to wake the wait. The failure guard disarms itself afterwards, so later
 * failures behave as they would without it; the exit report below stays armed, because a worker
 * that ends can never serve another call.
 *
 * It is a plain CommonJS file at the package root, with no build step and no loader of its
 * own, so a test runner that maps the package to its source preloads exactly what the
 * published package ships. It registers no hooks and patches nothing.
 *
 * The build requires this file instead of inlining it, so the preload and a bundled entry share
 * one module instance and the state below can be plain module state.
 */

// type-coverage:ignore-next-line -- node types mark workerData as any
const { isMainThread, workerData } = require('node:worker_threads')

const { NOTIFY_INDEX, extractProperties } = require('./shared.cjs')

// Both are keyed by the worker's slice: one slice is one worker, and one guard must be armed even
// when the preload and the worker module's own import of synckit both reach this file.
/** @type {WeakSet<Int32Array>} */
const armed = new WeakSet()
/** @type {WeakSet<Int32Array>} */
const registered = new WeakSet()

/**
 * The part of synckit's worker data the guard needs.
 *
 * @typedef {object} WorkerLoadGuardData
 * @property {Int32Array} [sharedBufferView] This worker's slice of the shared buffer.
 * @property {import('node:worker_threads').MessagePort} [workerPort] The port a failure is reported on.
 */

/**
 * Whether a value is an `Error`, including one from another realm.
 *
 * `Error.isError` recognises errors across realms, where `instanceof Error` fails; it is not
 * available in every supported runtime, so fall back to `instanceof`.
 *
 * @param {unknown} value
 * @returns {value is Error} Whether the value is an error.
 */
const isError = value => Error.isError?.(value) ?? value instanceof Error

/**
 * Reports a failure to load the worker module, and wakes the main thread.
 *
 * @param {WorkerLoadGuardData | null | undefined} [data] The worker data, when there is one.
 */
const installWorkerLoadGuard = data => {
  // a loader thread re-runs the `-r` preload with `workerData` null, and there is nothing to
  // guard there
  const { sharedBufferView, workerPort } = data ?? {}
  if (!sharedBufferView || !workerPort || armed.has(sharedBufferView)) {
    return
  }

  armed.add(sharedBufferView)

  // set while this worker is stopping itself after a fatal report, so the `exit` handler below
  // does not turn that one failure into a second message and a second notification
  let exiting = false

  /**
   * Reports a failure to the main thread and wakes whoever waits for it.
   *
   * @param {unknown} error
   * @param {boolean} fatal
   */
  const report = (error, fatal) => {
    // the caller sees the reason exactly as it was thrown, even when it is falsy, with its own
    // properties re-attached by `withProperties` on the other side. A reason that cannot cross
    // falls back to the bare error, then to a synthetic message that names it, and finally to a
    // constant message that never touches the reason, so a report is always delivered. Building
    // each payload inside the try catches a throwing property copy or getter like a failed post,
    // so the notification below is always reached
    const payloads = [
      () => ({ error, properties: extractProperties(error) }),
      () => ({ error }),
      () => ({
        error: new Error(
          `Worker ${fatal ? 'module failed to load' : 'failed'}: ${
            isError(error) ? error.message : String(error)
          }`,
        ),
      }),
      () => ({
        error: new Error(
          fatal ? 'Worker module failed to load' : 'Worker failed',
        ),
      }),
    ]

    for (const payload of payloads) {
      try {
        workerPort.postMessage({ workerFailure: true, fatal, ...payload() })
        break
      } catch {}
    }

    // this report is one notification: wake whoever waits for it
    Atomics.add(sharedBufferView, NOTIFY_INDEX, 1)
    Atomics.notify(sharedBufferView, NOTIFY_INDEX)

    // a fatal failure leaves nothing to serve, and no caller may be waiting to consume the report
    // (the main-side termination needs one), so stop the worker here as well. The exit is the one
    // just reported, so the handler below stays quiet about it.
    if (fatal && !exiting) {
      exiting = true
      // eslint-disable-next-line n/no-process-exit -- a fatal failure leaves nothing to serve
      process.exit(1)
    }
  }

  /**
   * @param {unknown} error
   * @param {'uncaughtException' | 'unhandledRejection'} event
   */
  const guard = (error, event) => {
    // disarm: only the first failure is reported, anything after it behaves as it would
    // without the guard
    process.off('uncaughtException', onUncaughtException)
    process.off('unhandledRejection', onUnhandledRejection)

    // The failure is fatal unless the worker both reached `runAsWorker` and has something left to
    // handle *this* event: only then would it have survived and kept serving without the guard,
    // and only then can it be used for the next call. A listener for the other event cannot handle
    // this one. A handler that exits or rethrows is caught by the exit report below, so a worker
    // that dies is never waited on.
    report(
      error,
      !registered.has(sharedBufferView) || process.listenerCount(event) === 0,
    )
  }

  /** @param {unknown} error */
  function onUncaughtException(error) {
    guard(error, 'uncaughtException')
  }

  /** @param {unknown} reason */
  function onUnhandledRejection(reason) {
    guard(reason, 'unhandledRejection')
  }

  process.on('uncaughtException', onUncaughtException)
  process.on('unhandledRejection', onUnhandledRejection)

  // However this worker ends — a handler that calls `process.exit()`, the module exiting on its
  // own, or a clean shutdown — it cannot answer another call, and the guard may have been
  // disarmed long before. This is the last chance to say so, unless the exit is the fatal one just
  // reported above.
  process.on('exit', code => {
    if (exiting) {
      return
    }

    exiting = true
    report(new Error(`Worker exited with code ${code}`), true)
  })
}

/**
 * Marks the worker module as having reached `runAsWorker`, so that a failure after it is not
 * treated as a failure to load.
 *
 * @param {Int32Array} sharedBufferView
 */
const markWorkerRegistered = sharedBufferView => {
  // mirror `installWorkerLoadGuard`: without a view there is no slice to mark, and a `WeakSet`
  // rejects a non-object key
  if (!sharedBufferView) {
    return
  }

  registered.add(sharedBufferView)
}

if (!isMainThread) {
  installWorkerLoadGuard(workerData)
}

module.exports = {
  installWorkerLoadGuard,
  markWorkerRegistered,
}
