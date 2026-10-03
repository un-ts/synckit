// @ts-check
'use strict'

/**
 * Preloaded into every worker with `-r <synckit>/register.cjs`, so it is in place before the
 * worker module and before any `--require` / `--import` hook that module depends on.
 *
 * If that module then fails to load, nothing would ever tell the main thread: it is blocked
 * in `Atomics.wait()` and cannot process the worker's `error` event. This file reports the
 * failure through `workerData` instead — the transferred port carries the error and a
 * notification byte in the shared buffer wakes the wait.
 *
 * It is a plain CommonJS file at the package root, with no build step and no loader of its
 * own, so a test runner that maps the package to its source preloads exactly what the
 * published package ships. It registers no hooks and patches nothing.
 *
 * `src/helpers.ts` imports this file rather than reimplementing it, so the shared state below
 * has a single source.
 */

const { isMainThread, workerData } = require('node:worker_threads')

// the shared state: [0] notification byte, [1] guard state
const NOTIFY_INDEX = 0
const STATE_INDEX = 1
const SLICE_INTS = 2
const STATE_ARMED = 1
const STATE_LOADED = 2

// one SharedArrayBuffer per process, sliced per worker: a single buffer keeps the allocation
// off the per-worker cost, while a slice per worker stops an unsolicited load-failure
// notification from waking another worker's `Atomics.wait()`
const INITIAL_SLICES = 64

/** @type {SharedArrayBuffer | undefined} */
let sharedBuffer
let sharedSlices = 0
let nextSlice = 0

/** Reserves this worker's slice of the process-wide shared buffer. */
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
 * @returns {Record<string, unknown> | undefined} The copied properties, if any.
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

  /** @param {unknown} error */
  const guard = error => {
    // disarm: from here on this worker behaves exactly as an unguarded one
    process.off('uncaughtException', guard)
    process.off('unhandledRejection', guard)

    if (Atomics.load(sharedBufferView, STATE_INDEX) === STATE_LOADED) {
      // the module loaded, so this is a runtime failure, not a load failure
      throw error
    }

    try {
      workerPort.postMessage({
        loadError: true,
        error: error ?? new Error('Worker module failed to load'),
        properties: extractProperties(error),
      })
    } catch {
      // the error is not cloneable; report something that always is
      workerPort.postMessage({
        loadError: true,
        error: new Error('Worker module failed to load'),
      })
    } finally {
      Atomics.add(sharedBufferView, NOTIFY_INDEX, 1)
      Atomics.notify(sharedBufferView, NOTIFY_INDEX)
    }
  }

  process.on('uncaughtException', guard)
  process.on('unhandledRejection', guard)
}

/**
 * Marks the worker module as loaded, so the guard stops reporting failures.
 *
 * @param {Int32Array} sharedBufferView
 */
const markWorkerLoaded = sharedBufferView => {
  Atomics.store(sharedBufferView, STATE_INDEX, STATE_LOADED)
}

if (!isMainThread) {
  installWorkerLoadGuard(workerData)
}

module.exports = {
  NOTIFY_INDEX,
  createSharedBufferView,
  extractProperties,
  installWorkerLoadGuard,
  markWorkerLoaded,
}
