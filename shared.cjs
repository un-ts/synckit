// @ts-check
'use strict'

/**
 * The shared state between the main thread and its workers: one `SharedArrayBuffer` per process,
 * sliced per worker, with one notification byte per slice.
 *
 * It is a plain CommonJS file at the package root, with no build step and no loader of its own,
 * so a test runner that maps the package to its source gets exactly what the published package
 * ships. `register.cjs` (the preload) and `src/helpers.ts` both import it rather than
 * reimplementing it, so the buffer below and the rejection-mode check have a single source.
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

// `NODE_OPTIONS` is inherited by workers and never appears in their `execArgv`, so the preload
// and `src` read the one environment variable here rather than splitting it again. An unset
// variable splits to `['']`, which no flag check matches.
const NODE_OPTIONS = (process.env.NODE_OPTIONS ?? '').split(/\s+/)

/**
 * The value of a flag, or `undefined` when the flag is not set at all.
 *
 * A flag can carry its value joined with `=` or in the next argument. The sources are the ones
 * the runtime applies: the command line, where Node puts it in `execArgv` rather than `argv` (a
 * worker inherits it in its own `execArgv`), and `NODE_OPTIONS`. `argv` is not read: a flag after
 * the script path is an argument to the script, which Node does not apply. The first source that
 * sets the flag wins. `''` is a flag that was set without a value, which is not the same as the
 * flag being absent.
 *
 * @param {string} flag The flag to look for.
 * @param {string[]} [args] The arguments to read, defaulting to this process's runtime flags.
 * @returns {string | undefined} The value, `''` for a flag without one, or `undefined`.
 */
const getFlag = (flag, args = [...process.execArgv, ...NODE_OPTIONS]) => {
  const prefix = `${flag}=`
  for (const [index, arg] of args.entries()) {
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length)
    }
    if (arg === flag) {
      const value = args[index + 1]
      // a following flag is not this flag's value
      return value === undefined || value.startsWith('-') ? '' : value
    }
  }
}

/**
 * Splits a version into its numeric parts.
 *
 * @param {string} version The version to split.
 * @returns {number[]} The parsed parts.
 */
const parseVersion = version =>
  version.split('.').map(part => Number.parseFloat(part))

// A naive implementation of semver comparison
/**
 * Compares two versions.
 *
 * @param {string} version1 The left version.
 * @param {string} version2 The right version.
 * @returns {number} `1`, `0` or `-1`, as the left version is greater, equal or lesser.
 */
const compareVersion = (version1, version2) => {
  const versions1 = parseVersion(version1)
  const versions2 = parseVersion(version2)
  const length = Math.max(versions1.length, versions2.length)
  for (let i = 0; i < length; i++) {
    const v1 = versions1[i] || 0
    const v2 = versions2[i] || 0
    if (v1 > v2) {
      return 1
    }
    if (v1 < v2) {
      return -1
    }
  }
  return 0
}

const NODE_VERSION = process.versions.node

/**
 * Compares a version against the running Node, which the preload needs as much as `src` does.
 *
 * @param {string} version The version to compare against.
 * @returns {number} `1`, `0` or `-1`, as Node is greater, equal or lesser.
 */
const compareNodeVersion = version => compareVersion(NODE_VERSION, version)

module.exports = {
  NODE_OPTIONS,
  NODE_VERSION,
  NOTIFY_INDEX,
  compareNodeVersion,
  compareVersion,
  createSharedBufferView,
  extractProperties,
  getFlag,
  parseVersion,
}
