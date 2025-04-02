import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  type MessagePort,
  Worker,
  receiveMessageOnPort,
} from 'node:worker_threads'

import { tryExtensions, findUp, cjsRequire, isPkgAvailable } from '@pkgr/core'

import { compareNodeVersion } from './common.js'
import {
  DEFAULT_EXEC_ARGV,
  DEFAULT_GLOBAL_SHIMS,
  DEFAULT_GLOBAL_SHIMS_PRESET,
  DEFAULT_TIMEOUT,
  DEFAULT_TS_RUNNER,
  DEFAULT_TYPES_NODE_VERSION,
  IMPORT_FLAG,
  IMPORT_FLAG_SUPPORTED,
  INT32_BYTES,
  LOADER_FLAG,
  LOADER_FLAGS,
  MODULE_REGISTER_SUPPORTED,
  MTS_SUPPORTED,
  NO_STRIP_TYPES,
  NO_STRIP_TYPES_FLAG,
  NODE_OPTIONS,
  REQUIRE_ABBR_FLAG,
  REQUIRE_FLAGS,
  STRIP_TYPES_FLAG,
  STRIP_TYPES_NODE_VERSION,
  TRANSFORM_TYPES_FLAG,
  TRANSFORM_TYPES_NODE_VERSION,
  TS_ESM_PARTIAL_SUPPORTED,
  TsRunner,
} from './constants.js'
import type {
  AnyFn,
  GlobalShim,
  MainToWorkerCommandMessage,
  MainToWorkerMessage,
  PackageJson,
  StdioChunk,
  SynckitOptions,
  WorkerToMainMessage,
} from './types.js'

export const isFile = (path: string) => {
  try {
    return !!fs.statSync(path, { throwIfNoEntry: false })?.isFile()
  } catch {
    /* istanbul ignore next */
    return false
  }
}

export const dataUrl = (code: string) =>
  new URL(`data:text/javascript,${encodeURIComponent(code)}`)

export const hasRequireFlag = (execArgv: string[]) =>
  execArgv.some(execArg => REQUIRE_FLAGS.has(execArg))

export const hasImportFlag = (execArgv: string[]) =>
  execArgv.includes(IMPORT_FLAG)

export const hasLoaderFlag = (execArgv: string[]) =>
  execArgv.some(execArg => LOADER_FLAGS.has(execArg))

export const setupTsRunner = (
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

    const stripTypesIndex = execArgv.indexOf(STRIP_TYPES_FLAG)
    const transformTypesIndex = execArgv.indexOf(TRANSFORM_TYPES_FLAG)
    const noStripTypesIndex = execArgv.indexOf(NO_STRIP_TYPES_FLAG)

    const execArgvNoStripTypes =
      noStripTypesIndex > stripTypesIndex ||
      noStripTypesIndex > transformTypesIndex

    const noStripTypes =
      execArgvNoStripTypes ||
      (stripTypesIndex === -1 && transformTypesIndex === -1 && NO_STRIP_TYPES)

    if (tsRunner == null) {
      if (process.versions.bun) {
        tsRunner = TsRunner.Bun
      } else if (
        !noStripTypes &&
        // >=
        compareNodeVersion(STRIP_TYPES_NODE_VERSION) >= 0
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
        // <
        if (compareNodeVersion(STRIP_TYPES_NODE_VERSION) < 0) {
          throw new Error(
            'type stripping is not supported in this node version',
          )
        }

        if (noStripTypes) {
          throw new Error('type stripping is disabled explicitly')
        }

        // >=
        if (compareNodeVersion(DEFAULT_TYPES_NODE_VERSION) >= 0) {
          break
        }

        if (
          // >=
          compareNodeVersion(TRANSFORM_TYPES_NODE_VERSION) >= 0 &&
          !execArgv.includes(TRANSFORM_TYPES_FLAG)
        ) {
          execArgv = [TRANSFORM_TYPES_FLAG, ...execArgv]
        } else if (
          // >=
          compareNodeVersion(STRIP_TYPES_NODE_VERSION) >= 0 &&
          !execArgv.includes(STRIP_TYPES_FLAG)
        ) {
          execArgv = [STRIP_TYPES_FLAG, ...execArgv]
        }

        break
      }
      // https://github.com/TypeStrong/ts-node#node-flags-and-other-tools
      case TsRunner.TsNode: {
        if (tsUseEsm) {
          if (!execArgv.includes(LOADER_FLAG)) {
            execArgv = [LOADER_FLAG, `${TsRunner.TsNode}/esm`, ...execArgv]
          }
        } else if (!hasRequireFlag(execArgv)) {
          execArgv = [
            REQUIRE_ABBR_FLAG,
            `${TsRunner.TsNode}/register`,
            ...execArgv,
          ]
        }
        break
      }
      // https://github.com/egoist/esbuild-register#usage
      case TsRunner.EsbuildRegister: {
        if (tsUseEsm) {
          if (!hasLoaderFlag(execArgv)) {
            execArgv = [
              LOADER_FLAG,
              `${TsRunner.EsbuildRegister}/loader`,
              ...execArgv,
            ]
          }
        } else if (!hasRequireFlag(execArgv)) {
          execArgv = [REQUIRE_ABBR_FLAG, TsRunner.EsbuildRegister, ...execArgv]
        }
        break
      }
      // https://github.com/folke/esbuild-runner#-usage
      case TsRunner.EsbuildRunner: {
        if (!hasRequireFlag(execArgv)) {
          execArgv = [
            REQUIRE_ABBR_FLAG,
            `${TsRunner.EsbuildRunner}/register`,
            ...execArgv,
          ]
        }
        break
      }
      // https://github.com/oxc-project/oxc-node#usage
      case TsRunner.OXC: {
        if (!execArgv.includes(IMPORT_FLAG)) {
          execArgv = [
            IMPORT_FLAG,
            `@${TsRunner.OXC}-node/core/register`,
            ...execArgv,
          ]
        }
        break
      }
      // https://github.com/swc-project/swc-node#usage
      case TsRunner.SWC: {
        if (tsUseEsm) {
          if (IMPORT_FLAG_SUPPORTED) {
            if (!hasImportFlag(execArgv)) {
              execArgv = [
                IMPORT_FLAG,
                `@${TsRunner.SWC}-node/register/esm-register`,
                ...execArgv,
              ]
            }
          } else if (!hasLoaderFlag(execArgv)) {
            execArgv = [
              LOADER_FLAG,
              `@${TsRunner.SWC}-node/register/esm`,
              ...execArgv,
            ]
          }
        } else if (!hasRequireFlag(execArgv)) {
          execArgv = [
            REQUIRE_ABBR_FLAG,
            `@${TsRunner.SWC}-node/register`,
            ...execArgv,
          ]
        }
        break
      }
      // https://tsx.is/dev-api/node-cli#node-js-cli
      case TsRunner.TSX: {
        if (IMPORT_FLAG_SUPPORTED) {
          if (!execArgv.includes(IMPORT_FLAG)) {
            execArgv = [IMPORT_FLAG, TsRunner.TSX, ...execArgv]
          }
        } else if (!execArgv.includes(LOADER_FLAG)) {
          execArgv = [LOADER_FLAG, TsRunner.TSX, ...execArgv]
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
          REQUIRE_FLAGS.has(option) &&
          pnpApiPath === cjsRequire.resolve(NODE_OPTIONS[index + 1]),
      ) &&
      !execArgv.includes(pnpApiPath)
    ) {
      execArgv = [REQUIRE_ABBR_FLAG, pnpApiPath, ...execArgv]
      const pnpLoaderPath = path.resolve(pnpApiPath, '../.pnp.loader.mjs')
      if (isFile(pnpLoaderPath)) {
        // Transform path to file URL because nodejs does not accept
        // absolute Windows paths in the --experimental-loader option.
        // https://github.com/un-ts/synckit/issues/123
        resolvedPnpLoaderPath = pathToFileURL(pnpLoaderPath).href
        if (!MODULE_REGISTER_SUPPORTED) {
          execArgv = [LOADER_FLAG, resolvedPnpLoaderPath, ...execArgv]
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

export const md5Hash = (text: string) =>
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

// MessagePort doesn't copy the properties of Error objects. We still want
// error objects to have extra properties such as "warnings" so implement the
// property copying manually.
export function extractProperties<T extends object>(object: T): T
export function extractProperties<T>(object?: T): T | undefined

/**
 * Creates a shallow copy of the enumerable properties from the provided object.
 *
 * @param object - An optional object whose properties are to be extracted.
 * @returns A new object containing the enumerable properties of the input, or undefined if no valid object is provided.
 */
export function extractProperties<T>(object?: T) {
  if (object && typeof object === 'object') {
    const properties = {} as T
    for (const key in object) {
      properties[key as keyof T] = object[key]
    }
    return properties
  }
}

let sharedBuffer: SharedArrayBuffer | undefined
let sharedBufferView: Int32Array | undefined

/**
 * Spawns a worker thread and returns a synchronous function to dispatch tasks.
 *
 * The function initializes a worker thread with the specified script and configuration,
 * setting up a dedicated message channel for bidirectional communication. It applies TypeScript
 * runner settings, execution arguments, and global shims as needed. The returned function sends
 * tasks to the worker, waits synchronously for a response using shared memory synchronization, and
 * then returns the computed result.
 *
 * @param workerPath - The file path of the worker script to execute.
 * @param options - An object containing configuration parameters:
 *   - timeout: Maximum time in milliseconds to wait for the worker's response.
 *   - execArgv: Array of Node.js execution arguments for the worker.
 *   - tsRunner: Specifies the TypeScript runner to use if the worker script is TypeScript.
 *   - transferList: List of additional transferable objects to pass to the worker.
 *   - globalShims: Modules to import as global shims; if true, a default preset is used.
 *
 * @returns A synchronous function that accepts task arguments intended for the worker thread and returns its result.
 *
 * @throws {Error} If a TypeScript runner is required but not specified, or if an unsupported TypeScript runner is used for the file type.
 * @throws {Error} If internal synchronization fails or if the message identifier does not match the expected value.
 */
export function startWorkerThread<T extends AnyFn, R = Awaited<ReturnType<T>>>( // eslint-disable-line sonarjs/cognitive-complexity
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
    const isTsxSupported = !tsUseEsm || TS_ESM_PARTIAL_SUPPORTED
    /* istanbul ignore if */
    if (!finalTsRunner) {
      throw new Error('No ts runner specified, ts worker path is not supported')
    } /* istanbul ignore if */ else if (
      (
        [
          // https://github.com/egoist/esbuild-register/issues/96
          TsRunner.EsbuildRegister,
          // https://github.com/folke/esbuild-runner/issues/67
          TsRunner.EsbuildRunner,
          ...(TS_ESM_PARTIAL_SUPPORTED
            ? [
                TsRunner.OXC,
                // https://github.com/swc-project/swc-node/issues/667
                TsRunner.SWC,
              ]
            : []),
          .../* istanbul ignore next */ (isTsxSupported ? [] : [TsRunner.TSX]),
        ] as TsRunner[]
      ).includes(finalTsRunner)
    ) {
      throw new Error(
        `${finalTsRunner} is not supported for ${ext} files yet` +
          /* istanbul ignore next */ (isTsxSupported
            ? ', you can try [tsx](https://github.com/esbuild-kit/tsx) instead'
            : MTS_SUPPORTED
              ? ', you can try [oxc](https://github.com/oxc-project/oxc-node) or [swc](https://github.com/swc-project/swc-node/tree/master/packages/register) instead'
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
      workerData: { sharedBufferView, workerPort, pnpLoaderPath },
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

    const { result, error, properties, stdio } = receiveMessageWithId(
      mainPort,
      id,
      timeout,
    )

    for (const { type, chunk, encoding } of stdio) {
      process[type].write(chunk, encoding)
    }

    if (error) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw Object.assign(error as object, properties)
    }

    return result!
  }

  worker.unref()

  return syncFn
}

export const overrideStdio = (stdio: StdioChunk[]) => {
  // https://github.com/nodejs/node/blob/66556f53a7b36384bce305865c30ca43eaa0874b/lib/internal/worker/io.js#L369
  for (const type of ['stdout', 'stderr'] as const) {
    process[type]._writev = (chunks, callback) => {
      for (const {
        // type-coverage:ignore-next-line -- we can't control
        chunk,
        encoding,
      } of chunks) {
        stdio.push({
          type,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- we can't control
          chunk,
          encoding,
        })
      }
      callback()
    }
  }
}
