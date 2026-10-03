// @ts-check
'use strict'

/**
 * Preloaded into every worker with `-r <synckit>/register.cjs`, so it is in place before the
 * worker module and before any `--require` / `--import` hook that module depends on.
 *
 * If that module then fails to load — or raises any uncaught failure before the main thread
 * hears from it, including one that only surfaces after a top-level `await` — nothing would
 * ever tell the main thread: it is blocked in `Atomics.wait()` and cannot process the worker's
 * `error` event. This file reports the first such failure through `workerData` instead: the
 * transferred port carries the error and a notification byte in the shared buffer wakes the
 * wait. It disarms itself afterwards, so later failures behave as they would without it.
 *
 * It is a plain CommonJS file at the package root, with no build step and no loader of its
 * own, so a test runner that maps the package to its source preloads exactly what the
 * published package ships. It registers no hooks and patches nothing.
 *
 * `src/helpers.ts` imports this file rather than reimplementing it, so the shared state below
 * has a single source.
 */

// type-coverage:ignore-next-line -- node types mark workerData as any
const { isMainThread, workerData } = require('node:worker_threads')

// the shared state: [0] notification byte, [1] guard-armed flag
const NOTIFY_INDEX = 0
const STATE_INDEX = 1
const SLICE_INTS = 2
const STATE_ARMED = 1
// armed and the worker module has reached `runAsWorker`
const STATE_REGISTERED = 2

// one SharedArrayBuffer per process, sliced per worker: a single buffer keeps the allocation
// off the per-worker cost, while a slice per worker stops an unsolicited failure notification
// from waking another worker's `Atomics.wait()`
const INITIAL_SLICES = 64

/** @type {SharedArrayBuffer | undefined} */
let sharedBuffer
let sharedSlices = 0
let nextSlice = 0

/**
 * Reserves this worker's slice of the process-wide shared buffer.
 *
 * @returns {Int32Array} A view of the slice this worker owns.
 */
const createSharedBufferView = () => {
  const slice = nextSlice++
  const needed = (slice + 1) * SLICE_INTS

  if (needed > sharedSlices || !sharedBuffer) {
    // workers already running keep their views on the old buffer
    sharedSlices = Math.max(needed, sharedSlices * 2, INITIAL_SLICES)
    sharedBuffer = new SharedArrayBuffer(
      sharedSlices * Int32Array.BYTES_PER_ELEMENT,
    )
  }

  return new Int32Array(
    sharedBuffer,
    slice * SLICE_INTS * Int32Array.BYTES_PER_ELEMENT,
    SLICE_INTS,
  )
}

// MessagePort doesn't copy the properties of Error objects. We still want error objects to
// have extra properties such as "warnings" so implement the property copying manually.
/**
 * Copies the enumerable properties of an object.
 *
 * @param {unknown} object The object to copy the properties of.
 * @returns {object | undefined} The copied properties, if any.
 */
const extractProperties = object => {
  if (object && typeof object === 'object') {
    const source = /** @type {Record<string, unknown>} */ (object)
    /** @type {Record<string, unknown>} */
    const properties = {}
    for (const key in source) {
      properties[key] = source[key]
    }
    return properties
  }
}

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
  if (!sharedBufferView || !workerPort) {
    return
  }

  // the preload and the worker module's own import of synckit both get here, and only one
  // guard must be armed
  if (
    Atomics.compareExchange(sharedBufferView, STATE_INDEX, 0, STATE_ARMED) !== 0
  ) {
    return
  }

  /**
   * Reports a failure to the main thread and wakes whoever waits for it.
   *
   * @param {unknown} error
   * @param {boolean} fatal
   */
  const report = (error, fatal) => {
    // the last resort, when there is no usable error to send: only a worker that never loaded
    // can be described as a failure to load
    const fallback = () =>
      new Error(fatal ? 'Worker module failed to load' : 'Worker failed')

    try {
      workerPort.postMessage({
        workerFailure: true,
        fatal,
        error: error ?? fallback(),
        properties: extractProperties(error),
      })
    } catch {
      // the error is not cloneable; report something that always is
      workerPort.postMessage({
        workerFailure: true,
        fatal,
        error: fallback(),
      })
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
    const registered =
      Atomics.load(sharedBufferView, STATE_INDEX) === STATE_REGISTERED
    const handled =
      process.listenerCount('uncaughtException') > 0 ||
      process.listenerCount('unhandledRejection') > 0

    report(error, !registered || !handled)
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
  Atomics.compareExchange(
    sharedBufferView,
    STATE_INDEX,
    STATE_ARMED,
    STATE_REGISTERED,
  )
}

if (!isMainThread) {
  installWorkerLoadGuard(workerData)
}

module.exports = {
  NOTIFY_INDEX,
  createSharedBufferView,
  extractProperties,
  installWorkerLoadGuard,
  markWorkerRegistered,
}
