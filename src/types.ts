import { MessagePort } from 'worker_threads'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyFn<T = any, R extends any[] = any[]> = (...args: R) => T

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyPromise = Promise<any>

export type AnyAsyncFn = AnyFn<AnyPromise>

export type Syncify<T extends AnyFn<AnyPromise>> = T extends (
  ...args: infer Args
) => Promise<infer R>
  ? (...args: Args) => R
  : never

export type PromiseType<T extends AnyPromise> = T extends Promise<infer R>
  ? R
  : never

export interface MainToWorkerMessage {
  sharedBuffer: SharedArrayBuffer
  id: number
  args: unknown[]
}

export interface WorkerData {
  workerPort: MessagePort
}

export interface DataMessage<T = unknown> {
  result?: T
  error?: unknown
}

export interface WorkerToMainMessage<T = unknown> extends DataMessage<T> {
  id: number
  properties?: object
}
