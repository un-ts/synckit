import { MessagePort } from 'worker_threads'

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

export type PromiseType<T extends AnyPromise> = T extends Promise<infer R>
  ? R
  : never

export interface MainToWorkerMessage<T extends unknown[]> {
  sharedBuffer: SharedArrayBuffer
  id: number
  args: T
}

export interface WorkerData {
  workerPort: MessagePort
}

export interface DataMessage<T> {
  result?: T
  error?: unknown
}

export interface WorkerToMainMessage<T = unknown> extends DataMessage<T> {
  id: number
  properties?: object
}
