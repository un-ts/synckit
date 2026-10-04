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

  /**
   * Reports a failure to the main thread and wakes whoever waits for it.
   *
   * @param {unknown} error
   * @param {boolean} fatal
   */
  const report = (error, fatal) => {
    // the message for a reason that cannot cross the port: only a worker that never loaded can
    // be described as a failure to load
    const message = fatal ? 'Worker module failed to load' : 'Worker failed'

    try {
      // the caller sees the reason exactly as it was thrown, even when it is falsy, with its own
      // properties re-attached by `withProperties` on the other side
      workerPort.postMessage({
        workerFailure: true,
        fatal,
        error,
        properties: extractProperties(error),
      })
    } catch {
      // the properties, or the error itself, are not cloneable: retry with the bare error, which
      // keeps its name, message, stack and cause, and only then say something synthetic
      try {
        workerPort.postMessage({
          workerFailure: true,
          fatal,
          error,
        })
      } catch {
        try {
          workerPort.postMessage({
            workerFailure: true,
            fatal,
            error: new Error(message),
          })
        } catch {
          // the port itself is unusable: the notification below is all that is left
        }
      }
    } finally {
      // whatever happens next, a caller must not be left waiting
      Atomics.add(sharedBufferView, NOTIFY_INDEX, 1)
      Atomics.notify(sharedBufferView, NOTIFY_INDEX)
    }
  }

  /** @param {unknown} error */
  const guard = error => {
    // disarm: only the first failure is reported, anything after it behaves as it would
    // without the guard
    process.off('uncaughtException', guard)
    process.off('unhandledRejection', guard)

    // The failure is fatal unless the worker both reached `runAsWorker` and has something left
    // to handle these events: only then would it have survived and kept serving without the
    // guard, and only then can it be used for the next call. A handler that exits or rethrows
    // is caught by the exit report below, so a worker that dies is never waited on.
    const handled =
      process.listenerCount('uncaughtException') > 0 ||
      process.listenerCount('unhandledRejection') > 0

    report(error, !registered.has(sharedBufferView) || !handled)
  }

  process.on('uncaughtException', guard)
  process.on('unhandledRejection', guard)

  // However this worker ends — a handler that calls `process.exit()`, the module exiting on its
  // own, or a clean shutdown — it cannot answer another call, and the guard may have been
  // disarmed long before. This is the last chance to say so.
  process.on('exit', code => {
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
