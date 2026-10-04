// @ts-check
'use strict'

/**
 * The shared state between the main thread and its workers: one `SharedArrayBuffer` per process,
 * sliced per worker, with one notification byte per slice.
 *
 * It is a plain CommonJS file at the package root, with no build step and no loader of its own,
 * so a test runner that maps the package to its source gets exactly what the published package
 * ships. `register.cjs` (the preload) and `src/helpers.ts` both import it rather than
 * reimplementing it, so the buffer below has a single source.
 */

// One SharedArrayBuffer per process, sliced per worker: a single buffer keeps the allocation off
// the per-worker cost, while a slice per worker stops an unsolicited failure notification from
// waking another worker's `Atomics.wait()`.
//
// A slice is the notification byte alone: the guard's armed/registered state is module-local in
// `register.cjs`, which the build requires instead of inlining, so one module instance serves
// the preload and the entry alike.
const NOTIFY_INDEX = 0
const SLICE_INTS = 1
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

module.exports = {
  NOTIFY_INDEX,
  createSharedBufferView,
  extractProperties,
}
