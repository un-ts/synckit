// The declaration of `shared.cjs`, which is JSDoc-typed and checked (`// @ts-check`). Keep the
// two in sync: the build compiles `src` with `allowJs` disabled, so this file — not the
// JavaScript — is what `src/helpers.ts` and consumers resolve.
/** Index of the notification byte in a worker's slice of the shared buffer.
 *
 * @internal
 */
export declare const NOTIFY_INDEX: number

/** The space-split `NODE_OPTIONS`, which workers inherit.
 *
 * @internal
 */
export declare const NODE_OPTIONS: string[]

/** The value of a flag, `''` when it is set without one, or `undefined` when it is not set.
 *
 * @internal
 */
export declare const getFlag: (
  flag: Set<string> | string,
  accepted?: string,
) => string | undefined

/** The running Node version.
 *
 * @internal
 */
export declare const NODE_VERSION: string

/** Compares a version against the running Node.
 *
 * @internal
 */
export declare const compareNodeVersion: (version: string) => number

/** Compares two versions.
 *
 * @internal
 */
export declare const compareVersion: (
  version1: string,
  version2: string,
) => number

/** Splits a version into its numeric parts.
 *
 * @internal
 */
export declare const parseVersion: (version: string) => number[]

/** Reserves this worker's slice of the process-wide shared buffer.
 *
 * @internal
 */
export declare const createSharedBufferView: () => Int32Array

// MessagePort doesn't copy the properties of Error objects. We still want
// error objects to have extra properties such as "warnings" so implement the
// property copying manually. The copy is a plain property bag, never the object
// it was made from, so the declaration does not pretend the input comes back.
export declare const extractProperties: (object?: unknown) => object | undefined
