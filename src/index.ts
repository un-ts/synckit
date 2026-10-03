import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parentPort,
  // type-coverage:ignore-next-line -- we can't control
  workerData,
} from 'node:worker_threads'

import {
  extractProperties,
  overrideStdio,
  startWorkerThread,
} from './helpers.js'
import type {
  AnyFn,
  MainToWorkerCommandMessage,
  MainToWorkerMessage,
  StdioChunk,
  Syncify,
  SynckitOptions,
  WorkerData,
  WorkerToMainMessage,
} from './types.js'

export * from './common.js'
export * from './constants.js'
export * from './helpers.js'
export * from './types.js'

let syncFnCache: Map<string, AnyFn> | undefined

/**
 * Creates a synchronous worker function.
 *
 * Converts the provided worker path (URL or string) to an absolute file path,
 * retrieves a cached synchronous function if one exists, or starts a new worker
 * thread to handle task execution. The resulting function is cached to avoid
 * redundant initialization.
 *
 * @param workerPath - The absolute file path or URL of the worker script. If
 *   given as a URL, it is converted to a file path.
 * @param timeoutOrOptions - Optional timeout in milliseconds or an options
 *   object to configure the worker thread.
 * @returns A synchronous function that executes tasks on the specified worker
 *   thread.
 * @throws {Error} If the resulting worker path is not absolute.
 */
export function createSyncFn<T extends AnyFn>(
  workerPath: URL | string,
  timeoutOrOptions?: SynckitOptions | number,
): Syncify<T> {
  syncFnCache ??= new Map()

  if (typeof workerPath !== 'string' || workerPath.startsWith('file://')) {
    workerPath = fileURLToPath(workerPath)
  }

  const cachedSyncFn = syncFnCache.get(workerPath)

  if (cachedSyncFn) {
    return cachedSyncFn
  }

  if (!path.isAbsolute(workerPath)) {
    throw new Error('`workerPath` must be absolute')
  }

  const syncFn = startWorkerThread<T>(
    workerPath,
    /* istanbul ignore next */ typeof timeoutOrOptions === 'number'
      ? { timeout: timeoutOrOptions }
      : timeoutOrOptions,
  )

  syncFnCache.set(workerPath, syncFn)

  return syncFn
}

/* istanbul ignore next */
/**
 * Configures the worker thread to listen for messages from the parent process
 * and execute a provided function.
 *
 * If the worker is not initialized with the required data, the function exits
 * without further action. Otherwise, it optionally registers a custom module
 * loader when a valid loader path is provided and captures output generated
 * during execution. It listens for messages containing an identifier and
 * arguments, then invokes the supplied function asynchronously with those
 * arguments. If an abort command is received for the same message, the response
 * is suppressed. Upon completing execution, it posts a message back with either
 * the result or error details, including extracted error properties.
 *
 * @param fn - The function to execute when a message is received.
 */
export function runAsWorker<T extends AnyFn<Promise<R> | R>, R = ReturnType<T>>(
  fn: T,
) {
  // type-coverage:ignore-next-line -- we can't control
  if (!workerData) {
    return
  }

  const stdio: StdioChunk[] = []

  overrideStdio(stdio)

  const { workerPort, sharedBufferView } = workerData as WorkerData

  parentPort!.on(
    'message',
    ({ id, args }: MainToWorkerMessage<Parameters<T>>) => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      ;(async () => {
        let isAborted = false
        const handleAbortMessage = (msg: MainToWorkerCommandMessage) => {
          if (msg.id === id && msg.cmd === 'abort') {
            isAborted = true
          }
        }
        workerPort.on('message', handleAbortMessage)
        let msg: WorkerToMainMessage<Awaited<R>>
        try {
          msg = { id, stdio, result: await fn(...args) }
        } catch (error: unknown) {
          msg = { id, stdio, error, properties: extractProperties(error) }
        }
        workerPort.off('message', handleAbortMessage)
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- false positive for `handleAbortMessage`
        if (isAborted) {
          stdio.length = 0
          return
        }
        try {
          workerPort.postMessage(msg)
          Atomics.add(sharedBufferView, 0, 1)
          Atomics.notify(sharedBufferView, 0)
        } finally {
          stdio.length = 0
        }
      })()
    },
  )
}
