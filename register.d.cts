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

/** Reports a failure to load the worker module, and wakes the main thread.
 *
 * @internal
 */
export declare const installWorkerLoadGuard: (data?: {
  sharedBufferView?: Int32Array
  workerPort?: MessagePort
}) => void

/** Marks the worker module as loaded, so the guard stops reporting failures.
 *
 * @internal
 */
export declare const markWorkerLoaded: (sharedBufferView: Int32Array) => void

/** Marks the worker module as loaded once this turn of the event loop ends.
 *
 * @internal
 */
export declare const markWorkerLoadedSoon: (
  sharedBufferView: Int32Array,
) => void
