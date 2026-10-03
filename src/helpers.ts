import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  type MessagePort,
  MessageChannel,
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
  WorkerLoadErrorMessage,
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

/**
 * Global key under which the worker load guard publishes its remover.
 *
 * The guard is installed by synckit's CommonJS build — preloaded into the worker with
 * `-r` — while the worker module usually imports the ESM build, so the two module
 * instances have to agree through a well-known global rather than a module-level variable.
 */
const WORKER_LOAD_GUARD = Symbol.for('synckit.workerLoadGuard')

type WorkerLoadGuardStore = Record<symbol, (() => void) | undefined>

const workerLoadGuardStore = globalThis as WorkerLoadGuardStore

let atomicWriteCount = 0

/**
 * Writes a file atomically: a reader either sees the previous contents or the complete new
 * ones, never a half-written file. Generated files are shared between processes in
 * `node_modules/.synckit`, and a truncated worker entry would be a parse error the load
 * guard cannot always report.
 */
const writeFileAtomic = (filepath: string, content: string) => {
  const temp = `${filepath}.${process.pid}.${(atomicWriteCount += 1)}.tmp`
  fs.writeFileSync(temp, content)
  fs.renameSync(temp, filepath)
}

export const hasRequireFlag = (execArgv: string[]) =>
  execArgv.some(execArg => REQUIRE_FLAGS.has(execArg))

export const hasImportFlag = (execArgv: string[]) =>
  execArgv.includes(IMPORT_FLAG)

export const hasLoaderFlag = (execArgv: string[]) =>
  execArgv.some(execArg => LOADER_FLAGS.has(execArg))

export const setupTsRunner = (
  workerPath: string,
  {
    execArgv = DEFAULT_EXEC_ARGV,
    tsRunner,
  }: { execArgv?: string[]; tsRunner?: TsRunner } = {}, // eslint-disable-next-line sonarjs/cognitive-complexity
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

  let jsUseEsm = ext === '.mjs'
  let tsUseEsm = ext === '.mts'

  if (isTs) {
    if (!tsUseEsm && ext !== '.cts') {
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
  } else if (!jsUseEsm && ext !== '.cjs') {
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
        execArgv = [LOADER_FLAG, resolvedPnpLoaderPath, ...execArgv]
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
          // eslint-disable-next-line unicorn-x/prefer-string-replace-all -- compatibility
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

/** @internal */
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

const getTmpDir = () => {
  if (!tmpdir) {
    tmpdir = path.resolve(findUp(_dirname), '../node_modules/.synckit')
  }
  fs.mkdirSync(tmpdir, { recursive: true })
  return tmpdir
}

/**
 * Absolute path of the generated ESM global shims module for `workerPath`.
 *
 * It is written next to the other generated files so that bare specifiers in the shims
 * resolve from the project's `node_modules`, exactly as they would from the worker itself.
 */
const globalsFilepath = (workerPath: string) =>
  path.resolve(getTmpDir(), md5Hash(workerPath) + '.mjs')

/**
 * Writes the ESM global shims module for `workerPath` and returns its `file:` URL.
 *
 * It is written next to the other generated files so that bare specifiers in the shims
 * resolve from the project's `node_modules`, exactly as they would from the worker itself,
 * and it loads the worker module itself once the shims are in place. That is the only case
 * where ESM workers need a wrapper at all: global shims have to be evaluated before the
 * worker module, which a preload cannot sequence without a file.
 */
const writeEsmGlobalsWrapper = (
  workerPath: string,
  globalShims: GlobalShim[],
) => {
  const filepath = globalsFilepath(workerPath)
  writeFileAtomic(
    filepath,
    `${_generateGlobals(globalShims, 'import')}
await import((await import('node:worker_threads')).workerData.workerUrl)`,
  )
  return pathToFileURL(filepath)
}

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
    filepath = globalsFilepath(workerPath)
    content = encodeImportModule(filepath)
    writeFileAtomic(filepath, globals)
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
 * @returns A new object containing the enumerable properties of the input, or
 *   undefined if no valid object is provided.
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

/**
 * Reports a failure to load the worker module back to the main thread.
 *
 * The main thread is blocked in `Atomics.wait()` and cannot observe the worker's `error`
 * event, so this notification is the only way out. The error's own properties are copied
 * because MessagePort does not clone them, and the shared buffer is notified even when the
 * error cannot be serialized at all — otherwise the main thread would wait forever.
 *
 * @internal
 */
export const reportWorkerLoadError = (
  workerPort: MessagePort,
  sharedBufferView: Int32Array,
  error: unknown,
) => {
  try {
    const cause = error ?? new Error('Worker module failed to load')
    let properties: unknown
    try {
      properties = extractProperties(cause)
    } catch {
      // an enumerable getter threw; report the error without its properties
    }
    workerPort.postMessage({ loadError: true, error: cause, properties })
  } catch {
    // the error is not cloneable; report something that always is
    workerPort.postMessage({
      loadError: true,
      error: new Error('Worker module failed to load'),
    })
  } finally {
    Atomics.add(sharedBufferView, 0, 1)
    Atomics.notify(sharedBufferView, 0)
  }
}

/**
 * Creates the callback the load guard installs for `uncaughtException` and
 * `unhandledRejection`.
 *
 * @internal
 */
export const createWorkerLoadGuard =
  (workerPort: MessagePort, sharedBufferView: Int32Array) =>
  (error: unknown) => {
    reportWorkerLoadError(workerPort, sharedBufferView, error)
  }

/**
 * Installs the guard which reports a failure to load the worker module.
 *
 * It is installed from synckit's CommonJS build, which `startWorkerThread` preloads into
 * the worker with `-r`, so that it is in place before the worker module — and before any
 * `--require` / `--import` hook it depends on — is loaded. `runAsWorker` removes it again,
 * so it never changes the semantics of errors raised after the worker registered.
 *
 * @internal
 */
export const installWorkerLoadGuard = (
  workerPort: MessagePort,
  sharedBufferView: Int32Array,
) => {
  if (workerLoadGuardStore[WORKER_LOAD_GUARD]) {
    return
  }

  const guard = createWorkerLoadGuard(workerPort, sharedBufferView)

  process.on('uncaughtException', guard)
  process.on('unhandledRejection', guard)

  workerLoadGuardStore[WORKER_LOAD_GUARD] = () => {
    process.off('uncaughtException', guard)
    process.off('unhandledRejection', guard)
    delete workerLoadGuardStore[WORKER_LOAD_GUARD]
  }
}

/** Removes the load guard once the worker module has registered its handler.
 *
 * @internal
 */
export const removeWorkerLoadGuard = () => {
  workerLoadGuardStore[WORKER_LOAD_GUARD]?.()
}

let workerPreload: string | null | undefined

/**
 * Absolute path of the module preloaded into every worker to install the load guard.
 *
 * It is synckit's own CommonJS entry, which already ships with the package, so no extra
 * file is needed. The path is derived from this module's own location rather than from
 * `require.resolve('synckit')`: under a test runner the latter resolves through the
 * runner's module map and can point at source instead of the built bundle. When the file
 * is not there — a bundler inlined synckit, or an unexpected layout — the guard is simply
 * not installed and a failing worker behaves as it did before.
 */
const getWorkerPreload = () => {
  if (workerPreload === undefined) {
    const filepath = path.resolve(_dirname, '../lib/index.cjs')
    workerPreload = isFile(filepath) ? filepath : null
  }
  return workerPreload ?? undefined
}

/**
 * Spawns a worker thread and returns a synchronous function to dispatch tasks.
 *
 * The function initializes a worker thread with the specified script and
 * configuration, setting up a dedicated message channel for bidirectional
 * communication. It applies TypeScript runner settings, execution arguments,
 * and global shims as needed. The returned function sends tasks to the worker,
 * waits synchronously for a response using shared memory synchronization, and
 * then returns the computed result.
 *
 * @param workerPath - The file path of the worker script to execute.
 * @param options - An object containing configuration parameters:
 *
 *   - Timeout: Maximum time in milliseconds to wait for the worker's response.
 *   - ExecArgv: Array of Node.js execution arguments for the worker.
 *   - TsRunner: Specifies the TypeScript runner to use if the worker script is
 *       TypeScript.
 *   - TransferList: List of additional transferable objects to pass to the worker.
 *   - GlobalShims: Modules to import as global shims; if true, a default preset is
 *       used.
 *
 * @returns A synchronous function that accepts task arguments intended for the
 *   worker thread and returns its result.
 * @throws {Error} If a TypeScript runner is required but not specified, or if
 *   an unsupported TypeScript runner is used for the file type.
 * @throws {Error} If internal synchronization fails or if the message
 *   identifier does not match the expected value.
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

  // A dedicated notification byte per worker: a worker reports its own load failure
  // before any request exists, so a buffer shared between workers would let an
  // unrelated `syncFn` call consume that notification and then hang forever.
  const sharedBufferView = new Int32Array(new SharedArrayBuffer(INT32_BYTES))

  const isEsm = isTs ? tsUseEsm : jsUseEsm
  const useGlobals = finalGlobalShims.length > 0

  // The worker module itself is the entry unless global shims have to be evaluated first.
  // Keeping it as the entry is what lets every custom ESM loader see it on Node 18.18 and
  // 20 (an `eval`'d or `data:` entry does not go through their hooks), and it means no
  // bootstrap file is generated. Load failures are reported by the preloaded guard instead.
  let entry: URL | string = workerPathUrl
  let useEval = false

  if (useGlobals) {
    if (isEsm) {
      entry = writeEsmGlobalsWrapper(finalWorkerPath, finalGlobalShims)
    } else {
      const globals = generateGlobals(
        finalWorkerPath,
        finalGlobalShims,
        'require',
      )
      entry = `const { workerPath } = require('node:worker_threads').workerData;${globals}${
        globals ? ';' : ''
      }require(workerPath)`
      useEval = true
    }
  }

  const preload = getWorkerPreload()

  const worker = new Worker(entry, {
    eval: useEval,
    workerData: {
      sharedBufferView,
      workerPort,
      pnpLoaderPath,
      workerUrl: String(workerPathUrl),
      workerPath: finalWorkerPath,
    },
    transferList: [workerPort, ...transferList],
    execArgv: preload
      ? [REQUIRE_ABBR_FLAG, preload, ...finalExecArgv]
      : finalExecArgv,
  })

  let nextID = 0

  // Cached so that later calls keep throwing the original load error instead of
  // posting to a worker which never managed to register a handler.
  let loadError: { error: object; properties?: unknown } | undefined

  const receiveMessageWithId = (
    port: MessagePort,
    expectedId: number,
    waitingTimeout?: number,
  ): WorkerToMainMessage<R> => {
    const start = Date.now()
    const status = Atomics.wait(sharedBufferView, 0, 0, waitingTimeout)
    Atomics.store(sharedBufferView, 0, 0)

    if (!['ok', 'not-equal'].includes(status)) {
      const abortMsg: MainToWorkerCommandMessage = {
        id: expectedId,
        cmd: 'abort',
      }
      port.postMessage(abortMsg)
      throw new Error('Internal error: Atomics.wait() failed: ' + status)
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const result = receiveMessageOnPort(mainPort) as
      | { message: WorkerLoadErrorMessage | WorkerToMainMessage<R> }
      | undefined

    const msg = result?.message

    if (msg && 'loadError' in msg) {
      // The guard always reports an `Error`, but a falsy thrown value must still surface
      // here rather than fall through to the "not our id yet" branch below, which would
      // wait again and hang forever.
      const error: object =
        msg.error && typeof msg.error === 'object'
          ? msg.error
          : new Error('Worker module failed to load')
      loadError = { error, properties: msg.properties }
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw Object.assign(error, msg.properties)
    }

    if (msg?.id == null || msg.id < expectedId) {
      const waitingTime = Date.now() - start
      return receiveMessageWithId(
        port,
        expectedId,
        waitingTimeout ? waitingTimeout - waitingTime : undefined,
      )
    }

    const { id, ...message } = msg

    if (expectedId !== id) {
      throw new Error(
        `Internal error: Expected id ${expectedId} but got id ${id}`,
      )
    }

    return { id, ...message }
  }

  const syncFn = (...args: Parameters<T>): R => {
    if (loadError) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw Object.assign(loadError.error, loadError.properties)
    }

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
      throw Object.assign(error, properties)
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
