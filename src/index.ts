import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  MessageChannel,
  type TransferListItem,
  Worker,
  parentPort,
  receiveMessageOnPort,
  // type-coverage:ignore-next-line -- we can't control
  workerData,
} from 'node:worker_threads'

import { findUp, isPkgAvailable, tryExtensions } from '@pkgr/core'

import type {
  AnyAsyncFn,
  AnyFn,
  GlobalShim,
  MainToWorkerMessage,
  Syncify,
  ValueOf,
  WorkerData,
  WorkerToMainMessage,
} from './types.js'

const INT32_BYTES = 4

export * from './types.js'

export const TsRunner = {
  // https://github.com/TypeStrong/ts-node
  TsNode: 'ts-node',
  // https://github.com/egoist/esbuild-register
  EsbuildRegister: 'esbuild-register',
  // https://github.com/folke/esbuild-runner
  EsbuildRunner: 'esbuild-runner',
  // https://github.com/swc-project/swc-node/tree/master/packages/register
  SWC: 'swc',
  // https://github.com/esbuild-kit/tsx
  TSX: 'tsx',
} as const

export type TsRunner = ValueOf<typeof TsRunner>

const {
  SYNCKIT_TIMEOUT,
  SYNCKIT_EXEC_ARGV,
  SYNCKIT_TS_RUNNER,
  SYNCKIT_GLOBAL_SHIMS,
  NODE_OPTIONS,
} = process.env

export const DEFAULT_TIMEOUT = SYNCKIT_TIMEOUT ? +SYNCKIT_TIMEOUT : undefined

/* istanbul ignore next */
export const DEFAULT_EXEC_ARGV = SYNCKIT_EXEC_ARGV?.split(',') || []

export const DEFAULT_TS_RUNNER = SYNCKIT_TS_RUNNER as TsRunner | undefined

export const DEFAULT_GLOBAL_SHIMS = ['1', 'true'].includes(
  SYNCKIT_GLOBAL_SHIMS!,
)

export const DEFAULT_GLOBAL_SHIMS_PRESET: GlobalShim[] = [
  {
    moduleName: 'node-fetch',
    globalName: 'fetch',
  },
  {
    moduleName: 'node:perf_hooks',
    globalName: 'performance',
    named: 'performance',
  },
]

export const MTS_SUPPORTED_NODE_VERSION = 16

const syncFnCache = new Map<string, AnyFn>()

export interface SynckitOptions {
  timeout?: number
  execArgv?: string[]
  tsRunner?: TsRunner
  transferList?: TransferListItem[]
  globalShims?: GlobalShim[] | boolean
}

// MessagePort doesn't copy the properties of Error objects. We still want
// error objects to have extra properties such as "warnings" so implement the
// property copying manually.
export function extractProperties<T extends object>(object: T): T
export function extractProperties<T>(object?: T): T | undefined
export function extractProperties<T>(object?: T) {
  if (object && typeof object === 'object') {
    const properties = {} as T
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
      ? { timeout }
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

export const isFile = (path: string) => {
  try {
    return !!fs.statSync(path, { throwIfNoEntry: false })?.isFile()
  } catch {
    /* istanbul ignore next */
    return false
  }
}

const setupTsRunner = (
  workerPath: string,
  { execArgv, tsRunner }: { execArgv: string[]; tsRunner?: TsRunner }, // eslint-disable-next-line sonarjs/cognitive-complexity
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
      case '.cjs': {
        extensions = ['.cts', '.cjs']
        break
      }
      case '.mjs': {
        extensions = ['.mts', '.mjs']
        break
      }
      default: {
        extensions = ['.ts', '.js']
        break
      }
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

  let jsUseEsm = workerPath.endsWith('.mjs')
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

    if (tsRunner == null && isPkgAvailable(TsRunner.TsNode)) {
      tsRunner = TsRunner.TsNode
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
      case TsRunner.SWC: {
        if (!execArgv.includes('-r')) {
          execArgv = ['-r', `@${TsRunner.SWC}-node/register`, ...execArgv]
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
  } else if (!jsUseEsm) {
    const pkg = findUp(workerPath)
    if (pkg) {
      jsUseEsm =
        (cjsRequire(pkg) as { type?: 'commonjs' | 'module' }).type === 'module'
    }
  }

  /* istanbul ignore if -- https://github.com/facebook/jest/issues/5274 */
  if (process.versions.pnp) {
    const nodeOptions = NODE_OPTIONS?.split(/\s+/)
    let pnpApiPath: string | undefined
    try {
      /** @see https://github.com/facebook/jest/issues/9543 */
      pnpApiPath = cjsRequire.resolve('pnpapi')
    } catch {}
    if (
      pnpApiPath &&
      !nodeOptions?.some(
        (option, index) =>
          ['-r', '--require'].includes(option) &&
          pnpApiPath === cjsRequire.resolve(nodeOptions[index + 1]),
      ) &&
      !execArgv.includes(pnpApiPath)
    ) {
      execArgv = ['-r', pnpApiPath, ...execArgv]
      const pnpLoaderPath = path.resolve(pnpApiPath, '../.pnp.loader.mjs')
      if (isFile(pnpLoaderPath)) {
        // Transform path to file URL because nodejs does not accept
        // absolute Windows paths in the --experimental-loader option.
        // https://github.com/un-ts/synckit/issues/123
        const experimentalLoader = pathToFileURL(pnpLoaderPath).toString()
        execArgv = ['--experimental-loader', experimentalLoader, ...execArgv]
      }
    }
  }

  return {
    ext,
    isTs,
    jsUseEsm,
    tsRunner,
    tsUseEsm,
    workerPath,
    execArgv,
  }
}

const md5Hash = (text: string) => createHash('md5').update(text).digest('hex')

export const encodeImportModule = (
  moduleNameOrGlobalShim: GlobalShim | string,
  type: 'import' | 'require' = 'import',
  // eslint-disable-next-line sonarjs/cognitive-complexity
) => {
  const { moduleName, globalName, named, conditional }: GlobalShim =
    typeof moduleNameOrGlobalShim === 'string'
      ? { moduleName: moduleNameOrGlobalShim }
      : moduleNameOrGlobalShim
  const importStatement =
    type === 'import'
      ? `import${
          globalName
            ? ' ' +
              (named === null
                ? '* as ' + globalName
                : named?.trim()
                ? `{${named}}`
                : globalName) +
              ' from'
            : ''
        } '${
          path.isAbsolute(moduleName)
            ? String(pathToFileURL(moduleName))
            : moduleName
        }'`
      : `${
          globalName
            ? 'const ' + (named?.trim() ? `{${named}}` : globalName) + '='
            : ''
        }require('${moduleName
          // eslint-disable-next-line unicorn/prefer-string-replace-all -- compatibility
          .replace(/\\/g, '\\\\')}')`

  if (!globalName) {
    return importStatement
  }

  const overrideStatement = `globalThis.${globalName}=${
    named?.trim() ? named : globalName
  }`

  return (
    importStatement +
    (conditional === false
      ? `;${overrideStatement}`
      : `;if(!globalThis.${globalName})${overrideStatement}`)
  )
}

/**
 * @internal
 */
export const _generateGlobals = (
  globalShims: GlobalShim[],
  type: 'import' | 'require',
) =>
  globalShims.reduce(
    (acc, shim) => `${acc}${acc ? ';' : ''}${encodeImportModule(shim, type)}`,
    '',
  )

const globalsCache = new Map<string, [content: string, filepath?: string]>()

let tmpdir: string

const _dirname =
  typeof __dirname === 'undefined'
    ? path.dirname(fileURLToPath(import.meta.url))
    : /* istanbul ignore next */ __dirname

export const generateGlobals = (
  workerPath: string,
  globalShims: GlobalShim[],
  type: 'import' | 'require' = 'import',
) => {
  const cached = globalsCache.get(workerPath)

  if (cached) {
    const [content, filepath] = cached

    if (
      (type === 'require' && !filepath) ||
      (type === 'import' && filepath && isFile(filepath))
    ) {
      return content
    }
  }

  const globals = _generateGlobals(globalShims, type)

  let content = globals
  let filepath: string | undefined

  if (type === 'import') {
    if (!tmpdir) {
      tmpdir = path.resolve(findUp(_dirname), '../node_modules/.synckit')
    }
    fs.mkdirSync(tmpdir, { recursive: true })
    filepath = path.resolve(tmpdir, md5Hash(workerPath) + '.mjs')
    content = encodeImportModule(filepath)
    fs.writeFileSync(filepath, globals)
  }

  globalsCache.set(workerPath, [content, filepath])

  return content
}

// eslint-disable-next-line sonarjs/cognitive-complexity
function startWorkerThread<R, T extends AnyAsyncFn<R>>(
  workerPath: string,
  {
    timeout = DEFAULT_TIMEOUT,
    execArgv = DEFAULT_EXEC_ARGV,
    tsRunner = DEFAULT_TS_RUNNER,
    transferList = [],
    globalShims = DEFAULT_GLOBAL_SHIMS,
  }: SynckitOptions = {},
) {
  const { port1: mainPort, port2: workerPort } = new MessageChannel()

  const {
    isTs,
    ext,
    jsUseEsm,
    tsUseEsm,
    tsRunner: finalTsRunner,
    workerPath: finalWorkerPath,
    execArgv: finalExecArgv,
  } = setupTsRunner(workerPath, { execArgv, tsRunner })

  const workerPathUrl = pathToFileURL(finalWorkerPath)

  if (/\.[cm]ts$/.test(finalWorkerPath)) {
    const isTsxSupported =
      !tsUseEsm ||
      Number.parseFloat(process.versions.node) >= MTS_SUPPORTED_NODE_VERSION
    /* istanbul ignore if */
    if (!finalTsRunner) {
      throw new Error('No ts runner specified, ts worker path is not supported')
    } /* istanbul ignore if */ else if (
      (
        [
          // https://github.com/egoist/esbuild-register/issues/79
          TsRunner.EsbuildRegister,
          // https://github.com/folke/esbuild-runner/issues/67
          TsRunner.EsbuildRunner,
          // https://github.com/swc-project/swc-node/issues/667
          TsRunner.SWC,
          .../* istanbul ignore next */ (isTsxSupported ? [] : [TsRunner.TSX]),
        ] as TsRunner[]
      ).includes(finalTsRunner)
    ) {
      throw new Error(
        `${finalTsRunner} is not supported for ${ext} files yet` +
          /* istanbul ignore next */ (isTsxSupported
            ? ', you can try [tsx](https://github.com/esbuild-kit/tsx) instead'
            : ''),
      )
    }
  }

  const finalGlobalShims = (
    globalShims === true
      ? DEFAULT_GLOBAL_SHIMS_PRESET
      : Array.isArray(globalShims)
      ? globalShims
      : []
  ).filter(({ moduleName }) => isPkgAvailable(moduleName))

  // We store a single Byte in the SharedArrayBuffer
  // for the notification, we can used a fixed size
  const sharedBuffer = new SharedArrayBuffer(INT32_BYTES)
  const sharedBufferView = new Int32Array(sharedBuffer, 0, 1)

  const useGlobals = finalGlobalShims.length > 0

  const useEval = isTs ? !tsUseEsm : !jsUseEsm && useGlobals

  const worker = new Worker(
    (jsUseEsm && useGlobals) || (tsUseEsm && finalTsRunner === TsRunner.TsNode)
      ? dataUrl(
          `${generateGlobals(
            finalWorkerPath,
            finalGlobalShims,
          )};import '${String(workerPathUrl)}'`,
        )
      : useEval
      ? `${generateGlobals(
          finalWorkerPath,
          finalGlobalShims,
          'require',
        )};${encodeImportModule(finalWorkerPath, 'require')}`
      : workerPathUrl,
    {
      eval: useEval,
      workerData: { sharedBuffer, workerPort },
      transferList: [workerPort, ...transferList],
      execArgv: finalExecArgv,
    },
  )

  let nextID = 0

  const syncFn = (...args: Parameters<T>): R => {
    const id = nextID++

    // Reset SharedArrayBuffer
    Atomics.store(sharedBufferView, 0, 0)

    const msg: MainToWorkerMessage<Parameters<T>> = { id, args }
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

  const { workerPort, sharedBuffer } = workerData as WorkerData
  const sharedBufferView = new Int32Array(sharedBuffer, 0, 1)

  parentPort!.on(
    'message',
    ({ id, args }: MainToWorkerMessage<Parameters<T>>) => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      ;(async () => {
        let msg: WorkerToMainMessage<R>
        try {
          msg = { id, result: await fn(...args) }
        } catch (error: unknown) {
          msg = { id, error, properties: extractProperties(error) }
        }
        workerPort.postMessage(msg)
        Atomics.add(sharedBufferView, 0, 1)
        Atomics.notify(sharedBufferView, 0)
      })()
    },
  )
}
