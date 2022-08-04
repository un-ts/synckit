import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  MessageChannel,
  Worker,
  receiveMessageOnPort,
  // type-coverage:ignore-next-line -- we can't control
  workerData,
  parentPort,
} from 'node:worker_threads'

import { findUp, tryExtensions } from '@pkgr/utils'

import {
  AnyAsyncFn,
  AnyFn,
  MainToWorkerMessage,
  Syncify,
  ValueOf,
  WorkerData,
  WorkerToMainMessage,
} from './types.js'

export * from './types.js'

export const TsRunner = {
  // https://github.com/TypeStrong/ts-node
  TsNode: 'ts-node',
  // https://github.com/egoist/esbuild-register
  EsbuildRegister: 'esbuild-register',
  // https://github.com/folke/esbuild-runner
  EsbuildRunner: 'esbuild-runner',
  // https://github.com/esbuild-kit/tsx
  TSX: 'tsx',
} as const

export type TsRunner = ValueOf<typeof TsRunner>

const {
  SYNCKIT_BUFFER_SIZE,
  SYNCKIT_TIMEOUT,
  SYNCKIT_EXEC_ARV, // kept for backwards compatibility
  SYNCKIT_EXEC_ARGV,
  SYNCKIT_TS_RUNNER,
} = process.env

export const DEFAULT_BUFFER_SIZE = SYNCKIT_BUFFER_SIZE
  ? +SYNCKIT_BUFFER_SIZE
  : undefined

export const DEFAULT_TIMEOUT = SYNCKIT_TIMEOUT ? +SYNCKIT_TIMEOUT : undefined

export const DEFAULT_WORKER_BUFFER_SIZE = DEFAULT_BUFFER_SIZE || 1024

/* istanbul ignore next */
export const DEFAULT_EXEC_ARGV = (SYNCKIT_EXEC_ARV || SYNCKIT_EXEC_ARGV)?.split(',') || []

export const DEFAULT_TS_RUNNER = (SYNCKIT_TS_RUNNER ||
  TsRunner.TsNode) as TsRunner

export const MTS_SUPPORTED_NODE_VERSION = 16

const syncFnCache = new Map<string, AnyFn>()

export interface SynckitOptions {
  bufferSize?: number
  timeout?: number
  execArgv?: string[]
  tsRunner?: TsRunner
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

const setupTsRunner = (
  workerPath: string,
  { execArgv, tsRunner }: { execArgv: string[]; tsRunner: TsRunner }, // eslint-disable-next-line sonarjs/cognitive-complexity
) => {
  let ext = path.extname(workerPath)

  if (
    !/[/\\]node_modules[/\\]/.test(workerPath) &&
    (!ext || /^\.[cm]?js$/.test(ext))
  ) {
    const workPathWithoutExt = ext
      ? workerPath.slice(0, -ext.length)
      : workerPath
    let extensions: string[]
    switch (ext) {
      case '.cjs':
        extensions = ['.cts', '.cjs']
        break
      case '.mjs':
        extensions = ['.mts', '.mjs']
        break
      default:
        extensions = ['.ts', '.js']
        break
    }
    const found = tryExtensions(workPathWithoutExt, extensions)
    let differentExt: boolean | undefined
    if (found && (!ext || (differentExt = found !== workPathWithoutExt))) {
      workerPath = found
      if (differentExt) {
        ext = path.extname(workerPath)
      }
    }
  }

  const isTs = /\.[cm]?ts$/.test(workerPath)

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
    switch (tsRunner) {
      case TsRunner.TsNode: {
        if (tsUseEsm) {
          if (!execArgv.includes('--loader')) {
            execArgv = ['--loader', `${TsRunner.TsNode}/esm`, ...execArgv]
          }
        } else if (!execArgv.includes('-r')) {
          execArgv = ['-r', `${TsRunner.TsNode}/register`, ...execArgv]
        }
        break
      }
      case TsRunner.EsbuildRegister: {
        if (!execArgv.includes('-r')) {
          execArgv = ['-r', TsRunner.EsbuildRegister, ...execArgv]
        }
        break
      }
      case TsRunner.EsbuildRunner: {
        if (!execArgv.includes('-r')) {
          execArgv = ['-r', `${TsRunner.EsbuildRunner}/register`, ...execArgv]
        }
        break
      }
      case TsRunner.TSX: {
        if (!execArgv.includes('--loader')) {
          execArgv = ['--loader', TsRunner.TSX, ...execArgv]
        }
        break
      }
      default: {
        throw new Error(`Unknown ts runner: ${String(tsRunner)}`)
      }
    }
  }

  return {
    ext,
    isTs,
    tsUseEsm,
    workerPath,
    execArgv,
  }
}

// eslint-disable-next-line sonarjs/cognitive-complexity
function startWorkerThread<R, T extends AnyAsyncFn<R>>(
  workerPath: string,
  {
    bufferSize = DEFAULT_WORKER_BUFFER_SIZE,
    timeout = DEFAULT_TIMEOUT,
    execArgv = DEFAULT_EXEC_ARGV,
    tsRunner = DEFAULT_TS_RUNNER,
  }: SynckitOptions = {},
) {
  const { port1: mainPort, port2: workerPort } = new MessageChannel()

  const {
    isTs,
    ext,
    tsUseEsm,
    workerPath: finalWorkerPath,
    execArgv: finalExecArgv,
  } = setupTsRunner(workerPath, { execArgv, tsRunner })

  const workerPathUrl = pathToFileURL(finalWorkerPath)

  if (/\.[cm]ts$/.test(finalWorkerPath)) {
    const isTsxSupported =
      !tsUseEsm ||
      Number.parseFloat(process.versions.node) >= MTS_SUPPORTED_NODE_VERSION
    /* istanbul ignore if */
    if (
      (
        [
          // https://github.com/egoist/esbuild-register/issues/79
          TsRunner.EsbuildRegister,
          // https://github.com/folke/esbuild-runner/issues/67
          TsRunner.EsbuildRunner,
          .../* istanbul ignore next */ (isTsxSupported ? [] : [TsRunner.TSX]),
        ] as TsRunner[]
      ).includes(tsRunner)
    ) {
      throw new Error(
        `${tsRunner} is not supported for ${ext} files yet` +
          (isTsxSupported
            ? ', you can try [tsx](https://github.com/esbuild-kit/tsx) instead'
            : ''),
      )
    }
  }

  const useEval = isTs && !tsUseEsm

  const worker = new Worker(
    tsUseEsm && tsRunner === TsRunner.TsNode
      ? dataUrl(`import '${String(workerPathUrl)}'`)
      : useEval
      ? `require('${finalWorkerPath.replace(/\\/g, '\\\\')}')`
      : workerPathUrl,
    {
      eval: useEval,
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
  // type-coverage:ignore-next-line -- we can't control
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
