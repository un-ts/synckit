import { MessagePort } from 'node:worker_threads'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyFn<R = any, T extends any[] = any[]> = (...args: T) => R

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyPromise<T = any> = Promise<T>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAsyncFn<T = any> = AnyFn<Promise<T>>

export type Syncify<T extends AnyAsyncFn> = T extends (
  ...args: infer Args
) => Promise<infer R>
  ? (...args: Args) => R
  : never

export type PromiseType<T extends AnyPromise> =
  T extends Promise<infer R> ? R : never

export type ValueOf<T> = T[keyof T]

export interface MainToWorkerMessage<T extends unknown[]> {
  id: number
  args: T
}

export interface MainToWorkerCommandMessage {
  id: number
  cmd: string
}

export interface WorkerData {
  sharedBuffer: SharedArrayBuffer
  workerPort: MessagePort
  pnpLoaderPath: string | undefined
}

export interface DataMessage<T> {
  result?: T
  error?: unknown
  properties?: unknown
}

export interface WorkerToMainMessage<T = unknown> extends DataMessage<T> {
  id: number
}

export interface GlobalShim {
  moduleName: string
  /**
   * `undefined` means side effect only
   */
  globalName?: string
  /**
   * 1. `undefined` or empty string means `default`, for example:
   * ```js
   * import globalName from 'module-name'
   * ```
   *
   * 2. `null` means namespaced, for example:
   * ```js
   * import * as globalName from 'module-name'
   * ```
   *
   */
  named?: string | null
  /**
   * If not `false`, the shim will only be applied when the original `globalName` unavailable,
   * for example you may only want polyfill `globalThis.fetch` when it's unavailable natively:
   * ```js
   * import fetch from 'node-fetch'
   *
   * if (!globalThis.fetch) {
   *   globalThis.fetch = fetch
   * }
   * ```
   */
  conditional?: boolean
}
