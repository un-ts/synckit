import { execSync } from 'child_process'
import { tmpdir as _tmpdir } from 'os'
import path from 'path'
import fs from 'fs'

import { v4 as uuid } from 'uuid'

import {
  AnyAsyncFn,
  AnyFn,
  DataMessage,
  MainToWorkerMessage,
  Syncify,
  WorkerData,
  WorkerToMainMessage,
} from './types'

export * from './types'

/**
 * @link https://github.com/sindresorhus/temp-dir/blob/main/index.js#L9
 */
export const tmpdir = fs.realpathSync(_tmpdir())

let workerThreads: typeof import('worker_threads') | undefined

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
  workerThreads = require('worker_threads')

  /* istanbul ignore if */
  if (typeof workerThreads!.receiveMessageOnPort !== 'function') {
    workerThreads = undefined
  }
} catch {}

/* istanbul ignore if */
if (!workerThreads) {
  console.warn(
    '[synckit]: `worker_threads` or `receiveMessageOnPort` is not available in current environment, `Node >= 12` is required',
  )
}

const { SYNCKIT_WORKER_THREADS, SYNCKIT_BUFFER_SIZE, SYNCKIT_TIMEOUT } =
  process.env

export const useWorkerThreads =
  !!workerThreads &&
  (!SYNCKIT_WORKER_THREADS || !['0', 'false'].includes(SYNCKIT_WORKER_THREADS))

export const DEFAULT_BUFFER_SIZE = SYNCKIT_BUFFER_SIZE
  ? +SYNCKIT_BUFFER_SIZE
  : undefined

export const DEFAULT_TIMEOUT = SYNCKIT_TIMEOUT ? +SYNCKIT_TIMEOUT : undefined

export const DEFAULT_WORKER_BUFFER_SIZE = DEFAULT_BUFFER_SIZE || 1024

const syncFnCache = new Map<string, AnyFn>()

export function createSyncFn<T extends AnyAsyncFn>(
  workerPath: string,
  bufferSize?: number,
  timeout?: number,
): Syncify<T>
export function createSyncFn<R, T extends AnyAsyncFn<R>>(
  workerPath: string,
  bufferSize?: number,
  timeout = DEFAULT_TIMEOUT,
) {
  if (!path.isAbsolute(workerPath)) {
    throw new Error('`workerPath` must be absolute')
  }

  const cachedSyncFn = syncFnCache.get(workerPath)

  if (cachedSyncFn) {
    return cachedSyncFn
  }

  const syncFn = (useWorkerThreads ? startWorkerThread : startChildProcess)<
    R,
    T
  >(workerPath, bufferSize, timeout)

  syncFnCache.set(workerPath, syncFn)

  return syncFn
}

function startChildProcess<R, T extends AnyAsyncFn<R>>(
  workerPath: string,
  bufferSize = DEFAULT_BUFFER_SIZE,
  timeout?: number,
) {
  const executor = workerPath.endsWith('.ts') ? 'ts-node' : 'node'

  return (...args: Parameters<T>): R => {
    const filename = path.resolve(tmpdir, `synckit-${uuid()}.json`)

    fs.writeFileSync(filename, JSON.stringify(args))

    const command = `${executor} ${workerPath} ${filename}`

    try {
      execSync(command, {
        stdio: 'inherit',
        maxBuffer: bufferSize,
        timeout,
      })
      const { result, error } = JSON.parse(
        fs.readFileSync(filename, 'utf8'),
      ) as DataMessage<R>

      if (error) {
        throw typeof error === 'object' && 'message' in error!
          ? // eslint-disable-next-line unicorn/error-message
            Object.assign(new Error(), error)
          : error
      }

      return result!
    } finally {
      fs.unlinkSync(filename)
    }
  }
}

function startWorkerThread<R, T extends AnyAsyncFn<R>>(
  workerPath: string,
  bufferSize = DEFAULT_WORKER_BUFFER_SIZE,
  timeout?: number,
) {
  const { port1: mainPort, port2: workerPort } =
    new workerThreads!.MessageChannel()

  const isTs = workerPath.endsWith('.ts')

  const worker = new workerThreads!.Worker(
    isTs
      ? `require('ts-node/register');require(require('worker_threads').workerData.workerPath)`
      : workerPath,
    {
      eval: isTs,
      workerData: { workerPath, workerPort },
      transferList: [workerPort],
      execArgv: [],
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
    } = workerThreads!.receiveMessageOnPort(mainPort)!
      .message as WorkerToMainMessage<R>

    /* istanbul ignore if */
    if (id !== id2) {
      throw new Error(`Internal error: Expected id ${id} but got id ${id2}`)
    }

    if (error) {
      throw error
    }

    return result!
  }

  worker.unref()

  return syncFn
}

export async function runAsWorker<T extends AnyAsyncFn>(fn: T): Promise<void>
export async function runAsWorker<R, T extends AnyAsyncFn<R>>(fn: T) {
  if (!workerThreads?.workerData) {
    const filename = process.argv[2]
    const content = fs.readFileSync(filename, 'utf8')
    const args = JSON.parse(content) as Parameters<T>
    let msg: DataMessage<R>
    try {
      msg = { result: await fn(...args) }
    } catch (err: unknown) {
      msg = {
        error:
          err instanceof Error
            ? { ...err, name: err.name, message: err.message, stack: err.stack }
            : err,
      }
    }
    fs.writeFileSync(filename, JSON.stringify(msg))
    return
  }

  /* istanbul ignore next */
  const { workerPort } = workerThreads.workerData as WorkerData
  /* istanbul ignore next */
  workerThreads.parentPort!.on(
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
          }
        }
        workerPort.postMessage(msg)
        Atomics.add(sharedBufferView, 0, 1)
        Atomics.notify(sharedBufferView, 0)
      })()
    },
  )
}
