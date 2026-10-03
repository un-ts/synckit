// The declaration of `register.cjs`, which is JSDoc-typed and checked (`// @ts-check`). Keep the
// two in sync: the build compiles `src` with `allowJs` disabled, so this file — not the
// JavaScript — is what `src/index.ts` and consumers resolve.
import type { MessagePort } from 'node:worker_threads'

/** Reports a failure to load the worker module, and wakes the main thread.
 *
 * @internal
 */
export declare const installWorkerLoadGuard: (data?: {
  sharedBufferView?: Int32Array
  workerPort?: MessagePort
}) => void

/** Marks the worker module as having reached `runAsWorker`.
 *
 * @internal
 */
export declare const markWorkerRegistered: (
  sharedBufferView: Int32Array,
) => void
