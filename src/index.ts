import path from 'path'
import {
  MessageChannel,
  Worker,
  receiveMessageOnPort,
  workerData,
  parentPort,
} from 'worker_threads'

import {
  AnyAsyncFn,
  AnyFn,
  MainToWorkerMessage,
  Syncify,
  WorkerData,
  WorkerToMainMessage,
} from './types.js'

export * from './types.js'

const {
  SYNCKIT_BUFFER_SIZE,
  SYNCKIT_TIMEOUT,
  SYNCKIT_TS_ESM,
  SYNCKIT_EXEC_ARV,
} = process.env

const TS_USE_ESM = !!SYNCKIT_TS_ESM && ['1', 'true'].includes(SYNCKIT_TS_ESM)

export const DEFAULT_BUFFER_SIZE = SYNCKIT_BUFFER_SIZE
  ? +SYNCKIT_BUFFER_SIZE
  : undefined

export const DEFAULT_TIMEOUT = SYNCKIT_TIMEOUT ? +SYNCKIT_TIMEOUT : undefined

export const DEFAULT_WORKER_BUFFER_SIZE = DEFAULT_BUFFER_SIZE || 1024

export const DEFAULT_EXEC_ARGV = SYNCKIT_EXEC_ARV?.split(',') ?? []

const syncFnCache = new Map<string, AnyFn>()

export interface SynckitOptions {
  bufferSize?: number
  timeout?: number
  execArgv?: string[]
}

// MessagePort doesn't copy the properties of Error objects. We still want
// error objects to have extra properties such as "warnings" so implement the
// property copying manually.
const extractProperties = (object: unknown): Record<string, unknown> => {
  const properties: Record<string, unknown> = {}
  if (object && typeof object === 'object') {
    for (const key in object) {
      properties[key] = (object as Record<string, unknown>)[key]
    }
  }
  return properties
}

// MessagePort doesn't copy the properties of Error objects. We still want
// error objects to have extra properties such as "warnings" so implement the
// property copying manually.
const applyProperties = <T>(
  object: T,
  properties?: Record<string, unknown>,
): T => {
  if (!properties) {
    return object
  }
  // eslint-disable-next-line sonar/for-in
  for (const key in properties) {
    ;(object as Record<string, unknown>)[key] = properties[key]
  }
  return object
}

export function createSyncFn<T extends AnyAsyncFn>(
  workerPath: string,
  bufferSize?: number,
  timeout?: number,
): Syncify<T>
export function createSyncFn<T extends AnyAsyncFn>(
  workerPath: string,
  options?: SynckitOptions,
): Syncify<T>
export function createSyncFn<R, T extends AnyAsyncFn<R>>(
  workerPath: string,
  bufferSizeOrOptions?: SynckitOptions | number,
  timeout?: number,
) {
  if (!path.isAbsolute(workerPath)) {
    throw new Error('`workerPath` must be absolute')
  }

  const cachedSyncFn = syncFnCache.get(workerPath)

  if (cachedSyncFn) {
    return cachedSyncFn
  }

  const syncFn = startWorkerThread<R, T>(
    workerPath,
    typeof bufferSizeOrOptions === 'number'
      ? { bufferSize: bufferSizeOrOptions, timeout }
      : bufferSizeOrOptions,
  )

  syncFnCache.set(workerPath, syncFn)

  return syncFn
}

const throwError = (msg: string) => {
  throw new Error(msg)
}

function startWorkerThread<R, T extends AnyAsyncFn<R>>(
  workerPath: string,
  {
    bufferSize = DEFAULT_WORKER_BUFFER_SIZE,
    timeout = DEFAULT_TIMEOUT,
    execArgv = DEFAULT_EXEC_ARGV,
  }: SynckitOptions = {},
) {
  const { port1: mainPort, port2: workerPort } = new MessageChannel()

  const isTs = workerPath.endsWith('.ts')

  const worker = new Worker(
    isTs
      ? TS_USE_ESM
        ? throwError(
            'Native esm in `.ts` file is not supported yet, please use `.cjs` instead',
          )
        : `require('ts-node/register');require('${workerPath}')`
      : workerPath,
    {
      eval: isTs,
      workerData: { workerPort },
      transferList: [workerPort],
      execArgv,
    },
  )

  let nextID = 0

  const syncFn = (...args: Parameters<T>): R => {
    const id = nextID++

    const sharedBuffer = new SharedArrayBuffer(bufferSize)
    const sharedBufferView = new Int32Array(sharedBuffer)

    const msg: MainToWorkerMessage<Parameters<T>> = { sharedBuffer, id, args }
    worker.postMessage(msg)

    const status = Atomics.wait(sharedBufferView, 0, 0, timeout)

    /* istanbul ignore if */
    if (!['ok', 'not-equal'].includes(status)) {
      throw new Error('Internal error: Atomics.wait() failed: ' + status)
    }

    const {
      id: id2,
      result,
      error,
      properties,
    } = receiveMessageOnPort(mainPort)!.message as WorkerToMainMessage<R>

    /* istanbul ignore if */
    if (id !== id2) {
      throw new Error(`Internal error: Expected id ${id} but got id ${id2}`)
    }

    if (error) {
      throw applyProperties(error, properties)
    }

    return result!
  }

  worker.unref()

  return syncFn
}

/* istanbul ignore next */
export function runAsWorker<
  R = unknown,
  T extends AnyAsyncFn<R> = AnyAsyncFn<R>,
>(fn: T) {
  if (!workerData) {
    return
  }

  const { workerPort } = workerData as WorkerData
  parentPort!.on(
    'message',
    ({ sharedBuffer, id, args }: MainToWorkerMessage<Parameters<T>>) => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      ;(async () => {
        const sharedBufferView = new Int32Array(sharedBuffer)
        let msg: WorkerToMainMessage<R>
        try {
          msg = { id, result: await fn(...args) }
        } catch (error: unknown) {
          msg = {
            id,
            error,
            properties: extractProperties(error),
          }
        }
        workerPort.postMessage(msg)
        Atomics.add(sharedBufferView, 0, 1)
        Atomics.notify(sharedBufferView, 0)
      })()
    },
  )
}
