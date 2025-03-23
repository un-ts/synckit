import { createHash } from 'node:crypto'
import fs from 'node:fs'
import module from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  type MessagePort,
  type TransferListItem,
  MessageChannel,
  Worker,
  parentPort,
  receiveMessageOnPort,
  // type-coverage:ignore-next-line -- we can't control
  workerData,
} from 'node:worker_threads'

import { cjsRequire, findUp, isPkgAvailable, tryExtensions } from '@pkgr/core'

import type {
  AnyFn,
  GlobalShim,
  MainToWorkerCommandMessage,
  MainToWorkerMessage,
  PackageJson,
  Syncify,
  ValueOf,
  WorkerData,
  WorkerToMainMessage,
} from './types.js'

const INT32_BYTES = 4

export * from './types.js'

export const TsRunner = {
  // https://nodejs.org/docs/latest/api/typescript.html#type-stripping
  Node: 'node',
  // https://bun.sh/docs/typescript
  Bun: 'bun',
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
  NODE_OPTIONS: NODE_OPTIONS_ = '',
  SYNCKIT_EXEC_ARGV = '',
  SYNCKIT_GLOBAL_SHIMS,
  SYNCKIT_TIMEOUT,
  SYNCKIT_TS_RUNNER,
} = process.env

export const MTS_SUPPORTED_NODE_VERSION = 16
export const LOADER_SUPPORTED_NODE_VERSION = 20

// https://nodejs.org/docs/latest-v22.x/api/typescript.html#type-stripping
export const STRIP_TYPES_NODE_VERSION = 22.6

// https://nodejs.org/docs/latest-v23.x/api/typescript.html#modules-typescript
export const TRANSFORM_TYPES_NODE_VERSION = 22.7

// https://nodejs.org/docs/latest-v23.x/api/typescript.html#type-stripping
export const DEFAULT_TYPES_NODE_VERSION = 23.6

const STRIP_TYPES_FLAG = '--experimental-strip-types'
const TRANSFORM_TYPES_FLAG = '--experimental-transform-types'
const NO_STRIP_TYPES_FLAG = '--no-experimental-strip-types'

const NODE_OPTIONS = NODE_OPTIONS_.split(/\s+/)

const NO_STRIP_TYPES =
  NODE_OPTIONS.includes(NO_STRIP_TYPES_FLAG) ||
  process.argv.includes(NO_STRIP_TYPES_FLAG)

export const NODE_VERSION = Number.parseFloat(process.versions.node)

export const DEFAULT_TIMEOUT = SYNCKIT_TIMEOUT ? +SYNCKIT_TIMEOUT : undefined

export const DEFAULT_EXEC_ARGV = SYNCKIT_EXEC_ARGV.split(',')

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

let syncFnCache: Map<string, AnyFn> | undefined

export interface SynckitOptions {
  execArgv?: string[]
  globalShims?: GlobalShim[] | boolean
  timeout?: number
  transferList?: TransferListItem[]
  tsRunner?: TsRunner
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
    !/([/\\])node_modules\1/.test(workerPath) &&
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
        tsUseEsm = cjsRequire<PackageJson>(pkg).type === 'module'
      }
    }

    if (tsRunner == null) {
      if (process.versions.bun) {
        tsRunner = TsRunner.Bun
      } else if (
        !NO_STRIP_TYPES &&
        !execArgv.includes(NO_STRIP_TYPES_FLAG) &&
        NODE_VERSION >= STRIP_TYPES_NODE_VERSION
      ) {
        tsRunner = TsRunner.Node
      } else if (isPkgAvailable(TsRunner.TsNode)) {
        tsRunner = TsRunner.TsNode
      }
    }

    switch (tsRunner) {
      case TsRunner.Bun: {
        break
      }
      case TsRunner.Node: {
        if (NODE_VERSION < STRIP_TYPES_NODE_VERSION) {
          throw new Error(
            'type stripping is not supported in this node version',
          )
        }

        if (NO_STRIP_TYPES || execArgv.includes(NO_STRIP_TYPES_FLAG)) {
          throw new Error('type stripping is disabled explicitly')
        }

        if (NODE_VERSION >= DEFAULT_TYPES_NODE_VERSION) {
          break
        }

        if (
          NODE_VERSION >= TRANSFORM_TYPES_NODE_VERSION &&
          !execArgv.includes(TRANSFORM_TYPES_FLAG)
        ) {
          execArgv = [TRANSFORM_TYPES_FLAG, ...execArgv]
        } else if (
          NODE_VERSION >= STRIP_TYPES_NODE_VERSION &&
          !execArgv.includes(STRIP_TYPES_FLAG)
        ) {
          execArgv = [STRIP_TYPES_FLAG, ...execArgv]
        }

        break
      }
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
      jsUseEsm = cjsRequire<PackageJson>(pkg).type === 'module'
    }
  }

  let resolvedPnpLoaderPath: string | undefined

  /* istanbul ignore if -- https://github.com/facebook/jest/issues/5274 */
  if (process.versions.pnp) {
    let pnpApiPath: string | undefined
    try {
      /** @see https://github.com/facebook/jest/issues/9543 */
      pnpApiPath = cjsRequire.resolve('pnpapi')
    } catch {}
    if (
      pnpApiPath &&
      !NODE_OPTIONS.some(
        (option, index) =>
          ['-r', '--require'].includes(option) &&
          pnpApiPath === cjsRequire.resolve(NODE_OPTIONS[index + 1]),
      ) &&
      !execArgv.includes(pnpApiPath)
    ) {
      execArgv = ['-r', pnpApiPath, ...execArgv]
      const pnpLoaderPath = path.resolve(pnpApiPath, '../.pnp.loader.mjs')
      if (isFile(pnpLoaderPath)) {
        // Transform path to file URL because nodejs does not accept
        // absolute Windows paths in the --experimental-loader option.
        // https://github.com/un-ts/synckit/issues/123
        resolvedPnpLoaderPath = pathToFileURL(pnpLoaderPath).toString()

        if (NODE_VERSION < LOADER_SUPPORTED_NODE_VERSION) {
          execArgv = [
            '--experimental-loader',
            resolvedPnpLoaderPath,
            ...execArgv,
          ]
        }
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
    pnpLoaderPath: resolvedPnpLoaderPath,
    execArgv,
  }
}

const md5Hash = (text: string) =>
  // eslint-disable-next-line sonarjs/hashing
  createHash('md5').update(text).digest('hex')

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

let globalsCache: Map<string, [content: string, filepath?: string]> | undefined

let tmpdir: string

const _dirname =
  typeof __dirname === 'undefined'
    ? path.dirname(fileURLToPath(import.meta.url))
    : /* istanbul ignore next */ __dirname

let sharedBuffer: SharedArrayBuffer | undefined
let sharedBufferView: Int32Array | undefined

export const generateGlobals = (
  workerPath: string,
  globalShims: GlobalShim[],
  type: 'import' | 'require' = 'import',
) => {
  if (globalShims.length === 0) {
    return ''
  }

  globalsCache ??= new Map()

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
function startWorkerThread<T extends AnyFn, R = Awaited<ReturnType<T>>>(
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
    pnpLoaderPath,
    execArgv: finalExecArgv,
  } = setupTsRunner(workerPath, { execArgv, tsRunner })

  const workerPathUrl = pathToFileURL(finalWorkerPath)

  if (/\.[cm]ts$/.test(finalWorkerPath)) {
    const isTsxSupported =
      !tsUseEsm || NODE_VERSION >= MTS_SUPPORTED_NODE_VERSION
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
  sharedBufferView ??= new Int32Array(
    /* istanbul ignore next */ (sharedBuffer ??= new SharedArrayBuffer(
      INT32_BYTES,
    )),
    0,
    1,
  )

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
      workerData: { sharedBuffer, workerPort, pnpLoaderPath },
      transferList: [workerPort, ...transferList],
      execArgv: finalExecArgv,
    },
  )

  let nextID = 0

  const receiveMessageWithId = (
    port: MessagePort,
    expectedId: number,
    waitingTimeout?: number,
  ): WorkerToMainMessage<R> => {
    const start = Date.now()
    const status = Atomics.wait(sharedBufferView!, 0, 0, waitingTimeout)
    Atomics.store(sharedBufferView!, 0, 0)

    if (!['ok', 'not-equal'].includes(status)) {
      const abortMsg: MainToWorkerCommandMessage = {
        id: expectedId,
        cmd: 'abort',
      }
      port.postMessage(abortMsg)
      throw new Error('Internal error: Atomics.wait() failed: ' + status)
    }

    const { id, ...message } = (
      receiveMessageOnPort(mainPort) as { message: WorkerToMainMessage<R> }
    ).message

    if (id < expectedId) {
      const waitingTime = Date.now() - start
      return receiveMessageWithId(
        port,
        expectedId,
        waitingTimeout ? waitingTimeout - waitingTime : undefined,
      )
    }

    if (expectedId !== id) {
      throw new Error(
        `Internal error: Expected id ${expectedId} but got id ${id}`,
      )
    }

    return { id, ...message }
  }

  const syncFn = (...args: Parameters<T>): R => {
    const id = nextID++

    const msg: MainToWorkerMessage<Parameters<T>> = { id, args }

    worker.postMessage(msg)

    const { result, error, properties } = receiveMessageWithId(
      mainPort,
      id,
      timeout,
    )

    if (error) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw Object.assign(error as object, properties)
    }

    return result!
  }

  worker.unref()

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

  const { workerPort, sharedBuffer, pnpLoaderPath } = workerData as WorkerData

  if (pnpLoaderPath && NODE_VERSION >= LOADER_SUPPORTED_NODE_VERSION) {
    module.register(pnpLoaderPath)
  }

  const sharedBufferView = new Int32Array(sharedBuffer, 0, 1)

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
          msg = { id, result: await fn(...args) }
        } catch (error: unknown) {
          msg = { id, error, properties: extractProperties(error) }
        }
        workerPort.off('message', handleAbortMessage)
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- false positive for `handleAbortMessage`
        if (isAborted) {
          return
        }
        workerPort.postMessage(msg)
        Atomics.add(sharedBufferView, 0, 1)
        Atomics.notify(sharedBufferView, 0)
      })()
    },
  )
}
