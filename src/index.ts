import { execSync } from 'child_process'
import { tmpdir as _tmpdir } from 'os'
import path from 'path'
import fs from 'fs'
import {
  MessageChannel,
  parentPort,
  receiveMessageOnPort,
  Worker,
  workerData,
} from 'worker_threads'

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

const { SYNCKIT_WORKER_THREADS, SYNCKIT_BUFFER_SIZE, SYNCKIT_TIMEOUT } =
  process.env

export const useWorkerThreads =
  !SYNCKIT_WORKER_THREADS || !['0', 'false'].includes(SYNCKIT_WORKER_THREADS)

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
export function createSyncFn<T>(
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

  let resolvedWorkerPath = workerPath

  if (!resolvedWorkerPath.endsWith('.ts')) {
    resolvedWorkerPath = require.resolve(workerPath)
  }

  const syncFn = (useWorkerThreads ? startWorkerThread : startChildProcess)<T>(
    resolvedWorkerPath,
    bufferSize,
    timeout,
  )

  syncFnCache.set(workerPath, syncFn)

  return syncFn
}

function startChildProcess<T>(
  workerPath: string,
  bufferSize = DEFAULT_BUFFER_SIZE,
  timeout?: number,
) {
  const executor = workerPath.endsWith('.ts') ? 'ts-node' : 'node'

  return (...args: unknown[]): T => {
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
      ) as DataMessage<T>

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

function startWorkerThread<T>(
  workerPath: string,
  bufferSize = DEFAULT_WORKER_BUFFER_SIZE,
  timeout?: number,
) {
  const { port1: mainPort, port2: workerPort } = new MessageChannel()

  const isTs = workerPath.endsWith('.ts')

  const worker = new Worker(
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

  const syncFn = (...args: unknown[]): T => {
    const id = nextID++

    const sharedBuffer = new SharedArrayBuffer(bufferSize)
    const sharedBufferView = new Int32Array(sharedBuffer)

    const msg: MainToWorkerMessage = { sharedBuffer, id, args }
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
    } = receiveMessageOnPort(mainPort)!.message as WorkerToMainMessage<T>

    /* istanbul ignore if */
    if (id !== id2) {
      throw new Error(`Internal error: Expected id ${id} but got id ${id2}`)
    }

    if (error) {
      // MessagePort doesn't copy the properties of Error objects. We still want
      // error objects to have extra properties such as "warnings" so implement the
      // property copying manually.
      throw typeof error === 'object' ? Object.assign(error, properties) : error
    }

    return result!
  }

  worker.unref()

  return syncFn
}

export const runAsWorker = async <T extends AnyAsyncFn>(fn: T) => {
  if (!workerData) {
    const filename = process.argv[2]
    const content = fs.readFileSync(filename, 'utf8')
    const args = JSON.parse(content) as Parameters<T>
    let msg: DataMessage<T>
    try {
      msg = { result: (await fn(...args)) as T }
    } catch (err: unknown) {
      msg = {
        error:
          err instanceof Error
            ? { name: err.name, message: err.message, stack: err.stack }
            : err,
      }
    }
    fs.writeFileSync(filename, JSON.stringify(msg))
    return
  }

  /* istanbul ignore next */
  const { workerPort } = workerData as WorkerData
  /* istanbul ignore next */
  parentPort!.on(
    'message',
    ({ sharedBuffer, id, args }: MainToWorkerMessage) => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      ;(async () => {
        const sharedBufferView = new Int32Array(sharedBuffer)
        let msg: WorkerToMainMessage<T>
        try {
          msg = { id, result: (await fn(...args)) as T }
        } catch (err: unknown) {
          const error = err as Error
          msg = { id, error, properties: { ...error } }
        }
        workerPort.postMessage(msg)
        Atomics.add(sharedBufferView, 0, 1)
        Atomics.notify(sharedBufferView, 0, Number.POSITIVE_INFINITY)
      })()
    },
  )
}
