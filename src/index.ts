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

export const useWorkerThreads = !['0', 'false'].includes(
  process.env.SYNCKIT_WORKER_THREADS!,
)

const syncFnCache = new Map<string, AnyFn>()

export function createSyncFn<T extends AnyAsyncFn>(
  workerPath: string,
  bufferSize?: number,
): Syncify<T>
export function createSyncFn<T>(workerPath: string, bufferSize?: number) {
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
  )

  syncFnCache.set(workerPath, syncFn)

  return syncFn
}

function startChildProcess<T>(workerPath: string) {
  const executor = workerPath.endsWith('.ts') ? 'ts-node' : 'node'

  return (...args: unknown[]): T => {
    const filename = path.resolve(tmpdir, `synckit-${uuid()}.json`)

    fs.writeFileSync(filename, JSON.stringify(args))

    const command = `${executor} ${workerPath} ${filename}`

    try {
      execSync(command, {
        stdio: 'inherit',
      })
      const { result, error } = JSON.parse(
        fs.readFileSync(filename, 'utf8'),
      ) as DataMessage<T>

      if (error) {
        throw typeof error === 'object' && error && 'message' in error
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

function startWorkerThread<T>(workerPath: string, bufferSize = 1024) {
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

    const status = Atomics.wait(sharedBufferView, 0, 0)

    /* istanbul ignore if */
    if (status !== 'ok' && status !== 'not-equal') {
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
      throw Object.assign(error, properties)
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
    } catch (err) {
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
        } catch (err) {
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
