// The declaration of `register.cjs`, which is JSDoc-typed and checked (`// @ts-check`). Keep
// the two in sync: the build compiles `src` with `allowJs` disabled, so this file — not the
// JavaScript — is what `src/helpers.ts` and consumers resolve.
import type { MessagePort } from 'node:worker_threads'

/** Index of the notification byte in the worker's shared state.
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

/** Marks the worker module as having reached `runAsWorker`.
 *
 * @internal
 */
export declare const markWorkerRegistered: (
  sharedBufferView: Int32Array,
) => void

/** Reports a failure to load the worker module, and wakes the main thread.
 *
 * @internal
 */
export declare const installWorkerLoadGuard: (data?: {
  sharedBufferView?: Int32Array
  workerPort?: MessagePort
}) => void
