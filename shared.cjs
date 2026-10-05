// @ts-check
'use strict'

/**
 * The shared state between the main thread and its workers: one `SharedArrayBuffer` per process,
 * sliced per worker, with one notification byte per slice.
 *
 * It is a plain CommonJS file at the package root, with no build step and no loader of its own,
 * so a test runner that maps the package to its source gets exactly what the published package
 * ships. `register.cjs` (the preload) and `src/helpers.ts` both import it rather than
 * reimplementing it, so the buffer below and the flag helpers have a single source.
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

/**
 * Splits `NODE_OPTIONS` the way the runtime reads it: on the space character — not on every kind of
 * whitespace — except inside double quotes, and without the quotes themselves, so a quoted value
 * keeps the spaces it contains. A backslash inside the quotes escapes the next character, which is
 * how the runtime reads it too — the value it applies is the one this returns.
 *
 * @param {string} value The `NODE_OPTIONS` value.
 * @returns {string[]} The arguments it holds.
 */
const splitNodeOptions = value => {
  /** @type {string[]} */
  const args = []
  let current = ''
  let quoted = false
  let escaped = false
  for (const char of value) {
    if (escaped) {
      escaped = false
      current += char
    } else if (quoted && char === '\\') {
      escaped = true
    } else if (char === '"') {
      quoted = !quoted
    } else if (!quoted && char === ' ') {
      if (current) {
        args.push(current)
        current = ''
      }
    } else {
      current += char
    }
  }
  if (current) {
    args.push(current)
  }
  return args
}

// `NODE_OPTIONS` is inherited by workers and never appears in their `execArgv`, so the preload
// and `src` read the one environment variable here rather than splitting it again.
const NODE_OPTIONS = splitNodeOptions(process.env.NODE_OPTIONS ?? '')

/**
 * Removes one pair of matching quotes around a value, which a caller can write by hand in
 * `SYNCKIT_EXEC_ARGV` or pass in `execArgv`.
 *
 * @param {string} value The value to unquote.
 * @returns {string} The value without its surrounding quotes.
 */
const unquote = value =>
  value.length > 1 &&
  (value.startsWith('"') || value.startsWith("'")) &&
  value.endsWith(value[0])
    ? value.slice(1, -1)
    : value

/**
 * The value of a flag, or `undefined` when none of its names carries the accepted value.
 *
 * `flag` is one name, or a set of names when the same flag has aliases (`-r` and `--require`), so
 * one lookup covers them all. A name can carry its value joined with `=` or in the next argument,
 * and the value may be wrapped in matching quotes. When `accepted` is given, only a flag with that
 * exact value counts, so a value that does not match is skipped. The sources are the ones the
 * runtime applies: the command line, where Node puts flags in `execArgv` rather than `argv` (a
 * worker inherits it in its own `execArgv`), and `NODE_OPTIONS`. `argv` is not read: a flag after
 * the script path is an argument to the script, which Node does not apply. They are read as one
 * list, `NODE_OPTIONS` first and `execArgv` last because the command line overrides it, from the
 * end, because the last occurrence of a flag wins. `''` is a flag that was set without a value,
 * which is not the same as the flag being absent.
 *
 * @param {Set<string> | string} flag The flag name, or the names it can have.
 * @param {string} [accepted] The value the flag must carry; any value counts by default.
 * @returns {string | undefined} The accepted value, `''` for a flag without one, or `undefined`.
 */
const getFlag = (flag, accepted) => {
  const flags = typeof flag === 'string' ? new Set([flag]) : flag
  // backwards, so the first match is the one the runtime would use, and the scan can stop there
  const args = [...NODE_OPTIONS, ...process.execArgv]
  for (let index = args.length - 1; index >= 0; index--) {
    const arg = args[index]
    const separator = arg.indexOf('=')
    const name = separator === -1 ? arg : arg.slice(0, separator)
    if (!flags.has(name)) {
      continue
    }
    /** @type {string} */
    let value
    if (separator === -1) {
      const next = args[index + 1]
      // a following flag is not this flag's value
      value = next == null || next.startsWith('-') ? '' : unquote(next)
    } else {
      value = unquote(arg.slice(separator + 1))
    }
    if (accepted == null || value === accepted) {
      return value
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
