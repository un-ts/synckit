// The declaration of `shared.cjs`, which is JSDoc-typed and checked (`// @ts-check`). Keep the
// two in sync: the build compiles `src` with `allowJs` disabled, so this file — not the
// JavaScript — is what `src/helpers.ts` and consumers resolve.
/** Index of the notification byte in a worker's slice of the shared buffer.
 *
 * @internal
 */
export declare const NOTIFY_INDEX: number

/** Reserves this worker's slice of the process-wide shared buffer.
 *
 * @internal
 */
export declare const createSharedBufferView: () => Int32Array

// MessagePort doesn't copy the properties of Error objects. We still want
// error objects to have extra properties such as "warnings" so implement the
// property copying manually.
export function extractProperties<T extends object>(object: T): T
export function extractProperties(object?: unknown): object | undefined
