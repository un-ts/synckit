import { createRequire } from 'module'
import path from 'path'
import { pathToFileURL } from 'url'
import {
  MessageChannel,
  Worker,
  receiveMessageOnPort,
  workerData,
  parentPort,
} from 'worker_threads'

import { findUp, tryExtensions } from '@pkgr/utils'

import {
  AnyAsyncFn,
  AnyFn,
  MainToWorkerMessage,
  Syncify,
  WorkerData,
  WorkerToMainMessage,
} from './types.js'

export * from './types.js'

const { SYNCKIT_BUFFER_SIZE, SYNCKIT_TIMEOUT, SYNCKIT_EXEC_ARV } = process.env

export const DEFAULT_BUFFER_SIZE = SYNCKIT_BUFFER_SIZE
  ? +SYNCKIT_BUFFER_SIZE
  : undefined

export const DEFAULT_TIMEOUT = SYNCKIT_TIMEOUT ? +SYNCKIT_TIMEOUT : undefined

export const DEFAULT_WORKER_BUFFER_SIZE = DEFAULT_BUFFER_SIZE || 1024

/* istanbul ignore next */
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
export const extractProperties = <T>(object?: T): T | undefined => {
  if (object && typeof object === 'object') {
    const properties = {} as unknown as T
    for (const key in object) {
      properties[key as keyof T] = object[key]
    }
    return properties
  }
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
    /* istanbul ignore next */ typeof bufferSizeOrOptions === 'number'
      ? { bufferSize: bufferSizeOrOptions, timeout }
      : bufferSizeOrOptions,
  )

  syncFnCache.set(workerPath, syncFn)

  return syncFn
}

const cjsRequire =
  typeof require === 'undefined'
    ? createRequire(import.meta.url)
    : /* istanbul ignore next */ require

const dataUrl = (code: string) =>
  new URL(`data:text/javascript,${encodeURIComponent(code)}`)

// eslint-disable-next-line sonarjs/cognitive-complexity
const setupTsNode = (workerPath: string, execArgv: string[]) => {
  if (!/[/\\]node_modules[/\\]/.test(workerPath)) {
    const ext = path.extname(workerPath)
    // TODO: support `.cts` and `.mts` automatically
    if (!ext || ext === '.js') {
      const found = tryExtensions(
        ext ? workerPath.replace(/\.js$/, '') : workerPath,
        ['.ts', '.js'],
      )
      if (found) {
        workerPath = found
      }
    }
  }

  const isTs = /\.[cm]?ts$/.test(workerPath)

  // TODO: it does not work for `ts-node` for now
  let tsUseEsm = workerPath.endsWith('.mts')

  if (isTs) {
    if (!tsUseEsm) {
      const pkg = findUp(workerPath)
      if (pkg) {
        tsUseEsm =
          (cjsRequire(pkg) as { type?: 'commonjs' | 'module' }).type ===
          'module'
      }
    }
    if (tsUseEsm && !execArgv.includes('--loader')) {
      execArgv = ['--loader', 'ts-node/esm', ...execArgv]
    }
  }

  return {
    isTs,
    tsUseEsm,
    workerPath,
    execArgv,
  }
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

  const {
    isTs,
    tsUseEsm,
    workerPath: finalWorkerPath,
    execArgv: finalExecArgv,
  } = setupTsNode(workerPath, execArgv)

  const worker = new Worker(
    isTs
      ? tsUseEsm
        ? dataUrl(`import '${String(pathToFileURL(finalWorkerPath))}'`)
        : `require('ts-node/register');require('${finalWorkerPath}')`
      : finalWorkerPath,
    {
      eval: isTs && !tsUseEsm,
      workerData: { workerPort },
      transferList: [workerPort],
      execArgv: finalExecArgv,
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
    } = (receiveMessageOnPort(mainPort) as { message: WorkerToMainMessage<R> })
      .message

    /* istanbul ignore if */
    if (id !== id2) {
      throw new Error(`Internal error: Expected id ${id} but got id ${id2}`)
    }

    if (error) {
      throw Object.assign(error as object, properties)
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
