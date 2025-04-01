import module from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parentPort,
  // type-coverage:ignore-next-line -- we can't control
  workerData,
} from 'node:worker_threads'

import { compareVersion } from './common.js'
import { NODE_VERSION, LOADER_SUPPORTED_NODE_VERSION } from './constants.js'
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
export function runAsWorker<T extends AnyFn<Promise<R> | R>, R = ReturnType<T>>(
  fn: T,
) {
  // type-coverage:ignore-next-line -- we can't control
  if (!workerData) {
    return
  }

  const stdio: StdioChunk[] = []

  overrideStdio(stdio)

  const { workerPort, sharedBufferView, pnpLoaderPath } =
    workerData as WorkerData

  if (
    pnpLoaderPath &&
    // >=
    compareVersion(NODE_VERSION, LOADER_SUPPORTED_NODE_VERSION) >= 0
  ) {
    module.register(pnpLoaderPath)
  }

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
